var MessageFactory = require("../messageFactory"),
	LatLon = require('../latlon'), 
	util = require("util"),
	async = require("async"),
	User = require("./user"),
	DRIVER_STATE = require("./constants").DRIVER_STATE,
	Schema = require("../config").schema,
	Store = require('../store').Store;

var Driver = Schema.define('Driver', {
    firstName:    String,
    email:    	  String,
    token:    	  String,
    mobile:    	  String,
    rating:       Number,
    state:    	  String,
    longitude: 	  Number,
    latitude: 	  Number
});

util.inherits(Driver, User);
var store = new Store(Driver, 'token');

// Update state to Available only if driver has signed out before
function makeAvailable() {
	var offDuty = !this.state || this.state === DRIVER_STATE.OFF_DUTY
	if (offDuty) {
		this.updateState(DRIVER_STATE.AVAILABLE);
	}
}

// Initialize new instance
Driver.afterInitialize = function(next) {
	User.call(this, DRIVER_STATE.OFF_DUTY);
}

Driver.prototype.login = function(context, cb) {
	this.update(context);
	console.log('Driver ' + this.id + ' logged in: ' + this.state + ' connected: ' + this.connected);
	makeAvailable.call(this);

	store.set(this.id, this, function(err, storeReply) {
		if (err) return cb(err, null);
		cb(null, MessageFactory.createDriverLoginOK(this));
	}.bind(this));
}

Driver.prototype.logout = function(context, cb) {
	console.log('Driver ' + this.id + ' went off duty');
	this.update(context);
	this.updateState(DRIVER_STATE.OFF_DUTY);

	cb(null, MessageFactory.createDriverOK(this));
}

Driver.prototype.ping = function(context, trip) {
	this.update(context);
	if (this.state === DRIVER_STATE.AVAILABLE) {
		return MessageFactory.createDriverPing(this);
	}
	else {
		return MessageFactory.createDriverPing(this, trip);
	}
}

Driver.prototype.distanceTo = function(lat, lon) {
	// FIXME: Оптимизировать позже
	return new LatLon(this.lat, this.lon).distanceTo(new LatLon(lat, lon), 4);
}

Driver.getByToken = function(token) {
	return store.get(token);
}

function isOnlineAndAvailable() {
	return this.connected && this.state === DRIVER_STATE.AVAILABLE;
}

Driver.findAllAvaiable = function(client, callback) {
	async.waterfall([
		// select available
		function(nextFn) {
			store.filter(
				function(driver, cb) {
					cb(isOnlineAndAvailable.call(driver));
				},
				// bind context and err parameter to null
				nextFn.bind(null, null)
			);
		},
		// TODO: Можно посчитать расстояние до каждого водителя чтобы потом показать примерное время прибытия
		// водителя перед тем как Клиент закажет машину
		function(availableDrivers, nextFn) {
			async.map(
				availableDrivers,
				function(driver, cb) {
					cb(null, { id: driver.vehicleId, longitude: driver.lon, latitude: driver.lat });
				},
				nextFn
			);
		}],

		function(err, results){
			callback(null, MessageFactory.createNearbyVehicles(client, results));
		}
	);
}

Driver.findAllAvailableOrderByDistance = function(client, callback) {
	if (store.count() == 0) return callback(new Error("No drivers available"), null);

	async.waterfall([
		// select available
		function(nextFn) {
			store.filter(
				function(driver, cb) {
					console.log('Driver ' + driver.id + ' ' + driver.state + ' connected: ' + driver.connected);
					cb(isOnlineAndAvailable.call(driver));
				},
				// bind context and err parameter to null
				nextFn.bind(null, null)
			);
		},
		// find distance to each driver
		function(availableDrivers, nextFn) {
			console.log('Available and connected drivers:');
			console.log(availableDrivers);
			if (availableDrivers.length === 0) return nextFn(new Error('No available drivers found'));

			async.map(
				availableDrivers,
				function(driver, cb) {
					var distanceToDriver = driver.distanceTo(client.lat, client.lon);
					cb(null, { driver: driver, distanceKm: distanceToDriver });
				}, 
				nextFn
			);			
		},
		// order drivers by distance
		function(driversAndDistances, nextFn) {	
			async.sortBy(
				driversAndDistances, 
				function(item, cb) { 
					cb(null, item.distanceKm) 
				},
				nextFn
			);
		}
	], callback);	
}

Driver.findOneAvailable = function(client, callback) {
	Driver.findAllAvailableOrderByDistance(client, function(err, driversWithDistance){
		if (err) return callback(err);

		console.log('Drivers in ascending order by distance from the client:');
		console.log(driversWithDistance);

		// TODO: Возможно вернуть вместе с расстоянием чтобы посчитать время прибытия
		callback(null, driversWithDistance[0].driver);		
	});
}

// export Driver constructor
module.exports = Driver;