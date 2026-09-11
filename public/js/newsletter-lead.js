// Homepage newsletter form → portal lead capture.
// The form used to only show an alert; now the email lands in the academy
// CRM tagged Newsletter. Best-effort by design: the visitor's experience
// never depends on this call.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

window.__1pNewsletterLead = async ({ email }) => {
  if (!firebaseReady) {
    throw new Error('Signup is unavailable right now. Please refresh and try again.');
  }
  // The server requires a non-empty name. `email.split('@')[0]` is empty for
  // an address like "@x.com", which used to fail server-side behind a success
  // alert; fall back to the address itself so the lead is never lost to that.
  const name = email.split('@')[0].trim() || email;
  // Awaited, not fire-and-forget: the caller shows a confirmation, and it
  // should not claim success for a lead that was never stored.
  await httpsCallable(functions, 'submitLeadForm')({
    formType: 'newsletter',
    name,
    email,
    fields: {},
    consent: false
  });
};
