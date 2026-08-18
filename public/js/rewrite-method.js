// The Rewrite Method — drip state, unlock math, and check-in writes.
//
// Everything a member's course state contains lives at
// `users/{uid}/courseState/rewrite-method` and is SERVER-WRITTEN ONLY
// (firestore.rules denies client writes outright). That is deliberate: the
// drip anchor `enrolledAt` decides what content the rules will hand out, so a
// self-writable anchor could be backdated to unlock all six weeks on day one.
// Every mutation here goes through a callable that re-checks entitlement and,
// for check-ins, the unlock date.
//
// The unlock math below is duplicated server-side (functions/index.js) and in
// firestore.rules. This copy exists to draw the UI — it is not a gate.

import { auth, db, functions, firebaseReady } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  COURSE_SLUG, BONUS_ID, DRIP_INTERVAL_DAYS, MODULES, WEEK_MODULES
} from './rewrite-course-data.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const EMPTY_STATE = {
  enrolledAt: null,
  checkins: {},
  reviewChoice: null,
  completedAt: null,
  isRewriter: false
};

let _state = null;
let _stateUid = null;

function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  const n = Number(v);
  return Number.isFinite(n) ? new Date(n) : null;
}

function normalize(data) {
  const d = data || {};
  return {
    enrolledAt: toDate(d.enrolledAt),
    checkins: d.checkins && typeof d.checkins === 'object' ? d.checkins : {},
    reviewChoice: d.reviewChoice || null,
    completedAt: toDate(d.completedAt),
    isRewriter: !!d.isRewriter
  };
}

/** Reads the member's course state. Returns EMPTY_STATE when signed out. */
export async function loadRewriteState({ force = false } = {}) {
  if (!firebaseReady || !auth || !auth.currentUser) {
    _state = { ...EMPTY_STATE };
    _stateUid = null;
    return _state;
  }
  const uid = auth.currentUser.uid;
  if (!force && _state && _stateUid === uid) return _state;

  try {
    const snap = await getDoc(doc(db, 'users', uid, 'courseState', COURSE_SLUG));
    _state = normalize(snap.exists() ? snap.data() : null);
  } catch (e) {
    console.warn('[rewrite-method] state load failed', e);
    _state = { ...EMPTY_STATE };
  }
  _stateUid = uid;
  return _state;
}

export function rewriteState() {
  return _state || { ...EMPTY_STATE };
}

/**
 * The drip anchor is set the FIRST time the buyer opens the course — not at
 * purchase. A gift bought in March and opened in June shouldn't have burned
 * three months of drip days. Safe to call on every load; the callable only
 * writes when the anchor is still unset.
 */
export async function ensureDripStarted() {
  const state = await loadRewriteState();
  if (state.enrolledAt) return state;
  if (!firebaseReady || !auth || !auth.currentUser) return state;
  try {
    await httpsCallable(functions, 'startCourseDrip')({ slug: COURSE_SLUG });
    return await loadRewriteState({ force: true });
  } catch (e) {
    console.warn('[rewrite-method] could not start the drip', e);
    return state;
  }
}

// ─── Unlock math ──────────────────────────────────────────────────────────

/** When week `order` opens, or null if the drip hasn't started. */
export function unlockDate(order, state = rewriteState()) {
  if (!state.enrolledAt) return null;
  if (Number(order) === BONUS_ID) return null; // event-driven, not date-driven
  return new Date(state.enrolledAt.getTime() + Number(order) * DRIP_INTERVAL_DAYS * DAY_MS);
}

/** The bonus opens once week 6 is submitted AND the review step is answered. */
export function isBonusUnlocked(state = rewriteState()) {
  return !!state.checkins['week-6'] && !!state.reviewChoice;
}

export function isUnlocked(order, state = rewriteState()) {
  if (Number(order) === BONUS_ID) return isBonusUnlocked(state);
  const at = unlockDate(order, state);
  return !!at && Date.now() >= at.getTime();
}

/** "Unlocks Tuesday, Sep 8" — the copy the locked week cards carry. */
export function unlockLabel(order, state = rewriteState()) {
  if (Number(order) === BONUS_ID) {
    return isBonusUnlocked(state)
      ? 'Unlocked'
      : 'Unlocks when you finish Week 6';
  }
  const at = unlockDate(order, state);
  if (!at) return 'Unlocks when you start the course';
  if (Date.now() >= at.getTime()) return 'Unlocked';
  const fmt = at.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return `Unlocks ${fmt}`;
}

export function daysUntilUnlock(order, state = rewriteState()) {
  const at = unlockDate(order, state);
  if (!at) return null;
  return Math.max(0, Math.ceil((at.getTime() - Date.now()) / DAY_MS));
}

// ─── Check-ins ────────────────────────────────────────────────────────────

export function checkinFor(moduleSlug, state = rewriteState()) {
  return state.checkins[moduleSlug] || null;
}

/** Weeks 0–6 with a submitted check-in. The progress number members see. */
export function completedWeekCount(state = rewriteState()) {
  return WEEK_MODULES.filter((m) => !!state.checkins[m.slug]).length;
}

export function totalWeekCount() {
  return WEEK_MODULES.length;
}

/**
 * Submits one week's check-in. The callable re-verifies entitlement and the
 * unlock date before writing, then returns the fresh state (which for week 6
 * carries completedAt + isRewriter).
 */
export async function submitCheckin(moduleSlug, data) {
  if (!firebaseReady || !auth || !auth.currentUser) {
    throw new Error('Sign in to save your check-in.');
  }
  const res = await httpsCallable(functions, 'submitCourseCheckin')({
    slug: COURSE_SLUG, week: moduleSlug, data
  });
  await loadRewriteState({ force: true });
  return res && res.data;
}

/**
 * Week 6's review step. Either answer unlocks the bonus module — the ask is an
 * ask, not a paywall.
 */
export async function setReviewChoice(choice) {
  if (!['left_review', 'opted_out'].includes(choice)) {
    throw new Error('Unknown review choice.');
  }
  await httpsCallable(functions, 'setCourseReviewChoice')({ slug: COURSE_SLUG, choice });
  return await loadRewriteState({ force: true });
}

// ─── Paid content ─────────────────────────────────────────────────────────

/**
 * The week's video + worksheet payload from
 * `courses/rewrite-method/modules/{order}/content/main`.
 *
 * Returns null when the rules refuse — which is exactly what a locked or
 * unentitled read looks like, and is the reason provider ids are never in the
 * bundled JS. Callers render the lock state on null; they do not retry.
 */
export async function loadModuleContent(order) {
  if (!firebaseReady || !auth || !auth.currentUser) return null;
  try {
    const snap = await getDoc(
      doc(db, 'courses', COURSE_SLUG, 'modules', String(order), 'content', 'main')
    );
    return snap.exists() ? snap.data() : null;
  } catch (e) {
    // Permission denied on a locked week is the system working.
    return null;
  }
}

export { COURSE_SLUG, BONUS_ID, MODULES, WEEK_MODULES };
