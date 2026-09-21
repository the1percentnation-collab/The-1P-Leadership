// Keep Cloud Scheduler out of functions/index.js, and keep KNOWN_STRANDED honest.
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
// The KNOWN_STRANDED check is the other half. That list makes the deploy
// tolerate a named function's failure, so a name that is actually live would
// silently mask a real outage. Nothing audited it before; now the build does.
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

// Both this and the deploy script read the same line, so the two cannot drift.
const stranded = (() => {
  const m = /^KNOWN_STRANDED="([^"]*)"/m.exec(deploySh);
  assert.ok(m, 'KNOWN_STRANDED not found in scripts/deploy-functions.sh');
  return m[1].split(/\s+/).filter(Boolean);
})();

ok('KNOWN_STRANDED names only functions absent from source', () => {
  // A name here stops the deploy reporting that function's failure. That is
  // only ever correct for something CI cannot delete — never for a function
  // that is supposed to be running.
  const live = stranded.filter((name) =>
    new RegExp(`^exports\\.${name}\\s*=`, 'm').test(code));
  assert.deepStrictEqual(live, [],
    `KNOWN_STRANDED lists ${live.join(', ')}, which functions/index.js still exports. `
    + 'The deploy would stop reporting a live function\'s failures. Remove the name from the list.');
});

ok('KNOWN_STRANDED stays small and deliberate', () => {
  // Not style. Every entry is a function whose deploy failure goes unreported,
  // and each one also costs a pointless delete attempt on every single run.
  // Growth means the orphans are being tolerated instead of cleared; the
  // script's own comment carries the functions:delete command that clears them.
  assert.ok(stranded.length <= 3,
    `KNOWN_STRANDED has grown to ${stranded.length} entries (${stranded.join(', ')}). `
    + 'Clear the orphans with the functions:delete command in scripts/deploy-functions.sh '
    + 'rather than adding another name.');
});

console.log(`\n${passed} checks passed.`);
