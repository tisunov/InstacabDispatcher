var MessageFactory = require("../messageFactory"),
	async = require("async"),
	util = require('util'),
	Uuid = require("uuid-lib"),
	Driver = require('./driver').Driver,
	apiBackend = require('../backend'),
	publisher = require('../publisher'),
	ReverseGeocoder = require('../lib/reverse_geocoder'),
	Repository = require('../lib/repository');

function Trip(id) {
	this.rejectedDriverIds = [];
	this.route = [];

	if (id) {
		this.id = id;
		this.createdAt = timestamp();
		this.boundOnDriverDisconnect = this._onDriverDisconnect.bind(this);
	}
}

var PICKUP_TIMEOUT = 15000; // 15 secs
var kFareBillingInProgress = -1;
var repository = new Repository(Trip);

['dispatcher_canceled', 'client_canceled', 'driver_confirmed', 'driver_canceled', 'driver_rejected', 'driver_arriving', 'started', 'finished', 'dispatching'].forEach(function (readableState, index) {
  var state = readableState.toUpperCase();
    Trip.prototype[state] = Trip[state] = readableState;
});

Trip.prototype.load = function(callback) {
	var self = this;
	async.parallel([
		function(next){
			require("./client").repository.get(self.clientId, function(err, client) {
				self.client = client;
				next(err);
			})
		},
		function(next){
			require("./driver").repository.get(self.driverId, function(err, driver) {
				self.driver = driver;
				next(err);
			})			
		},
	], callback);
}

Trip.prototype._dispatchToNextAvailableDriver = function() {
	console.log('Driver ' + this.driver.id + ' unable or unwilling to pickup. Finding next one...');
	this._cancelDriverPickup(false);

	console.log("Rejected driver ids:");
	console.log(util.inspect(this.rejectedDriverIds));

	function hasDriverRejectedPickupBefore(driver) {
		return this.rejectedDriverIds.indexOf(driver.id) !== -1;
	};

	var self = this;
	async.waterfall([
		// BUG: Возвращает пустой массив
		Driver.availableSortedByDistanceFrom.bind(null, this.pickupLocation),

		function(driversWithDistance, next) {
			console.log("Drivers with distance:");
			console.log(util.inspect(this.driversWithDistance, {depth: 3}));


			// Find first driver that hasn't rejected Pickup before
			async.detectSeries(
				driversWithDistance,
				function(item, callback) {
					callback(hasDriverRejectedPickupBefore.call(self, item.driver));
				},
				next.bind(null)
			);
		}
	],
	function(err, result) {
		if (err) {
			console.log("Dispatch error:");
			console.log(util.inspect(err, {depth: 3}));
		}

		if (result) {
			console.log("Dispatch result:");
			console.log(util.inspect(result, {depth: 3}));
		}

		if (result) {
			this._setDriver(result.driver);
			this._dispatchDriver();
		}
		else {
			console.log('No more available drivers to pass Pickup request to');
			this._cancelClientPickupRequest('Отсутствуют свободные водители. Пожалуйста попробуйте позднее еще раз!');
		}

	}.bind(this));
}

// TODO: Remove from cache once driver and client rated it
// TODO: And keep it in Redis until that
Trip.prototype._archive = function(callback) {
	callback = callback || this._defaultCallback;

	apiBackend.addTrip(this, function(err) {
		if (err) return callback(err);
			
		repository.remove(this);
	}.bind(this));
}

Trip.prototype._save = function(callback) {
	repository.save(this, callback);
}

// IDEA: Возможно соединение потерялось по ошибке, 
// и водитель еще успеет восстановить его и отправить подтверждение
Trip.prototype._onDriverDisconnect = function() {
	if (this.driver.state === Driver.DISPATCHING) {
		this._clearPickupTimeout();
		this._dispatchToNextAvailableDriver();
	}
}

Trip.prototype._cancelClientPickupRequest = function(reasonString) {
	this._changeState(Trip.DISPATCHER_CANCELED);
	this._archive();
	this.client.notifyPickupCanceled(reasonString);
}

Trip.prototype._cancelDriverPickup = function(clientCanceled) {
	if (clientCanceled) {
		this._clearPickupTimeout();
		this._changeState(Trip.CLIENT_CANCELED);
		this.driver.notifyPickupCanceled('Клиент отменил запрос');
	}
	else {
		this.rejectedDriverIds.push(this.driver.id);
		this._changeState(Trip.DRIVER_REJECTED);
		this.driver.notifyPickupTimeout();
	}
	
	this.driver.removeListener('disconnect', this.boundOnDriverDisconnect);
	this._save();
}

Trip.prototype._clearPickupTimeout = function() {
	if (this._pickupTimer) {
		clearTimeout(this._pickupTimer);
		this._pickupTimer = null;
	}
}

// Two-stage dispatch to prevent driver stealing when multiple clients request pickup
Trip.prototype._dispatchDriver = function() {
	this.driver.reserveForDispatch();

	// In case client app didn't provide us with reverse geocoded address
	if (!this.pickupLocation.streetAddress && !this.pickupLocation.city) {
		ReverseGeocoder.reverseGeocodeLocation(this.pickupLocation, function(err, streetName, streetNumber, city) {
			this.pickupLocation.streetAddress = streetName + ", " + streetNumber;
			this.pickupLocation.city = city;
			this._save();

			this._estimateTimeToClientThenDispatch();
		}.bind(this));
	}
	else
		this._estimateTimeToClientThenDispatch();
}

Trip.prototype._estimateTimeToClientThenDispatch = function() {
	// Estimate time to client
	this.driver.queryETAToLocation(this.pickupLocation, function(err, eta) {
		// Keep ETA for client and driver apps
		this.eta = eta;
		// Give driver 15 seconds to confirm
		this._pickupTimer = setTimeout(this._dispatchToNextAvailableDriver.bind(this), PICKUP_TIMEOUT);
		this._save();

		// Send dispatch request
		this.driver.dispatch(this.client, this);

		this.publish();
	}.bind(this));
}

Trip.prototype.getSchema = function() {
	return ['id', 'clientId', 'driverId', 'state', 'cancelReason', 'pickupLocation', 'dropoffLocation', 'confirmLocation', 'pickupAt', 'dropoffAt', 'createdAt', 'fareBilledToCard', 'fare', 'rejectedDriverIds', 'route', 'eta', 'secondsToArrival', 'confirmedAt', 'arrivedAt', 'driverRating', 'feedback'];
}

Trip.prototype._setClient = function(value) {
	this.client = value;
	this.clientId = value.id;
}

Trip.prototype._setDriver = function(driver) {
	console.log('Set trip ' + this.id + ' driver to ' + driver.id);
	this.driver = driver;
	this.driverId = driver.id;
	this.driver.once('disconnect', this.boundOnDriverDisconnect);
}

// Клиент запросил машину
Trip.prototype.pickup = function(client, location, driver) {
	this._setClient(client);
	this._setDriver(driver);	
	this.pickupLocation = location;
	this._changeState(Trip.DISPATCHING);
	this._save();

	// dispatch to nearest available driver
	this._dispatchDriver();		
}

// Водитель подтвердил заказ. Известить клиента что водитель в пути
Trip.prototype.confirm = function(driverContext, callback) {	
	var response = this.driver.confirm(driverContext);

	// cleanup
	this.driver.removeListener('disconnect', this.boundOnDriverDisconnect);
	this.boundOnDriverDisconnect = null;

	if (this.state !== Trip.DRIVER_CONFIRMED) {
		this.confirmedAt = timestamp();
		// Keep track for our own ETA engine in the future
		this.confirmLocation = this.driver.location;
		this._changeState(Trip.DRIVER_CONFIRMED);
		this._clearPickupTimeout();		
		this._save();

		this.client.notifyDriverConfirmed();
	}

	callback(null, response);
}

Trip.prototype._addRouteWayPoint = function(context) {
	var payload = context.message;
	
	var wayPoint = {
		latitude: payload.latitude,
		longitude: payload.longitude,
		horizontalAccuracy: payload.horizontalAccuracy,
		verticalAccuracy: payload.verticalAccuracy,
		speed: payload.speed,
		course: payload.course,
		epoch: payload.epoch
	};

	this.route.push(wayPoint);
	this._save();	
}

Trip.prototype.driverPing = function(context) {
	if (this.driver.isDrivingClient()) {
		this._addRouteWayPoint(context);
	}

	this.client.notifyDriverEnroute();
}

// Водитель подъезжает. Известить клиента чтобы он выходил
Trip.prototype.driverArriving = function(driverContext, callback) {
	var response = this.driver.arriving(driverContext);

	if (this.state === Trip.DRIVER_CONFIRMED) {
		this.arrivedAt = timestamp();
		// TODO: Add to schema and to API DB
		this.arrivingLocation = this.driver.location;
		this.secondsToArrival = this.arrivedAt - this.confirmedAt;
		this._changeState(Trip.DRIVER_ARRIVING);
		this._save();

		this.client.notifyDriverArriving();
	}

	callback(null, response);
}

// Client canceled pickup before any Driver confirmed
Trip.prototype.clientCancelPickup = function(clientContext, callback) {
	var response = this.client.cancelPickup(clientContext);

	if (this.state !== Trip.CLIENT_CANCELED) {
		this._changeState(Trip.CLIENT_CANCELED);
		this._cancelDriverPickup(true);
		this._archive();
	}
	
	callback(null, response);
}

// Driver canceled trip after confirmation or arrival
Trip.prototype.driverCancel = function(driverContext, callback) {
	var response = this.driver.cancelTrip(driverContext);

	if (this.state !== Trip.DRIVER_CANCELED) {
		this.cancelReason = driverContext.message.reason;
		this._changeState(Trip.DRIVER_CANCELED);
		this._archive();

		this.client.notifyTripCanceled();
	}

	callback(null, response);
}

// Клиент отменил Trip после подтверждения Водителем
Trip.prototype.clientCancel = function(clientContext, callback) {
	if (this.state !== Trip.CLIENT_CANCELED) {
		this._changeState(Trip.CLIENT_CANCELED);
		this._archive();

		this.driver.notifyTripCanceled();
	}

	callback(null, this.client.cancelTrip(clientContext));
}

// Водитель начал поездку. Известить клиента что поездка началась
Trip.prototype.driverBegin = function(driverContext, callback) {
	var response = this.driver.beginTrip(driverContext);

	if (this.state === Trip.DRIVER_ARRIVING) {
		this.pickupAt = timestamp();
		// Use as a starting point for the trip, because actual begin trip position could be different
		// from stated pickup position: traffic jams, one way street
		this._addRouteWayPoint(driverContext);
		this._changeState(Trip.STARTED);
		this._save();

		this.client.notifyTripStarted();
	}

	callback(null, response);
}

// Водитель завершил поездку. Известить клиента что поездка была завершена
Trip.prototype.driverEnd = function(context, callback) {
	if (this.state === Trip.STARTED) {
		this.dropoffAt = timestamp();
		this.fareBilledToCard = kFareBillingInProgress;
		this.fare = kFareBillingInProgress;
		this.dropoffLocation = {
			latitude: context.message.latitude,
			longitude: context.message.longitude
		};

		this._addRouteWayPoint(context);
		this._changeState(Trip.FINISHED);

		ReverseGeocoder.reverseGeocodeLocation(this.dropoffLocation, function(err, streetName, streetNumber, city) {
			this.dropoffLocation.streetAddress = streetName + ", " + streetNumber;
			this.dropoffLocation.city = city;

			this.publish();
			this._save();

			this._bill();
		}.bind(this));
		
		this._save();

		this.client.notifyTripFinished();
	}
	
	callback(null, this.driver.finishTrip(context));
}

Trip.prototype._bill = function() {
	apiBackend.billTrip(this, function(err, fare_billed_to_card, fare) {
		if (err) console.log(err);

		console.log('Trip ' + this.id + ' billed fare is ' + fare_billed_to_card + ' руб.');
		console.log('Trip ' + this.id + ' total fare is ' + fare + ' руб.');
		this.fareBilledToCard = fare_billed_to_card;
		this.fare = fare;
		this.publish();
		this._save();

		// TODO: Что делать когда платеж по какой то причине не прошел? 
		// Нужно послать и водителю и клиенту уведомление чтобы они показали сообщение
		// вместо цены и уведомить службу поддержки о критической ошибке платежа по поездке

		this.client.notifyTripBilled();
		this.driver.notifyTripBilled();		

	}.bind(this));	
}

Trip.prototype.clientRateDriver = function(context, callback) {
	if (this.state === Trip.FINISHED && !this.driverRating) {
		this.driverRating = context.message.rating;
		this.feedback = context.message.feedback;

		// TODO: Push trip to Backend if driver rated
		// Даже лучше пусть заведен таймер и раз в 15 минут все поездки с оценками перемещаются в архив
		// Чтобы поездки не исчезали когда за ними наблюдает кто то. 
		// Таким образом можно оставлять поездки которые были с ошибками, посылать email & sms Alert 
		// чтобы человек пришел и нашел эти поездки в Диспетчере
		this._save();
	}

	this.client.rateDriver(context, callback);
}

// At this point driver goes back on duty
Trip.prototype.driverRateClient = function(context, callback) {
	if (this.state === Trip.FINISHED && !this.clientRating) {
		this.clientRating = context.message.rating;

		// TODO: Push trip to Backend if client rated
		// Даже лучше пусть заведен таймер и раз в 15 минут все поездки с оценками перемещаются в архив
		this._save();
	}

	this.driver.rateClient(context, callback);
}

Trip.prototype._changeState = function(state) {
	if (this.state !== state) {
		this.state = state;
		this.publish();
	}
}

Trip.prototype._defaultCallback = function(err) {
	if (err) console.log(err);
}

Trip.prototype.publish = function() {
	publisher.publish('channel:trips', JSON.stringify(this));
}

Trip.prototype.toJSON = function() {
  return {
    id: this.id,
    client: this.client,
    driver: this.driver,
    state: this.state,
    route: this.route,
    pickupLocation: this.pickupLocation,
    dropoffLocation: this.dropoffLocation,
    fareBilledToCard: this.fareBilledToCard,
    eta: this.eta,
    createdAt: this.createdAt,
    pickupAt: this.pickupAt,
    dropoffAt: this.dropoffAt
  };
}

Trip.create = function(callback) {
	repository.generateNextId(function(err, id){
		callback(err, new Trip(id));
	});
}

Trip.publishAll = function() {
  repository.all(function(err, trips) {
  	publisher.publish('channel:trips', JSON.stringify({trips: trips}));
  });
}

function timestamp() {
	return Math.round(Date.now() / 1000);
}

// export Trip constructor
module.exports.Trip = Trip;
module.exports.repository = repository;

