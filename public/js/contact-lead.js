// /contact-us — public "get in touch" form → portal lead capture.
//
// The site's footer "Contact" link used to point at /contact.html, which is
// the CRM contact-detail console: a signed-out visitor was bounced to login
// and a signed-in member was bounced to the homepage. There was no way for
// anyone to actually contact the business from the site. This backs the real
// public form.
//
// Awaited by the page's submit handler, not fire-and-forget: somebody writing
// in is expecting a reply, so the confirmation must not appear unless the
// message was really stored.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

window.__1pContactLead = async ({ name, email, phone, topic, message }) => {
  if (!firebaseReady) {
    throw new Error('The form is unavailable right now. Please refresh and try again, or email the1percentnation@gmail.com.');
  }
  await httpsCallable(functions, 'submitLeadForm')({
    formType: 'contact',
    name,
    email,
    phone,
    fields: { topic, message },
    // Writing in is itself the request for a reply. Recorded so the CRM can
    // show why this contact is reachable.
    consent: true
  });
};
