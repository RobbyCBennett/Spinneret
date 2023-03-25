# Module: `./spinneret/src/parse`

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
