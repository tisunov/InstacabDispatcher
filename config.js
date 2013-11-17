var caminte = require('caminte'),
    Schema = caminte.Schema,
    db = {
         driver     : "redis",
         host       : "localhost",
         port       : "6379"
    };

exports.schema = new Schema(db.driver, db);
exports.redis = require("redis").createClient();