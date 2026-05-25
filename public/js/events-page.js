// /events.html — community events list + admin create/edit modal + signups.
//
// Storage: events/{eventId} (top-level). Reads open to any signed-in user;
// writes are owner/admin only (Firestore rules). Registrations live under
// events/{eventId}/signups/{signupId} and are written exclusively by the
// registerForEvent Cloud Function, which also mirrors each registrant into
// the event's company CRM (companies/{companyId}/contacts).

import { auth, db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { getUserProfile, escapeHtml, fmtRelative } from './community.js';
import { renderTopbar } from './topbar.js';
import {
  collection, doc, getDoc, getDocs, query, orderBy, where, limit,
  setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  role: null,
  isAdmin: false,
  companyId: null,      // creator's resolved company (admins) — used as event default
  companies: [],        // owner-only: list of companies for the picker
  events: [],
  myRsvps: {},          // eventId -> true if current user is registered
  filter: 'upcoming'
};

function fmtEventDate(ts) {
  if (!ts) return 'TBA';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return 'TBA';
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

function registrationLink(eventId) {
  return `${location.origin}/event.html?id=${encodeURIComponent(eventId)}`;
}

async function resolveCreatorCompany(uid, info) {
  if (info.companyId) return info.companyId;
  if (info.isAdmin) {
    try {
      const snap = await getDocs(query(
        collection(db, 'companies'), where('adminUids', 'array-contains', uid), limit(1)));
      if (!snap.empty) return snap.docs[0].id;
    } catch (e) { /* tolerated */ }
  }
  return null;
}

async function loadCompaniesForOwner() {
  if (state.role !== 'owner') return;
  try {
    const snap = await getDocs(collection(db, 'companies'));
    state.companies = snap.docs.map((d) => ({ id: d.id, name: (d.data() && d.data().name) || d.id }));
  } catch (e) {
    console.warn('[events] company list failed', e);
  }
}

async function loadEvents() {
  state.events = [];
  if (!firebaseReady) return;
  try {
    const snap = await getDocs(query(collection(db, 'events'), orderBy('startsAt', 'desc'), limit(50)));
    state.events = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('[events] load failed', err);
  }
}

// For non-admin members, look up whether they've registered for each event
// with signups enabled (their signup doc id == their uid).
async function loadMyRsvps() {
  state.myRsvps = {};
  if (!state.me || state.isAdmin) return;
  const targets = state.events.filter((e) => e.signupsEnabled !== false);
  await Promise.all(targets.map(async (e) => {
    try {
      const s = await getDoc(doc(db, 'events', e.id, 'signups', state.me.uid));
      if (s.exists()) state.myRsvps[e.id] = true;
    } catch (err) { /* rules deny non-self reads — ignore */ }
  }));
}

function signupAreaHtml(e) {
  if (e.signupsEnabled === false) return '';
  const count = Number(e.signupCount || 0);
  const cap = Number(e.capacity || 0);
  const full = cap > 0 && count >= cap;
  const countLabel = cap > 0 ? `${count}/${cap} registered` : `${count} registered`;

  if (state.isAdmin) {
    return `
      <div class="c-event-signups">
        <span class="c-event-count">${escapeHtml(countLabel)}</span>
        <button class="btn btn-ghost c-event-mini" data-signups="${escapeHtml(e.id)}">View signups</button>
        <button class="btn btn-ghost c-event-mini" data-copy="${escapeHtml(e.id)}">Copy link</button>
      </div>`;
  }

  const registered = !!state.myRsvps[e.id];
  if (registered) {
    return `<div class="c-event-signups"><span class="c-event-going">✓ You're going</span></div>`;
  }
  if (full) {
    return `<div class="c-event-signups"><span class="c-event-count">Event full</span></div>`;
  }
  return `
    <div class="c-event-signups">
      <button class="btn btn-primary c-event-mini" data-rsvp="${escapeHtml(e.id)}">RSVP</button>
    </div>`;
}

function eventCardHtml(e) {
  const canEdit = state.isAdmin;
  const linkBtn = e.link
    ? `<a class="btn btn-primary c-event-cta" href="${escapeHtml(e.link)}" target="_blank" rel="noopener">Join →</a>`
    : '';
  const editBtn = canEdit
    ? `<button class="c-event-edit" data-edit="${escapeHtml(e.id)}" title="Edit">✎</button>
       <button class="c-event-del" data-del="${escapeHtml(e.id)}" title="Delete">✕</button>`
    : '';
  return `
    <article class="c-event-card" data-event="${escapeHtml(e.id)}">
      <div class="c-event-date">${escapeHtml(fmtEventDate(e.startsAt))}</div>
      <div class="c-event-body">
        <div class="c-event-title">${escapeHtml(e.title || 'Untitled event')}</div>
        ${e.hostName ? `<div class="c-event-host">Hosted by ${escapeHtml(e.hostName)}</div>` : ''}
        ${e.description ? `<div class="c-event-desc">${escapeHtml(e.description)}</div>` : ''}
        ${e.location ? `<div class="c-event-loc">📍 ${escapeHtml(e.location)}</div>` : ''}
        ${signupAreaHtml(e)}
      </div>
      <div class="c-event-actions">
        ${linkBtn}
        ${editBtn}
      </div>
    </article>
  `;
}

function renderList() {
  const root = $('events-list');
  const emptyEl = $('events-empty');
  if (!root || !emptyEl) return;

  const now = Date.now();
  const filtered = state.events.filter((e) => {
    const ts = e.startsAt && e.startsAt.toMillis ? e.startsAt.toMillis() : 0;
    if (!ts) return state.filter === 'upcoming'; // undated → bucket with upcoming
    return state.filter === 'upcoming' ? ts >= now : ts < now;
  }).sort((a, b) => {
    const at = a.startsAt && a.startsAt.toMillis ? a.startsAt.toMillis() : 0;
    const bt = b.startsAt && b.startsAt.toMillis ? b.startsAt.toMillis() : 0;
    return state.filter === 'upcoming' ? at - bt : bt - at;
  });

  if (!filtered.length) {
    root.innerHTML = '';
    emptyEl.hidden = false;
    emptyEl.innerHTML = `
      <div class="c-empty-art" aria-hidden="true">📅</div>
      <div class="c-empty-title">${state.filter === 'upcoming' ? 'No upcoming events' : 'No past events'}</div>
      <p class="c-empty-body">${state.filter === 'upcoming'
        ? 'Check back soon, or ask an organizer to schedule the next one.'
        : 'Past events will appear here once they wrap.'}</p>
      ${state.isAdmin
        ? `<button class="btn btn-primary c-empty-cta" id="empty-new-event">Schedule an event</button>`
        : ''}
    `;
    const btn = $('empty-new-event');
    if (btn) btn.addEventListener('click', () => openEventModal());
    return;
  }

  emptyEl.hidden = true;
  root.innerHTML = filtered.map(eventCardHtml).join('');
  bindCardActions(root);
}

function bindCardActions(root) {
  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.del;
      if (!confirm('Delete this event? Its signups will be removed too.')) return;
      try {
        await deleteDoc(doc(db, 'events', id));
        state.events = state.events.filter((ev) => ev.id !== id);
        renderList();
      } catch (err) {
        alert('Could not delete: ' + (err.message || err));
      }
    });
  });

  root.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ev = state.events.find((x) => x.id === btn.dataset.edit);
      if (ev) openEventModal(ev);
    });
  });

  root.querySelectorAll('[data-rsvp]').forEach((btn) => {
    btn.addEventListener('click', () => rsvpAsMember(btn.dataset.rsvp, btn));
  });

  root.querySelectorAll('[data-signups]').forEach((btn) => {
    btn.addEventListener('click', () => openSignupsModal(btn.dataset.signups));
  });

  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const link = registrationLink(btn.dataset.copy);
      try {
        await navigator.clipboard.writeText(link);
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      } catch (e) {
        prompt('Copy this registration link:', link);
      }
    });
  });
}

async function rsvpAsMember(eventId, btn) {
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const call = httpsCallable(functions, 'registerForEvent');
    await call({ eventId });
    state.myRsvps[eventId] = true;
    const ev = state.events.find((x) => x.id === eventId);
    if (ev) ev.signupCount = Number(ev.signupCount || 0) + 1;
    renderList();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'RSVP';
    alert(err.message || 'Could not RSVP.');
  }
}

function bindToolbar() {
  document.querySelectorAll('.c-events-tab').forEach((b) => {
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll('.c-events-tab').forEach((x) =>
        x.classList.toggle('is-active', x === b));
      renderList();
    });
  });
  const newBtn = $('btn-new-event');
  if (newBtn) newBtn.addEventListener('click', () => openEventModal());
}

// ────────────────────────────────────────────────────────────────
// Create / edit modal
// ────────────────────────────────────────────────────────────────
function companyFieldHtml(prefill) {
  const selected = prefill ? (prefill.companyId || '') : (state.companyId || '');
  if (state.role === 'owner') {
    const opts = ['<option value="">— No CRM (signups not captured) —</option>']
      .concat(state.companies.map((c) =>
        `<option value="${escapeHtml(c.id)}" ${c.id === selected ? 'selected' : ''}>${escapeHtml(c.name)}</option>`))
      .join('');
    return `
      <label class="c-invite-label" for="c-ev-company">Capture signups into CRM</label>
      <select id="c-ev-company" class="c-ch-input">${opts}</select>`;
  }
  // Admins: company is fixed to theirs; carried via hidden input.
  return `<input type="hidden" id="c-ev-company" value="${escapeHtml(selected)}">`;
}

function openEventModal(prefill = null) {
  if (document.getElementById('c-event-modal')) return;
  const signupsOn = prefill ? (prefill.signupsEnabled !== false) : true;
  const overlay = document.createElement('div');
  overlay.className = 'c-modal-overlay';
  overlay.id = 'c-event-modal';
  overlay.innerHTML = `
    <div class="c-modal" role="dialog" aria-modal="true">
      <button class="c-modal-close" id="c-event-close" aria-label="Close">✕</button>
      <h2 class="c-modal-title">${prefill ? 'Edit event' : 'Schedule event'}</h2>
      <p class="c-modal-sub">Visible to all signed-in members.</p>
      <div class="c-modal-body">
        <label class="c-invite-label" for="c-ev-title">Title</label>
        <input id="c-ev-title" class="c-ch-input" type="text" maxlength="80" value="${escapeHtml(prefill ? prefill.title : '')}">

        <label class="c-invite-label" for="c-ev-when">Date &amp; time</label>
        <input id="c-ev-when" class="c-ch-input" type="datetime-local">

        <label class="c-invite-label" for="c-ev-host">Host name</label>
        <input id="c-ev-host" class="c-ch-input" type="text" maxlength="60" value="${escapeHtml(prefill ? (prefill.hostName || '') : (state.me ? state.me.displayName || '' : ''))}">

        <label class="c-invite-label" for="c-ev-link">Join link (optional)</label>
        <input id="c-ev-link" class="c-ch-input" type="url" placeholder="https://zoom.us/j/...">

        <label class="c-invite-label" for="c-ev-loc">Location (optional)</label>
        <input id="c-ev-loc" class="c-ch-input" type="text" maxlength="120" placeholder="Online · Zoom · 123 Main St">

        <label class="c-invite-label" for="c-ev-desc">Description (optional)</label>
        <textarea id="c-ev-desc" class="c-ch-input" rows="3" maxlength="600"></textarea>

        <label class="c-ev-check">
          <input type="checkbox" id="c-ev-signups" ${signupsOn ? 'checked' : ''}>
          Allow signups / RSVPs
        </label>

        <label class="c-invite-label" for="c-ev-cap">Capacity (optional, 0 = unlimited)</label>
        <input id="c-ev-cap" class="c-ch-input" type="number" min="0" step="1" value="${prefill && prefill.capacity ? Number(prefill.capacity) : ''}" placeholder="0">

        ${companyFieldHtml(prefill)}

        <div class="c-invite-actions">
          <button class="btn btn-primary" id="c-ev-save">${prefill ? 'Save' : 'Create event'}</button>
          <button class="btn btn-ghost" id="c-ev-cancel">Cancel</button>
        </div>
        <div class="auth-error" id="c-ev-err" style="display:none;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  if (prefill && prefill.startsAt && prefill.startsAt.toDate) {
    const d = prefill.startsAt.toDate();
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $('c-ev-when').value = local;
  }
  if (prefill) {
    $('c-ev-link').value = prefill.link || '';
    $('c-ev-loc').value = prefill.location || '';
    $('c-ev-desc').value = prefill.description || '';
  }

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('c-event-close').addEventListener('click', close);
  $('c-ev-cancel').addEventListener('click', close);
  setTimeout(() => $('c-ev-title').focus(), 0);

  $('c-ev-save').addEventListener('click', async () => {
    const errEl = $('c-ev-err');
    errEl.style.display = 'none';
    const title = $('c-ev-title').value.trim();
    const whenStr = $('c-ev-when').value;
    const host = $('c-ev-host').value.trim();
    const link = $('c-ev-link').value.trim();
    const loc = $('c-ev-loc').value.trim();
    const desc = $('c-ev-desc').value.trim();
    const signupsEnabled = $('c-ev-signups').checked;
    const capRaw = parseInt($('c-ev-cap').value, 10);
    const capacity = Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null;
    const companyId = ($('c-ev-company') && $('c-ev-company').value) || null;

    if (!title) {
      errEl.textContent = 'Title is required.';
      errEl.style.display = 'block';
      return;
    }
    if (!whenStr) {
      errEl.textContent = 'Date and time are required.';
      errEl.style.display = 'block';
      return;
    }
    const when = new Date(whenStr);
    if (isNaN(when.getTime())) {
      errEl.textContent = 'Could not parse the date.';
      errEl.style.display = 'block';
      return;
    }

    const btn = $('c-ev-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const id = (prefill && prefill.id) || `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      await setDoc(doc(db, 'events', id), {
        id,
        title,
        startsAt: when,
        hostName: host || null,
        hostUid: state.me ? state.me.uid : null,
        link: link || null,
        location: loc || null,
        description: desc || null,
        signupsEnabled,
        capacity,
        companyId: companyId || null,
        updatedAt: serverTimestamp(),
        ...(prefill ? {} : {
          signupCount: 0,
          createdAt: serverTimestamp(),
          createdByUid: state.me ? state.me.uid : null
        })
      }, { merge: true });
      close();
      await loadEvents();
      await loadMyRsvps();
      renderList();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = prefill ? 'Save' : 'Create event';
      errEl.textContent = err.message || 'Could not save event.';
      errEl.style.display = 'block';
    }
  });
}

// ────────────────────────────────────────────────────────────────
// Signups viewer (admin)
// ────────────────────────────────────────────────────────────────
async function openSignupsModal(eventId) {
  if (document.getElementById('c-signups-modal')) return;
  const ev = state.events.find((x) => x.id === eventId);
  const overlay = document.createElement('div');
  overlay.className = 'c-modal-overlay';
  overlay.id = 'c-signups-modal';
  overlay.innerHTML = `
    <div class="c-modal" role="dialog" aria-modal="true">
      <button class="c-modal-close" id="c-su-close" aria-label="Close">✕</button>
      <h2 class="c-modal-title">Signups</h2>
      <p class="c-modal-sub">${escapeHtml(ev ? (ev.title || 'Event') : 'Event')}</p>
      <div class="c-modal-body">
        <div class="c-su-link">
          <input class="c-ch-input" id="c-su-linkfield" type="text" readonly value="${escapeHtml(registrationLink(eventId))}">
          <button class="btn btn-ghost c-event-mini" id="c-su-copy">Copy</button>
        </div>
        <div id="c-su-list" class="c-su-list"><div class="c-su-empty">Loading…</div></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  $('c-su-close').addEventListener('click', close);
  $('c-su-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(registrationLink(eventId)); $('c-su-copy').textContent = 'Copied!'; }
    catch (e) { $('c-su-linkfield').select(); }
  });

  const listEl = $('c-su-list');
  try {
    const snap = await getDocs(query(
      collection(db, 'events', eventId, 'signups'), orderBy('createdAt', 'desc')));
    const rows = snap.docs.map((d) => d.data());
    if (!rows.length) {
      listEl.innerHTML = `<div class="c-su-empty">No signups yet. Share the registration link above.</div>`;
      return;
    }
    listEl.innerHTML = rows.map((r) => `
      <div class="c-su-row">
        <div class="c-su-name">${escapeHtml(r.name || r.email || 'Guest')}
          <span class="c-su-tag">${escapeHtml(r.source === 'member' ? 'Member' : 'Guest')}</span>
        </div>
        <div class="c-su-meta">${escapeHtml(r.email || '')}${r.phone ? ' · ' + escapeHtml(r.phone) : ''}</div>
        <div class="c-su-meta">${escapeHtml(fmtRelative ? fmtRelative(r.createdAt) : '')}</div>
      </div>
    `).join('');
  } catch (err) {
    listEl.innerHTML = `<div class="c-su-empty">Could not load signups: ${escapeHtml(err.message || String(err))}</div>`;
  }
}

async function main() {
  if (!firebaseReady) {
    $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">Firebase is unavailable.</div></div>`;
    return;
  }
  const u = await onAuthReady();
  if (!u) {
    location.replace('/login.html?next=' + encodeURIComponent('/events.html'));
    return;
  }

  const info = await getRoleInfo();
  const profile = (await getUserProfile(u.uid)) || {};
  state.me = {
    uid: u.uid,
    email: u.email,
    displayName: profile.displayName || u.displayName || u.email,
    avatarUrl: profile.avatarUrl || null
  };
  state.role = info.role;
  state.isAdmin = info.isAdmin;

  renderTopbar({ user: state.me, profile, role: info.role, currentPage: 'events' });

  if (state.isAdmin) {
    const btn = $('btn-new-event');
    if (btn) btn.style.display = 'inline-flex';
    state.companyId = await resolveCreatorCompany(u.uid, info);
    await loadCompaniesForOwner();
  }
  bindToolbar();

  await loadEvents();
  await loadMyRsvps();
  renderList();
}

main();
