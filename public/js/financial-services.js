// Financial services lead capture — public page, no purchase path.
//
// Bookkeeping requests route to the partner firm's CRM company via
// config/leadRouting; the insurance / investment waitlists stay with the
// academy. Everything goes through the registerServiceInterest callable.

import { functions, firebaseReady } from './firebase.js';
import { onAuthReady, currentUser } from './auth.js';
import { renderTopbarEarly } from './topbar.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);

function consentTextFor(id) {
  const label = document.querySelector(`label[for="${id}"] .consent-text`);
  return label ? label.innerText.replace(/\s+/g, ' ').trim() : '';
}

function bindForm({ formId, msgId, payload }) {
  const form = $(formId);
  const msg = $(msgId);
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!firebaseReady) {
      msg.textContent = 'The form is unavailable right now. Please email us instead.';
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    msg.textContent = 'Sending…';
    try {
      await httpsCallable(functions, 'registerServiceInterest')(payload());
      form.reset();
      msg.textContent = '✓ Received. We will be in touch.';
    } catch (e) {
      console.warn('[financial-services] submit failed', e);
      btn.disabled = false;
      msg.textContent = (e && e.message) || 'Could not send. Please try again.';
    }
  });
}

async function main() {
  try { if (firebaseReady) await onAuthReady(); } catch (e) {}
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });

  bindForm({
    formId: 'bk-form',
    msgId: 'bk-msg',
    payload: () => ({
      service: 'bookkeeping',
      name: $('bk-name').value.trim(),
      email: $('bk-email').value.trim(),
      phone: $('bk-phone').value.trim() || undefined,
      businessName: $('bk-business').value.trim() || undefined,
      notes: $('bk-notes').value.trim() || undefined,
      // Per-box state plus the exact wording shown, read from the DOM so what
      // is stored is what the person saw; the legacy boolean rides along.
      consent: $('bk-sms').checked || $('bk-mkt').checked,
      consents: { sms: $('bk-sms').checked, marketing: $('bk-mkt').checked },
      consentText: { sms: consentTextFor('bk-sms'), marketing: consentTextFor('bk-mkt') }
    })
  });

  bindForm({
    formId: 'wl-form',
    msgId: 'wl-msg',
    payload: () => ({
      service: $('wl-service').value,
      name: $('wl-name').value.trim(),
      email: $('wl-email').value.trim(),
      consent: $('wl-consent').checked
    })
  });
}

main();
