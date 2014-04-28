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
    db = require('./mongo_client');

var dispatcher = new Dispatcher();

dispatcher.load(function(err) {
  if (err) return console.log(err);

  var app = express();
  var port = process.env.PORT || 9000;
  var server = app.listen(port);
  console.log('Dispatcher started on port %d', port);

  // Websockets
  var wss = new WebSocketServer({ server: server });
  wss.on('connection', function(connection) {
    console.log('socket client connected');

    connection.on('message', function(data) {
      dispatcher.processMessage(data, connection);
    });

    connection.on('close', function() {
      console.log('socket client disconnected');
      connection.removeAllListeners();
    });

    connection.on('error', function(reason, code){
      console.log('socket error: reason ' + reason + ', code ' + code);
      connection.removeAllListeners();
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

  // Events
  app.post('/mobile/event', function(req, resp) {
    console.log(req.body);

    db.collection('mobile_events').insert( req.body, function(err, replies){
      if (err) console.log(err);
    });
    
    resp.writeHead(200, { 'Content-Type': 'text/plain' });
    resp.end();
  });

  var clientRepository = require('./models/client').repository;

  // State management
  app.put('/clients/:id', function(req, resp) {
    console.log(req.body);

    clientRepository.get(req.body.id, function(err, client) {
      if (err) return console.log(err);

      client.update(req.body);
    });

    resp.end();
  });

});