// scripts/approve-campaigns.js and its workflow.
//
// Pinned here:
// 1. Only a draft is approved; anything past draft is left alone.
// 2. Ids are validated before anything is read or written.
// 3. The script writes what the Approve button writes, and never sends.
// 4. The workflow runs by hand only, and is a dry run unless asked.
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

ok('the workflow runs by hand only, dry run unless ticked', () => {
  assert.ok(/^on:\n  workflow_dispatch:/m.test(wf));
  assert.ok(!/^\s+(push|schedule|pull_request):/m.test(wf));
  assert.ok(/apply:[\s\S]*?default: false/.test(wf));
  // Inputs reach the script through env, not spliced into the command line.
  const runBlock = wf.slice(wf.lastIndexOf('run: |'));
  assert.ok(!runBlock.includes('${{'), 'no expression inside the run script');
});

console.log(`\n${passed} passed`);
