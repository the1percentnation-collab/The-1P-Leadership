// Regenerates functions/agreement-terms.js from public/js/agreement-terms.js.
//
// The signing server builds and hashes the exact snapshot a client signs, so
// it needs the same terms the builder shows. Node 20 functions cannot require
// an ES module, so the server gets a CommonJS copy. One source, one command:
//   node scripts/build-agreement-server.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/js/agreement-terms.js'), 'utf8');
const names = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
const body = src.replace(/^export /gm, '');
const head = `// GENERATED COPY of public/js/agreement-terms.js for the Cloud Functions
// runtime (Node 20 cannot require an ES module). Do not edit by hand: edit the
// browser module, then regenerate with
//   node scripts/build-agreement-server.cjs
// tests/agreement.test.mjs fails if the two drift apart.

`;
fs.writeFileSync(path.join(root, 'functions/agreement-terms.js'),
  head + body + `\nmodule.exports = { ${names.join(', ')} };\n`);
console.log('functions/agreement-terms.js written:', names.join(', '));
