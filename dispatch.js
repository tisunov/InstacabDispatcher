var async = require('async'),
	inspect = require('util').inspect,
	BusinessLogic = require('./businessLogic'),
	Trip = require("./models/trip"),
	Driver = require("./models/driver"),
	Client = require("./models/client"),
	MessageFactory = require("./messageFactory");

function findClientByToken(context, callback) {
	var client = Client.getByToken(context.message.token);
	if (!client) {
		return callback(new Error("Client token " + context.message.token + " not found"), null);
	}

	callback(null, client);
}

function findDriverByToken(context, callback) {
	var client = Driver.getByToken(context.message.token);
	if (!client) {
		return callback(new Error("Driver token " + context.message.token + " not found"), null);
	}

	callback(null, client);
}

function tripNotFoundError(context) {
	return new Error("Trip id " + context.message.tripId + " not found");
}

// Remote Procedure Call Handlers
var RPC = {
	client: {
		Login: function(context, callback) {
			async.waterfall([
				function(nextFn) {
					BusinessLogic.loginClient(context.message.email, nextFn);
				},
				function(client, nextFn) {
					client.login(context, nextFn);
				}
			], callback);
		},
		
		PingClient: function(context, callback) {
			async.waterfall([
				function(nextFn) {
					findClientByToken(context, nextFn);
				},
				function(client, nextFn) {
					client.ping(context);
					Driver.findAllAvaiable(client, nextFn);
				}
			], callback);
		},

		Pickup: function(context, callback) {
			async.waterfall([
				function(nextFn) {
					findClientByToken(context, nextFn);
				},
				function(client, nextFn) {
					Driver.findOneAvailable(client, function(err, driver){
						nextFn(err, client, driver);
					});
				},
				function(client, driver, nextFn) {
					// keeping track of trip
					var trip = new Trip(driver, client);
					trip.pickup(context, nextFn);
				}
			], callback);
		},
		
		BeginTripClient: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);
			
			trip.clientBegin(context, callback);
		},

		PickupCanceledClient: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);
			
			trip.clientPickupCanceled(context, callback);
		}
	},

	RateDriver: function(context, callback) {
		var trip = Trip.getById(context.message.tripId);
		if (!trip) return callback(tripNotFoundError(context), null);

		trip.clientRateDriver(context, callback);
	},

	driver: {
		LoginDriver: function(context, callback) {
			async.waterfall([
				function(nextFn) {
					BusinessLogic.loginDriver(context.message.email, nextFn);
				},
				function(driver, nextFn) {
					driver.login(context, nextFn);						
				}
			], callback);
		},

		LogoutDriver: function(context, callback) {
			findDriverByToken(context, function(err, driver) {
				if (err) return callback(err, null);

				driver.logout(context, callback);
			});			
		},

		PingDriver: function(context, callback) {
			async.waterfall([
				function(nextFn) {
					findDriverByToken(context, nextFn);
				},
				function(driver, nextFn) {
					if (driver.hasTrip()) {
						var trip = Trip.getForDriver(driver);
						nextFn(null, driver.ping(context, trip));
					}
					else {
						nextFn(null, driver.ping(context));						
					}
				}
			], callback);
		},

		Enroute: function(context, callback) {
			if (context.message.tripId) {
				var trip = Trip.getById(context.message.tripId);
				if (!trip) return callback(tripNotFoundError(context), null);

				trip.driverEnroute(context, callback);
			}
		},

		// var message = MessageFactory.createVehicleMoved({
		// 		id: driver.id,
		// 		longitude: driver.lon,
		// 		latitude: driver.lat
		// 	});

		// Client.forEach(function updateVehiclePosition(client){
		// 	client.send(message, function(err){
		// 		if (err) console.log(err);
		// 	});
		// })

		ConfirmPickup: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);

			trip.confirm(context, callback);
		},

		PickupCanceledDriver: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);

			trip.driverPickupCanceled(context, callback);
		},

		ArrivingNow: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);

			trip.driverArriving(context, callback);
		},

		BeginTripDriver: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);

			trip.driverBegin(context, callback);
		},
		
		EndTrip: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);

			trip.end(context, callback);
		},

		RateClient: function(context, callback) {
			var trip = Trip.getById(context.message.tripId);
			if (!trip) return callback(tripNotFoundError(context), null);

			trip.driverRateClient(context, callback);
		}
	}
}

function Dispatcher() {
	
}

function responseWithError(text){
	console.log(text);
	this.send(JSON.stringify(MessageFactory.createError(text)));
}

function parseJSONData(data, connection) {
	var message;
	try {
	  message = JSON.parse(data);
	}
	catch(e) {
	  console.log(e);
	  responseWithError.call(connection, e.message);
	}

	return message;
}

function findMessageHandler(message, connection) {
	if (message.app !== 'client' && message.app !== 'driver') {
		return responseWithError.call(connection, 'Unknown client app: ' + message.app);
	}

	var messageHandlers = RPC[message.app];
	var handler = messageHandlers[message.messageType];
	if (!handler) {
		return responseWithError.call(connection, 'Unsupported message type: ' + message.messageType);
	}

	return handler;
}

Dispatcher.prototype.processMessage = function(data, connection) {
	console.log("Process message");
	console.log(data);

	var message;
	if (!(message = parseJSONData(data, connection))) return;

	// Find message handler
	var messageHandler;
	if (!(messageHandler = findMessageHandler(message, connection))) return;

	// Handle message
	// returns: RPC response message
	messageHandler({message: message, connection: connection}, function(err, result){
		if(err) {
			console.log(err.stack);
			return responseWithError.call(connection, err.message);
		}

		console.log('Send response');
		console.log(result);

		// Send response
		connection.send(JSON.stringify(result), function(err) {
			if (err) return console.log(err);
		});
	});
}

module.exports = Dispatcher;