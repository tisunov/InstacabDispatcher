var _ = require('underscore');

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
			photoUrl: trip.driver.photoUrl
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

function GetNoun(number, one, two, five) {
    number = Math.abs(number);
    number %= 100;
    if (number >= 5 && number <= 20) {
        return five;
    }
    number %= 10;
    if (number == 1) {
        return one;
    }
    if (number >= 2 && number <= 4) {
        return two;
    }
    return five;
} 

function MessageFactory() {
	
}

///////////////////////////////////////////////////////////////////////////////
// Factory Methods
// 
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

	if (options.trip) {
		var jsonTrip = tripForClientToJSON(options.trip);
		if (options.tripPendingRating) {
			msg.client.tripPendingRating = jsonTrip;	
		}
		else
			msg.trip = jsonTrip;
	}
	else {
		if (!options.vehicles || options.vehicles.length === 0) {
			// Когда нет свободных автомобилей для заказа в городе который подключен
			msg.nearbyVehicles = { noneAvailableString: "Нет свободных автомобилей" };
		}
		else {
			var minEta = _.min(options.vehicles, function(vehicle){ return vehicle.eta; }).eta;
			var minEtaString = minEta + " " + GetNoun(minEta, 'минута', 'минуты', 'минут');
			msg.nearbyVehicles = { minEta: minEta, minEtaString: minEtaString, vehiclePoints: options.vehicles };
		}		
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

MessageFactory.createError = function(errorText, errorCode) {
	return {
	  messageType: 'Error',
	  errorText: errorText,
	  errorCode: errorCode
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

// Messages to the Driver
MessageFactory.createDriverOK = function(driver, includeToken, trip, tripPendingRating) {
	var msg = {
		messageType: "OK",
		driver: driverToJSON(driver, includeToken)
	}

	if (trip) {
		var jsonTrip = tripForDriverToJSON(trip);
		if (tripPendingRating)
			msg.driver.tripPendingRating = jsonTrip;
		else
			msg.trip = jsonTrip;	
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

MessageFactory.createDriverPickup = function(driver, trip, client) {
	return {
		messageType: 'Pickup',
		driver: driverToJSON(driver),
		trip: {
			id: trip.id,
			pickupLocation: trip.pickupLocation,
			eta: trip.eta,
			client: userToJSON(client)
		}
	}
}

module.exports = MessageFactory;