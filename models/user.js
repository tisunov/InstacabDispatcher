var WebSocket = require('ws'),
	util = require('util'),
	events = require('events');

function User(initialState) {
	this.connected = false;
	this.state = initialState;
}

/**
 * Inherits from EventEmitter.
 */

util.inherits(User, events.EventEmitter);

User.prototype.getLocation = function() {
	return {
		longitude: this.lon,
		latitude: this.lat
	}
}

User.prototype.setTrip = function(val) {
	if (val) {
		this.tripId = val.id;
	}
	else {
		delete this.tripId;
	}
}

User.prototype.hasTrip = function() {
	return this.tripId !== null && this.tripId !== undefined; 
}

// THINK: Складывать в буфер сообщения которые не были посланы или просто сказать запросившему
// посылку что была ошибка и пусть она сам позже пробует еще?
User.prototype.send = function(message, callback) {
	if (this.connection.readyState !== WebSocket.OPEN) {
		return callback(new Error(this.constructor.name + ' ' + this.id + ' not connected'));
	}

	console.log('Sending ' + message.messageType + ' to ' + this.constructor.name);
	console.log(message);

	this.connection.send(JSON.stringify(message), function(err) {
		if (err) {
			return callback(new Error('Failed to send message to ' + this.constructor.name + ' ' + this.id), null);
		}

		callback(null);
	});
}

User.prototype._connectionClosed = function() {
	console.log(this.constructor.name + ' ' + this.id + ' disconnected');
	console.log(this.constructor.name + ' ' + this.id + ' connection readyState: ' + this.connection.readyState);
	
	this.connected = false;
	this.emit('disconnect');
}

User.prototype._connectionError = function() {
	console.log(this.constructor.name + ' ' + this.id + ' connection error');
}

User.prototype.update = function(context) {
	this.lat = context.message.latitude;
	this.lon = context.message.longitude;

	var isNewConnection = this.connection !== context.connection;
	if (isNewConnection) {
		console.log(this.constructor.name + ' ' + this.id + ' connected');

		this.connected = context.connection.readyState === WebSocket.OPEN;
		this.connection = context.connection;
		this.connection.once('close', this._connectionClosed.bind(this));
		this.connection.once('error', this._connectionError.bind(this));
	}
}

User.prototype.changeState = function(state) {
	console.log('Change ' + this.constructor.name + ' ' + this.id + ' state from ' + this.state + ' to ' + state);
	this.state = state;
};

// Supposes that initial rating is set to maximum possible
User.prototype.updateRating = function(rating) {
	this.rating = (this.rating + rating) / 2.0;
}

module.exports = User;