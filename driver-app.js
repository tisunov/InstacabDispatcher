var login1 = {
  messageType: "LoginDriver",
  app: "driver",
  email: 'mike@mail.ru',
  password: 'securepassword',
  latitude: 51.674789,
  longitude: 39.211527
  // latitude: 51.66351,
  // longitude: 39.185234
};

var onduty = {
  messageType: "OnDutyDriver",
  app: "driver",  
  latitude: 51.674789,
  longitude: 39.211527  
}

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
  latitude: 51.68274,
  longitude: 39.12119
};

var pingDriver = {
  messageType: "PingDriver",
  app: 'driver',
  latitude: 51.674789,
  longitude: 39.211527    
};

var confirmPickup = {
  messageType: "ConfirmPickup",
  altitude: 0,
  latitude: 51.68274,
  longitude: 39.12119,
  app: 'driver',
};

var arrivingNow = {
  messageType: "ArrivingNow",
  altitude: 0,
  latitude: 51.68274,
  longitude: 39.12119,
  app: 'driver',
};

var beginTrip = {
  messageType: "BeginTripDriver",
  app: 'driver',
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
    console.log(message);
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

function driveToClient(driverId, tripId, pickupLocation) {
  var i = 0;
  var timerId = setInterval(function() {
    // Send driver coordinates every second
    pingDriver.id = driverId;
    pingDriver.latitude = tripCoordinates[i][0];
    pingDriver.longitude = tripCoordinates[i][1];
    pingDriver.timestamp = Date.now();
    pingDriver.token = token;
    client.sendWithLog(pingDriver);

    // Send arriving now
    if (i === tripCoordinates.length - 1) {
      clearInterval(timerId);

      arrivingNow.id = driverId;
      arrivingNow.token = token;
      arrivingNow.tripId = tripId;
      arrivingNow.latitude = pickupLocation.latitude;
      arrivingNow.longitude = pickupLocation.longitude;      
      client.sendWithLog(arrivingNow);
    }

    i++;
  }, 200);
}

function driveClient(driverId, callback) {
  var i = tripCoordinates.length;
  var timerId = setInterval(function() {
    i--;

    // Send driver coordinates every second
    pingDriver.id = driverId;
    pingDriver.latitude = tripCoordinates[i][0];
    pingDriver.longitude = tripCoordinates[i][1];
    pingDriver.timestamp = Math.round(Date.now() / 1000); // in seconds
    pingDriver.token = token;
    client.sendWithLog(pingDriver);

    // Send Ping
    if (i === 0) {
      clearInterval(timerId);
      callback();
    }
  }, 200);

}

var timer, token;

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
    case 'OK':
      if (response.driver.token)
        token = response.driver.token;

      if (response.driver.state === 'PendingRating') {
        client.sendWithLog({ 
          messageType: 'RatingClient', 
          id: response.driver.id, 
          tripId: response.driver.tripPendingRating.id,
          rating: 5.0,
          app: 'driver',
          token: token,
          latitude: 51.66351,
          longitude: 39.185234          
        });
      }

      if (response.driver.state === 'OffDuty') {
        onduty.id = response.driver.id;
        onduty.token = token;
        client.sendWithLog(onduty);
      }
      break;

    case 'PickupCanceled':
      clearTimeout(timer);
      break;

    case 'Pickup':
      timer = setTimeout(function() {
        confirmPickup.tripId = response.trip.id;
        confirmPickup.latitude = 51.681520;
        confirmPickup.longitude = 39.183383;
        confirmPickup.token = token;
        client.sendWithLog(confirmPickup);
        
        driveToClient(response.driver.id, response.trip.id, response.trip.pickupLocation);

        // begin trip after 3 seconds
        timer = setTimeout(function() {
          // let the Trip begin
          beginTrip.tripId = response.trip.id;
          beginTrip.token = token;
          client.sendWithLog(beginTrip);

          // send couple of gps points to dispatcher
          driveClient(response.driver.id, function() {
            // end trip
            endTrip.tripId = response.trip.id;
            endTrip.token = token;
            client.sendWithLog(endTrip);
          });
        }, 3000);

      }, 1000);
      break;
  }    
});
