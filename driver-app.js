var login1 = {
  messageType: "LoginDriver",
  app: "driver",
  email: 'mike@mail.ru',
  password: 'securepassword',
  latitude: 51.66351,
  longitude: 39.185234
};

var login2 = {
  messageType: "LoginDriver",
  app: "driver",
  email: 'katrin@gmail.com',
  password: 'securepassword',
  latitude: 51.66251,
  longitude: 39.185234  
}

var signOut = {
  messageType: "SignOut",
  app: "driver",
  token: 'db1eba81d9d8',
  latitude: 51.68274,
  longitude: 39.12119
};

var pingDriver = {
  messageType: "PingDriver",
  altitude: 0,
  latitude: 51.68274,
  longitude: 39.12119,
  app: 'driver',
  token: 'db1eba81d9d8'
};

var enroute = {
  messageType: "Enroute",
  app: 'driver',
  token: 'db1eba81d9d8'
};

var confirmPickup = {
  messageType: "ConfirmPickup",
  altitude: 0,
  latitude: 51.68274,
  longitude: 39.12119,
  app: 'driver',
  token: 'db1eba81d9d8'
};

var arrivingNow = {
  messageType: "ArrivingNow",
  altitude: 0,
  latitude: 51.68274,
  longitude: 39.12119,
  app: 'driver',
  token: 'db1eba81d9d8'
};

var beginTrip = {
  messageType: "BeginTripDriver",
  app: 'driver',
  token: 'db1eba81d9d8',
  latitude: 51.68274,
  longitude: 39.12119  
};

var endTrip = {
  messageType: "EndTrip",
  app: 'driver',
  token: 'db1eba81d9d8',
  latitude: 51.68274,
  longitude: 39.12119  
};

var tripCoordinates = [
  [51.681520, 39.183383],
  [51.675932, 39.169736],
  [51.670715, 39.161153],
  [51.672419, 39.153171],
  [51.675719, 39.143300],
  [51.677901, 39.136691],
  [51.680296, 39.129653],
  [51.683448, 39.122151],
];


var WebSocket = require('faye-websocket'),
    client    = new WebSocket.Client('ws://localhost:9000/');

client.on('open', function(event) {
  console.log('WebSocket client connected');
  
  client.sendWithLog = function(message) {
    console.log('Sending ' + message.messageType);
    this.send(JSON.stringify(message));
  };

  client.sendWithLog(login1);
});


client.on('close', function(event) {
  console.log('Connection Closed', event.code, event.reason);
  setTimeout(function() {
    client = new WebSocket.Client('ws://localhost:9000/');
  }, 500);
});

function driveToClient(tripId, pickupLocation) {
  var i = 0;
  var timerId = setInterval(function() {
    // Send driver coordinates every second
    enroute.tripId = tripId;
    enroute.latitude = tripCoordinates[i][0];
    enroute.longitude = tripCoordinates[i][1];
    enroute.timestamp = Date.now();
    client.sendWithLog(enroute);

    // Send arriving now
    if (i == tripCoordinates.length - 1) {
      clearInterval(timerId);

      arrivingNow.tripId = tripId;
      arrivingNow.latitude = pickupLocation.latitude;
      arrivingNow.longitude = pickupLocation.longitude;      
      client.sendWithLog(arrivingNow);
    }

    i++;
  }, 500);
}

function driveClient(tripId, callback) {
  var routeCoords = tripCoordinates.reverse();

  var i = 0;
  var timerId = setInterval(function() {
    // Send driver coordinates every second
    pingDriver.tripId = tripId;
    pingDriver.latitude = tripCoordinates[i][0];
    pingDriver.longitude = tripCoordinates[i][1];
    pingDriver.timestamp = Math.round(Date.now() / 1000); // in seconds
    client.sendWithLog(pingDriver);

    // Send Ping
    if (i == tripCoordinates.length - 1) {
      clearInterval(timerId);
      callback();
    }

    i++;
  }, 1500);

}

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
    case 'Pickup':
      setTimeout(function() {
        confirmPickup.tripId = response.trip.id;
        confirmPickup.latitude = 51.681520;
        confirmPickup.longitude = 39.183383;
        client.sendWithLog(confirmPickup);
        
        driveToClient(response.trip.id, response.trip.pickupLocation);

        // begin trip after 2 seconds
        setTimeout(function() {
          // let the Trip begin
          beginTrip.tripId = response.trip.id;
          client.sendWithLog(beginTrip);

          // send couple of gps points to dispatcher
          driveClient(response.trip.id, function() {
            // end trip
            endTrip.tripId = response.trip.id;
            client.sendWithLog(endTrip);
          });
        }, 2000);

      }, 2000);
      break;
  }    
});
