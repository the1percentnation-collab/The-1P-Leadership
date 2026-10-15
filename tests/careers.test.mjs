// Join the Team: the posted roles and the CRM tags their inquiries get.
//
// The page (public/js/careers-data.js) and the server (functions/careers.js)
// each keep a list of role keys. If they drift, an inquiry for a new role
// lands in the CRM as "Not Sure" and the hiring track has no filter. These
// also pin the copy rules for the financial roles.
//
// Run: node tests/careers.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { loadPure } from './_load-pure.mjs';

const data = await loadPure('careers-data.js');
const server = createRequire(import.meta.url)('../functions/careers.js');
const { TEAMS, ROLES, NOT_SURE, openRoles, roleByKey } = data;
const { CAREER_ROLE_TAGS, careerTags, RECRUITING_TAG } = server;

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('careers — roles and tags');

ok('every posted role has a CRM tag on the server, and the server has no extras', () => {
  const page = [...ROLES.map((r) => r.key), NOT_SURE.key].sort();
  assert.deepStrictEqual(Object.keys(CAREER_ROLE_TAGS).sort(), page);
});

ok('every inquiry is tagged Recruiting plus its role', () => {
  assert.deepStrictEqual(careerTags('coach'), [RECRUITING_TAG, 'Recruit: 1P Coach']);
  assert.deepStrictEqual(careerTags('securities'), [RECRUITING_TAG, 'Recruit: Securities']);
});

ok('an unknown or forged role key falls back to Not Sure, never a free-form tag', () => {
  assert.deepStrictEqual(careerTags('<b>VIP</b>'), [RECRUITING_TAG, 'Recruit: Not Sure']);
  assert.deepStrictEqual(careerTags(undefined), [RECRUITING_TAG, 'Recruit: Not Sure']);
});

ok('every role belongs to a team and has the fields the card renders', () => {
  for (const r of ROLES) {
    assert.ok(TEAMS.some((t) => t.key === r.team), `${r.key}: unknown team`);
    assert.ok(r.title && r.summary, `${r.key}: title and summary`);
    assert.ok(Array.isArray(r.meta) && r.does.length && r.fits.length, `${r.key}: meta, does, fits`);
  }
});

ok('a closed role is hidden and cannot be preselected by link', () => {
  const target = ROLES[0];
  const was = target.open;
  target.open = false;
  try {
    assert.ok(!openRoles().includes(target));
    assert.strictEqual(roleByKey(target.key), null);
  } finally { target.open = was; }
  assert.strictEqual(roleByKey('not-sure'), NOT_SURE);
  assert.strictEqual(roleByKey('nope'), null);
});

ok('financial roles carry the disclaimer and make no pay or product claims', () => {
  const fin = TEAMS.find((t) => t.key === 'financial');
  assert.ok(/not an offer of employment/i.test(fin.disclaimer));
  assert.ok(/separate company/i.test(fin.disclaimer));
  const text = JSON.stringify(ROLES.filter((r) => r.team === 'financial'));
  assert.ok(!/\$|commission|salary|income|guarantee|unlimited|six.figure/i.test(text), 'pay or guarantee language found');
});

ok('no em dashes in the posted copy', () => {
  assert.ok(!/—/.test(JSON.stringify({ TEAMS, ROLES })));
  assert.ok(!/—/.test(fs.readFileSync(new URL('../public/join.html', import.meta.url), 'utf8').replace(/<style>[\s\S]*?<\/style>/, '')));
});

console.log(`\n${passed} passed`);
