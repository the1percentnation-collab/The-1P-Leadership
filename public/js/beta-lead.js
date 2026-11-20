// Beta tester signup → member account + portal lead capture. Used by the
// standalone /beta page (and any modal that reuses the same form ids).
//
// Applying creates the member account in the same step. The form already asks
// for everything an account needs except a password, and a separate "now go
// sign up" step is where approved testers used to stall: the grant waited on
// an account that never got made. So the order is
//   1. create the account (or sign into the existing one with that password),
//   2. submit the application, signed in, so the server links the two.
// A visitor who is already signed in skips step 1 and applies as themselves.
//
// Unlike the newsletter hook, this one is awaited: an applicant should see a
// real confirmation or a real error, not an alert that fires regardless of
// whether the request landed. Submissions land in the CRM tagged Beta Tester
// with the course they chose and their note.

import { functions, firebaseReady } from './firebase.js';
import { signupEmail, loginEmail, onAuthReady } from './auth.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function msg(text, kind, { html = false } = {}) {
  const el = $('beta-msg');
  if (!el) return;
  if (html) el.innerHTML = text || ''; else el.textContent = text || '';
  el.className = 'beta-msg' + (kind ? ' ' + kind : '');
}

// Firebase's own messages read like stack traces ("Firebase: Error
// (auth/weak-password)."), so the ones an applicant can hit get plain words.
function authErrorText(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/weak-password') return 'Please choose a stronger password (8+ characters).';
  if (code === 'auth/invalid-email') return 'Please add a valid email.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a minute and try again.';
  if (code === 'auth/network-request-failed') return 'Could not reach the server. Check your connection and try again.';
  if (code === 'auth/operation-not-allowed') {
    return 'Account signup is unavailable right now. Email anthonybrown@the1pnation.com with "beta" in the subject.';
  }
  return (e && e.message) || 'Could not create your account. Please try again.';
}

// ── Open / close ─────────────────────────────────────────────────────────
// When the form lives in a modal opened from a footer strip: backdrop click,
// the × button and Escape all close it; focus goes to the first field on open
// and back to the opener on close. A completed application stays visible if
// the visitor reopens it, since the form is hidden and the thank-you shown.
const modal = $('beta-modal');
const opener = $('beta-open');
function openBeta() {
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add('beta-modal-open');
  const first = $('beta-name');
  if (first && $('beta-form').style.display !== 'none') setTimeout(() => first.focus(), 30);
}
function closeBeta() {
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove('beta-modal-open');
  if (opener) opener.focus();
}
if (opener) opener.addEventListener('click', openBeta);
if (modal) {
  modal.querySelectorAll('[data-beta-close]').forEach((el) => el.addEventListener('click', closeBeta));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeBeta(); });
}
// Deep link: /#beta-apply opens it directly (usable in emails and posts).
if (location.hash === '#beta-apply') openBeta();

// ── Signed-in visitors apply as themselves ───────────────────────────────
// Their account is the one the application links to, so the email is locked
// to it and there is no password to ask for.
let signedInUser = null;
function showSignedIn(user) {
  signedInUser = user && user.email ? user : null;
  const wrap = $('beta-password-wrap');
  const note = $('beta-signed-in');
  if (!signedInUser) {
    if (wrap) wrap.hidden = false;
    if (note) note.hidden = true;
    if ($('beta-email')) $('beta-email').readOnly = false;
    return;
  }
  if (wrap) wrap.hidden = true;
  if ($('beta-email')) { $('beta-email').value = signedInUser.email; $('beta-email').readOnly = true; }
  if ($('beta-name') && !$('beta-name').value && signedInUser.displayName) $('beta-name').value = signedInUser.displayName;
  if (note) {
    note.hidden = false;
    note.innerHTML = `Applying as <strong>${esc(signedInUser.email)}</strong>. Your beta access will show up in this account.`;
  }
}
if (firebaseReady) onAuthReady(showSignedIn);

// What the thank-you says depends on what happened to the account.
function showDone(state, email) {
  const text = $('beta-done-text');
  const cta = $('beta-done-cta');
  const approved = 'When Anthony approves you, your courses and their books land in your library and you get an email saying they are open.';
  if (state === 'created') {
    text.textContent = `Your account is ready and you are signed in as ${email}. You are on the list for every course in beta. ${approved}`;
    cta.innerHTML = '<a class="btn-primary" href="/onboarding">Set up your profile →</a>';
  } else if (state === 'signed-in') {
    text.textContent = `Your application is in and linked to your account (${email}). You are on the list for every course in beta. ${approved}`;
    cta.innerHTML = '<a class="btn-primary" href="/courses.html">Go to my courses →</a>';
  } else {
    // An account already exists for this email but the password did not
    // match it. The application still landed, and approval finds the account
    // by email, so all that is left is for them to get back into it.
    text.textContent = `Your application is in. You already have an account with ${email}, so your beta access will be added to it when Anthony approves you. Sign in with your existing password to see it, or reset the password if you have lost it.`;
    cta.innerHTML = '<a class="btn-primary" href="/login.html">Sign in →</a>';
  }
}

const form = $('beta-form');
if (form) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const name = $('beta-name').value.trim();
    const email = $('beta-email').value.trim();
    const passwordEl = $('beta-password');
    const password = passwordEl ? passwordEl.value : '';
    if (!name) { msg('Please add your name.', 'err'); $('beta-name').focus(); return; }
    if (!EMAIL_RE.test(email)) { msg('Please add a valid email.', 'err'); $('beta-email').focus(); return; }
    if (!firebaseReady) {
      msg('The form is unavailable right now. Email anthonybrown@the1pnation.com with "beta" in the subject.', 'err');
      return;
    }
    const applyingSignedIn = !!signedInUser;
    if (!applyingSignedIn && password.length < 8) {
      msg('Please create a password (8+ characters). It is the password for your member account.', 'err');
      if (passwordEl) passwordEl.focus();
      return;
    }

    const btn = $('beta-submit');
    btn.disabled = true;
    msg('');

    // ── 1. The account ───────────────────────────────────────────────────
    let state = applyingSignedIn ? 'signed-in' : null;
    if (!applyingSignedIn) {
      btn.textContent = 'Creating your account…';
      try {
        await signupEmail({ email, password, displayName: name });
        state = 'created';
      } catch (e) {
        if (e && e.code === 'auth/email-already-in-use') {
          // They signed up before. If this is their password, sign them in so
          // the application links to the account; if not, apply anyway.
          try { await loginEmail(email, password); state = 'signed-in'; }
          catch (e2) { state = 'exists'; }
        } else {
          console.warn('[beta-lead] account creation failed', e);
          btn.disabled = false;
          btn.textContent = 'Apply to beta test →';
          msg(authErrorText(e), 'err');
          return;
        }
      }
    }

    // ── 2. The application ───────────────────────────────────────────────
    // Testers sign up once for every course in beta. The owner picks which
    // courses to grant in the Beta Console when approving them.
    btn.textContent = 'Sending…';
    const fields = { course: 'All courses', why: $('beta-why').value.trim(), feedback_ok: $('beta-consent').checked ? 'yes' : 'no' };
    Object.keys(fields).forEach((k) => { if (!fields[k]) delete fields[k]; });

    try {
      await httpsCallable(functions, 'submitLeadForm')({
        formType: 'beta-tester',
        name,
        email,
        phone: $('beta-phone').value.trim() || undefined,
        fields,
        // Callback-only: /beta is not a declared SMS opt-in page, so the box
        // is a feedback commitment, never contact consent.
        consent: false
      });
      form.style.display = 'none';
      showDone(state, email);
      $('beta-done').classList.add('show');
    } catch (e) {
      console.warn('[beta-lead] submit failed', e);
      btn.disabled = false;
      btn.textContent = 'Apply to beta test →';
      // The account may already exist at this point. Retrying is safe: the
      // second try signs in with the same password and resubmits.
      msg(state === 'created'
        ? 'Your account was created, but the application did not send. Please press Apply again.'
        : ((e && e.message) || 'Could not send that. Please try again.'), 'err');
    }
  });
}
