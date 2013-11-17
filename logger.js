var logger = exports;
 logger.debugLevel = 'warn';
 logger.log = function(level, message) {
   var levels = ['error', 'warn', 'info'];
   if (levels.indexOf(level) >= levels.indexOf(logger.debugLevel) ) {
     if (typeof message !== 'string') {
       message = JSON.stringify(message);
     };
     console.log(level+': '+message);
   }
 }

 // usage:
 // var logger = require('./logger');
 // logger.debugLevel = 'warn';
 // logger.log('info', 'Everything started properly.');
 // logger.log('warn', 'Running out of memory...');
 // logger.log('error', { error: 'flagrant'});