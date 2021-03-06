var ReadPreference = require('./connection/read_preference').ReadPreference
	, Readable = require('stream').Readable
	, CommandCursor = require('./command_cursor').CommandCursor
	, utils = require('./utils')
	, shared = require('./collection/shared')
	, inherits = require('util').inherits;

var AggregationCursor = function(collection, serverCapabilities, options) {	
	var pipe = [];
	var self = this;
	var results = null;	
	var _cursor_options = {};
	// Ensure we have options set up
	options = options == null ? {} : options;

	// If a pipeline was provided
	pipe = Array.isArray(options.pipe) ? options.pipe : pipe;
	// Set passed in batchSize if provided
	if(typeof options.batchSize == 'number') _cursor_options.batchSize = options.batchSize;
	// Get the read Preference
	var readPreference = shared._getReadConcern(collection, options);

	// Set up
	Readable.call(this, {objectMode: true});

	// Contains connection
	var connection = null;

	// Set the read preference
	var _options = { 
		readPreference: readPreference
	};

	// Actual command
	var command = {
			aggregate: collection.collectionName
		, pipeline: pipe
		, cursor: _cursor_options
	}

	// If allowDiskUse is set
	if(typeof options.allowDiskUse == 'boolean') 
		command.allowDiskUse = options.allowDiskUse;
	
	// Command cursor (if we support one)
	var commandCursor = new CommandCursor(collection.db, collection, command);

	// // Internal cursor methods
	// this.find = function(selector) {
	// 	pipe.push({$match: selector});
	// 	return self;
	// }

	// this.unwind = function(unwind) {
	// 	pipe.push({$unwind: unwind});
	// 	return self;
	// }

	// this.group = function(group) {
	// 	pipe.push({$group: group});
	// 	return self;
	// }

	// this.project = function(project) {
	// 	pipe.push({$project: project});
	// 	return self;
	// }

	// this.limit = function(limit) {
	// 	pipe.push({$limit: limit});
	// 	return self;
	// }

	// this.geoNear = function(geoNear) {
	// 	pipe.push({$geoNear: geoNear});
	// 	return self;
	// }

	// this.sort = function(sort) {
	// 	pipe.push({$sort: sort});
	// 	return self;
	// }

	// this.withReadPreference = function(read_preference) {
	// 	_options.readPreference = read_preference;
	// 	return self;
	// }

	// this.withQueryOptions = function(options) {
	// 	if(options.batchSize) {
	// 		_cursor_options.batchSize = options.batchSize;
	// 	}

	// 	// Return the cursor
	// 	return self;
	// }

	// this.skip = function(skip) {
	// 	pipe.push({$skip: skip});
	// 	return self;
	// }

	// this.allowDiskUsage = function(allowDiskUsage) {
	// 	command.allowDiskUsage = allowDiskUsage;
	// 	return self;
	// }

	this.explain = function(callback) {
		if(typeof callback != 'function') 
			throw utils.toError("AggregationCursor explain requires a callback function");
		
		// Add explain options
		_options.explain = true;
		// Execute aggregation pipeline
		collection.aggregate(pipe, _options, function(err, results) {
			if(err) return callback(err, null);
			callback(null, results);
		});
	}

	// this.maxTimeMS = function(maxTimeMS) {
	// 	if(typeof maxTimeMS != 'number') {
	// 		throw new Error("maxTimeMS must be a number");
	// 	}

	// 	// Save the maxTimeMS
	// 	_options.maxTimeMS = maxTimeMS
	// 	// Set the maxTimeMS on the command cursor
	// 	commandCursor.maxTimeMS(maxTimeMS);
	// 	return self;
	// }

	this.get = function(callback) {
		if(typeof callback != 'function') 
			throw utils.toError("AggregationCursor get requires a callback function");		
	  // Checkout a connection
	  var _connection = collection.db.serverConfig.checkoutReader(_options.readPreference);
	  // Fall back
		if(!_connection.serverCapabilities.hasAggregationCursor) {
			return collection.aggregate(pipe, _options, function(err, results) {
				if(err) return callback(err);
				callback(null, results);
			});			
		}

		// Execute get using command Cursor
		commandCursor.get({connection: _connection}, callback);
	}

	this.getOne = function(callback) {
		if(typeof callback != 'function') 
			throw utils.toError("AggregationCursor getOne requires a callback function");		
		// Set the limit to 1
		pipe.push({$limit: 1});
		// For now we have no cursor command so let's just wrap existing results
		collection.aggregate(pipe, _options, function(err, results) {
			if(err) return callback(err);
			callback(null, results[0]);
		});
	}

	this.each = function(callback) {
	  // Checkout a connection if we have none
	  if(!connection)
	  	connection = collection.db.serverConfig.checkoutReader(_options.readPreference);
	  
	  // Fall back
		if(!connection.serverCapabilities.hasAggregationCursor) {
			collection.aggregate(pipe, _options, function(err, _results) {
				if(err) return callback(err);

				while(_results.length > 0) {
					callback(null, _results.shift());
				}

				callback(null, null);
			});
		}

		// Execute each using command Cursor
		commandCursor.each({connection: connection}, callback);		
	}

	this.next = function(callback) {
		if(typeof callback != 'function') 
			throw utils.toError("AggregationCursor next requires a callback function");		

	  // Checkout a connection if we have none
	  if(!connection)
	  	connection = collection.db.serverConfig.checkoutReader(_options.readPreference);
	  
	  // Fall back
		if(!connection.serverCapabilities.hasAggregationCursor) {
			if(!results) {
				// For now we have no cursor command so let's just wrap existing results
				return collection.aggregate(pipe, _options, function(err, _results) {
					if(err) return callback(err);
					results = _results;
	        
	        // Ensure we don't issue undefined
	        var item = results.shift();
	        callback(null, item ? item : null);
				});			
			}

	    // Ensure we don't issue undefined
	    var item = results.shift();
	    // Return the item
	    return callback(null, item ? item : null);
	  }

		// Execute next using command Cursor
		commandCursor.next({connection: connection}, callback);		
	}

	//
	// Close method
	//
	this.close = function(callback) {
		if(typeof callback != 'function') 
			throw utils.toError("AggregationCursor close requires a callback function");		

	  // Checkout a connection if we have none
	  if(!connection)
	  	connection = collection.db.serverConfig.checkoutReader(_options.readPreference);

	  // Fall back
		if(!connection.serverCapabilities.hasAggregationCursor) {
			return callback(null, null);
		}

		// Execute next using command Cursor
		commandCursor.close({connection: connection}, callback);		
	}

	//
	// Stream method
	//
	this._read = function(n) {
		self.next(function(err, result) {
			if(err) {
				self.emit('error', err);
				return self.push(null);
			}

			self.push(result);
		});
	}
}

// Inherit from Readable
if(Readable != null) {
	inherits(AggregationCursor, Readable);	
}

// Exports the Aggregation Framework
exports.AggregationCursor = AggregationCursor;