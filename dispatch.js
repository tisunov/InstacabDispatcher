var async = require('async'),
	util = require('util'),
	inspect = require('util').inspect,
	GroundControlAPI = require('./groundControlApi'),
	Trip = require("./models/trip").Trip,
	tripRepository = require('./models/trip').repository,
	driverRepository = require('./models/driver').repository,
	clientRepository = require('./models/client').repository,
	Driver = require("./models/driver").Driver,
	Client = require("./models/client").Client,
	MessageFactory = require("./messageFactory");

function Dispatcher() {
	
}

Dispatcher.prototype = {
	Login: function(context, callback) {
		async.waterfall([
			function(nextFn) {
				GroundControlAPI.loginClient(context.message.email, context.message.password, nextFn);
			},
			function(client, nextFn) {
				client.login(context, nextFn);
			}
		], callback);
	},
	
	LogoutClient: function(context, callback) {
		async.waterfall([
			clientRepository.get.bind(clientRepository, context.message.id),

			function(client, nextFn) {
				client.logout(context, nextFn);
			}
		], callback);
	},

	PingClient: function(context, callback) {
		async.waterfall([
			clientRepository.get.bind(clientRepository, context.message.id),

			function(client, nextFn) {
				client.ping(context, nextFn);
			}
		], callback);
	},

	Pickup: function(context, callback) {
		async.waterfall([
			clientRepository.get.bind(clientRepository, context.message.id),

			function(client, next) {
				Driver.findFirstAvailable(client, function(err, driver){
					next(err, client, driver);
				});
			},
			function(client, driver, next) {
				var trip = new Trip();
				trip.pickup(driver, client, context, next);
			}
		], callback);
	},
	
	BeginTripClient: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.clientBegin(context, callback);
		});
	},

	// Client canceled pickup request while we were searching/waiting for drivers
	CancelPickupClient: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.clientCancelPickup(context, callback);
		});
	},

	// Client canceled trip after driver was dispatched and before trip start
	CancelTripClient: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.clientCancel(context, callback);
		});
	},

	RateDriver: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.clientRateDriver(context, callback);
		});
	},

	LoginDriver: function(context, callback) {
		async.waterfall([
			function(nextFn) {
				GroundControlAPI.loginDriver(context.message.email, context.message.password, nextFn);
			},
			function(driver, nextFn) {
				this._subscribeToDriverEvents(driver);
				driver.login(context, nextFn);
			}.bind(this),
		], callback);
	},

	LogoutDriver: function(context, callback) {
		driverRepository.get(context.message.id, function(err, driver) {
			if (err) return callback(err, null);

			driver.logout(context, callback);
		});
	},

	PingDriver: function(context, callback) {
		// find trip and keep driver gps log in trip
		if (context.message.tripId) {
			tripRepository.get(context.message.tripId, function(err, trip) {
				if (err) return callback(err);

				callback(null, trip.driverPing(context));
			});
		}
		else {
			driverRepository.get(context.message.id, function(err, driver) {
				if (err) return callback(err);

				callback(null, driver.ping(context))
			})
		}
	},

	Enroute: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.driverEnroute(context, callback);
		});
	},

	// TODO: Сделать чтобы приложение водителя посылало Ping/VehicleMoved переодически, либо при существенной смене позиции
	//  Это нужно чтобы клиенты видели положение автомобилей и время прибытия ближайшего водителя
	// TODO: У меня уже есть Ping сообщение оно может исполнять эту роль и посылаться в Available при смещении машины больше чем на 1 метр
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
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.confirm(context, callback);
		});
	},

	ArrivingNow: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.driverArriving(context, callback);
		});
	},

	BeginTripDriver: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.driverBegin(context, callback);
		});
	},

	CancelTripDriver: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.driverCancel(context, callback);
		});
	},
	
	EndTrip: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip) {
			if (err) return callback(err);

			trip.driverEnd(context, callback);
		});
	},

	RateClient: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.driverRateClient(context, callback);
		});
	}
}

function responseWithError(text){
	console.log(text);
	this.send(JSON.stringify(MessageFactory.createError(text)));
}

Dispatcher.prototype._parseJSONData = function(data, connection) {
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

Dispatcher.prototype._findMessageHandler = function(message, connection) {
	if (message.app !== 'client' && message.app !== 'driver') {
		return responseWithError.call(connection, 'Unknown client app: ' + message.app);
	}

	var handler = this.__proto__[message.messageType];
	if (!handler) {
		return responseWithError.call(connection, 'Unsupported message type: ' + message.messageType);
	}

	return handler;
}

// Update all clients except the one requested pickup
Dispatcher.prototype._clientsUpdateNearbyDrivers = function(clientRequestedPickup) {
	var skipClientId = clientRequestedPickup ? clientRequestedPickup.id : null;

	clientRepository.each(function(client) {
		if (client.id === skipClientId) return;

		client.updateNearbyDrivers(function(err){
			if (err) console.log(err);
		});
	});
}

Dispatcher.prototype._subscribeToDriverEvents = function(driver) {
	var eventCallback = this._clientsUpdateNearbyDrivers.bind(this);
	driver
		.on('connect', eventCallback)
		.on('disconnect', eventCallback)
		.on('available', eventCallback)
		.on('unavailable', eventCallback);
}

Dispatcher.prototype.load = function(callback) {
	var self = this;
	async.parallel({
		drivers: driverRepository.all.bind(driverRepository),
		clients: clientRepository.all.bind(clientRepository),
		trips: tripRepository.all.bind(tripRepository)
	},
	function(err, result){
		async.parallel([
			function(next) {
				console.log('Loaded ' + result.drivers.length + ' driver(s)');
				async.each(result.drivers, function(driver, cb){
					self._subscribeToDriverEvents(driver);
					driver.load(cb);
				}, next);
			},
			function(next) {
				console.log('Loaded ' + result.clients.length + ' client(s)');
				async.each(result.clients, function(client, cb){
					client.load(cb);
				}, next);
			},
			function(next) {
				console.log('Loaded ' + result.trips.length + ' trip(s)');
				async.each(result.trips, function(trip, cb){
					trip.load(function(err) {
						if (err) console.log('Error loading trip ' + trip.id + ':' + err);
						cb()
					});
				}, next);
			}

		], callback);
	});
}

Dispatcher.prototype.processMessage = function(data, connection) {
	console.log("Process message");

	var message;
	if (!(message = this._parseJSONData(data, connection))) return;

	console.log(util.inspect(message, {depth: 3, colors: true}));

	// Find message handler
	var messageHandler;
	if (!(messageHandler = this._findMessageHandler(message, connection))) return;

	// Handle message
	// returns: RPC response message
	messageHandler.call(this, {message: message, connection: connection}, function(err, result) {
		if(err) {
			console.log(err.stack);
			return responseWithError.call(connection, err.message);
		}

		console.log('Sending response');
		console.log(util.inspect(result, {depth: 3, colors: true}));

		// Send response
		connection.send(JSON.stringify(result), function(err) {
			if (err) return console.log(err);
		});
	});
}

module.exports = Dispatcher;