#!/usr/bin/env node

var level = require('level');
var sublevel = require('subleveldown');
var indexer = require('../index.js');

var rawdb = level('/tmp/raw');
var db = sublevel(rawdb, 'd', {valueEncoding: 'json'});
var idb = sublevel(rawdb, 'i');

var index = indexer(db, idb);

index.add('typeIndex', function(key, value) {
  return value.type;
});

index.add('author.name');

db.put('0', {type: 'cookie', author: { name: 'cat' }}, function(err) {
  if(err) return console.error(err);

  index.get('typeIndex', 'cookie', function(err, key, value) {
    if(err) return console.error(err);
      console.log("typeIndex key:", key, "value:", value);
    index.get('author.name', 'cat', function(err, key, value) {
      if(err) return console.error(err);
      console.log("author.name key:", key, "value:", value);
    })
  });
});
