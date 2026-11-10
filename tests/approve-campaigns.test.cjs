// scripts/approve-campaigns.js and its workflow.
//
// Pinned here:
// 1. Only a draft is approved; anything past draft is left alone.
// 2. Ids are validated before anything is read or written.
// 3. The script writes what the Approve button writes, and never sends.
// 4. The workflow acts only on ids added to campaign-approvals.txt (dry run
//    on the pull request, applied on merge) or on a hand run.
//
// Run: node tests/approve-campaigns.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const { parseArgs, decide } = require(path.join(root, 'scripts', 'approve-campaigns.js'));
const src = fs.readFileSync(path.join(root, 'scripts', 'approve-campaigns.js'), 'utf8');
const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'approve-campaigns.yml'), 'utf8');
const pageSrc = fs.readFileSync(path.join(root, 'public', 'js', 'campaigns.js'), 'utf8');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('approve-campaigns');
ok('only a draft is approved', () => {
  assert.strictEqual(decide(true, 'draft'), 'approve');
  assert.strictEqual(decide(true, undefined), 'approve');
  for (const s of ['approved', 'ready', 'rejected', 'sending', 'sent', 'scheduled']) {
    assert.strictEqual(decide(true, s), 'keep', s);
  }
  assert.strictEqual(decide(false, undefined), 'missing');
});

ok('a dry run is the default, and --apply is the only way to write', () => {
  assert.deepStrictEqual(parseArgs(['a-b', 'c-d']), { ids: ['a-b', 'c-d'], apply: false });
  assert.deepStrictEqual(parseArgs(['a-b', '--apply']), { ids: ['a-b'], apply: true });
});

ok('ids may arrive as one space or comma separated string, without repeats', () => {
  assert.deepStrictEqual(parseArgs(['a-b c-d, a-b']).ids, ['a-b', 'c-d']);
});

ok('anything that is not a plain id is refused', () => {
  for (const bad of ['../x', 'a/b', 'A-B', '$(rm)', 'a;b', '-x']) {
    assert.throws(() => parseArgs([bad]), /Not a campaign id/, bad);
  }
  assert.throws(() => parseArgs([]), /at least one/);
  assert.throws(() => parseArgs(['--apply']), /at least one/);
});

ok('it writes the fields the Approve button writes, and clears a rejection', () => {
  for (const f of ['approvedBy', 'approvedByName', 'approvedAt']) {
    assert.ok(pageSrc.includes(f), `page no longer writes ${f}`);
    assert.ok(src.includes(f + ':'), `script does not write ${f}`);
  }
  for (const f of ['rejectedBy', 'rejectedByName', 'rejectedAt', 'rejectionNote']) {
    assert.ok(src.includes(`${f}: FieldValue.delete()`), f);
  }
  assert.ok(src.includes("status: 'approved'"));
});

ok('it never sends or touches a send time', () => {
  assert.ok(!/dispatchCampaign|sendCampaign|sgMail|sendgrid/i.test(src));
  assert.ok(!/sendAt\s*:/.test(src), 'sendAt must not be written');
  assert.ok(!/status:\s*'(sending|sent)'/.test(src));
});

ok('the write is inside a transaction that re-reads the status', () => {
  assert.ok(/runTransaction/.test(src) && /tx\.get\(ref\)/.test(src) && /tx\.update\(ref/.test(src));
});

ok('the workflow acts only on the approvals file or a hand run', () => {
  assert.ok(/workflow_dispatch:/.test(wf));
  assert.ok(!/^\s+schedule:/m.test(wf));
  // Push and pull request are both limited to the approvals file.
  const paths = wf.match(/paths:\n\s+- 'scripts\/campaign-approvals\.txt'/g) || [];
  assert.strictEqual(paths.length, 2);
  assert.ok(/push:\n\s+branches:\n\s+- main\n/.test(wf), 'push is main only');
});

ok('a pull request is always a dry run; only a merge or a ticked hand run writes', () => {
  const pr = wf.slice(wf.indexOf('pull_request)'), wf.indexOf('push)'));
  assert.ok(/APPLY=false/.test(pr) && !/APPLY=true/.test(pr));
  assert.ok(/apply:[\s\S]*?default: false/.test(wf));
  assert.ok(/permissions:\n  contents: read/.test(wf));
});

ok('only ids added in the change are acted on, never the whole file', () => {
  assert.ok(/git diff --unified=0/.test(wf) && /grep '\^\+\[\^\+\]'/.test(wf));
  assert.ok(!/cat "?\$FILE/.test(wf));
});

ok('event values reach the shell through env, not spliced into a script', () => {
  const runs = wf.split(/\n\s+run: \|\n/).slice(1).map((r) => r.split(/\n      - /)[0]);
  assert.ok(runs.length >= 3);
  runs.forEach((r) => assert.ok(!r.includes('${{'), 'expression inside a run script'));
});

ok('the approvals file holds plain ids and comments only', () => {
  const lines = fs.readFileSync(path.join(root, 'scripts', 'campaign-approvals.txt'), 'utf8')
    .split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  assert.ok(lines.length >= 1);
  assert.deepStrictEqual(parseArgs([lines.join(' ')]).ids, [...new Set(lines)]);
});

console.log(`\n${passed} passed`);
