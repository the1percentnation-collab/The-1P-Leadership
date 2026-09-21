// Keep Cloud Scheduler out of functions/index.js, and keep the deploy strict.
//
// This exists because of a real failure that cost two red deploys and a third
// permanently undeletable function.
//
// This project's CI service account cannot manage Cloud Scheduler jobs. That
// makes an exported onSchedule function a one-way door: the deploy creates the
// function, fails to attach its schedule, and from then on every deploy tries
// to DELETE the orphan and is refused. Un-exporting it does not undo it — that
// is what turns it into the orphan. In September 2026 `automationTick` walked
// exactly that path (backend runs #90 and #91), joining `taskReminders` and
// `appointmentReminders`, which had done the same thing months earlier.
//
// Three separate files carried comments warning about this, and the function
// was exported anyway. A comment cannot fail a build; this can. The time-based
// work belongs in runAutomationTick, the HTTP function .github/workflows/
// crm-tick.yml calls — see the banner in functions/index.js.
//
// The third check is the other half. Until September 2026 the deploy script
// carried a list of function names whose failures it swallowed, added to
// three times as orphans accumulated. The orphans are gone and the list with
// them; this keeps it that way, so a future red deploy is fixed rather than
// muted.
//
// Run: node tests/no-scheduled-functions.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const deploySh = fs.readFileSync(path.join(root, 'scripts', 'deploy-functions.sh'), 'utf8');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// Comments are where this subject is legitimately discussed at length, so they
// have to come out before searching for live calls — otherwise the very
// warnings this test enforces would trip it. Strings are left alone: a stray
// "onSchedule" inside one is not worth the parser, and erring toward a false
// positive is the safe direction here.
function stripComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}
const code = stripComments(src);

ok('functions/index.js does not import firebase-functions/v2/scheduler', () => {
  const hit = /require\(\s*['"]firebase-functions\/v2\/scheduler['"]\s*\)/.exec(code);
  assert.ok(!hit, 'the scheduler import is back. An onSchedule function cannot be '
    + 'deployed OR removed by this project\'s CI — put the work in runAutomationTick instead.');
});

ok('no onSchedule() call survives outside a comment', () => {
  const hit = /\bonSchedule\s*\(/.exec(code);
  if (hit) {
    const line = code.slice(0, hit.index).split('\n').length;
    assert.fail(`onSchedule( called at roughly line ${line} of the comment-stripped source. `
      + 'Deploying it strands it permanently; see the header of this test.');
  }
});

ok('the deploy script tolerates no function failure', () => {
  // scripts/deploy-functions.sh used to carry KNOWN_STRANDED: a list of
  // function names whose deploy failures it exited 0 on. It existed for real
  // reasons — three orphaned scheduled functions CI could not delete, and a
  // permanently red pipeline reports nothing — but it grew from two names to
  // three, and a list nobody audits is a list that eventually hides a genuine
  // outage. The orphans were deleted in September 2026 and the list removed.
  //
  // Reintroducing one is a deliberate decision, not a quick fix for a red
  // build, so it should require deleting this check first.
  const hit = /^\s*KNOWN_STRANDED\s*=/m.exec(deploySh);
  assert.ok(!hit, 'scripts/deploy-functions.sh has a KNOWN_STRANDED list again. '
    + 'That makes the named functions\' deploy failures exit 0. If a function is '
    + 'genuinely undeletable, delete it in GCP instead — see the history note in '
    + 'that script.');
});

console.log(`\n${passed} checks passed.`);
