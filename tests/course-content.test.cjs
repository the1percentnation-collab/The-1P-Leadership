// Course content packs (scripts/course-content/<slug>/) are lesson copy that
// gets pushed straight into a paid product. This test holds every pack to the
// rules the seeder and the brand both depend on:
//   - the fields course-renderer.js reads are present on every module;
//   - lessons are at teaching depth, not placeholders;
//   - no em dashes anywhere in learner-facing copy (brand voice rule);
//   - a before/after assessment is word for word identical in both modules,
//     because the whole promise of the 1% Method is a valid comparison.
const path = require('path');
const { validatePack, listPacks } = require('../scripts/seed-course.js');

let fails = 0;
const t = (name, cond, detail) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '\n       ' + detail));
  if (!cond) fails++;
};

// Teaching depth floor. The build plan's standard is 9,000 to 14,000 chars of
// lesson HTML; this is the floor below which a module is a sketch, not a week
// of instruction. Start Here and challenge modules are shorter by design, so
// the floor is deliberately under the target rather than at it.
const MIN_LESSON_CHARS = 6000;

// Statements inside <h3>Part N ...</h3> blocks, in order. Used to prove the
// baseline and the retake ask exactly the same questions.
function assessmentItems(html) {
  const parts = html.split(/<h3>\s*Part\s+\d+/i).slice(1);
  const items = [];
  parts.forEach((block) => {
    const stop = block.search(/<h2>/i);
    const scoped = stop === -1 ? block : block.slice(0, stop);
    const found = scoped.match(/<li>[\s\S]*?<\/li>/g) || [];
    found.forEach((li) => items.push(li.replace(/\s+/g, ' ').trim()));
  });
  return items;
}

const packs = listPacks();
t('at least one content pack exists', packs.length > 0);

packs.forEach((slug) => {
  const pack = require(path.join(__dirname, '..', 'scripts', 'course-content', slug));
  const problems = validatePack(pack, slug);
  t(`${slug}: pack passes the seeder's own validation`, problems.length === 0, problems.join('; '));

  const ids = pack.modules.map((m) => m.id);
  t(`${slug}: module ids are 1..n with no gaps`,
    ids.every((id, i) => id === i + 1), `got ${ids.join(',')}`);

  pack.modules.forEach((m) => {
    const len = m.html.trim().length;
    t(`${slug} #${m.id}: lesson is at teaching depth (${len} chars)`,
      len >= MIN_LESSON_CHARS, `${len} chars, floor is ${MIN_LESSON_CHARS}`);

    // Brand voice: no em dashes, ever. Checks every learner-facing string.
    const copy = JSON.stringify([m.html, m.title, m.subtitle || '', m.workbook, m.summary]);
    const em = copy.includes('—');
    t(`${slug} #${m.id}: no em dashes`, !em,
      em ? copy.split('—').slice(0, 2).join(' >>EM DASH<< ').slice(-160) : '');

    t(`${slug} #${m.id}: workbook has a reflection and an action`,
      Boolean(m.workbook.reflection && m.workbook.action));
  });

  // Before/after instrument parity.
  const withAssessment = pack.modules.filter((m) => /<h3>\s*Part\s+1/i.test(m.html));
  if (withAssessment.length) {
    t(`${slug}: the assessment appears in exactly two modules (baseline + retake)`,
      withAssessment.length === 2,
      `found in modules ${withAssessment.map((m) => m.id).join(', ')}`);

    if (withAssessment.length === 2) {
      const [a, b] = withAssessment.map((m) => assessmentItems(m.html));
      t(`${slug}: both copies have the same number of statements`,
        a.length === b.length, `${a.length} vs ${b.length}`);
      const diff = a.map((s, i) => (s === b[i] ? null : i)).filter((i) => i !== null);
      t(`${slug}: every assessment statement is word for word identical`,
        a.length > 0 && diff.length === 0,
        diff.length ? `differs at statement ${diff.map((i) => i + 1).join(', ')}` : 'no statements found');
    }
  }
});

console.log(fails ? `\n${fails} failure(s)` : '\nAll course content checks passed');
process.exit(fails ? 1 : 0);
