var MessageFactory = require("../messageFactory"),
	async = require("async"),
	util = require('util'),
	Uuid = require("uuid-lib"),
	Driver = require('./driver').Driver,
	GroundControlAPI = require('../groundControlApi'),
	Repository = require('../lib/repository');

function Trip() {
	this.canceledDriverIds = [];
	this.route = [];
}

var PICKUP_TIMEOUT = 15000; // 15 secs
var repository = new Repository(Trip);

['dispatcher_canceled', 'client_canceled', 'driver_canceled', 'completed'].forEach(function (readableState, index) {
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
			return this._cancelClientPickup('Отсутствуют свободные водители');
		}

	}.bind(this));
}

Trip.prototype._archive = function() {
	// remove from redis db
	repository.remove(this, function(err) {
		if (err) console.log(err);
	})

	// TODO: Отправить Trip в BusinessLogic для сохранения в PostgreSQL
}

// THINK: Возможно не нужно так быстро передавать другому запрос
// Водитель может успеть за 15 секунд подсоединиться и принять заказ
Trip.prototype._onDriverDisconnect = function() {
	if (this.driver.state === Driver.DISPATCHING) {
		this._clearPickupTimeout();
		this._passPickupToNextAvailableDriver();
	}
}

Trip.prototype._cancelClientPickup = function(reasonString) {
	this.state = Trip.DISPATCHER_CANCELED;
	this._archive();
	return this.client.pickupCanceled(reasonString);
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

	this.save();

	var reason = clientCanceled ? 'Клиент отменил запрос' : 'Истекло время для подтверждения'

	this.driver.pickupCanceled(reason);
	this.driver.removeListener('disconnect', this._onDriverDisconnect.bind(this));
}

Trip.prototype._clearPickupTimeout = function() {
	if (this._pickupTimer) {
		clearTimeout(this._pickupTimer);
		this._pickupTimer = null;
	}
}

Trip.prototype._dispatchDriver = function(callback) {
	this._pickupTimer = setTimeout(this._passPickupToNextAvailableDriver.bind(this), PICKUP_TIMEOUT);

	this.driver.dispatch(this.client, this, function(err){
		// TODO: Если ошибка посылки Pickup запроса, то сразу отменять таймер и передавать следующему ближайшему водителю
		// Иначе пройдет 15 секунд и только после этого запрос передасться другому водителю
		if (err) console.log(err);
		if (typeof callback === 'function') callback(err);
	});
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
	return ['id', 'clientId', 'driverId', 'state', 'pickupLocation', 'dropoffLocation', 'pickupTimestamp', 'dropoffTimestamp', 'driverRating', 'clientRating', 'fareBilledToCard', 'canceledDriverIds', 'route', 'estimatedArrivalTime', 'actualArrivalTime', 'confirmTimestamp', 'arrivalTimestamp'];
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

	async.series({
		// save trip
		saveTrip: repository.save.bind(repository, this),
		// dispatch to nearest available driver
		dispatchDriver: this._dispatchDriver.bind(this),
		// update and save client
		replyToClient: this.client.pickup.bind(this.client, clientContext, this)
	}, function(err, result){
		callback(err, result.replyToClient);
	});
}

// Водитель подтвердил заказ. Известить клиента что водитель в пути
Trip.prototype.confirm = function(driverContext, callback) {
	if (this.driver.state !== Driver.DISPATCHING) return callback(new Error('Unexpected Pickup confirmation'));

	this.confirmTimestamp = timestamp();
	this.estimatedArrivalTime = this.driver.etaMinutes * 60; // convert to seconds
	this._clearPickupTimeout();

	async.series({
		driverResult: this.driver.confirm.bind(this.driver, driverContext),
		ignore1: this.client.confirm.bind(this.client),
		ignore2: this.save.bind(this)
	},
		function(err, results) {
			callback(null, results && results.driverResult);
		}
	);
}

// Водитель в пути, обновляет координаты
Trip.prototype.driverEnroute = function(driverContext, callback) {
	this.driver.enroute(driverContext, function(err, result) {
		sendMessage(this.client, MessageFactory.createDriverEnroute(this));
		callback(null, result);
	}.bind(this));	
}

Trip.prototype.driverPing = function(context) {
	if (this.driver.isDrivingClient()) {
		var location = {
			latitude: context.message.latitude,
			longitude: context.message.longitude,
			horizontalAccuracy: context.message.horizontalAccuracy,
			verticalAccuracy: context.message.verticalAccuracy,
			speed: context.message.speed,
			course: context.message.course,
			timestamp: context.message.timestamp
		};

		this.route.push(location);
	}

	return this.driver.ping(context);
}

// Водитель совсем рядом или на месте. Известить клиента чтобы он выходил
Trip.prototype.driverArriving = function(driverContext, callback) {
	this.arrivalTimestamp = timestamp();
	this.actualArrivalTime = this.arrivedTimestamp - this.confirmTimestamp;

	this.driver.arriving(driverContext, function(err, result) {
		sendMessage(this.client, MessageFactory.createArrivingNow(this));
		this.save();

		callback(null, result);	
	}.bind(this));
}

// Клиент разрешил начать поездку. Известить водителя что он может начинать поездку
Trip.prototype.clientBegin = function(clientContext, callback) {
	this.state = Trip.CLIENT_BEGAN;
	this.save();

	this.client.begin(clientContext, function(err) {
		// Let driver know he can begin trip
		sendMessage(this.driver, MessageFactory.createBeginTrip(this, this.client));
		callback(null, MessageFactory.createClientOK(this.client));
	}.bind(this));
}

Trip.prototype.clientCancelPickup = function(clientContext, callback) {
	this.state = Trip.CLIENT_CANCELED;
	this._cancelDriverPickup(true);
	this._archive();

	this.client.cancelPickup(clientContext, callback);
}

// Водитель отменил Trip после подтверждения
Trip.prototype.driverCancel = function(driverContext, callback) {
	this.state = Trip.DRIVER_CANCELED;
	this._archive();

	async.parallel({
		saveTrip: this.save.bind(this),
		notifyClient: this.client.tripCanceled.bind(this.client),
		driverResponse: this.driver.cancelTrip.bind(this.driver, driverContext),
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
	this._archive();
	
	async.parallel({
		saveTrip: this.save.bind(this),
		notifyDriver: this.driver.tripCanceled.bind(this.driver),
		clientResponse: this.client.cancelTrip.bind(this.client, clientContext),
	},
		function(err, results) {
			if (err) return callback(err);
			callback(null, results.clientResponse);
		}
	);	
}

// Водитель начал поездку. Известить клиента что поездка началась
Trip.prototype.driverBegin = function(driverContext, callback) {
	this.state = Trip.DRIVER_BEGAN;
	this.pickupTimestamp = timestamp();

	async.series({
		driverResult: this.driver.begin.bind(this.driver, driverContext),
		ignore1: this.client.start.bind(this.client),
		ignore2: this.save.bind(this)
	}, 
		function(err, results) {
			callback(null, results && results.driverResult);
		}.bind(this)
	);
}

// Водитель завершил поездку. Известить клиента что поездка была завершена
Trip.prototype.driverEnd = function(driverContext, callback) {
	this.state = Trip.COMPLETED;
	this.dropoffTimestamp = timestamp();
	
	this.dropoffLocation = {
		latitude: driverContext.message.latitude,
		longitude: driverContext.message.longitude
	};

	GroundControlAPI.completeTrip(this, function(err, fare) {
		console.log('Trip ' + this.id + ' fare is ' + fare + ' руб.');
		this.fareBilledToCard = fare;
		
		this.client.end();
		this.driver.end(driverContext, callback);

	}.bind(this));
}

Trip.prototype.save = function(callback) {
	callback = callback || function(err) {
	  if (err) console.log(err);
	};

	repository.save(this, callback);
}

Trip.prototype.clientRateDriver = function(clientContext, callback) {
	this.driverRating = clientContext.rating;

	async.parallel([
		this.client.rateDriver.bind(this.client, clientContext),
		this.driver.updateRating.bind(this.driver, clientContext.rating),
		this.save.bind(this)
	], 
		function(err) {
			callback(err, MessageFactory.createClientOK(this.client));
		}.bind(this)
	);
}

// At this point driver goes back on duty
Trip.prototype.driverRateClient = function(driverContext, callback) {
	this.clientRating = driverContext.rating;

	async.parallel({
		driverResult: this.driver.rateClient.bind(this.driver, driverContext),
		ignore1: this.client.updateRating.bind(this.client, driverContext.rating),
		ignore2: this.save.bind(this)
	}, 
		function(err, results) {
			callback(null, results && results.driverResult);
		}.bind(this)
	);
}

function timestamp() {
	Math.round(Date.now() / 1000);
}

// export Trip constructor
module.exports.Trip = Trip;
module.exports.repository = repository;