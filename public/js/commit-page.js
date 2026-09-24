// /commit.html — the course commitment questionnaire. Teaches Parkinson's Law,
// then has the member set a finish date, a weekly time budget and a daily
// rhythm, and choose how we remind them. Saved through the
// saveCourseCommitment callable (server-validated); the hourly automation
// tick sends the reminders (sendCourseWorkReminders in functions/index.js).
//
// ?course=<slug>   required
// ?next=<path>     where to go after saving (same-site only)
// ?edit=1          revisit an existing commitment, prefilled

import { onAuthReady } from './auth.js';
import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { loadCourses, getCourseBySlug, loadModulesMeta } from './courses-data.js';
import { loadEnrollments, isEnrolled } from './enrollments.js';
import { loadCommitment } from './commitment-guard.js';
import { pushAvailable, enablePush, isIosNotInstalled } from './push.js';
import {
  DAY_LABELS, GOAL_PRESETS, WEEKLY_PRESETS, SESSION_PRESETS,
  isoDay, addDays, daysBetween, suggestDays, paceSummary, commitmentError, goalDateError,
  fmtMinutes, fmtTime, fmtDays, fmtDate
} from './commitment-state.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const slug = (params.get('course') || '').trim();
const editing = params.get('edit') === '1';

function nextUrl() {
  const n = params.get('next');
  // Same-site only: "//evil.com" starts with "/" but is protocol-relative.
  if (n && n.startsWith('/') && !n.startsWith('//')) return n;
  return `/courses.html?course=${encodeURIComponent(slug)}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const today = isoDay();
const state = {
  goalDate: '',
  weeklyMinutes: 0,
  sessionMinutes: 30,
  days: [],
  daysTouched: false,
  reminderTime: '19:00',
  channels: { email: true, inapp: true, push: false }
};
let course = null;
let moduleCount = 0;
let step = 0;
const STEPS = 5;

// ─── Boot ────────────────────────────────────────────────────────────────

async function boot() {
  if (!slug) { location.replace('/courses.html'); return; }
  if (!firebaseReady) { location.replace(nextUrl()); return; }

  const user = await onAuthReady();
  if (!user) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }

  try { await loadCourses(); } catch (e) {}
  course = getCourseBySlug(slug, { includeInactive: true });
  try { await loadEnrollments({ force: true }); } catch (e) {}
  if (!isEnrolled(slug)) { location.replace(`/course.html?course=${encodeURIComponent(slug)}`); return; }

  let existing = null;
  try { existing = await loadCommitment(user.uid, slug); } catch (e) {}
  if (existing && !editing) { location.replace(nextUrl()); return; }
  if (existing) prefill(existing);

  $('cm-course').textContent = course ? (course.short || course.title) : '';
  try { moduleCount = (await loadModulesMeta(course)).length; } catch (e) { moduleCount = 0; }

  renderChips();
  bind(user);
  if (await pushAvailable()) {
    $('cm-push-row').hidden = false;
    const note = $('cm-push-note');
    if (isIosNotInstalled()) {
      note.hidden = false;
      note.textContent = 'On iPhone, add this site to your Home Screen first (Share → Add to Home Screen) to get push.';
    } else if (state.channels.push && Notification.permission !== 'granted') {
      // The saved plan says push, but this browser can't receive it. Show
      // what's actually true rather than a checked box that does nothing.
      state.channels.push = false;
      $('cm-ch-push').checked = false;
      note.hidden = false;
      note.textContent = 'Push isn\'t enabled on this device yet. Turn it on to get reminders here.';
    }
  } else {
    state.channels.push = false;
  }
  // Editing skips the intro; the member already knows the law.
  go(existing ? 1 : 0);
}

function prefill(c) {
  state.goalDate = c.goalDate || '';
  state.weeklyMinutes = c.weeklyMinutes || 0;
  state.sessionMinutes = c.sessionMinutes || 30;
  state.days = Array.isArray(c.days) ? c.days.slice() : [];
  state.daysTouched = state.days.length > 0;
  state.reminderTime = c.reminderTime || '19:00';
  state.channels = { email: true, inapp: true, push: false, ...(c.channels || {}) };
  // A past deadline being reset shouldn't be offered back as the answer.
  if (state.goalDate && state.goalDate <= today) state.goalDate = '';
}

// ─── Render ──────────────────────────────────────────────────────────────

function chip(label, value, selected, sub = '') {
  return `<button type="button" class="cm-chip${selected ? ' is-on' : ''}" role="radio" aria-checked="${selected}" data-value="${esc(value)}">
    <span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}
  </button>`;
}

function renderChips() {
  $('cm-goal-chips').innerHTML = GOAL_PRESETS.map((p) => {
    const d = addDays(today, p.days);
    return chip(p.label, d, state.goalDate === d, fmtDate(d));
  }).join('');
  const dateEl = $('cm-goal-date');
  dateEl.min = addDays(today, 1);
  dateEl.max = addDays(today, 366);
  dateEl.value = state.goalDate;

  $('cm-week-chips').innerHTML = WEEKLY_PRESETS.map((m) =>
    chip(fmtMinutes(m), m, state.weeklyMinutes === m, `${fmtMinutes(Math.round(m / 7))}/day avg`)
  ).join('');

  $('cm-session-chips').innerHTML = SESSION_PRESETS.map((m) =>
    chip(`${m} min`, m, state.sessionMinutes === m)
  ).join('');

  $('cm-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) =>
    `<button type="button" class="cm-day${state.days.includes(d) ? ' is-on' : ''}" aria-pressed="${state.days.includes(d)}" data-day="${d}">${DAY_LABELS[d].slice(0, 2)}</button>`
  ).join('');
  $('cm-time').value = state.reminderTime;

  $('cm-ch-email').checked = !!state.channels.email;
  $('cm-ch-inapp').checked = !!state.channels.inapp;
  $('cm-ch-push').checked = !!state.channels.push;

  renderLive();
}

function renderLive() {
  // Goal step: what this deadline means in practice.
  const goalLive = $('cm-goal-live');
  if (state.goalDate) {
    const days = daysBetween(today, state.goalDate);
    const perWeek = moduleCount ? Math.round((moduleCount / Math.max(1, days / 7)) * 10) / 10 : 0;
    goalLive.innerHTML = `<strong>${days} days.</strong> ` + (moduleCount
      ? `That's about ${perWeek} of ${moduleCount} modules a week.`
      : 'Short enough to feel it. That\'s the point.');
  } else {
    goalLive.textContent = '';
  }

  // Rhythm step: planned weekly time vs. the budget from step 2.
  const planned = state.sessionMinutes * state.days.length;
  const rl = $('cm-rhythm-live');
  if (!state.days.length) {
    rl.textContent = 'Pick at least one day.';
  } else {
    const diff = state.weeklyMinutes ? planned - state.weeklyMinutes : 0;
    rl.innerHTML = `<strong>${fmtMinutes(planned)} a week.</strong> ` + (Math.abs(diff) < 15 || !state.weeklyMinutes
      ? 'Right on your target.'
      : diff > 0 ? `${fmtMinutes(diff)} more than you planned. Ambitious.` : `${fmtMinutes(-diff)} short of your ${fmtMinutes(state.weeklyMinutes)} target.`);
  }
}

function renderSummary() {
  const planned = state.sessionMinutes * state.days.length;
  $('cm-summary').innerHTML = `
    <div class="cm-sum-row"><span>Finish by</span><strong>${esc(fmtDate(state.goalDate))}</strong></div>
    <div class="cm-sum-row"><span>Each week</span><strong>${esc(fmtMinutes(planned))}</strong></div>
    <div class="cm-sum-row"><span>Sessions</span><strong>${state.sessionMinutes} min · ${esc(fmtDays(state.days))}</strong></div>
    <div class="cm-sum-row"><span>Reminder</span><strong>${esc(fmtTime(state.reminderTime))}</strong></div>`;
  const p = paceSummary({ today, goalDate: state.goalDate, moduleCount, sessionMinutes: state.sessionMinutes, days: state.days });
  $('cm-fit').innerHTML = p.fits
    ? `<strong>The math works.</strong> ${p.daysLeft} days, ${fmtMinutes(p.plannedMinutes)} of focused time. Show up and it's done.`
    : `<strong>Tight.</strong> This course needs about ${fmtMinutes(p.neededMinutes)}; your plan gives ${fmtMinutes(p.plannedMinutes)}. Add a day or go longer per session. Or keep it and let the pressure work.`;
}

// ─── Navigation ──────────────────────────────────────────────────────────

function stepError(n) {
  if (n === 1) return goalDateError(state.goalDate, today);
  if (n === 2 && !state.weeklyMinutes) return 'Pick your weekly time.';
  if (n === 3 && !state.days.length) return 'Pick at least one day.';
  return '';
}

function flash(section, text) {
  let el = section.querySelector('.cm-err');
  if (!el) {
    el = document.createElement('p');
    el.className = 'cm-err';
    section.querySelector('.cm-next').before(el);
  }
  el.textContent = text;
}

function go(n) {
  const sections = document.querySelectorAll('.cm-step');
  const forward = n > step;
  step = Math.max(0, Math.min(STEPS - 1, n));
  sections.forEach((s) => {
    const on = Number(s.dataset.step) === step;
    s.hidden = !on;
    if (on) {
      s.classList.remove('cm-in-fwd', 'cm-in-back');
      void s.offsetWidth; // restart the slide animation
      s.classList.add(forward ? 'cm-in-fwd' : 'cm-in-back');
      const err = s.querySelector('.cm-err');
      if (err) err.textContent = '';
    }
  });
  $('cm-back').hidden = step === 0;
  $('cm-bar').style.width = `${Math.round(((step + 1) / STEPS) * 100)}%`;
  if (step === 3 && !state.daysTouched) {
    state.days = suggestDays(state.weeklyMinutes || 120, state.sessionMinutes);
    renderChips();
  }
  if (step === 4) renderSummary();
  const focusable = document.querySelector(`.cm-step[data-step="${step}"] .cm-chip.is-on, .cm-step[data-step="${step}"] .cm-next`);
  if (focusable) focusable.focus({ preventScroll: true });
}

function advance() {
  if (step === STEPS - 1) { submit(); return; }
  const err = stepError(step);
  if (err) { flash(document.querySelector(`.cm-step[data-step="${step}"]`), err); return; }
  go(step + 1);
}

// ─── Events ──────────────────────────────────────────────────────────────

function bind(user) {
  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', advance));
  $('cm-submit').addEventListener('click', submit);
  $('cm-back').addEventListener('click', () => go(step - 1));

  // Single-choice steps advance on tap: one decision, one touch.
  const autoAdvance = () => setTimeout(() => { if (!stepError(step)) go(step + 1); }, 260);

  $('cm-goal-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.cm-chip'); if (!b) return;
    state.goalDate = b.dataset.value;
    renderChips();
    autoAdvance();
  });
  $('cm-goal-date').addEventListener('change', (e) => {
    state.goalDate = e.target.value;
    renderChips();
  });
  $('cm-week-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.cm-chip'); if (!b) return;
    state.weeklyMinutes = Number(b.dataset.value);
    state.daysTouched = false;
    renderChips();
    autoAdvance();
  });
  $('cm-session-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.cm-chip'); if (!b) return;
    state.sessionMinutes = Number(b.dataset.value);
    if (!state.daysTouched) state.days = suggestDays(state.weeklyMinutes || 120, state.sessionMinutes);
    renderChips();
  });
  $('cm-days').addEventListener('click', (e) => {
    const b = e.target.closest('.cm-day'); if (!b) return;
    const d = Number(b.dataset.day);
    state.days = state.days.includes(d) ? state.days.filter((x) => x !== d) : [...state.days, d];
    state.daysTouched = true;
    renderChips();
  });
  $('cm-time').addEventListener('change', (e) => { state.reminderTime = e.target.value || '19:00'; });

  $('cm-ch-email').addEventListener('change', (e) => { state.channels.email = e.target.checked; });
  $('cm-ch-inapp').addEventListener('change', (e) => { state.channels.inapp = e.target.checked; });
  $('cm-ch-push').addEventListener('change', (e) => {
    if (!e.target.checked) { state.channels.push = false; return; }
    const note = $('cm-push-note');
    const btn = $('cm-submit');
    // While the browser's permission prompt is open, saving would drop push
    // silently. Hold the Commit button, and have submit() wait on this too.
    btn.disabled = true;
    note.hidden = false;
    note.textContent = 'Waiting for you to allow notifications…';
    pushPending = enablePush(user.uid).then((res) => {
      if (res.ok) {
        state.channels.push = true;
        note.hidden = true;
      } else {
        e.target.checked = false;
        state.channels.push = false;
        note.hidden = false;
        if (res.message) console.warn('[commit] push enable failed:', res.message);
        note.textContent = PUSH_ERRORS[res.reason] || PUSH_ERRORS.error;
      }
    }).finally(() => {
      pushPending = null;
      if (!saving) btn.disabled = false;
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    advance();
  });
}

// ─── Save ────────────────────────────────────────────────────────────────

const PUSH_ERRORS = {
  denied: 'Notifications are blocked for this site. Allow them in your browser settings, then try again.',
  dismissed: 'No problem. Turn push on any time; email and in-app reminders have you covered.',
  unsupported: 'Push isn\'t available in this browser. Email and in-app reminders still have you covered.',
  error: 'Couldn\'t turn on push just now. Try the toggle again.'
};

let saving = false;
let pushPending = null;
async function submit() {
  if (saving) return;
  // A push toggle still waiting on the permission prompt must land in the
  // saved plan, not be dropped because Commit was clicked first.
  if (pushPending) await pushPending;
  const payload = {
    slug,
    goalDate: state.goalDate,
    weeklyMinutes: state.sessionMinutes * state.days.length,
    sessionMinutes: state.sessionMinutes,
    days: state.days.slice().sort((a, b) => a - b),
    reminderTime: state.reminderTime,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    channels: { ...state.channels },
    courseTitle: course ? course.title : ''
  };
  const err = commitmentError(payload, today);
  const msg = $('cm-msg');
  if (err) { msg.innerHTML = `<div class="auth-error">${esc(err)}</div>`; return; }

  saving = true;
  const btn = $('cm-submit');
  btn.disabled = true;
  btn.textContent = 'Locking it in…';
  msg.innerHTML = '';
  try {
    await httpsCallable(functions, 'saveCourseCommitment')(payload);
    location.replace(nextUrl());
  } catch (e) {
    saving = false;
    btn.disabled = false;
    btn.textContent = 'Commit & start →';
    msg.innerHTML = `<div class="auth-error">${esc((e && e.message) || 'Could not save. Try again.')}</div>`;
  }
}

boot();
