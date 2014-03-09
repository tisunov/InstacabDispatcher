var util = require('util'),
    async = require('async'),
    GoogleMaps = require('googlemaps');

exports.reverseGeocodeLocation = function(location, callback) {
  GoogleMaps.reverseGeocode(location.latitude + ',' + location.longitude, function(err, response) {
    if (err) {
      console.log(err);
      return callback(err);
    }
    if (response.status !== "OK") return callback(new Error(response.status));
    
    var city, streetName, streetNumber;

    console.log(util.inspect(response.results, {colors: true, depth: 6}));

    async.each(response.results, function(address, addressCallback) {
      var components = address.address_components;
      var component = address.address_components[0];
      if (!component.types) return addressCallback();

      var componentType = component.types[0];
      if (componentType === "street_number") {
        streetNumber = component.long_name;
        // extract street name
        var routeComponent = components[1];
        if (routeComponent)
          streetName = routeComponent.long_name;
      }
      else if (componentType === "route") {
        streetName = component.long_name;
      }
      else if (componentType === "locality")  {
        city = component.long_name;
      }

      addressCallback();
    }, function() {
      callback(null, streetName, streetNumber, city);
    })

  }, true, 'ru');
}