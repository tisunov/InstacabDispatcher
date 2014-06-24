if (process.env.NODE_ENV === "production") {
  require('nodetime').profile({
    accountKey: 'a0df5534478dd2873fcc0789e958749f2a356908', 
    appName: 'InstaCab Dispatcher'
  });

  require("bugsnag").register("889ee967ff69e8a6def329190b410677");
}

var Dispatcher = require('./dispatch'),
    // agent = require('webkit-devtools-agent'),
    WebSocketServer = require('ws').Server,
    express = require('express'),
    inspect = require('util').inspect,
    util = require('util'),
    cors = require('cors'),
    apiBackend = require('./backend'),
    async = require('async'),
    db = require('./mongo_client'),
    amqpConsumer = require('./amqp_consumer');

var dispatcher = new Dispatcher();

dispatcher.load(function(err) {
  if (err) return console.log(err);

  var app = express();
  var port = process.env.PORT || 9000;
  var server = app.listen(port);
  console.log(' [*] Dispatcher started on port %d', port);

  // Websockets
  var wss = new WebSocketServer({ server: server });
  wss.on('connection', function(connection) {
    
    connection.on('message', function(data) {
      dispatcher.processMessage(data, connection);
    });

    connection.on('close', function() {
      connection.removeAllListeners();
      connection = null;
    });

    connection.on('error', function(reason, code){
      console.log('socket error: reason ' + reason + ', code ' + code);
      connection.removeAllListeners();
      connection = null;
    })
  });


  // Middleware
  app.use(express.json());
  app.use(cors());
  app.use(app.router);
  app.use(function(err, req, res, next) {
    console.error(err.stack);

    res.send('500', { messageType: 'Error', text: err.message });
  });

  // create index: 
  // key, unique, callback
  db.collection('mobile_events').ensureIndex({ "location": "2d" }, false, function(err, replies){});
  db.collection('driver_events').ensureIndex({ "location": "2d" }, false, function(err, replies){});

  // Events
  app.post('/mobile/event', function(req, resp) {
    // console.log(req.body);

    db.collection('mobile_events').insert( req.body, function(err, replies){
      if (err) console.log(err);
    });
    
    resp.writeHead(200, { 'Content-Type': 'text/plain' });
    resp.end();

    if (req.body.eventName === "NearestCabRequest" && req.body.parameters.reason === "openApp") {
      apiBackend.clientOpenApp(req.body.parameters.clientId || req.body.clientId);
    }
  });

  var clientRepository = require('./models/client').repository;

  // TODO: Это должен быть отдельный от Диспетчера Node.js процесс
  // 1) Нужен набор служб который запускается как один организм в котором службы сотрудничают друг с другом
  // 2) Нужен процесс который будет перезапускать умершие службы, да Forever должен справиться 

  // TODO: Это должно делаться через Redis, хранишь данные в Redis, 
  // потом читаешь их и кэшируешь в памяти через request-redis-cache, затем с Web интерфейса можешь 
  // обновить данные Клиента, Водителя в Redis и послать сигнал в Redis чтобы Диспетчер прочитал обновленные данные из Redis
  // 
  // State management
  app.put('/clients/:id', function(req, resp) {
    
    clientRepository.get(req.body.id, function(err, client) {
      if (err) return console.log(err);

      client.update(req.body);
    });

    resp.end();
  });

  var filterClientIds = [ 29, 31, 35, 36, 49, 63, 60, 67 ];

  // Query demand
  app.get('/query/pings', function(req, resp) {
    var filter = {
      // location: { 
      //   $near: [39.192151, 51.672448], // Center of the Voronezh
      //   $maxDistance: 80 * 1000 // 40 km
      // }, 
      eventName: 'NearestCabRequest', 
      'parameters.reason': 'openApp', 
      'parameters.clientId': { $nin: filterClientIds } // filter out Pavel Tisunov and Mikhail Zhizhenko
    };

    db.collection('mobile_events').find(filter).toArray(function(err, items) {
      if (err) return resp.end(JSON.stringify({pings: ""}));

      var pings = async.map(items, function(item, callback) {

        callback(null, {
          id: item._id,
          clientId: item.parameters.clientId || item.clientId,
          longitude: item.location[0] || 0,
          latitude: item.location[1] || 0,
          epoch: item.epoch,
          verticalAccuracy: item.parameters.locationVerticalAccuracy,
          horizontalAccuracy: item.parameters.locationHorizontalAccuracy
        });

      }, function(err, result) {
        resp.end(JSON.stringify({pings: result}));
      });
    });
    
  });

  app.get('/query/pickup_requests', function(req, resp) {
    var filter = {
      // TODO: Сделать миграцию, позже переименовать в базе PickupRequest -> RequestVehicleRequest
      eventName: { $in: ['RequestVehicleRequest', 'PickupRequest']}, 
      'parameters.clientId': { $nin: filterClientIds } // filter out Pavel Tisunov and Mikhail Zhizhenko
    };

    // TODO: Сделать миграцию, перенести clientId из parameters.clientId в root.clientId

    db.collection('mobile_events').find(filter).toArray(function(err, items) {
      if (err) return resp.end(JSON.stringify({pickup_requests: ""}));

      var pings = async.map(items, function(item, callback) {

        callback(null, {
          id: item._id,
          clientId: item.parameters.clientId || item.clientId,
          longitude: item.location[0],
          latitude: item.location[1],
          epoch: item.epoch,
          verticalAccuracy: item.parameters.locationVerticalAccuracy,
          horizontalAccuracy: item.parameters.locationHorizontalAccuracy
        });

      }, function(err, result) {
        resp.end(JSON.stringify({pickup_requests: result}));
      });
    });

  });

});