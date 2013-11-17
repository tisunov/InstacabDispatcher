var util = require("util"),
	User = require("./user"),
	Store = require('../store').Store,
	CLIENT_STATE = require("./constants").CLIENT_STATE,
	MessageFactory = require("../messageFactory");

function Client() {
	User.call(this, CLIENT_STATE.LOOKING);
}

util.inherits(Client, User);
var store = new Store(Client, 'token');

Client.prototype.login = function(context, cb) {
	console.log('Login client');
	this.update(context);

	var self = this;
	store.set(this.token, this, function(err, storeReply) {
		if (err) return cb(err, null);

		cb(null, MessageFactory.createClientLoginOK(self));
	});
}

Client.prototype.ping = function(context) {
	this.update(context);

	// TODO: Здесь нужно вернуть все что у меня есть на Client включая активный Trip если он есть
}

Client.getByToken = function(token) {
	return store.get(token);
}

Client.forEach = function(iterator) {
	store.each(iterator);
}

// export Client constructor
module.exports = Client;