var util = require("util"),
	User = require("./user"),
	Driver = require("./driver").Driver,
	Cache = require('../lib/cache'),
	Repository = require('../lib/repository'),
	MessageFactory = require("../messageFactory"),
	geofence = require("../lib/geofence");

function Client() {
	User.call(this, Client.LOOKING);	
}

util.inherits(Client, User);

var repository = new Repository(Client);

/**
 * Client States
 */

['Looking', 'Dispatching', 'WaitingForPickup', 'OnTrip', 'PendingRating'].forEach(function (readableState, index) {
	var state = readableState.toUpperCase();
  Client.prototype[state] = Client[state] = readableState;
});

function _generateOKResponse(includeToken, callback) {
	if (this.trip) {
		var options = {
			includeToken: includeToken,
			trip: this.trip,
			tripPendingRating: this.state === Client.PENDINGRATING
		}
		callback(null, MessageFactory.createClientOK(this, options));
	}
	else if (this.state === Client.LOOKING) {
		this._updateNearbyDrivers({includeToken: includeToken}, callback);
	}
}

Client.prototype.getSchema = function() {
  var props = User.prototype.getSchema.call(this);
  props.push('paymentProfile');
  return props;
}

Client.prototype.login = function(context, callback) {
	console.log('Client ' + this.id + ' login');
	this.updateLocation(context);
	
	this.save(function(err) {
		_generateOKResponse.call(this, true, callback);
	}.bind(this));
}

Client.prototype.logout = function(context, callback) {
	Client.super_.prototype.validateToken.call(this, context, function(err) {
		if (err) return callback(err);

		console.log('Client ' + this.id + ' logout');
		this.updateLocation(context);
		this.token = null;

		this.save(function(err) {
			callback(err, MessageFactory.createClientOK(this));
		}.bind(this));

	}.bind(this));
}

// Return client state and trip if any or available vehicles nearby
Client.prototype.ping = function(context, callback) {
	Client.super_.prototype.validateToken.call(this, context, function(err) {
		if (err) return callback(err);

		this.updateLocation(context);
		this.save();

		_generateOKResponse.call(this, false, callback);
	}.bind(this));
}

Client.prototype.changeState = function(state) {
  User.prototype.changeState.call(this, state);
  
  if (this.state === Client.LOOKING) {
    this.clearTrip();
  }
}

// TODO: Обновилась позиция всего одного водителя и не нужно пересчитывать расстояние и время прибытия
// всех остальных
//  Notify client about changes in nearby vehicles
Client.prototype.updateNearbyDrivers = function(callback) {
	if (!this.connected || this.state !== Client.LOOKING) return;
	
	console.log('Update nearby drivers for client ' + this.id + ', connected: ' + this.connected + ', state: ' + this.state);
	this._updateNearbyDrivers({}, function(err, response) {
		this.send(response, callback);
	}.bind(this));
}

Client.prototype._updateNearbyDrivers = function(options, callback) {
	if (!Client.canRequestToLocation(this.location)) {
		options.restrictedArea = true;
		return callback(null, MessageFactory.createClientOK(this, options));
	}

	Driver.findAllAvailableNearLocation(this.location, function(err, vehicles) {
		options.vehicles = vehicles;
		callback(err, MessageFactory.createClientOK(this, options));
	}.bind(this));
}

Client.prototype.pickup = function(context, trip, callback) {
	this.updateLocation(context);	
	this.setTrip(trip);
	// Change state causes event to be published which reads this.trip, so it has to be set prior to that
	this.changeState(Client.DISPATCHING);

	this.save(function(err) {
		callback(err, MessageFactory.createClientDispatching(this, this.trip));
	}.bind(this));
}

Client.prototype.confirm = function(callback) {
	this.changeState(Client.WAITINGFORPICKUP);
	this.send(MessageFactory.createClientOK(this, { trip: this.trip} ));
	this.save(callback);
}

// Driver pressed 'Begin Trip' to start trip
Client.prototype.start = function(callback) {
	this.changeState(Client.ONTRIP);
	this.send(MessageFactory.createTripStarted(this, this.trip));
	this.save(callback);
}

Client.prototype.driverEnroute = function(callback) {
	if (this.trip) {
		this.send(MessageFactory.createClientDriverEnroute(this.trip));
	}
}

Client.prototype.end = function(callback) {
	this.changeState(Client.PENDINGRATING);
	this.send(MessageFactory.createClientEndTrip(this, this.trip))
	this.save(callback);
}

// Client explicitly canceled pickup
Client.prototype.cancelPickup = function(context, callback) {
	Client.super_.prototype.validateToken.call(this, context, function(err) {
		if (err) return callback(err);

		this.updateLocation(context);
		this.changeState(Client.LOOKING);

		this.save(function(err) {
			callback(err, MessageFactory.createClientOK(this));
		}.bind(this));

	}.bind(this));
}

// Notify client that pickup request was canceled
Client.prototype.pickupCanceled = function(reason) {
 	console.log('Cancel client ' + this.id + ' pickup');

	this.changeState(Client.LOOKING);
	this.save();
	this.send(MessageFactory.createClientPickupCanceled(this, reason));
}

// Client explicitly canceled trip
Client.prototype.cancelTrip = function(context, callback) {
	Client.super_.prototype.validateToken.call(this, context, function(err) {
		if (err) return callback(err);

		this.updateLocation(context);
		this.changeState(Client.LOOKING);
		this.save(function(err) {
			callback(err, MessageFactory.createClientOK(this));
		}.bind(this));

	}.bind(this));
}

// Notify client that driver canceled trip
Client.prototype.tripCanceled = function(callback) {
	this.changeState(Client.LOOKING);
	this.send(MessageFactory.createClientTripCanceled(this, "Водитель вынужден был отменить ваш заказ."));
	this.save(callback);
}

Client.prototype.save = function(callback) {
	callback = callback || function(err) {
		if (err) console.log(err);
	};
	repository.save(this, callback);
}

Client.prototype.rateDriver = function(context, callback) {
	Client.super_.prototype.validateToken.call(this, context, function(err) {
		if (err) return callback(err);

		this.updateLocation(context);

		require('../backend').rateDriver(this.trip.id, context.message.rating, context.message.feedback, function() {
			this.changeState(Client.LOOKING);
			this.save(callback);
		}.bind(this));

	}.bind(this));
}

Client.prototype.toJSON = function() {
  var obj = User.prototype.toJSON.call(this);
  if (this.trip) {
    obj.pickupLocation = this.trip.pickupLocation;
  }
  return obj;
}

Client.publishAll = function() {
  repository.all(function(err, user) {
    user.forEach(function(user) {
      user.publish();
    });
  });
}

Client.canRequestToLocation = function(location) {
	return true;
	//return geofence.isLocationAllowed(location);
}

// export Client constructor
module.exports.Client = Client;
module.exports.repository = repository;