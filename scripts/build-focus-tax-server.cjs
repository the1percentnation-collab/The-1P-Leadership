// Regenerates functions/focus-tax.js from public/js/focus-tax-core.js.
//
// The calculator's math runs in the browser (ES module) and on the server,
// which recomputes the emailed report from the visitor's inputs rather than
// trusting totals sent by the page. Node 20 functions cannot require an ES
// module, so the server gets a CommonJS copy. One source, one command:
//   node scripts/build-focus-tax-server.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/js/focus-tax-core.js'), 'utf8');
const names = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const body = src.replace(/^export /gm, '');
const head = `// GENERATED COPY of public/js/focus-tax-core.js for the Cloud Functions
// runtime (Node 20 cannot require an ES module). Do not edit by hand: edit the
// browser module, then regenerate with
//   node scripts/build-focus-tax-server.cjs
// tests/focus-tax.test.mjs fails if the two drift apart.

`;
fs.writeFileSync(path.join(root, 'functions/focus-tax.js'),
  head + body + `\nmodule.exports = { ${names.join(', ')} };\n`);
console.log('functions/focus-tax.js written:', names.join(', '));
