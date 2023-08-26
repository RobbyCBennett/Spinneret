# Module: `./spinneret/src/server`

## Class: `Server`

## Constructor
Create a server which can communicate with the HTTP, HTTPS, and WebSocket protocols. See the functions below for the full functionality.

`Server` parameters
```ts
Server(options = {
	apiDelimiters: ['{', '}'], // Equivalent to /^{(.+?)}$/
	apiPrefixes:   ['/api/'],  // Equivalent to /^\/api\//
})
```

Options
```ts
apiDelimiters: string array || RegExp
apiPrefixes:   string array || RegExp
```

`Server` partial example
```js
const Server = require('./spinneret/src/server');

const server = new Server({
	apiDelimiters: ['{', '}'],
	apiPrefixes:   ['/api/']
});
```

## API Request Handlers
Create a request handler for an HTTP request. All of the functions below `api` are shortcuts. For example, `server.get(path, fn)` is a shortcut to `server.api('get', path, fn)`.

`api` parameters
```ts
server.api(method, url, fn)

method: string
path:   string
fn:     function(req, res)
```

`api` full example
```js
const fs = require('node:fs');

const Env     = require('./src/env');
const Server  = require('./src/server');

const env    = new Env();
const server = new Server();

server.midApiAsync(
	server.midApiReqBodyJson,
	server.midApiReqBodyOther,
	server.midApiReqCookies,
	server.midApiReqUrlParams,
	server.midApiResDefaults,
	server.midApiResEnd,
);

const soups = [];

server.post('/api/soups', function(req, res)
{
	if (!req.body || !req.body.name)
		return res.endBadRequest();
	const soup = req.body;
	soup.id = soups.length;
	soups.push(soup);
	res.endJson(soup);
});

server.get('/api/soups', function(req, res)
{
	res.endJson(soups);
});

server.get('/api/soups/{soupId}', function(req, res) {
	const soupId = req.vars.soupId;
	if (isNaN(soupId) || soupId < 0 || soupId >= soups.length)
		return res.endNotFound();
	res.endJson(soups[soupId]);
});

server.listen({
	https: false,
	port: 8080,
});
```

`delete` parameters
```ts
server.delete(path, fn)

path: string
fn:   function(req, res)
```

`get` parameters
```ts
server.get(path, fn)

path: string
fn:   function(req, res)
```

`patch` parameters
```ts
server.patch(path, fn)

path: string
fn:   function(req, res)
```

`post` parameters
```ts
server.post(path, fn)

path: string
fn:   function(req, res)
```

`put` parameters
```ts
server.put(path, fn)

path: string
fn:   function(req, res)
```

## File Serving
Serve files as responses. Automatically send the index page if the URL is only a directory, or the not found page if a file is not found. If `cache` is true, then file contents since the first request of each file are cached in a Map in RAM. This caching eliminates reading the disk storage for each subsequent request of a file.

`files` parameters
```ts
server.files(options = {
	cache: false,
	dir: 'public',
	index: 'index.html',
	notFound: '404.html',
})

cache:     boolean
dir:       string || null
index:     string || null
notFound:  string || null
```

`files` full example
```js
const Server = require('./spinneret/src/server');

const server = new Server();

// Optional middleware
server.midFileAsync(
	server.midFileResContentSecurityPolicy,
	server.midFileResContentType,
);

server.files({
	cache:    false,
	dir:      'public',
	index:    'index.html',
	notFound: '404.html',
});

server.listen({
	port: 8080,
});
```

## File Serving Cache
Clear, disable, enable, and refresh the cache with the following functions. Refreshing the cache only refreshes the cached files contents that have already been cached by requests, and it removes those that have been deleted.

```js
server.cacheClear()
server.cacheDisable()
server.cacheEnable()
server.cacheRefresh()
```

## Listen to Requests
Call after giving the server API request handlers, WebSocket handlers, or files to serve. It can be called multiple times, for example if you want to listen to both HTTP and HTTPS via the `https` parameter. As another use case, you may want to ignore incoming data of certain file types over HTTP via the `types` parameter.

 `listen` parameters
```ts
server.listen(options = {
	https: false,
	host:  '::', // This works well no matter if the server/client is IPv4/IPv6
	port:  options.https ? 443 : 80,
	types: [],
})
```

Options from Spinneret which are built-in properties of Server
```ts
headersTimeout:       number // https://nodejs.org/api/http.html#serverheaderstimeout
keepAliveTimeout:     number // https://nodejs.org/api/http.html#serverkeepalivetimeout
maxHeadersCount:      number // https://nodejs.org/api/http.html#requestmaxheaderscount
maxRequestsPerSocket: number // https://nodejs.org/api/http.html#servermaxrequestspersocket
requestTimeout:       number // https://nodejs.org/api/http.html#serverrequesttimeout
timeout:              number // https://nodejs.org/api/http.html#servertimeout
```

Other options From Spinneret
```ts
caFile:      string,       // Name of file for ca option
certFile:    string,       // Name of file for cert option
crlFile:     string,       // Name of file for crl option
https:       boolean,      // Enable HTTPS
keyFile:     string,       // Name of file for key option
maxBodySize: number,       // Max number of bytes for the body
onlyHttps:   boolean,      // Redirect HTTP to HTTPS
onlyWss:     boolean,      // Stop unencrypted WS connections
pfxFile:     string,       // Name of file for pfx option
types:       string array, // Array of allowed incoming content-type values
```

Full documentation of built-in options

[server.listen(options[, callback])](https://nodejs.org/api/net.html#serverlistenoptions-callback)

[http.createServer([options][, requestListener])](https://nodejs.org/api/http.html#httpcreateserveroptions-requestlistener)

[https.createServer([options][, requestListener])](https://nodejs.org/api/https.html#httpscreateserveroptions-requestlistener)

`listen` partial examples
```js
server.listen({
	https: false,
	port: env.HTTP_PORT,
	types: [],
	onlyHttps: env.ONLY_HTTPS,
	onlyWss: env.ONLY_WSS,
});
```
```js
server.listen({
	https: true,
	port: env.HTTPS_PORT,
	types: [
		'image/png',
		'text/plain',
	],
	certFile: 'cert/self.crt',
	keyFile: 'cert/self.key',
	onlyWss: env.ONLY_WSS,
});
```

## Middleware

Before API request handlers are called or files are served, call middleware functions. These can be used to parse requests, authenticate users, authorize requests, prepare the response, add useful properties/functions to requests/responses, add useful headers, and more.

`midApiAsync` parameters
```ts
server.midApiAsync(...fn)

fn: function(req, res)
```

`midApiAsync` partial examples
```js
// All of the built-in API middleware, which all works asynchronously
server.midApiAsync(
	server.midApiReqBodyJson,
	server.midApiReqBodyOther,
	server.midApiReqCookies,
	server.midApiReqUrlParams,
	server.midApiResDefaults,
	server.midApiResEnd,
);
```
```js
// Step 1: Call 4 functions asynchronously
server.midApiAsync(
	custom_mid_1_c,
	custom_mid_1_d,
	custom_mid_1_a,
	custom_mid_1_b,
);
// Step 2: Call the next function which needed to wait for any of the previous 4
server.midApiAsync(
	custom_mid_2,
);
```

`midApiSync` parameters
```ts
server.midApiSync(...fn)

fn: function(req, res)
```

`midApiSync` partial example
```js
// Steps 1-3
server.midApiSync(
	custom_mid_1,
	custom_mid_2,
	custom_mid_3,
);
```

`midFileAsync` parameters
```ts
server.midFileAsync(...fn)

fn: function(req, res)
```

`midFileAsync` partial examples
```js
// All of the built-in file middleware, which all works asynchronously
server.midFileAsync(
	server.midFileResContentType,
	server.midFileResContentSecurityPolicy,
);
```
```js
// Step 1: Call 4 functions asynchronously
server.midFileAsync(
	custom_mid_1_c,
	custom_mid_1_d,
	custom_mid_1_a,
	custom_mid_1_b,
);
// Step 2: Call the next function which needed to wait for any of the previous 4
server.midFileAsync(
	custom_mid_2,
);
```

`midFileSync` parameters
```ts
server.midFileSync(...fn)

fn: function(req, res)
```

`midFileSync` partial example
```js
// Steps 1-3
server.midFileSync(
	custom_mid_1,
	custom_mid_2,
	custom_mid_3,
);
```

## Middleware Functions Provided for API Requests

`Server.midApiReqBodyJson`

* If the `content-type` of a request is `application/json`, then receive the request body in a Buffer using the fast method `Buffer.allocUnsafe` and parse as JSON.
* It is not necessary to add the middleware `Server.midApiReqBodyOther` unless you want to receive the body of other content types.

`Server.midApiReqBodyOther`

* Receive body in a Buffer using the fast method `Buffer.allocUnsafe`.
* If you add `Server.midApiReqBodyJson`, then this function skips JSON bodies.

`Server.midApiReqCookies`

* Parse the cookies from the Cookie header of a request. The object is accessed with `req.cookies` and the values are strings.

`Server.midApiReqUrlParams`

* Parse the URL parameters after the question mark ? of a request. The object is accessed with `req.params` and the values are strings.

`Server.midApiResDefaults`

* Set the defaults of the following values of a response
	* Status code: 201 if POST request, otherwise 200
	* Header: `Content-Type: text/plain`

`Server.midApiResEnd`

* Add the following methods, which are shortcuts for the code listed below each
```js
res.endJson(obj);

req.end(JSON.stringify(obj));
```
```js
res.endBadRequest(obj);

res.statusCode = 400;
res.end();
```
```js
res.endUnauthorized(obj);

res.statusCode = 401;
res.end();
```
```js
res.endNotFound(obj);

res.statusCode = 404;
res.end();
```
```js
res.endInternalError(obj);

res.statusCode = 500;
res.end();
```

## Middleware Functions Provided for File Handling

`Server.midFileResContentSecurityPolicy`

* Tell front-end to disable `eval()`, inline CSS & JS, requests to other pages, etc. This helps to prevent cross-site attacks, but other security measures should also be taken. See [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/Security/Types_of_attacks) to understand the various types of cross-site attacks, and [OWASP Cheat Sheet Series - XSS](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html) and [OWASP Cheat Sheet Series - CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) for preventing them.
* Header: `Content-Security-Policy: default-src 'self'`

`Server.midFileResContentType`

* Set the content-type for popular files so that they render properly.
* Header for JS files: `Content-Type: text/javascript`
* Header for SVG files: `Content-Type: image/svg+xml`


## WebSocket Event Handlers
[Event handler `soc` parameter](node.md)

For a given [WebSocket event](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket#events) string, the given event handler function is set up.

`ws` parameters
```ts
ws(event, fn)

event: string
fn:    function(soc)
```

`ws` full example
```js
const Server = require('./spinneret/src/server');

const server = new Server();

server.ws('close',   function(soc) { console.log('close') });
server.ws('error',   function(soc) { console.log('error') });
server.ws('message', function(soc) { console.log('message') });
server.ws('open',    function(soc) { console.log('open') });

server.listen({
	port: 8080,
});
```
