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

function fmtEventDate(ts, endTs) {
  if (!ts) return 'TBA';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (isNaN(d.getTime())) return 'TBA';
  const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeOpts = { hour: 'numeric', minute: '2-digit' };
  const time = d.toLocaleTimeString(undefined, timeOpts);
  const end = endTs && (endTs.toDate ? endTs.toDate() : new Date(endTs));
  if (end && !isNaN(end.getTime())) {
    const sameDay = end.toDateString() === d.toDateString();
    return sameDay
      ? `${date} · ${time} – ${end.toLocaleTimeString(undefined, timeOpts)}`
      : `${date} · ${time} – ${end.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${end.toLocaleTimeString(undefined, timeOpts)}`;
  }
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
      <div class="c-event-date">${escapeHtml(fmtEventDate(e.startsAt, e.endsAt))}</div>
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

        <label class="c-invite-label">Starts</label>
        <div class="c-dt-row">
          <div class="c-dt-wrap">
            <button type="button" class="c-dt-field" id="c-start-date-btn">
              <svg class="c-dt-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <span class="c-dt-text c-dt-placeholder" id="c-start-date-label">Select date</span>
            </button>
            <div class="c-dt-pop" id="c-start-date-pop" hidden></div>
          </div>
          <div class="c-dt-wrap c-dt-wrap-time">
            <button type="button" class="c-dt-field" id="c-start-time-btn">
              <svg class="c-dt-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              <span class="c-dt-text c-dt-placeholder" id="c-start-time-label">Select time</span>
            </button>
            <div class="c-dt-pop c-dt-pop-time" id="c-start-time-pop" hidden></div>
          </div>
        </div>

        <label class="c-invite-label">Ends (optional)</label>
        <div class="c-dt-row">
          <div class="c-dt-wrap">
            <button type="button" class="c-dt-field" id="c-end-date-btn">
              <svg class="c-dt-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <span class="c-dt-text c-dt-placeholder" id="c-end-date-label">Select date</span>
            </button>
            <div class="c-dt-pop" id="c-end-date-pop" hidden></div>
          </div>
          <div class="c-dt-wrap c-dt-wrap-time">
            <button type="button" class="c-dt-field" id="c-end-time-btn">
              <svg class="c-dt-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              <span class="c-dt-text c-dt-placeholder" id="c-end-time-label">Select time</span>
            </button>
            <div class="c-dt-pop c-dt-pop-time" id="c-end-time-pop" hidden></div>
          </div>
        </div>

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

  // ── Custom calendar + time picker (one reusable instance per row) ──
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const WEEK = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const today = new Date();
  const allPops = [];          // every pop element, for global close
  const closePops = () => allPops.forEach((p) => { p.hidden = true; });

  function makePicker(prefix, initDate) {
    const sel = {
      day: initDate ? { y: initDate.getFullYear(), m: initDate.getMonth(), d: initDate.getDate() } : null,
      time: initDate ? { h: initDate.getHours(), min: initDate.getMinutes() } : null
    };
    let viewY = sel.day ? sel.day.y : today.getFullYear();
    let viewM = sel.day ? sel.day.m : today.getMonth();

    const datePop = $(`c-${prefix}-date-pop`);
    const timePop = $(`c-${prefix}-time-pop`);
    allPops.push(datePop, timePop);

    const getValue = () => (sel.day && sel.time)
      ? new Date(sel.day.y, sel.day.m, sel.day.d, sel.time.h, sel.time.min)
      : null;

    function refreshLabels() {
      const dl = $(`c-${prefix}-date-label`);
      const tl = $(`c-${prefix}-time-label`);
      if (sel.day) {
        const d = new Date(sel.day.y, sel.day.m, sel.day.d);
        dl.textContent = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        dl.classList.remove('c-dt-placeholder');
      } else { dl.textContent = 'Select date'; dl.classList.add('c-dt-placeholder'); }
      if (sel.time) {
        const h12 = ((sel.time.h + 11) % 12) + 1;
        const ap = sel.time.h < 12 ? 'AM' : 'PM';
        tl.textContent = `${h12}:${String(sel.time.min).padStart(2, '0')} ${ap}`;
        tl.classList.remove('c-dt-placeholder');
      } else { tl.textContent = 'Select time'; tl.classList.add('c-dt-placeholder'); }
    }

    function renderCalendar() {
      const first = new Date(viewY, viewM, 1).getDay();
      const days = new Date(viewY, viewM + 1, 0).getDate();
      let cells = '';
      for (let i = 0; i < first; i++) cells += `<span class="c-cal-cell c-cal-blank"></span>`;
      for (let d = 1; d <= days; d++) {
        const isSel = sel.day && sel.day.y === viewY && sel.day.m === viewM && sel.day.d === d;
        const isToday = today.getFullYear() === viewY && today.getMonth() === viewM && today.getDate() === d;
        cells += `<button type="button" class="c-cal-cell c-cal-day${isSel ? ' is-sel' : ''}${isToday ? ' is-today' : ''}" data-day="${d}">${d}</button>`;
      }
      datePop.innerHTML = `
        <div class="c-cal-head">
          <button type="button" class="c-cal-nav" data-nav="-1" aria-label="Previous month">‹</button>
          <span class="c-cal-title">${MONTHS[viewM]} ${viewY}</span>
          <button type="button" class="c-cal-nav" data-nav="1" aria-label="Next month">›</button>
        </div>
        <div class="c-cal-week">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="c-cal-grid">${cells}</div>
      `;
      datePop.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        viewM += Number(b.dataset.nav);
        if (viewM < 0) { viewM = 11; viewY--; }
        if (viewM > 11) { viewM = 0; viewY++; }
        renderCalendar();
      }));
      datePop.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation();
        sel.day = { y: viewY, m: viewM, d: Number(b.dataset.day) };
        refreshLabels();
        renderCalendar();
        closePops();
      }));
    }

    function renderTime() {
      const curH = sel.time ? sel.time.h : -1;
      const curMin = sel.time ? sel.time.min : -1;
      const hours = Array.from({ length: 12 }, (_, i) => i + 1);
      const mins = Array.from({ length: 12 }, (_, i) => i * 5);
      const curAp = curH < 0 ? '' : (curH < 12 ? 'AM' : 'PM');
      const curH12 = curH < 0 ? -1 : (((curH + 11) % 12) + 1);
      timePop.innerHTML = `
        <div class="c-time-cols">
          <div class="c-time-col" data-col="h">${hours.map((h) => `<button type="button" class="c-time-opt${h === curH12 ? ' is-sel' : ''}" data-h="${h}">${h}</button>`).join('')}</div>
          <div class="c-time-col" data-col="m">${mins.map((m) => `<button type="button" class="c-time-opt${m === curMin ? ' is-sel' : ''}" data-m="${String(m).padStart(2,'0')}">${String(m).padStart(2,'0')}</button>`).join('')}</div>
          <div class="c-time-col c-time-col-ap">${['AM','PM'].map((a) => `<button type="button" class="c-time-opt${a === curAp ? ' is-sel' : ''}" data-ap="${a}">${a}</button>`).join('')}</div>
        </div>
        <button type="button" class="c-time-done" data-done>Done</button>
      `;
      // Defaults so a partial selection still commits (e.g. just hour + AM/PM).
      const draft = {
        h12: curH12 > 0 ? curH12 : 12,
        min: curMin >= 0 ? curMin : 0,
        ap: curAp || 'AM'
      };
      const commit = () => {
        let h24 = draft.h12 % 12;
        if (draft.ap === 'PM') h24 += 12;
        sel.time = { h: h24, min: draft.min };
        refreshLabels();
      };
      timePop.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation(); draft.h12 = Number(b.dataset.h);
        timePop.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('is-sel', x === b));
        commit();
      }));
      timePop.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation(); draft.min = Number(b.dataset.m);
        timePop.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('is-sel', x === b));
        commit();
      }));
      timePop.querySelectorAll('[data-ap]').forEach((b) => b.addEventListener('click', (e) => {
        e.stopPropagation(); draft.ap = b.dataset.ap;
        timePop.querySelectorAll('[data-ap]').forEach((x) => x.classList.toggle('is-sel', x === b));
        commit();
      }));
      timePop.querySelector('[data-done]').addEventListener('click', (e) => {
        e.stopPropagation(); commit(); closePops();
      });
    }

    function togglePop(which) {
      const target = which === 'date' ? datePop : timePop;
      const opening = target.hidden;
      closePops();
      if (opening) {
        if (which === 'date') renderCalendar(); else renderTime();
        target.hidden = false;
      }
    }
    $(`c-${prefix}-date-btn`).addEventListener('click', (e) => { e.stopPropagation(); togglePop('date'); });
    $(`c-${prefix}-time-btn`).addEventListener('click', (e) => { e.stopPropagation(); togglePop('time'); });
    datePop.addEventListener('click', (e) => e.stopPropagation());
    timePop.addEventListener('click', (e) => e.stopPropagation());
    refreshLabels();
    return { getValue };
  }

  const prefStart = (prefill && prefill.startsAt && prefill.startsAt.toDate) ? prefill.startsAt.toDate() : null;
  const prefEnd = (prefill && prefill.endsAt && prefill.endsAt.toDate) ? prefill.endsAt.toDate() : null;
  const startPicker = makePicker('start', prefStart);
  const endPicker = makePicker('end', prefEnd);
  const getWhen = () => startPicker.getValue();
  const getEnd = () => endPicker.getValue();

  if (prefill) {
    $('c-ev-link').value = prefill.link || '';
    $('c-ev-loc').value = prefill.location || '';
    $('c-ev-desc').value = prefill.description || '';
  }

  const close = () => { document.removeEventListener('click', closePops); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('click', closePops);
  $('c-event-close').addEventListener('click', close);
  $('c-ev-cancel').addEventListener('click', close);
  setTimeout(() => $('c-ev-title').focus(), 0);

  $('c-ev-save').addEventListener('click', async () => {
    const errEl = $('c-ev-err');
    errEl.style.display = 'none';
    const title = $('c-ev-title').value.trim();
    const when = getWhen();
    const endWhen = getEnd();
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
    if (!when || isNaN(when.getTime())) {
      errEl.textContent = 'A start date and time are required.';
      errEl.style.display = 'block';
      return;
    }
    if (endWhen && endWhen.getTime() <= when.getTime()) {
      errEl.textContent = 'End time must be after the start time.';
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
        endsAt: endWhen || null,
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
