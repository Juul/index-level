A simple indexer for leveldb.

Not ready for production use.

# Usage

```
var index = indexer(dataDB, indexDB);

index.add('typeIndex', function(key, value) {
  return value.type;
});

db.put('0', {name: 'cookie', type: 'cat'}, function(err) {
  if(err) return console.error(err);

  index.get('typeIndex', 'cat', function(err, key, value) {
    if(err) return console.error(err);
    console.log("key:", key, "value:", value);
  });
});
```

See `examples/` for details.

If your index function is async, then call `.add` with the async option set:

```
index.add('foo', {async: true}, function(key, value, cb) {
  // do your async work here 
  cb(null, "index_key");
});
```

# API

## .indexer(db, idb, [opts])

The constructor.

* db: The leveldb or sublevel containing your data.
* idb: The leveldb or sublevel to use for index storage.

Opts:

```
rebuild: false // force rebuild on init
```

## .add(indexName, [opts], indexFunction) 

Add a new index. This function is synchronous.

* indexName: Name of index
* indexFunction: Function that returns the index key

Opts: 

```
 async: false // set to true if indexFunc uses a callback
```

The indexFunction will receive the arguments like so:

```
indexFunction(key, value, cb); // cb only present if .add called with {async: true}
```

For {async: false} the indexFunction must return the index key. For {async: true} the callback must be called with the index key as the second argument and potential errors or null/undefined as the first argument.

If no index should be created for the current db key/value pair then the index key returned by indexFunction must be either `undefined` or `null`.

## .add(indexName, indexProperty) 

TODO not implemented

Add a new index. This function is synchronous.

* indexName: Name of index
* indexProperty: Name of property to index by.

indexProperty can be a path, e.g. `creator.name`.

## .add(indexProperty) 

Add a new index. This function is synchronous.

* indexProperty: Name of property to index by.

indexProperty can be a path, e.g. `creator.name`.

The created index will use indexProperty as its name.

## .add(indexPropertyArray) 

TODO not implemented

Same as above but takes an array of property names or paths and creates indexes for all of them.

## .get(indexName, indexKey, cb) 

Use an index to fetch an item from the database.

* indexName: Name of the index to use.
* indexKey: The key in the index.

cb is called like `cb(err, key, value)` where key and value are the key and value from the actual db (not the index db).

## .createReadStream(indexName, opts)

Like the levelup `.createReadStream` function this returns a stream of keys and values from the actual db but the order and range are based on the specified index.

## .del(indexName, cb)

Delete an index. Like .clear but also makes index-level forget the index.

## .clear(indexName, cb)

Clear an index. Deletes all of the index's data in the index db.

## .clearAll(cb)

Run .clear for all indexes.

## .build(indexName, cb)

Build an index from scratch. 

Note: You will likely want to .clear the index first or call .rebuild instead.

## .buildAll(cb)

Run .build for all indexes.

## .rebuild(indexName, cb)

Clear and then build an index.

## .rebuildAll(cb)

Call .rebuild for all indexes.

# TODO

* Unit tests
* Add option to return a leveldown

# License and copyright

License: AGPLv3

Copyright 2016 BioBricks Foundation