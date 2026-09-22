// Course data layer — merges the hardcoded seed registry (courses-registry.js)
// with Firestore `courses/{slug}` docs so the owner/admins can edit course
// details, add new courses, and flip status (live / coming-soon / beta /
// inactive) from /manage-courses.html without a deploy.
//
// Merge rules:
//   - Every registry entry is a seed default; Firestore fields override it.
//   - `mount` (a function) always comes from code — Firestore can't hold it.
//   - Firestore-only docs (courses created in the admin UI) are appended and
//     render through the generic course-renderer when set live.
//   - `status: 'inactive'` courses are hidden unless { includeInactive: true }.
//   - `status: 'beta'` courses stay in the list: they are real, openable
//     content for the members granted access, and are kept off every public
//     surface by the catalog (catalog-core.js) and availableCourses()
//     (enrollments.js) rather than by being dropped here.

import { db, firebaseReady } from './firebase.js';
import {
  collection, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { COURSES } from './courses-registry.js';

let _merged = null;

export async function loadCourses({ force = false } = {}) {
  if (_merged && !force) return _merged;

  const bySlug = new Map();
  COURSES.forEach((c, i) => bySlug.set(c.slug, { sortOrder: i, ...c }));

  if (firebaseReady) {
    try {
      const snap = await getDocs(collection(db, 'courses'));
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        const seed = bySlug.get(d.id);
        if (seed) {
          // Firestore fields win; `mount` and anything Firestore doesn't set
          // stay from code.
          bySlug.set(d.id, { ...seed, ...data, slug: d.id, mount: seed.mount });
        } else {
          bySlug.set(d.id, { ...data, slug: d.id });
        }
      });
    } catch (e) {
      console.warn('[courses-data] Firestore load failed; using registry only', e);
    }
  }

  _merged = Array.from(bySlug.values()).sort((a, b) =>
    (a.sortOrder ?? 999) - (b.sortOrder ?? 999) || String(a.title).localeCompare(String(b.title))
  );
  return _merged;
}

/** Synchronous getter — call after loadCourses() has resolved. */
export function getCourses({ includeInactive = false } = {}) {
  const all = _merged || COURSES;
  return includeInactive ? all : all.filter((c) => c.status !== 'inactive');
}

export function getCourseBySlug(slug, { includeInactive = false } = {}) {
  if (!slug) return null;
  return getCourses({ includeInactive }).find((c) => c.slug === slug) || null;
}

// Returns the active course if ?course=<slug> matches a known (visible)
// course, else null (null = library view).
export function getActiveCourse() {
  const slug = new URLSearchParams(location.search).get('course');
  return getCourseBySlug(slug);
}

// ─── Pricing display ──────────────────────────────────────────────────────
// Lives in pricing.js now so products share the exact rule; re-exported here
// because every existing caller imports it from this module.
export { priceInfo, fmtMoney } from './pricing.js';

// ─── Module metadata (for roadmaps) ───────────────────────────────────────

// Code-rendered courses keep their module lists in JS. Anything else reads
// `courses/{slug}/modules`.
const CODE_MODULE_META = {
  '1p-clc-leader': async () => (await import('./modules.js')).MODULES,
  'icant': async () => (await import('./icant-course.js')).MODULES
};

/**
 * Returns [{ id, title, subtitle, pillar, duration, tagLabel, published }] for a
 * course, or [] when no module metadata is available.
 *
 * Draft lessons (published === false) are omitted unless { includeDrafts: true },
 * which owner/admin preview passes so the author can see the roadmap members
 * will get once everything is published.
 */
export async function loadModulesMeta(course, { includeDrafts = false } = {}) {
  if (!course) return [];
  if (course.contentSource !== 'firestore' && CODE_MODULE_META[course.slug]) {
    try {
      const mods = await CODE_MODULE_META[course.slug]();
      return mods.map((m) => ({
        id: m.id,
        title: m.title,
        subtitle: m.subtitle || '',
        pillar: m.pillar || m.chapterRef || '',
        duration: m.duration || '',
        tagLabel: m.tagLabel || '',
        published: true
      }));
    } catch (e) {
      console.warn('[courses-data] code module meta failed', e);
      return [];
    }
  }
  const docs = await loadModuleDocs(course.slug, { includeDrafts });
  return docs.map((m) => ({
    id: m.id,
    title: m.title || `Module ${m.id}`,
    subtitle: m.subtitle || '',
    pillar: m.pillar || '',
    duration: m.duration || '',
    tagLabel: m.tagLabel || '',
    published: m.published !== false
  }));
}

/**
 * Full module docs (including lesson html) from courses/{slug}/modules.
 * Draft lessons are filtered out here — one gate for every reader — so a
 * half-written lesson can never reach a member. Owner/admin preview opts back
 * in with { includeDrafts: true }.
 */
export async function loadModuleDocs(slug, { includeDrafts = false } = {}) {
  if (!firebaseReady || !slug) return [];
  try {
    const snap = await getDocs(collection(db, 'courses', slug, 'modules'));
    const docs = snap.docs
      .map((d) => ({ id: Number(d.id), ...d.data() }))
      .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id));
    return includeDrafts ? docs : docs.filter((m) => m.published !== false);
  } catch (e) {
    console.warn('[courses-data] module docs load failed', e);
    return [];
  }
}
