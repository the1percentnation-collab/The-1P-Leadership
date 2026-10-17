// The chapter-preview funnel, pinned end to end at the seams where a silent
// drift would cost leads or double-email a reader.
//
// The funnel has four moving parts and no single place to see them line up:
//
//   public/js/reader-lead.js   submits formType 'chapter-preview'
//   functions/index.js         LEAD_FORMS turns that into tags
//   functions/index.js         autoEnroll matches a tag to a sequence
//   scripts/seed-preview-...   the sequences, keyed to those exact tags
//
// Tag matching in autoEnroll is case-sensitive string equality, so renaming a
// tag in LEAD_FORMS without touching the seed leaves two sequences that
// simply never fire. Nothing errors. The leads just land and sit there. These
// assertions are what notices.
//
// Run: node tests/preview-sequences.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const fnSrc = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const seedSrc = fs.readFileSync(path.join(root, 'scripts', 'seed-preview-sequences.js'), 'utf8');
const gateSrc = fs.readFileSync(path.join(root, 'public', 'js', 'reader-lead.js'), 'utf8');
const readerSrc = fs.readFileSync(path.join(root, 'public', 'js', 'reader.js'), 'utf8');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

function sliceOf(from, to) {
  const a = fnSrc.indexOf(from);
  assert.ok(a > 0, `could not locate ${JSON.stringify(from)} in functions/index.js`);
  const b = fnSrc.indexOf(to, a);
  assert.ok(b > a, `could not locate ${JSON.stringify(to)} after it`);
  return fnSrc.slice(a, b);
}

// ── The gate submits what the backend is registered to accept ──────────────
console.log('the preview gate and the lead form agree');

ok("the gate submits formType 'chapter-preview'", () => {
  assert.ok(/formType:\s*'chapter-preview'/.test(gateSrc),
    'reader-lead.js no longer submits the chapter-preview form type');
});

ok("'chapter-preview' is a registered lead form", () => {
  const block = sliceOf('const LEAD_FORMS = {', '\n};');
  assert.ok(/'chapter-preview':/.test(block),
    "LEAD_FORMS has no 'chapter-preview' entry, so every preview capture is rejected as an unknown form");
});

ok('the lead form applies the Chapter Preview tag', () => {
  const block = sliceOf('const LEAD_FORMS = {', '\n};');
  const line = block.split('\n').find((l) => l.includes("'chapter-preview':"));
  assert.ok(/'Chapter Preview'/.test(line), 'the Chapter Preview tag is gone from the form definition');
});

ok("the finish stage adds the 'Preview Finished' tag", () => {
  const block = sliceOf("if (formType === 'chapter-preview') {", '\n  const ref = await upsertCrmContact');
  assert.ok(/fields\.stage === 'finish'/.test(block) && /'Preview Finished'/.test(block),
    'reaching the end of a preview no longer tags the reader, so finishers cannot be segmented');
});

ok("the gate sends stage 'start' and stage 'finish'", () => {
  assert.ok(/stage:\s*'start'/.test(gateSrc), 'the front wall no longer sends the start stage');
  assert.ok(/stage:\s*'finish'/.test(gateSrc), 'the end-of-preview panel no longer sends the finish stage');
});

// ── The seeded sequences are keyed to those same tags ──────────────────────
console.log('\nthe sequences are wired to the tags that actually get applied');

ok('the nurture sequence triggers on the Chapter Preview tag', () => {
  assert.ok(/type:\s*'tag_added',\s*value:\s*'Chapter Preview'/.test(seedSrc),
    'the nurture sequence trigger no longer matches the tag the lead form applies');
});

ok('the finisher sequence triggers on the Preview Finished tag', () => {
  assert.ok(/type:\s*'tag_added',\s*value:\s*'Preview Finished'/.test(seedSrc),
    'the finisher sequence trigger no longer matches the tag the finish stage applies');
});

ok('every seeded step is an email the gate can actually reach', () => {
  // The gate collects a name and an email and no phone, so an SMS step would
  // have nothing to send to and would stall the enrollment.
  assert.ok(!/channel:\s*'sms'/.test(seedSrc), 'a seeded preview step sends SMS, but no phone is ever captured');
  assert.ok(/channel:\s*'email'/.test(seedSrc), 'the seeded steps no longer send email');
});

ok('the first step of each sequence fires on the next tick', () => {
  assert.ok(/email\(0, /.test(seedSrc),
    'no seeded sequence opens at 0 hours, so the promised first email is delayed');
});

// ── A finisher must not receive both drips ─────────────────────────────────
console.log('\na reader who finishes is not enrolled in both');

ok('autoEnroll honours stopOthersOnEnroll', () => {
  const block = sliceOf('async function autoEnroll(', '\nexports.onContactWrittenForSequences');
  assert.ok(/seq\.stopOthersOnEnroll === true/.test(block),
    'autoEnroll ignores stopOthersOnEnroll, so a finisher receives the opener drip as well');
  assert.ok(/stopEnrollmentsForContact\(/.test(block),
    'stopOthersOnEnroll is read but nothing stops the superseded enrollments');
});

ok('it supersedes before it enrolls, not after', () => {
  const block = sliceOf('async function autoEnroll(', '\nexports.onContactWrittenForSequences');
  const stop = block.indexOf('stopEnrollmentsForContact(');
  const add = block.indexOf(".collection('enrollments').add(");
  assert.ok(stop > 0 && add > stop,
    'the new enrollment is created before the sweep, so the sweep cancels the sequence it just started');
});

ok('the finisher sequence is the one that supersedes', () => {
  const i = seedSrc.indexOf("id: 'preview-finisher'");
  assert.ok(i > 0, 'the finisher sequence is gone from the seed');
  const block = seedSrc.slice(i, i + 600);
  assert.ok(/stopOthersOnEnroll:\s*true/.test(block),
    'the finisher no longer stops the opener drip, so finishers get two sequences at once');
});

ok('the nurture sequence does not supersede anything', () => {
  const i = seedSrc.indexOf("id: 'preview-nurture'");
  assert.ok(i > 0, 'the nurture sequence is gone from the seed');
  const block = seedSrc.slice(i, i + 600);
  assert.ok(/stopOthersOnEnroll:\s*false/.test(block),
    'opening a preview now cancels every other sequence the contact is in');
});

// ── The end-of-preview panel still has something to fire on ────────────────
console.log('\nthe reader still reaches the second ask');

ok('the reader fires the end panel on the last section of a free preview', () => {
  assert.ok(/showPreviewEnd\(/.test(readerSrc), 'reader.js no longer shows the end-of-preview panel');
  assert.ok(/index === lastSection/.test(readerSrc),
    'the end panel is no longer tied to the last section, so finishers are never tagged');
});

ok('the front wall is skipped for members and bypass links', () => {
  assert.ok(/gateBeforeOpen\(/.test(readerSrc), 'reader.js no longer gates the preview');
  assert.ok(/skip:\s*!!user \|\| hasBypass\(params\)/.test(readerSrc),
    'the wall no longer exempts signed-in members and warm-DM links');
});

console.log(`\n${passed} assertions passed.`);
