var Driver = require("./models/driver").Driver,
		Client = require("./models/client").Client,
		request = require("request"),
		util = require("util"),
		CONFIG = require('config').Backend;

function GroundControlAPI() { 
}

var backendUrl = 'http://' + CONFIG.apiHost + ':' + CONFIG.apiPort;

function initProperties(sourceProps) {
	Object.keys(sourceProps).forEach(function(propName) {
    	this[propName] = sourceProps[propName];
	}.bind(this));
};

function login(url, email, password, constructor, callback) {
	request.post(url, { form: {email: email, password: password} }, function (error, response, body) {
		// network error
		if (error) return callback(error);
		
		var data;
		try {
			data = JSON.parse(body);
		}
		catch (e) {
			return callback(new Error('Error parsing login response: ' + e.message + ' in ' + body));
		}

		util.inspect(data, {colors: true});

		// authentication error
		if (response.statusCode !== 200) return callback(new Error(data['error'] || body));

		// set user properties
		var user = new constructor();
		initProperties.call(user, data)

		callback(null, user);
	});
}

GroundControlAPI.loginDriver = function(email, password, callback) {
	login(backendUrl + '/api/v1/drivers/sign_in', email, password, Driver, callback);
}

GroundControlAPI.loginClient = function(email, password, callback) {
	login(backendUrl + '/api/v1/sign_in', email, password, Client, callback);
}

GroundControlAPI.completeTrip = function(trip, callback) {
	var tripData = {};

	trip.getSchema().forEach(function(prop) {
	    if (trip[prop]) {
	        tripData[prop] = trip[prop];
	    }
	});

	request.post('http://localhost:3000/api/v1/trips/complete', { json: {trip: tripData} }, function (error, response, body) {
		// network error
		if (error) return callback(error);

		console.log('+ GroundControlAPI.completeTrip:');
		console.log(util.inspect(body, {colors:true}));
		
		callback(null, body['fare']);
	});
}

module.exports = GroundControlAPI;