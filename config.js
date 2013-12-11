var redis = require("redis").createClient();

redis.on("error", function (err) {
   console.log("Error " + err);
});

exports.redis = redis;