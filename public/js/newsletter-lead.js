// Homepage newsletter form → portal lead capture.
// The form used to only show an alert; now the email lands in the academy
// CRM tagged Newsletter. Best-effort by design: the visitor's experience
// never depends on this call.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

window.__1pNewsletterLead = ({ email }) => {
  if (!firebaseReady) return;
  httpsCallable(functions, 'submitLeadForm')({
    formType: 'newsletter',
    name: email.split('@')[0],
    email,
    fields: {},
    consent: false
  }).catch((e) => console.warn('[newsletter] lead capture skipped:', e && e.message));
};
