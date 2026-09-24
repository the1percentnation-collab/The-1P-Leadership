// Course commitment — pure helpers for the Parkinson's Law questionnaire
// (/commit.html) and the roadmap commitment card. No DOM, no Firebase, so the
// pace math is unit-tested in tests/commitment.test.mjs.
//
// Dates are local calendar days as 'YYYY-MM-DD' strings; they compare
// correctly as strings and never drift across timezones the way Date does.

export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Deadline presets offered as one-tap chips, in days from today. */
export const GOAL_PRESETS = [
  { days: 14, label: '2 weeks' },
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' }
];

export const WEEKLY_PRESETS = [60, 120, 180, 300, 420];      // minutes per week
export const SESSION_PRESETS = [15, 30, 45, 60];             // minutes per session
export const MAX_GOAL_DAYS = 366;

/** Local 'YYYY-MM-DD' for a Date (defaults to now). */
export function isoDay(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 'YYYY-MM-DD' shifted by n calendar days. */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Whole calendar days from `fromIso` to `toIso` (negative when past). */
export function daysBetween(fromIso, toIso) {
  const ms = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((ms(toIso) - ms(fromIso)) / 86400000);
}

/**
 * Pick which weekdays to preselect from a weekly budget and session length:
 * spread sessions across the week, weekdays first.
 */
export function suggestDays(weeklyMinutes, sessionMinutes) {
  const n = Math.max(1, Math.min(7, Math.round(weeklyMinutes / Math.max(1, sessionMinutes))));
  const ORDER = {
    1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6]
  };
  return ORDER[n].slice();
}

/**
 * The pace the member is signing up for.
 *   { daysLeft, weeks, modulesPerWeek, plannedMinutes, neededMinutes, fits }
 * `neededMinutes` estimates course effort at `minutesPerModule` each (default
 * 30); `fits` is false when the schedule can't cover it before the deadline.
 */
export function paceSummary({ today, goalDate, moduleCount, sessionMinutes, days, minutesPerModule = 30 }) {
  const daysLeft = Math.max(0, daysBetween(today, goalDate));
  const weeks = Math.max(1, daysLeft / 7);
  const perWeek = sessionMinutes * (days ? days.length : 0);
  const plannedMinutes = Math.round(perWeek * weeks);
  const neededMinutes = Math.max(0, moduleCount) * minutesPerModule;
  const modulesPerWeek = moduleCount ? Math.round((moduleCount / weeks) * 10) / 10 : 0;
  return {
    daysLeft,
    weeks: Math.round(weeks * 10) / 10,
    modulesPerWeek,
    plannedMinutes,
    neededMinutes,
    fits: !moduleCount || plannedMinutes >= neededMinutes
  };
}

/** Error string for a goal date, or ''. */
export function goalDateError(goalDate, today = isoDay()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goalDate || '')) return 'Pick a finish date.';
  if (goalDate <= today) return 'Your finish date needs to be in the future.';
  if (daysBetween(today, goalDate) > MAX_GOAL_DAYS) return 'Keep it within a year. Parkinson\'s Law punishes long deadlines.';
  return '';
}

/** Client-side mirror of the server's validation; returns an error string or ''. */
export function commitmentError(c, today = isoDay()) {
  if (!c) return 'Pick a finish date.';
  const g = goalDateError(c.goalDate, today);
  if (g) return g;
  if (!(c.weeklyMinutes >= 30 && c.weeklyMinutes <= 1680)) return 'Choose how much time you\'ll give it each week.';
  if (!(c.sessionMinutes >= 10 && c.sessionMinutes <= 240)) return 'Choose a session length.';
  if (!Array.isArray(c.days) || !c.days.length) return 'Pick at least one day.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.reminderTime || '')) return 'Pick a reminder time.';
  return '';
}

/** "3 hrs", "90 min", "1.5 hrs" */
export function fmtMinutes(m) {
  if (m < 60) return `${m} min`;
  const h = m / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hr${h === 1 ? '' : 's'}`;
}

/** "19:00" → "7:00 PM" */
export function fmtTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ap}`;
}

/** "Mon, Wed, Fri" | "Every day" | "Weekdays" */
export function fmtDays(days) {
  const s = [...new Set(days || [])].sort((a, b) => a - b);
  if (s.length === 7) return 'Every day';
  if (s.length === 5 && s.join() === '1,2,3,4,5') return 'Weekdays';
  return s.map((d) => DAY_LABELS[d]).join(', ');
}

/** "Nov 30, 2026" from 'YYYY-MM-DD' without timezone drift. */
export function fmtDate(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
}
