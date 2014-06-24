var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    DistanceMatrix = require('../lib/google-distance'),
    _ = require('underscore'),
    redis = require("redis").createClient(),
    mongoClient = require('../mongo_client');

function City() {
  EventEmitter.call(this);
  
  this.vehicleViewSorryMessages = {};
  this.sorryMsgGeofence = "К сожалению мы еще не работаем в вашей области. Мы постоянно расширяем наш сервис, следите за обновлениями вступив в группу vk.com/instacab";

  redis.get('city', function(err, reply) {
    if (err) throw err;

    this.attributes = this.extractServiceInfo(JSON.parse(reply));
  }.bind(this));
}

util.inherits(City, EventEmitter);

// TODO: DistanceMatrix выдает несколько вариантов маршрута
// https://developers.google.com/maps/documentation/javascript/distancematrix
// Нужно выбрать самый короткий по расстоянию или самый быстрый по времени

// TODO: Еще лучше сделать вызов RPC метода в Backend и посчитать стоимость там

City.prototype.estimateFare = function(client, message, callback) {
  var m = message,
      fare = this.attributes.vehicleViews[m.vehicleViewId].fare;

  if (!fare) return callback(new Error('Fare for vehicleViewId ' + m.vehicleViewId + 'not found'));

  DistanceMatrix.get(m.pickupLocation, m.destination, function(err, data) {
    if (err) {
      // default to 20 minute and 9 km per trip
      data = { durationSeconds: 20 * 60, distanceKms: 9 };
      console.log(err);
    }

    var distanceKm = data.distanceKms / 1000.0;

    // Time per trip with speed less than 21 km/h = 1.5 min per 5 km
    var billedTimeLow = (distanceKm / 5) * 1.5;
    // Use 5 minutes per 5 km during traffic
    var billedTimeHigh = (distanceKm / 5) * 5;
    // 500 meters for each 5 km below < 21 km/h
    var billedDistance = distanceKm - distanceKm * 0.1;

    // Include 2 km in base fare
    var base_km = 2;
    billedDistance = billedDistance > 2 ? billedDistance - 2 : 0;

    var estimateLow = Math.round((fare.base + billedTimeLow * fare.perMinute + billedDistance * fare.perKilometer) / 10) * 10;
    var estimateHigh = Math.round((fare.base + billedTimeHigh * fare.perMinute + billedDistance * fare.perKilometer) / 10) * 10;

    var estimateString;

    if (estimateLow !== estimateHigh)
      estimateString = estimateLow.toString() + '-' + estimateHigh.toString() + ' руб.';
    else
      estimateString = estimateLow.toString() + ' руб.';
    
    // Log fare quote requests
    m.location = [m.longitude, m.latitude];
    m.fareEstimate = {
      estimateLow: estimateLow,
      estimateHigh: estimateHigh
    }

    mongoClient.collection('mobile_events').insert(m, function(err, replies){
      if (err) console.log(err);
    });
    
    callback(null, require("../messageFactory").clientFareEstimate(client, estimateString));
  });
}

City.prototype.getSorryMsg = function(vehicleViewId) {
  return this.vehicleViewSorryMessages[vehicleViewId];
}

City.prototype.update = function(object) {
  redis.set('city', JSON.stringify(object), function(err) {
    if (err) return console.log(err);
  });

  this.attributes = this.extractServiceInfo(object);
}

City.prototype.extractServiceInfo = function(attributes) {
  for (var vehicleViewId in attributes.vehicleViews) {
    var vehicleView = attributes.vehicleViews[vehicleViewId];
    this.vehicleViewSorryMessages[vehicleViewId] = vehicleView.sorryMsg;

    delete vehicleView.sorryMsg;
  }

  return attributes;
}

City.prototype.toJSON = function() {
  return this.attributes;
}

module.exports = new City();