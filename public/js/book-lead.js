// Speaking / booking request page → portal lead capture.
// GoHighLevel is gone: submitLeadForm writes the request into the academy
// CRM (contact + tags + the full request as an activity). Awaited by the
// inline form handler on book.html.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

window.__1pSubmitBookingLead = async ({ name, email, phone, fields, consent }) => {
  if (!firebaseReady) {
    throw new Error('The form is unavailable right now. Please refresh and try again.');
  }
  await httpsCallable(functions, 'submitLeadForm')({
    formType: 'speaking', name, email, phone, fields, consent
  });
};
