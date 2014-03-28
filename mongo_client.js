var mongo = require('mongoskin');

module.exports = mongo.db("mongodb://localhost:27017/instacab", {native_parser:true});
