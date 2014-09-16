var redis = require("redis").createClient(),
    util = require('util'),
    async = require("async"),
    Cache = require('./cache'),
    _ = require('underscore');

var RedisRepository = function(objectContructor) {
  var cache = new Cache();
  var modelName = objectContructor.name.toLowerCase();
  
  this._defaultSaveCallback = function(err) {
    if (err) console.log(err);
  };

  this.save = function(value, callback) {        
    cache.set(value.id, value);

    var data = modelToArchive(value);
    var key = modelName + ':' + value.id;

    redis.set(key, JSON.stringify(data), callback || this._defaultSaveCallback);
  };

  this.get = function(id, callback) {
    var value = cache.get(id);
    if (!value && callback) return callback(new Error("Внутренняя ошибка. Пожалуйста повторите попытку."));

    if (callback)
      callback(null, value);
    else
      return value;
  };

  this.remove = function(id, callback) {
    console.log('Removing ' + modelName + ':' + id);

    // default callback logs errors
    callback = callback || function(err) {
      if (err) console.log(err);
    };

    cache.remove(id);
    redis.del(modelName + ':' + id, callback);
  };

  this.all = function(callback) {
    redis.keys(modelName + ':*', function(err, keys) {
      if (keys.length === 0) return callback(err, []);

      redis.mget(keys, function(err, replies){
        if (err) return callback(err, []);

        loadModels(replies, callback);
      });
    });
  };

  this.filter = function(iterator, callback) {
    cache.filter(iterator, callback);
  };

  this.each = function(callback) {
    cache.each(callback);
  };

  this.generateNextId = function(callback) {
    redis.incr('id:' + modelName, function(err, id) {
      callback(err, id);
    });
  };

  function modelToArchive(model) {
      var data = {};

      // prepare for serialization
      model.getSchema().forEach(function(prop) {
          // getter property
          if (typeof model[prop] === 'function') {
              data[prop] = model[prop].call(model);
          }
          else if (model[prop]) {
              data[prop] = model[prop];
          }
      });

      return data;
  }

  function loadModel(json, callback) {
    var props = JSON.parse(json); // !!! Can throw
    var model = cache.get(props.id);
    if (model) return callback(null, model);

    model = new objectContructor();
    _.extend(model, props);

    // keep it in cache
    cache.set(model.id, model);
    callback(null, model);
  };

  function loadModels(replies, callback) {
    var models = [];

    replies.forEach(function(json) {
        loadModel(json, function(err, model){
            if (err) console.log(err);
            models.push(model);
        });
    });

    callback(null, models);
  };

};



module.exports = RedisRepository;