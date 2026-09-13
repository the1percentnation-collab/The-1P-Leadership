// /sms — the public SMS opt-in form → portal lead capture.
//
// This page exists so the opt-in is verifiable without a login. The member
// portal's opt-in sits behind authentication, which a carrier or Twilio
// reviewer cannot reach, and an unverifiable opt-in is a standard A2P
// campaign rejection. This is the URL that goes on the registration.
//
// The checkbox text shown to the user is captured verbatim and stored with
// the contact. Under the TCPA the defensible record is the exact wording the
// person agreed to, not a paraphrase written months later.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

window.__1pSmsOptIn = async ({ name, email, phone, consentText }) => {
  if (!firebaseReady) {
    throw new Error('The form is unavailable right now. Please refresh and try again, or email the1percentnation@gmail.com.');
  }
  // Awaited, never fire-and-forget: the page must not confirm an opt-in that
  // was not actually recorded.
  await httpsCallable(functions, 'submitLeadForm')({
    formType: 'sms-optin',
    name,
    email,
    phone,
    fields: {},
    consent: true,
    consentText
  });
};
