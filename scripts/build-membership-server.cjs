// Regenerates functions/membership-core.js from public/js/membership-core.js.
//
// Checkout, the webhook, and the course gates on the server apply the same
// membership rules as the site. Node 20 functions cannot require an ES
// module, so the server gets a CommonJS copy. One source, one command:
//   node scripts/build-membership-server.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/js/membership-core.js'), 'utf8');
const names = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const body = src.replace(/^export /gm, '');
const head = `// GENERATED COPY of public/js/membership-core.js for the Cloud Functions
// runtime (Node 20 cannot require an ES module). Do not edit by hand: edit the
// browser module, then regenerate with
//   node scripts/build-membership-server.cjs
// tests/membership.test.mjs fails if the two drift apart.

`;
fs.writeFileSync(path.join(root, 'functions/membership-core.js'),
  head + body + `\nmodule.exports = { ${names.join(', ')} };\n`);
console.log('functions/membership-core.js written:', names.join(', '));
