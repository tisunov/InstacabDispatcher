var Dispatcher = require('./dispatch'),
    WebSocketServer = require('ws').Server,
    express = require('express'),
    inspect = require('util').inspect,
    bugsnag = require("bugsnag"),
    CONFIG = require('config').Server;

// Register the bugsnag notifier
if (process.env.NODE_ENV === "production") {
  bugsnag.register("889ee967ff69e8a6def329190b410677");
};

var dispatcher = new Dispatcher();

dispatcher.load(function(err) {
  if (err) return console.log(err);

  var app = express();
  var port = process.env.PORT || 9000;
  var server = app.listen(port);
  console.log('Express started on port %d', port);

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

})

// Enable keep alive
// server.on('connection', (socket) ->
//   console.log("A new connection was made by a client.")
//   socket.setTimeout(30 * 1000) // 30 second timeout
// )

// Middleware
// app.use(express.bodyParser())
// app.use(app.router)
// app.use((err, req, res, next) ->
//   console.error(err.stack)

//   // res.status(err.status || 500)
//   res.send('500', { messageType: 'Error', text: err.message })
// )

// Routes
// app.post('/', (req, resp) ->
//   // set default content type
//   resp.contentType('application/json; charset=utf-8')

//   console.log("Process message")
//   console.log(req.body)

//   requestContext = new RequestContext(
//     request: req
//     requestBody: req.body
//     response: resp
//   )

//   dispatch.processMessage(requestContext)
// )

// Events happening on clients
// app.post('/mobile/event', (req, resp) ->
//   console.log(req.body)

//   // TODO: Писать в MongoDB или в PostgreSQL с полем json

//   // db.collection('events').insert( req.body, (err, result) ->
//   //   console.log(result)
//   // )
  
//   resp.writeHead(200, 'Content-Type': 'text/plain');
//   resp.end()
// )