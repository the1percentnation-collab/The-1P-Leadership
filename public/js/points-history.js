// Per-day points history — turning the `dailyPoints` map on
// users/{uid}/stats/aggregate into something a chart can draw.
//
// The first version of the dashboard chart plotted one bar per member who had
// scored that week. On a quiet week that is one bar, and one bar at full
// height and full width is a solid rectangle, not a chart. This answers a
// better question anyway: how has THIS member been going, day by day.
//
// A fixed seven-day window means the series is always seven points long, so
// the shape of the chart no longer depends on how many other people happened
// to post. A blank week is seven empty bars, which reads as "a blank week"
// rather than as a broken widget.
//
// Free of Firebase imports so it can be tested directly.
//
// DAY KEYS: "YYYY-MM-DD" in UTC, matching what applyPointsDelta and
// touchDailyStreak write server-side. The two copies of this format cannot
// share code — functions/ is CommonJS and this is an ES module loaded from a
// CDN — so if one ever changes, the other has to change with it.

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** "YYYY-MM-DD" in UTC for a Date (or now). */
export function utcDayKey(date) {
  const d = date || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The last `days` UTC day keys, oldest first, ending with today. */
export function lastNDayKeys(days = 7, now = Date.now()) {
  const n = Math.max(1, Math.floor(days));
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(utcDayKey(new Date(now - i * DAY)));
  return out;
}

/**
 * The chart series: one entry per day, oldest first.
 *
 *   [{ key, value, label, isToday }]
 *
 * Days with no entry in the map are zero rather than missing — a day the
 * member did nothing is data, not a gap.
 */
export function dailySeries(dailyPoints, { days = 7, now = Date.now() } = {}) {
  const map = dailyPoints && typeof dailyPoints === 'object' ? dailyPoints : {};
  const today = utcDayKey(new Date(now));
  return lastNDayKeys(days, now).map((key) => {
    const raw = Number(map[key]);
    return {
      key,
      value: Number.isFinite(raw) && raw > 0 ? raw : 0,
      // Single-letter weekday, read in UTC so it matches the key it labels.
      label: WEEKDAY[new Date(`${key}T00:00:00Z`).getUTCDay()],
      isToday: key === today
    };
  });
}

/** Total across a series — what the member actually scored in the window. */
export function seriesTotal(series) {
  return (series || []).reduce((sum, d) => sum + (Number(d.value) || 0), 0);
}
