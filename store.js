var async = require('async')
  , redis = require("./config").redis
  , util = require("util");

function initStore(objectPrototype, keyProperty){
  var self = this;
  // load data from redis
  async.waterfall([
    // find all keys
    function(callback) {
      redis.keys(self.keyPrefix + '*', callback)
    },
    // load object hash one by one
    function(keys, callback) {
      async.mapSeries(
        keys, 
        function(keyItem, cb) { 
          redis.hgetall(keyItem, cb);
        }, 
        callback
      );
    }

  ], function(err, objects){
    if (err) throw Error(util.format('Failed to load %s objects: %s', self.keyPrefix, err.message));

    console.log(util.format('Loaded %d %ss', objects.length, self.keyPrefix));

    //  cache in memory
    objects.forEach(function(obj){
      obj.__proto__ = objectPrototype;
      if (obj.hasOwnProperty('afterLoad') && typeof obj.afterLoad === 'function') {
        obj.afterLoad();
      }

      self.map[obj[keyProperty]] = obj;
    })
  });  
}

/**
 * Basic memory system to get data from it
*/
function Store(constructor, keyProperty){
  this.map = {};
  this.keyPrefix = constructor.name.toLowerCase();
  this.keyProperty = keyProperty;
  initStore.call(this, constructor.prototype, keyProperty);
}


/**
 * Set (and replace if needed) a data to store
 * @param string key The key reference to store data
 * @param mixed data The data to store into this system
*/
Store.prototype.set = function(key, data, callback){
    this.map[key] = data;

    var blob = data.beforeSave();
    redis.hmset(this.keyPrefix + ':' + blob[this.keyProperty], data, callback);
};

/**
 * Return a data stored, or null if there is nothing
 * @param string key The key to store data
 * @return mixed The founded data, or null if there is an error
*/
Store.prototype.get = function(key){
    return this.map[key];
};

/**
 * Delete the stored key if it is existing
 * @param string key The key to delete associated data
*/
Store.prototype.remove = function(key){
  if(typeof(this.map[key]) !== "undefined" && this.map[key] !== null){
    // Deleting the map
    delete this.map[key];
  }
};

Store.prototype.count = function(){
    return Object.keys(this.map).length;
}

/**
* Iterate over keys, applying match function
*/
Store.prototype.map = function(iterator, fn) {
  var self = this;
  async.map(
    Object.keys(this.map), 
    function(key, cb) {
      iterator(self.map[key], cb);
    }, 
    fn
  );
};

Store.prototype.filter = function(iterator, fn) {
  async.map(
    Object.keys(this.map), 
    
    // map key to item
    function(key, cb) {
      cb(null, this.map[key]);
    }.bind(this),

    // filter items
    function(err, items) {
      async.filter(items, iterator, fn);
    }
  );
};

Store.prototype.each = function(iterator) {
  for (var prop in this.map) {
    if (this.map.hasOwnProperty(prop)) {
      iterator(this.map[prop]);
    }
  }
}

exports.Store = Store;