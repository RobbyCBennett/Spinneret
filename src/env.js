'use strict';


const fs = require('node:fs');

const parse = require('./parse');


module.exports = class Env
{
	#obj

	constructor(sources = [
		{ filename: '.env' },
	])
	{
		this.#obj = {};

		// Parse each source, overwriting values of previous sources
		for (const source of sources) {
			if (source.filename)
				this.#parseFile(source.filename);
			else if (source.process)
				this.#parseProcess();
		}

		return this.#obj;
	}

	#parseFile(filename) {
		// Parse file into lines or throw an error
		let lines = [];
		try {
			lines = fs.readFileSync(filename).toString().split('\n');
		} catch (err) {
			throw `Spinneret Env: Error opening ${filename}`;
		}

		// Parse lines
		for (const line of lines) {
			// Parse line into key and value
			const keyAndValue = line.match(/(^[_a-zA-Z]\w+)\s*=\s*(.*)/);
			if (!keyAndValue)
				continue;
			const key   = keyAndValue[1];
			const value = keyAndValue[2];

			// Save key & parsed value
			this.#obj[key] = parse.stringToValue(value);
		}
	}

	#parseProcess() {
		// Save key & parsed value
		for (const [key, value] of Object.entries(process.env))
			this.#obj[key] = parse.stringToValue(value);
	}

};
