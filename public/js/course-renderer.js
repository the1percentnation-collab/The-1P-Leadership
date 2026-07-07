// Generic course workspace renderer — mounts any course whose content lives
// in Firestore (`courses/{slug}/modules/{id}`, authored in /manage-courses.html)
// into the shared Coursera-style player (course-player.js), so admin-authored
// courses look identical to code-built courses (I Can't, 1P-CLC).
//
// Progress is namespaced per course: users/{uid}/progress/{slug}__m{id}
// (the shared store.js owns the un-namespaced ids used by 1P-CLC).

import { auth, db, firebaseReady } from './firebase.js';
import {
  doc, setDoc, getDocs, collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { loadModuleDocs } from './courses-data.js';
import { mountCoursePlayer } from './course-player.js';

let _purify = null;
async function getPurify() {
  if (_purify) return _purify;
  const mod = await import('https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs');
  _purify = mod.default || mod;
  return _purify;
}

function progressDocId(slug, moduleId) { return `${slug}__m${moduleId}`; }

const LS_PREFIX = '1p_course_progress_';

function lsGetProgress(slug) {
  try { return new Set(JSON.parse(localStorage.getItem(LS_PREFIX + slug) || '[]')); }
  catch (e) { return new Set(); }
}
function lsSetProgress(slug, set) {
  try { localStorage.setItem(LS_PREFIX + slug, JSON.stringify(Array.from(set))); } catch (e) {}
}

/** Completed module ids for a Firestore-rendered course. */
export async function loadCourseProgress(slug) {
  if (!firebaseReady || !auth || !auth.currentUser) return lsGetProgress(slug);
  try {
    const snap = await getDocs(collection(db, 'users', auth.currentUser.uid, 'progress'));
    const prefix = `${slug}__m`;
    const done = new Set();
    snap.docs.forEach((d) => {
      if (d.id.startsWith(prefix) && d.data().completed) {
        done.add(Number(d.id.slice(prefix.length)));
      }
    });
    lsSetProgress(slug, done);
    return done;
  } catch (e) {
    console.warn('[course-renderer] progress load failed', e);
    return lsGetProgress(slug);
  }
}

async function markComplete(slug, moduleId, completedSet) {
  completedSet.add(moduleId);
  lsSetProgress(slug, completedSet);
  if (firebaseReady && auth && auth.currentUser) {
    try {
      await setDoc(doc(db, 'users', auth.currentUser.uid, 'progress', progressDocId(slug, moduleId)), {
        completed: true,
        completedAt: serverTimestamp(),
        courseSlug: slug,
        moduleId
      }, { merge: true });
    } catch (e) {
      console.warn('[course-renderer] markComplete remote write failed', e);
    }
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────

export async function mountFirestoreCourse(course, { startAt } = {}) {
  const container = document.getElementById('workspace-player');
  const modules = await loadModuleDocs(course.slug);

  if (modules.length === 0) {
    if (container) {
      container.innerHTML = '<p style="color:var(--gray-mid); padding:24px;">Course content is being prepared. Check back soon.</p>';
    }
    return;
  }

  const completed = await loadCourseProgress(course.slug);
  const purify = await getPurify();

  mountCoursePlayer({
    container,
    courseTitle: String(course.short || course.title || '').toUpperCase(),
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title || `Module ${m.id}`,
      subtitle: m.subtitle || '',
      eyebrow: m.pillar || '',
      duration: m.duration || '',
      meta: [m.duration, m.tagLabel || m.pillar].filter(Boolean).join(' · ')
    })),
    tabs: [{
      id: 'lesson',
      label: 'Lesson',
      html: (pm) => {
        const m = modules.find((x) => x.id === pm.id);
        return `<div class="lesson-body">${purify.sanitize((m && m.html) || '', { USE_PROFILES: { html: true } })}</div>`;
      }
    }],
    progress: {
      isComplete: (id) => completed.has(id),
      markComplete: (id) => markComplete(course.slug, id, completed)
    },
    startAt
  });
}
