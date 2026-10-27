// Link previews: what iMessage, Slack and social apps show when someone
// texts a the1pnation.com link.
//
// iMessage reads og:image for the big card and /apple-touch-icon.png for
// the small icon; without either it shows a blank compass. These pin that
// every shared page names a card that exists, and that the root icons are
// real squares in the brand mark.
//
// Run: node tests/share-preview.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PUB = path.join(__dirname, '..', 'public');
let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}
function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.strictEqual(b.toString('ascii', 1, 4), 'PNG', `${file} is not a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

console.log('share previews');

ok('the root apple-touch-icon is a 180px square PNG (iMessage asks for it by name)', () => {
  for (const f of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
    assert.deepStrictEqual(pngSize(path.join(PUB, f)), [180, 180], f);
  }
  assert.ok(fs.existsSync(path.join(PUB, 'favicon.ico')), 'favicon.ico');
});

const SHARED = ['index', 'about', 'books', 'membership', 'join', 'start', 'clc', 'listen', 'speaking'];
ok('every shared page names a preview card that ships with the site', () => {
  for (const n of SHARED) {
    const html = fs.readFileSync(path.join(PUB, `${n}.html`), 'utf8');
    const m = /<meta property="og:image" content="https:\/\/the1pnation\.com(\/[^"]+)"/.exec(html);
    assert.ok(m, `${n}.html has no og:image`);
    assert.ok(fs.existsSync(path.join(PUB, m[1])), `${n}.html points at a missing ${m[1]}`);
    assert.ok(/twitter:card/.test(html), `${n}.html has no twitter:card`);
  }
});

ok('the homepage links the brand icon', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(html.includes('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">'));
});

console.log(`\n${passed} passed`);
