// Short links in firebase.json hosting redirects.
//
// the1pnation.com/icantpreview is the link sent in the chapter one campaign,
// so it must keep landing on the open-access preview in the reader.
//
// Run: node tests/hosting-redirects.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const hosting = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase.json'), 'utf8')).hosting;
// Hosting matches `regex` with RE2 in production but JS in the emulator,
// so patterns stay in the syntax both share (no inline (?i) flag: the
// emulator refuses to start on it). Compiled here the way the emulator does.
const toJs = (re) => new RegExp(re, 'u');
const target = (url) => {
  const r = (hosting.redirects || []).find((x) => (x.regex ? toJs(x.regex).test(url) : x.source === url));
  return r ? r.destination : null;
};

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('hosting — short links');

ok('/icantpreview opens the chapter one preview in the reader', () => {
  for (const u of ['/icantpreview', '/icantpreview/', '/ICantPreview', '/IcantPreview/']) {
    assert.strictEqual(target(u), '/read?book=i-cant-preview', u);
  }
});

ok('it does not catch other paths', () => {
  for (const u of ['/icantpreviewx', '/icant', '/read', '/x/icantpreview']) assert.strictEqual(target(u), null, u);
});

ok('every redirect pattern compiles as the emulator compiles it', () => {
  for (const r of hosting.redirects || []) if (r.regex) toJs(r.regex);
});

ok('it is temporary (302), so it can be repointed', () => {
  assert.strictEqual(hosting.redirects.find((x) => x.destination === '/read?book=i-cant-preview').type, 302);
});

console.log(`\n${passed} passed`);
