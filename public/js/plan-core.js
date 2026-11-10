// My Plan: goals built from assessment results, the Goal Planner, or the
// member's own words, kept in the portal instead of a printout.
//
// Pure: no imports, no DOM, no Firebase. The wizard (/plan-build), the My
// Plan page (/plan), the dashboard's next steps and the server all read this
// one source. The server gets a generated CommonJS copy:
//   node scripts/build-plan-server.cjs
// tests/plan.test.mjs fails if the copies drift.
//
// Shape of one goal (users/{uid}/goals/{goalId}, server-written only):
//   title, source ('assessment' | 'planner' | 'custom'), status ('active' |
//   'later' | 'done'), focus (one active goal at a time), slug, areaKey,
//   areaLabel, assessmentTitle, reading ('score' | 'profile' |
//   'lower-better'), baseline / latest / target (0-100 or null), tasks
//   [{ id, text, due, done, doneDate }], startDate, reviewDate, checkinDay
//   (0 = Sunday), timezone, reminders { email, inapp, push }, checkins
//   [{ date, did, blocked, next }], reviews [{ date, easier, decision }],
//   coachUid / coachName, lastActivityDate.
//
// Dates are local calendar days as 'YYYY-MM-DD'. They compare correctly as
// strings and never drift across timezones the way Date objects do.

// Active goals at once. More than this and nothing gets finished, which is
// the exact problem the people taking these assessments already have.
const MAX_ACTIVE = 3;
// Areas one wizard run can turn into goals.
const MAX_AREAS_PER_BUILD = 2;
const MAX_TASKS = 12;
const MAX_GOALS = 40;
const TITLE_MAX = 90;
const TEXT_MAX = 280;
const NOTE_MAX = 1000;
const MAX_CHECKINS = 26;
// Days from a goal's start to its review. The Goal Planner's plan runs a
// full quarter.
const REVIEW_DAYS = 30;
const PLANNER_REVIEW_DAYS = 90;
// No activity for this long and the goal reads as stalled.
const STALL_DAYS = 14;
// Fewer members than this and a team summary is withheld, so no one's
// individual score can be worked out from an average.
const TEAM_MIN = 3;

// Assessments about the people someone leads. A priority lead finishing one
// is offered the Alignment Audit for the whole team.
const TEAM_ASSESSMENTS = ['team-alignment', 'delegation-audit', 'sales-mindset'];

const GOAL_STATUSES = ['active', 'later', 'done'];
const REVIEW_DECISIONS = ['finish', 'continue', 'next'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Dates ──────────────────────────────────────────────────────────────────

function isIsoDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Local 'YYYY-MM-DD' for a Date (defaults to now). */
function todayIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function plusDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function dayDiff(fromIso, toIso) {
  const ms = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(toIso) - ms(fromIso)) / 86400000);
}

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'Mon, Oct 26' for a 'YYYY-MM-DD'. */
function fmtDay(iso) {
  if (!isIsoDay(iso)) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── Text ───────────────────────────────────────────────────────────────────

/** Trimmed, single-spaced, control characters removed, clipped to n. */
function cleanText(v, n) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, n);
}

function oneLine(v, n) {
  return cleanText(String(v == null ? '' : v).replace(/\s+/g, ' '), n);
}

// ── Building goals ─────────────────────────────────────────────────────────

/**
 * The target a goal aims for at its review, from the area's score now.
 * Score areas aim ten points higher; patterns you want less of aim ten
 * lower; a type or style has no better or worse, so no target.
 */
function targetFor(score, reading) {
  const s = Number(score);
  if (!Number.isFinite(s)) return null;
  if (reading === 'profile') return null;
  if (reading === 'lower-better') return s <= 10 ? null : Math.max(0, Math.round(s) - 10);
  return s >= 95 ? null : Math.min(100, Math.round(s) + 10);
}

/** Has the score moved the right way, and by how much? null without both. */
function scoreChange(goal) {
  const from = goal && goal.baseline;
  const to = goal && goal.latest;
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  const delta = to - from;
  const better = goal.reading === 'lower-better' ? delta < 0 : delta > 0;
  const reached = typeof goal.target === 'number'
    ? (goal.reading === 'lower-better' ? to <= goal.target : to >= goal.target)
    : false;
  return { from, to, delta, better, reached };
}

/**
 * Due dates for n tasks starting on `start`: one a week, each due on the
 * last day of its week, so week one's task is due six days in.
 */
function weeklyDueDates(start, n) {
  return Array.from({ length: n }, (_, i) => plusDays(start, 7 * (i + 1) - 1));
}

/**
 * The wizard's first step: every area in the order to consider it, with the
 * recommended one marked. `rep` is buildReport(def, result) from
 * assessment-core.js.
 *
 * Score assessments lead with the weakest area, where focus pays off most.
 * Profile assessments lead with the person's own type (or, for patterns you
 * want less of, the one with the strongest hold).
 */
function wizardAreas(def, rep) {
  const reading = def.mode === 'profile' ? (def.polarity === 'lower-better' ? 'lower-better' : 'profile') : 'score';
  const order = def.dimensions.map((d) => d.key);
  const areas = (rep.areas || []).slice();
  if (reading === 'score') {
    areas.sort((a, b) => a.score - b.score || order.indexOf(a.key) - order.indexOf(b.key));
  }
  const recommendedKey = rep.focus ? rep.focus.key : (areas[0] && areas[0].key) || null;
  // The recommended one always leads, even when a tie put another first.
  areas.sort((a, b) => (b.key === recommendedKey) - (a.key === recommendedKey));
  return {
    reading,
    recommendedKey,
    areas: areas.map((a) => {
      const dim = def.dimensions.find((d) => d.key === a.key) || {};
      return {
        key: a.key,
        label: a.label,
        goal: dim.goal || a.label,
        desc: a.desc,
        why: a.why,
        reflect: a.reflect,
        score: a.score,
        levelLabel: a.levelLabel,
        tone: a.tone,
        actions: (dim.actions || a.actions || []).slice(),
        target: targetFor(a.score, reading),
        recommended: a.key === recommendedKey
      };
    })
  };
}

/**
 * Goals from the wizard's picks, ready for the server.
 *
 * picks: [{ areaKey, title?, tasks: [{ text, due? }] }]
 * The task text is whatever the member left in Step 3, so their wording is
 * what gets saved. Missing due dates are filled in a week apart.
 */
function goalsFromPicks({ def, wizard, picks, start, checkinDay, reminders, timezone }) {
  return (picks || []).slice(0, MAX_AREAS_PER_BUILD).map((p) => {
    const area = wizard.areas.find((a) => a.key === p.areaKey);
    if (!area) return null;
    const texts = (p.tasks || []).map((t) => ({ text: oneLine(t.text, TEXT_MAX), due: t.due || null })).filter((t) => t.text);
    const dues = weeklyDueDates(start, texts.length);
    return {
      source: 'assessment',
      slug: def.slug,
      assessmentTitle: def.title,
      category: def.category,
      areaKey: area.key,
      areaLabel: area.label,
      reading: wizard.reading,
      title: oneLine(p.title || area.goal, TITLE_MAX),
      baseline: area.score,
      target: area.target,
      reflect: area.reflect || '',
      tasks: texts.slice(0, MAX_TASKS).map((t, i) => ({ text: t.text, due: isIsoDay(t.due) ? t.due : dues[i] })),
      startDate: start,
      checkinDay,
      reminders,
      timezone
    };
  }).filter(Boolean);
}

/**
 * The Goal Planner's 90-day plan as one goal: the member's win is the goal,
 * and each month's key results are its tasks, due at the end of that month.
 *
 * planner: { win, reviewDay, okrs: [{ krs: [{ text }] }] }
 */
function goalFromPlanner(planner, { start, reminders, timezone }) {
  const p = planner || {};
  const dayIdx = DAY_NAMES.indexOf(String(p.reviewDay || ''));
  const tasks = [];
  (Array.isArray(p.okrs) ? p.okrs : []).slice(0, 3).forEach((o, m) => {
    (Array.isArray(o && o.krs) ? o.krs : []).slice(0, 4).forEach((kr) => {
      const text = oneLine(kr && kr.text, TEXT_MAX);
      if (text) tasks.push({ text, due: plusDays(start, 30 * (m + 1) - 1) });
    });
  });
  return {
    source: 'planner',
    title: oneLine(p.win, TITLE_MAX) || 'My 90-day plan',
    tasks: tasks.slice(0, MAX_TASKS),
    startDate: start,
    checkinDay: dayIdx >= 0 ? dayIdx : weekdayOf(start),
    reminders,
    timezone
  };
}

// ── Reading a goal ─────────────────────────────────────────────────────────

function progressOf(goal) {
  const tasks = (goal && Array.isArray(goal.tasks)) ? goal.tasks : [];
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

/** The first unfinished task, soonest due first. */
function nextTask(goal) {
  const open = ((goal && goal.tasks) || []).filter((t) => !t.done);
  return open.slice().sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))[0] || null;
}

function overdueTasks(goal, today) {
  return ((goal && goal.tasks) || []).filter((t) => !t.done && t.due && t.due < today);
}

/** A weekly check-in is open: a week since the start or the last one. */
function checkinDue(goal, today) {
  if (!goal || goal.status !== 'active' || !isIsoDay(goal.startDate)) return false;
  const since = goal.lastCheckinDate || goal.startDate;
  return dayDiff(since, today) >= 7;
}

/** The review is open: the review date has come and it has not been done. */
function reviewDue(goal, today) {
  if (!goal || goal.status !== 'active' || !isIsoDay(goal.reviewDate)) return false;
  return today >= goal.reviewDate;
}

function isStalled(goal, today) {
  if (!goal || goal.status !== 'active') return false;
  const last = goal.lastActivityDate || goal.startDate;
  return isIsoDay(last) && dayDiff(last, today) >= STALL_DAYS;
}

/** Focus first, then active, later and done; newest first within each. */
function orderGoals(goals) {
  const rank = (g) => (g.status === 'active' ? (g.focus ? 0 : 1) : g.status === 'later' ? 2 : 3);
  return (goals || []).slice().sort((a, b) => rank(a) - rank(b)
    || String(b.startDate || '').localeCompare(String(a.startDate || '')));
}

function activeCount(goals) {
  return (goals || []).filter((g) => g.status === 'active').length;
}

/**
 * Dashboard cards from the plan, most pressing first, in the same shape as
 * buildNextSteps in hub-nextup.js.
 */
function planNextSteps(goals, today, { hasAssessments = false } = {}) {
  const active = orderGoals(goals).filter((g) => g.status === 'active');
  const out = [];
  const review = active.find((g) => reviewDue(g, today));
  if (review) {
    out.push({
      key: 'plan-review',
      eyebrow: review.source === 'planner' ? 'Day 90' : 'Day 30',
      title: `Review: ${review.title}`,
      sub: review.slug ? 'Retake the assessment, see what moved, and choose what is next.' : 'Look back at what moved and choose what is next.',
      ctaLabel: 'Start review',
      href: `/plan#goal-${review.id}`,
      urgent: true
    });
  }
  const checkin = active.find((g) => g !== review && checkinDue(g, today));
  if (checkin) {
    out.push({
      key: 'plan-checkin',
      eyebrow: 'Weekly check-in',
      title: checkin.title,
      sub: 'Two minutes: what you did, what got in the way, what is next.',
      ctaLabel: 'Check in',
      href: `/plan#goal-${checkin.id}`
    });
  }
  const focus = active.find((g) => g.focus) || active[0];
  const task = focus && nextTask(focus);
  if (task && !out.some((s) => s.key === 'plan-review' && review === focus)) {
    const late = task.due && task.due < today;
    out.push({
      key: 'plan-task',
      eyebrow: late ? 'Past due' : (task.due === today ? 'Due today' : (task.due ? `Due ${fmtDay(task.due)}` : 'Next on your plan')),
      title: task.text.length > 90 ? task.text.slice(0, 87) + '...' : task.text,
      sub: focus.title,
      ctaLabel: 'Open my plan',
      href: `/plan#goal-${focus.id}`
    });
  }
  if (!active.length && hasAssessments) {
    out.push({
      key: 'plan-start',
      eyebrow: 'My Plan',
      title: 'Turn your results into a plan',
      sub: 'Pick the goals that matter from your assessment and get a weekly check-in.',
      ctaLabel: 'Build my plan',
      href: '/plan'
    });
  }
  return out;
}

// ── Calendar export ────────────────────────────────────────────────────────

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// RFC 5545 lines stop at 75 octets; longer ones continue on a line that
// starts with a space. Counted in characters, which is safe for the ASCII
// these plans are written in and only folds early otherwise.
function icsFold(line) {
  const parts = [];
  let rest = line;
  while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = rest.slice(74); }
  parts.push(rest);
  return parts.join('\r\n ');
}

/**
 * An .ics calendar of every open task with a due date and every review
 * date, as all-day events, so the plan shows up where the week is planned.
 * `stamp` is a UTC 'YYYYMMDDTHHMMSSZ'.
 */
function icsForGoals(goals, { stamp, domain = 'the1pnation.com' } = {}) {
  const dt = stamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//The One Percent//My Plan//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:My Plan'];
  const event = (uid, day, summary, description) => {
    const d = day.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${uid}@${domain}`, `DTSTAMP:${dt}`, `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${plusDays(day, 1).replace(/-/g, '')}`,
      icsFold(`SUMMARY:${icsEscape(summary)}`), icsFold(`DESCRIPTION:${icsEscape(description)}`), 'END:VEVENT');
  };
  (goals || []).filter((g) => g.status === 'active').forEach((g) => {
    (g.tasks || []).filter((t) => !t.done && isIsoDay(t.due)).forEach((t) => {
      event(`${g.id}-${t.id}`, t.due, t.text, `${g.title}. Check it off at https://${domain}/plan`);
    });
    if (isIsoDay(g.reviewDate)) {
      event(`${g.id}-review`, g.reviewDate, `Review: ${g.title}`,
        g.slug ? `Retake the assessment and compare at https://${domain}/plan` : `Look back and choose what is next at https://${domain}/plan`);
    }
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ── Server-side validation ─────────────────────────────────────────────────
// The server stores nothing it has not checked here. The browser uses the
// same rules to catch a problem before the round trip.

function cleanReminders(r) {
  const x = r && typeof r === 'object' ? r : {};
  return { email: x.email !== false, inapp: x.inapp !== false, push: x.push === true };
}

function cleanTaskList(list, { start, horizon }) {
  if (!Array.isArray(list) || !list.length) return { error: 'Choose at least one action.' };
  if (list.length > MAX_TASKS) return { error: `Keep it to ${MAX_TASKS} tasks or fewer.` };
  const tasks = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i] || {};
    const text = oneLine(t.text, TEXT_MAX);
    if (text.length < 2) return { error: 'Every task needs a few words.' };
    let due = isIsoDay(t.due) ? t.due : null;
    if (due && (due < plusDays(start, -1) || due > plusDays(start, horizon))) due = null;
    tasks.push({ id: `t${i + 1}`, text, due, done: false, doneDate: null });
  }
  return { tasks };
}

/**
 * Validate one new goal. `today` is the member's local date. `slugs` maps
 * an assessment slug to { title, category } (the server's allowlist).
 * Returns { value } or { error } (a message for the member).
 */
function validateNewGoal(input, { today, slugs = {} } = {}) {
  const g = input && typeof input === 'object' ? input : {};
  const source = ['assessment', 'planner', 'custom'].includes(g.source) ? g.source : null;
  if (!source) return { error: 'Unknown goal type.' };
  const title = oneLine(g.title, TITLE_MAX);
  if (title.length < 3) return { error: 'Give your goal a name.' };

  // A start a day behind absorbs a timezone edge; more than 60 days out is
  // not a plan yet.
  let start = isIsoDay(g.startDate) ? g.startDate : today;
  if (start < plusDays(today, -1) || start > plusDays(today, 60)) start = today;
  const span = source === 'planner' ? PLANNER_REVIEW_DAYS : REVIEW_DAYS;
  const t = cleanTaskList(g.tasks, { start, horizon: 366 });
  if (t.error) return t;

  const day = Number(g.checkinDay);
  const value = {
    source,
    title,
    tasks: t.tasks,
    startDate: start,
    reviewDate: plusDays(start, span),
    checkinDay: Number.isInteger(day) && day >= 0 && day <= 6 ? day : weekdayOf(start),
    reminders: cleanReminders(g.reminders),
    timezone: oneLine(g.timezone, 64) || 'America/New_York',
    slug: null, assessmentTitle: null, category: null, areaKey: null, areaLabel: null,
    reading: null, baseline: null, latest: null, target: null, reflect: ''
  };

  if (source === 'assessment') {
    const slug = String(g.slug || '');
    const meta = Object.prototype.hasOwnProperty.call(slugs, slug) ? slugs[slug] : null;
    if (!meta) return { error: 'Unknown assessment.' };
    const key = String(g.areaKey || '');
    if (!/^[a-z][a-zA-Z0-9]{0,39}$/.test(key)) return { error: 'Unknown area.' };
    const pct = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Math.round(Number(v)))));
    const reading = ['score', 'profile', 'lower-better'].includes(g.reading) ? g.reading : 'score';
    value.slug = slug;
    value.assessmentTitle = meta.title;
    value.category = meta.category;
    value.areaKey = key;
    value.areaLabel = oneLine(g.areaLabel, 60) || key;
    value.reading = reading;
    value.baseline = pct(g.baseline);
    value.latest = value.baseline;
    value.target = reading === 'profile' ? null : pct(g.target);
    value.reflect = oneLine(g.reflect, TEXT_MAX);
  }
  return { value };
}

/**
 * One change to an existing goal, as a patch of the fields that change.
 * `today` is the member's local date. Returns { patch, event? } or
 * { error }. `event` names what happened, for points and the CRM:
 * 'checkin', 'review', 'done'.
 *
 * The active-goal limit needs every goal, so the caller checks it before a
 * goal moves to active.
 */
function applyGoalOp(goal, op, p, today) {
  const g = goal || {};
  const d = p || {};
  const tasks = Array.isArray(g.tasks) ? g.tasks.map((t) => Object.assign({}, t)) : [];
  const findTask = () => tasks.find((t) => t.id === String(d.taskId || ''));
  const touched = { lastActivityDate: today };
  const horizon = { start: g.startDate || today, horizon: 366 };

  switch (op) {
    case 'toggleTask': {
      const t = findTask();
      if (!t) return { error: 'That task is gone. Refresh and try again.' };
      t.done = d.done !== false;
      t.doneDate = t.done ? today : null;
      return { patch: Object.assign({ tasks }, touched) };
    }
    case 'editTask': {
      const t = findTask();
      if (!t) return { error: 'That task is gone. Refresh and try again.' };
      if (d.text !== undefined) {
        const text = oneLine(d.text, TEXT_MAX);
        if (text.length < 2) return { error: 'Every task needs a few words.' };
        t.text = text;
      }
      if (d.due !== undefined) t.due = isIsoDay(d.due) && d.due <= plusDays(horizon.start, horizon.horizon) ? d.due : null;
      return { patch: Object.assign({ tasks }, touched) };
    }
    case 'addTask': {
      if (tasks.length >= MAX_TASKS) return { error: `A goal holds up to ${MAX_TASKS} tasks. Finish or remove one first.` };
      const text = oneLine(d.text, TEXT_MAX);
      if (text.length < 2) return { error: 'Every task needs a few words.' };
      const n = tasks.reduce((m, t) => Math.max(m, Number(String(t.id).replace(/\D/g, '')) || 0), 0) + 1;
      tasks.push({ id: `t${n}`, text, due: isIsoDay(d.due) ? d.due : null, done: false, doneDate: null });
      return { patch: Object.assign({ tasks }, touched) };
    }
    case 'deleteTask': {
      const left = tasks.filter((t) => t.id !== String(d.taskId || ''));
      if (left.length === tasks.length) return { error: 'That task is gone. Refresh and try again.' };
      if (!left.length) return { error: 'A goal needs at least one task. Add another before removing this one.' };
      return { patch: Object.assign({ tasks: left }, touched) };
    }
    case 'editGoal': {
      const patch = Object.assign({}, touched);
      if (d.title !== undefined) {
        const title = oneLine(d.title, TITLE_MAX);
        if (title.length < 3) return { error: 'Give your goal a name.' };
        patch.title = title;
      }
      if (d.checkinDay !== undefined) {
        const day = Number(d.checkinDay);
        if (!(Number.isInteger(day) && day >= 0 && day <= 6)) return { error: 'Pick a check-in day.' };
        patch.checkinDay = day;
      }
      if (d.reminders !== undefined) patch.reminders = cleanReminders(d.reminders);
      if (d.target !== undefined && g.reading && g.reading !== 'profile') {
        const v = Number(d.target);
        patch.target = d.target === null || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, Math.round(v)));
      }
      return { patch };
    }
    case 'setStatus': {
      const status = String(d.status || '');
      if (!GOAL_STATUSES.includes(status)) return { error: 'Unknown status.' };
      const patch = Object.assign({ status }, touched);
      if (status !== 'active') patch.focus = false;
      if (status === 'done') patch.doneDate = today;
      // Picking a goal back up restarts its clock, so its review lands 30
      // days from now rather than in the past.
      if (status === 'active' && g.status !== 'active') {
        patch.startDate = today;
        patch.reviewDate = plusDays(today, g.source === 'planner' ? PLANNER_REVIEW_DAYS : REVIEW_DAYS);
        patch.lastCheckinDate = null;
        patch.doneDate = null;
      }
      return { patch, event: status === 'done' && g.status !== 'done' ? 'done' : null };
    }
    case 'checkin': {
      if (g.status !== 'active') return { error: 'Check-ins are for active goals.' };
      const entry = {
        date: today,
        did: cleanText(d.did, NOTE_MAX),
        blocked: cleanText(d.blocked, NOTE_MAX),
        next: cleanText(d.next, NOTE_MAX)
      };
      if (!entry.did && !entry.blocked && !entry.next) return { error: 'Write a line about your week first.' };
      const checkins = (Array.isArray(g.checkins) ? g.checkins : []).concat([entry]).slice(-MAX_CHECKINS);
      return { patch: Object.assign({ checkins, lastCheckinDate: today }, touched), event: 'checkin' };
    }
    case 'review': {
      if (g.status !== 'active') return { error: 'Reviews are for active goals.' };
      const decision = String(d.decision || '');
      if (!REVIEW_DECISIONS.includes(decision)) return { error: 'Choose what is next for this goal.' };
      const entry = { date: today, easier: cleanText(d.easier, NOTE_MAX), decision, score: typeof g.latest === 'number' ? g.latest : null };
      const reviews = (Array.isArray(g.reviews) ? g.reviews : []).concat([entry]).slice(-12);
      const patch = Object.assign({ reviews }, touched);
      if (decision === 'continue') {
        patch.reviewDate = plusDays(today, g.source === 'planner' ? PLANNER_REVIEW_DAYS : REVIEW_DAYS);
        // The new round measures from where the score is now.
        if (typeof g.latest === 'number') {
          patch.baseline = g.latest;
          patch.target = targetFor(g.latest, g.reading);
        }
      } else {
        patch.status = 'done';
        patch.focus = false;
        patch.doneDate = today;
      }
      return { patch, event: 'review' };
    }
    default:
      return { error: 'Unknown change.' };
  }
}

// ── Reminders (the hourly tick) ────────────────────────────────────────────

/**
 * Is a plan reminder due right now? `clock` is { date, weekday, minutes }
 * in the goal's timezone. Returns { kind: 'review' | 'checkin', date } or
 * null.
 *
 * Sent between 9 AM and 9 PM local, at most once per local day. The review
 * reminder goes once per review date. The check-in reminder goes on the
 * member's check-in day when they have not checked in for five days.
 */
function planReminderDue(goal, clock) {
  const g = goal || {};
  if (g.status !== 'active' || !clock || !isIsoDay(clock.date)) return null;
  if (clock.minutes < 9 * 60 || clock.minutes >= 21 * 60) return null;
  if (g.lastReminderDate === clock.date) return null;
  const r = g.reminders || {};
  if (r.email === false && r.inapp === false && r.push !== true) return null;
  if (isIsoDay(g.reviewDate) && clock.date >= g.reviewDate && g.reviewNoticeFor !== g.reviewDate) {
    return { kind: 'review', date: clock.date };
  }
  if (clock.weekday !== g.checkinDay || !isIsoDay(g.startDate)) return null;
  const since = g.lastCheckinDate || g.startDate;
  if (dayDiff(since, clock.date) < 5) return null;
  return { kind: 'checkin', date: clock.date };
}

/** Subject, body and link for one plan reminder. */
function planReminderMessage(goal, due, { base = 'https://the1pnation.com', goalId = '' } = {}) {
  const g = goal || {};
  const url = `${base}/plan${goalId ? `#goal-${goalId}` : ''}`;
  if (due.kind === 'review') {
    const moved = g.slug
      ? `Retake ${g.assessmentTitle || 'the assessment'} to see how far ${g.areaLabel || 'this area'} has moved, then choose what is next.`
      : 'Look back at what moved, then choose what is next.';
    return {
      subject: `Time to review: ${g.title}`,
      heading: 'Your review is ready',
      body: `You set "${g.title}" ${g.source === 'planner' ? '90' : '30'} days ago. ${moved}`,
      cta: 'Start my review',
      url
    };
  }
  const p = progressOf(g);
  const t = nextTask(g);
  return {
    subject: `Weekly check-in: ${g.title}`,
    heading: 'Your weekly check-in',
    body: `Two minutes on "${g.title}": what you did, what got in the way, and what is next. ${p.done} of ${p.total} tasks done.${t ? ` Next up: ${t.text}` : ''}`,
    cta: 'Check in',
    url
  };
}

// ── The Alignment Audit follow-up ──────────────────────────────────────────
// A leader who builds a plan from a team assessment has said their team is
// the problem worth working on. A self-assessment only shows their view from
// the top, so a few days in, Anthony writes once to offer the Audit. Sent at
// most once per member (the server checks that, the priority-lead rule, an
// Audit already requested, and unsubscribes).

const AUDIT_NUDGE_AFTER_DAYS = 3;
const AUDIT_NUDGE_UNTIL_DAYS = 21;

/** Is this goal one the Audit follow-up is written for, and is it time? */
function auditNudgeDue(goal, today) {
  const g = goal || {};
  if (g.source !== 'assessment' || !TEAM_ASSESSMENTS.includes(g.slug)) return false;
  if (g.status !== 'active' || g.auditNudgeFor || !isIsoDay(g.startDate)) return false;
  const d = dayDiff(g.startDate, today);
  return d >= AUDIT_NUDGE_AFTER_DAYS && d <= AUDIT_NUDGE_UNTIL_DAYS;
}

/** The note itself: plain, personal, from Anthony. */
function auditNudgeMessage(goal, { firstName = '', base = 'https://the1pnation.com' } = {}) {
  const g = goal || {};
  const title = g.assessmentTitle || 'your assessment';
  const area = g.areaLabel ? `${g.areaLabel} score` : 'score';
  const day = DAY_NAMES[g.checkinDay] || 'your check-in day';
  const lines = [
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    `You built a plan from ${title} a few days ago, starting with "${g.title}." That is the right move. Most leaders read their score and stop there.`,
    '',
    `Here is what a self-assessment cannot show you: how your team would answer the same questions. Your ${area} is your view from the top. The gap between that and what your team sees is usually where the real work is.`,
    '',
    'That is what the Alignment Audit is for. It is a free 45-minute session on Zoom, with your whole team or with you one-on-one, and within 48 hours you get a one-page written scorecard you can act on.',
    '',
    `If that would help, pick a time here: ${base}/corporate#audit`,
    '',
    `If not, keep going with your plan. Your next check-in is ${day}.`,
    '',
    'Anthony Brown Sr.',
    'The One Percent'
  ];
  return {
    subject: `Your ${title.replace(/^The /, '')} results, and your team`,
    text: lines.join('\n')
  };
}

// ── Team summary ───────────────────────────────────────────────────────────

/**
 * What a team leader sees: totals only, never one person's goals or scores.
 *
 * members: [{ assessments: { slug: { dims, score } }, goals: [goal] }]
 * Returns { members, hidden } when the team is under TEAM_MIN, otherwise
 * { members, withPlan, activeGoals, tasksDone, tasksTotal, checkinsLast30,
 *   assessments: [{ slug, n, avg, dims: { key: avg } }] }, where an
 *   assessment is listed only once TEAM_MIN members have taken it.
 */
function summarizeTeam(members, { today } = {}) {
  const list = Array.isArray(members) ? members : [];
  if (list.length < TEAM_MIN) return { members: list.length, hidden: true };
  let withPlan = 0; let activeGoals = 0; let tasksDone = 0; let tasksTotal = 0; let checkinsLast30 = 0;
  const per = {};
  list.forEach((m) => {
    const goals = Array.isArray(m.goals) ? m.goals : [];
    const active = goals.filter((g) => g.status === 'active');
    if (active.length) withPlan++;
    activeGoals += active.length;
    goals.forEach((g) => {
      const p = progressOf(g);
      tasksDone += p.done; tasksTotal += p.total;
      (g.checkins || []).forEach((c) => { if (today && isIsoDay(c.date) && dayDiff(c.date, today) <= 30) checkinsLast30++; });
    });
    Object.entries(m.assessments || {}).forEach(([slug, r]) => {
      if (!r || typeof r.score !== 'number') return;
      const a = per[slug] || (per[slug] = { slug, n: 0, sum: 0, dims: {} });
      a.n++; a.sum += r.score;
      Object.entries(r.dims || {}).forEach(([k, v]) => {
        if (typeof v !== 'number') return;
        const d = a.dims[k] || (a.dims[k] = { n: 0, sum: 0 });
        d.n++; d.sum += v;
      });
    });
  });
  const assessments = Object.values(per).filter((a) => a.n >= TEAM_MIN)
    .map((a) => ({
      slug: a.slug,
      n: a.n,
      avg: Math.round(a.sum / a.n),
      dims: Object.fromEntries(Object.entries(a.dims).map(([k, d]) => [k, Math.round(d.sum / d.n)]))
    }))
    .sort((x, y) => y.n - x.n || x.slug.localeCompare(y.slug));
  return { members: list.length, withPlan, activeGoals, tasksDone, tasksTotal, checkinsLast30, assessments };
}

export {
  MAX_ACTIVE, MAX_AREAS_PER_BUILD, MAX_TASKS, MAX_GOALS, TITLE_MAX, TEXT_MAX, NOTE_MAX, MAX_CHECKINS,
  REVIEW_DAYS, PLANNER_REVIEW_DAYS, STALL_DAYS, TEAM_MIN, TEAM_ASSESSMENTS, GOAL_STATUSES, REVIEW_DECISIONS, DAY_NAMES,
  isIsoDay, todayIso, plusDays, dayDiff, weekdayOf, fmtDay, cleanText, oneLine,
  targetFor, scoreChange, weeklyDueDates, wizardAreas, goalsFromPicks, goalFromPlanner,
  progressOf, nextTask, overdueTasks, checkinDue, reviewDue, isStalled, orderGoals, activeCount, planNextSteps,
  icsForGoals, cleanReminders, validateNewGoal, applyGoalOp, planReminderDue, planReminderMessage, summarizeTeam,
  AUDIT_NUDGE_AFTER_DAYS, AUDIT_NUDGE_UNTIL_DAYS, auditNudgeDue, auditNudgeMessage
};
