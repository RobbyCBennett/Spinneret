# Module: `./spinneret/src/env`

## Class: `Env`

## Constructor
Get an object with all of the sources of environment variables. If variable keys are repeated, then the last sources replace the values of the earlier sources. The `filename` parameter is considered before the `process` parameter.

`Env` parameters
```ts
Env(sources)

sources: object array = [{
	filename: '.env',
	process:  false
}]

filename: string
process:  boolean
```

`Env` full example
```.env
secure = TrUe
num    = -1.23
cookie = Chocolate Chip
```
```js
const Env = require('./spinneret/src/env');

// Default (see parameters above for default)
const env = new Env();

env.secure; // boolean: true
env.num;    // number: -1.23
env.cookie; // string: 'Chocolate Chip'
```
```js
const Env = require('./spinneret/src/env');

// Parse .env file, then process.env
const env = new Env(
	{ filename: '.env' },
	{ process: true },
);
```
