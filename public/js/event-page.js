// /event.html — public event registration page.
//
// Works for signed-out visitors. It never reads Firestore directly (event
// reads require auth); instead it uses two callable Cloud Functions:
//   getEventPublic({ eventId })   → minimal public event details
//   registerForEvent({ eventId, name, email, phone }) → writes the signup
//     (Admin SDK) and mirrors the registrant into the event's company CRM.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const root = document.getElementById('reg-root');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDate(ms) {
  if (!ms) return 'Date TBA';
  const d = new Date(ms);
  if (isNaN(d.getTime())) return 'Date TBA';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function panel(inner) {
  root.innerHTML = `<div class="c-reg-card">${inner}</div>`;
}

function renderError(msg) {
  panel(`
    <h1 class="c-reg-title">Event unavailable</h1>
    <p class="c-reg-sub">${esc(msg)}</p>
    <a class="btn btn-primary" href="https://the1pnation.com">Back to site</a>
  `);
}

function renderSuccess(ev) {
  const joinLine = ev.link
    ? `<p class="c-reg-sub">When it's time, join here:<br><a href="${esc(ev.link)}" target="_blank" rel="noopener">${esc(ev.link)}</a></p>`
    : '';
  panel(`
    <div class="c-reg-check">✓</div>
    <h1 class="c-reg-title">You're registered!</h1>
    <p class="c-reg-sub">We've saved your spot for <strong>${esc(ev.title)}</strong> on ${esc(fmtDate(ev.startsAt))}.</p>
    ${joinLine}
  `);
}

function renderForm(ev) {
  const closed = !ev.signupsEnabled;
  const full = ev.full;
  const formDisabled = closed || full;
  const note = closed
    ? `<div class="c-reg-note">Registration is closed for this event.</div>`
    : (full ? `<div class="c-reg-note">This event has reached capacity.</div>` : '');

  panel(`
    <div class="c-reg-eyebrow">You're invited</div>
    <h1 class="c-reg-title">${esc(ev.title)}</h1>
    <div class="c-reg-when">${esc(fmtDate(ev.startsAt))}</div>
    ${ev.hostName ? `<div class="c-reg-host">Hosted by ${esc(ev.hostName)}</div>` : ''}
    ${ev.location ? `<div class="c-reg-loc">📍 ${esc(ev.location)}</div>` : ''}
    ${ev.description ? `<p class="c-reg-desc">${esc(ev.description)}</p>` : ''}
    ${note}
    <form id="reg-form" class="c-reg-form" ${formDisabled ? 'style="display:none;"' : ''}>
      <label class="c-invite-label" for="reg-name">Your name</label>
      <input id="reg-name" class="c-ch-input" type="text" maxlength="80" autocomplete="name" required>

      <label class="c-invite-label" for="reg-email">Email</label>
      <input id="reg-email" class="c-ch-input" type="email" autocomplete="email" required>

      <label class="c-invite-label" for="reg-phone">Phone (optional)</label>
      <input id="reg-phone" class="c-ch-input" type="tel" maxlength="40" autocomplete="tel">

      <button class="btn btn-primary c-reg-submit" id="reg-submit" type="submit">Register</button>
      <div class="auth-error" id="reg-err" style="display:none;"></div>
    </form>
  `);

  const form = document.getElementById('reg-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = document.getElementById('reg-err');
    errEl.style.display = 'none';
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    if (!name) { errEl.textContent = 'Please enter your name.'; errEl.style.display = 'block'; return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errEl.textContent = 'Please enter a valid email.'; errEl.style.display = 'block'; return;
    }
    const btn = document.getElementById('reg-submit');
    btn.disabled = true;
    btn.textContent = 'Registering…';
    try {
      const call = httpsCallable(functions, 'registerForEvent');
      const res = await call({ eventId: ev.id, name, email, phone });
      if (res.data && res.data.alreadyRegistered) {
        renderSuccess(ev);
      } else {
        renderSuccess(ev);
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Register';
      errEl.textContent = err.message || 'Could not register. Please try again.';
      errEl.style.display = 'block';
    }
  });
}

async function main() {
  if (!firebaseReady) { renderError('Service is temporarily unavailable.'); return; }
  const eventId = new URLSearchParams(location.search).get('id');
  if (!eventId) { renderError('No event was specified.'); return; }

  try {
    const call = httpsCallable(functions, 'getEventPublic');
    const res = await call({ eventId });
    const ev = res.data && res.data.event;
    if (!ev) { renderError('Event not found.'); return; }
    renderForm(ev);
  } catch (err) {
    renderError(err.message || 'Event not found.');
  }
}

main();
