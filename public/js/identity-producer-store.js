// The Identity of A Producer — course-scoped progress + notes store.
//
// Parallel to ./store.js (1P-CLC) and ./trust-process-store.js. Namespaced so
// nothing collides:
//   localStorage state key:   `identity_producer_state`
//   localStorage notes prefix: `ip_note_`
//   Firestore progress docs:   users/{uid}/progress/ip_<id>
//   User doc fields:           ipCurrentModule
//   Company member digest:     ipCompletedCount / ipCurrentModule
//
// No firestore.rules change — the existing /progress/{moduleId} wildcard
// accepts the ip_ prefix, and the existing /members/{mUid} rule already
// allows the user to update their own digest.

import { auth, db, firebaseReady } from './firebase.js';
import {
  doc, getDoc, setDoc, collection, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const STATE_KEY = 'identity_producer_state';
const NOTE_PREFIX = 'ip_note_';
const PROGRESS_PREFIX = 'ip_';

function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }

function loadLocalState() {
  try {
    const raw = lsGet(STATE_KEY);
    if (!raw) return { current: 0, completed: [] };
    const p = JSON.parse(raw);
    return { current: p.current || 0, completed: p.completed || [] };
  } catch (e) { return { current: 0, completed: [] }; }
}

function saveLocalState(current, completedArr) {
  lsSet(STATE_KEY, JSON.stringify({ current, completed: completedArr }));
}

function activeUser() {
  if (!firebaseReady || !auth) return null;
  return auth.currentUser || null;
}

const _notes = {};

function docIdForLesson(id) { return PROGRESS_PREFIX + id; }
function lessonIdFromDocId(docId) {
  if (!docId || !docId.startsWith(PROGRESS_PREFIX)) return null;
  const n = Number(docId.slice(PROGRESS_PREFIX.length));
  return Number.isFinite(n) ? n : null;
}

export const store = {
  currentModule: 0,
  completed: new Set(),
  _loaded: false,
  _remoteUid: null,

  async load() {
    const local = loadLocalState();
    this.currentModule = local.current;
    this.completed = new Set(local.completed);

    const user = activeUser();
    if (!user) {
      this._loaded = true;
      this._remoteUid = null;
      return;
    }

    try {
      const progressCol = collection(db, 'users', user.uid, 'progress');
      const progressSnap = await getDocs(progressCol);

      const remoteCompleted = new Set();
      const remoteNotes = {};
      let hasAnyProgress = false;
      progressSnap.forEach((d) => {
        const lid = lessonIdFromDocId(d.id);
        if (lid == null) return; // foreign (1P-CLC or TP) — ignore.
        hasAnyProgress = true;
        const data = d.data() || {};
        if (data.completed) remoteCompleted.add(lid);
        if (typeof data.notes === 'string' && data.notes.length) {
          remoteNotes[String(lid)] = data.notes;
        }
      });

      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);
      const currentFromUserDoc = userSnap.exists() && typeof userSnap.data().ipCurrentModule === 'number'
        ? userSnap.data().ipCurrentModule
        : null;

      if (!hasAnyProgress && local.completed.length) {
        await this._migrateLocalToRemote(user.uid, local);
        this.currentModule = local.current;
        this.completed = new Set(local.completed);
      } else {
        this.completed = remoteCompleted;
        this.currentModule = currentFromUserDoc != null ? currentFromUserDoc : local.current;
        Object.keys(remoteNotes).forEach((k) => { _notes[`ip_m_${k}`] = remoteNotes[k]; });
      }

      this._remoteUid = user.uid;
      this._loaded = true;
      saveLocalState(this.currentModule, Array.from(this.completed));
    } catch (e) {
      console.warn('[ip-store] remote load failed, falling back to localStorage:', e);
      this._loaded = true;
    }
  },

  async _migrateLocalToRemote(uid, local) {
    try {
      const writes = [];
      const completedSet = new Set(local.completed);
      for (const id of completedSet) {
        writes.push(setDoc(doc(db, 'users', uid, 'progress', docIdForLesson(id)), {
          completed: true,
          completedAt: serverTimestamp()
        }, { merge: true }));
      }
      writes.push(setDoc(doc(db, 'users', uid), {
        ipCurrentModule: local.current,
        lastActiveAt: serverTimestamp()
      }, { merge: true }));
      await Promise.all(writes);
    } catch (e) {
      console.warn('[ip-store] migration failed:', e);
    }
  },

  setCurrent(id) {
    this.currentModule = id;
    saveLocalState(this.currentModule, Array.from(this.completed));
    const user = activeUser();
    if (user) {
      setDoc(doc(db, 'users', user.uid), {
        ipCurrentModule: id,
        lastActiveAt: serverTimestamp()
      }, { merge: true }).catch((e) => console.warn('[ip-store] setCurrent remote write:', e));
      this._mirrorMemberDigest(user);
    }
  },

  markComplete(id) {
    this.completed.add(id);
    saveLocalState(this.currentModule, Array.from(this.completed));
    const user = activeUser();
    if (user) {
      setDoc(doc(db, 'users', user.uid, 'progress', docIdForLesson(id)), {
        completed: true,
        completedAt: serverTimestamp()
      }, { merge: true }).catch((e) => console.warn('[ip-store] markComplete remote write:', e));
      setDoc(doc(db, 'users', user.uid), {
        lastActiveAt: serverTimestamp(),
        ipCurrentModule: this.currentModule
      }, { merge: true }).catch(() => {});
      this._mirrorMemberDigest(user);
    }
  },

  async _mirrorMemberDigest(user) {
    try {
      const uDoc = await getDoc(doc(db, 'users', user.uid));
      if (!uDoc.exists()) return;
      const data = uDoc.data();
      const companyId = data.companyId;
      if (!companyId) return;
      await setDoc(doc(db, 'companies', companyId, 'members', user.uid), {
        uid: user.uid,
        ipCompletedCount: this.completed.size,
        ipCurrentModule: this.currentModule,
        lastActiveAt: serverTimestamp()
      }, { merge: true });
    } catch (e) { /* best-effort */ }
  },

  isComplete(id) { return this.completed.has(id); }
};

export function saveNote(key, val) {
  _notes[key] = val;
  lsSet(NOTE_PREFIX + key, val);
  const user = activeUser();
  if (!user) return;

  // Key shapes accepted:
  //   ip_<id>         → whole-lesson note on progress/ip_<id>.notes
  //   ip_<id>_<slot>  → slotted note under progress/ip_<id>.noteSlots.<slot>
  const lessonMatch = key.match(/^ip_(\d+)(?:_(.+))?$/);
  if (!lessonMatch) return;
  const id = lessonMatch[1];
  const sub = lessonMatch[2];
  const docRef = doc(db, 'users', user.uid, 'progress', docIdForLesson(id));
  if (sub) {
    setDoc(docRef, { noteSlots: { [sub]: val } }, { merge: true })
      .catch((e) => console.warn('[ip-store] saveNote sub remote write:', e));
  } else {
    setDoc(docRef, { notes: val }, { merge: true })
      .catch((e) => console.warn('[ip-store] saveNote remote write:', e));
  }
}

export function getNotes(key) {
  if (_notes[key] != null) return _notes[key];
  const v = lsGet(NOTE_PREFIX + key);
  if (v != null) _notes[key] = v;
  return v || '';
}
