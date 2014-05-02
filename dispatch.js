var async = require('async'),
	util = require('util'),
	_ = require('underscore'),
	inspect = require('util').inspect,
	apiBackend = require('./backend'),
	Trip = require("./models/trip").Trip,
	tripRepository = require('./models/trip').repository,
	driverRepository = require('./models/driver').repository,
	clientRepository = require('./models/client').repository,
	Driver = require("./models/driver").Driver,
	Client = require("./models/client").Client,
	redis = require("redis").createClient(),
	ErrorCodes = require("./error_codes"),
	DistanceMatrix = require('./lib/google-distance'),
	MessageFactory = require("./messageFactory");

function Dispatcher() {
	this.driverEventCallback = this._clientsUpdateNearbyDrivers.bind(this);
	this.channelClients = {};
	
	redis.subscribe('channel:drivers');
	redis.subscribe('channel:clients');
	redis.subscribe('channel:trips');

	// Broadcast message to clients
	redis.on('message', function(channel, message) {
		channel = channel.split(':')[1];
		if (!this.channelClients[channel]) return;

		this.channelClients[channel].forEach(function(connection){
			var data = JSON.stringify({channel: channel, data: JSON.parse(message)});
			
			try {
				connection.send(data);				
			}
			catch(e) {
				connection.close();
			};
		}, this);

	}.bind(this));	
}

Dispatcher.prototype = {
	Login: function(context, callback) {
		async.waterfall([
			function(nextFn) {
				apiBackend.loginClient(context.message.email, context.message.password, context.message.deviceId, nextFn);
			},
			function(client, nextFn) {
				client.login(context, nextFn);
			}
		], callback);
	},

	// SignUpClient: function(context, callback) {
	// 	async.waterfall([
	// 		function(nextFn) {
	// 			apiBackend.signupClient(context.message, nextFn);
	// 		},
	// 		function(client, nextFn) {
	// 			client.login(context, nextFn);
	// 		}
	// 	], callback);
	// },
	
	PingClient: function(context, callback) {
		clientRepository.get(context.message.id, function(err, client) {
			if (err) return callback(err);

			client.ping(context, callback);
		});
	},

	Pickup: function(context, callback) {
		clientRepository.get(context.message.id, function(err, client) {
			if (err) return callback(err);

			client.pickup(context, callback);
		});
	},

	// TODO: Записать в Client lastEstimatedTrip расчет поездки
	// И сохранять для каждого клиента это в базе
	SetDestination: function(context, callback) {
		var m = context.message;

		clientRepository.get(m.id, function(err, client) {
			if (err) return callback(err);

			// TODO: Учти DistanceMatrix выдает несколько вариантов маршрута
			// https://developers.google.com/maps/documentation/javascript/distancematrix
			// Нужно выбрать самый короткий по расстоянию или самый быстрый по времени
			DistanceMatrix.get(m.pickupLocation, m.destination, function(err, data) {
			  if (err) {
			  	// default to 20 minute and 9 km per trip
			    data = { durationSeconds: 20 * 60, distanceKms: 9 };
			    console.log(err);
			  }

			  var distanceKm = data.distanceKms / 1000;

			  // Time per trip with speed less than 21 km/h = 1.5 min per 5 km
			  var billedTimeLow = (distanceKm / 5) * 1.5;
			  // Use 5 minutes per 5 km during traffic
			  var billedTimeHigh = (distanceKm / 5) * 5;
			  // 500 meters for each 5 km below < 21 km/h
			  var billedDistance = distanceKm - distanceKm * 0.1;

			  // TODO: Нужно спросить Fare у Backend, или вообще перенести весь расчет в API Backend
			  var fare = { base: 50.00, per_minute: 5.0, per_km: 14.0, minimum: 140 }

			  var estimateLow = Math.round((fare.base + billedTimeLow * fare.per_minute + billedDistance * fare.per_km) / 10) * 10;
			  var estimateHigh = Math.round((fare.base + billedTimeHigh * fare.per_minute + billedDistance * fare.per_km) / 10) * 10;

			  var estimateString;

			  if (estimateHigh > fare.minimum)
			  	estimateString = estimateLow.toString() + '-' + estimateHigh.toString() + ' руб.';
			  else
			  	estimateString = fare.minimum.toString() + ' руб.';
			  
			  callback(null, MessageFactory.clientFareEstimate(client, estimateString));
			});

		});
	},
	
	// Client canceled pickup request while we were searching/waiting for drivers
	CancelPickup: function(context, callback) {
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

	RatingDriver: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.clientRateDriver(context, callback);
		});
	},

	LoginDriver: function(context, callback) {
		apiBackend.loginDriver(context.message.email, context.message.password, context.message.deviceId, function(err, driver){
			if (err) return callback(err);

			this._subscribeToDriverEvents(driver);

			callback(null, driver.login(context));	
		}.bind(this));
	},

	LogoutDriver: function(context, callback) {
		driverRepository.get(context.message.id, function(err, driver) {
			if (err) return callback(err);

			callback(null, driver.logout(context));
		});
	},

	OffDutyDriver: function(context, callback) {
		driverRepository.get(context.message.id, function(err, driver) {
			if (err) return callback(err);

			callback(null, driver.offDuty(context));
		});
	},

	OnDutyDriver: function(context, callback) {
		driverRepository.get(context.message.id, function(err, driver) {
			if (err) return callback(err, null);

			callback(null, driver.onDuty(context));
		});
	},

	PingDriver: function(context, callback) {
		driverRepository.get(context.message.id, function(err, driver) {
			if (err) return callback(err);

			callback(null, driver.ping(context));
		});
	},

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

	ListVehicles: function(context, callback) {
		driverRepository.get(context.message.id, function(err, driver) {
			if (err) return callback(err);

			driver.listVehicles(callback);
		});
	},

	SelectVehicle: function(context, callback) {
		driverRepository.get(context.message.id, function(err, driver) {
			if (err) return callback(err);

			driver.selectVehicle(context, callback);
		});
	},

	RatingClient: function(context, callback) {
		tripRepository.get(context.message.tripId, function(err, trip){
			if (err) return callback(err);

			trip.driverRateClient(context, callback);
		});
	},

	ApiCommand: function(context, callback) {
		apiBackend.apiCommand(context.message, callback);
	},

	Subscribe: function(context, callback) {
		if (!context.message.channel) return callback(new Error('channel could not be empty'));

		// Client subscriptions management
		this.channelClients[context.message.channel] = this.channelClients[context.message.channel] || [];
		var clients = this.channelClients[context.message.channel];
		clients.push(context.connection);

		console.log("Subscribe to " + context.message.channel);
		console.log("Channel " + context.message.channel + " has " + clients.length + " rediss");
		
		// Remove disconnected clients
		context.connection.once('close', function() {
			index = clients.indexOf(context.connection);
			if (index > -1) {
				console.log('Remove subscriber from ' + context.message.channel);
				clients.splice(index, 1);
			}
		});

		// Push initial state
		if (context.message.channel === 'drivers') {
			Driver.publishAll();
		} else if (context.message.channel === 'clients') {
			Client.publishAll();
		} else if (context.message.channel === 'trips') {
			Trip.publishAll();
		}		
	}
}

function responseWithError(text, errorCode){
	console.log(text);
	this.send(JSON.stringify(MessageFactory.createError(text, errorCode)));
}

Dispatcher.prototype._parseJSONData = function(data, connection) {
	var message;
	try {
	  message = JSON.parse(data);
	  console.log(util.inspect(message, {depth: 3, colors: true}));
	}
	catch(e) {
	  responseWithError.call(connection, e.message);
	}

	return message;
}

Dispatcher.prototype._findMessageHandler = function(message, connection) {
	if (message.app !== 'client' && message.app !== 'driver' && message.app !== 'god') {
		return responseWithError.call(connection, 'Unknown client app: ' + message.app);
	}

	var handler = this.__proto__[message.messageType];
	if (!handler) {
		return responseWithError.call(connection, 'Unsupported message type: ' + message.messageType);
	}

	return handler;
}

// Update all clients except the one requested pickup
Dispatcher.prototype._clientsUpdateNearbyDrivers = function(driver, clientRequestedPickup) {
	var skipClientId = clientRequestedPickup ? clientRequestedPickup.id : null;

	if (!driver.connected) driver.removeAllListeners();

	clientRepository.each(function(client) {
		if (client.id === skipClientId) return;

		client.updateNearbyDrivers();
	});
}

// Subscribe to driver events (1 time)
Dispatcher.prototype._subscribeToDriverEvents = function(driver) {
	driver.removeAllListeners();

	_.each(['connect', 'disconnect', 'available', 'unavailable'], function(eventName){
		driver.on(eventName, this.driverEventCallback);
	}.bind(this));
}

Dispatcher.prototype._accessWithoutToken = function(methodName) {
	return ["Login", "ApiCommand", "LoginDriver", "SignUpClient", "Subscribe"].indexOf(methodName) > -1;
}

Dispatcher.prototype._tokenValid = function(message, connection) {
	var user;
	if (message.app === "client") {
		user = clientRepository.get(message.id);
	} 
	else if (message.app === "driver") {
		user = driverRepository.get(message.id);
	}

	if (user && !user.isTokenValid(message)) {
		responseWithError.call(connection, "Доступ запрещен", ErrorCodes.INVALID_TOKEN);
		return false;
	}
	
	return true;
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
				console.log('Cache ' + result.drivers.length + ' driver(s)');
				async.each(result.drivers, function(driver, cb){
					self._subscribeToDriverEvents(driver);
					driver.load(cb);
				}, next);
			},
			function(next) {
				console.log('Cache ' + result.clients.length + ' client(s)');
				async.each(result.clients, function(client, cb){
					client.load(cb);
				}, next);
			},
			function(next) {
				console.log('Cache ' + result.trips.length + ' trip(s)');
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

	// Find message handler
	var messageHandler;
	if (!(messageHandler = this._findMessageHandler(message, connection))) return;

	// Validate token
	if (!this._accessWithoutToken(message.messageType) && !this._tokenValid(message, connection)) return;

	// Process request and send response
	messageHandler.call(this, {message: message, connection: connection}, function(err, result) {
		if(err) {
			console.log(err.stack);
			return responseWithError.call(connection, err.message);
		}

		console.log('Sending response');
		console.log(util.inspect(result, {depth: 3}));

		// Send response
		connection.send(JSON.stringify(result), function(err) {
			if (err) return console.log(err);
		});
	});
}

module.exports = Dispatcher;