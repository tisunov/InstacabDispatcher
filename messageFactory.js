function MessageFactory() {
	
}

// TODO: Реализовать SetDestination для установки DropOff destination, передачи водителю и расчета примерной стоимости для клиента

// Messages to the Client
MessageFactory.createNearbyVehicles = function(client, vehiclePoints) {
	return {
	  messageType: 'NearbyVehicles',
	  client: {
	  	id: client.id,
	  	firstName: client.firstName,
	  	mobile: client.mobile,
	  	rating: client.rating,
	  	state: client.state
	  },
	  nearbyVehicles: {
	  	minEta: 15,
	  	vehiclePoints: vehiclePoints
	  }
	}
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
			location: {
				latitude: trip.driver.lat,
				longitude: trip.driver.lon
			}
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

function userToJSONWithToken(user) {
	return {
		id: user.id,
		firstName: user.firstName,
		mobile: user.mobile,
		rating: user.rating,
		state: user.state,
		token: user.token
	}
}

MessageFactory.createPickupConfirm = function(trip) {
	return tripToClientMessage(trip, 'ConfirmPickup');
}

MessageFactory.createPickupCanceled = function(trip) {
	return {
		messageType: 'PickupCanceled',
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

MessageFactory.createTripStarted = function(trip) {
	return tripToClientMessage(trip, 'BeginTrip');
}

MessageFactory.createTripEnded = function(trip) {
	return tripToClientMessage(trip, 'EndTrip');
}

MessageFactory.createClientOK = function(client) {
	return {
	  messageType: 'OK',
	  client: {
	  	state: client.state
	  }
	}
}

// Messages to the Driver
MessageFactory.createDriverOK = function(driver) {
	return {
		messageType: "OK",
		driver: {
			state: driver.state
		}
	};
};

MessageFactory.createDriverPing = function(driver, trip) {
	var msg = {
		messageType: "Ping",
		driver: userToJSONWithToken(driver)
	}

	if (trip) {
		msg['trip'] = {
			id: trip.id,
			pickupLocation: trip.pickupLocation,
			dropoffLocation: trip.dropoffLocation,
			dropoffTimestamp: trip.dropoffTimestamp,
			farePaidByClient: trip.farePaidByClient,
			client: userToJSON(trip.client)
		}
	}

	return msg;
}

MessageFactory.createDriverLoginOK = function(driver) {
	return {
		messageType: "Login",
		driver: userToJSONWithToken(driver)
	};
};

MessageFactory.createDriverPickup = function(trip, client){
	return {
		messageType: 'Pickup',
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