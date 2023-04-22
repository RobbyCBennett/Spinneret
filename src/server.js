'use strict';


// Modules: Node.js
const fs = require('node:fs');
let crypto, path;

// Modules: Internal
let parse;


// Constants: WebSocket
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// Constants: HTTP
const CUSTOM_OPTIONS_OTHER  = new Set(['https', 'types']);
const CUSTOM_OPTIONS_FILES  = new Set(['caFile', 'certFile', 'crlFile', 'keyFile', 'pfxFile']);
const CUSTOM_OPTIONS_LIMITS = new Set([
	'headersTimeout', 'keepAliveTimeout', 'maxBodySize',
	'maxHeadersCount', 'maxRequestsPerSocket', 'requestTimeout', 'timeout'
]);

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
	#indexAbsolute;
	#notFound;
	#cache;
	#cacheEnabled;

	// Middleware
	#middlewareApi;
	#middlewareFile;

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
		this.#indexAbsolute = false;

		// Middleware
		this.#middlewareApi  = [];
		this.#middlewareFile = [];

		// WebSocket
		this.#ws = false;

		// Public methods which use this server object
		this.midApiReqBodyJson  = this.midApiReqBodyJson.bind(this);
		this.midApiReqBodyOther = this.midApiReqBodyOther.bind(this);
	}

	//////////////////////
	// Middleware Setup //
	//////////////////////

	// Remember the functions to asynchronously call together before API handlers
	midApiAsync(...functions)
	{
		this.#midPush(this.#middlewareApi, false, functions);
	}

	// Remember the functions to synchronously call before API handlers
	midApiSync(...functions)
	{
		this.#midPush(this.#middlewareApi, true, functions);
	}

	// Remember the functions to asynchronously call together before serving files
	midFileAsync(...functions)
	{
		this.#midPush(this.#middlewareFile, false, functions);
	}

	// Remember the functions to synchronously call before serving files
	midFileSync(...functions)
	{
		this.#midPush(this.#middlewareFile, true, functions);
	}

	////////////////////
	// API Middleware //
	////////////////////

	// Receive body and parse as JSON
	async midApiReqBodyJson(req, res)
	{
		// Skip if content type is not this type
		if (req.headers['content-type'] != 'application/json')
			return;

		// Get data
		const maxBodySize = req.socket.server.maxBodySize;
		let bytes = 0;
		const body = [];
		req.on('data', (buffer) => {
			if (maxBodySize !== undefined && bytes + buffer.length > maxBodySize)
				return this.#handleStopHttp(req, res);
			body.push(buffer.toString());
			bytes += buffer.length;
		});

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

	// API Middleware: Receive body as file
	async midApiReqBodyOther(req, res)
	{
		// Skip if content type is a used internal middleware type (currently only json)
		if (this.#types.has(req.headers['content-type']))
			return;

		// Allocate space for body
		const length = parseInt(req.headers['content-length']);
		req.body = Buffer.allocUnsafe(isNaN(length) ? 0 : length);

		// Gradually grow the body buffer
		let bytes = 0;
		req.on('data', buffer => {
			if (maxBodySize !== undefined && bytes + buffer.length > maxBodySize)
				return this.#handleStopHttp(req, res);
			bytes += buffer.copy(req.body, bytes);
		});

		// Parse and store in request
		return new Promise(resolve => {
			req.on('end', () => {
				resolve();
			});
		});
	}

	// API Middleware: Create cookies object
	async midApiReqCookies(req, res)
	{
		// Require the module to parse cookies
		if (!parse)
			parse = require('./parse');

		// Parse the cookies
		req.cookies = parse.cookieStringToObj(req.headers.cookie);
	}

	// API Middleware: Parse URL parameters
	async midApiReqUrlParams(req, res)
	{
		// Parse the URL encoding
		const urlSearchParams = new URLSearchParams(req.params);

		// Parse and add each value
		req.params = {};
		for (const [key, value] of urlSearchParams)
			req.params[key] = value;
	}

	// API Middleware: Setup response
	async midApiResDefaults(req, res)
	{
		// Default content type & status code
		res.statusCode = (req.method == 'POST') ? 201 : 200;
		res.setHeader('Content-Type', 'text/plain');
	}

	// API Middleware: Add end functions for response
	async midApiResEnd(req, res)
	{
		res.endJson = function(obj) {
			this.end(JSON.stringify(obj));
		}

		res.endBadRequest = function() {
			this.statusCode = 400;
			this.end();
		}
		res.endUnauthorized = function() {
			this.statusCode = 401;
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

	/////////////////////
	// File Middleware //
	/////////////////////

	// Allow popular content-type bodies to be accepted properly
	async midFileResContentType(req, res)
	{
		let type;
		switch (path.extname(req.url)) {
			case '.js':
				type = 'text/javascript';
				break;
			case '.svg':
				type = 'image/svg+xml';
				break;
			default:
				return;
		}

		res.setHeader('Content-Type', type);
	}

	// Set the content-security-policy to be strict by default
	async midFileResContentSecurityPolicy(req, res)
	{
		// Disable inline scripts to help prevent cross-site scripting attacks
		res.setHeader('Content-Security-Policy', "default-src 'self';");
	}

	///////////////////////////////////////
	// (Internal Helpers for Middleware) //
	///////////////////////////////////////

	// If certain middleware is used, add file types to the set of allowed types
	#implicitlyAddTypes(functions)
	{
		for (const fn of functions) {
			switch (fn) {
				case this.midApiReqBodyJson:
					this.#types.add('application/json')
					break;
			}
		}
	}

	// Push to array of middleware
	#midPush(array, sync, functions)
	{
		if (!functions.length)
			return;
		array.push({
			sync:      sync,
			functions: functions,
		});
		this.#implicitlyAddTypes(functions);
	}

	// Call all middleware in the array
	async #midCall(req, res, array)
	{
		for (const group of array) {
			// Stop if a response was ended
			if (res.finished)
				break;

			// If group is async
			if (!group.sync) {
				// Call all async functions together
				const promises = [];
				for (const mid of group.functions)
					promises.push(mid(req, res));
				await Promise.all(promises);
			}
			// If group is sync
			else {
				// Call each sync function
				for (const mid of group.functions) {
					mid(req, res);
					// Stop if a response was ended
					if (res.finished)
						break;
				}
			}
		}
	}

	//////////////////
	// File Serving //
	//////////////////

	// Enable file serving if the directory is valid
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
		if (this.#index && this.#index[0] === '/')
			this.#indexAbsolute = true;
		this.#notFound = (typeof(notFound) === 'string') ? path.join(dir, notFound) : null;
	}

	// Clear the file cache
	cacheClear()
	{
		this.#cache.clear();
	}

	// Disable the file cache (does not clear the cache)
	cacheDisable()
	{
		this.#cacheEnabled = false;
	}

	// Enable the file cache (does not add files to the cache)
	cacheEnable()
	{
		this.#cacheEnabled = true;
	}

	// Refresh the file cache of files served since this server started listening
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

	////////////////////////////////////////
	// (Internal Helpers for File Serving) //
	////////////////////////////////////////

	// If the path exists, then serve the file
	async #serveFile(req, res, file)
	{
		// Response: file content from cache/filesystem
		try {
			// Try to use the cache
			if (this.#cacheEnabled) {
				// The file is cached
				if (this.#cache.has(file)) {
					// Serve content from cache
					if (this.#middlewareFile.length)
						await this.#midCall(req, res, this.#middlewareFile);
					if (!res.finished)
						res.end(this.#cache.get(file));
				}
				// The file is not cached yet
				else {
					// Get content from filesystem and add to cache
					const content = fs.readFileSync(file);
					this.#cache.set(file, content);

					// Serve content
					if (this.#middlewareFile.length)
						await this.#midCall(req, res, this.#middlewareFile);
					if (!res.finished)
						res.end(content);
				}
			}
			// Don't try to use the cache
			else {
				// Get content from filesystem and serve it
				const content = fs.readFileSync(file);
				if (this.#middlewareFile.length)
					await this.#midCall(req, res, this.#middlewareFile);
				if (!res.finished)
					res.end(content);
			}
			return true;
		}
		// File not found in filesystem
		catch (err) {
			return false;
		}
	}

	//////////////////
	// API Handling //
	//////////////////

	// Given a method string, URL string, and handler function
	api(method, url, fn)
	{
		this.#setRoute(method, url, fn);
	}

	// Shorthand for api() for common method delete
	delete(url, fn)
	{
		this.api('DELETE', url, fn);
	}

	// Shorthand for api() for common method get
	get(url, fn)
	{
		this.api('GET', url, fn);
	}

	// Shorthand for api() for common method patch
	patch(url, fn)
	{
		this.api('PATCH', url, fn);
	}

	// Shorthand for api() for common method post
	post(url, fn)
	{
		this.api('POST', url, fn);
	}

	// Shorthand for api() for common method put
	put(url, fn)
	{
		this.api('PUT', url, fn);
	}

	/////////////////////////////////////////
	// (Internal Helpers for API Handling) //
	/////////////////////////////////////////

	// Set route handler for a URL
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

	// Get route handler from a URL
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
					req.vars[varKey] = urlPart;

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

	// Given strings, create a regular expression to find API URLs
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

	// Given strings, create a regular expression to for URL variables
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

		return regExp;
	}

	////////////////
	// WebSockets //
	////////////////

	// For the given event string, set the handler function
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

	///////////////////////////////////////
	// (Internal Helpers for WebSockets) //
	///////////////////////////////////////

	// Hash the key
	#hashWsKey(key)
	{
		return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
	}

	// Decode the message and store in client.message
	#decodeWsMessage(socket, buffer)
	{
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

	// Encode a string to send
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

	// Add metadata and send the message
	#sendWsMessage(data, encoded=false)
	{
		if (encoded)
			this.write(data);
		else
			this.write(this.encode(data));
	}

	// Upgrade HTTP to WebSocket
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
				socket.error    = null;
				socket.hadError = hadError;
				socket.message  = null;
				this.#wsOnClose(socket);
			});

		// Event handler: WebSocket.error
		if (this.#wsOnError)
			socket.on('error', (error) => {
				socket.error    = error;
				socket.hadError = null;
				socket.message  = null;
				this.#wsOnError(socket);
			});

		// Event handler: WebSocket.message
		if (this.#wsOnMessage)
			socket.on('data', (buffer) => {
				socket.error    = null;
				socket.hadError = null;
				socket.message  = null;
				this.#decodeWsMessage(socket, buffer);
				this.#wsOnMessage(socket);
			});

		// Event handler: WebSocket.open
		if (this.#wsOnOpen) {
				socket.error    = null;
				socket.hadError = null;
				socket.message  = null;
			this.#wsOnOpen(socket);
		}
	}

	///////////////
	// Listening //
	///////////////

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

			// Response: Content length might be too large
			if (options.maxBodySize !== undefined && req.headers['content-length']) {
				const apparentSize = parseInt(req.headers['content-length']);
				if (!isNaN(apparentSize) && apparentSize > options.maxBodySize)
					return this.#handleStopHttp(req, res);
			}

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

					// If there's no file extension, then add index.html
					let file;
					if (this.#index && !/\.\w+/.test(req.url)) {
						if (this.#indexAbsolute)
							file = path.join(this.#dir, this.#index);
						else
							file = path.join(this.#dir, req.url, this.#index);
					}
					else {
						file = path.join(this.#dir, req.url);
					}

					// Response: Serve file
					if (await this.#serveFile(req, res, file))
						return;

					// Response: Page not found
					if (isApi === false)
						return await this.#handleNotFoundPage(req, res);
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
			if (this.#middlewareApi.length)
				await this.#midCall(req, res, this.#middlewareApi);

			// Response: Developer-provided handler
			if (!res.finished)
				handler(req, res);
		}

		// Options to create the server or listen
		const createOptions = {};
		const listenOptions = {};
		for (const [key, value] of Object.entries(options)) {
			// Skip keys added by this class
			if (CUSTOM_OPTIONS_OTHER.has(key) || CUSTOM_OPTIONS_LIMITS.has(key)) {
				continue;
			}
			// Read file for keys which usually read file contents, crash if failed
			else if (CUSTOM_OPTIONS_FILES.has(key)) {
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
		for (const key of CUSTOM_OPTIONS_LIMITS)
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

	//////////////////////////////////////
	// (Internal Helpers for Listening) //
	//////////////////////////////////////

	// Handler: Redirect unencrypted requests to HTTPS
	#handleUnencryptedHttp(req, res)
	{
		res.statusCode = 301;
		res.setHeader('Location', `https://${req.headers['host']}${req.url}`);
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
	async #handleNotFoundPage(req, res)
	{
		res.statusCode = 404;

		// Plain message if there is no 404 page defined/found
		if (!this.#notFound || !(await this.#serveFile(req, res, this.#notFound)))
			return res.end('Not found');
	}
};
