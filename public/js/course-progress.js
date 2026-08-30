// "How far through this course is the member?" — one answer for every course,
// whatever it is built out of.
//
// Progress lives in three different places depending on how a course renders:
//   contentSource === 'firestore' → users/{uid}/progress/{slug}__m{id}  (course-renderer.js)
//   1p-clc-leader                        → users/{uid}/progress/{id}           (store.js)
//   icant                         → localStorage 'icant-course-v1'      (icant-course.js)
// Anything that only needs "is this finished, and how far in are they" — the
// roadmap, the certificate — should not have to know which. That is this module.

import { loadModulesMeta } from './courses-data.js';
import { store } from './store.js';

const ICANT_KEY = 'icant-course-v1';

function icantCompleted() {
  try {
    const raw = JSON.parse(localStorage.getItem(ICANT_KEY) || '{}');
    const done = raw.completed || {};
    return new Set(Object.keys(done).filter((k) => done[k]).map(Number));
  } catch (e) {
    return new Set();
  }
}

async function firestoreCompleted(slug) {
  try {
    const { loadCourseProgress } = await import('./course-renderer.js');
    return await loadCourseProgress(slug);
  } catch (e) {
    return new Set();
  }
}

/**
 * Completion state for one course:
 *   { modules, completed:Set, done, total, pct, isComplete }
 *
 * `done` counts only modules that actually exist in the course today, so a
 * progress doc left behind by a deleted lesson can never push a member to 100%.
 */
export async function loadCourseCompletion(course, { includeDrafts = false } = {}) {
  const empty = { modules: [], completed: new Set(), done: 0, total: 0, pct: 0, isComplete: false };
  if (!course) return empty;

  const modules = await loadModulesMeta(course, { includeDrafts });

  let completed;
  if (course.contentSource === 'firestore') {
    completed = await firestoreCompleted(course.slug);
  } else if (course.slug === '1p-clc-leader') {
    if (!store._loaded) { try { await store.load(); } catch (e) {} }
    completed = new Set(store.completed || []);
  } else if (course.slug === 'icant') {
    completed = icantCompleted();
  } else {
    completed = await firestoreCompleted(course.slug);
  }

  const total = modules.length;
  const done = modules.filter((m) => completed.has(m.id)).length;
  return {
    modules,
    completed,
    done,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
    isComplete: total > 0 && done === total
  };
}
