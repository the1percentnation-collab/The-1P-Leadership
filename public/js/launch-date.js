// Course launch dates — one answer for "when does this open?", shared by
// everything that has to say it.
//
// A coming-soon course carries `launchDate` on its course doc, set from the
// card grid in /manage-courses.html. Four places read it: the admin card, the
// homepage launch banner, the homepage course badge, and the public course
// landing page. They were never going to format or validate it the same way
// by accident, so they all come here.
//
// Deliberately free of Firebase imports so it can be tested directly.
//
// TIMEZONE, which is the whole reason this file is careful:
// `<input type="date">` hands back "YYYY-MM-DD" with no zone. `new Date()` on
// that string parses it as UTC midnight, which renders as the *previous day*
// anywhere west of Greenwich — a launch typed as March 3 would advertise
// itself as March 2 to every US visitor. So the string is always split and
// rebuilt as a local date, and only ever stored back as local midnight.

const DAY = 24 * 60 * 60 * 1000;

/**
 * Milliseconds for a course's launch date, or null when it has none.
 *
 * Accepts every shape the value arrives in: a Firestore Timestamp from the
 * catalog, a Date, a raw epoch number, or a "YYYY-MM-DD" string straight off
 * the input element.
 */
export function launchDateMs(course) {
  const v = course && course.launchDate;
  if (v == null || v === '') return null;

  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') {
    const d = v.toDate();
    return isNaN(d.getTime()) ? null : d.getTime();
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  if (typeof v === 'string') {
    // Date-only strings are local, not UTC — see the header note.
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** "YYYY-MM-DD" in local time, for the value of an <input type="date">. */
export function toDateInput(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A local-midnight Date from an <input type="date"> value, or null. */
export function fromDateInput(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * "March 3, 2027" by default; `short` gives "Mar 3", which is what fits on a
 * card badge. The year is dropped from the short form only when the launch
 * falls in the current year — "Mar 3" next December would be a lie.
 */
export function fmtLaunchDate(ms, { short = false, now = Date.now() } = {}) {
  if (ms == null) return '';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  if (!short) {
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * How far off the launch is, in words: "today", "tomorrow", "in 12 days",
 * "in 3 weeks". Returns '' once the date has passed, so a stale date goes
 * quiet rather than counting upward.
 *
 * Counted in whole local calendar days, not elapsed hours — a launch tomorrow
 * morning should read "tomorrow" whether it is now breakfast or midnight.
 */
export function launchCountdown(ms, { now = Date.now() } = {}) {
  if (ms == null) return '';
  const startOfDay = (t) => {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (days < 0) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  const weeks = Math.round(days / 7);
  if (days < 60) return `in ${weeks} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

/** Has this launch date already arrived (or passed)? */
export function hasLaunched(ms, { now = Date.now() } = {}) {
  return ms != null && launchCountdown(ms, { now }) === '';
}

/**
 * The next course to open: the soonest launch date that has not arrived yet,
 * among courses that are actually announced to the public.
 *
 * The filter matches home-courses.js exactly — coming-soon, switched on for
 * the main site, and not bundle-only — because a banner for a course the
 * visitor cannot find anywhere else on the page would be a dead end.
 *
 * Returns { course, ms } or null.
 */
export function nextLaunch(courses, { now = Date.now() } = {}) {
  const candidates = (courses || [])
    .filter((c) => c
      && c.status === 'coming-soon'
      && c.showOnSite !== false
      && c.sellable !== false)
    .map((c) => ({ course: c, ms: launchDateMs(c) }))
    .filter((r) => r.ms != null && !hasLaunched(r.ms, { now }))
    .sort((a, b) => a.ms - b.ms);

  return candidates[0] || null;
}
