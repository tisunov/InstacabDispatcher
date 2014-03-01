var MessageFactory = require("../messageFactory"),
	async = require("async"),
	util = require('util'),
	Uuid = require("uuid-lib"),
	Driver = require('./driver').Driver,
	apiBackend = require('../backend'),
	publisher = require('../publisher'),
	Repository = require('../lib/repository');

function Trip(id, client, driver) {
	this.rejectedDriverIds = [];
	this.route = [];

	if (id) {
		this.id = id;
		this._setClient(client);
		this._setDriver(driver);
		this.createdAt = timestamp();
	}	
}

var PICKUP_TIMEOUT = 15000; // 15 secs
var repository = new Repository(Trip);

['dispatcher_canceled', 'client_canceled', 'driver_confirmed', 'driver_canceled', 'driver_rejected', 'driver_arriving', 'started', 'finished', 'dispatching'].forEach(function (readableState, index) {
  var state = readableState.toUpperCase();
    Trip.prototype[state] = Trip[state] = readableState;
});

Trip.prototype.load = function(callback) {
	var self = this;
	async.parallel([
		function(next) {
			require("./client").repository.get(self.clientId, function(err, client) {
				self.client = client;
				next(err);
			})
		},
		function(next) {
			require("./driver").repository.get(self.driverId, function(err, driver) {
				self.driver = driver;
				next(err);
			})			
		},
	], callback);
}

Trip.prototype._passPickupToNextAvailableDriver = function() {
	console.log('Driver ' + this.driver.id + ' unable or unwilling to pickup. Finding next one...');
	this._cancelDriverPickup(false);

	function hasDriverRejectedPickupBefore(driver) {
		return this.rejectedDriverIds.indexOf(driver.id) !== -1;
	};

	var self = this;
	async.waterfall([
		Driver.findAllAvailableOrderByDistance.bind(null, this.pickupLocation),

		function(driversWithDistance, next) {
			// find first driver that hasn't rejected Pickup before
			async.detect(
				driversWithDistance,
				function(item, callback) {
					callback(hasDriverRejectedPickupBefore.call(self, item.driver));
				},
				next
			);
		}
	],
	function(err, result) {
		if (result) {
			this._setDriver(result.driver);
			this._dispatchDriver();
		}
		else {
			console.log('No more available drivers to pass Pickup request to');
			this._cancelClientPickup('Отсутствуют свободные водители');
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

Trip.prototype._onDriverDisconnect = function() {
	if (this.driver.state === Driver.DISPATCHING) {
		this._clearPickupTimeout();
		this._passPickupToNextAvailableDriver();
	}
}

Trip.prototype._cancelClientPickup = function(reasonString) {
	this._changeState(Trip.DISPATCHER_CANCELED);
	this._archive();
	this.client.notifyPickupCanceled(reasonString);
}

Trip.prototype._cancelDriverPickup = function(clientCanceled) {
	if (clientCanceled) {
		this._clearPickupTimeout();
		this._changeState(Trip.CLIENT_CANCELED);
	}
	else {
		this.rejectedDriverIds.push(this.driver.id);
		this._changeState(Trip.DRIVER_REJECTED);
	}

	var reason = clientCanceled ? 'Клиент отменил запрос' : 'Истекло время для подтверждения'

	this.driver.pickupCanceled(reason);
	this.driver.removeListener('disconnect', this._onDriverDisconnect.bind(this));

	this._save();
}

Trip.prototype._clearPickupTimeout = function() {
	if (this._pickupTimer) {
		clearTimeout(this._pickupTimer);
		this._pickupTimer = null;
	}
}

Trip.prototype._dispatchDriver = function(callback) {
	// Estimate time to client
	this.driver.queryETAToLocation(this.pickupLocation, function(err, eta) {
		// Keep ETA for client and driver apps
		this.eta = eta;
		// Give driver 15 seconds to confirm
		this._pickupTimer = setTimeout(this._passPickupToNextAvailableDriver.bind(this), PICKUP_TIMEOUT);
		this._changeState(Trip.DISPATCHING);
		this._save();

		// Send dispatch request
		this.driver.dispatch(this.client, this, function(err){
			// TODO: Если ошибка посылки Pickup запроса, то сразу отменять таймер и передавать следующему ближайшему водителю
			// Иначе пройдет 15 секунд и только после этого запрос передастся другому водителю
			if (err) console.log(err);
			if (typeof callback === 'function') callback(err);
		});

	}.bind(this));
}

Trip.prototype.getSchema = function() {
	return ['id', 'clientId', 'driverId', 'state', 'cancelReason', 'pickupLocation', 'dropoffLocation', 'pickupAt', 'dropoffAt', 'createdAt', 'fareBilledToCard', 'rejectedDriverIds', 'route', 'eta', 'secondsToArrival', 'confirmedAt', 'arrivedAt', 'driverRating', 'feedback'];
}

Trip.prototype._setClient = function(value) {
	this.client = value;
	this.clientId = value.id;
}

Trip.prototype._setDriver = function(driver) {
	console.log('Set trip ' + this.id + ' driver to ' + driver.id);
	this.driver = driver;
	this.driverId = driver.id;
	this.driver.once('disconnect', this._onDriverDisconnect.bind(this));
}

// Клиент запросил машину
Trip.prototype.pickup = function(clientContext, callback) {

	if (this.state !== Trip.DISPATCHING) {
		this.pickupLocation = clientContext.message.pickupLocation;
		this._save();

		// dispatch to nearest available driver
		this._dispatchDriver();		
	}

	callback(null, this.client.pickup(clientContext, this));
}

// Водитель подтвердил заказ. Известить клиента что водитель в пути
Trip.prototype.confirm = function(driverContext, callback) {
	if (this.driver.state !== Driver.DISPATCHING) return callback(new Error('Unexpected Pickup confirmation'));

	this.confirmedAt = timestamp();
	this._changeState(Trip.DRIVER_CONFIRMED);
	this._clearPickupTimeout();

	var response = this.driver.confirm(driverContext);
	this.client.notifyDriverConfirmed();
	this._save();

	callback(null, response);
}

Trip.prototype._addRouteWayPoint = function(context) {
	var wayPoint = {
		latitude: context.message.latitude,
		longitude: context.message.longitude,
		horizontalAccuracy: context.message.horizontalAccuracy,
		verticalAccuracy: context.message.verticalAccuracy,
		speed: context.message.speed,
		course: context.message.course,
		epoch: context.message.epoch
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
	this.arrivedAt = timestamp();
	this.secondsToArrival = this.arrivedAt - this.confirmedAt;
	this._changeState(Trip.DRIVER_ARRIVING);

	this.driver.arriving(driverContext, function(err, result) {
		this.client.notifyDriverArriving();
		this._save();

		callback(null, result);	
	}.bind(this));
}

Trip.prototype.clientCancelPickup = function(clientContext, callback) {
	this._changeState(Trip.CLIENT_CANCELED);
	this._cancelDriverPickup(true);
	this._archive();
	
	callback(null, this.client.cancelPickup(clientContext));
}

// Водитель отменил Trip после подтверждения
Trip.prototype.driverCancel = function(driverContext, callback) {
	this.cancelReason = driverContext.message.reason;
	this._changeState(Trip.DRIVER_CANCELED);
	this._archive();

	// notify client
	this.client.notifyTripCanceled();

	// change driver state 
	callback(null, this.driver.cancelTrip(driverContext));
}

// Клиент отменил Trip после подтверждения Водителем
Trip.prototype.clientCancel = function(clientContext, callback) {
	this._changeState(Trip.CLIENT_CANCELED);
	
	// notify driver
	this.driver.notifyTripCanceled();

	this._archive();

	// change client state 
	callback(null, this.client.cancelTrip(clientContext));
}

// Водитель начал поездку. Известить клиента что поездка началась
Trip.prototype.driverBegin = function(driverContext, callback) {

	if (this.state === Trip.DRIVER_ARRIVING) {
		this.pickupAt = timestamp();
		this._changeState(Trip.STARTED);
		this._save();
	}

	var response = this.driver.begin(driverContext);
	this.client.notifyTripStarted();

	callback(null, response);
}

// Водитель завершил поездку. Известить клиента что поездка была завершена
Trip.prototype.driverEnd = function(driverContext, callback) {
	if (!this.driver.isDrivingClient()) return callback(null, MessageFactory.createDriverOK(this.driver));

	this.dropoffAt = timestamp();	
	this.dropoffLocation = {
		latitude: driverContext.message.latitude,
		longitude: driverContext.message.longitude
	};
	this._addRouteWayPoint(driverContext);
	this._changeState(Trip.FINISHED);

	apiBackend.billTrip(this, function(err, fare) {
		if (err) console.log(err);

		console.log('Trip ' + this.id + ' fare is ' + fare + ' руб.');
		this.fareBilledToCard = fare;
		
		this.client.notifyTripFinished();
		var response = this.driver.finishTrip(driverContext);

		this.publish();
		this._save();

		callback(null, response);

	}.bind(this));
}

Trip.prototype.clientRateDriver = function(context, callback) {
	if (this.state !== Trip.FINISHED) {
		this.driverRating = context.message.rating;
		this.feedback = context.message.feedback;
		this._save();
	}

	this.client.rateDriver(context, function(err, response) {
		callback(err, response);
	});
}

// At this point driver goes back on duty
Trip.prototype.driverRateClient = function(context, callback) {
	if (this.state !== Trip.FINISHED) {
		this.clientRating = context.message.rating;
		this._save();		
	}

	this.driver.rateClient(context, function(err, response) {
		callback(err, response);
	});
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
    pickupLocation: this.pickupLocation,
    dropoffLocation: this.dropoffLocation,
    fareBilledToCard: this.fareBilledToCard,
    eta: this.eta,
    createdAt: this.createdAt,
    pickupAt: this.pickupAt,
    dropoffAt: this.dropoffAt
  };
}

Trip.create = function(client, driver, callback) {
	repository.generateNextId(function(err, id){
		callback(err, new Trip(id, client, driver));
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