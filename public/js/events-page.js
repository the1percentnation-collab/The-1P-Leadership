// /events.html — community events list + owner-only create modal.
//
// Backend storage: events/{eventId} top-level collection. Reads are
// open to any signed-in user; writes are owner-only by Firestore rules.
// No callable functions needed for v1 — the owner writes the doc
// directly via setDoc (rules gate it).

import { auth, db, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { getUserProfile, escapeHtml, fmtRelative } from './community.js';
import { renderTopbar } from './topbar.js';
import {
  collection, doc, getDoc, getDocs, query, orderBy, where, limit,
  setDoc, deleteDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

const state = {
  me: null,
  role: null,
  events: [],
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

function eventCardHtml(e) {
  const canEdit = state.role === 'owner' || (state.role === 'admin');
  const linkBtn = e.link
    ? `<a class="btn btn-primary c-event-cta" href="${escapeHtml(e.link)}" target="_blank" rel="noopener">Join →</a>`
    : '';
  const editBtn = canEdit
    ? `<button class="c-event-del" data-del="${escapeHtml(e.id)}" title="Delete">✕</button>`
    : '';
  return `
    <article class="c-event-card" data-event="${escapeHtml(e.id)}">
      <div class="c-event-date">${escapeHtml(fmtEventDate(e.startsAt))}</div>
      <div class="c-event-body">
        <div class="c-event-title">${escapeHtml(e.title || 'Untitled event')}</div>
        ${e.hostName ? `<div class="c-event-host">Hosted by ${escapeHtml(e.hostName)}</div>` : ''}
        ${e.description ? `<div class="c-event-desc">${escapeHtml(e.description)}</div>` : ''}
        ${e.location ? `<div class="c-event-loc">📍 ${escapeHtml(e.location)}</div>` : ''}
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
      ${state.role === 'owner'
        ? `<button class="btn btn-primary c-empty-cta" id="empty-new-event">Schedule an event</button>`
        : ''}
    `;
    const btn = $('empty-new-event');
    if (btn) btn.addEventListener('click', openEventModal);
    return;
  }

  emptyEl.hidden = true;
  root.innerHTML = filtered.map(eventCardHtml).join('');
  root.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.del;
      if (!confirm('Delete this event?')) return;
      try {
        await deleteDoc(doc(db, 'events', id));
        state.events = state.events.filter((ev) => ev.id !== id);
        renderList();
      } catch (err) {
        alert('Could not delete: ' + (err.message || err));
      }
    });
  });
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
  if (newBtn) newBtn.addEventListener('click', openEventModal);
}

function openEventModal(prefill = null) {
  if (document.getElementById('c-event-modal')) return;
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

        <label class="c-invite-label" for="c-ev-date">Date &amp; time</label>
        <div class="c-ev-datetime">
          <input id="c-ev-date" class="c-ch-input c-ev-date-input" type="date">
          <input id="c-ev-time" class="c-ch-input c-ev-time-input" type="time">
        </div>

        <label class="c-invite-label" for="c-ev-host">Host name</label>
        <input id="c-ev-host" class="c-ch-input" type="text" maxlength="60" value="${escapeHtml(prefill ? (prefill.hostName || '') : (state.me ? state.me.displayName || '' : ''))}">

        <label class="c-invite-label" for="c-ev-link">Join link (optional)</label>
        <input id="c-ev-link" class="c-ch-input" type="url" placeholder="https://zoom.us/j/...">

        <label class="c-invite-label" for="c-ev-loc">Location (optional)</label>
        <input id="c-ev-loc" class="c-ch-input" type="text" maxlength="120" placeholder="Online · Zoom · 123 Main St">

        <label class="c-invite-label" for="c-ev-desc">Description (optional)</label>
        <textarea id="c-ev-desc" class="c-ch-input" rows="3" maxlength="600"></textarea>

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
    $('c-ev-date').value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    $('c-ev-time').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    const dateStr = $('c-ev-date').value;
    const timeStr = $('c-ev-time').value;
    const whenStr = dateStr && timeStr ? `${dateStr}T${timeStr}` : '';
    const host = $('c-ev-host').value.trim();
    const link = $('c-ev-link').value.trim();
    const loc = $('c-ev-loc').value.trim();
    const desc = $('c-ev-desc').value.trim();

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
        updatedAt: serverTimestamp(),
        ...(prefill ? {} : { createdAt: serverTimestamp(), createdByUid: state.me ? state.me.uid : null })
      }, { merge: true });
      close();
      await loadEvents();
      renderList();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = prefill ? 'Save' : 'Create event';
      errEl.textContent = err.message || 'Could not save event.';
      errEl.style.display = 'block';
    }
  });
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

  renderTopbar({ user: state.me, profile, role: info.role, currentPage: null });

  // Owner sees the toolbar create button.
  if (state.role === 'owner') {
    const btn = $('btn-new-event');
    if (btn) btn.style.display = 'inline-flex';
  }
  bindToolbar();

  await loadEvents();
  renderList();
}

main();
