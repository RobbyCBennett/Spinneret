# Module: `./spinneret/src/parse`

## Function: `cookieStringToObj`

Given a cookie string/undefined and an existing object, parse the string.

`cookieStringToObj` parameters
```ts
cookieStringToObj(str)

str: string
```

`cookieStringToObj` full example
```js
const parse = require('./spinneret/src/parse');

parse.cookieStringToObj('key_a=value; key_b="longer \\" ; value"');
// object: {
//		key_a: 'value',
// 		key_b: 'longer \\" ; value'
// }
}
```

## Function: `stringToValue`

Parse any string into a boolean, number, or string.

`stringToValue` parameters
```ts
stringToValue(str)

str: string
```

`stringToValue` full example
```js
const parse = require('./spinneret/src/parse');

parse.stringToValue('TrUe');  // boolean: true
parse.stringToValue('-1.23'); // number: -1.23
parse.stringToValue('x y');   // string: 'x y'
```
