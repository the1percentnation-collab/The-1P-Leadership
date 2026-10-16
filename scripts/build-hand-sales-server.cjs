// Regenerates functions/hand-sales-core.js from public/js/hand-sales-core.js.
//
// The store console, the invoice page and the server price, bucket and
// remind on the same rules. Node 20 functions cannot require an ES module,
// so the server gets a CommonJS copy. One source, one command:
//   node scripts/build-hand-sales-server.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/js/hand-sales-core.js'), 'utf8');
const m = src.match(/\nexport \{([\s\S]*?)\};\s*$/);
if (!m) throw new Error('hand-sales-core.js must end with one `export { ... };` block');
const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
const body = src.slice(0, m.index + 1);
const head = `// GENERATED COPY of public/js/hand-sales-core.js for the Cloud Functions
// runtime (Node 20 cannot require an ES module). Do not edit by hand: edit the
// browser module, then regenerate with
//   node scripts/build-hand-sales-server.cjs
// tests/hand-sales.test.mjs fails if the two drift apart.

`;
fs.writeFileSync(path.join(root, 'functions/hand-sales-core.js'),
  head + body + `\nmodule.exports = {\n  ${names.join(', ')}\n};\n`);
console.log('functions/hand-sales-core.js written:', names.length, 'exports');
