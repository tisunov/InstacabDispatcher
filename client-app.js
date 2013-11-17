var beginTrip, login, pingClient, pingLoop, postRequest, request, requestPickup;

login = {
  messageType: "Login",
  longitude: 39.122151,
  latitude: 51.683448,
  email: 'tisunov.pavel@gmail.com',
  password: 'test',
  app: 'client'
};

pingClient = {
  messageType: "PingClient",
  id: 3144716,
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
  token: '0c761ee198e0'
};

requestPickup = {
  messageType: "Pickup",
  id: 3144716,
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
  token: '0c761ee198e0',
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
  id: 3144716,
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
  token: '0c761ee198e0'
};

beginTrip = {
  messageType: "BeginTripClient",
  id: 3144716,
  longitude: 39.122151,
  latitude: 51.683448,
  app: 'client',
  token: '0c761ee198e0'
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
    case 'ConfirmPickup':
      // cancelPickup.tripId = response.trip.id;
      // client.sendWithLog(cancelPickup);
      break;

    case 'ArrivingNow':
      setTimeout(function() {
        beginTrip.tripId = response.trip.id;
        client.sendWithLog(beginTrip);
      }, 3000);
      break;
  }
});

setTimeout(function() {
  client.sendWithLog(requestPickup);
}, 1000);


client.on('close', function(event) {
  console.log('Connection Closed', event.code, event.reason);
  setTimeout(function() {
    client = new WebSocket.Client('ws://localhost:9000/');
  }, 500);
});