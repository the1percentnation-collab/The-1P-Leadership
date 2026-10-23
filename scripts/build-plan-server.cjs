// Regenerates functions/plan-core.js from public/js/plan-core.js.
//
// The managePlan callable and the hourly plan reminders apply the same goal
// rules as the wizard and the My Plan page. Node 20 functions cannot require
// an ES module, so the server gets a CommonJS copy. One source, one command:
//   node scripts/build-plan-server.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/js/plan-core.js'), 'utf8');
const m = /\nexport \{([\s\S]*?)\};\s*$/.exec(src);
if (!m) throw new Error('public/js/plan-core.js must end with one `export { ... };` list');
const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
const body = src.slice(0, m.index);
const head = `// GENERATED COPY of public/js/plan-core.js for the Cloud Functions
// runtime (Node 20 cannot require an ES module). Do not edit by hand: edit the
// browser module, then regenerate with
//   node scripts/build-plan-server.cjs
// tests/plan.test.mjs fails if the two drift apart.

`;
fs.writeFileSync(path.join(root, 'functions/plan-core.js'),
  head + body + `\nmodule.exports = {\n  ${names.join(', ')}\n};\n`);
console.log('functions/plan-core.js written:', names.length, 'exports');
