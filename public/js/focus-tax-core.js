// The Focus Tax calculator — the math, and nothing else.
//
// Every figure comes from How to Work Less and Gain More (Anthony Brown,
// Eleven Legacy Press) and is cited by chapter on the page and in the emailed
// report. Pure: no imports, no DOM, so the page, the tests and the server
// (functions/focus-tax.js, a CommonJS copy kept identical by
// tests/focus-tax.test.mjs) all compute the same number.
//
// Two caps keep a heavy input from claiming an impossible week: refocus and
// switching together cannot exceed 40% of a workday, and the whole tax cannot
// exceed half the working week. The figures stay the book's; the caps only
// stop them from stacking past what a real day can hold.

export const WORK_DAYS = 5;
export const WORK_WEEKS = 50;

export const FOCUS_TAX_SOURCES = {
  refocusMinutes: 23,          // Phase One: time to regain deep focus after one interruption
  switchMinutes: 20,           // Phase Twelve: lost per switch between different kinds of work
  meetingWasteShare: 0.37,     // Phase Thirteen: share of meetings attendees call unnecessary
  driftHours: { never: 5, sometimes: 2.5, weekly: 1 }, // Phase Ten: 5+ unplanned hours a week
  focusCapShareOfDay: 0.4,
  totalCapShareOfWeek: 0.5,
  // The book's system, applied (Phases Six, Twelve, Thirteen):
  system: { interruptionsPerDay: 2, switchesPerDay: 2, meetingWasteShare: 0, driftHours: 0.25 }
};

export const FOCUS_TAX_DEFAULTS = {
  mode: 'solo',
  income: 100000,
  teamSize: 10,
  avgSalary: 75000,
  hoursPerWeek: 45,
  interruptionsPerDay: 5,
  switchesPerDay: 2,
  meetingHoursPerWeek: 8,
  planning: 'sometimes'
};

export const FOCUS_TAX_RANGES = {
  income: [20000, 1000000],
  teamSize: [2, 5000],
  avgSalary: [20000, 500000],
  hoursPerWeek: [20, 80],
  interruptionsPerDay: [0, 30],
  switchesPerDay: [0, 20],
  meetingHoursPerWeek: [0, 40]
};

// What each line of the tax is, where the book covers it, which Focus Tax
// essay goes with it (readSlug is its page under /reads), and the one thing to run first if it is the biggest.
export const FOCUS_TAX_LINES = [
  {
    key: 'interruptions',
    label: 'Interruptions',
    chapter: 'Phase One: Why Structure Outperforms Motivation',
    read: 'The Tab You Never Closed',
    readSlug: 'the-tab-you-never-closed',
    fix: 'Set two communication windows, one mid-morning and one mid-afternoon. Outside them the inbox stays closed and notifications stay off.'
  },
  {
    key: 'switching',
    label: 'Task switching',
    chapter: 'Phase Twelve: The Power of Batching',
    read: 'You Do Not Need More Focus, You Need Fewer Decisions',
    readSlug: 'fewer-decisions-not-more-focus',
    fix: 'Batch by type. Calls together, admin together, creative work together. Load one context and stay inside it until the block is done.'
  },
  {
    key: 'meetings',
    label: 'Meetings with no outcome',
    chapter: 'Phase Thirteen: How to Handle Meetings Without Letting Them Run Your Life',
    read: 'How to Run a Meeting When Your Brain Won\'t Stay in the Room',
    readSlug: 'meeting-brain-wont-stay-in-the-room',
    fix: 'Ask what outcome each standing meeting produces. Set your default length to thirty minutes and batch meetings into set windows.'
  },
  {
    key: 'drift',
    label: 'Drift',
    chapter: 'Phase Ten: The Weekly Audit',
    read: 'Why Your To-Do List Keeps Lying to You',
    readSlug: 'your-todo-list-is-lying',
    fix: 'Spend fifteen minutes on Sunday night blocking next week, deep work first. Close each Friday with the five-question weekly audit.'
  }
];

function clampNum(v, range, fallback) {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : Number(v);
  if (v === null || v === '' || !Number.isFinite(n)) return fallback;
  return Math.min(range[1], Math.max(range[0], n));
}

/** Clamp every input to its range; anything unusable falls back to the default. */
export function normalizeFocusTaxInput(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = FOCUS_TAX_DEFAULTS;
  const R = FOCUS_TAX_RANGES;
  return {
    mode: r.mode === 'team' ? 'team' : 'solo',
    income: clampNum(r.income, R.income, d.income),
    teamSize: Math.round(clampNum(r.teamSize, R.teamSize, d.teamSize)),
    avgSalary: clampNum(r.avgSalary, R.avgSalary, d.avgSalary),
    hoursPerWeek: clampNum(r.hoursPerWeek, R.hoursPerWeek, d.hoursPerWeek),
    interruptionsPerDay: clampNum(r.interruptionsPerDay, R.interruptionsPerDay, d.interruptionsPerDay),
    switchesPerDay: clampNum(r.switchesPerDay, R.switchesPerDay, d.switchesPerDay),
    meetingHoursPerWeek: clampNum(r.meetingHoursPerWeek, R.meetingHoursPerWeek, d.meetingHoursPerWeek),
    planning: Object.prototype.hasOwnProperty.call(FOCUS_TAX_SOURCES.driftHours, r.planning) ? r.planning : d.planning
  };
}

// Weekly hours lost, per line, for one person.
function weeklyLines(i, { interruptionsPerDay, switchesPerDay, meetingWasteShare, driftHours }) {
  const S = FOCUS_TAX_SOURCES;
  const dayHours = i.hoursPerWeek / WORK_DAYS;
  let refocus = interruptionsPerDay * S.refocusMinutes / 60;
  let switching = switchesPerDay * S.switchMinutes / 60;
  const focusCap = dayHours * S.focusCapShareOfDay;
  if (refocus + switching > focusCap) {
    const k = focusCap / (refocus + switching);
    refocus *= k;
    switching *= k;
  }
  const lines = {
    interruptions: refocus * WORK_DAYS,
    switching: switching * WORK_DAYS,
    meetings: Math.min(i.meetingHoursPerWeek, i.hoursPerWeek) * meetingWasteShare,
    drift: driftHours
  };
  const total = lines.interruptions + lines.switching + lines.meetings + lines.drift;
  const cap = i.hoursPerWeek * S.totalCapShareOfWeek;
  if (total > cap) {
    const k = cap / total;
    Object.keys(lines).forEach((key) => { lines[key] *= k; });
  }
  return lines;
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

/**
 * The whole calculation. Hours are per person per week; costs cover everyone
 * (one person in solo mode, the team in team mode).
 */
export function computeFocusTax(raw) {
  const i = normalizeFocusTaxInput(raw);
  const S = FOCUS_TAX_SOURCES;
  const people = i.mode === 'team' ? i.teamSize : 1;
  const salary = i.mode === 'team' ? i.avgSalary : i.income;
  const hourly = salary / (i.hoursPerWeek * WORK_WEEKS);

  const now = weeklyLines(i, {
    interruptionsPerDay: i.interruptionsPerDay,
    switchesPerDay: i.switchesPerDay,
    meetingWasteShare: S.meetingWasteShare,
    driftHours: S.driftHours[i.planning]
  });
  const withSystem = weeklyLines(i, {
    interruptionsPerDay: Math.min(i.interruptionsPerDay, S.system.interruptionsPerDay),
    switchesPerDay: Math.min(i.switchesPerDay, S.system.switchesPerDay),
    meetingWasteShare: S.system.meetingWasteShare,
    driftHours: Math.min(S.driftHours[i.planning], S.system.driftHours)
  });

  const weeklyHours = sum(now);
  const reclaimedHours = Math.max(0, weeklyHours - sum(withSystem));
  const lines = FOCUS_TAX_LINES.map((l) => ({ ...l, hours: now[l.key] }));
  const biggest = lines.reduce((a, b) => (b.hours > a.hours ? b : a));

  return {
    input: i,
    people,
    hourly,
    lines,
    biggest: biggest.hours > 0 ? biggest : null,
    weeklyHours,
    pctOfWeek: weeklyHours / i.hoursPerWeek,
    workdaysLost: weeklyHours / (i.hoursPerWeek / WORK_DAYS),
    weeklyCost: weeklyHours * hourly * people,
    yearlyCost: weeklyHours * hourly * people * WORK_WEEKS,
    reclaimedHours,
    reclaimedYearlyHours: reclaimedHours * WORK_WEEKS,
    reclaimedYearlyCost: reclaimedHours * hourly * people * WORK_WEEKS
  };
}
