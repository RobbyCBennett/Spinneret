# 🕷 Spinneret 🕸
Zero-dependency web framework for Node.js

# 🧠 Design Philosophy

* Simple API
* Efficient asynchronous middleware
* Separate middleware for API requests & file requests
* One readable file for each module
* Extensible as Node.js
* Fast startup & responses

# 📥 Installation
Shell
```sh
cd MY_EXISTING_REPO_HERE
git submodule add git@github.com:RobbyCBennett/spinneret.git
```

JavaScript
```js
// Import classes and functions from modules
const Env    = require('./spinneret/src/env')
const parse  = require('./spinneret/src/parse')
const Server = require('./spinneret/src/server')
```

# 📚 Features & Documentation

### [Env](doc/env.md)
* Read environment variables
	* Read each source, whether it is `process.env`, an .env file, or others
	* Creates an object with parsed values

### [Node.js Classes](doc/node.md)
* Notable built-in properties/methods for requests, responses, and sockets, and additions
	* Request
		* Property: Body ready in a Buffer or parsed as JSON
		* Property: URL variables in the path
		* Property: URL parameters after the question mark ?
	* Response
		* Functions: Shortcuts to common responses:
			* JSON
			* Bad request
			* Unauthorized
			* Not found
			* Internal server error
	* WebSocket Client
		* Function: Encode data to be sent to several clients
		* Function: Send data to a client
		* Property: Message from a client ready as a Buffer

### [Parse](doc/parse.md)
* Parse any string into a boolean, number, or string

### [Server](doc/server.md)
* HTTP/HTTPS: Receive requests and send responses
	* File Serving
		* Redirection to HTTPS
		* Specify the public directory, index.html, or 404.html
		* Cannot serve backend directory or its ancestors for security
	* API Handling
		* Redirection to HTTPS
		* URL path variables using any delimiters, where the default looks like `/notes/{note_id}`
		* Synchronous or asynchronous middleware for API/files
		* Skip reading the file system if API path prefixes are set
	* Middleware
		* Call groups of asynchronous middleware for fast responses
		* Call groups of synchronous middleware if the order matters
		* Built-in Required Middleware for All
			* Request
				* Remove trailing slash from `req.url`
				* Move URL ?parameters to `req.params` string
		* Built-in Optional Middleware for API Handling
			* Request
				* Move URL variables in path to `req.vars` object with parsed values
				* Move URL parameters after question mark ? to `req.params` object with parsed values
				* Move JSON body to parsed `req.body` object with parsed values
				* Move other body to `req.body` buffer
			* Response
				* Set default values for status code and Content-Type header
				* Add useful functions to end the response for JSON, bad requests, not found, .etc
		* Built-in Optional Middleware for File Serving
			* Response
				* Allow popular Content-Type bodies to be accepted properly (SVG)
				* Make the Content-Security-Policy strict to help prevent [cross-site attacks](doc/server.md#middleware-functions-provided-for-file-handling)
* WebSocket: Receive and send messages
	* Event handling functions using the same terms as the Web API of frontend/browsers (close, error, message, and open)
	* Automatically decode/encode messages
	* Encode messages for efficiently broadcasting to several specific clients
