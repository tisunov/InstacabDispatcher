var Driver = require("./models/driver").Driver,
		Client = require("./models/client").Client,
		request = require("request"),
		util = require("util"),
		CONFIG = require('config').Backend;

function Backend() { 
}

var backendUrl = 'http://' + CONFIG.host + ':' + CONFIG.port;

function initProperties(sourceProps) {
	Object.keys(sourceProps).forEach(function(propName) {
    	this[propName] = sourceProps[propName];
	}.bind(this));
};

function login(url, email, password, constructor, callback) {
	request.post(url, { form: {email: email, password: password} }, function (error, response, body) {
		// network error
		if (error) return callback(error);
		
		var properties;
		try {
			properties = JSON.parse(body);
		}
		catch (e) {
			return callback(new Error('Error parsing login response: ' + e.message + ' in ' + body));
		}

		util.inspect(properties, {colors: true});

		// authentication error
		if (response.statusCode !== 200) return callback(new Error(properties['error'] || body));

		// set user properties
		var user = new constructor();
		initProperties.call(user, properties)

		callback(null, user);
	});
}

Backend.prototype.loginDriver = function(email, password, callback) {
	login(backendUrl + '/api/v1/drivers/sign_in', email, password, Driver, callback);
}

Backend.prototype.loginClient = function(email, password, callback) {
	login(backendUrl + '/api/v1/sign_in', email, password, Client, callback);
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

Backend.prototype.rateDriver = function(tripId, rating, callback) {
	var payload = {
		trip: {
			rating: rating
		}
	};

	request.put(backendUrl + '/api/v1/trips/' + tripId + '/rate_driver', { json: payload }, function (error, response, body) {
		callback();
	});
}

Backend.prototype.rateClient = function(tripId, rating, callback) {
	var payload = {
		trip: {
			rating: rating
		}
	};

	request.put(backendUrl + '/api/v1/trips/' + tripId + '/rate_client', { json: payload }, function (error, response, body) {
		callback();
	});
}

module.exports = new Backend();