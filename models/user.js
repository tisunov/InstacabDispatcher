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
}

util.inherits(User, EventEmitter);

User.prototype.getSchema = function() {
	return ['id', 'firstName', 'email', 'token', 'mobile', 'rating', 'state', 'location', 'tripId'];
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

User.prototype.send = function(message, callback) {
	callback = callback || function(err) {
		if (err) console.log(err);
	};

	if (!this.connection || this.connection.readyState !== WebSocket.OPEN) {
		return callback(new Error(this.constructor.name + ' ' + this.id + ' is not connected'));
	}

	console.log('Sending ' + message.messageType + ' to ' + this.constructor.name + ' ' + this.id);
	console.log(util.inspect(message, {depth: 3, colors: true}));

	this.connection.send(JSON.stringify(message), function(err) {
		if (err) {
			return callback(new NetworkError('Failed to send message to ' + this.constructor.name + ' ' + this.id, err));
		}

		callback(null);
	});
}

User.prototype.disconnect = function() {
	if (this.connection && this.connection.readyState === WebSocket.OPEN) {
		this.connection.close();
	}
}

User.prototype._connectionClosed = function() {
	console.log(this.constructor.name + ' ' + this.id + ' disconnected');
	
	this.connected = false;
	this.emit('disconnect', this);
	this.publish();
}

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

User.prototype._setConnection = function(connection) {
	var isNewConnection = this.connection !== connection;
	if (isNewConnection) {
		console.log(this.constructor.name + ' ' + this.id + ' connected');

		this.connected = connection.readyState === WebSocket.OPEN;
		this.connection = connection;
		this.connection.once('close', this._connectionClosed.bind(this));
		this.connection.once('error', this._connectionError.bind(this));

		this.emit('connect', this);
		this.publish();
	}	
}

User.prototype.isTokenValid = function(context) {
	return context.message.token && context.message.token === this.token;
}

// User.prototype.validateToken = function(context, callback) {
// 	callback(this.isTokenValid(context) ? null : new Error("Неверный token"));
// }

User.prototype.updateLocation = function(context) {
	var newLocation = { latitude: context.message.latitude, longitude: context.message.longitude };

	var locationChanged = !this.location || !isEqualLocations(this.location, newLocation);
	this.location = newLocation;

	// Notify observers when location changed
	if (locationChanged) {
		this.emit('locationUpdate', this, newLocation);
		this.publish();
	}
	
	this._setConnection(context.connection);
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