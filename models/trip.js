var MessageFactory = require("../messageFactory"),
	async = require("async"),
	util = require('util'),
	Uuid = require("uuid-lib"),
	Driver = require('./driver').Driver,
	apiBackend = require('../backend'),
	Repository = require('../lib/repository');

function Trip() {
	this.canceledDriverIds = [];
	this.route = [];
}

var PICKUP_TIMEOUT = 15000; // 15 secs
var repository = new Repository(Trip);

['dispatcher_canceled', 'client_canceled', 'driver_canceled', 'started', 'finished'].forEach(function (readableState, index) {
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

	function hasDriverCanceledPickup(driver) {
		return this.canceledDriverIds.indexOf(driver.id) !== -1;
	};

	var self = this;
	async.waterfall([
		Driver.findAllAvailableOrderByDistance.bind(null, this.client),

		function(driversWithDistance, next) {
			// find first driver that hasn't rejected Pickup before
			async.detect(
				driversWithDistance,
				function(item, callback) {
					callback(hasDriverCanceledPickup.call(self, item.driver));
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

Trip.prototype._archive = function(callback) {
	// remove from redis db
	repository.remove(this, function(err) {
		if (err) console.log(err);
	})

	callback = callback || function(err) {
	  if (err) console.log(err);
	};

	apiBackend.addTrip(this, callback)
}

Trip.prototype._save = function(callback) {
	callback = callback || function(err) {
	  if (err) console.log(err);
	};

	repository.save(this, callback);
}

Trip.prototype._onDriverDisconnect = function() {
	if (this.driver.state === Driver.DISPATCHING) {
		this._clearPickupTimeout();
		this._passPickupToNextAvailableDriver();
	}
}

Trip.prototype._cancelClientPickup = function(reasonString) {
	this.state = Trip.DISPATCHER_CANCELED;
	this._archive();
	this.client.pickupCanceled(reasonString);
}

Trip.prototype._cancelDriverPickup = function(clientCanceled) {
	if (clientCanceled) {
		this._clearPickupTimeout();
		this.state = Trip.CLIENT_CANCELED;
	}
	else {
		this.canceledDriverIds.push(this.driver.id);
		this.state = Trip.DRIVER_CANCELED;
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
	// Estimate time required to pickup the client
	this.driver.queryETAForClient(this.client, function(err, eta) {
		// Keep ETA for client and driver apps
		this.eta = eta;
		this._pickupTimer = setTimeout(this._passPickupToNextAvailableDriver.bind(this), PICKUP_TIMEOUT);

		this.driver.dispatch(this.client, this, function(err){
			// TODO: Если ошибка посылки Pickup запроса, то сразу отменять таймер и передавать следующему ближайшему водителю
			// Иначе пройдет 15 секунд и только после этого запрос передастся другому водителю
			if (err) console.log(err);
			if (typeof callback === 'function') callback(err);
		});

	}.bind(this));
}

function sendMessage(user, message) {
	if (!user.connected) {
		return console.log("Can't send message " + message.messageType + " right away to user id " + user.id);
	}

	user.send(message, function(err) {
		// TODO: Возможно стоит насильно закрывать соединение если была ошибка посылки
		if (err) console.log(err);
	});
}

Trip.prototype.getSchema = function() {
	return ['id', 'clientId', 'driverId', 'state', 'pickupLocation', 'dropoffLocation', 'pickupTimestamp', 'dropoffTimestamp', 'fareBilledToCard', 'canceledDriverIds', 'route', 'eta', 'timeToPickupSeconds', 'confirmTimestamp', 'arrivalTimestamp'];
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
Trip.prototype.pickup = function(driver, client, clientContext, callback) {
	this._setClient(client);
	this._setDriver(driver);

	this.pickupLocation = clientContext.message.location;
	this.requestTimestamp = timestamp(); // Unix epoch time

	// save trip to generate id
	this._save();

	async.series({
		// dispatch to nearest available driver
		dispatchDriver: this._dispatchDriver.bind(this),
		// update and save client
		replyToClient: this.client.pickup.bind(this.client, clientContext, this),
		// save trip with eta (it's updated in dispatchDriver)
		saveTrip: this._save.bind(this)
	}, function(err, result){
		callback(err, result.replyToClient);
	});
}

// Водитель подтвердил заказ. Известить клиента что водитель в пути
Trip.prototype.confirm = function(driverContext, callback) {
	if (this.driver.state !== Driver.DISPATCHING) return callback(new Error('Unexpected Pickup confirmation'));

	this.confirmTimestamp = timestamp();
	this._clearPickupTimeout();

	async.series({
		driverResult: this.driver.confirm.bind(this.driver, driverContext),
		ignore1: this.client.confirm.bind(this.client),
		ignore2: this._save.bind(this)
	},
		function(err, results) {
			callback(null, results && results.driverResult);
		}
	);
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
	// Driver simulator does not honor PickupCanceled message and keeps sending PingDriver
	// and since trip is canceled and is null for client, we crash in Client.driverEnroute
	if (this.state === Trip.CLIENT_CANCELED) return;

	if (this.driver.isDrivingClient()) {
		this._addRouteWayPoint(context);
	}

	this.client.driverEnroute();
}

// Водитель совсем рядом или на месте. Известить клиента чтобы он выходил
Trip.prototype.driverArriving = function(driverContext, callback) {
	this.arrivalTimestamp = timestamp();
	this.timeToPickupSeconds = this.arrivedTimestamp - this.confirmTimestamp;

	this.driver.arriving(driverContext, function(err, result) {
		sendMessage(this.client, MessageFactory.createArrivingNow(this));
		this._save();

		callback(null, result);	
	}.bind(this));
}

Trip.prototype.clientCancelPickup = function(clientContext, callback) {
	this.state = Trip.CLIENT_CANCELED;
	this._cancelDriverPickup(true);
	
	this.client.cancelPickup(clientContext, function(err, result){
		this._archive();
		callback(err, result);
	}.bind(this));
}

// Водитель отменил Trip после подтверждения
Trip.prototype.driverCancel = function(driverContext, callback) {
	this.state = Trip.DRIVER_CANCELED;

	async.parallel({
		notifyClient: this.client.tripCanceled.bind(this.client),
		driverResponse: this.driver.cancelTrip.bind(this.driver, driverContext),
		archive: this._archive.bind(this)
	},
		function(err, results) {
			if (err) return callback(err);
			callback(null, results.driverResponse);
		}
	);
}

// Клиент отменил Trip после подтверждения Водителем
Trip.prototype.clientCancel = function(clientContext, callback) {
	this.state = Trip.CLIENT_CANCELED;
	
	async.parallel({
		notifyDriver: this.driver.tripCanceled.bind(this.driver),
		clientResponse: this.client.cancelTrip.bind(this.client, clientContext),
		archive: this._archive.bind(this)
	},
		function(err, results) {
			if (err) return callback(err);
			callback(null, results.clientResponse);
		}
	);	
}

// Водитель начал поездку. Известить клиента что поездка началась
Trip.prototype.driverBegin = function(driverContext, callback) {
	this.state = Trip.STARTED;
	this.pickupTimestamp = timestamp();

	async.series({
		driverResult: this.driver.begin.bind(this.driver, driverContext),
		ignore1: this.client.start.bind(this.client),
		ignore2: this._save.bind(this)
	}, 
		function(err, results) {
			callback(null, results && results.driverResult);
		}.bind(this)
	);
}

// Водитель завершил поездку. Известить клиента что поездка была завершена
Trip.prototype.driverEnd = function(driverContext, callback) {
	this.state = Trip.FINISHED;
	this.dropoffTimestamp = timestamp();
	
	this.dropoffLocation = {
		latitude: driverContext.message.latitude,
		longitude: driverContext.message.longitude
	};

	this._addRouteWayPoint(driverContext);

	apiBackend.billTrip(this, function(err, fare) {
		if (err) console.log(err);

		console.log('Trip ' + this.id + ' fare is ' + fare + ' руб.');
		this.fareBilledToCard = fare;
		
		this.client.end();
		this.driver.end(driverContext, callback);
		this._save();

	}.bind(this));
}

Trip.prototype.clientRateDriver = function(clientContext, callback) {
	this.client.rateDriver(clientContext, function(err) {
		callback(err, MessageFactory.createClientOK(this.client));
	}.bind(this));
}

// At this point driver goes back on duty
Trip.prototype.driverRateClient = function(driverContext, callback) {
	this.driver.rateClient(driverContext, function(err) {
		callback(err, MessageFactory.createDriverOK(this.driver));
	}.bind(this));
}

function timestamp() {
	return Math.round(Date.now() / 1000);
}

// export Trip constructor
module.exports.Trip = Trip;
module.exports.repository = repository;