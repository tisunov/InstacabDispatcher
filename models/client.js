var util = require("util"),
	User = require("./user"),
	Driver = require("./driver").Driver,
	Cache = require('../lib/cache'),
	Repository = require('../lib/repository'),
	MessageFactory = require("../messageFactory");

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

Client.prototype.login = function(context, cb) {
	console.log('Client ' + this.id + ' login');
	this.updateLocation(context);

	this.save(function(err) {
		cb(err, MessageFactory.createClientLoginOK(this));
	}.bind(this));
}

Client.prototype.logout = function(context, callback) {
	console.log('Client ' + this.id + ' logout');
	this.updateLocation(context);

	this.save(function(err) {
		callback(err, MessageFactory.createClientOK(this));
	}.bind(this));
}

// Return client state and trip if any or available vehicles nearby
Client.prototype.ping = function(context, callback) {
	this.updateLocation(context);
	this.save();

	if (this.trip) {
		callback(null, MessageFactory.createClientPing(this, this.trip, this.state === Client.PENDINGRATING));
	}
	else if (this.state === Client.LOOKING)
	{
		Driver.findAllAvaiable(function(err, vehicles) {
			callback(err, this._nearbyVehiclesToMessage(vehicles));
		}.bind(this));
	}
}

Client.prototype._nearbyVehiclesToMessage = function(vehicles) {
	if (vehicles.length === 0) {
		return MessageFactory.createNearbyVehicles(this, "Извините, нет доступных машин рядом с вами");
	}
	else {
		return MessageFactory.createNearbyVehicles(this, vehicles);
	}
}

Client.prototype.changeState = function(state) {
  User.prototype.changeState.call(this, state);
  
  if (this.state === Client.LOOKING) {
    this.clearTrip();
  }
}

//  Notify client about changes in nearby vehicles
Client.prototype.updateNearbyDrivers = function(callback) {
	console.log('Update nearby drivers for client ' + this.id + ', connected: ' + this.connected + ', state: ' + this.state);

	if (!this.connected || this.state !== Client.LOOKING) return;

	Driver.findAllAvaiable(function(err, vehicles) {
		this.send(this._nearbyVehiclesToMessage(vehicles), callback);
	}.bind(this));
}

Client.prototype.pickup = function(context, trip, callback) {
	this.updateLocation(context);
	this.changeState(Client.DISPATCHING);
	this.setTrip(trip);

	this.save(function(err) {
		callback(err, MessageFactory.createClientOK(this));
	}.bind(this));
}

Client.prototype.confirm = function(callback) {
	this.changeState(Client.WAITINGFORPICKUP);
	this.send(MessageFactory.createPickupConfirm(this, this.trip));
	this.save(callback);
}

// Client pressed 'Begin Trip' confirming that he is in the car
Client.prototype.begin = function(context, callback) {
	this.updateLocation(context);
	this.save(callback);
}

// Driver pressed 'Begin Trip' to start trip
Client.prototype.start = function(callback) {
	this.changeState(Client.ONTRIP);
	this.send(MessageFactory.createTripStarted(this, this.trip));
	this.save(callback);
}

Client.prototype.end = function(callback) {
	this.changeState(Client.PENDINGRATING);
	this.send(MessageFactory.createClientEndTrip(this, this.trip))
	this.save(callback);
}

// Client explicitly canceled pickup
Client.prototype.cancelPickup = function(context, callback) {
	this.updateLocation(context);
	this.changeState(Client.LOOKING);

	this.save(function(err) {
		callback(err, MessageFactory.createClientOK(this));
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
	this.updateLocation(context);
	this.changeState(Client.LOOKING);
	this.save(function(err) {
		callback(err, MessageFactory.createClientOK(this));
	}.bind(this));
}

// Notify client that driver canceled trip
Client.prototype.tripCanceled = function(callback) {
	this.changeState(Client.LOOKING);
	this.send(MessageFactory.createClientTripCanceled(this, "У водителя возникли проблемы в дороге и он вынужден был отменить ваш заказ."));
	this.save(callback);
}

Client.prototype.save = function(callback) {
	callback = callback || function(err) {
		if (err) console.log(err);
	};
	repository.save(this, callback);	
}

Client.prototype.rateDriver = function(context, callback) {
	this.updateLocation(context);
	this.changeState(Client.LOOKING);
	this.save(callback);
}

Client.prototype.updateRating = function(rating, callback) {
	User.prototype.updateRating.call(this, rating);
	this.save(callback);
}

Client.findByToken = function(context, callback) {
	var client = cache.get(context.message.token);
	if (!client) {
		return callback(new Error(context.message.app + " token " + context.message.token + " not found"));
	}

	callback(null, client);
}

// export Client constructor
module.exports.Client = Client;
module.exports.repository = repository;