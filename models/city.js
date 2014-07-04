var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    DistanceMatrix = require('../lib/google-distance'),
    _ = require('underscore'),
    redis = require("redis").createClient(),
    mongoClient = require('../mongo_client'),
    InNOut = require('in-n-out');

function City() {
  EventEmitter.call(this);
  
  this.vehicleViews = {};
  this.sorryMsgGeofence = "К сожалению мы еще не работаем в вашей области. Мы постоянно расширяем наш сервис, следите за обновлениями вступив в группу vk.com/instacab. Напишите нам в Твитере @instacab_vrn";

  redis.get('city', function(err, reply) {
    if (err) throw err;

    if (reply)
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
      vehicleView = this.attributes.vehicleViews[m.vehicleViewId],
      fare = vehicleView ? vehicleView.fare : null;

  if (!vehicleView || !fare) return callback(new Error('Fare for vehicleViewId ' + m.vehicleViewId + 'not found'));

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
    var billedDistance;
    if (fare.perMinute > 0)
      billedDistance = distanceKm - distanceKm * 0.1;
    else
      billedDistance = distanceKm;

    console.log(" [*] %s + %s * %s", fare.base.toString(), billedDistance.toString(), fare.perKilometer.toString());

    var estimateLow = Math.round((fare.base + billedTimeLow * fare.perMinute + billedDistance * fare.perKilometer) / 10) * 10;
    var estimateHigh = Math.round((fare.base + billedTimeHigh * fare.perMinute + billedDistance * fare.perKilometer) / 10) * 10;

    if (estimateLow < fare.minimum) estimateLow = fare.minimum;
    if (estimateHigh < fare.minimum) estimateHigh = fare.minimum;

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
    
    callback(null, require("../messageFactory").clientFareEstimate(client, estimateLow, estimateHigh, estimateString));
  });
}

City.prototype.getSorryMsg = function(vehicleViewId) {
  return this.vehicleViews[vehicleViewId].sorryMsg;
}

City.prototype.isPickupLocationAllowed = function(location, vehicleViewId) {
  var vehicleView = this.vehicleViews[vehicleViewId];
  if (!vehicleView) return false;

  // instance of InNOut.GeofencedGroup
  return vehicleView.geofence.getValidKeys([location.longitude, location.latitude]).length != 0;
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
    
    this.vehicleViews[vehicleViewId] = {
      sorryMsg: vehicleView.sorryMsg,
      geofence: this.loadGeofence(vehicleView.geofence, vehicleViewId)
    };

    delete vehicleView.sorryMsg;
    delete vehicleView.geofence;
  }

  return attributes;
}

City.prototype.loadGeofence = function(geoJSON, vehicleViewId) {
  var gfGroup = new InNOut.GeofencedGroup();
  if (!geoJSON) return gfGroup;

  var geofences = [];
  geoJSON.features.forEach(function(feature) {
    console.log(" [*] Loading geofence '%s' for vehicleViewId %d", feature.properties.name, vehicleViewId);

    geofences.push(new InNOut.Geofence(feature.geometry.coordinates));
  })

  gfGroup.add(1, geofences, []);
  return gfGroup;
}

City.prototype.isCyclist = function(vehicleViewId) {
  if (!vehicleViewId) return false;

  var vehicleView = this.attributes.vehicleViews[vehicleViewId];

  return vehicleView ? this.attributes.vehicleViews[vehicleViewId].description.toLowerCase() === 'свифт' : false;
}

City.prototype.toJSON = function() {
  return this.attributes;
}

module.exports = new City();