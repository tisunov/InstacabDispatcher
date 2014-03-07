var _ = require('underscore');

function MessageFactory() {
	
}

function tripForClientToJSON(trip) {
	return {
		id: trip.id,
		pickupLocation: trip.pickupLocation,
		fareBilledToCard: trip.fareBilledToCard,
		dropoffAt: trip.dropoffAt,
		driver: {
			firstName: trip.driver.firstName,
			mobile: trip.driver.mobile,
			rating: trip.driver.rating,
			state: trip.driver.state,
			location: trip.driver.location,
		},
		vehicle: trip.driver.vehicle,
		eta: trip.eta
	}
}

function tripToClientMessage(trip, messageType) {
	return {
		messageType: messageType,
		trip: tripForClientToJSON(trip)
	}
}

MessageFactory.createClientOK = function(client, options) {
	options = options || {};

	var msg = {
		messageType: "OK",
		client: userToJSON(client, options.includeToken)
	}

	// Для географической области вызовы в которую не обслуживаем
	if (options.restrictedArea) {
		msg.nearbyVehicles = { sorryMsg: "К сожалению мы еще не работаем в вашем регионе" };
		return msg;
	}

	if (options.tripPendingRating) {
		msg.client.tripPendingRating = tripForClientToJSON(options.trip);
	}
	else if (options.trip) {
		msg.trip = tripForClientToJSON(options.trip);
	}

	// В Vehicle View
	// "etaString": "6 minutes",
	// "etaStringShort": "6 mins",
	// "minEta": 6

	if (!options.vehicles || options.vehicles.length === 0) {
		// Когда нет свободных автомобилей для заказа в городе который подключен
		msg.nearbyVehicles = { noneAvailableString: "Нет свободных автомобилей" };
	}
	else {
		var minEta = _.min(options.vehicles, function(vehicle){ return vehicle.eta; }).eta;
		msg.nearbyVehicles = { minEta: minEta, vehiclePoints: options.vehicles };
	}		

	return msg;
}

MessageFactory.createClientEndTrip = function(client, trip) {
	var msg = {
		messageType: "EndTrip",
		client: userToJSON(client),
	}

	msg.client.tripPendingRating = tripForClientToJSON(trip);
	return msg;
}

function clientPropertiesForDriver(client) {
	return {
		firstName: client.firstName,
		mobile: client.mobile,
		rating: client.rating,
		state: client.state
	}
}

function userToJSON(user, includeToken) {
	var json = {
		id: user.id,
		firstName: user.firstName,
		mobile: user.mobile,
		rating: user.rating,
		state: user.state
	};

	if (includeToken) {
		json.token = user.token;
	}

	if (user.paymentProfile) {
		json.paymentProfile = user.paymentProfile;
	}

	return json;
}

function driverToJSON(driver, includeToken) {
	var json = userToJSON(driver, includeToken);
	json.vehicle = driver.vehicle;
	return json;
}

MessageFactory.createClientPickupCanceled = function(client, reason) {
	return {
		messageType: 'PickupCanceled',
		reason: reason,
		client: userToJSON(client)
	}
}

MessageFactory.createDriverPickupCanceled = function(driver, reason) {
	return {
		messageType: 'PickupCanceled',
		reason: reason,
		driver: userToJSON(driver)
	}
}

MessageFactory.createClientTripCanceled = function(client, reason) {
	return {
		messageType: 'TripCanceled',
		reason: reason,
		client: userToJSON(client)
	}
}

MessageFactory.createClientDriverEnroute = function(trip) {
	return tripToClientMessage(trip, 'Enroute');
}

MessageFactory.createDriverTripCanceled = function(driver, reason) {
	return {
		messageType: 'TripCanceled',
		reason: reason,
		driver: userToJSON(driver)
	}
}

MessageFactory.createError = function(errorText) {
	return {
	  messageType: 'Error',
	  errorText: errorText,
	}
}

MessageFactory.createArrivingNow = function(trip) {
	return tripToClientMessage(trip, 'ArrivingNow');
}

MessageFactory.createTripStarted = function(client, trip) {
	var msg = tripToClientMessage(trip, 'BeginTrip');
	msg.client = userToJSON(client);
	return msg;
}

MessageFactory.createClientDispatching = function(client, trip) {
	var msg = tripToClientMessage(trip, 'OK');
	msg.client = userToJSON(client);
	return msg;
}

// Messages to the Driver
MessageFactory.createDriverOK = function(driver, includeToken, trip, tripPendingRating) {
	var msg = {
		messageType: "OK",
		driver: driverToJSON(driver, includeToken)
	}

	if (tripPendingRating) {
		msg.driver.tripPendingRating = tripForDriverToJSON(trip);
	} 
	else if (trip) {
		msg.trip = tripForDriverToJSON(trip);
	}

	return msg;
};

MessageFactory.createDriverVehicleList = function(driver, vehicles) {
	return {
		messageType: "OK",
		driver: driverToJSON(driver),
		vehicles: vehicles
	}
}

function tripForDriverToJSON(trip) {
	return {
		id: trip.id,
		pickupLocation: trip.pickupLocation,
		dropoffLocation: trip.dropoffLocation,
		dropoffTimestamp: trip.dropoffAt,
		fareBilledToCard: trip.fareBilledToCard,
		client: userToJSON(trip.client)
	};	
}

MessageFactory.createDriverPickup = function(driver, trip, client) {
	return {
		messageType: 'Pickup',
		driver: driverToJSON(driver),
		trip: {
			id: trip.id,
			pickupLocation: trip.pickupLocation,
			eta: trip.eta,
			client: clientPropertiesForDriver(client)
		}
	}
}

module.exports = MessageFactory;