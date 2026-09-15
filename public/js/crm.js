// CRM data layer — CRUD for contacts + notes + activities under
// companies/{companyId}/contacts/{contactId}. Matches existing module style
// (CDN modular Firebase, no bundler, graceful when offline).
//
// All mutations that touch a contact also log an activity entry and update
// `lastActivityAt` on the contact so the kanban/list can sort by recency.

import { auth, db, functions, firebaseReady } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, limit, getDocs,
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
    // Lowercased on the way in. Every other surface that matches a contact —
    // lead forms, member sync, CSV import — normalizes before comparing, and
    // Firestore equality is case-sensitive, so a capitalized address typed in
    // here used to be invisible to all of them and collect a duplicate.
    email: data.email ? data.email.trim().toLowerCase() : null,
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
  // doNotCall is deliberately NOT here — it goes through setDoNotCall so the
  // consent change always lands in the activity trail.
  const clean = {};
  allowed.forEach((k) => {
    if (patch[k] !== undefined) clean[k] = patch[k];
  });
  // Same normalization as createContact — an edit must not reintroduce the
  // mixed-case address that breaks email matching.
  if (typeof clean.email === 'string') clean.email = clean.email.trim().toLowerCase();
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
/**
 * Do-not-call flag. Kept out of the generic updateContact whitelist on purpose:
 * this is a consent decision, and "who turned it off and when" is exactly the
 * question asked after a complaint. Mirrors how smsOptedOut is recorded by the
 * inbound SMS webhook.
 */
export async function setDoNotCall(companyId, contactId, value) {
  const on = value === true;
  await updateDoc(contactRef(companyId, contactId), {
    doNotCall: on,
    doNotCallAt: on ? serverTimestamp() : null,
    updatedAt: serverTimestamp()
  });
  await logActivity(companyId, contactId, {
    type: on ? 'dnc_added' : 'dnc_removed',
    description: on
      ? 'Added to the do-not-call list.'
      : 'Removed from the do-not-call list.',
    meta: { doNotCall: on }
  });
}

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

// Money formatter for deal values ($). Whole dollars, grouped.
export function fmtMoney(n) {
  const v = Number(n);
  if (!isFinite(v)) return '$0';
  try {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  } catch (e) { return '$' + Math.round(v); }
}

// Returns a JS Date from a Firestore Timestamp | Date | millis | ISO string.
export function toDate(ts) {
  if (!ts) return null;
  try { return ts.toDate ? ts.toDate() : new Date(ts); } catch (e) { return null; }
}

// ════════════════════════════════════════════════════════════════
// PIPELINES — configurable deal stages. The default pipeline is seeded
// from STAGES so existing contact.stage strings keep resolving 1:1.
// ════════════════════════════════════════════════════════════════
export const DEFAULT_PIPELINE_STAGES = [
  { id: 'new',         label: 'New',         color: '#A0A0A0', order: 0, probability: 0.10 },
  { id: 'contacted',   label: 'Contacted',   color: '#5AA8E6', order: 1, probability: 0.25 },
  { id: 'qualified',   label: 'Qualified',   color: '#9B8CE8', order: 2, probability: 0.50 },
  { id: 'negotiating', label: 'Negotiating', color: '#E8C547', order: 3, probability: 0.75 },
  { id: 'customer',    label: 'Won',         color: '#56D4A8', order: 4, probability: 1.00, won: true },
  { id: 'lost',        label: 'Lost',        color: '#8B4A4A', order: 5, probability: 0.00, lost: true }
];

function pipelinesCol(companyId) { return collection(db, 'companies', companyId, 'pipelines'); }
function pipelineRef(companyId, id) { return doc(db, 'companies', companyId, 'pipelines', id); }
function opportunitiesCol(companyId) { return collection(db, 'companies', companyId, 'opportunities'); }
function opportunityRef(companyId, id) { return doc(db, 'companies', companyId, 'opportunities', id); }
function tasksCol(companyId) { return collection(db, 'companies', companyId, 'tasks'); }
function taskRef(companyId, id) { return doc(db, 'companies', companyId, 'tasks', id); }

export async function listPipelines(companyId) {
  if (!firebaseReady || !companyId) return [];
  try {
    const snap = await getDocs(pipelinesCol(companyId));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('[crm] listPipelines failed', e); return []; }
}

// Returns the default pipeline, creating + seeding it on first run.
export async function ensureDefaultPipeline(companyId) {
  if (!firebaseReady || !companyId) return null;
  const existing = await listPipelines(companyId);
  const def = existing.find((p) => p.isDefault) || existing[0];
  if (def) return def;
  const user = auth.currentUser;
  const payload = {
    name: 'Sales Pipeline',
    isDefault: true,
    stages: DEFAULT_PIPELINE_STAGES,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user ? user.uid : null
  };
  const ref = await addDoc(pipelinesCol(companyId), payload);
  return { id: ref.id, ...payload };
}

export async function updatePipeline(companyId, pipelineId, patch = {}) {
  const clean = {};
  if (patch.name !== undefined) clean.name = patch.name;
  if (patch.stages !== undefined) clean.stages = patch.stages;
  clean.updatedAt = serverTimestamp();
  await updateDoc(pipelineRef(companyId, pipelineId), clean);
}

// ════════════════════════════════════════════════════════════════
// OPPORTUNITIES (deals) — carry revenue. Many per contact.
// ════════════════════════════════════════════════════════════════
export async function listOpportunities(companyId, { pipelineId = null, status = null, contactId = null } = {}) {
  if (!firebaseReady || !companyId) return [];
  const parts = [opportunitiesCol(companyId)];
  if (pipelineId) parts.push(where('pipelineId', '==', pipelineId));
  if (status) parts.push(where('status', '==', status));
  if (contactId) parts.push(where('contactId', '==', contactId));
  try {
    const snap = await getDocs(query(...parts));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Index may be building — fall back to unfiltered read + client filter.
    try {
      const snap = await getDocs(opportunitiesCol(companyId));
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (pipelineId) rows = rows.filter((r) => r.pipelineId === pipelineId);
      if (status) rows = rows.filter((r) => r.status === status);
      if (contactId) rows = rows.filter((r) => r.contactId === contactId);
      return rows;
    } catch (e2) { console.warn('[crm] listOpportunities failed', e2); return []; }
  }
}

export async function getOpportunity(companyId, oppId) {
  if (!firebaseReady || !companyId || !oppId) return null;
  const snap = await getDoc(opportunityRef(companyId, oppId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createOpportunity(companyId, data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!companyId) throw new Error('companyId required');
  const payload = {
    title: (data.title || '').trim() || 'Untitled deal',
    contactId: data.contactId || null,
    contactName: data.contactName || null,
    pipelineId: data.pipelineId || null,
    stageId: data.stageId || 'new',
    value: Number(data.value) || 0,
    status: data.status || 'open',
    expectedCloseAt: data.expectedCloseAt || null,
    wonAt: null,
    lostAt: null,
    lostReason: null,
    ownerUid: data.ownerUid || user.uid,
    source: data.source || null,
    stripeSessionId: null,
    amountPaid: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
    lastActivityAt: serverTimestamp()
  };
  const ref = await addDoc(opportunitiesCol(companyId), payload);
  if (payload.contactId) {
    try {
      await logActivity(companyId, payload.contactId, {
        type: 'deal_created',
        description: `Deal created: ${payload.title} (${fmtMoney(payload.value)})`,
        meta: { opportunityId: ref.id, value: payload.value }
      });
    } catch (e) {}
  }
  return { id: ref.id, ...payload };
}

export async function updateOpportunity(companyId, oppId, patch = {}) {
  const allowed = ['title', 'value', 'expectedCloseAt', 'ownerUid', 'source', 'contactId', 'contactName', 'pipelineId'];
  const clean = {};
  allowed.forEach((k) => { if (patch[k] !== undefined) clean[k] = patch[k]; });
  clean.updatedAt = serverTimestamp();
  clean.lastActivityAt = serverTimestamp();
  await updateDoc(opportunityRef(companyId, oppId), clean);
}

// Move a deal to a new stage. Stage flags (won/lost) drive the deal status.
export async function setOppStage(companyId, oppId, { toStageId, fromStageId, toStageLabel, won, lost, contactId } = {}) {
  const patch = {
    stageId: toStageId,
    updatedAt: serverTimestamp(),
    lastActivityAt: serverTimestamp()
  };
  if (won) { patch.status = 'won'; patch.wonAt = serverTimestamp(); }
  else if (lost) { patch.status = 'lost'; patch.lostAt = serverTimestamp(); }
  else { patch.status = 'open'; patch.wonAt = null; patch.lostAt = null; }
  await updateDoc(opportunityRef(companyId, oppId), patch);
  if (contactId) {
    try {
      await logActivity(companyId, contactId, {
        type: won ? 'deal_won' : (lost ? 'deal_lost' : 'deal_stage_changed'),
        description: `Deal stage: ${fromStageId || '—'} → ${toStageLabel || toStageId}`,
        meta: { opportunityId: oppId, from: fromStageId || null, to: toStageId }
      });
    } catch (e) {}
  }
}

export async function deleteOpportunity(companyId, oppId) {
  await deleteDoc(opportunityRef(companyId, oppId));
}

// ════════════════════════════════════════════════════════════════
// TASKS — follow-ups, optionally linked to a contact/opportunity.
// ════════════════════════════════════════════════════════════════
export async function listTasks(companyId, { assigneeUid = null, status = null, contactId = null } = {}) {
  if (!firebaseReady || !companyId) return [];
  const parts = [tasksCol(companyId)];
  if (assigneeUid) parts.push(where('assigneeUid', '==', assigneeUid));
  if (status) parts.push(where('status', '==', status));
  if (contactId) parts.push(where('contactId', '==', contactId));
  try {
    const snap = await getDocs(query(...parts));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    try {
      const snap = await getDocs(tasksCol(companyId));
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (assigneeUid) rows = rows.filter((r) => r.assigneeUid === assigneeUid);
      if (status) rows = rows.filter((r) => r.status === status);
      if (contactId) rows = rows.filter((r) => r.contactId === contactId);
      return rows;
    } catch (e2) { console.warn('[crm] listTasks failed', e2); return []; }
  }
}

export async function createTask(companyId, data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!companyId) throw new Error('companyId required');
  const payload = {
    title: (data.title || '').trim() || 'Untitled task',
    contactId: data.contactId || null,
    contactName: data.contactName || null,
    opportunityId: data.opportunityId || null,
    assigneeUid: data.assigneeUid || user.uid,
    dueAt: data.dueAt || null,
    status: 'open',
    priority: ['low', 'normal', 'high'].includes(data.priority) ? data.priority : 'normal',
    completedAt: null,
    completedByUid: null,
    remindedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid
  };
  const ref = await addDoc(tasksCol(companyId), payload);
  if (payload.contactId) {
    try {
      await logActivity(companyId, payload.contactId, {
        type: 'task_created',
        description: `Task: ${payload.title}`,
        meta: { taskId: ref.id }
      });
    } catch (e) {}
  }
  return { id: ref.id, ...payload };
}

export async function updateTask(companyId, taskId, patch = {}) {
  const allowed = ['title', 'dueAt', 'assigneeUid', 'priority', 'contactId', 'contactName', 'opportunityId'];
  const clean = {};
  allowed.forEach((k) => { if (patch[k] !== undefined) clean[k] = patch[k]; });
  clean.updatedAt = serverTimestamp();
  await updateDoc(taskRef(companyId, taskId), clean);
}

export async function completeTask(companyId, taskId, { contactId, title } = {}) {
  const user = auth.currentUser;
  await updateDoc(taskRef(companyId, taskId), {
    status: 'done',
    completedAt: serverTimestamp(),
    completedByUid: user ? user.uid : null,
    updatedAt: serverTimestamp()
  });
  if (contactId) {
    try {
      await logActivity(companyId, contactId, {
        type: 'task_completed',
        description: `Task completed: ${title || ''}`.trim(),
        meta: { taskId }
      });
    } catch (e) {}
  }
}

export async function reopenTask(companyId, taskId) {
  await updateDoc(taskRef(companyId, taskId), {
    status: 'open', completedAt: null, completedByUid: null, updatedAt: serverTimestamp()
  });
}

export async function deleteTask(companyId, taskId) {
  await deleteDoc(taskRef(companyId, taskId));
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENTS — meetings/bookings, optionally linked to a contact.
// ════════════════════════════════════════════════════════════════
function appointmentsCol(companyId) { return collection(db, 'companies', companyId, 'appointments'); }
function appointmentRef(companyId, id) { return doc(db, 'companies', companyId, 'appointments', id); }

export async function listAppointments(companyId, { contactId = null } = {}) {
  if (!firebaseReady || !companyId) return [];
  const parts = [appointmentsCol(companyId)];
  if (contactId) parts.push(where('contactId', '==', contactId));
  try {
    const snap = await getDocs(query(...parts));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    try {
      const snap = await getDocs(appointmentsCol(companyId));
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (contactId) rows = rows.filter((r) => r.contactId === contactId);
      return rows;
    } catch (e2) { console.warn('[crm] listAppointments failed', e2); return []; }
  }
}

export async function createAppointment(companyId, data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!companyId) throw new Error('companyId required');
  const payload = {
    title: (data.title || '').trim() || 'Appointment',
    contactId: data.contactId || null,
    contactName: data.contactName || null,
    startAt: data.startAt || null,
    durationMin: Number(data.durationMin) || 30,
    location: data.location || null,
    status: 'scheduled',
    ownerUid: data.ownerUid || user.uid,
    notes: data.notes || null,
    remindedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid
  };
  const ref = await addDoc(appointmentsCol(companyId), payload);
  if (payload.contactId) {
    try {
      await logActivity(companyId, payload.contactId, {
        type: 'appointment_created',
        description: `Appointment: ${payload.title}`,
        meta: { appointmentId: ref.id }
      });
    } catch (e) {}
  }
  return { id: ref.id, ...payload };
}

export async function updateAppointment(companyId, apptId, patch = {}) {
  const allowed = ['title', 'startAt', 'durationMin', 'location', 'notes', 'contactId', 'contactName', 'ownerUid'];
  const clean = {};
  allowed.forEach((k) => { if (patch[k] !== undefined) clean[k] = patch[k]; });
  // Rescheduling re-arms the reminder.
  if (patch.startAt !== undefined) clean.remindedAt = null;
  clean.updatedAt = serverTimestamp();
  await updateDoc(appointmentRef(companyId, apptId), clean);
}

export async function setAppointmentStatus(companyId, apptId, status, { contactId } = {}) {
  await updateDoc(appointmentRef(companyId, apptId), { status, updatedAt: serverTimestamp() });
  if (contactId) {
    try {
      await logActivity(companyId, contactId, {
        type: 'appointment_status',
        description: `Appointment ${status}`,
        meta: { appointmentId: apptId, status }
      });
    } catch (e) {}
  }
}

export async function deleteAppointment(companyId, apptId) {
  await deleteDoc(appointmentRef(companyId, apptId));
}

// ════════════════════════════════════════════════════════════════
// SMS conversations (Twilio). Sending goes through the sendSms callable;
// messages are written server-side. Reads are client-side.
// ════════════════════════════════════════════════════════════════
function conversationsCol(companyId) { return collection(db, 'companies', companyId, 'conversations'); }

export async function listConversations(companyId) {
  if (!firebaseReady || !companyId) return [];
  try {
    const snap = await getDocs(query(conversationsCol(companyId), orderBy('lastMessageAt', 'desc')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    try {
      const snap = await getDocs(conversationsCol(companyId));
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => {
        const ta = a.lastMessageAt && a.lastMessageAt.toMillis ? a.lastMessageAt.toMillis() : 0;
        const tb = b.lastMessageAt && b.lastMessageAt.toMillis ? b.lastMessageAt.toMillis() : 0;
        return tb - ta;
      });
      return rows;
    } catch (e2) { console.warn('[crm] listConversations failed', e2); return []; }
  }
}

export async function listMessages(companyId, contactId) {
  if (!firebaseReady || !companyId || !contactId) return [];
  try {
    const col = collection(db, 'companies', companyId, 'conversations', contactId, 'messages');
    const snap = await getDocs(query(col, orderBy('createdAt', 'asc')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('[crm] listMessages failed', e); return []; }
}

export async function sendSms(companyId, contactId, body) {
  if (!firebaseReady) throw new Error('Offline');
  const call = httpsCallable(functions, 'sendSms');
  const res = await call({ companyId, contactId, body });
  return res.data || { ok: true };
}

export async function markConversationRead(companyId, contactId) {
  try {
    await updateDoc(doc(db, 'companies', companyId, 'conversations', contactId), {
      unreadCount: 0, updatedAt: serverTimestamp()
    });
  } catch (e) { /* best-effort */ }
}

// ════════════════════════════════════════════════════════════════
// CALLS — dialer call logs. A call doc is created client-side the moment
// dialing starts (the softphone knows the state before any webhook fires)
// and is then enriched server-side by voiceStatusWebhook with the duration
// and recording URL. Every completed call also lands in the contact's
// activity feed, so the timeline stays the one place to read a lead's
// history regardless of which surface the call was placed from.
// ════════════════════════════════════════════════════════════════

/**
 * Dispositions are required — a call with no outcome is a call that didn't
 * happen as far as the pipeline is concerned. `advanceTo` moves the contact's
 * stage when the outcome implies it; `followUp` asks the UI to open the task
 * or appointment modal straight after logging.
 */
export const CALL_DISPOSITIONS = [
  { id: 'connected',      label: 'Connected',      key: '1', advanceTo: 'contacted' },
  { id: 'booked',         label: 'Booked',         key: '2', advanceTo: 'qualified', followUp: 'appointment' },
  { id: 'callback',       label: 'Callback',       key: '3', advanceTo: 'contacted', followUp: 'task' },
  { id: 'voicemail',      label: 'Voicemail',      key: '4', advanceTo: 'contacted' },
  { id: 'no_answer',      label: 'No answer',      key: '5' },
  { id: 'not_interested', label: 'Not interested', key: '6', advanceTo: 'lost' },
  { id: 'bad_number',     label: 'Bad number',     key: '7' }
];
export const DISPOSITION_IDS = CALL_DISPOSITIONS.map((d) => d.id);

export function dispositionMeta(id) {
  return CALL_DISPOSITIONS.find((d) => d.id === id) || null;
}

function callsCol(companyId) { return collection(db, 'companies', companyId, 'calls'); }
function callRef(companyId, callId) { return doc(db, 'companies', companyId, 'calls', callId); }

export async function listCalls(companyId, { contactId = null, agentUid = null, max = 50 } = {}) {
  if (!firebaseReady || !companyId) return [];
  const parts = [callsCol(companyId)];
  if (contactId) parts.push(where('contactId', '==', contactId));
  if (agentUid) parts.push(where('agentUid', '==', agentUid));
  parts.push(orderBy('createdAt', 'desc'), limit(max));
  try {
    const snap = await getDocs(query(...parts));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Same fallback the rest of this module uses: the composite index may not
    // be built yet, and createdAt is null for a call still being written.
    try {
      const snap = await getDocs(callsCol(companyId));
      let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (contactId) rows = rows.filter((r) => r.contactId === contactId);
      if (agentUid) rows = rows.filter((r) => r.agentUid === agentUid);
      rows.sort((a, b) => {
        const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
      return rows.slice(0, max);
    } catch (e2) { console.warn('[crm] listCalls failed', e2); return []; }
  }
}

export async function createCallLog(companyId, data = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!companyId) throw new Error('companyId required');
  const payload = {
    contactId: data.contactId || null,
    contactName: data.contactName || null,
    contactPhone: data.contactPhone || null,
    direction: data.direction === 'in' ? 'in' : 'out',
    mode: ['softphone', 'bridge', 'manual'].includes(data.mode) ? data.mode : 'manual',
    status: data.status || 'queued',
    disposition: null,
    dispositionNote: null,
    twilioCallSid: data.twilioCallSid || null,
    durationSec: null,
    agentUid: user.uid,
    agentName: user.displayName || user.email || 'Unknown',
    startedAt: data.startedAt || serverTimestamp(),
    endedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = await addDoc(callsCol(companyId), payload);
  return { id: ref.id, ...payload };
}

export async function updateCallLog(companyId, callId, patch = {}) {
  // recordingUrl / recordingStatus are deliberately absent: the rules reject
  // them from a client, because they end up in an <audio src> on the timeline.
  const allowed = ['status', 'twilioCallSid', 'durationSec', 'endedAt', 'mode', 'contactPhone'];
  const clean = {};
  allowed.forEach((k) => { if (patch[k] !== undefined) clean[k] = patch[k]; });
  if (!Object.keys(clean).length) return;
  clean.updatedAt = serverTimestamp();
  await updateDoc(callRef(companyId, callId), clean);
}

/**
 * Close out a call. Writes the outcome onto the call doc and mirrors it into
 * the contact's activity feed via the same logActivity path every other
 * mutation uses, so `lastActivityAt` stays honest and the dialer's "coldest
 * first" ordering keeps working.
 */
export async function setCallDisposition(companyId, callId, { disposition, note, contactId, durationSec } = {}) {
  if (!DISPOSITION_IDS.includes(disposition)) throw new Error('Unknown disposition');
  const patch = {
    disposition,
    dispositionNote: (note || '').trim() || null,
    updatedAt: serverTimestamp()
  };
  if (durationSec != null) patch.durationSec = Number(durationSec) || 0;
  await updateDoc(callRef(companyId, callId), patch);
  if (contactId) {
    const meta = dispositionMeta(disposition);
    const mins = durationSec ? ` (${Math.floor(durationSec / 60)}m ${durationSec % 60}s)` : '';
    try {
      await logActivity(companyId, contactId, {
        type: 'call_logged',
        description: `Call — ${meta ? meta.label : disposition}${mins}${patch.dispositionNote ? ': ' + patch.dispositionNote : ''}`,
        meta: { callId, disposition, durationSec: durationSec || null }
      });
    } catch (e) { /* the contact may have been deleted mid-call */ }
  }
}

export async function deleteCallLog(companyId, callId) {
  await deleteDoc(callRef(companyId, callId));
}

// ────────────────────────────────────────────────────────────────
// Voice callables. Each one throws a readable error when Twilio Voice is not
// configured yet; dialer-core.js turns that into the "not set up" dock state
// rather than letting it surface as an unhandled rejection.
// ────────────────────────────────────────────────────────────────

export async function getVoiceToken(companyId) {
  if (!firebaseReady) throw new Error('Offline');
  const call = httpsCallable(functions, 'getVoiceToken');
  const res = await call({ companyId });
  return res.data;
}

export async function startBridgeCall(companyId, contactId, callId) {
  if (!firebaseReady) throw new Error('Offline');
  const call = httpsCallable(functions, 'startBridgeCall');
  const res = await call({ companyId, contactId, callId });
  return res.data;
}

export async function dropVoicemail(companyId, callSid, dropId) {
  if (!firebaseReady) throw new Error('Offline');
  const call = httpsCallable(functions, 'dropVoicemail');
  const res = await call({ companyId, callSid, dropId });
  return res.data;
}

// ────────────────────────────────────────────────────────────────
// Dialer configuration. Company-wide settings (recording mode, quiet hours,
// caller ID) live on the company doc — admins can already update it, so this
// needs no new rules and no extra read on every page. Per-agent preferences
// (softphone vs. cell bridge, and the cell number) live on users/{uid},
// which the user may already self-update.
// ────────────────────────────────────────────────────────────────

export const DEFAULT_DIALER_SETTINGS = {
  recordingMode: 'off',        // 'off' | 'announce' | 'on'
  quietHoursEnabled: true,
  quietHoursStart: 21,         // local hour after which calling is discouraged
  quietHoursEnd: 8,            // local hour before which calling is discouraged
  autoAdvanceSec: 3
};

export async function getDialerSettings(companyId) {
  if (!firebaseReady || !companyId) return { ...DEFAULT_DIALER_SETTINGS };
  try {
    const snap = await getDoc(doc(db, 'companies', companyId));
    const d = snap.exists() ? (snap.data().dialer || {}) : {};
    return { ...DEFAULT_DIALER_SETTINGS, ...d };
  } catch (e) { return { ...DEFAULT_DIALER_SETTINGS }; }
}

export async function updateDialerSettings(companyId, patch = {}) {
  const clean = {};
  Object.keys(DEFAULT_DIALER_SETTINGS).forEach((k) => {
    if (patch[k] !== undefined) clean[`dialer.${k}`] = patch[k];
  });
  if (!Object.keys(clean).length) return;
  await updateDoc(doc(db, 'companies', companyId), clean);
}

export async function getAgentPrefs(uid) {
  if (!firebaseReady || !uid) return { callMode: 'softphone', mobilePhone: null };
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const d = snap.exists() ? snap.data() : {};
    return {
      callMode: d.callMode === 'bridge' ? 'bridge' : 'softphone',
      mobilePhone: d.mobilePhone || null
    };
  } catch (e) { return { callMode: 'softphone', mobilePhone: null }; }
}

export async function updateAgentPrefs(uid, patch = {}) {
  const clean = {};
  if (patch.callMode !== undefined) clean.callMode = patch.callMode === 'bridge' ? 'bridge' : 'softphone';
  if (patch.mobilePhone !== undefined) clean.mobilePhone = (patch.mobilePhone || '').trim() || null;
  if (!Object.keys(clean).length) return;
  await setDoc(doc(db, 'users', uid), clean, { merge: true });
}

/**
 * TCPA quiet hours. Returns a reason string when the given time is outside
 * the allowed window, or null when it is fine to dial. The UI asks for an
 * explicit confirm rather than blocking outright — the rule is about consent,
 * and a returned call the lead asked for at 9pm is legitimate.
 *
 * Note this uses the AGENT's local clock. Per-contact timezone would be more
 * correct, but the contact record has no timezone field today and guessing one
 * from an area code is worse than being honest about the limitation.
 */
export function quietHoursWarning(settings, when = new Date()) {
  const s = { ...DEFAULT_DIALER_SETTINGS, ...(settings || {}) };
  if (!s.quietHoursEnabled) return null;
  const h = when.getHours();
  const start = Number(s.quietHoursStart);
  const end = Number(s.quietHoursEnd);
  const inside = start > end ? (h >= start || h < end) : (h >= start && h < end);
  if (!inside) return null;
  return `It is ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} locally, inside your quiet hours (${start}:00–${end}:00).`;
}

/** Can this contact be called at all? Mirrors the smsOptedOut guard. */
export function callBlockReason(contact) {
  if (!contact) return 'No contact selected.';
  if (contact.doNotCall === true) return 'This contact is on your do-not-call list.';
  if (!contact.phone) return 'This contact has no phone number.';
  return null;
}
