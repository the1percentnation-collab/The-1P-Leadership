// 1P Certified Leader Coach — course adapter.
// Lesson content lives in modules.js; the workspace shell is the shared
// Coursera-style player (course-player.js) so every course looks identical.
// Exposed as `mount()` so courses-page.js can initialise it when active.

import { store, saveNote } from './store.js';
import { MODULES } from './modules.js';
import { onAuthReady } from './auth.js';
import { firebaseReady } from './firebase.js';
import { mountCoursePlayer } from './course-player.js';

function bindNotes(root) {
  root.querySelectorAll('[data-note-key]').forEach((el) => {
    el.addEventListener('input', (e) => saveNote(el.dataset.noteKey, e.target.value));
  });
}

export async function mount({ startAt } = {}) {
  // Auth check — courses-page.js also does this, but guard for direct entry.
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  }

  await store.load();

  const requested = typeof startAt === 'number' && startAt >= 0 && startAt < MODULES.length
    ? startAt
    : store.currentModule;

  mountCoursePlayer({
    courseTitle: '1P CERTIFIED LEADER COACH',
    modules: MODULES.map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: m.subtitle,
      eyebrow: m.pillar,
      duration: m.duration,
      meta: `${m.duration} · ${m.pillar}`
    })),
    tabs: [{
      id: 'lesson',
      label: 'Lesson',
      html: (pm) => MODULES.find((m) => m.id === pm.id).render(),
      bind: (root) => {
        // The player header already shows the module title — drop the
        // duplicated big heading from the legacy lesson markup, keep the desc.
        root.querySelectorAll('.module-header .module-eyebrow, .module-header .module-title')
          .forEach((el) => el.remove());
        bindNotes(root);
      }
    }],
    progress: {
      isComplete: (id) => store.isComplete(id),
      markComplete: async (id) => { store.markComplete(id); },
      onNavigate: (id) => store.setCurrent(id)
    },
    labels: {
      completeLast: 'Submit for Certification →',
      completedLast: '✓ Certification Submitted'
    },
    startAt: requested
  });
}
