function RequestContext(connection) {
	var message = connection.message;

	return {
		end: function(message) {
			send(message);
		},
		send: function(message) {
			connection.conn.send(JSON.stringify(message));
		},

		app: message.app,
		messageType: message.messageType,
		clientId: message.clientId,
		driverId: message.driverId,
		tripId: message.tripId,
		latitude: message.latitude,
		longitude: message.longitude,
		token: message.token
	}
}

// Export constructor
module.exports = Message;