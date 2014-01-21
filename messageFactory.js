var _ = require('underscore');

function MessageFactory() {
	
}

function tripForClientToJSON(trip) {
	return {
		id: trip.id,
		pickupLocation: trip.pickupLocation,
		fareBilledToCard: trip.fareBilledToCard,
		dropoffTimestamp: trip.dropoffTimestamp,
		driver: {
			firstName: trip.driver.firstName,
			mobile: trip.driver.mobile,
			rating: trip.driver.rating,
			state: trip.driver.state,
			location: trip.driver.location,
		},
		vehicle: trip.driver.vehicle
	}
}

MessageFactory.createClientOK = function(client, includeToken, trip, tripPendingRating, vehicles) {
	var msg = {
		messageType: "OK",
		client: userToJSON(client, includeToken)
	}

	if (tripPendingRating) {
		msg.client.tripPendingRating = tripForClientToJSON(trip);
	}
	else if (trip) {
		msg.trip = tripForClientToJSON(trip);
	}

	// В Vehicle View
	// "etaString": "6 minutes",
	// "etaStringShort": "6 mins",
	// "minEta": 6

	if (!vehicles || vehicles.length === 0) {
		// Когда нет свободных автомобилей для заказа в городе который подключен
		msg.nearbyVehicles = { noneAvailableString: "Свободные автомобили отсутствуют" };
		// TODO: Это при PingClient из города который не обслуживаем
		// msg['sorryMsg'] = "Большое СПАСИБО за интерес к InstaCab. В вашем регионе нет машин, но пока мы постоянно расширяем нашу зону обслуживания.";
	}
	else {
		var minEta = _.min(vehicles, function(vehicle){ return vehicle.eta; }).eta;
		msg.nearbyVehicles = { minEta: minEta, vehiclePoints: vehicles };
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


function tripToClientMessage(trip, messageType) {
	var tripJson = {
		id: trip.id,
		pickupLocation: trip.pickupLocation,
		driver: {
			firstName: trip.driver.firstName,
			mobile: trip.driver.mobile,
			rating: trip.driver.rating,
			state: trip.driver.state,
			location: trip.driver.location
		},
		vehicle: trip.driver.vehicle,
		eta: trip.eta
	};

	return {
		messageType: messageType,
		trip: tripJson
	}
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

	return json;
}

function driverToJSON(driver, includeToken) {
	var json = userToJSON(driver, includeToken);
	json.vehicle = driver.vehicle;
	return json;
}

MessageFactory.createPickupConfirm = function(client, trip) {
	var message = tripToClientMessage(trip, 'ConfirmPickup');
	message['client'] = userToJSON(client);
	return message;
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
	  errorDescription: errorText,
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
MessageFactory.createDriverOK = function(driver, trip, tripPendingRating) {
	var msg = {
		messageType: "OK",
		driver: driverToJSON(driver)
	}

	if (tripPendingRating) {
		msg.driver.tripPendingRating = tripForDriverToJSON(trip);
	} 
	else if (trip) {
		msg.trip = tripForDriverToJSON(trip);
	}

	return msg;
};

function tripForDriverToJSON(trip) {
	return {
		id: trip.id,
		pickupLocation: trip.pickupLocation,
		dropoffLocation: trip.dropoffLocation,
		dropoffTimestamp: trip.dropoffTimestamp,
		fareBilledToCard: trip.fareBilledToCard,
		client: userToJSON(trip.client)
	};	
}

MessageFactory.createDriverLoginOK = function(driver) {
	return {
		messageType: "Login",
		driver: driverToJSON(driver, true)
	};
};

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