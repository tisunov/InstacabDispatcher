var amqp = require('amqplib'),
    util = require('util'),
    clients = require('./models/client').repository,
    city = require('./models/city');

var CITY_UPDATES_QUEUE = 'city_updated';
var CLIENT_UPDATES_QUEUE = 'client_updated';


// Messaging in Node.JS with RabbitMQ
// https://github.com/squaremo/rabbit.js

amqp.connect('amqp://localhost').then(function(conn) {
  process.once('SIGINT', function() { 
    conn.close(); 
    process.exit(0);
  });

  return conn.createChannel().then(function(channel) {
    
    var cityOk = channel.assertQueue(CITY_UPDATES_QUEUE, {durable: false});
    
    cityOk = cityOk.then(function(_qok) {
      return channel.consume(CITY_UPDATES_QUEUE, function(msg) {
        var content = JSON.parse(msg.content)
        console.log(" [City] Received:");
        console.log(util.inspect(content, {depth: 3}));

        city.update(content);

        channel.ack(msg);
      });
    });

    cityOk.then(function(_consumeOk) {
      console.log(' [*] AMQP Consumer waiting for messages');
    });

    var clientOk = channel.assertQueue(CLIENT_UPDATES_QUEUE, {durable: false});
    
    cityOk = cityOk.then(function(_qok) {
      return channel.consume(CLIENT_UPDATES_QUEUE, function(msg) {

        if (!msg.content) return;

        var update = JSON.parse(msg.content);

        clients.get(update.id, function(err, client) {
          if (client) client.update(update);
        });

        channel.ack(msg);
      });
    });


  });
}).then(null, console.warn);
