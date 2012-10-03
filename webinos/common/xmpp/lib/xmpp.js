/*******************************************************************************
*  Code contributed to the webinos project
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*
*******************************************************************************/

/**
 * This class handles all XMPP related stuff
 * 
 * Reused and updated the orginal XmppDemo code of Victor Klos
 * Author: Eelco Cramer, TNO
 */

var ltx = require('ltx');
var sys = require('util');
var crypto = require('crypto');
var nodeType = 'http://webinos.org/pzp';
var connection;
var EventEmitter = require('events').EventEmitter;
var WebinosFeatures = require('./WebinosFeatures.js');
var logger = require('./Logger').getLogger('xmpp', 'trace');

var xmpp;

//TODO make members and functions that should be private private

function Connection(rpcHandler) {
	EventEmitter.call(this);
	
	connection = this;

	this.rpcHandler = rpcHandler;
	this._uniqueId = Math.round(Math.random() * 10000);

	this.basicFeatures = ["http://jabber.org/protocol/caps", 
				 	 	  "http://jabber.org/protocol/disco#info",
                   	 	  "http://jabber.org/protocol/commands"];
    
    this.sharedFeatures = {};    // services that the app wants shared
    this.remoteFeatures = {};    // services that are shared with us, assoc array of arrays
    this.pendingRequests = {};   // hash to store <stanza id, geo service> so results can be handled
    this.featureMap = {};        // holds features, see initPresence() for explanation
}

sys.inherits(Connection, EventEmitter);
exports.Connection = Connection;

/**
 * params[jid]: full jid of the user.
 * params[password]: password of the user.
 * (optional) params[bosh]: address of the BOSH server, for example: http://xmpp.servicelab.org:80/jabber
 */
Connection.prototype.connect = function(params, onOnline) {
	logger.verbose("Entering connect()");
	this.remoteFeatures = new Array;
	this.pendingRequests = new Array;
	
	var self = this;

	if (params['bosh'] === undefined) {
		xmpp = require('node-xmpp');
		this.client = new xmpp.Client(params);
	} else {
		xmpp = require('node-bosh-xmpp');
		this.client = new xmpp.Client(params['jid'], params['password'], params['bosh']);
	}

	this.client.on('online',
		function() {
			logger.debug("XMPP client is online.");
			self.updatePresence();
			onOnline();
		}
	);
	
	this.client.on('end', function() {
		logger.debug("XMPP connection has been terminated.");
		this.emit('end');
	});

	this.client.on('stanza', this.onStanza);

	this.client.on('error', this.onError);
}

Connection.prototype.disconnect = function() {
	this.client.end();
}

/**
 * Adds a feature to the shared services and updates the presence accordingly.
 */
Connection.prototype.shareFeature = function(feature) {
    logger.debug("Sharing service with ns:" + feature.ns);
    this.sharedFeatures[feature.id] = feature;
	this.updatePresence();
}

/**
 * Removes a feature from the shared services and updates the presence accordingly.
 */
Connection.prototype.unshareFeature = function(feature) {
    logger.debug("Unsharing service with ns: " + feature.ns);
    delete this.sharedFeatures[feature.id];
    this.updatePresence();
}

Connection.prototype.updatePresence = function() {
	var allFeatures = this.basicFeatures.slice(0); // copies the basic features
	
	for (var key in this.sharedFeatures) { // add the shared features
	    logger.trace('Adding shared feature: ' + this.sharedFeatures[key].ns + '#' + this.sharedFeatures[key].id);
		allFeatures.push(this.sharedFeatures[key].ns + '#' + this.sharedFeatures[key].id);
	}

	allFeatures = allFeatures.sort();

	var s = "client/device//Webinos 0.1.0<";

	for (var feature in allFeatures) {
		s = s + feature + "<";
	}
	
	hash = crypto.createHash('sha1');
	hash.update(s);
	var ver = hash.digest(encoding='base64');
	
	this.featureMap[ver] = allFeatures;
	
    this.sendPresence(ver);
}

/**
 * Called to invoke a remote feature. Params is optional.
 */
Connection.prototype.invokeFeature = function(feature, callback, method, params) {
	logger.trace('Invoking feature ' + feature.ns + ' on ' + feature.device);

	var id = connection.getUniqueId('feature');
	connection.pendingRequests[id] = callback;
	
	var payload = {
	    'method': method,
	    'params': params,
	    'id': id
	}
	
	//TODO do something with optional params.	
	var xmppInvoke = new xmpp.Element('iq', { 'to': feature.device, 'type': 'get', 'id': id }).
		c('query', {'xmlns': feature.ns}).
		c('payload', {'xmlns': 'webinos:rpc#invoke', 'id': feature.id }).t(JSON.stringify(payload));
		
	logger.trace('Sending RPC message via XMPP: ' + xmppInvoke.tree());
	connection.client.send(xmppInvoke);
}

// Send presence notification according to http://xmpp.org/extensions/xep-0115.html
Connection.prototype.sendPresence = function(ver) {
    if (xmpp) {
        logger.verbose("XEP-0115 caps: " + this.featureMap[ver]);

    	var presence = new xmpp.Element('presence', { }).
    		c('c', {
    			'xmlns': 'http://jabber.org/protocol/caps',
    		  	'hash': 'sha-1',
    		  	'node': nodeType,
    		  	'ver': ver
    	});

    	logger.verbose('Presence message: ' + presence);

    	this.client.send(presence);
    }
}

Connection.prototype.onStanza = function(stanza) {
	logger.verbose('Stanza received = ' + stanza);
	
	if (stanza.is('presence') && stanza.attrs.type !== 'error') {
		if (stanza.attrs.type == 'unavailable') {
			// in scope of client so call back to connection
			connection.onPresenceBye(stanza);
		} else if (stanza.getChild('c', 'http://jabber.org/protocol/caps') != null) {
			connection.onPresenceCaps(stanza);
		} else if (stanza.attrs.type == 'result' && stanza.getChild('query', 'http://jabber.org/protocol/disco#info') != null) {
			connection.onPresenceDisco(stanza);
		}
	}
	
	if (stanza.is('iq')) { //&& stanza.attrs.type !== 'error') {
		if (stanza.attrs.type == 'get' && stanza.getChild('query', 'http://jabber.org/protocol/disco#info') != null) {
			connection.onDiscoInfo(stanza);
		} else if (stanza.attrs.type == 'result' && stanza.getChild('query', 'http://jabber.org/protocol/disco#info') != null) {
			connection.onPresenceDisco(stanza);
		} else if (stanza.attrs.type === 'result' || stanza.attrs.type === 'error') {
			// handle results of queries.
			
			var callback = connection.pendingRequests[stanza.attrs.id];
			
			if (callback == null) {
				logger.warn("Received a result for an unknown request id: " + stanza.attrs.id);
			} else {
				// dispatch the result to the 
				var query = stanza.getChild('query');
				delete connection.pendingRequests[stanza.attrs.id];
				
				logger.debug("Received RPC answer via XMPP: " + stanza);
				
				var payload = query.getChild('payload');
				
				callback(stanza.attrs.type, JSON.parse(payload.getText()));
			}
		} else if (stanza.attrs.type == 'get' || stanza.attrs.type == 'set') {
			var query = stanza.getChild('query');
			var found = false;
			
			if (query != null && query.attrs.xmlns != null) {
    			var payload = JSON.parse(query.getChild('payload').getText());
				var feature = connection.sharedFeatures[payload.attr.id];

				if (feature != null) {
					feature.invokedFromRemote(stanza, payload.method, payload.params, payload.id);
				} else {
					// default respond with an error
					this.send(new xmpp.Element('iq', { 'id': stanza.attrs.id, 'type': 'result', 'to': stanza.attrs.from }).c('service-unavailable'));
				}
			} else {
				// default respond with an error
				this.send(new xmpp.Element('iq', { 'id': stanza.attrs.id, 'type': 'result', 'to': stanza.attrs.from }).c('service-unavailable'));
			}
		}
	}
}

/**
 * Answers the info query.
 */
Connection.prototype.answer = function(stanza, id, result) {
	var query = stanza.getChild('query');
	
    var payload = {
        'result': result,
        'id': id
    }
    
	var xmppResult = new xmpp.Element('iq', { 'id': stanza.attrs.id, 'type': 'result', 'to': stanza.attrs.from }).
		c('query', { xmlns: query.attrs.xmlns }).
		c('payload', { 'xmlns': 'webinos:rpc#result', 'id': query.getChild('payload').attrs.id }).t(JSON.stringify(payload));

	logger.debug("Answering RPC with this XMPP message: " + xmppResult.tree());
		
	this.client.send(xmppResult);
}

/**
 * Answers the info query with an error.
 */
Connection.prototype.error = function(stanza, id, error) {
	var query = stanza.getChild('query');
	
    var payload = {
        'error': error,
        'id': id
    }
    
	var xmppResult = new xmpp.Element('iq', { 'id': stanza.attrs.id, 'type': 'error', 'to': stanza.attrs.from }).
		c('query', { xmlns: query.attrs.xmlns }).
		c('payload', { 'xmlns': 'webinos:rpc#result', 'id': query.getChild('payload').attrs.id }).t(JSON.stringify(payload));

	logger.debug("Answering RPC with this XMPP message: " + xmppResult.tree());
		
	this.client.send(xmppResult);
}

Connection.prototype.onPresenceBye = function(stanza) {
	var from = stanza.attrs.from;
	
	if (this.remoteFeatures[from] != null) {
		logger.verbose('Number of features to be removed: ' + this.remoteFeatures[from].length);
		
		for (var i=0; i<this.remoteFeatures[from].length; i++) {
			try {
				logger.verbose('Feature = ' + this.remoteFeatures[from][i].ns);
			} catch (err) {
				logger.warn(err);
			}

			if (this.remoteFeatures[from][i] != null) {
				this.remoteFeatures[from][i].remove();
				delete this.remoteFeatures[from][i];
			}
		}
	}
	
	delete this.remoteFeatures[from];
	
	logger.debug(from + ' has left the building.');
}

Connection.prototype.onDiscoInfo = function(stanza) {
	var currentFeatures;
	var query = stanza.getChild('query', 'http://jabber.org/protocol/disco#info');

	if (stanza.attrs.from == null) {
		return;
	}

	if (query.attrs.node != null) {
		var node = query.attrs.node;
		var ver = node.substring(nodeType.length + 1);
		
		logger.debug("Received service discovery information request: " + stanza);
		
		logger.verbose("Received feature request for version: " + ver);
		logger.verbose("Returning the features for this version: " + this.featureMap[ver]);
		
		currentFeatures = this.featureMap[ver];
	} else {
		// return current features
		currentFeatures = this.basicFeatures.slice(0);
		
		for (var key in this.sharedFeatures) { // add the shared features
		    logger.trace('Adding shared feature: ' + this.sharedFeatures[key].ns + '#' + this.sharedFeatures[key].id);
			currentFeatures.push(this.sharedFeatures[key].ns + '#' + this.sharedFeatures[key].id);
		}

		currentFeatures = currentFeatures.sort();
	}

	var resultQuery = new ltx.Element('query', {xmlns: query.attrs.xmlns});
	
	resultQuery.c('identity', {'category': 'client', 'type': 'webinos'});
	
	for (var i in currentFeatures) {
	    logger.trace('key found: ' + currentFeatures[i]);
	    var splitted = currentFeatures[i].split('#');
	    var id = splitted[splitted.length - 1];
	    
	    logger.trace('Feature id found: ' + id);
	    
	    if (id && this.sharedFeatures[id]) {
	        // a webinos feature
	        logger.trace('Feature found: ' + id);
    	    var feature = this.sharedFeatures[id];

            var instanceNode = new ltx.Element('instance', {'xmlns': 'webinos:rpc#disco', 'id': feature.id });
            instanceNode.cnode(new ltx.Element('displayName').t(feature.displayName));
            instanceNode.cnode(new ltx.Element('description').t(feature.description));

            var featureNode = new ltx.Element('feature', {'var': feature.ns});
            featureNode.cnode(instanceNode);
    		resultQuery.cnode(featureNode);
	    } else {
	        // an xmpp feature
	        var feature = currentFeatures[i];

            var featureNode = new ltx.Element('feature', {'var': feature});
    		resultQuery.cnode(featureNode);
	    }
	}
	
	var result = new xmpp.Element('iq', { 'to': stanza.attrs.from, 'type': 'result', 'id': stanza.attrs.id });
	result.cnode(resultQuery);
	
	logger.debug("Anwering service discovery information request: " + result.tree());
	
	this.client.send(result);
}

Connection.prototype.onPresenceCaps = function (stanza) {
	var c = stanza.getChild('c', 'http://jabber.org/protocol/caps');
	
	logger.verbose("Capabilities received, for now we always query for the result.");
	logger.debug("Received new capabilities from " + stanza.attrs.from);
	logger.debug("XMPP message = " + stanza);
	
	var discoInfoQuery = new xmpp.Element('iq', { 'to': stanza.attrs.from, 'type': 'get', 'id': this.getUniqueId('disco')}).
		c('query', { 'xmlns': 'http://jabber.org/protocol/disco#info', 'node': c.attrs.node + '#' + c.attrs.ver});
	
	logger.debug("Sending a query to find out what these capabilities are: " + discoInfoQuery.tree());
	
	this.client.send(discoInfoQuery);
	
	//TODO save transaction number and lookup the correct transaction for this result.
}

Connection.prototype.onPresenceDisco = function (stanza) {
	logger.verbose('Entering onPresenceDisco');
	
	logger.debug('Received answer on capability query: ' + stanza);
	
	var query = stanza.getChild('query', 'http://jabber.org/protocol/disco#info');
    var from = stanza.attrs.from;

	var featureNodes = query.getChildren('feature');
	var discoveredFeatures = new Array;
	
	var currentFeatures = this.remoteFeatures[from];
	var removedFeatures = new Array;
	
	if (currentFeatures != null) {
		removedFeatures = currentFeatures.slice(0);
	}
	
	for (var i in featureNodes) {
		var ns = featureNodes[i].attrs.var;
		
		var instance = featureNodes[i].getChild('instance');

		if (instance && instance.attrs.xmlns == 'webinos:rpc#disco') {
    		logger.trace('Found instance for <' + ns + '>: ' + instance);

		    // all webinos services should have an instance element
    		var alreadyExists = false;

    		for (var j in currentFeatures) {
    			var feature = currentFeatures[j];

    			if (feature.ns == ns && feature.remoteId == instance.attrs.id) {
    				logger.verbose('Feature still exsists, do not remove it! ' + ns);
    				delete removedFeatures[j]; // if the feature still exsist it should not be removed
    				alreadyExists = true;
    				break;
    			}
    		}

    		if (!alreadyExists) {
    			logger.verbose('New feature, creating and adding it with id: ' + instance.attrs.id);
    			this.createAndAddRemoteFeature(ns, from, instance.attrs.id, instance.getChild('displayName').getText(), instance.getChild('description').getText());
    			logger.verbose('Done creating the feature');
    		}

    		discoveredFeatures.push(ns);
		}
	} 

	logger.verbose('Removing ' + removedFeatures.length + ' feature(s) that have not been rediscovered.');

	for (var i in removedFeatures) {
		//removedFeatures[i].remove();
		
		for (var j in this.remoteFeatures[from]) {
			if (removedFeatures[i].ns == this.remoteFeatures[from][j].ns) {
				logger.verbose("Removed feature from remote feature list: " + removedFeatures[i].ns);
				this.remoteFeatures[from][j].remove();
				delete this.remoteFeatures[from][j];
				this.emit('removeFeature', removedFeatures[i]);
			}
		}
	}

    logger.debug(from + ' is now sharing these services: ' + discoveredFeatures.join(" & ") );
}

Connection.prototype.sharedServicesForNamespace = function(ns) {
	logger.verbose("Entering sharedServicesForNamespace: " + ns);
	
	var result = new Array;
	
	for (var key in this.remoteFeatures) {
		logger.verbose('Checking ' + this.remoteFeatures[key].length + ' features of ' + key + '...');

		for (var i=0; i<this.remoteFeatures[key].length; i++) {
			logger.verbose('Checking feature with index: ' + i);

			if (typeof this.remoteFeatures[key][i] === 'undefined') {
				// I experienced something that might point to a race condition here.
				// sometimes the remoteFeatures array had a feature of undefined type in there. It looks like some items
				// do not get removed from the array correctly all the time. This works around the issue. 
				delete this.remoteFeatures[key][i];
			} else {
				logger.verbose("Checking feature: " + this.remoteFeatures[key][i].ns + " from " + this.remoteFeatures[key][i].device);

				if (this.remoteFeatures[key][i].ns == ns) {
					result.push(this.remoteFeatures[key][i]);
				}
			}
		}
	}

	logger.verbose("Exiting sharedServicesForNamespace with " + result.length + " results.");
	
	return result;
}

Connection.prototype.onError = function(error) {
	logger.warn(error);
}

// Helper function that creates a service, adds it to the administration and invokes the callback
Connection.prototype.createAndAddRemoteFeature = function(name, from, id, displayName, description) {
	logger.verbose('Entering createAndAddRemoteFeature(' + JSON.stringify(arguments) + ')');
	
	var factory = WebinosFeatures.factory[name];

	if (factory != null) {
		logger.verbose('Factory != null');
		
		feature = factory(this.rpcHandler);
	    feature.device = from;
	    feature.owner = this.getBareJidFromJid(from);
	    feature.local = false;
	    feature.displayName = displayName + "#" + id;
	    feature.description = description;
	    feature.remoteId = id;
	    //feature.id = this.jid2Id(from) + '-' + name;

		if (!this.remoteFeatures[from]) {
			this.remoteFeatures[from] = new Array;
		}

	    this.remoteFeatures[from].push(feature);

	    logger.verbose('Created and added new service of type ' + name);

		this.emit(feature.ns, feature);
		this.emit('newFeature', feature);
		feature.on('invoke-via-xmpp', this.invokeFeature);
	}
	
	logger.verbose('End createAndAddRemoteFeature');
}

// Helper function to return a 'clean' id string based on a jid
Connection.prototype.jid2Id = function (jid) {
    return jid.split(/@|\/|\./).join("_");
}

/** Function: getBareJidFromJid
 *  Get the bare JID from a JID String.
 *
 *  Parameters:
 *    (String) jid - A JID.
 *
 *  Returns:
 *    A String containing the bare JID.
 */
Connection.prototype.getBareJidFromJid = function (jid)
{
    return jid.split("/")[0];
}

/** Function: getUniqueId
 *  Generate a unique ID for use in <iq/> elements.
 *
 *  All <iq/> stanzas are required to have unique id attributes.  This
 *  function makes creating these easy.  Each connection instance has
 *  a counter which starts from zero, and the value of this counter
 *  plus a colon followed by the suffix becomes the unique id. If no
 *  suffix is supplied, the counter is used as the unique id.
 *
 *  Suffixes are used to make debugging easier when reading the stream
 *  data, and their use is recommended.  The counter resets to 0 for
 *  every new connection for the same reason.  For connections to the
 *  same server that authenticate the same way, all the ids should be
 *  the same, which makes it easy to see changes.  This is useful for
 *  automated testing as well.
 *
 *  Parameters:
 *    (String) suffix - A optional suffix to append to the id.
 *
 *  Returns:
 *    A unique string to be used for the id attribute.
 */
Connection.prototype.getUniqueId = function (suffix) {
    if (typeof(suffix) == "string" || typeof(suffix) == "number") {
        return ++this._uniqueId + ":" + suffix;
    } else {
        return ++this._uniqueId + "";
    }
}
