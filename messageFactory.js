function MessageFactory() {
	
}

// TODO: Реализовать SetDestination для установки DropOff destination, передачи водителю и расчета примерной стоимости для клиента

// Messages to the Client
MessageFactory.createNearbyVehicles = function(client, vehiclePoints) {
	var msg = {
	  messageType: 'NearbyVehicles',
	  client: userToJSON(client)
	};

	if (typeof vehiclePoints === 'string') {
		msg['nearbyVehicles'] = { sorryMsg: vehiclePoints };
	}
	else {
		msg['nearbyVehicles'] = { minEta: 15, vehiclePoints: vehiclePoints };
	}

	return msg;
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

MessageFactory.createClientPing = function(client, trip, tripPendingRating) {
	var msg = {
		messageType: "Ping",
		client: userToJSON(client),
	}

	if (tripPendingRating) {
		msg.client.tripPendingRating = tripForClientToJSON(trip);
	}
	else if (trip) {
		msg.trip = tripForClientToJSON(trip);
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
		vehicle: trip.driver.vehicle
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

function userToJSON(user) {
	return {
		id: user.id,
		firstName: user.firstName,
		mobile: user.mobile,
		rating: user.rating,
		state: user.state
	}
}

function driverToJSON(driver, includeToken) {
	var json = userToJSON(driver);
	json.vehicle = driver.vehicle;
	if (includeToken) {
		json.token = driver.token;
	}
	return json;
}

function userToJSONWithToken(user) {
	var json = userToJSON(user);
	json.token = user.token;
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

MessageFactory.createDriverTripCanceled = function(driver, reason) {
	return {
		messageType: 'TripCanceled',
		reason: reason,
		driver: userToJSON(driver)
	}
}

MessageFactory.createDriverEnroute = function(trip) {
	return tripToClientMessage(trip, 'Enroute');
}

MessageFactory.createClientLoginOK = function(client) {
	return {
		messageType: "Login",
		client: userToJSONWithToken(client)
	};
};

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

MessageFactory.createClientOK = function(client) {
	return {
	  messageType: 'OK',
	  client: userToJSON(client)
	}
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

MessageFactory.createDriverPickup = function(driver, trip, client){
	return {
		messageType: 'Pickup',
		driver: driverToJSON(driver),
		trip: {
			id: trip.id,
			pickupLocation: trip.pickupLocation,
			client: clientPropertiesForDriver(client)
		}
	}
}

MessageFactory.createBeginTrip = function(trip, client) {
	return {
		messageType: "BeginTrip",
		trip: {
			id: trip.id,
			pickupLocation: trip.pickupLocation,
			client: clientPropertiesForDriver(client)
		}
	}
}


module.exports = MessageFactory;