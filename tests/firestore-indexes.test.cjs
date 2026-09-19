// Validate firestore.indexes.json before a deploy does it for us.
//
// This exists because of a real failure: a composite index was declared with a
// single field, Firestore rejected it with "this index is not necessary,
// configure using single field index controls", and because the rules-and-
// indexes step runs first and aborts the job, the Cloud Functions deploy never
// ran at all. One bad line in a config file took the whole backend deploy down
// while the hosting deploy succeeded — so the frontend went live calling
// functions that had not shipped.
//
// The CLI only reports the first offending collection group, so these checks
// list every problem at once.
//
// Run: node tests/firestore-indexes.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const raw = fs.readFileSync(path.join(__dirname, '..', 'firestore.indexes.json'), 'utf8');
let doc;
try { doc = JSON.parse(raw); }
catch (e) { console.error('firestore.indexes.json is not valid JSON: ' + e.message); process.exit(1); }

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const indexes = doc.indexes || [];
const label = (i) => `${i.collectionGroup}(${(i.fields || []).map((f) => f.fieldPath).join(', ')})`;

console.log(`firestore.indexes.json — ${indexes.length} composite index(es)`);

ok('every index declares at least two fields', () => {
  // Firestore auto-indexes single fields and rejects a composite that declares
  // one. This is the exact failure that broke the deploy.
  const bad = indexes.filter((i) => (i.fields || []).length < 2);
  assert.strictEqual(bad.length, 0,
    'single-field composites are rejected by Firestore — remove them, the field is already indexed automatically:\n      '
    + bad.map(label).join('\n      '));
});

ok('every index names a collection group and a valid scope', () => {
  indexes.forEach((i) => {
    assert.ok(i.collectionGroup, 'an index has no collectionGroup: ' + JSON.stringify(i));
    assert.ok(['COLLECTION', 'COLLECTION_GROUP'].includes(i.queryScope),
      `${label(i)} has queryScope "${i.queryScope}"`);
  });
});

ok('every field has a direction or an array config, never both and never neither', () => {
  indexes.forEach((i) => {
    (i.fields || []).forEach((f) => {
      assert.ok(f.fieldPath, `${label(i)} has a field with no fieldPath`);
      const hasOrder = 'order' in f;
      const hasArray = 'arrayConfig' in f;
      assert.ok(hasOrder !== hasArray,
        `${label(i)} field "${f.fieldPath}" must have exactly one of order / arrayConfig`);
      if (hasOrder) {
        assert.ok(['ASCENDING', 'DESCENDING'].includes(f.order),
          `${label(i)} field "${f.fieldPath}" has order "${f.order}"`);
      }
      if (hasArray) {
        assert.strictEqual(f.arrayConfig, 'CONTAINS',
          `${label(i)} field "${f.fieldPath}" has arrayConfig "${f.arrayConfig}"`);
      }
    });
  });
});

ok('no two indexes are identical', () => {
  const seen = new Map();
  indexes.forEach((i) => {
    const key = JSON.stringify([i.collectionGroup, i.queryScope, i.fields]);
    assert.ok(!seen.has(key), `duplicate index: ${label(i)}`);
    seen.set(key, true);
  });
});

ok('fieldOverrides, if present, are well formed', () => {
  (doc.fieldOverrides || []).forEach((o) => {
    assert.ok(o.collectionGroup, 'a fieldOverride has no collectionGroup');
    assert.ok(o.fieldPath, `fieldOverride on ${o.collectionGroup} has no fieldPath`);
  });
});

ok('the recency indexes the CRM reports rely on are present', () => {
  // Not style — these back the "who has gone quiet, by stage / by owner"
  // queries. Losing them turns those into a runtime index error.
  const want = [
    ['contacts', 'stage', 'lastContactedAt'],
    ['contacts', 'ownerUid', 'lastContactedAt']
  ];
  want.forEach(([group, a, b]) => {
    const hit = indexes.some((i) => i.collectionGroup === group
      && (i.fields || []).length === 2
      && i.fields[0].fieldPath === a && i.fields[1].fieldPath === b);
    assert.ok(hit, `missing index ${group}(${a}, ${b})`);
  });
});

console.log(`\n${passed} checks passed.`);
