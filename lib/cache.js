var async = require('async');

// TODO: Обрати внимание на http://nodeguide.ru/doc/modules-you-should-know/hashish/

/**
 * Basic memory system to get data from it
*/
function Cache(){
  this._map = {};
}


/**
 * Set (and replace if needed) a data to store
 * @param string key The key reference to store data
 * @param mixed data The data to store into this system
*/
Cache.prototype.set = function(key, data){
    this._map[key] = data;
};

/**
 * Return a data stored, or null if there is nothing
 * @param string key The key to store data
 * @return mixed The founded data, or null if there is an error
*/
Cache.prototype.get = function(key){
    return this._map[key];
};

/**
 * Delete the stored key if it is existing
 * @param string key The key to delete associated data
*/
Cache.prototype.remove = function(key){
  if(typeof(this._map[key]) !== "undefined" && this._map[key] !== null){
    // Deleting the map
    delete this._map[key];
  }
};

Cache.prototype.count = function(){
    return Object.keys(this._map).length;
}

/**
* Iterate over keys, applying match function
*/
Cache.prototype.map = function(iterator, fn) {
  var self = this;
  async.map(
    Object.keys(this._map), 
    function(key, cb) {
      iterator(self._map[key], cb);
    }, 
    fn
  );
};

Cache.prototype.filter = function(iterator, fn) {
  async.map(
    Object.keys(this._map), 
    
    // map key to item
    function(key, cb) {
      cb(null, this._map[key]);
    }.bind(this),

    // filter items
    function(err, items) {
      async.filter(items, iterator, fn);
    }
  );
};

Cache.prototype.each = function(iterator) {
  async.each(
    Object.keys(this._map),
    function(key, callback) {
        iterator(this._map[key]);
        callback();
    }.bind(this)
  );
}

Cache.prototype.findOne = function(iterator) {
    for (var prop in this._map) {
        if (this._map.hasOwnProperty(prop)) {
            if (iterator(this._map[prop])) {
                return this._map[prop];
            }
        }
    }

    return null;
}

module.exports = Cache;