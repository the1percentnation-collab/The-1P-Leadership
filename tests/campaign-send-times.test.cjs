// scripts/set-campaign-send-times.js and its workflow.
//
// Pinned here:
// 1. A time needs its own offset, and must be in the future and within a year.
// 2. Only a draft or approved campaign is scheduled; it never approves or sends.
// 3. The workflow acts only on lines added to campaign-send-times.txt: a dry
//    run on the pull request, applied on merge.
//
// Run: node tests/campaign-send-times.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const { parseArgs, decide, fmt } = require(path.join(root, 'scripts', 'set-campaign-send-times.js'));
const src = fs.readFileSync(path.join(root, 'scripts', 'set-campaign-send-times.js'), 'utf8');
const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'schedule-campaigns.yml'), 'utf8');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const NOW = Date.parse('2026-11-10T22:00:00-05:00');

console.log('campaign-send-times');
ok('an id=time pair parses to the right instant, dry run by default', () => {
  const r = parseArgs(['a-b=2026-11-11T09:00:00-05:00'], NOW);
  assert.strictEqual(r.apply, false);
  assert.strictEqual(r.items[0].id, 'a-b');
  assert.strictEqual(r.items[0].at.toISOString(), '2026-11-11T14:00:00.000Z');
  assert.strictEqual(parseArgs(['a-b=2026-11-11T14:00Z', '--apply'], NOW).apply, true);
  assert.strictEqual(fmt(r.items[0].at), 'Wed, Nov 11, 2026, 9:00 AM ET');
});

ok('several pairs may arrive in one string', () => {
  const r = parseArgs(['a-b=2026-11-11T09:00:00-05:00 c-d=2026-12-01T08:00:00-05:00'], NOW);
  assert.deepStrictEqual(r.items.map((x) => x.id), ['a-b', 'c-d']);
});

ok('a time without an offset is refused, so it cannot land in the wrong zone', () => {
  for (const bad of ['2026-11-11T09:00:00', '2026-11-11 09:00', '2026-11-11', 'tomorrow', '']) {
    assert.throws(() => parseArgs([`a-b=${bad}`], NOW), /must look like/, bad);
  }
  assert.throws(() => parseArgs(['a-b'], NOW), /must look like/);
});

ok('a past time, a far-off time, a bad date and a repeat are refused', () => {
  assert.throws(() => parseArgs(['a-b=2026-11-10T09:00:00-05:00'], NOW), /already passed/);
  assert.throws(() => parseArgs(['a-b=2028-01-01T09:00:00-05:00'], NOW), /more than a year/);
  assert.throws(() => parseArgs(['a-b=2026-13-45T09:00:00-05:00'], NOW), /not a real date/);
  assert.throws(() => parseArgs(['a-b=2026-11-11T09:00:00-05:00 a-b=2026-11-12T09:00:00-05:00'], NOW), /twice/);
  assert.throws(() => parseArgs(['../x=2026-11-11T09:00:00-05:00'], NOW), /Not a campaign id/);
  assert.throws(() => parseArgs(['--apply'], NOW), /at least one/);
});

ok('only a draft or approved campaign is scheduled', () => {
  for (const s of ['draft', undefined, 'approved', 'ready']) assert.strictEqual(decide(true, s), 'schedule', String(s));
  for (const s of ['rejected', 'sending', 'sent', 'scheduled']) assert.strictEqual(decide(true, s), 'keep', s);
  assert.strictEqual(decide(false, undefined), 'missing');
});

ok('it writes only the send time: never a status, never a send', () => {
  const update = src.slice(src.indexOf('tx.update(ref, {'), src.indexOf('return { action: a'));
  assert.ok(/sendAt:/.test(update) && /updatedAt:/.test(update));
  assert.ok(!/status|approved/.test(update));
  assert.ok(!/dispatchCampaign|sendCampaign|sgMail|sendgrid/i.test(src));
  assert.ok(/runTransaction/.test(src) && /tx\.get\(ref\)/.test(src));
});

ok('the workflow acts only on the send-times file: dry run on a PR, apply on merge', () => {
  const paths = wf.match(/paths:\n\s+- 'scripts\/campaign-send-times\.txt'/g) || [];
  assert.strictEqual(paths.length, 2);
  assert.ok(/push:\n\s+branches:\n\s+- main\n/.test(wf), 'push is main only');
  assert.ok(!/^\s+(schedule|workflow_dispatch):/m.test(wf));
  const pr = wf.slice(wf.indexOf('pull_request)'), wf.indexOf('push)'));
  assert.ok(/APPLY=false/.test(pr) && !/APPLY=true/.test(pr));
  assert.ok(/permissions:\n  contents: read/.test(wf));
});

ok('only added lines are acted on, and event values reach the shell through env', () => {
  assert.ok(/git diff --unified=0/.test(wf) && /grep '\^\+\[\^\+\]'/.test(wf));
  const runs = wf.split(/\n\s+run: \|\n/).slice(1).map((r) => r.split(/\n      - /)[0]);
  assert.ok(runs.length >= 3);
  runs.forEach((r) => assert.ok(!r.includes('${{'), 'expression inside a run script'));
});

ok('every line in the record file is an id and a time with its offset', () => {
  const lines = fs.readFileSync(path.join(root, 'scripts', 'campaign-send-times.txt'), 'utf8')
    .split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  assert.ok(lines.length >= 1);
  for (const l of lines) {
    const parts = l.split(/\s+/);
    assert.strictEqual(parts.length, 2, l);
    // Past lines are a record, so judge each against a clock before its time.
    parseArgs([`${parts[0]}=${parts[1]}`], Date.parse(parts[1]) - 60000);
  }
});

console.log(`\n${passed} passed`);
