// Webinar page → portal events bridge.
//
// The webinar form keeps posting to GoHighLevel exactly as before; this hook
// ALSO registers the signup into the portal's events system so the lead lands
// in Firestore + the CRM and the attendee gets the gated Zoom join link on
// the spot. Which event is "the webinar" comes from config/booking
// .webinarEventId (set by Anthony after creating the event in /events).
// Everything here is best-effort: if the config is unset or any call fails,
// the GHL flow and the success screen are untouched.

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

window.__1pWebinarRegistered = async ({ name, email, phone }) => {
  if (!firebaseReady) return;
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
    console.warn('[webinar] portal registration skipped:', e && e.message);
  }
};
