var Driver = require("./models/driver"),
		Client = require("./models/client");

function BusinessLogic() {

}

var vehicle = {
	id: '922bb9d4-c92d-4b87-b877-38d7c8b8440b',
	exteriorColor: 'Черный',
	interiorColor: 'Бежевый',
	licensePlate: 'а777аа 77RUS',
	make: 'Mercedes',
	model: 'S-class',
	capacity: 3,
	year: 2013,
}

var users = [
	{ id : 3144716, "token" : "0c761ee198e0", "email" : "tisunov.pavel@gmail.com", "firstName" : "Паша", "mobile" : "+79202133056", rating: '4.9' },
	// Drivers
	{ id : 3144718, "token" : "83fdd5c78b14", "email" : "igor@mail.ru", "firstName" : "Игорь", "mobile" : "+79207845467", "rating" : 4.8, vehicleId: 'df6ec298-e3f7-4755-b326-3c972ed0b6a7' },
	{ id : 3144719, "token" : "a6f4f35a486e", "email" : "pavel@mail.ru", "firstName" : "Павел", "mobile" : "+79204567890", "rating" : 4.9, vehicleId: 'ad03aefe-f71a-4132-8033-1f14373edc1d' },
	{ id : 3144720, "token" : "db1eba81d9d8", "email" : "mike@mail.ru", "firstName" : "Михаил", "mobile" : "+79204563478", "rating" : 5.0, vehicleId: '922bb9d4-c92d-4b87-b877-38d7c8b8440b', vehicle: vehicle }
];

BusinessLogic.loginClient = function(email, callback) {
	this.login(email, function(err, user) {
		if (user) user.__proto__ = Client.prototype;
		callback(err, user);
	});
}

BusinessLogic.loginDriver = function(email, callback) {
	this.login(email, function(err, user) {
		if (user) user.__proto__ = Driver.prototype;
		callback(err, user);
	});	
}

BusinessLogic.login = function(email, cb) {
	for (var i = 0, len = users.length; i < len; i++) {
    var user = users[i];
    if (user.email === email) {
      return cb(null, user);
    }
  }
  return cb(new Error('user not found ' + email), null);
};

module.exports = BusinessLogic;