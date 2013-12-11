var MessageFactory = require("../messageFactory"),
  LatLon = require('../latlon'),
  util = require("util"),
  async = require("async"),
  Repository = require('../lib/repository'),
  User = require("./user");

function Driver() {
  User.call(this, Driver.OFFDUTY);
}

util.inherits(Driver, User);

var repository = new Repository(Driver);

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

Driver.prototype.dispatch = function(client, trip, callback) {
  this.changeState(Driver.DISPATCHING, client);
  this.setTrip(trip);

  async.series([
    this.send.bind(this, MessageFactory.createDriverPickup(this, trip, client)),
    repository.save.bind(repository, this)
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
  this.send(MessageFactory.createDriverTripCanceled(this, "Клиент лично отменил заказ."));
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

Driver.prototype._isOnlineAndAvailable = function() {
  return this.connected && this.state === Driver.AVAILABLE;
}

Driver.findAllAvaiable = function(callback) {
  async.waterfall([
    // select available
    function(nextFn) {
      repository.filter(
        function(driver, cb) {
          cb(driver._isOnlineAndAvailable());
        },
        // bind context and err parameter to null
        nextFn.bind(null, null)
      );
    },
    // TODO: Посчитать расстояние до каждого водителя и расчитать примерное время прибытия
    // водителя перед тем как Клиент закажет машину
    function(availableDrivers, nextFn) {
      async.map(
        availableDrivers,
        function(driver, cb) {
          cb(null, { id: driver.vehicle.id, longitude: driver.location.longitude, latitude: driver.location.latitude });
        },
        nextFn
      );
    }], 
    callback
  );
}

Driver.findAllAvailableOrderByDistance = function(client, callback) {
  async.waterfall([
    // select available
    function(nextFn) {
      repository.filter(
        function(driver, cb) {
          console.log('Driver ' + driver.id + ' ' + driver.state + ' connected: ' + driver.connected);
          cb(driver._isOnlineAndAvailable());
        },
        // bind context and err parameter to null
        nextFn.bind(null, null)
      );
    },
    // find distance to each driver
    function(availableDrivers, nextFn) {
      console.log('Available and connected drivers:');
      console.log(util.inspect(availableDrivers, {colors:true}));

      async.map(
        availableDrivers,
        function(driver, cb) {
          var distanceToDriver = driver._distanceTo(client.location);
          cb(null, { driver: driver, distanceKm: distanceToDriver });
        }, 
        nextFn
      );      
    },
    // order drivers by distance
    function(driversAndDistances, nextFn) { 
      async.sortBy(
        driversAndDistances, 
        function(item, cb) { 
          cb(null, item.distanceKm) 
        },
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

    // TODO: Вернуть вместе с расстоянием и временем прибытия
    callback(null, driversWithDistance[0].driver);    
  });
}

// export Driver constructor
module.exports.Driver = Driver;
module.exports.repository = repository;