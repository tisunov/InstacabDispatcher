var MessageFactory = require("../messageFactory"),
  LatLon = require('../latlon'),
  util = require("util"),
  async = require("async"),
  Repository = require('../lib/repository'),
  DistanceMatrix = require('../lib/google-distance'),
  User = require("./user");

function Driver() {
  User.call(this, Driver.OFFDUTY);
}

util.inherits(Driver, User);

var repository = new Repository(Driver);
var DEFAULT_PICKUP_TIME_SECONDS = 20 * 60;

/**
 * Driver States
 */

['OffDuty', 'Available', 'Dispatching', 'Accepted', 'Arrived', 'DrivingClient', 'PendingRating'].forEach(function (readableState, index) {
  var state = readableState.toUpperCase();
    Driver.prototype[state] = Driver[state] = readableState;
});

Driver.prototype.getSchema = function() {
  var props = User.prototype.getSchema.call(this);
  props.push('vehicle');
  return props;
}

Driver.prototype.login = function(context, callback) {
  this.updateLocation(context);

  console.log('Driver ' + this.id + ' logged in: ' + this.state + ' connected: ' + this.connected);
  // Update state to Available only if driver has signed out before
  var offDuty = !this.state || this.state === Driver.OFFDUTY
  if (offDuty) {
    this.changeState(Driver.AVAILABLE);
  }

  this.save(function(err) {
    callback(err, MessageFactory.createDriverLoginOK(this));
  }.bind(this));
}

Driver.prototype.changeState = function(state, client) {
  User.prototype.changeState.call(this, state);
  
  if (this.state === Driver.AVAILABLE) {
    this.emit('available');
    this.clearTrip();
  }
  else {
    this.emit('unavailable', client);
  }
}

Driver.prototype.logout = function(context, callback) {
  console.log('Driver ' + this.id + ' went off duty');
  this.updateLocation(context);
  this.changeState(Driver.OFFDUTY);

  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this));
  }.bind(this));
}

// Update driver's position
Driver.prototype.ping = function(context) {
  this.updateLocation(context);
  this.save();

  return MessageFactory.createDriverOK(this, this.trip, this.state === Driver.PENDINGRATING);
}

// TODO: Если произошла ошибка посылки водителю или ошибка сохранения, то перевести водителя в AVAILABLE
Driver.prototype.dispatch = function(client, trip, callback) {
  this.changeState(Driver.DISPATCHING, client);
  this.setTrip(trip);

  async.series([
    this.send.bind(this, MessageFactory.createDriverPickup(this, trip, client)),
    this.save.bind(this)
  ], callback);
}

Driver.prototype.save = function(callback) {
  callback = callback || function(err) {
    if (err) console.log(err);
  };
  repository.save(this, callback);  
}

// Notify driver that Dispatcher/Client canceled pickup
Driver.prototype.pickupCanceled = function(reason, callback) {
  this.changeState(Driver.AVAILABLE);

  this.send(MessageFactory.createDriverPickupCanceled(this, reason));
  this.save(callback);
}

Driver.prototype.tripCanceled = function(callback) {
  this.changeState(Driver.AVAILABLE);
  this.send(MessageFactory.createDriverTripCanceled(this, "Клиент отменил заказ."));
  this.save(callback);  
}

// Driver explicitly canceled trip
Driver.prototype.cancelTrip = function(context, callback) {
  this.updateLocation(context);
  this.changeState(Driver.AVAILABLE);

  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this));
  }.bind(this));
}

Driver.prototype.confirm = function(context, callback) {
  this.updateLocation(context);
  this.changeState(Driver.ACCEPTED);
  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this));
  }.bind(this));
}

Driver.prototype.enroute = function(context, callback) {
  this.updateLocation(context);
  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this));
  }.bind(this));
}

Driver.prototype.arriving = function(context, callback) {
  this.updateLocation(context);
  this.changeState(Driver.ARRIVED);
  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this));
  }.bind(this));
}

Driver.prototype.begin = function(context, callback) {
  this.updateLocation(context);
  this.changeState(Driver.DRIVINGCLIENT);
  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this));
  }.bind(this));
}

Driver.prototype.end = function(context, callback) {
  this.updateLocation(context);
  this.changeState(Driver.PENDINGRATING);

  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this, this.trip, this.state === Driver.PENDINGRATING));
  }.bind(this));
}

Driver.prototype.rateClient = function(context, callback) {
  this.updateLocation(context);
  this.changeState(Driver.AVAILABLE);
  
  this.save(function(err) {
    callback(err, MessageFactory.createDriverOK(this));
  }.bind(this));
}

Driver.prototype.updateRating = function(rating, callback) {
  User.prototype.updateRating.call(this, rating);
  this.save(callback);  
}

Driver.prototype._distanceTo = function(location) {
  // FIXME: Оптимизировать позже
  return new LatLon(this.location.latitude, this.location.longitude).distanceTo(new LatLon(location.latitude, location.longitude), 4);
}

Driver.prototype.isDrivingClient = function() {
  return this.state === Driver.DRIVINGCLIENT;
}

function isAvailable(driver, callback) {
  console.log('+ isAvailable: Driver ' + driver.id + ' => ' + driver.connected + ', ' + driver.state);
  callback(driver.connected && driver.state === Driver.AVAILABLE);
}

function userLocationToString(user) {
  return user.location.latitude + ',' + user.location.longitude
}

function findAvailableDrivers(callback) {
  // bind function context and first (err) param to null
  repository.filter(isAvailable, callback.bind(null, null));
}

// TODO: Нужно кэшировать полученные расстояния когда координаты origin и destination входят в небольшой bounding box
// Иначе очень быстро исчерпаются временной и дневной лимиты на запросы к Google Maps Distance Matrix API
Driver.prototype.queryETAForClient = function(client, callback) {
  DistanceMatrix.get({
    origin: userLocationToString(this),
    destination: userLocationToString(client)
  }, function(err, data) {
    if (err) {
      data = { durationSeconds: DEFAULT_PICKUP_TIME_SECONDS };
      console.log(err);
    }

    var eta = Math.ceil(data.durationSeconds / 60);
    callback(null, eta);
  });
}

function vehicleLocationsWithTimeToClient(client, drivers, callback) {
  async.map(drivers, function(driver, next) {
    driver.queryETAForClient(client, function(err, eta) {
      var v = {
        id: driver.vehicle.id,
        longitude: driver.location.longitude, 
        latitude: driver.location.latitude,
        eta: eta
      };

      next(null, v);
    });
  }, callback);
}

Driver.findAllAvaiable = function(client, callback) {
  async.waterfall([
    findAvailableDrivers,
    vehicleLocationsWithTimeToClient.bind(null, client)
  ], callback);
}

Driver.findAllAvailableOrderByDistance = function(client, callback) {
  async.waterfall([
    findAvailableDrivers,
    // find distance to each driver
    function(availableDrivers, nextFn) {
      console.log('Available drivers:');
      console.log(util.inspect(availableDrivers, { colors:true }));

      async.map(
        availableDrivers,
        function(driver, cb) {
          // distance from client in km
          var distanceToClient = driver._distanceTo(client.location);
          cb(null, { driver: driver, distanceToClient: distanceToClient });
        }, 
        nextFn
      );      
    },
    // order drivers by distance
    function(driversAndDistances, nextFn) { 
      async.sortBy(
        driversAndDistances, 
        function(item, cb) { cb(null, item.distanceToClient) },
        nextFn
      );
    }
  ], callback);
}

Driver.findFirstAvailable = function(client, callback) {
  Driver.findAllAvailableOrderByDistance(client, function(err, driversWithDistance){
    if (err) return callback(err);

    console.log('Drivers in ascending order by distance from the client:');
    console.log(util.inspect(driversWithDistance,{colors:true}));

    if (driversWithDistance.length === 0) return callback(new Error('No available drivers'));

    callback(null, driversWithDistance[0].driver);
  });
}

// export Driver constructor
module.exports.Driver = Driver;
module.exports.repository = repository;