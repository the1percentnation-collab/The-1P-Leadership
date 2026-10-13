// Assessment engine — pure, no Firebase, no DOM.
//
// Every free assessment in the library is plain data (public/js/assessments/)
// read through this module, so the runner page, the library page, the tests
// and the copy all agree on one shape. Adding an assessment is a data file
// plus one line in assessments-data.js; nothing here changes.
//
// Two result modes:
//   'score'   — a 0-100 overall score with a band (e.g. Drifting / Grinding /
//               Aligned), plus a score per dimension. Leads with the weakest.
//   'profile' — the dimension the person scored highest on IS the result
//               ("You lead like a Builder"). Each dimension carries its own
//               headline and summary for that case.
//
// Every question is a statement rated 1 (strongly disagree) to 5 (strongly
// agree). `reverse: true` flips it, so "I dread Monday" counts against.

export const SCALE = [
  { value: 1, label: 'Strongly disagree' },
  { value: 2, label: 'Disagree' },
  { value: 3, label: 'Neutral' },
  { value: 4, label: 'Agree' },
  { value: 5, label: 'Strongly agree' }
];

export const CATEGORIES = [
  { key: 'self', label: 'Know Yourself', blurb: 'Where you stand right now, in honest numbers.' },
  { key: 'purpose', label: 'Find Your Why', blurb: 'What drives you, and whether your life reflects it.' },
  { key: 'leader', label: 'Lead With Intention', blurb: 'How you lead, and what is holding your leadership back.' },
  { key: 'team', label: 'Lead Your Team', blurb: 'For people responsible for other people.' },
  { key: 'money', label: 'Build Your Wealth', blurb: 'How ready your money is for the life you are building.' }
];

// Asked at the end of every assessment, unscored. They sort the people who
// take a free quiz from the leaders who could become an annual client.
export const PROFILE_QUESTIONS = [
  {
    key: 'role',
    text: 'Which best describes you?',
    options: [
      { value: 'professional', label: 'Professional' },
      { value: 'owner', label: 'Business owner or entrepreneur' },
      { value: 'manager', label: 'Manager or team leader' },
      { value: 'executive', label: 'Executive (CEO, VP, Director)' },
      { value: 'sales', label: 'Sales leader' },
      { value: 'pastor', label: 'Pastor or ministry leader' },
      { value: 'nonprofit', label: 'Nonprofit leader' },
      { value: 'student', label: 'Student or early career' }
    ]
  },
  {
    key: 'teamSize',
    text: 'How many people do you lead?',
    options: [
      { value: '0', label: 'Just me' },
      { value: '1-10', label: '1 to 10' },
      { value: '11-50', label: '11 to 50' },
      { value: '51+', label: '51 or more' }
    ]
  }
];

const ROLES = new Set(PROFILE_QUESTIONS[0].options.map((o) => o.value));
const TEAM_SIZES = new Set(PROFILE_QUESTIONS[1].options.map((o) => o.value));

/** Keeps only profile answers that are real options. */
export function cleanProfile(profile) {
  const p = profile || {};
  return {
    role: ROLES.has(p.role) ? p.role : null,
    teamSize: TEAM_SIZES.has(p.teamSize) ? p.teamSize : null
  };
}

/**
 * Someone worth a personal note from Anthony: they lead 11+ people, or they
 * run an organization (executive, pastor, nonprofit, owner) with any team.
 */
export function isPriorityLead(profile) {
  const { role, teamSize } = cleanProfile(profile);
  if (teamSize === '11-50' || teamSize === '51+') return true;
  const runsOrg = role === 'executive' || role === 'pastor' || role === 'nonprofit' || role === 'owner';
  return runsOrg && teamSize === '1-10';
}

/** 'leader' when they lead anyone, else 'individual'. Becomes a CRM tag. */
export function segmentFor(profile) {
  const { teamSize } = cleanProfile(profile);
  return teamSize && teamSize !== '0' ? 'leader' : 'individual';
}

/**
 * Scores one assessment.
 *
 * `answers` maps question index → 1..5. Unanswered questions are skipped
 * rather than counted as zero, so a dimension's score is the average of what
 * was actually answered, scaled to 0-100.
 */
export function scoreAssessment(def, answers) {
  const a = answers || {};
  const totals = {};
  def.dimensions.forEach((d) => { totals[d.key] = { sum: 0, n: 0 }; });

  def.questions.forEach((q, i) => {
    const raw = Number(a[i]);
    if (!(raw >= 1 && raw <= 5)) return;
    const v = q.reverse ? 6 - raw : raw;
    totals[q.dim].sum += v;
    totals[q.dim].n += 1;
  });

  const dims = def.dimensions.map((d) => {
    const t = totals[d.key];
    const score = t.n ? Math.round(((t.sum / t.n) - 1) / 4 * 100) : 0;
    return { key: d.key, label: d.label, score, answered: t.n };
  });

  const answeredDims = dims.filter((d) => d.answered);
  const overall = answeredDims.length
    ? Math.round(answeredDims.reduce((s, d) => s + d.score, 0) / answeredDims.length)
    : 0;

  // Ties break toward the earlier dimension so a result is stable.
  const byScore = answeredDims.slice().sort((x, y) => y.score - x.score
    || def.dimensions.findIndex((d) => d.key === x.key) - def.dimensions.findIndex((d) => d.key === y.key));
  const highest = byScore[0] || null;
  const lowest = byScore.length
    ? answeredDims.slice().sort((x, y) => x.score - y.score
      || def.dimensions.findIndex((d) => d.key === x.key) - def.dimensions.findIndex((d) => d.key === y.key))[0]
    : null;

  const band = def.mode === 'profile' ? null : bandFor(def, overall);
  const profileType = def.mode === 'profile' && highest
    ? def.dimensions.find((d) => d.key === highest.key)
    : null;

  return {
    overall,
    dims,
    highest: highest ? highest.key : null,
    lowest: lowest ? lowest.key : null,
    band,
    profileType: profileType ? profileType.key : null,
    complete: def.questions.every((q, i) => Number(a[i]) >= 1 && Number(a[i]) <= 5)
  };
}

/** The band whose `min` is the highest one at or below the score. */
export function bandFor(def, score) {
  const bands = (def.bands || []).slice().sort((x, y) => y.min - x.min);
  return bands.find((b) => score >= b.min) || bands[bands.length - 1] || null;
}

/** The headline a result leads with, for either mode. */
export function headlineFor(def, result) {
  if (def.mode === 'profile') {
    const d = def.dimensions.find((x) => x.key === result.profileType);
    return d ? d.headline : '';
  }
  return result.band ? result.band.label : '';
}

/**
 * Structural check for one assessment definition. Returns a list of
 * problems; empty means it is safe to publish. Run by the tests over the
 * whole library so a malformed data file never ships.
 */
export function validateAssessment(def) {
  const errs = [];
  const need = (cond, msg) => { if (!cond) errs.push(`${def && def.slug}: ${msg}`); };
  need(def && /^[a-z0-9-]+$/.test(def.slug || ''), 'slug must be lowercase-kebab');
  need(def.title && def.title.length <= 60, 'title is required, 60 chars max');
  need(def.hook, 'hook is required');
  need(def.short, 'short is required');
  need(CATEGORIES.some((c) => c.key === def.category), 'unknown category');
  need(def.mode === 'score' || def.mode === 'profile', 'mode must be score or profile');
  need(Number.isInteger(def.minutes) && def.minutes > 0, 'minutes is required');
  need(Array.isArray(def.dimensions) && def.dimensions.length >= 3 && def.dimensions.length <= 6, '3 to 6 dimensions');
  need(Array.isArray(def.questions) && def.questions.length >= 12 && def.questions.length <= 25, '12 to 25 questions');
  if (errs.length) return errs;

  const keys = new Set();
  def.dimensions.forEach((d) => {
    need(/^[a-z][a-zA-Z0-9]*$/.test(d.key || ''), `dimension key "${d.key}" must be camelCase`);
    need(!keys.has(d.key), `duplicate dimension ${d.key}`);
    keys.add(d.key);
    need(d.label && d.desc, `dimension ${d.key} needs label and desc`);
    need(Array.isArray(d.actions) && d.actions.length === 3, `dimension ${d.key} needs exactly 3 actions`);
    const qs = def.questions.filter((q) => q.dim === d.key).length;
    need(qs >= 3, `dimension ${d.key} needs at least 3 questions (has ${qs})`);
    if (def.mode === 'profile') need(d.headline && d.summary, `profile dimension ${d.key} needs headline and summary`);
  });
  def.questions.forEach((q, i) => {
    need(q.text && keys.has(q.dim), `question ${i} needs text and a known dim`);
  });
  if (def.mode === 'score') {
    need(Array.isArray(def.bands) && def.bands.length === 3, 'score mode needs exactly 3 bands');
    need((def.bands || []).some((b) => b.min === 0), 'a band must start at 0');
    (def.bands || []).forEach((b) => need(b.label && b.summary && b.min >= 0 && b.min <= 100, 'band needs label, summary, min'));
  }
  (def.related || []).forEach((r) => need(typeof r === 'string' && r !== def.slug, 'related must list other slugs'));
  if (def.cta) need(def.cta.label && /^\/[^/]/.test(def.cta.href || ''), 'cta needs a label and a site-relative href');
  if (def.category === 'money') need(def.disclaimer, 'money assessments need a disclaimer');
  // House style: no em or en dashes anywhere in copy.
  const copy = JSON.stringify(def);
  need(!/[—–]/.test(copy), 'copy contains an em or en dash');
  return errs;
}
