'use strict';


// Modules: node
const fs = require('node:fs');
let crypto, path;

// Modules: internal
let parse;


// Constants
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';


module.exports = class Server
{
	// API
	#prefix;
	#routes;
	#types;
	#methods;
	#urlVar;

	// File serving
	#dir;
	#index;
	#notFound;
	#cache;
	#cacheEnabled;

	// Middleware
	#middleware;

	// WebSocket
	#ws;
	#wsOnClose;
	#wsOnError;
	#wsOnMessage;
	#wsOnOpen;

	constructor({
		apiDelimiters = /^{(.+?)}$/,
		apiPrefixes   = /^\/api\//,
	} = {})
	{
		// API
		this.#methods = new Set();
		this.#prefix  = this.#apiUrlPrefixes(apiPrefixes);
		this.#routes  = new Map();
		this.#types   = new Set();
		this.#urlVar  = this.#apiUrlVarDelimiters(apiDelimiters);

		// File serving
		this.#cache        = new Map();
		this.#cacheEnabled = false;

		// Middleware
		this.#middleware = [];

		// WebSocket
		this.#ws = false;

		// Public methods which use this server object
		this.midReqBodyOther = this.midReqBodyOther.bind(this);
	}


	// Middleware: Receive body and parse as JSON
	async midReqBodyJson(req, res)
	{
		// Skip if content type is not this type
		if (req.headers['content-type'] != 'application/json')
			return;

		// Get data
		const body = [];
		req.on('data', (buffer) => {
			body.push(buffer.toString());
		})

		// Parse and store in request
		return new Promise((resolve, reject) => {
			req.on('end', () => {
				try {
					req.body = JSON.parse(body.join(''));
				} catch (err) {
					req.body = {};
				}
				resolve();
			});
		});
	}

	// Middleware: Receive body as file
	async midReqBodyOther(req, res)
	{
		// Skip if content type is a used internal middleware type (currently only json)
		if (this.#types.has(req.headers['content-type']))
			return;

		// Allocate space for body
		const length = parseInt(req.headers['content-length']);
		req.body = Buffer.allocUnsafe(isNaN(length) ? 0 : length);

		// Gradually grow the body buffer
		let pos = 0;
		req.on('data', buffer => {
			pos += buffer.copy(req.body, pos);
		})

		// Parse and store in request
		return new Promise(resolve => {
			req.on('end', () => {
				resolve();
			});
		});
	}

	// Middleware: Parse URL parameters
	async midReqUrlParams(req, res)
	{
		// Require the module to parse values
		if (!parse)
			parse = require('./parse');

		// Parse the URL encoding
		const urlSearchParams = new URLSearchParams(req.params);

		// Parse and add each value
		req.params = {};
		for (const [key, value] of urlSearchParams)
			req.params[key] = parse.stringToValue(value);
	}

	// Middleware: Setup response
	async midResDefaults(req, res)
	{
		// Default content type & status code
		res.statusCode = (req.method == 'POST') ? 201 : 200;
		res.setHeader('content-type', 'text/plain');

		// Disable inline js/css & requests to other domains
		res.setHeader('content-security-policy', "default-src 'self';");
	}

	// Middleware: Add end functions for response
	async midResEnd(req, res)
	{
		res.endJson = function(obj) {
			this.end(JSON.stringify(obj));
		}

		res.endBadRequest = function() {
			this.statusCode = 400;
			this.end();
		}
		res.endNotFound = function() {
			this.statusCode = 404
			this.end();
		}
		res.endInternalError = function() {
			this.statusCode = 500
			this.end();
		}
	}

	// Middleware setup: Add to file types required by middleware
	#implicitlyAddTypes(functions)
	{
		for (const fn of functions) {
			switch (fn) {
				case this.midReqBodyJson:
					this.#types.add('application/json')
					break;
			}
		}
	}

	// Middleware setup: Push to array of developer-provided middleware
	#midPush(sync, functions)
	{
		if (!functions.length)
			return;
		this.#middleware.push({
			sync:      sync,
			functions: functions,
		});
		this.#implicitlyAddTypes(functions);
	}

	// Middleware setup: Asynchronously call all given functions together
	midAsync(...functions)
	{
		this.#midPush(false, functions);
	}

	// Middleware setup: Synchronously call each given function
	midSync(...functions)
	{
		this.#midPush(true, functions);
	}


	// File serving: if the path exists, serve the file
	#serveFile(req, res)
	{

		// If there's no file extension, then add index.html
		let file;
		if (this.#index && !/\.\w+/.test(req.url))
			file = path.join(this.#dir, req.url, this.#index);
		else
			file = path.join(this.#dir, req.url);

		// Response: file found from cache/filesystem
		try {
			if (this.#cacheEnabled) {
				// Cached
				if (this.#cache.has(file)) {
					res.end(this.#cache.get(file));
				}
				// Not cached yet
				else {
					const content = fs.readFileSync(file);
					this.#cache.set(file, content);
					res.end(content);
				}
			}
			else {
				res.end(fs.readFileSync(file));
			}
			return true;
		}
		// File not found in filesystem
		catch (err) {
			return false;
		}
	}

	// File serving setup: Get the directory, index file, and error 404 file
	files({
		cache    = false,
		dir      = 'public',
		index    = 'index.html',
		notFound = '404.html',
	} = {})
	{
		// Require the module to find the files
		path = require('node:path');

		// Stop if dir is not a string
		if (typeof(dir) !== 'string') {
			this.#dir = null;
			return;
		}

		// Make path absolute
		if (!path.isAbsolute(dir))
			dir = path.join(process.cwd(), dir);

		// Error if serving this directory
		if (dir == process.cwd())
			throw(`Attempted to serve files here in "${dir}"`);

		// Error if serving above this directory
		if (/\.\./.test(path.relative(process.cwd(), dir)))
			throw(`Attempted to serve files above here in "${dir}"`);

		this.#cacheEnabled = cache;
		this.#dir = dir;
		this.#index = index || null;
		this.#notFound = (typeof(notFound) === 'string') ? path.join(dir, notFound) : null;
	}

	cacheClear()
	{
		this.#cache.clear();
	}

	cacheDisable()
	{
		this.#cacheEnabled = false;
	}

	cacheEnable()
	{
		this.#cacheEnabled = true;
	}

	cacheRefresh()
	{
		for (const file of this.#cache.keys()) {
			try {
				this.#cache.set(file, fs.readFileSync(file));
			} catch (err) {
				this.#cache.delete(file);
			}
		}
	}


	// API: Get route handler from URL
	#getRoute(req)
	{
		let map = this.#routes;

		// Static URL
		if (!this.#urlVar) {
			if (!map.has(req.url))
				return null;
			map = map.get(req.url);
		}

		// Dynamic URL
		else {
			for (let urlPart of req.url.split('/')) {
				if (!urlPart)
					continue;

				// Get the key of the variable from the parent map
				const varKey = map.var;
				if (varKey) {
					// Add the variable to the request
					if (!req.vars)
						req.vars = {};
					req.vars[varKey] = parse.stringToValue(urlPart);

					// Change the URL part to the inner part of the delimiters
					urlPart = varKey;
				}

				// Find URL urlPart of routes
				if (!map.has(urlPart))
					return null;
				map = map.get(urlPart);
			}
		}

		// Get handler for method
		return map[req.method];
	}

	// API: Set route handler for URL
	#setRoute(method, url, fn)
	{
		let map = this.#routes;

		// Static URL
		if (!this.#urlVar) {
			if (!map.has(url))
				map.set(url, {});
			map = map.get(url);
		}

		// Dynamic URL
		else {
			for (let urlPart of url.split('/')) {
				if (!urlPart)
					continue;

				// Add the key of the variable to the parent map
				const match = urlPart.match(this.#urlVar);
				if (match) {
					map.var = match[1];

					// Change the URL part to the inner part of the delimiters
					urlPart = match[1];
				}

				// Add URL part to routes
				if (!map.has(urlPart))
					map.set(urlPart, new Map());
				map = map.get(urlPart);
			}
		}

		// Add method
		this.#methods.add(method);

		// Set handler for method
		map[method] = fn;
	}

	// API: Given strings, create a regular expression to find API URLs
	#apiUrlPrefixes(prefixes)
	{
		// Already a regular expression
		if (prefixes instanceof RegExp)
			return prefixes;

		// Not an array
		if (!(prefixes instanceof Array))
			return null;

		// Make a prefix regular expression
		let expressions = '^(';
		let strings = false;
		for (let i = 0; i < prefixes.length; i++) {
			if (typeof(prefixes[i]) === 'string' && prefixes[i]) {
				expressions += ((i === 0) ? '' : '|') + prefixes[i];
				strings = true;
			}
		}
		if (!strings)
			return null;
		expressions += ')';
		return new RegExp(expressions);
	}

	// API: Configure or disable URL variables
	#apiUrlVarDelimiters(delimiters)
	{
		let regExp;

		// Already a regular expression
		if (delimiters instanceof RegExp)
			regExp = delimiters;
		// Array of 2+
		else if (delimiters instanceof Array && delimiters.length >= 2)
			regExp = new RegExp(`^${delimiters[0]}(.+?)${delimiters[1]}$`);
		// Wrong type
		else
			return null;

		// Require the module to parse the values
		parse = require('./parse');

		return regExp;
	}

	// API: Given a method string, URL string, and handler function
	api(method, url, fn)
	{
		this.#setRoute(method, url, fn);
	}

	// API: Shorthand for api() for common method delete
	delete(url, fn)
	{
		this.api('DELETE', url, fn);
	}

	// API: Shorthand for api() for common method get
	get(url, fn)
	{
		this.api('GET', url, fn);
	}

	// API: Shorthand for api() for common method patch
	patch(url, fn)
	{
		this.api('PATCH', url, fn);
	}

	// API: Shorthand for api() for common method post
	post(url, fn)
	{
		this.api('POST', url, fn);
	}

	// API: Shorthand for api() for common method put
	put(url, fn)
	{
		this.api('PUT', url, fn);
	}


	// WebSocket: Hash the key
	#hashWsKey(key)
	{
		return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
	}

	// WebSocket: Decode the message and store in client.message
	#decodeWsMessage(socket, buffer)
	{
		socket.message = null;

		// Metadata: Use byte 0 to get the kind of buffer
		const byte0 = buffer.readUInt8(0);
		const opCode = byte0 & 0xf;

		// Return if the buffer is not a text frame
		if (opCode !== 0x1)
			return;

		// Metadata: Use byte 1 to see if data is masked
		const byte1 = buffer.readUInt8(1);
		const isMasked = Boolean((byte1 >>> 7) & 0x1);

		// Return if buffer is not masked
		if (!isMasked)
			return;

		// Metadata: Use bytes 1-2 or bytes 1-3 to see where to start
		let currentOffset = 2;
		let payloadLength = byte1 & 0x7f;
		if (payloadLength == 126) {
			payloadLength = buffer.readUInt16BE(currentOffset);
			currentOffset += 2;
		}

		//  Return if payload is too large
		else if (payloadLength >= 127)
			return;

		// Metadata: Use the next 4 bytes to get the XOR masking key
		const maskingKey = buffer.readUInt32BE(currentOffset);
		currentOffset += 4;

		// Metadata: Calculate the 4 parts of the mask
		const masks = [];
		for (let i = 24; i >= 0; i -= 8)
			masks.push((i === 0 ? maskingKey : maskingKey >>> i) & 0xff);

		// Message: Allocate
		socket.message = Buffer.allocUnsafe(payloadLength);

		// Message: Unmask and copy each byte
		let maskI = 0;
		for (let byteI = 0; byteI < payloadLength; byteI++) {
			// Get the part of the mask
			const mask = masks[maskI];
			if (maskI < 3)
				maskI += 1;
			else
				maskI = 0;

			// Read and unmask with XOR
			const source = buffer.readUInt8(currentOffset);
			socket.message.writeUInt8(mask ^ source, byteI);
			currentOffset += 1;
		}
	}

	// WebSocket: Encode a string to send
	#encodeWsMessage(data)
	{
		// Message: Stringify buffers
		if (Buffer.isBuffer(data))
			data = data.toString();
		// Message: Stringify objects
		else if (typeof data === 'object')
			data = JSON.stringify(data);

		// Message: Get the metadata and payload length
		const byteLength = Buffer.byteLength(data);
		const payloadLengthByteLength = (byteLength < 126) ? 0 : 2;
		const payloadLength = (payloadLengthByteLength === 0) ? byteLength : 126;

		// Message: Allocate a buffer
		const buffer = Buffer.allocUnsafe(2 + payloadLengthByteLength + byteLength);

		// Metadata: Use byte 0 to set the kind of buffer to text frame
		buffer.writeUInt8(0b10000001, 0);
		buffer.writeUInt8(payloadLength, 1);

		// Metadata: Use byte 1 to set the length of the payload to the second byte
		let payloadOffset = 2;
		if (payloadLengthByteLength > 0) {
			buffer.writeUInt16BE(byteLength, 2);
			payloadOffset += payloadLengthByteLength;
		}

		// Message: Write the data to the buffer
		buffer.write(data, payloadOffset);
		return buffer;
	}

	// WebSocket: Add metadata and send the message
	#sendWsMessage(data, encoded=false)
	{
		if (encoded)
			this.write(data);
		else
			this.write(this.encode(data));
	}

	// WebSocket: Upgrade HTTP to WebSocket
	#upgradeToWs(req, socket) {
		// Hash the WebSocket key
		const hash = this.#hashWsKey(req.headers['sec-websocket-key']);

		// Upgrade HTTP to WebSocket
		const headers = [
			'HTTP/1.1 101 Switching Protocols',
			'Upgrade: websocket',
			'Connection: Upgrade',
			`Sec-WebSocket-Accept: ${hash}`,
		];
		socket.write(headers.join('\r\n') + '\r\n\r\n');

		// WebSocket send functions
		socket.send = this.#sendWsMessage;
		socket.encode = this.#encodeWsMessage;

		// Event handler: WebSocket.close
		if (this.#wsOnClose)
			socket.on('close', (hadError) => {
				socket.hadError = hadError;
				this.#wsOnClose(socket);
			});

		// Event handler: WebSocket.error
		if (this.#wsOnError)
			socket.on('error', (error) => {
				socket.error = error;
				this.#wsOnError(socket);
			});

		// Event handler: WebSocket.message
		if (this.#wsOnMessage)
			socket.on('data', (buffer) => {
				this.#decodeWsMessage(socket, buffer);
				this.#wsOnMessage(socket);
			});

		// Event handler: WebSocket.open
		if (this.#wsOnOpen)
			this.#wsOnOpen(socket);
	}

	// WebSocket: For the given event string, set the handler function
	ws(event, fn)
	{
		this.#ws = true;
		if (event === 'close')
			this.#wsOnClose = fn;
		else if (event === 'error')
			this.#wsOnError = fn;
		else if (event === 'message')
			this.#wsOnMessage = fn;
		else if (event === 'open')
			this.#wsOnOpen = fn;
		else
			throw 'Expected the first parameter to be close, error, message, or open';
	}

	// Handler: Redirect unencrypted requests to HTTPS
	#handleUnencryptedHttp(req, res)
	{
		res.statusCode = 301;
		res.setHeader('location', `https://${req.headers['host']}${req.url}`);
		res.end();
	}

	// Handler: Stop the request early
	#handleStopHttp(req, res)
	{
		req.destroy();
	}

	// Handler: Redirect unencrypted requests to WSS
	#handleStopWs(req, socket)
	{
		socket.destroySoon();
	}

	// Handler: Error: Bad request
	#handleBadRequest(req, res)
	{
		res.statusCode = 400;
		res.end('Bad request');
	}

	// Handler: Error: Not found (simple)
	#handleNotFoundApi(req, res)
	{
		res.statusCode = 404;
		res.end('Not found');
	}

	// Handler: Error: Not found (page)
	#handleNotFoundPage(req, res)
	{
		res.statusCode = 404;

		// Plain message if there is no 404 page defined
		if (!this.#notFound)
			return res.end('Not found');

		// Serve 404 page if it can be read, otherwise a plain 404
		try {
			res.end(fs.readFileSync(this.#notFound));
		} catch (err) {
			res.end('Not found');
		}
	}


	// Listen to HTTP requests
	async listen(options = {}) {
		// Default options
		if (options.https === undefined)
			options.https = false;
		if (options.host === undefined)
			options.host = 'localhost';
		if (options.port === undefined)
			options.port = options.https ? 443 : 80;
		if (options.types === undefined)
			options.types = [];

		// Make set of types from user & internal types from middleware
		const allTypes = new Set(this.#types);
		for (const item of options.types)
			allTypes.add(item);

		// Listener
		const listener = async (req, res) => {
			// Response: Unsupported content type
			if (req.headers['content-type'] && !allTypes.has(req.headers['content-type']))
				return this.#handleStopHttp(req, res);

			// Response: Encryption required
			if (!req.connection.encrypted && options.onlyHttps)
				return this.#handleUnencryptedHttp(req, res);

			// Move ?parameters
			const paramsMatch = req.url.match(/\?.*/);
			if (paramsMatch) {
				req.url = req.url.substr(0, paramsMatch.index);
				req.params = paramsMatch[0];
			}

			// Remove trailing slash
			if (req.url.length > 1 && req.url[req.url.length-1] == '/')
				req.url = req.url.substr(0, req.url.length-1);

			// If serving files
			if (this.#dir) {
				// See if request is API
				const isApi = this.#prefix ? this.#prefix.test(req.url) : null;

				// Not API or API prefixes not defined
				if (isApi === false || this.#prefix === null) {
					// Response: Serve file
					if (this.#serveFile(req, res))
						return;

					// Response: Page not found
					if (isApi === false)
						return this.#handleNotFoundPage(req, res);
				}
			}

			// Response: Method not found
			if (!this.#methods.has(req.method))
				return this.#handleNotFoundApi(req, res);

			// Get route handler if it exits
			const handler = this.#getRoute(req);

			// Response: Route not found
			if (!handler)
				return this.#handleNotFoundApi(req, res);

			// Middleware: Developer-provided
			if (this.#middleware.length) {
				for (const group of this.#middleware) {
					// async
					if (!group.sync) {
						const promises = [];
						for (const mid of group.functions)
							promises.push(mid(req, res));
						await Promise.all(promises);
					}
					// sync
					else {
						for (const mid of group.functions)
							mid(req, res);
					}
				}
			}

			// Response: Developer-provided handler
			handler(req, res);
		}

		// Options to create the server or listen
		const createOptions = {};
		const listenOptions = {};
		const customKeys = ['https', 'types'];
		const fileKeys = ['caFile', 'certFile', 'crlFile', 'keyFile', 'pfxFile'];
		const limitKeys = [
			'headersTimeout', 'keepAliveTimeout', 'maxHeadersCount',
			'maxRequestsPerSocket', 'requestTimeout', 'timeout'
		];
		for (const [key, value] of Object.entries(options)) {
			// Skip keys added by this class
			if (customKeys.includes(key) || limitKeys.includes(key)) {
				continue;
			}
			// Read file for keys which usually read file contents, crash if failed
			else if (fileKeys.includes(key)) {
				const keyWithoutFile = key.slice(0, -4);
				createOptions[keyWithoutFile] = fs.readFileSync(options[key]);
			}
			// Copy other keys
			else {
				createOptions[key] = options[key];
				listenOptions[key] = options[key];
			}
		}

		// Create server
		const module = require(`node:${options.https ? 'https' : 'http'}`);
		const server = module.createServer(createOptions, listener);

		// Set limits
		for (const key of limitKeys)
			if (options[key] !== undefined)
				server[key] = options[key];

		// Listen to HTTP requests
		await server.listen(listenOptions);

		// Upgrade HTTP requests to WebSocket
		if (this.#ws) {
			// Require the module to encode/decode messages
			crypto = require('node:crypto');

			// Set the upgrade handler
			server.on('upgrade', (req, socket) => {
				// Response: stop if encryption required
				if (!req.connection.encrypted && options.onlyWss)
					this.#handleStopWs(req, socket);
				// Response: upgrade to WebSocket
				else
					this.#upgradeToWs(req, socket);
			});
		}

		// Print status
		console.log();
		const protocol = options.https ? 'https://' : 'http://';
		let port;
		if (options.https)
			port = (options.port == 443) ? '' : `:${options.port}`;
		else
			port = (options.port == 80) ? '' : `:${options.port}`;
		console.log(`${protocol}${options.host}${port}`);
		if (this.#ws) {
			if (options.onlyWss !== true)
				console.log(`ws://${options.host}${port}`);
			console.log(`wss://${options.host}${port}`);
		}

		// Return the listening server
		return server;
	}
};
