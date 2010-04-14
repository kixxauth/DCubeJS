//

/*jslint
onevar: true,
undef: true,
nomen: true,
eqeqeq: true,
plusplus: true,
bitwise: true,
regexp: true,
strict: true,
newcap: false,
immed: true,
maxlen: 80
*/

/*global
Components: false,
dump: false
*/

"use strict";

///////////////////////////////////////////////////////////////////////////////
// For Mozilla JavaScript modules system.
var EXPORTED_SYMBOLS = ["exports"];

// If we are in the Mozilla module system we need to add some boilerplate to be
// CommonJS complient. This is obviously an ugly hack to allow integration with
// legacy code that uses the Mozilla module system.
function require(id) {
	var m = Components.utils.import(
			"resource://chrometest/resources/"+ id +".js", null);
	return ((typeof m.exports === "object") ? m.exports : m);
}

var exports = {};
var module = {id: "dcube"};

var setTimeout = (function () {
	var timer = Components.classes["@mozilla.org/timer;1"]
			.createInstance(Components.interfaces.nsITimer);

	return function(fn, time) {
		timer.initWithCallback({notify: fn}, time,
			Components.interfaces.nsITimer.TYPE_ONE_SHOT);
		return timer;
	};
}());

///////////////////////////////////////////////////////////////////////////////


var DEBUG = false,
	DOMAIN = "http://localhost",
	LOG,
	ENQ,
	PROMISE,
	XHR,
	JSONRequest,
	REQ,
	CACHE,
	CXN,
	USER,
	$N = {}, $A = [], $F = function(){},
	isObject, isArray, confirmObject, confirmArray, confirmFunc;

// Used throughout this module to inform the interface of exceptions that are
// not expected.  These exceptions should always be logged internally.
function unexpected_Exception(msg) {
	var self = new Error(msg || "unkown");
	self.name = "DCubeUnexpected";
	self.constructor = arguments.callee;
	return self;
}
exports.unexpectedException = unexpected_Exception;

// Used in the public API anywhere the network protocol is not working as
// expected.
function offline_Exception(msg) {
	var self = new Error(msg || "unexpected");
	self.name = "DCubeOffline";
	self.constructor = offline_Exception;
	return self;
}
exports.offlineException = offline_Exception;

// Used for string validation errors on username, passkey, and database names.
function string_Exception(type, msg) {
	var self = new Error(msg);
	self.name = type +"ValidationError";
	self.constructor = string_Exception;
	return self;
}
exports.stringException = string_Exception;

// Generic string name validation.
function validate_string(str, type, short, long, reg) {
	str = (typeof str === "string") ? str : "";
	var len = str.length;

	if (len < short) {
		throw string_Exception(type, "too short");
	}
	if (len > long) {
		throw string_Exception(type, "too long");
	}
	if (reg.test(str)) {
		throw string_Exception(type, "invalid characters");
	}
	return str;
}

/**
 * Validate a passkey.
 * Must be between 4 and 140 chars and must not contain /[\b\t\v\f\r\n]/.
 */
function validate_passkey(passkey) {
	return validate_string(passkey, "passkey", 4, 140, /[\b\t\v\f\r\n]/);
}
exports.validatePasskey = validate_passkey;

/**
 * Validate a username.
 * Must be between 1 and 70 chars and must not contain /\W/.
 */
function validate_username(username) {
	return validate_string(username, "username", 1, 70, /\W/);
}
exports.validateUsername = validate_username;

/**
 * Validate a database name.
 * Must be between 1 and 70 chars and must not contain /\W/.
 */
function validate_dbname(dbname) {
	return validate_string(dbname, "dbname", 1, 70, /\W/);
}
exports.validateDBName = validate_dbname;


/**
 * Takes an object cantaining logging methods
 * debug(), info(), warn(), error(), and/or critical().
 * Each if the default logging methods that are matched by a replacement method
 * will be replaced.
 */
exports.logger = function update_logger(x) {
	var m;
	for (m in x) {
		if (Object.prototpe.hasOwnProperty.call(x, m)) {
			LOG[m] = x[m];
		}
	}
	return exports;
};

/**
 * Toggle debug mode on the fly.
 */
exports.debug = function toggle_debug(x) {
	DEBUG = !!x;
	return exports;
};

/**
 * Set the DCube domain to use on the fly.
 * The string given must NOT contain the protocol ("http://..." for example).
 * If the protocol is included, an error will be thrown.
 *
 * If .domain() is called with no arguments it simply returns the current
 * domain setting.
 */
exports.domain = function domain_accessor(x) {
	if (x && typeof x === "string") {
		if (/^[a-zA-Z]+:\/\//.test(x)) {
			throw string_Exception("URL", "exclude protocol");
		}

		var lastchar = x.length - 1;
		if(x.charAt(lastchar) === "/") {
			x = x.slice(0, lastchar);
		}
		DOMAIN = "http://"+ x;
		return exports;
	}
	return DOMAIN;
};

exports.user = (function () {
	var users = {};

	return function (username, passkey) {
		username = validate_username(username);

		return PROMISE(function (fulfill, except, progress) {
			if (!users[username]) {
				var user = USER(username, passkey);
				user.get()(function (data) {
					fulfill(users[username] = user);
				}, except, progress);
			}
			fulfill(users[username]);
		});
	};
}());

exports.connect = (function () {
	var connections = {};

	return function (dbname, username, passkey) {
		dbname = validate_dbname(dbname);
		username = validate_username(username);
		return PROMISE(function (fulfill, except, progress) {
			if (!connections[dbname +":"+ username]) {
				exports.user(username, passkey)(
					function (user) {
					 user.connect(dbname)(
							function (cxn) {
								fulfill(connections[dbname +":"+ username] = cxn);
							}, except, progress);
					},
					except, progress);
			}
			else {
				fulfill(connections[dbname +":"+ username]);
			}
		});
	};
}());

LOG = {
	debug: function log_debug(msg) {
		dump("DCube:DEBUG:"+ new Date() + msg +"\n");
	},

	info: function log_info(msg) {
		dump("DCube:INFO:"+ new Date() + msg +"\n");
	},

	warn: function log_warn(msg) {
		dump("DCube:WARNING:"+ new Date() + msg +"\n");
	},

	error: function log_error(msg) {
		dump("DCube:ERROR:"+ new Date() + msg +"\n");
	},

	critical: function log_critical(msg) {
		dump("DCube:CRITICAL:"+ new Date() + msg +"\n");
	}
};

ENQ = (function () {
	var tm = Components.classes["@mozilla.org/thread-manager;1"].
					 getService(Components.interfaces.nsIThreadManager);

	return function global_queue(fn) {
		tm.mainThread.dispatch({run: fn},
			Components.interfaces.nsIThread.DISPATCH_NORMAL);
	};
}());

PROMISE = (function () {

	function construct_pub_promise(spec) {
		return function (fulfilled, exception, progress) {
			if (typeof fulfilled === "function") {
				if (spec.fulfilled_val) {
					ENQ(function () {
						fulfilled.apply(null, spec.fulfilled_val);
					});
				}
				else {
					spec.observers.fulfilled.push(fulfilled);
				}
			}
			if (typeof exception === "function") {
				if (spec.exception_val) {
					ENQ(function () {
						exception.apply(null, spec.exception_val);
					});
				}
				else {
					spec.observers.exception.push(exception);
				}
			}
			if (typeof progress === "function") {
				spec.observers.progress.push(progress);
			}
			return construct_pub_promise(spec);
		};
	}

	return function promise_constructor(init) {
		var spec = {
					resolved: false,
					fulfilled_val: null,
					exception_val: null,
					observers: {
						fulfilled: [],
						exception: [],
						progress: []
					}
				};

		function make_queued(fn, args) {
			return function () {
				fn.apply(null, args);
			};
		}

		function broadcast(type, args) {
			if (spec.fulfilled_val || spec.exception_val) {
				return;
			}

			var i = 0, val,
					observers = spec.observers[type],
					len = observers.length;

			if (type === "progress") {
				for (; i < len; i += 1) {
					observers[i].apply(null, args);
				}
				return;
			}

			if (type === "fulfilled") {
				val = spec.fulfilled_val = Array.prototype.slice.call(args);
			}
			else {
				val = spec.exception_val = Array.prototype.slice.call(args);
			}

			for (; i < len; i += 1) {
				ENQ(make_queued(observers[i], val));
			}
		}

		function broadcast_fulfill() {
			broadcast("fulfilled", arguments);
		}

		function broadcast_exception() {
			broadcast("exception", arguments);
		}

		function broadcast_progress() {
			broadcast("progress", arguments);
		}

		ENQ(function init_promise() {
			init(broadcast_fulfill,
					broadcast_exception, broadcast_progress);
		});

		return construct_pub_promise(spec);
	};
}());

function SHA1(target) {
	var uc = Components.classes["@mozilla.org/intl/scriptableunicodeconverter"].
			createInstance(Components.interfaces.nsIScriptableUnicodeConverter),
		hasher = Components.classes["@mozilla.org/security/hash;1"].
			 createInstance(Components.interfaces.nsICryptoHash),
		data, hash;

	uc.charset = "UTF-8";
	data = uc.convertToByteArray(target, {});
	hasher.init(hasher.SHA1);
	hasher.update(data, data.length);
	hash = hasher.finish(false);

	function toHexString(charCode) {
		return ("0" + charCode.toString(16)).slice(-2);
	}

	// Should not be using JavaScript array comprehensions.
	//return [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");

	return Array.prototype
		.map.call(hash, function (x){ return x.charCodeAt(0); })
		.map(toHexString)
		.join("");
}

/**
 * Returns a function that does XMLHttpRequest.
 *
 * @param {function} callback The callback function will be passed the response
 * object as the first parameter on success. If the request fails, the first
 * parameter will be null and the second paramater will be an error object.
 *
 * @param {string} method The HTTP method string.
 * @param {string} url The HTTP URL string.
 * @param {string} data The body of the HTTP request.
 * @param {object} headers A mapping of HTTP request headers.
 */
XHR = (function mod_XHR() {

	function xhr_Error(msg) {
		var self = new Error(msg);
		self.name = "XHRError";
		self.constructor = xhr_Error;
		return self;
	}

	return function do_xhr(callback, method, url, data, headers) {
		var xhr = Components.classes["@mozilla.org/xmlextras/xmlhttprequest;1"]
				.createInstance(Components.interfaces.nsIXMLHttpRequest),
				h;

		xhr.onreadystatechange = function on_ready_state_change(ev) {
			if (ev.target.readyState !== 4) {
				return;
			}

			var res, ex;
			if (ev.target.status === 0) {
				LOG.warn(ex = xhr_Error("XMLHttpRequest HTTP status is 0."));
				callback(null, ex);
				return;
			}

			res = {body: xhr.responseText,
				status: ev.target.status,
				headers: {}
			};

			try {
				res.headers = xhr.getAllResponseHeaders();
			} catch(e) { /* bury it */}
			callback(res);
		};

		try {
			xhr.open(method, url, true);
		} catch (e) {
			LOG.warn(e +"; xhr.open("+ method +", "+ url +", true)");
			throw xhr_Error("Problem calling XMLHttpRequest.open("+
				method +", "+ url +", true).");
		}

		for (h in headers) {
			if (headers.hasOwnProperty(h)) {
				xhr.setRequestHeader(h, headers[h]);
			}
		}

		try {
			xhr.send(data);
		} catch(sendErr) {
			LOG.warn(sendErr +"; xhr.send(); method:"+ method +", url"+ url);
			throw xhr_Error("Problem calling XMLHttpRequest.send().");
		}
	};
}());

/**
 * Constructs and returns a JSONRequest object.
 * http://www.json.org/JSONRequest.html
 */
JSONRequest = (function () {
	var self = {};

	function JSONRequestError(msg) {
		var self = new Error(msg);
		self.name = "JSONRequestError";
		self.constructor = JSONRequestError;
		return self;
	}

	/**
	 * Make a JSONRequest HTTP POST operation.
	 * http://www.json.org/JSONRequest.html
	 *
	 * @param {string} url The HTTP URL string.
	 * @param {object} send The data to JSON encode as the HTTP request body.
	 * @param {function} done The callback function will be pased the request id
	 * number, the response if it succeeds, and a JSONRequest error if it fails.
	 * @param {number} timeout The number of ms to wait.
	 */
	self.post = function do_jsonrequest(url, send, done, timeout) {
		var data = JSON.stringify(send),
				timedout = false,
				timer = setTimeout(function () {
					timedout = true;
					done(null, JSONRequestError("no response"));
				}, (timeout || 10000));

		if (DEBUG) {
			dump("\nJSONRequest.post() to "+ url);
			dump("\n\tRequest body:\n");
			dump(data);
			dump("\n\n");
		}

		function xhr_callback(response, ex) {
			var rdata, sn = 1;
			if (timedout) {
				return;
			}
			timer.cancel();
			if (response) {

				if (DEBUG) {
					dump("\n -- JSONRequest response --\n");
					dump("HTTP "+ response.status +"\n");
					dump(response.headers +"\n");
					dump(response.body +"\n");
				}

				if (+response.status !== 200) {
					done(sn, undefined, JSONRequestError("not ok"));
					return;
				}

				try {
					rdata = JSON.parse(response.body);
				} catch (resJSONex) {
					done(sn, undefined, JSONRequestError("bad response"));
					return;
				}

				done(sn, rdata, undefined);
				return;
			}
			if (DEBUG) {
				dump("\n -- JSONRequest exception --\n");
				dump(ex);
				dump("\n");
			}
			done(sn, undefined, JSONRequestError("no response"));

		}

		try {
			XHR(xhr_callback, "POST", url, data, {
				"Accept": "application/jsonrequest",
				"Content-Type": "application/jsonrequest"});
		} catch(HTTPex) {
			throw JSONRequestError("bad url");
		}
	};
	return self;
}());

REQ = (function () {

	function request_Error(msg) {
		var self = new Error(msg);
		self.name = "RequestError";
		self.constructor = arguments.callee;
		return self;
	}

	function normalize_response(response) {
		response = confirmObject(response);
		response.head = confirmObject(response.head);

		return {
			head: {
				authorization: response.head.authorization || $A,
				status: response.head.status || 0
			},
			body: (isObject(response.body) ? response.body : null)
		};
	}

	/**
	 * spec:
	 *  - timeout = 10000
	 *  - dir = "" (must NOT end in "/")
	 *  - name = ""
	 *  - method "get"
	 *  - [username]
	 *  - [cnonce && response]
	 *  - body
	 *
	 * throws:
	 *  - RequestError: bad url
	 *
	 * callback exceptions:
	 *  - RequestError: bad response
	 *  - RequestError: not ok
	 *  - RequestError: no response 
	 *  - RequestError: unexpected exception
	 */
	return function make_request(spec, callback, errback) {
		spec = spec || {};
		var timeout = spec.timeout || 10000,
			dir = spec.dir || "",
			name = spec.name || "",
			url,
			payload = {
				head:{
					method: spec.method || "get"
				}
			};

		url = DOMAIN +"/"+ dir;
		url = name ? url +"/"+ name : url;

		if (spec.username) {
			payload.head.authorization = [spec.username];
		}
		if (payload.head.authorization && spec.cnonce && spec.response) {
			payload.head.authorization = payload.head.authorization.
				concat([spec.cnonce, spec.response]);
		}

		if (spec.body) {
			payload.body = spec.body;
		}

		try {
			JSONRequest.post(url, payload, function (id, response, ex) {
				if (response) {
					callback(normalize_response(response));
					return;
				}
				LOG.warn("REQ::callback(); "+ ex);
				errback(request_Error(ex.message || "unexpected exception"));
			}, timeout);
		} catch (e) {
			throw request_Error(e.message);
		}

	};
}());

CACHE = (function () {
	var memo = {}, self = {}, stacks = {}, done, next;

	function cache_Exception(message) {
		var self = new Error(message || "unkown");
		self.name = "DCubeCacheError";
		self.constructor = arguments.callee;
		return self;
	}

	done = function (key) {
		stacks[key].blocked = false;
		next(key);
	};

	next = function (key) {
		if (stacks[key].stack.length && !stacks[key].blocked) {
			stacks[key].blocked = true;
			stacks[key].stack.shift()();
		}
	};

	self.atomic = function cache_atomic(key) {

		var txn = function (method, val) {
			switch (method) {
			case "get":
				if (!memo.hasOwnProperty(key)) {
					memo[key] = null;
				}
				return memo[key];
			case "set":
				return (memo[key] = val);
			case "update":
				var p;
				memo[key] = confirmObject(memo[key]);
				for (p in val) {
					if (val.hasOwnProperty(p)) {
						memo[key][p] = val[p];
					}
				}
				return memo[key];
			case "commit":
				done(key);
				txn = function () {
					throw cache_Exception("transaction committed");
				};
				break;
			}
		};

		function transaction(method, val) {
			return txn(method, val);
		}

		return PROMISE(function (fulfill) {
			stacks[key] = stacks[key] || {blocked: false, stack: []};
			stacks[key].stack.push(function () {
				fulfill.call(null, transaction);
			});
			next(key);
		});
	};

	return self;
}());

CXN = function () {
	var self = {};
	return self;
};

USER = function (username, passkey) {
	var self = {}, transaction;

	function user_Exception(message) {
		var self = new Error(message || "unkown");
		self.name = "DCubeUserError";
		self.constructor = arguments.callee;
		return self;
	}

	function cnonce(passkey, nextnonce) {
		return SHA1(SHA1(passkey +""+ nextnonce));
	}

	function response(passkey, nonce) {
		return SHA1(passkey +""+ nonce);
	}

	function authenticated(spec, creds) {
		if (spec.nonce !== creds[1] && spec.nextnonce !== creds[2]) {
			spec.nonce = creds[1]; spec.nextnonce = creds[2];
			transaction("update", spec);
			return true;
		}
		return false;
	}

	function set_transaction(progress, continuation) {
		progress("check cache");
		CACHE.atomic(username)(function (txn) {
			transaction = txn;
			continuation();
		});
	}

	function delegate(that, generalize, name, args) {
		if (that !== self) {
			generalize(that, name, args);
			return;
		}
		return PROMISE(function (fulfill, except, progress) {
			set_transaction(progress, function () {
				generalize({
					fulfill: fulfill,
					except: except,
					progress: progress}, name, args);
			});
		});
	}

	// Constructor
	// User passkey has been validated.
	function user_passkey_3() {

		function request(dir, name, data, cb, eb) {
			var spec = transaction("get");
			try {
				REQ({
					timeout: 7000,
					dir: dir,
					name: name,
					username: username,
					cnonce: cnonce(passkey, spec.nextnonce),
					response: response(passkey, spec.nonce),
					method: (data ? "put" : "get"),
					body: data
				},
				function (response) {
					if (response.head.authorization.length === 3 &&
							!authenticated(spec, response.head.authorization)) {
						eb(user_Exception("invalid passkey"));
						return;
					}
					cb(response);
				},
				function (ex) {
					LOG.warn("USER::user_passkey_3::request(); "+ ex);
					eb(offline_Exception());
				});
			} catch (e) {
				// REQ will throw an error if the URL is malformed
				LOG.warn("USER::user_passkey_3::request(); "+ e);
				eb(offline_Exception());
			}
		}

		self.get = function get(target) {
			delegate(this, function (promise) {
				promise.progress("getting");
				request("users", target, null,
					function (response) {
						transaction("commit");
						promise.fulfill(response.body);
					},
					function (ex) { transaction("commit"); promise.except(ex); });
			});
		};

		self.update = function update(target, user) {
			delegate(this, function (promise) {
				promise.progress("updating");
				request("users", target, user,
					function (response) {
						transaction("commit");
						promise.fulfill(response.body);
					},
					function (ex) { transaction("commit"); promise.except(ex); });
			});
		};

		self.connect = function connect(dbname, query) {
			delegate(this, function (promise) {
				promise.progress("connecting");
				request("databases", dbname, query,
					function (response) {
						transaction("commit");
						if (response.head.status === 200) {
							promise.fulfill(CXN(), response.head.body);
						}
						else if (response.head.status === 403) {
							promise.except(
								user_Exception("forbidden database"));
						}
						else if (response.head.status === 404) {
							promise.except(
								user_Exception("database does not exist"));
						}
						else {
							LOG.warn("USER::user_passkey_3::connect(); status: "+
								response.head.status);
							promise.except(offline_Exception());
						}
					},
					function (ex) { transaction("commit"); promise.except(ex); });
			});
		};
	}

	// Constructor.
	// User has received nonce and nextnonce.
	function user_challenged_2() {

		self.exists = function exists() {
			return PROMISE(function (fulfill) {
				fulfill(true);
			});
		};

		function generalize_method(promise, name, continuation_args) {
			if (typeof passkey === "function") {
				transaction("commit");
				passkey(function (pk) {
					passkey = pk;
					self[name].apply(null, continuation_args);
				});
				return;
			}

			try {
				passkey = validate_passkey(passkey);
			} catch (e) {
				transaction("commit");
				promise.except(e);
				return;
			}
			user_passkey_3();
			self[name].apply(promise, continuation_args);
		}

		self.get = function get(target) {
			delegate(this, generalize_method, "get", [target]);
		};

		self.update = function update(target, user, cb, eb, pr) {
			delegate(this, generalize_method, "update", [target, user]);
		};

		self.connect = function connect(dbname, cb, eb, pr) {
			delegate(this, generalize_method, "connect", [dbname]);
		};
	}

	// Constructor.
	// Initialize user.
	function user_init_1() {

		function ping(transaction, cb, eb) {
			try {
				REQ({
					timeout: 7000,
					dir: "users",
					name: username,
					username: username
				},
				function (response) {
					if (response.head.authorization[1] &&
							response.head.authorization[2]) {
						transaction("set", {
							nonce: response.head.authorization[1],
							nextnonce: response.head.authorization[2]});
						user_challenged_2();
						cb(response.body);
						return;
					}
					if (response.head.status === 404) {
						cb(null);
						return;
					}
					LOG.warn("USER::user_init_1::ping(); status: "+
						response.head.status);
					eb(offline_Exception());
				},
				function (ex) {
					LOG.warn("USER::user_init_1::ping(); "+ ex);
					eb(offline_Exception());
				});
			} catch (e) {
				// REQ will throw an error if the URL is malformed
				LOG.warn("USER::user_init_1::ping(); "+ e);
				eb(offline_Exception());
			}
		}
		 
		self.exists = function exists() {
			return PROMISE(function (fulfill, except, progress) {
				set_transaction(progress, function () {
					progress("remote ping");
					ping(function (r) { fulfill(r); transaction("commit"); },
						function (x) { except(x); transaction("commit"); });
				});
			});
		};

		function generalize_method(name, continuation_args) {
			return PROMISE(function (fulfill, except, progress) {
				set_transaction(progress, function () {
					progress("remote ping");
					ping(function (r) {
						if (r) {
							self[name].apply({
								fulfill: fulfill,
								except: except,
								progress: progress}, continuation_args);
							return;
						}
						except(user_Exception("user does not exist"));
						transaction("commit");
					}, function (x) { except(x); transaction("commit"); });
				});
			});
		}

		self.get = function get(target) {
			return generalize_method("get", [target]);
		};

		self.update = function update(target, user) {
			return generalize_method("update", [target, user]);
		};

		self.connect = function connect(dbname) {
			return generalize_method("connect", [dbname]);
		};
	}

	user_init_1();
	return self;
};

isObject = function isObject(x) {
	return !!(x && Object.prototype.toString.call(x) === "[object Object]");
};

isArray = function isArray(x) {
	return !!(x && Object.prototype.toString.call(x) === "[object Array]");
};

confirmObject = function confirmObject(x) {
	return isObject(x) ? x : $N;
};

confirmArray = function confirmArray(x) {
	return isArray(x) ? x : $A;
};

confirmFunc = function confirmFunc(x) {
	return typeof x === "function" ? x : $F;
};

