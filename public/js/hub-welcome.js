// First-login welcome — the setup card and the navigation tour.
//
// A member's first minute in the portal used to be a dashboard that said
// "Welcome back" to someone who had never been here, with eight sections and
// no indication of what any of them were. This module owns that minute:
//
//   1. A setup card, pinned above the fold, turns "finish your account" into
//      a checklist with a real completion count instead of a vague nudge.
//   2. A tour modal walks the rail one tab at a time. Every tab is clickable:
//      a member can jump straight to Courses from step one and the tour still
//      counts as taken, because the point is knowing where things are, not
//      clicking Next seven times.
//
// The decisions (is this a first visit, what is still missing) live in
// hub-welcome-state.js, which is pure and tested. Everything here is the
// impure half: the seen-flag, the DOM, the navigation.
//
// Seen-state lives in the member's own user doc (`welcomeTourAt`), with a
// localStorage mirror so a blocked or offline write never shows the tour
// twice on the same device.

import { db, firebaseReady } from './firebase.js';
import {
  doc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { navIcon } from './academy-shell.js';
import { escapeHtml } from './community.js';
import { isNewMember, setupState, TOUR_STOPS, clampStep } from './hub-welcome-state.js';

const seenKey = (uid) => `1p_welcome_seen_${uid || 'anon'}`;

function seenLocally(uid) {
  try { return localStorage.getItem(seenKey(uid)) === '1'; } catch (e) { return false; }
}

function rememberLocally(uid) {
  try { localStorage.setItem(seenKey(uid), '1'); } catch (e) { /* private mode */ }
}

/** True on a member's very first dashboard load. */
export function isFirstVisit(profile, uid) {
  return isNewMember(profile, { seenLocally: seenLocally(uid || (profile && profile.uid)) });
}

async function markTourSeen(uid) {
  rememberLocally(uid);
  if (!firebaseReady || !uid) return;
  try {
    await setDoc(doc(db, 'users', uid), { welcomeTourAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    // The localStorage mirror already covers this member on this device.
    console.warn('[hub-welcome] could not record tour completion', e);
  }
}

// ─── The tour ─────────────────────────────────────────────────────────────

function tourHtml(name, index) {
  const stop = TOUR_STOPS[index];
  const isLast = index === TOUR_STOPS.length - 1;

  const tabs = TOUR_STOPS.map((s, i) => `
    <button type="button" class="tour-tab${i === index ? ' is-active' : ''}" role="tab"
            data-step="${i}" aria-selected="${i === index ? 'true' : 'false'}">
      ${navIcon(s.icon)}<span>${escapeHtml(s.label)}</span>
    </button>`).join('');

  return `
    <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <button type="button" class="tour-close" data-act="skip" aria-label="Close the tour">&times;</button>

      <div class="tour-head">
        <div class="tour-eyebrow">Quick tour · ${index + 1} of ${TOUR_STOPS.length}</div>
        <h2 id="tour-title">Welcome to the Academy${name ? `, <span>${escapeHtml(name)}</span>` : ''}.</h2>
        <p class="tour-lede">Here is where everything lives. Tap any tab to jump straight to it — you can reopen this tour any time from your dashboard.</p>
      </div>

      <div class="tour-tabs" role="tablist" aria-label="Academy sections">${tabs}</div>

      <div class="tour-stop">
        <div class="tour-stop-icon">${navIcon(stop.icon)}</div>
        <div class="tour-stop-copy">
          <h3>${escapeHtml(stop.label)}</h3>
          <p>${escapeHtml(stop.blurb)}</p>
          <a class="btn btn-primary tour-go" href="${escapeHtml(stop.href)}" data-act="go">Open ${escapeHtml(stop.label)} →</a>
        </div>
      </div>

      <div class="tour-foot">
        <button type="button" class="tour-skip" data-act="skip">Skip the tour</button>
        <div class="tour-foot-actions">
          <button type="button" class="btn btn-ghost" data-act="back"${index === 0 ? ' disabled' : ''}>Back</button>
          <button type="button" class="btn btn-primary" data-act="next">${isLast ? 'Start exploring' : 'Next'}</button>
        </div>
      </div>
    </div>`;
}

/**
 * Opens the tour modal. Resolves once it closes, however it closed — Next
 * through the end, Skip, Escape, the backdrop, or a jump to another page.
 */
export function openTour({ name, uid, startAt = 0 } = {}) {
  return new Promise((resolve) => {
    let index = clampStep(startAt);
    let closed = false;

    const overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    document.body.appendChild(overlay);
    document.body.classList.add('tour-open');

    const paint = ({ focus = true } = {}) => {
      overlay.innerHTML = tourHtml(name, index);
      if (!focus) return;
      const active = overlay.querySelector('.tour-tab.is-active');
      if (active) active.focus({ preventScroll: true });
    };

    const close = async ({ navigateTo = null } = {}) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      document.body.classList.remove('tour-open');
      await markTourSeen(uid);
      resolve();
      // Navigate only after the seen-flag write, so leaving mid-tour still
      // counts as having taken the tour.
      if (navigateTo) location.href = navigateTo;
    };

    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && index < TOUR_STOPS.length - 1) { index += 1; paint(); }
      else if (e.key === 'ArrowLeft' && index > 0) { index -= 1; paint(); }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { close(); return; }

      const tab = e.target.closest('.tour-tab');
      if (tab) { index = clampStep(tab.dataset.step); paint(); return; }

      const btn = e.target.closest('[data-act]');
      if (!btn) return;

      switch (btn.dataset.act) {
        case 'go':
          e.preventDefault();
          close({ navigateTo: TOUR_STOPS[index].href });
          break;
        case 'skip':
          close();
          break;
        case 'back':
          if (index > 0) { index -= 1; paint(); }
          break;
        case 'next':
          if (index < TOUR_STOPS.length - 1) { index += 1; paint(); }
          else close();
          break;
        default:
          break;
      }
    });

    document.addEventListener('keydown', onKey);
    paint({ focus: false });
  });
}

// ─── The dashboard setup card ─────────────────────────────────────────────

function cardHtml(state, firstVisit) {
  const items = state.steps.map((s) => `
    <li class="hub-setup-item${s.isDone ? ' is-done' : ''}">
      <a class="hub-setup-link" href="${escapeHtml(s.href)}">
        <span class="hub-setup-check" aria-hidden="true">${s.isDone ? '✓' : ''}</span>
        <span class="hub-setup-copy">
          <span class="hub-setup-label">${escapeHtml(s.label)}</span>
          <span class="hub-setup-hint">${escapeHtml(s.hint)}</span>
        </span>
      </a>
    </li>`).join('');

  return `
    <div class="hub-setup">
      <div class="hub-setup-head">
        <div class="hub-setup-intro">
          <div class="hub-setup-eyebrow">${firstVisit ? 'Start here' : 'Finish setting up'}</div>
          <h2>${firstVisit ? 'Set up your account' : 'Your account is almost ready'}</h2>
          <p class="hub-setup-lede">
            A few quick fields and your first course. A finished profile is what
            gets you found in the community and what tailors this dashboard to you.
          </p>
        </div>
        <button type="button" class="btn btn-ghost hub-setup-tour" id="hub-tour-btn">Take the tour</button>
      </div>

      <div class="hub-setup-meter">
        <div class="hub-setup-bar"><span style="width:${state.pct}%"></span></div>
        <div class="hub-setup-count">${state.done} of ${state.total} done</div>
      </div>

      <ul class="hub-setup-list">${items}</ul>

      <div class="hub-setup-actions">
        <a class="btn btn-primary" href="/profile.html">Complete my profile →</a>
        <a class="btn btn-ghost" href="/courses.html">Browse courses</a>
      </div>
    </div>`;
}

/**
 * Renders the setup card into #hub-welcome and, on a genuine first visit,
 * opens the tour over it. Returns true when the card is on screen, so the
 * caller can drop the duplicate profile nudge from "Your next step".
 *
 * Fail-soft like every other dashboard section: any error renders nothing and
 * leaves the rest of the page untouched.
 */
export function renderWelcome({ profile, uid, name, firstVisit = false, enrolled = false } = {}) {
  const sec = document.getElementById('hub-welcome');
  if (!sec) return false;

  try {
    const state = setupState(profile, { enrolled });

    // Nothing left to nag about, and the tour is already behind them.
    if (state.done === state.total && !firstVisit) { sec.hidden = true; return false; }

    sec.innerHTML = cardHtml(state, firstVisit);
    sec.hidden = false;

    const tourBtn = document.getElementById('hub-tour-btn');
    if (tourBtn) tourBtn.addEventListener('click', () => openTour({ name, uid }));

    if (firstVisit) openTour({ name, uid });
    return true;
  } catch (e) {
    console.warn('[hub-welcome] render failed', e);
    sec.hidden = true;
    return false;
  }
}
