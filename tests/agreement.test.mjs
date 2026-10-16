// Speaking Engagement Agreement: the terms, the fee math, and the snapshot a
// client signs.
//
// The browser builds the preview and the server builds the snapshot it
// fingerprints, from two copies of one module. If they drift, the owner
// previews one agreement and the client signs another, so the copies must
// match byte for byte and produce the same snapshot. The fee math is pinned
// to the rate card, and every client string must be escaped on letterhead.
//
// Run: node tests/agreement.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadPure } from './_load-pure.mjs';

const terms = await loadPure('agreement-terms.js');
const render = await loadPure('agreement-render.js');
const server = createRequire(import.meta.url)('../functions/agreement-terms.js');
const { normalizeAgreement, computeFees, missingForSend, buildSnapshot, canonicalJson, FORMATS, TERMS_VERSION } = terms;

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const full = {
  agreementNo: 'SA-2026-1234',
  client: { legalName: 'Acme Corp', address: '1 Main St', signerName: 'Dana Lee', signerTitle: 'VP Sales', signerEmail: 'Dana@Acme.com' },
  event: { name: 'Kickoff', date: '2027-03-12', location: 'Omni OKC', format: 'keynote' },
  fees: {}
};

console.log('agreement — server copy');

ok('the server copy is the generated copy of the browser module', () => {
  const src = fs.readFileSync(new URL('../public/js/agreement-terms.js', import.meta.url), 'utf8');
  const gen = fs.readFileSync(new URL('../functions/agreement-terms.js', import.meta.url), 'utf8');
  assert.ok(gen.includes(src.replace(/^export /gm, '')), 'functions/agreement-terms.js is stale: run node scripts/build-agreement-server.cjs');
});

ok('browser and server build the identical snapshot', () => {
  assert.strictEqual(canonicalJson(buildSnapshot(full)), server.canonicalJson(server.buildSnapshot(full)));
});

console.log('agreement — fees');

ok('formats start at the rate card', () => {
  const fee = (k) => FORMATS.find((f) => f.key === k).fee;
  assert.strictEqual(fee('keynote'), 3500);
  assert.strictEqual(fee('headline-keynote'), 5000);
  assert.strictEqual(fee('workshop'), 6500);
  assert.strictEqual(fee('retreat-2'), 22000);
});

ok('a blank fee takes the format rate; a set fee is kept', () => {
  assert.strictEqual(normalizeAgreement({ event: { format: 'workshop' } }).fees.session, 6500);
  assert.strictEqual(normalizeAgreement({ event: { format: 'workshop' }, fees: { session: 6000 } }).fees.session, 6000);
});

ok('virtual is 20 percent off a keynote or workshop, never a retreat', () => {
  const k = computeFees({ event: { format: 'keynote', virtual: true } });
  assert.strictEqual(k.total, 2800);
  const r = computeFees({ event: { format: 'retreat-2', virtual: true } });
  assert.strictEqual(r.total, 22000);
});

ok('add-ons, total, and the 50 percent deposit', () => {
  const f = computeFees({ event: { format: 'workshop' }, fees: { travel: true, workbooks: 10, recording: true } });
  assert.strictEqual(f.total, 6500 + 1500 + 950 + 2500);
  assert.strictEqual(f.deposit, f.total / 2);
  assert.strictEqual(f.deposit + f.balance, f.total);
});

console.log('agreement — sending and signing');

ok('a blank agreement cannot be sent; a complete one can', () => {
  assert.ok(missingForSend({}).length >= 6);
  assert.deepStrictEqual(missingForSend(full), []);
  assert.deepStrictEqual(missingForSend({ ...full, event: { ...full.event, location: '', virtual: true } }), []);
});

ok('the snapshot carries the terms version and the parties', () => {
  const s = buildSnapshot(full);
  assert.strictEqual(s.termsVersion, TERMS_VERSION);
  assert.strictEqual(s.client.legalName, 'Acme Corp');
  assert.strictEqual(s.client.signerEmail, 'dana@acme.com');
  assert.strictEqual(s.sections.length, 9);
  assert.ok(s.sections.every((sec) => sec.clauses.every((c, i) => c.n === `${sec.n}.${i + 1}`)));
});

ok('the media clause gives The One Percent every recording', () => {
  const six = buildSnapshot(full).sections.find((s) => s.n === '6');
  const text = six.clauses.map((c) => c.text).join(' ');
  assert.ok(/owns all Recordings/.test(text));
  assert.ok(/hereby assigns to The One Percent all right, title, and interest, including copyright/.test(text));
});

ok('the electronic signature clause is present', () => {
  const nine = buildSnapshot(full).sections.find((s) => s.n === '9');
  assert.ok(/Uniform Electronic Transactions Act/.test(nine.clauses.map((c) => c.text).join(' ')));
});

ok('the snapshot is storable in Firestore (no array directly inside an array)', () => {
  const walk = (v, inArray) => {
    if (Array.isArray(v)) { assert.ok(!inArray, 'nested array found'); v.forEach((x) => walk(x, true)); }
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, false));
  };
  walk(buildSnapshot({ ...full, fees: { travel: true, workbooks: 5, recording: true } }), false);
});

ok('canonical JSON ignores key order', () => {
  assert.strictEqual(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});

ok('no em dashes in the terms', () => {
  assert.ok(!/—/.test(JSON.stringify(buildSnapshot(full))));
});

console.log('agreement — the document');

ok('every client string is escaped on letterhead', () => {
  const evil = { ...full, client: { ...full.client, legalName: '<script>x</script>' }, specialTerms: '<img src=x onerror=alert(1)>' };
  const html = render.renderAgreement(buildSnapshot(evil), {
    client: { name: '<b>Dana</b>', title: 'VP', email: 'd@a.com', signedAt: 1, ip: '1.2.3.4' },
    provider: { name: 'Anthony Brown Sr.', title: 'Founder', signedAt: 1 },
    audit: { sentAt: 1, viewedAt: 1, hash: 'abc' }
  });
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>Dana</b>'));
});

ok('the certificate appears only once the client has signed', () => {
  const s = buildSnapshot(full);
  assert.ok(!render.renderAgreement(s, {}).includes('Certificate of Completion'));
  assert.ok(render.renderAgreement(s, {
    provider: { name: 'A', title: 'F', signedAt: 1 }, client: { name: 'D', title: 'V', email: 'e', signedAt: 2, ip: 'x' }, audit: { sentAt: 1, viewedAt: 1, hash: 'h' }
  }).includes('Certificate of Completion'));
});

console.log(`\n${passed} passed`);
