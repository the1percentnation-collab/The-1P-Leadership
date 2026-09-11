// Homepage footer: beta tester signup → portal lead capture.
//
// Unlike the newsletter hook, this one is awaited: an applicant should see a
// real confirmation or a real error, not an alert that fires regardless of
// whether the request landed. Submissions land in the CRM tagged Beta Tester
// with the course they chose and their note.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function msg(text, kind) {
  const el = $('beta-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'beta-msg' + (kind ? ' ' + kind : '');
}

const form = $('beta-form');
if (form) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('beta-name').value.trim();
    const email = $('beta-email').value.trim();
    if (!name) { msg('Please add your name.', 'err'); $('beta-name').focus(); return; }
    if (!EMAIL_RE.test(email)) { msg('Please add a valid email.', 'err'); $('beta-email').focus(); return; }
    if (!firebaseReady) {
      msg('The form is unavailable right now. Email anthonybrown@the1pnation.com with "beta" in the subject.', 'err');
      return;
    }

    const btn = $('beta-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    msg('');

    // One program in beta for now. Sent as a field so the CRM record says which.
    const fields = { course: "I Can't: The Course", why: $('beta-why').value.trim() };
    Object.keys(fields).forEach((k) => { if (!fields[k]) delete fields[k]; });

    try {
      await httpsCallable(functions, 'submitLeadForm')({
        formType: 'beta-tester',
        name,
        email,
        phone: $('beta-phone').value.trim() || undefined,
        fields,
        consent: $('beta-consent').checked
      });
      form.style.display = 'none';
      $('beta-done').classList.add('show');
    } catch (e) {
      console.warn('[beta-lead] submit failed', e);
      btn.disabled = false;
      btn.textContent = 'Apply to beta test →';
      msg((e && e.message) || 'Could not send that. Please try again.', 'err');
    }
  });
}
