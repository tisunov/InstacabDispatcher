var _ = require('underscore'),
    city = require('./models/city');

function tripForClientToJSON(trip) {
	var vehicle = trip.driver.vehicle;
	
	// Web Mobile Client
	_.extend(vehicle, {
		uuid: vehicle.id,
		vehicleType: {
			make: vehicle.make,
			model: vehicle.model
		}
	});

	// TODO: exclude if empty
	// fareBilledToCard: undefined,
	// fare: undefined,
	// paidByCard: undefined,
	// dropoffAt: undefined,

	return {
		id: trip.id,
		pickupLocation: {
			latitude: trip.pickupLocation.latitude,
      longitude: trip.pickupLocation.longitude,
      streetAddress: trip.pickupLocation.streetAddress
		},
		fareBilledToCard: trip.fareBilledToCard,
		fare: trip.fare,
		paidByCard: trip.paidByCard,
		dropoffAt: trip.dropoffAt,
		driver: {
			firstName: trip.driver.firstName,
			mobile: trip.driver.mobile,
			rating: trip.driver.rating,
			state: trip.driver.state,
			location: trip.driver.location,
			photoUrl: trip.driver.picture
		},
		vehicle: vehicle,
		vehicleViewId: trip.vehicleViewId,
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
		lastName: user.lastName,
		mobile: user.mobile,
		rating: user.rating,
		state: user.state
	};

	if (includeToken) {
		json.token = user.token;
	}

	return json;
}

// TODO: Это должен делать метод User.toJSON
// А для God view сделать отдельный код который будет выбирать нужные данные
function clientToJSON(user, includeToken) {
	var json = userToJSON(user, includeToken);

	if (user.paymentProfile) {
		json.paymentProfile = user.paymentProfile;
	}

	json.hasConfirmedMobile = user.hasConfirmedMobile;
	json.referralCode = user.referralCode;
	json.isAdmin = user.isAdmin

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
		fare: trip.fare,
		paidByCard: trip.paidByCard,
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


///////////////////////////////////////////////////////////////////////////////
// Factory Methods
// 
MessageFactory.createClientOK = function(client, options) {
	options = options || {};

	var msg = {
    messageType: "OK",
    city: city.toJSON()    
  };

	if (client) 
		msg.client = clientToJSON(client, options.includeToken);

	// Trip
	if (options.trip) 
	{
		var jsonTrip = tripForClientToJSON(options.trip);
		if (options.tripPendingRating) {
			msg.client.tripPendingRating = jsonTrip;	
		}
		else
			msg.trip = jsonTrip;
	}
	
	var nearbyVehicles = {};

	// Nearby Vehicles
	if (options.vehicles && options.vehicles.length > 0) {
    var vehiclePathPoints = options.vehicles;

    // TODO: Преобразовать массив объектов vehiclePathPoints в хэш по ключу viewId в котором есть
    // время прибытия ближашего автомобиля из viewId и массив координат [1] по ключам vehiclePathPoint.vehicleId
    var vehicleViews = {}, vehicleViewIds;
    // convert array to hash by viewId key to get minEta later
    vehiclePathPoints.forEach(function(val, i) {
    	vehicleViews[val.viewId] = vehicleViews[val.viewId] || []
    	vehicleViews[val.viewId].push(val);
    });

    vehicleViewIds = Object.keys(vehicleViews);

    // convert vehiclePathPoints to nearby vehiclePaths keyed by vehicle id
    vehiclePathPoints.forEach(function(val, i) {
			nearbyVehicles[val.viewId] = nearbyVehicles[val.viewId] || { vehiclePaths: {} };

			// just one path point right now
			nearbyVehicles[val.viewId].vehiclePaths[val.id] = [{
			  epoch: val.epoch,
			  latitude: val.latitude,
			  longitude: val.longitude,
			  course: val.course
			}];    	
    });

    // find minEta for each vehicle view
    vehicleViewIds.forEach(function(viewId, i) {
    	var vehicles = vehicleViews[viewId];
    	var vehicle = vehicles.length == 1 ? vehicles[0] : _.min(vehicles, function(v){ return v.eta; });

    	var nearbyVehicle = nearbyVehicles[viewId];
    	nearbyVehicle.minEta = vehicle.eta;
    	nearbyVehicle.etaString = vehicle.eta + " " + GetNoun(vehicle.eta, 'минута', 'минуты', 'минут');
    });
	}

	// Sorry that we don't have a car for you
	if (options.sorryMsg && options.vehicleViewId) {
		nearbyVehicles[options.vehicleViewId] = nearbyVehicles[options.vehicleViewId] || {};
		nearbyVehicles[options.vehicleViewId].sorryMsg = options.sorryMsg;
	}

	if (!_.isEmpty(nearbyVehicles))
		msg.nearbyVehicles = nearbyVehicles;

	if (options.apiResponse) {
		msg.apiResponse = options.apiResponse;
	}

	return msg;
}

MessageFactory.createClientEndTrip = function(client, trip) {
	var msg = {
		messageType: "EndTrip",
		client: clientToJSON(client),
	}

	msg.client.tripPendingRating = tripForClientToJSON(trip);
	return msg;
}

MessageFactory.clientFareEstimate = function(client, estimateLow, estimateHigh, fareEstimateString) {
	var msg = {
		messageType: "OK",
		city: city.toJSON(),
		client: clientToJSON(client),
	};

	// Web Mobile Client
	msg.client.lastEstimatedTrip = {
		fareEstimateLow: estimateLow,
		fareEstimateHigh: estimateHigh,
		fareEstimateString: fareEstimateString
	};

	return msg;
}

MessageFactory.createClientPickupCanceled = function(client, reason) {
	return {
		messageType: 'PickupCanceled',
		reason: reason,
		client: clientToJSON(client)
	}
}

// TODO: Устрани путаницу с PickupCanceled/TripCanceled, оставить только PickupCanceled и в ответ посылать только OK/Error
MessageFactory.createClientPickupCanceledByDriver = function(client, reason) {
	return {
		messageType: 'TripCanceled',
		reason: reason,
		client: clientToJSON(client)
	}
}

MessageFactory.createDriverPickupCanceledByClient = function(driver, reason) {
	return {
		messageType: 'PickupCanceled',
		reason: reason,
		driver: clientToJSON(driver)
	}
}

MessageFactory.createError = function(description, errorCode) {
	return {
	  messageType: 'Error',
	  description: description,
	  errorText: description, // TODO: Удали когда проверишь Instacab Driver
	  errorCode: errorCode, // TODO: Удали когда проверишь Instacab Driver
	}
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

function MessageFactory() {

}

module.exports = MessageFactory;