var Driver = require("./models/driver").Driver,
		Client = require("./models/client").Client,
		driverRepository = require('./models/driver').repository,
		clientRepository = require('./models/client').repository,		
		request = require("request"),
		util = require("util"),
		config = require('konfig')();

function Backend() { 
}

var backendUrl = 'http://' + config.app.BackendApiHost + ':' + config.app.BackendApiPort;
var backendApiUrl = backendUrl + '/api/v1';

function initProperties(sourceProps) {
	Object.keys(sourceProps).forEach(function(propName) {
    	this[propName] = sourceProps[propName];
	}.bind(this));
};

function login(url, email, password, constructor, repository, callback) {
	request.post(url, { form: {email: email, password: password} }, function (error, response, body) {
		// network error
		if (error) return callback(error);
		
		var properties = JSON.parse(body);
		util.inspect(properties, {colors: true});

		// authentication error
		if (response.statusCode !== 200) return callback(new Error(properties['error'] || body));

		// set user properties
		repository.get(properties.id, function(err, user) {
			if (err) {
				user = new constructor();
			}
			// case of a 2nd login with same credentials
			else if (user.connected) {
				return callback(new Error("Повторный вход с указанными параметрами запрещен"));
			}

			initProperties.call(user, properties)

			callback(null, user);
		});
	});
}

Backend.prototype.loginDriver = function(email, password, callback) {
	login(backendUrl + '/api/v1/drivers/sign_in', email, password, Driver, driverRepository, callback);
}

Backend.prototype.loginClient = function(email, password, callback) {
	login(backendUrl + '/api/v1/sign_in', email, password, Client, clientRepository, callback);
}

Backend.prototype.signupClient = function(signupInfo, callback) {
	request.post(backendUrl + '/api/v1/sign_up', { form: signupInfo }, function (error, response, body) {
		// network error
		if (error) return callback(error);

		console.log(body);
		
		var properties = JSON.parse(body);
		util.inspect(properties, {colors: true});

		console.log('Response statusCode = ' + response.statusCode);

		// signup error
		if (response.statusCode !== 201) {
			return callback(new Error(properties['errors'] || body));
		}

		// set user properties
		var user = new Client();
		initProperties.call(user, properties)

		callback(null, user);
	});
}

function tripToJson(trip) {
	var tripData = {};

	trip.getSchema().forEach(function(prop) {
	    if (trip[prop]) {
	        tripData[prop] = trip[prop];
	    }
	});

	return tripData;
}

Backend.prototype.addTrip = function(trip, callback) {
	request.post(backendUrl + '/api/v1/trips', { json: {trip: tripToJson(trip)} }, function (error, response, body) {		
		callback(error);
	});	
}

Backend.prototype.billTrip = function(trip, callback) {
	request.post(backendUrl + '/api/v1/trips/bill', { json: {trip: tripToJson(trip)} }, function (error, response, body) {
		// network error
		if (error) return callback(error);

		console.log('+ Backend.billTrip:');
		console.log(util.inspect(body, {colors:true}));
		
		callback(null, body['fare']);
	});
}

Backend.prototype.rateDriver = function(tripId, rating, feedback, callback) {
	var payload = {
		trip: { rating: rating, feedback: feedback }
	};

	request.put(backendUrl + '/api/v1/trips/' + tripId + '/rate_driver', { json: payload }, function (error, response, body) {
		callback();
	});
}

Backend.prototype.rateClient = function(tripId, rating, callback) {
	var payload = {
		trip: { rating: rating }
	};

	request.put(backendUrl + '/api/v1/trips/' + tripId + '/rate_client', { json: payload }, function (error, response, body) {
		callback();
	});
}

// apiParameters:
//    { password: 'fwfweewfwe',
//      mobile: '+7 (920) 213-30-56',
//      email: 'email@domain.ru' },
// apiUrl: '/clients/validate',
// apiMethod: 'POST'
Backend.prototype.apiCommand = function(message, callback) {
	request(
		{ method: message.apiMethod, 
			uri: backendApiUrl + message.apiUrl,
			form: message.apiParameters
		},
		function(error, response, body) {
			var apiResponse = {};

			if (error) {
				apiResponse['error'] = { message: error.message };
			}
			else if (response.statusCode !== 200) {
				apiResponse['error'] = { statusCode: response.statusCode };
			}
			else {
	    	apiResponse['data'] = JSON.parse(body);
			}

			callback(null, { messageType: 'ApiResponse', apiResponse: apiResponse });
		}
	);
}

module.exports = new Backend();