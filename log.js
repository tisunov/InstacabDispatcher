var logger = require('winston');
var Loggly = require('winston-loggly').Loggly;
var loggly_options = { subdomain: "node.instacab.ru", inputToken: "efake000-000d-000e-a000-xfakee000a00" }

logger.add(Loggly, loggly_options);
// logger.add(winston.transports.File, { filename: "logs/production.log" });
logger.info('Chill Winston, the logs are being captured 2 ways - console and Loggly');

module.exports=logger;