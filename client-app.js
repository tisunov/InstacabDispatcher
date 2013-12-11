var beginTrip, login, pingClient, pingLoop, postRequest, request, requestPickup;

login = {
  messageType: "Login",
  longitude: 39.122151,
  latitude: 51.683448,
  email: 'tisunov.pavel@gmail.com',
  password: 'securepassword',
  app: 'client'
};

pingClient = {
  messageType: "PingClient",
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
};

requestPickup = {
  messageType: "Pickup",
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
  location: {
    streetAddress: "9 Января, 302",
    region: "Коминтерновский район",
    city: "Воронеж",
    longitude: 39.122151,
    latitude: 51.683448    
  }
};

cancelPickup = {
  messageType: "PickupCanceledClient",
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
};

beginTrip = {
  messageType: "BeginTripClient",
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
};

var WebSocket = require('faye-websocket'),
    client    = new WebSocket.Client('ws://localhost:9000/');

var timeId;

client.on('open', function(event) {
  console.log('WebSocket client connected');
  
  client.sendWithLog = function(message) {
    console.log('Sending ' + message.messageType);
    console.log(message);
    this.send(JSON.stringify(message));
  };

  client.sendWithLog(login);

  if (timeId) clearInterval(timerId);

  // timeId = setInterval(function() {
  //   client.sendWithLog(pingClient);
  // }, 10000);
});

var clientId;

client.on('message', function(event) {
  console.log("Received: " + event.data);
  
  try {
    var response = JSON.parse(event.data);  
  }
  catch(e) {
    console.log(e);
    return;
  }
  
  switch (response.messageType) {
    case 'Login':
      clientId = response.client.id;
      break;

    case 'ConfirmPickup':
      // cancelPickup.tripId = response.trip.id;
      // client.sendWithLog(cancelPickup);
      break;

    case 'ArrivingNow':
      setTimeout(function() {
        beginTrip.id = clientId;
        beginTrip.tripId = response.trip.id;
        client.sendWithLog(beginTrip);
      }, 0);
      break;
  }
});

setTimeout(function() {
  requestPickup.id = clientId;
  client.sendWithLog(requestPickup);
}, 1000);


client.on('close', function(event) {
  console.log('Connection Closed', event.code, event.reason);
  setTimeout(function() {
    client = new WebSocket.Client('ws://localhost:9000/');
  }, 500);
});