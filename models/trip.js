var MessageFactory = require("../messageFactory"),
	async = require("async"),
	Uuid = require("uuid-lib"),
	DRIVER_STATE = require("./constants").DRIVER_STATE,
	CLIENT_STATE = require("./constants").CLIENT_STATE,
	Driver = require("./driver"),
	Store = require('../store').Store;

var PICKUP_TIMEOUT = 15000; // 15 secs

function Trip(driver, client) {
	this.id = Uuid.raw();
	this.client = client;
	this.canceledDriverIds = [];

	setDriver.call(this, driver);
}

var store = new Store(Trip, 'id');

function passPickupToNextAvailableDriver() {
	console.log('Driver ' + this.driver.id + ' unable or unwilling to pickup. Finding next one...');
	cancelDriverPickup.call(this, false);

	var self = this;
	Driver.findAllAvailableOrderByDistance(this.client, function(err, driversWithDistance){
		if (err) {
			console.log('Error finding available drivers');
			console.log(err);
			return cancelClientPickup.call(self);
		}

		// reject drivers that already were asked for Pickup
		async.filter(
			driversWithDistance,
			function(item, callback) {
				return hasDriverCanceledPickup.call(self, item.driver);
			},
			function(results) {
				// no available drivers left
				if (results.length == 0) {
					console.log('No more available drivers to pass Pickup request to');
					return cancelClientPickup.call(self);
				}

				setDriver.call(self, results[0].driver);
				dispatchDriver.call(self);
			}
		);
	});
}

function cancelClientPickup() {
 	console.log('Canceling client ' + this.client.id + ' pickup');

	this.client.changeState(CLIENT_STATE.LOOKING);
	sendMessage(this.client, MessageFactory.createPickupCanceled(this));
}

function setDriver(driver) {
	this.driver = driver;
	this.driver.setTrip(this);
	this.driver.once('disconnect', onDriverDisconnect.bind(this));
}

// THINK: Возможно не нужно так быстро передавать другому запрос
// Водитель может успеть за 15 секунд подсоединиться и принять заказ
function onDriverDisconnect() {
	if (this.driver.state === DRIVER_STATE.DISPATCHING) {
		clearPickupTimeout.call(this);
		passPickupToNextAvailableDriver.call(this);
	}
}

function hasDriverCanceledPickup(driver) {
	return this.canceledDriverIds.indexOf(driver.id) !== -1;
}

function cancelDriverPickup(clientCanceled) {
	this.driver.changeState(DRIVER_STATE.AVAILABLE);
	this.driver.setTrip(null);
	
	if (clientCanceled) {
		clearPickupTimeout.call(this);
		sendMessage(this.driver, MessageFactory.createPickupCanceled(this));
	}
	else {
		this.canceledDriverIds.push(this.driver.id);
	}

	this.driver.removeListener('disconnect', onDriverDisconnect.bind(this));
	this.driver = null;	
}

function clearPickupTimeout() {
	if (this._pickupTimer) {
		clearTimeout(this._pickupTimer);
		this._pickupTimer = null;
	}
}

function dispatchDriver() {
	this._pickupTimer = setTimeout(passPickupToNextAvailableDriver.bind(this), PICKUP_TIMEOUT);
	// TODO: Нужно сохранять в Redis при изменении состояния
	this.driver.changeState(DRIVER_STATE.DISPATCHING);

	// IMPROVE: Если ошибка посылки то сразу отменять таймер и передавать следующему ближайшему водителю
	sendMessage(this.driver, MessageFactory.createDriverPickup(this, this.client))
}

function sendMessage(user, message) {
	if (!user.connected) {
		return console.log("Can't send message " + message.messageType + " right away to user id " + user.id);
	}

	user.send(message, function(err) {
		// 1. Error means that app client didn't receive response for its request
		// and has to deal with that. For example it can wait for response and try to submit request again
		// 2. In case of server initiated messages error sending message might mean connection is broken and it will 
		// be disconnected, so client will connect again and request its state via Ping message
		// TODO: Возможно стоит закрывать насильно соединение если была ошибка посылки
		if (err) console.log(err);
	});
}

// Клиент запросил машину
Trip.prototype.pickup = function(clientContext, callback) {
	var self = this;

	this.client.update(clientContext);
	this.pickupLocation = clientContext.message.location;
	this.requestTimestamp = Date.now(); // Unix epoch time

	// store trip
	store.set(this.id, this, function(err, storeReply) {
		if (err) return callback(err, null);

		dispatchDriver.call(self);

		self.client.changeState(CLIENT_STATE.DISPATCHING);
		callback(null, MessageFactory.createClientOK(self.client));
	});
}

// Водитель подтвердил заказ. Известить клиента что водитель в пути
Trip.prototype.confirm = function(driverContext, callback) {
	if (this.driver.state !== DRIVER_STATE.DISPATCHING) return callback(new Error('Unexpected Pickup confirmation'));

	clearPickupTimeout.call(this);

	this.driver.update(driverContext);
	this.driver.changeState(DRIVER_STATE.ACCEPTED);
	this.client.changeState(CLIENT_STATE.WAITING_FOR_PICKUP);

	sendMessage(this.client, MessageFactory.createPickupConfirm(this));
	callback(null, MessageFactory.createDriverOK(this.driver));	
}

// Водитель в пути, обновляет координаты
Trip.prototype.driverEnroute = function(driverContext, callback) {
	this.driver.update(driverContext);
	
	sendMessage(this.client, MessageFactory.createDriverEnroute(this));
	callback(null, MessageFactory.createDriverOK(this.driver));
}

// Водитель совсем рядом или на месте. Известить клиента чтобы он выходил
Trip.prototype.driverArriving = function(driverContext, callback) {
	this.driver.update(driverContext);
	this.driver.changeState(DRIVER_STATE.ARRIVED);

	sendMessage(this.client, MessageFactory.createArrivingNow(this));
	callback(null, MessageFactory.createDriverOK(this.driver));	
}

// Клиент разрешил начать поездку. Известить водителя что он может начинать поездку
Trip.prototype.clientBegin = function(clientContext, callback) {
	this.client.update(clientContext);
	
	// Let driver know he can begin trip
	sendMessage(this.driver, MessageFactory.createBeginTrip(this, this.client));
	callback(null, MessageFactory.createClientOK(this.client));
}

Trip.prototype.clientPickupCanceled = function(clientContext, callback) {
	this.client.update(clientContext);
	this.client.changeState(CLIENT_STATE.LOOKING);

	cancelDriverPickup.call(this, true);
	callback(null, MessageFactory.createClientOK(this.client));
}

// Водитель начал поездку. Известить клиента что поездка началась
Trip.prototype.driverBegin = function(driverContext, callback) {
	this.driver.update(driverContext);
	this.driver.changeState(DRIVER_STATE.DRIVING_CLIENT);
	this.client.changeState(CLIENT_STATE.ON_TRIP);

	sendMessage(this.client, MessageFactory.createTripStarted(this));
	callback(null, MessageFactory.createDriverOK(this.driver));
}

// Водитель завершил поездку. Известить клиента что поездка была завершена
Trip.prototype.end = function(driverContext, callback) {
	this.driver.update(driverContext);
	// TODO: Можно сделать метод Driver.endTrip(this) в котором удалить текущий Trip, и добавить его в tripPendingRating
	// потом в driverRateClient удалить tripPendingRating
	// this.driver.endTrip(this);
	this.dropoffTimestamp = Date.now();

	// TODO: Послать обновленный Trip и клиенту и водителю с расчитанной (фальшивой) ценой поездки
	// и dropoffTimestamp
	sendMessage(this.client, MessageFactory.createTripEnded(this));
	callback(null, MessageFactory.createDriverOK(this.driver));
}

Trip.prototype.clientRateDriver = function(clientContext, callback) {
	this.client.update(clientContext);
	this.client.changeState(CLIENT_STATE.LOOKING);

	this.ratingGivenToDriver = clientContext.rating;
	this.driver.updateRating(clientContext.rating);

	callback(null, MessageFactory.createClientOK(this.client));
}

// At this point driver goes back on duty
Trip.prototype.driverRateClient = function(driverContext, callback) {
	console.log(driverContext.message);
	this.driver.update(driverContext);
	this.driver.changeState(DRIVER_STATE.AVAILABLE);

	this.ratingGivenToClient = driverContext.rating;
	this.client.updateRating(driverContext.rating);

	callback(null, MessageFactory.createDriverOK(this.driver));
}

Trip.prototype.beforeSave = function() {
	return {
		id: this.id,
		clientId: this.clientId,
		driverId: this.driverId,
		pickupLocation: this.pickupLocation,
		dropoffLocation: this.dropoffLocation,
		pickupTimestamp: this.pickupTimestamp,
		dropoffTimestamp: this.dropoffTimestamp,
		ratingGivenToDriver: this.ratingGivenToDriver,
		ratingGivenToClient: this.ratingGivenToClient,
		fareCharged: this.fareCharged
	}
}

Trip.getById = function(id) {
	return store.get(id);
}

Trip.getForDriver = function(driver) {
	return store.get(driver.tripId);
}

// export Trip constructor
module.exports = Trip;