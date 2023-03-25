module.exports = {
	// String to any primitive type
	stringToValue: function(str) {
		// Boolean
		const lower = str.toLowerCase();
		if (lower == 'false')
			return false;
		if (lower == 'true')
			return true;

		// Number
		const num = parseFloat(str);
		if (!isNaN(num))
			return num;

		// String
		const inner = str.match(/['"](.*)['"]/);
		if (inner)
			return inner[1];
		return str;
	},
};
