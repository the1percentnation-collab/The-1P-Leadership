// /arc: the advance reader sign-up. One public link for readers: create an
// account (or sign in), agree to leave a review, and claimArcCopy puts the
// full digital edition in their library. Then straight into the reader.
//
// config/arc is public so a closed or full sign-up says so before anyone
// makes an account for nothing. The server checks again on claim.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady, signupEmail, loginEmail, loginGoogle, resetPassword, signOut } from './auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// 'new' creates an account, 'signin' uses an existing one, 'member' is
// already signed in and only needs to claim.
let mode = 'new';
let user = null;

function show(state) {
  for (const id of ['st-loading', 'st-form', 'st-done', 'st-closed']) $(id).hidden = id !== state;
}

function closed(title, msg) {
  $('closed-title').textContent = title;
  $('closed-msg').textContent = msg;
  show('st-closed');
}

function setErr(msg, fieldId) {
  for (const id of ['first', 'last', 'email', 'password']) $(id).removeAttribute('aria-invalid');
  $('err').hidden = !msg;
  $('err').textContent = msg || '';
  if (fieldId) { $(fieldId).setAttribute('aria-invalid', 'true'); $(fieldId).focus(); }
}

function busy(on, label) {
  $('submit').disabled = on;
  $('google').disabled = on;
  $('submit').textContent = on ? label : 'Get my advance copy';
}

function setMode(next) {
  mode = next;
  const member = mode === 'member';
  $('name-row').hidden = mode === 'signin' || member;
  $('account-fields').hidden = member;
  $('signed-in').hidden = !member;
  $('or').hidden = member;
  $('google').hidden = member;
  $('reset-wrap').hidden = mode !== 'signin';
  $('pw-label').textContent = mode === 'signin' ? 'Password' : 'Create a password (8+ characters)';
  $('password').autocomplete = mode === 'signin' ? 'current-password' : 'new-password';
  $('form-sub').textContent = member
    ? 'You are signed in. Confirm below and the book opens right away.'
    : mode === 'signin'
      ? 'Sign in with your One Percent account and the book opens right away.'
      : 'Create your free account and the book opens right away.';
  if (member) {
    $('signed-in').innerHTML = '';
    const who = document.createElement('span');
    who.innerHTML = 'Signed in as <strong></strong>. ';
    who.querySelector('strong').textContent = user.email || user.displayName || 'you';
    const out = document.createElement('button');
    out.type = 'button'; out.className = 'linkish'; out.textContent = 'Not you?';
    out.addEventListener('click', async () => { await signOut(); user = null; setMode('new'); });
    $('signed-in').append(who, out);
    $('switch-wrap').hidden = true;
  } else {
    $('switch-wrap').hidden = false;
    $('switch-text').textContent = mode === 'signin' ? 'New here?' : 'Already have a One Percent account?';
    $('switch').textContent = mode === 'signin' ? 'Create an account' : 'Sign in instead';
  }
  setErr('');
}

function authMessage(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/invalid-email') return ['Please enter a valid email address.', 'email'];
  if (code === 'auth/weak-password') return ['Choose a password with at least 8 characters.', 'password'];
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return ['That email and password do not match. Try again or reset your password.', 'password'];
  }
  if (code === 'auth/too-many-requests') return ['Too many attempts. Wait a minute and try again.', null];
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return ['', null];
  if (code === 'auth/network-request-failed') return ['No connection. Check your internet and try again.', null];
  return [(e && e.message) || 'Something went wrong. Please try again.', null];
}

async function claim(name) {
  busy(true, 'Opening your copy…');
  try {
    const res = await httpsCallable(functions, 'claimArcCopy')({
      name,
      reviewPlatform: $('platform').value,
      agreesToReview: true,
      consent: $('updates').checked
    });
    const readUrl = (res.data && res.data.readUrl) || '/read?book=i-cant';
    $('read-link').href = readUrl;
    $('done-msg').textContent = res.data && res.data.already
      ? 'Your advance copy is already in your library. Opening it now.'
      : 'Your advance copy is in your library, and the link is in your inbox too. Opening it now.';
    show('st-done');
    try { gtag('event', 'arc_claim', { already: !!(res.data && res.data.already) }); } catch (e) {}
    setTimeout(() => location.assign(readUrl), 1800);
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'functions/failed-precondition' && /closed/i.test(e.message || '')) {
      closed('Sign-ups Are Closed', e.message);
    } else if (code === 'functions/resource-exhausted') {
      closed('All Copies Claimed', e.message);
    } else {
      setErr((e && e.message) || 'We could not claim your copy. Please try again.');
    }
  } finally {
    busy(false);
  }
}

async function onSubmit(ev) {
  ev.preventDefault();
  setErr('');
  if (!$('agree').checked) { setErr('Advance copies go to readers who agree to leave an honest review.'); return; }

  if (mode === 'member') { await claim(user.displayName || ''); return; }

  const first = $('first').value.trim();
  const last = $('last').value.trim();
  const email = $('email').value.trim().toLowerCase();
  const password = $('password').value;
  if (mode === 'new' && !first) { setErr('Please enter your first name.', 'first'); return; }
  if (mode === 'new' && !last) { setErr('Please enter your last name.', 'last'); return; }
  if (!EMAIL_RE.test(email)) { setErr('Please enter a valid email address.', 'email'); return; }
  if (mode === 'new' && password.length < 8) { setErr('Choose a password with at least 8 characters.', 'password'); return; }
  if (mode === 'signin' && !password) { setErr('Enter your password.', 'password'); return; }

  const displayName = `${first} ${last}`.trim();
  busy(true, mode === 'new' ? 'Creating your account…' : 'Signing in…');
  try {
    if (mode === 'new') {
      try {
        user = await signupEmail({ email, password, displayName });
      } catch (e) {
        if (e && e.code !== 'auth/email-already-in-use') throw e;
        // They already have an account. The password they typed may be it.
        try {
          user = await loginEmail(email, password);
        } catch (e2) {
          setMode('signin');
          $('email').value = email;
          setErr('That email already has a One Percent account. Enter its password, or reset it below.', 'password');
          busy(false);
          return;
        }
      }
    } else {
      user = await loginEmail(email, password);
    }
  } catch (e) {
    const [msg, field] = authMessage(e);
    setErr(msg, field);
    busy(false);
    return;
  }
  // Signed in from here on, so a failed claim retries without a new account.
  setMode('member');
  await claim(displayName || user.displayName || '');
}

async function onGoogle() {
  setErr('');
  if (!$('agree').checked) { setErr('Advance copies go to readers who agree to leave an honest review.'); return; }
  busy(true, 'Signing in…');
  try {
    user = await loginGoogle();
  } catch (e) {
    const [msg, field] = authMessage(e);
    setErr(msg, field);
    busy(false);
    return;
  }
  setMode('member');
  await claim(user.displayName || '');
}

async function onReset() {
  const email = $('email').value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) { setErr('Enter your email above, then tap reset.', 'email'); return; }
  try {
    await resetPassword(email);
    setErr('');
    $('err').hidden = false;
    $('err').textContent = `If ${email} has an account, a reset link is on its way. Come back to this page after you set a new password.`;
  } catch (e) {
    setErr(authMessage(e)[0]);
  }
}

async function main() {
  if (!firebaseReady) {
    closed('Temporarily Unavailable', 'We could not reach the sign-up service. Refresh the page in a moment.');
    return;
  }
  $('arc-form').addEventListener('submit', onSubmit);
  $('google').addEventListener('click', onGoogle);
  $('switch').addEventListener('click', () => setMode(mode === 'signin' ? 'new' : 'signin'));
  $('reset').addEventListener('click', onReset);

  const [cfgSnap, u] = await Promise.all([
    getDoc(doc(db, 'config', 'arc')).catch(() => null),
    onAuthReady()
  ]);
  const cfg = cfgSnap && cfgSnap.exists() ? cfgSnap.data() : {};
  if (cfg.open === false) {
    closed('Sign-ups Are Closed', 'Advance copies are not open right now. You can still read chapter one free.');
    return;
  }
  const limit = Number(cfg.limit) > 0 ? Math.floor(Number(cfg.limit)) : null;
  const claimed = Math.max(0, Math.floor(Number(cfg.claimed) || 0));
  if (limit != null && claimed >= limit) {
    closed('All Copies Claimed', 'Every advance copy has been claimed. Thank you for your interest. Chapter one is still free.');
    return;
  }
  if (limit != null) {
    $('seats').textContent = `${limit - claimed} of ${limit} copies left`;
    $('seats').hidden = false;
  }
  user = u;
  setMode(user ? 'member' : 'new');
  show('st-form');
}

main();
