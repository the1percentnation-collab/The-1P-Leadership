// Webinar page → portal lead capture + event registration.
//
// GoHighLevel is gone: this is now the webinar form's only destination.
// window.__1pSubmitWebinarLead is awaited by the inline form handler and
// must succeed for the success screen to show:
//   1. submitLeadForm captures the lead (CRM contact, tags, answers, consent)
//   2. registerForEvent (best-effort) registers the signup for the webinar
//      event named by config/booking.webinarEventId and returns the gated
//      Zoom join link, which is shown on the confirmation screen.
// Step 2 failing never fails the submit; the lead is already captured.

import { db, functions, firebaseReady } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function registerForWebinarEvent({ name, email, phone }) {
  try {
    const cfg = await getDoc(doc(db, 'config', 'booking'));
    const eventId = cfg.exists() ? cfg.data().webinarEventId : null;
    if (!eventId) return;
    const res = await httpsCallable(functions, 'registerForEvent')({
      eventId, name, email, phone
    });
    const joinUrl = res && res.data && res.data.joinUrl;
    const slot = document.getElementById('success-join');
    if (joinUrl && slot) {
      slot.innerHTML = `
        <a href="${escapeHtml(joinUrl)}" target="_blank" rel="noopener"
           style="display:inline-block;margin:14px 0 4px;padding:12px 22px;background:#E60306;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;">
          Your Zoom join link →
        </a>
        <div style="font-size:12px;opacity:0.7;margin-bottom:6px;">Save it. This is your door into the session.</div>`;
    }
  } catch (e) {
    console.warn('[webinar] event registration skipped:', e && e.message);
  }
}

window.__1pSubmitWebinarLead = async ({ name, email, phone, fields, consent }) => {
  if (!firebaseReady) {
    throw new Error('The form is unavailable right now. Please refresh and try again.');
  }
  await httpsCallable(functions, 'submitLeadForm')({
    formType: 'webinar', name, email, phone, fields, consent
  });
  // Lead is safe; the join link is a bonus on top.
  registerForWebinarEvent({ name, email, phone });
};
