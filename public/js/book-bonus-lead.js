// /book-bonus reader signup → portal lead capture.
//
// This form used to be a stub: it awaited a 900ms setTimeout and then showed
// the success panel, so every reader who claimed their bonuses was discarded
// and nobody was ever sent anything. It now writes a real contact into the
// academy CRM tagged "Book Bonus".
//
// Awaited by the page's submit handler (unlike the newsletter capture, which
// is deliberately best-effort) because here the success panel is a promise to
// the reader — it should not appear if the capture failed.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

window.__1pBookBonusLead = async ({ firstName, lastName, email }) => {
  if (!firebaseReady) {
    throw new Error('The form is unavailable right now. Please refresh and try again.');
  }
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  await httpsCallable(functions, 'submitLeadForm')({
    formType: 'book-bonus',
    name,
    email,
    fields: { firstName, lastName },
    // The page's own copy tells the reader their bonuses are emailed, which is
    // what they are asking for by submitting. Recorded explicitly so the CRM
    // can prove the opt-in.
    consent: true
  });
};
