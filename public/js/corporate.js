// Corporate page (/corporate.html) — Alignment Audit request capture.
//
// The Alignment Audit is the top of the corporate funnel: a free, structured
// 45-minute session that produces a written scorecard within 48 hours. It is
// the call to action on every corporate surface, so requests get their own
// lead route ('alignment-audit') rather than sharing the generic speaking
// form — they need to be findable in the CRM as a distinct pipeline.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setMsg(text, kind) {
  const el = $('audit-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'form-msg' + (kind ? ' ' + kind : '');
}

function init() {
  const form = $('audit-form');
  if (!form) return;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    const name = $('a-name').value.trim();
    const email = $('a-email').value.trim();
    if (!name) { setMsg('Please add your name.', 'err'); $('a-name').focus(); return; }
    if (!EMAIL_RE.test(email)) { setMsg('Please add a valid email.', 'err'); $('a-email').focus(); return; }

    if (!firebaseReady) {
      setMsg('The form is unavailable right now. Email anthonybrown@the1pnation.com and we\'ll set it up directly.', 'err');
      return;
    }

    const btn = $('audit-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    setMsg('');

    // Only non-empty answers are kept; submitLeadForm bounds and trims them
    // server-side and writes the set onto the CRM contact's activity.
    const fields = {
      organization: $('a-org').value.trim(),
      role: $('a-role').value.trim(),
      field: $('a-field').value,
      team_size: $('a-size').value,
      situation: $('a-problem').value.trim()
    };
    Object.keys(fields).forEach((k) => { if (!fields[k]) delete fields[k]; });

    try {
      await httpsCallable(functions, 'submitLeadForm')({
        formType: 'alignment-audit',
        name,
        email,
        phone: $('a-phone').value.trim() || undefined,
        fields,
        consent: $('a-consent').checked
      });
      form.style.display = 'none';
      $('audit-success').classList.add('show');
    } catch (e) {
      console.warn('[corporate] audit request failed', e);
      btn.disabled = false;
      btn.textContent = 'Request my Alignment Audit →';
      setMsg((e && e.message) || 'Could not send that. Please try again, or email anthonybrown@the1pnation.com.', 'err');
    }
  });
}

init();
