var qs = require('querystring'),
    http = require('http');

function locationToString(location) {
  return location.latitude + ',' + location.longitude
}

exports.get = function(origin, destination, callback) {
  var args = {
    origin: locationToString(origin),
    destination: locationToString(destination),
  };

  var options = {
    origins: args.origin,
    destinations: args.destination,
    mode: args.mode || 'driving',
    units: args.units || 'metric',
    language: args.language || 'ru',
    sensor: args.sensor || true
  };

  if (!options.origins) {return callback(new Error('Argument Error: Origin is invalid'))}
  if (!options.destinations) {return callback(new Error('Argument Error: Destination is invalid'))}
    
  request(options, function(err, result) {
    if (err) {
      callback(err);
      return;
    }
    var data = result;
    if (data.status != 'OK') {
      callback(new Error('Google Distance Matrix status error: ' + data.status));
      return;
    }

    if (data.rows[0].elements[0].status != 'OK') {
      callback(new Error('Google Distance Matrix element status error: ' + data.rows[0].elements[0].status));
      return;
    }

    var d = {
      distance: data.rows[0].elements[0].distance.text,
      distanceKms: data.rows[0].elements[0].distance.value,
      duration: data.rows[0].elements[0].duration.text,
      durationSeconds: data.rows[0].elements[0].duration.value,
      origin: data.origin_addresses[0],
      destination: data.destination_addresses[0],
      mode: options.mode,
      units: options.units,
      language: options.language,
      avoid: options.avoid,
      sensor: options.sensor
    };
    return callback(null, d);
  }); 
}


var request = function(options, callback) {
  var httpOptions = {
      host: 'maps.googleapis.com',
      path: '/maps/api/distancematrix/json?' + qs.stringify(options)
  };

  var requestCallback = function(res) {
      var json = '';

      res.on('data', function (chunk) {
        json += chunk;
        callback(null, JSON.parse(json));
      });
  } 

  console.log('Query Google Maps Distance Matrix API');
  console.log('http://' + httpOptions.host + httpOptions.path);
  
  var req = http.request(httpOptions, requestCallback);
  req.on('socket', function (socket) {
    socket.setTimeout(1000);
    socket.on('timeout', function() {
        req.abort();
    });
  });

  req.on('error', function(err) {
    callback(new Error('Request error: ' + err.message));
  });
  req.end();
}