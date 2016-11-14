#!/usr/bin/env node

var level = require('level');
var sublevel = require('subleveldown');
var indexer = require('../index.js');

var rawdb = level('raw');
var db = sublevel(rawdb, 'd', {valueEncoding: 'json'});
var idb = sublevel(rawdb, 'i');

var index = indexer(db, idb);

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
