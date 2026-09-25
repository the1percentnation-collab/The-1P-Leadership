// Where a beta tester is in a course, and whether they are on track — pure.
//
// The Progress tab in /beta-admin is built on this. It turns the raw joins
// listBetaTesters returns (completed module ids, the goal date the member
// committed to on /commit.html, when their last lesson landed) into the one
// answer Anthony needs per person: who is in, who is working, who is slipping.
//
// Pace uses the same rule as the member's own commitment card
// (renderCommitmentCard in courses-page.js): expected progress is the share of
// the start-to-goal span already elapsed, and more than five points under it
// is behind. Kept free of Firebase so tests/beta-progress.test.mjs can run it.

import { isoDay, addDays, daysBetween } from './commitment-state.js';

export const STALL_DAYS = 7;
export const SLOW_START_DAYS = 3;
const DAY_MS = 86400000;

export const PACE_LABELS = {
  'finished': 'Finished',
  'on-pace': 'On pace',
  'no-plan': 'Working · no goal set',
  'behind': 'Behind',
  'overdue': 'Past goal date',
  'stalled': 'Stalled',
  'not-started': 'Not started'
};

/**
 * @param doneIds       completed module ids for this course
 * @param modules       [{ id, title }] in course order; [] when unknown
 * @param total         module count to fall back on when `modules` is empty
 * @param commitment    { goalDate, startDate } from courseCommitments, or null
 * @param lastLessonAt  ms of the latest completed module, or null
 * @param startedAt     ms the tester got access (grant/activation), or null
 * @param completedAt   ms the server recorded the finish, or null
 * @param now           ms, injectable for tests
 */
export function testerProgress({
  doneIds = [], modules = [], total = 0, commitment = null,
  lastLessonAt = null, startedAt = null, completedAt = null, now = Date.now()
} = {}) {
  const done = new Set((doneIds || []).map(String));
  const count = modules.length ? modules.filter((m) => done.has(String(m.id))).length : done.size;
  const size = modules.length || total || 0;
  const pct = size ? Math.min(100, Math.round((count / size) * 100)) : 0;
  const idx = modules.findIndex((m) => !done.has(String(m.id)));
  const currentLesson = idx >= 0 ? { number: idx + 1, id: modules[idx].id, title: modules[idx].title || '' } : null;

  const today = isoDay(new Date(now));
  const goalDate = commitment && commitment.goalDate ? commitment.goalDate : null;
  const startIso = (commitment && commitment.startDate)
    || (startedAt ? isoDay(new Date(startedAt)) : null);
  const daysLeft = goalDate ? daysBetween(today, goalDate) : null;

  // Straight-line projection from the pace so far. A single lesson on day
  // one would project absurdly, so the elapsed span counts at least one day.
  let projectedFinish = null;
  if (startIso && count > 0 && size && count < size) {
    const elapsed = Math.max(1, daysBetween(startIso, today));
    const perDay = count / elapsed;
    projectedFinish = addDays(today, Math.ceil((size - count) / perDay));
  }

  let paceState;
  if (completedAt || (size && count >= size)) {
    paceState = 'finished';
  } else if (count === 0) {
    paceState = 'not-started';
  } else if (lastLessonAt && now - lastLessonAt > STALL_DAYS * DAY_MS) {
    paceState = 'stalled';
  } else if (!goalDate) {
    paceState = 'no-plan';
  } else if (daysLeft < 0) {
    paceState = 'overdue';
  } else {
    const start = startIso || today;
    const span = Math.max(1, daysBetween(start, goalDate));
    const expected = Math.min(1, Math.max(0, daysBetween(start, today) / span));
    paceState = size && count / size + 0.05 < expected ? 'behind' : 'on-pace';
  }

  const idleDays = lastLessonAt ? Math.floor((now - lastLessonAt) / DAY_MS) : null;
  const waitingDays = startedAt ? Math.floor((now - startedAt) / DAY_MS) : null;
  const slowStart = paceState === 'not-started' && waitingDays != null && waitingDays >= SLOW_START_DAYS;

  return {
    done: count, total: size, pct, currentLesson, goalDate, daysLeft,
    projectedFinish, paceState, idleDays, waitingDays, slowStart
  };
}

/** The tile a pace state counts toward. */
export function paceBucket(p) {
  switch (p.paceState) {
    case 'finished': return 'finished';
    case 'not-started': return 'notStarted';
    case 'behind': case 'overdue': case 'stalled': return 'slipping';
    default: return 'working';
  }
}

/** Lower sorts first: the people who need a message from Anthony today. */
export function attentionRank(p) {
  const order = { 'overdue': 0, 'behind': 1, 'stalled': 2, 'no-plan': 4, 'on-pace': 5, 'finished': 7 };
  if (p.paceState === 'not-started') return p.slowStart ? 3 : 6;
  return order[p.paceState] != null ? order[p.paceState] : 5;
}

/**
 * Tile counts across testers. `entries` is [{ progress, review }] with one
 * entry per tester-course pair.
 */
export function bucketCounts(entries) {
  const out = { enrolled: 0, notStarted: 0, working: 0, slipping: 0, finished: 0, reviewed: 0 };
  (entries || []).forEach((e) => {
    out.enrolled += 1;
    out[paceBucket(e.progress)] += 1;
    if (e.review) out.reviewed += 1;
  });
  return out;
}
