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
    mongo = require('mongoskin'),
    db = mongo.db("mongodb://localhost:27017/instacab", {native_parser:true});

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
    });

    connection.on('error', function(reason, code){
      console.log('socket error: reason ' + reason + ', code ' + code);
    })
  });


  // Middleware
  app.use(express.bodyParser())
  app.use(app.router)
  app.use(function(err, req, res, next) {
    console.error(err.stack);

    res.send('500', { messageType: 'Error', text: err.message });
  });


  // create index: 
  // key, unique, callback
  db.collection('mobile_events').ensureIndex({ "location": "2d" }, false, function(err, replies){});

  // Events
  app.post('/mobile/event', function(req, resp) {
    db.collection('mobile_events').insert( req.body, function(err, replies){
      if (err) console.log(err);
    });
    
    resp.writeHead(200, { 'Content-Type': 'text/plain' });
    resp.end();
  });

});