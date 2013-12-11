var redis = null,//require("../config").redis,
	util = require('util');

function Persistence() {

}

util.inherits(Persistence, require('events').EventEmitter);

Persistence.prototype._initProperties = function(data) {
	if (data) {
		Object.keys(data).forEach(function(name) {
	    	this[name] = data[name];
		}.bind(this));
	}
}

Persistence.prototype._internalSave = function(key, callback) {
	var data = {};

	this.getSchema().forEach(function(prop) {
		// getter property
		if (typeof this[prop] === 'function') {
			data[prop] = this[prop].call(this);
		}
		else {
			data[prop] = this[prop];
			if (!data[prop]) delete data[prop];
		}
	}, this);
	
	console.log('Saving ' + key);
	console.log(util.inspect(data, {colors:true}));
	redis.set(key, JSON.stringify(data), callback);	
}

Persistence.prototype.save = function(callback) {
	var modelName = this.constructor.name.toLowerCase();

	// create new id
	if (!this.id) {
		redis.incr('id:' + modelName, function(err, id) {
			var key = modelName + ':' + id;

			this.id = id;
		    this._internalSave(key, callback);
		}.bind(this));
	}
	else {
		var key = modelName + ':' + this.id;
		this._internalSave(key, callback);
	}
}

Persistence.prototype.remove = function(callback) {
	var modelName = this.constructor.name.toLowerCase();
	console.log('Removing ' + modelName + ':' + this.id);
	redis.del(modelName + ':' + this.id, callback);
}

Persistence.loadAll = function(callback) {
	return callback(null, []);
	var ctor = this;
	var modelName = this.name.toLowerCase();

	redis.keys(modelName + ':*', function(err, keys) {
		if (keys.length === 0) return callback(err, []);

		redis.mget(keys, function(err, replies){
			var models = [];

			replies.forEach(function(json) {
				var model = new ctor(JSON.parse(json));
				models.push(model);
			});

			callback(err, models);
		});
	});
}

module.exports = Persistence;