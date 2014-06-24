var WebSocket = require('ws'),
		util = require('util'),
		EventEmitter = require('events').EventEmitter,
		assert = require('assert'),
		publisher = require('../publisher');

// Create a new object, that prototypally inherits from the Error constructor
function NetworkError(message, socketError) {
  this.name = "NetworkError";
  this.message = message || "Default Message";
  this.socketError = socketError;
}

NetworkError.prototype = new Error();
NetworkError.prototype.constructor = NetworkError;

/** User
 *
 */

function User(defaultState) {
	EventEmitter.call(this);
	
	this.connected = false;
	this.state = defaultState;
	this.channelName = 'channel:' + this.constructor.name.toLowerCase() + 's';

	this._onConnectionClosed = this._connectionClosed.bind(this);
	this._onConnectionError = this._connectionError.bind(this);
}

util.inherits(User, EventEmitter);

User.prototype.getSchema = function() {
	return ['id', 'firstName', 'lastName', 'email', 'token', 'deviceId', 'mobile', 'rating', 'state', 'location', 'tripId', 'isAdmin'];
}

User.prototype.load = function(callback) {
	if (this.tripId) {
		require('./trip').repository.get(this.tripId, function(err, trip){
			this.trip = trip;
			callback(err);
		}.bind(this));
	}
	else
		callback();
}

User.prototype.setTrip = function(trip) {
	this.trip = trip;
	this.tripId = trip.id;
}

User.prototype.clearTrip = function() {
	this.trip = null;
	this.tripId = null;
}

User.prototype.send = function(message) {
	if (!this.connection || this.connection.readyState !== WebSocket.OPEN) {
		console.log(this.constructor.name + ' ' + this.id + ' is not connected');
		return;
	}

	console.log('Sending ' + message.messageType + ' to ' + this.constructor.name + ' ' + this.id);
	console.log(util.inspect(message, {depth: 3}));

	this.connection.send(JSON.stringify(message));
}

User.prototype.disconnect = function() {
	if (this.connection && this.connection.readyState === WebSocket.OPEN) {
		this.connection.close();
	}

	this.connection = null;
}

User.prototype._connectionClosed = function() {
	console.log(this.constructor.name + ' ' + this.id + ' disconnected');
	
	this.connected = false;
	// cleanup
	if (this.connection) {
		this.connection.removeListener('error', this._onConnectionError);
		this.connection.removeListener('close', this._onConnectionClosed);
	}
	this.connection = null;

	this.onDisconnect();

	this.emit('disconnect', this);
	this.publish();
}

User.prototype.onDisconnect = function () {}

User.prototype.publish = function() {
	publisher.publish(this.channelName, JSON.stringify(this));
}

User.prototype._connectionError = function() {
	console.log(this.constructor.name + ' ' + this.id + ' connection error');
}

function isEqualLocations(oldLocation, newLocation) {
	return oldLocation.latitude === newLocation.latitude &&
		   oldLocation.longitude === newLocation.longitude;
}

User.prototype._setConnection = function(connection, deviceId) {
	var isNewConnection = this.connection !== connection;
	if (!isNewConnection) return;

	console.log(this.constructor.name + ' ' + this.id + ' connected');

	// use device id to prevent double login
	this.deviceId = deviceId;
	this.connected = connection.readyState === WebSocket.OPEN;

	// subscribe to connection events
	connection.once('close', this._onConnectionClosed);
	connection.once('error', this._onConnectionError);

	// keep connection to send messages later
	if (this.connection) delete this.connection;
	this.connection = connection;

	this.emit('connect', this);
	this.publish();
}

User.prototype.isTokenValid = function(message) {
	return message.token && this.token && message.token === this.token;
}

User.prototype.updateLocation = function(context) {
	var newLocation = {
		epoch: context.message.epoch,
		latitude: context.message.latitude, 
		longitude: context.message.longitude,
		course: context.message.course
	};

	var locationChanged = !this.location || !isEqualLocations(this.location, newLocation);
	this.location = newLocation;

	// Notify observers when location changed
	if (locationChanged) {
		this.emit('locationUpdate', this, newLocation);
		this.publish();
	}
	
	this._setConnection(context.connection, context.message.deviceId);
}

User.prototype.changeState = function(state) {
	assert(state, 'Can not change state to ' + state);
	console.log('Change ' + this.constructor.name + ' ' + this.id + ' state from ' + this.state + ' to ' + state);
	
	var oldState = this.state;
	this.state = state;

	if (oldState !== state) {
		this.publish();
	}
};

User.prototype.update = function(userInfo) {
	Object.keys(userInfo).forEach(function(propName) {
	    this[propName] = userInfo[propName];
	}.bind(this));

	this.save();
}

User.prototype.toJSON = function() {
  return {
    id: this.id,
    name: this.firstName,
    location: this.location,
    state: this.state,
    connected: this.connected,
  };
}

module.exports = User;