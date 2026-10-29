// Regenerates functions/email-layout-core.js from public/js/email-layout-core.js.
//
// The campaign editor previews and the server sends with the same renderer,
// so the preview is exactly what the list receives. Node 20 functions cannot
// require an ES module, so the server gets a CommonJS copy. One source, one
// command:
//   node scripts/build-email-layout-server.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/js/email-layout-core.js'), 'utf8');
const m = src.match(/\nexport \{([\s\S]*?)\};\s*$/);
if (!m) throw new Error('email-layout-core.js must end with one `export { ... };` block');
const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
const body = src.slice(0, m.index + 1);
const head = `// GENERATED COPY of public/js/email-layout-core.js for the Cloud Functions
// runtime (Node 20 cannot require an ES module). Do not edit by hand: edit the
// browser module, then regenerate with
//   node scripts/build-email-layout-server.cjs
// tests/email-layout.test.mjs fails if the two drift apart.

`;
fs.writeFileSync(path.join(root, 'functions/email-layout-core.js'),
  head + body + `\nmodule.exports = {\n  ${names.join(', ')}\n};\n`);
console.log('functions/email-layout-core.js written:', names.length, 'exports');
