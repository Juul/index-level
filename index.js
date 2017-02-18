
var through = require('through2');
var sublevel = require('subleveldown');
var xtend = require('xtend');
var async = require('async');
var changes = require('level-changes');


// resolve a path like ['foo', 'bar', 'baz']
// to return the value of obj.foo.bar.baz
// or undefined if tha path does not exist
function resolvePropPath(obj, path) {

  if(path.length > 1) {
    if(!obj[path[0]]) return undefined;

    return resolvePropPath(obj[path[0]], path.slice(1, path.length));
  }

  if(path.length === 1) {
    return obj[path[0]];
  }

  return undefined;
}

function indexer(db, idb, opts) {
  if(!(this instanceof indexer)) return new indexer(db, idb, opts);

  this.db = db;
  this.idb = sublevel(idb, 'i'); // the index db
  this.rdb = sublevel(idb, 'r'); // the reverse lookup db

  this.opts = xtend({
    rebuild: false // force rebuild on init
  }, opts || {});

  this.indexes = {};

  this.c = changes(this.db);
  this.c.on('data', function(change) {
    if(change.type === 'put') {
      this._updateIndexes(change.key, change.value);
    } else { // del
      this._deleteFromIndex(change.key);
    }
  }.bind(this));

  if(this.opts.rebuild) {
    this.rebuildAll();
  }

  this._updateIndexes = function(key, value, cb) {
    cb = cb || this._nullFunc;

    var self = this;

    async.eachOf(this.indexes, function(idx, idxName, cb) {
      self._updateIndex(idx, key, value, cb);
    }, cb);
  }

  this._nullFunc = function(){};

  this._updateIndex = function(idx, key, value, cb) {
    cb = cb || this._nullFunc;
    if(!idx.f) return;
    
    if(idx.async) {
        idx.f(key, value, function(err, indexKey) {
          if(err) return cb(err);;
          if(indexKey === undefined || indexKey === null) return cb();

          async.parallel([function(cb) {
            idx.db.put(indexKey, key, cb);
          }, function(cb) {
            idx.rdb.put(key, indexKey, cb);
          }], cb);
        })
      } else {
        try {
          var indexKey = idx.f(key, value);
        } catch(err) {
          return cb(err);
        }

        if(indexKey === undefined || indexKey === null) return cb();
        async.parallel([function(cb) {
          idx.db.put(indexKey, key, cb);
        }, function(cb) {
          idx.rdb.put(key, indexKey, cb);
        }], cb);
      }
  }

  this._deleteFromIndex = function(key, cb) {
    cb = cb || this._nullFunc;
    var k, idx;

    // TODO this is broken. Needs to use async
    for(k in this.indexes) {
      idx = this.indexes[k];

      idx.rdb.get(key, function(err, indexKey) {
        if(err) return;
        async.parallel([function(cb) {
          idx.db.del(indexKey, cb);
        }, function(cb) {
          idx.rdb.del(key);
        }], cb);
      })
    }
  }

  // return an indexer that indexes by property
  this._propIndexer = function(propPath, opts) {
    opts = opts || {};
    if(!(propPath instanceof Array)) propPath = propPath.split('.');

    return function(key, value) {
      return resolvePropPath(value, propPath);
    };
  }

  this.add = function(name, opts, indexBy) {

    // check for calling convention: .add(['propName1', 'propName2'])
    if(name instanceof Array) {
      var i;
      for(i=0; i < name.length; i++) {
        this.add(name[i], opts);
      }
      return;
    }

    // check for calling without opts but with index function or property name
    if(typeof opts === 'function' || typeof opts === 'string') {
      indexBy = opts;
      opts = {};
    }

    opts = xtend({
      async: false // set to true if indexFunc uses a callback
    }, opts || {});

    var indexFunc;
    // check for calling convention: .add('propName', [opts])
    if(!indexBy && (!opts || typeof opts === 'object')) {
      indexFunc = this._propIndexer(name);

    // check for calling convention: .add('indexName', [opts], 'propName')
    } else if(typeof indexBy === 'string') {
      indexFunc = this._propIndexer(indexBy);
    } else {
      indexFunc = indexBy;
    }

    if(this.indexes[name]) return new Error("Index already exists");
    this.indexes[name] = {
      name: name,
      f: indexFunc,
      db: sublevel(this.idb, name),
      rdb: sublevel(this.rdb, name), // reverse lookup
      async: opts.async
    };
  };

  this.del = function(name, cb) {
    if(!this.indexes[name]) return new Error("Index does not exist");
    this.indexes[name].f = undefined;
    var self = this;
    this.clear(name, function(err) {
      if(err) return cb(err);
      delete self.indexes[name]
      cb();
    }.bind(self))
  };

  // clear an index (delete the index data from the db)
  this.clear = function(name, opts, cb) {
    if(typeof opts === 'function') {
      cb = opts;
      opts = {};
    }

    cb = cb || this._nullFunc;
    opts = opts || {};
    var db, rdb;

    if(opts.all) {
      db = this.idb;
      rdb = this.rdb;
    } else {
      if(this.indexes[name]) {
        db = this.indexes[name].db;
        rdb = this.indexes[name].rdb;
      } else {
        db = sublevel(this.idb, name);
        rdb = sublevel(this.rdb, name);
      }
    }

    // delete entire index
    var s = db.createReadStream();
    s.pipe(through.obj(function(data, enc, next) {
      db.del(data.key, function() {
        next();
      });
    }, function() {
      // delete entire reverse lookup index
      var rs = db.createReadStream();
      rs.pipe(through.obj(function(data, enc, next) {
        rdb.del(data.key, function() {
          next();
        });
      }, function() {
        cb();
      }));

      rs.on('error', function(err) {
        return cb(err);
      });
    }));

    s.on('error', function(err) {
      return cb(err);
    });

  };

  // clear all indexes (delete the index data from the db)
  this.clearAll = function(cb) {
    cb = cb || this._nullFunc;

    this.clear(null, {all: true}, cb);
  };

  // build an index from scratch for existing contents of the db
  this.build = function(indexName, cb) {
    cb = cb || this._nullFunc;

    var idx = this.indexes[indexName];
    if(!idx) throw new Error("Index does not exist");

    var self = this;
    var s = this.db.createReadStream();
    s.on('data', function(data) {
      self._updateIndex(idx, data.key, data.value);
    });

    s.on('error', function(err) {
      return cb(err);
    });

    s.on('end', function() {
      return cb();
    });
  };

  // build all indexes from scratch for existing contents of the db
  this.buildAll = function(cb) {
    cb = cb || this._nullFunc;

    var self = this;
    async.eachOf(this.indexes, function(i, key, cb) {
      self.build(key, cb);
    }, cb);
  };

  // clear and then build an index from scratch for existing contents of the db
  this.rebuild = function(name, cb) {
    cb = cb || this._nullFunc;
    var self = this;
    this.clear(name, function(err) {
      if(err) return cb(err);

      self.build(name, cb);
    });
  };

  // clear and then build all indexes from scratch for existing contents of the db
  this.rebuildAll = function(name, cb) {
    cb = cb || this._nullFunc;

    var self = this;
    this.clearAll(function(err) {
      if(err) return cb(err);

      self.buildAll(cb);
    });
  };

  this.get = function(indexName, indexKey, cb) {
    var idx = this.indexes[indexName];
    if(!idx) return cb(new Error("Index does not exist"));
    
    idx.db.get(indexKey, function(err, key) {
      if(err) return cb(err);

      this.db.get(key, function(err, value) {
        if(err) return cb(err);
        cb(null, key, value);
      });
    }.bind(this));
  };

  this.createReadStream = function(indexName, opts) {
    opts = xtend({
      keys: true, // output keys
      values: true // output values
    }, opts || {});    
    var idx = this.indexes[indexName];
    if(!idx) return cb(new Error("Index does not exist"));

    var out = through.obj(function(obj, enc, next) {
      idx.db.get(obj.key, function(err, value) {
        if(err) return next(err);
        if(opts.keys && opts.valyues) {
          this.push({key: obj.key, value: value});
        } else if(opts.values) {
          this.push(value);
        } else {
          this.push(obj.key);
        }
        next();
      }.bind(this));
    });
    
    idx.db.createReadStream(opts).pipe(out);
    return out;
  };

  this.createKeyStream = function(indexName, opts) {
    opts = opts || {};
    opts.keys = true;
    opts.values = false;
    return this.createReadStream(indexName, opts);
  };

  this.createValueStream = function(indexName, opts) {
    opts = opts || {};
    opts.keys = false;
    opts.values = true;
    return this.createReadStream(indexName, opts);
  };

}

module.exports = indexer;
