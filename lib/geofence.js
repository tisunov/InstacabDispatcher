var InNOut = require('in-n-out'),
    config = require('konfig')(),
    fs = require('fs'),
    util = require('util');

// Draw custom polylines and export them in KML
// http://www.doogal.co.uk/polylines.php
// 
// Edit KML, GeoJSON live on map and download resulting GeoJSON
// http://geojson.io/

// https://github.com/uber/in-n-out

function Geofence() 
{
  var file = './config/geofences/voronezh_simplified.geojson'

  fs.readFile(file, 'utf8', function (err, data) {
    if (err) {
      console.log('Error: ' + err);
      return;
    }
   
    this.data = JSON.parse(data);
    console.log(util.inspect(this.data, {depth: 3, colors: true}));

    // Возьмем первую feature которая по стечению обстоятельств описывает границы Воронежа :)
    this.gf = new InNOut.Geofence(this.data.features[0].geometry.coordinates);
  }.bind(this));
}

Geofence.prototype.isLocationAllowed = function(location) {
  return this.gf.inside([location.longitude, location.latitude]);
}

module.exports = new Geofence();