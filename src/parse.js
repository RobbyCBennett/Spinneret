module.exports = {
	// Given a cookie string/undefined, parse the string to an object
	cookieStringToObj: function(str) {
		const obj = {};

		// Skip if there are no cookies
		if (!str)
			return obj;

		// Parse the cookies
		let key   = [];
		let value = [];
		let parsingKey    = true;
		let parsingQuotes = false;
		for (let i = 0; i < str.length; i++) {
			// Parse key
			if (parsingKey) {
				// Skip if before key
				if (str[i] === ';' || /\s/.test(str[i])) {
					continue;
				}
				// Skip if after key and skip more if value is in quotes
				else if (str[i] === '=') {
					parsingKey = false;
					parsingQuotes = (i < str.length - 1 && str[i+1] === '"');
					if (parsingQuotes)
						i++;
					continue;
				}
				key.push(str[i]);
			}
			// Parse value
			else {
				// See if after value
				let end = false;
				if (str[i] === ';') {
					end = !parsingQuotes;
				}
				else if (str[i] === '"') {
					end = str[i-1] !== '\\';
				}
				else if (i === str.length - 1) {
					value.push(str[i]);
					end = true;
				}
				// Skip after value, and add key and parsed value to object
				if (end) {
					parsingKey = true;
					obj[key.join('')] = value.join('');
					key   = [];
					value = [];
					continue;
				}
				value.push(str[i]);
			}
		}

		return obj;
	},

	// String to any primitive type
	stringToValue: function(str) {
		// Boolean
		const lower = str.toLowerCase();
		if (lower == 'false')
			return false;
		if (lower == 'true')
			return true;

		// Number
		if (/^(-|\+?((\d*\.\d+|\d+)([Ee][+-]?\d+)?|Infinity))$/.test(str)) {
			const num = parseFloat(str);
			if (!isNaN(num))
				return num;
		}

		// String
		const inner = str.match(/^'(.*)'$|^"(.*)"$/);
		if (inner)
			return inner[1];
		return str;
	},
};
