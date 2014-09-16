## Welcome to Instacab Dispatcher

Instacab Dispatcher is a Node.js app which coordinates drivers and clients, dispatches ride requests to nearest drivers, keeps GPS logs, provides API via WebSockets for client and driver apps, provides ETA using [Google Distance Matrix](https://developers.google.com/maps/documentation/distancematrix/), provides REST API for `God View` interface to display all clients, drivers and trips in real-time on the map.

## How Does It Work

* Listens port 9000 for API WebSocket connections
* Waits for AMQP (RabbitMQ) messages from [Instacab Backend](https://github.com/tisunov/Instacab/) to update city vehicle options availability
* All client and driver state is kept in memory with Redis as storage between restarts.

## Requirements
* Node.js 0.10.x
* Npm 1.3.x
* Redis 2.8
* MongoDB
* RabbitMQ

## Client API Interface

* TODO

## Driver API Interface

* TODO

## Getting Started

1. Checkout Dispatcher source at the command prompt if you haven't yet:

        git checkout https://github.com/tisunov/InstacabDispatcher

2. At the command prompt, install required npm packages:

        npm install

3. Install and start [RabbitMQ](http://www.rabbitmq.com/download.html)

4. Start Instacab Dispatcher
    
        node app.js

5. Start Instacab Backend

## Setting Up Instacab Backend

Please refer to [Instacab Backend](https://github.com/tisunov/Instacab/)

## Instacab iPhone Client App

Please refer to [Instacab Client](https://github.com/tisunov/InstacabClient/)

## TODO

- [ ] Write unit tests
- [ ] Translate Russian strings
- [ ] Consider ditching WebSockets in favor REST API, we are updating whole app state anyways.
- [ ] Use AMQP to communicate with backend instead HTTP
- [ ] Use [winston](https://github.com/flatiron/winston) for logging