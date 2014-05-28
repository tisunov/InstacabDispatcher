var _ = require('underscore');

var city = {
  cityName: "Воронеж",
  vehicleViews: {
    "1": {
      id: 1,
      fareDetailsUrl: null,
      allowFareEstimate: true,
      mapImages: [
        {
          url: "https://s3-eu-west-1.amazonaws.com/instacab-assets/car-types/map70px/map-uberx.png",
          width: 70,
          height: 70
        }
      ],
      monoImages: [
        {
          url: "https://s3-eu-west-1.amazonaws.com/instacab-assets/car-types/mono/mono-uberx.png",
          width: 100,
          height: 37
        }
      ],
      description: "INSTACAB",
      // pickupButtonString: "ВЫБРАТЬ МЕСТО ПОСАДКИ",
      // confirmPickupButtonString: "Подтвердить заказ",
      requestPickupButtonString: "ЗАКАЗАТЬ {string}",
      setPickupLocationString: "ВЫБРАТЬ МЕСТО ПОСАДКИ",
      pickupEtaString: "Время прибытия машины примерно {string}",
      noneAvailableString: "НЕТ СВОБОДНЫХ АВТОМОБИЛЕЙ",
    },

    "2": {
    	id: 2,
    	fareDetailsUrl: null,
    	allowFareEstimate: true,
    	mapImages: [
    	  {
    	    url: "https://s3-eu-west-1.amazonaws.com/instacab-assets/car-types/map70px/map-taxi.png",
    	    width: 70,
    	    height: 70
    	  }
    	],
    	monoImages: [
    	  {
    	    url: "https://s3-eu-west-1.amazonaws.com/instacab-assets/car-types/mono/mono-taxi.png",
    	    width: 100,
    	    height: 37
    	  }
    	],
    	description: "ТАКСИ",
    	// pickupButtonString: "ВЫБРАТЬ МЕСТО ПОСАДКИ",
    	// confirmPickupButtonString: "Подтвердить заказ",
    	requestPickupButtonString: "ЗАКАЗАТЬ {string}",
    	setPickupLocationString: "ВЫБРАТЬ МЕСТО ПОСАДКИ",
    	pickupEtaString: "Время прибытия машины примерно {string}",
    	noneAvailableString: "НЕТ СВОБОДНЫХ ТАКСИ",
    }
  },
  vehicleViewsOrder: [ 2, 1 ],
  defaultVehicleViewId: 1
};

function tripForClientToJSON(trip) {
	var vehicle = trip.driver.vehicle;

	vehicle.vehicleViewId = city.defaultVehicleViewId;
	vehicle.uuid = vehicle.id;

	// Web Mobile Client
	vehicle.vehicleType = {
		make: vehicle.make,
		model: vehicle.model
	}
	
	return {
		id: trip.id,
		pickupLocation: trip.pickupLocation,
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
		eta: trip.eta,
		// Web Mobile Client
		vehicleViewId: city.defaultVehicleViewId,
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

	return json;
}

function clientToJSON(user, includeToken) {
	var json = userToJSON(user, includeToken);

	if (user.paymentProfile) {
		json.paymentProfile = user.paymentProfile;
	}

	json.hasConfirmedMobile = user.hasConfirmedMobile;

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

function MessageFactory() {
	
}

function vehiclePointsToVehiclePaths(vehiclePoints) {
	var vehiclePaths = {};
	_.map(vehiclePoints, function(item) {
		// TODO: Использовать вместо порядковых id => "cff13a78-dc45-495b-b28f-c27a802d9742". Зачем так делает Uber?
	
		// TODO: Записывать изменения позиции водителя в массив последовательных координат
		// чтобы позже на клиенте их можно было бы плавно анимировать хоть и не в реальном времени (с небольшой задержкой),
		// но за время задержки можно выполнить Map Fitting сгладив индивидуальные точки (устранив погрешности GPS), и потом сделать плавную анимацию между точками
		vehiclePaths[item.id] = [{
			epoch: item.epoch || 0, // TODO: Передавать Unix epoch реального получения координаты от водителя
			latitude: item.latitude,
			longitude: item.longitude,
			course: item.course || 0
		}];
	});

	return vehiclePaths;
}

///////////////////////////////////////////////////////////////////////////////
// Factory Methods
// 
MessageFactory.createClientOK = function(client, options) {
	options = options || {};

	var msg = {
		messageType: "OK",
		city: city
	}

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
	
	// Nearby Vehicles
	if (options.vehicles && options.vehicles.length > 0) {
		var minEta = options.vehicles.length == 1 ? options.vehicles[0].eta : _.min(options.vehicles, function(vehicle){ return vehicle.eta; }).eta;
		var minEtaString = minEta + " " + GetNoun(minEta, 'минута', 'минуты', 'минут');

		// Web Mobile Client
		msg.nearbyVehicles = {
			"1": {
				etaString: minEtaString,
				etaStringShort: minEtaString,
				minEta: minEta,
				vehiclePaths: vehiclePointsToVehiclePaths(options.vehicles)
			}
		}
	}

	// Sorry that we don't have a car for you
	if (options.sorryMsg) {
		msg.nearbyVehicles = {
			"1": {
				sorryMsg: options.sorryMsg,
			}
		}
	}	

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

MessageFactory.clientFareEstimate = function(client, fareEstimateString) {
	var msg = {
		messageType: "OK",
		city: city,
		client: clientToJSON(client),
	};

	// Web Mobile Client
	msg.client.lastEstimatedTrip = {
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

MessageFactory.createClientTripCanceled = function(client, reason) {
	return {
		messageType: 'TripCanceled',
		reason: reason,
		client: clientToJSON(client)
	}
}

// TODO: Устрани путаницу с PickupCanceled/TripCanceled, оставить только PickupCanceled и в ответ посылать только OK/Error
MessageFactory.createDriverPickupCanceled = function(driver, reason) {
	return {
		messageType: 'PickupCanceled',
		reason: reason,
		driver: clientToJSON(driver)
	}
}

MessageFactory.createDriverTripCanceled = function(driver, reason) {
	return {
		messageType: 'TripCanceled',
		reason: reason,
		driver: userToJSON(driver)
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

module.exports = MessageFactory;