// CRM data layer — CRUD for contacts + notes + activities under
// companies/{companyId}/contacts/{contactId}. Matches existing module style
// (CDN modular Firebase, no bundler, graceful when offline).
//
// All mutations that touch a contact also log an activity entry and update
// `lastActivityAt` on the contact so the kanban/list can sort by recency.

import { auth, db, functions, firebaseReady } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, getDocs,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

export const STAGES = [
  { id: 'new',         label: 'New',         color: '#A0A0A0' },
  { id: 'contacted',   label: 'Contacted',   color: '#5AA8E6' },
  { id: 'qualified',   label: 'Qualified',   color: '#9B8CE8' },
  { id: 'negotiating', label: 'Negotiating', color: '#E8C547' },
  { id: 'customer',    label: 'Customer',    color: '#56D4A8' },
  { id: 'lost',        label: 'Lost',        color: '#8B4A4A' }
];
export const STAGE_IDS = STAGES.map((s) => s.id);
export const SOURCES = ['Referral', 'Website', 'Event', 'Other'];

export function stageMeta(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}

function contactsCol(companyId) {
  return collection(db, 'companies', companyId, 'contacts');
}
function contactRef(companyId, contactId) {
  return doc(db, 'companies', companyId, 'contacts', contactId);
}
function notesCol(companyId, contactId) {
  return collection(db, 'companies', companyId, 'contacts', contactId, 'notes');
}
function activitiesCol(companyId, contactId) {
  return collection(db, 'companies', companyId, 'contacts', contactId, 'activities');
}

// ────────────────────────────────────────────────────────────────
// Activity log (client writes; rules enforce shape)
// ────────────────────────────────────────────────────────────────
async function logActivity(companyId, contactId, { type, description, meta }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const payload = {
    type,
    description: description || '',
    actorUid: user.uid,
    actorName: user.displayName || user.email || 'Unknown',
    createdAt: serverTimestamp()
  };
  if (meta && typeof meta === 'object') payload.meta = meta;
  await addDoc(activitiesCol(companyId, contactId), payload);
  // Touch lastActivityAt on the contact.
  try {
    await updateDoc(contactRef(companyId, contactId), {
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (e) { /* contact may be mid-deletion */ }
}

// ────────────────────────────────────────────────────────────────
// Contacts
// ────────────────────────────────────────────────────────────────
export async function listContacts(companyId, { ownerUid = null, stage = null } = {}) {
  if (!firebaseReady || !companyId) return [];
  const parts = [contactsCol(companyId)];
  if (stage) parts.push(where('stage', '==', stage));
  if (ownerUid) parts.push(where('ownerUid', '==', ownerUid));
  parts.push(orderBy('lastActivityAt', 'desc'));
  try {
    const snap = await getDocs(query(...parts));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Fallback: the composite index may not be built yet, or lastActivityAt may be null
    // for freshly-created contacts. Retry with no ordering.
    try {
      const snap = await getDocs(contactsCol(companyId));
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (stage) rows = rows.filter((r) => r.stage === stage);
      if (ownerUid) rows = rows.filter((r) => r.ownerUid === ownerUid);
      rows.sort((a, b) => {
        const ta = a.lastActivityAt && a.lastActivityAt.toMillis ? a.lastActivityAt.toMillis() : 0;
        const tb = b.lastActivityAt && b.lastActivityAt.toMillis ? b.lastActivityAt.toMillis() : 0;
        return tb - ta;
      });
      return rows;
    } catch (e2) {
      console.warn('[crm] listContacts failed', e2);
      return [];
    }
  }
}

export async function getContact(companyId, contactId) {
  if (!firebaseReady || !companyId || !contactId) return null;
  const snap = await getDoc(contactRef(companyId, contactId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function createContact(companyId, data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!companyId) throw new Error('companyId required');
  const stage = STAGE_IDS.includes(data.stage) ? data.stage : 'new';
  const payload = {
    name: (data.name || '').trim() || 'Unnamed contact',
    email: data.email ? data.email.trim() : null,
    phone: data.phone ? data.phone.trim() : null,
    companyName: data.companyName ? data.companyName.trim() : null,
    source: SOURCES.includes(data.source) ? data.source : 'Other',
    stage,
    tags: Array.isArray(data.tags) ? data.tags.filter(Boolean).slice(0, 20) : [],
    ownerUid: data.ownerUid || user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
    lastActivityAt: serverTimestamp()
  };
  const ref = await addDoc(contactsCol(companyId), payload);
  // Log initial activity.
  try {
    await logActivity(companyId, ref.id, {
      type: 'contact_created',
      description: `Created contact ${payload.name}`
    });
  } catch (e) { /* best-effort */ }
  return { id: ref.id, ...payload };
}

export async function updateContact(companyId, contactId, patch = {}) {
  if (!firebaseReady) throw new Error('Offline');
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const allowed = ['name', 'email', 'phone', 'companyName', 'source', 'ownerUid'];
  const clean = {};
  allowed.forEach((k) => {
    if (patch[k] !== undefined) clean[k] = patch[k];
  });
  clean.updatedAt = serverTimestamp();
  clean.lastActivityAt = serverTimestamp();
  await updateDoc(contactRef(companyId, contactId), clean);
}

// Dedicated stage mutator — also logs a stage_changed activity with from/to meta.
export async function changeStage(companyId, contactId, fromStage, toStage) {
  if (!STAGE_IDS.includes(toStage)) throw new Error('Invalid stage');
  await updateDoc(contactRef(companyId, contactId), {
    stage: toStage,
    updatedAt: serverTimestamp(),
    lastActivityAt: serverTimestamp()
  });
  try {
    await logActivity(companyId, contactId, {
      type: 'stage_changed',
      description: `Stage: ${fromStage || '—'} → ${toStage}`,
      meta: { from: fromStage || null, to: toStage }
    });
  } catch (e) { /* best-effort */ }
}

export async function addTag(companyId, contactId, tag) {
  const t = (tag || '').trim();
  if (!t) return;
  const c = await getContact(companyId, contactId);
  if (!c) return;
  const tags = Array.isArray(c.tags) ? c.tags.slice() : [];
  if (tags.includes(t)) return;
  tags.push(t);
  await updateDoc(contactRef(companyId, contactId), {
    tags, updatedAt: serverTimestamp(), lastActivityAt: serverTimestamp()
  });
  try {
    await logActivity(companyId, contactId, {
      type: 'tag_added',
      description: `Tag added: ${t}`,
      meta: { tag: t }
    });
  } catch (e) {}
}

export async function removeTag(companyId, contactId, tag) {
  const c = await getContact(companyId, contactId);
  if (!c) return;
  const tags = (c.tags || []).filter((x) => x !== tag);
  await updateDoc(contactRef(companyId, contactId), {
    tags, updatedAt: serverTimestamp(), lastActivityAt: serverTimestamp()
  });
  try {
    await logActivity(companyId, contactId, {
      type: 'tag_removed',
      description: `Tag removed: ${tag}`,
      meta: { tag }
    });
  } catch (e) {}
}

// Delete via Cloud Function (recursive cascade). Falls back to client-side
// recursion if the callable isn't available.
export async function deleteContact(companyId, contactId) {
  if (!firebaseReady) throw new Error('Offline');
  try {
    const call = httpsCallable(functions, 'deleteContact');
    const res = await call({ companyId, contactId });
    return res.data || { ok: true };
  } catch (e) {
    console.warn('[crm] deleteContact callable failed, falling back to client delete', e);
    // Client fallback — best-effort recursion. Requires rules to permit deletes.
    try {
      const [notes, acts] = await Promise.all([
        getDocs(notesCol(companyId, contactId)),
        getDocs(activitiesCol(companyId, contactId))
      ]);
      await Promise.all([
        ...notes.docs.map((d) => deleteDoc(d.ref)),
        ...acts.docs.map((d) => deleteDoc(d.ref))
      ]);
      await deleteDoc(contactRef(companyId, contactId));
      return { ok: true, clientFallback: true };
    } catch (e2) {
      throw e2;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Notes
// ────────────────────────────────────────────────────────────────
export async function listNotes(companyId, contactId) {
  if (!firebaseReady) return [];
  try {
    const q = query(notesCol(companyId, contactId), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[crm] listNotes failed', e);
    return [];
  }
}

export async function addNote(companyId, contactId, body) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const text = (body || '').trim();
  if (!text) throw new Error('Note body is empty');
  const payload = {
    body: text,
    authorUid: user.uid,
    authorName: user.displayName || user.email || 'Unknown',
    createdAt: serverTimestamp()
  };
  const ref = await addDoc(notesCol(companyId, contactId), payload);
  try {
    await logActivity(companyId, contactId, {
      type: 'note_added',
      description: text.length > 120 ? text.slice(0, 120) + '…' : text
    });
  } catch (e) { /* best-effort */ }
  return { id: ref.id, ...payload };
}

export async function deleteNote(companyId, contactId, noteId) {
  await deleteDoc(doc(db, 'companies', companyId, 'contacts', contactId, 'notes', noteId));
}

// ────────────────────────────────────────────────────────────────
// Activities
// ────────────────────────────────────────────────────────────────
export async function listActivities(companyId, contactId) {
  if (!firebaseReady) return [];
  try {
    const q = query(activitiesCol(companyId, contactId), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[crm] listActivities failed', e);
    return [];
  }
}

// Exposed so the contact-page can log manual interactions (call, meeting, etc).
export async function addManualActivity(companyId, contactId, { type, description, meta }) {
  return logActivity(companyId, contactId, { type, description, meta });
}

// ────────────────────────────────────────────────────────────────
// Company admins list (for the owner dropdown on contact page)
// ────────────────────────────────────────────────────────────────
export async function listCompanyAdmins(companyId) {
  if (!firebaseReady || !companyId) return [];
  try {
    const companySnap = await getDoc(doc(db, 'companies', companyId));
    if (!companySnap.exists()) return [];
    const adminUids = companySnap.data().adminUids || [];
    if (!adminUids.length) return [];
    const members = await getDocs(collection(db, 'companies', companyId, 'members'));
    const byUid = {};
    members.docs.forEach((d) => { byUid[d.id] = d.data(); });
    return adminUids.map((uid) => ({
      uid,
      displayName: (byUid[uid] && byUid[uid].displayName) || null,
      email: (byUid[uid] && byUid[uid].email) || null
    }));
  } catch (e) {
    console.warn('[crm] listCompanyAdmins failed', e);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// Formatting helpers
// ────────────────────────────────────────────────────────────────
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtDate(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    const day = 86400000;
    if (diff < day) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (diff < 7 * day) {
      return Math.floor(diff / day) + 'd ago';
    }
    return d.toLocaleDateString();
  } catch (e) { return '—'; }
}

export function fmtDateTime(ts) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return '—'; }
}
