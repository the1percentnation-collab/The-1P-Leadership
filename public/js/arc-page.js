// /arc: the advance reader sign-up. One public link for readers: first name,
// last name, email and a review promise. requestArcLink emails a one-tap
// sign-in link with the ARC terms; the link comes back here (?claim=1),
// signs them in with no password, claimArcCopy puts the full digital
// edition in their library, and they go straight into the reader.
//
// The same form, in resend mode, sends a fresh link to a reader who already
// has the book (new device, signed out, expired link).
//
// config/arc is public so a closed or full sign-up says so before anyone
// types anything. The server checks again on every request and claim.

import { auth, db, functions, firebaseReady } from './firebase.js';
import { onAuthReady, ensureUserDoc, signOut } from './auth.js';
import {
  isSignInWithEmailLink, signInWithEmailLink
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PROMISE_MSG = 'Advance copies go to readers who agree to leave an honest review.';
// The email the link was sent to, so opening it on this device needs no
// retyping. Firebase asks for it to finish an email-link sign-in.
const LS_EMAIL = 'arc:email';
const STATES = ['st-loading', 'st-form', 'st-sent', 'st-confirm', 'st-done', 'st-closed'];

// 'new' sends a sign-up link, 'resend' a fresh link for an existing reader,
// 'member' is already signed in and only needs to claim.
let mode = 'new';
let user = null;
// 'open', 'closed' or 'full', from config/arc.
let signups = 'open';
let seatsText = '';
// The last link request, for "send it again".
let lastRequest = null;

function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
function track(name, params) { try { gtag('event', name, params || {}); } catch (e) { /* no analytics */ } }

function show(state) {
  for (const id of STATES) $(id).hidden = id !== state;
}

function loading(msg) {
  $('loading-msg').textContent = msg;
  show('st-loading');
}

function closed(title, msg) {
  $('closed-title').textContent = title;
  $('closed-msg').textContent = msg;
  show('st-closed');
}

function showClosedFor(state) {
  if (state === 'full') {
    closed('All Copies Claimed', 'Every advance copy has been claimed. Thank you for your interest. Chapter one is still free.');
  } else {
    closed('Sign-ups Are Closed', 'Advance copies are not open right now. You can still read chapter one free.');
  }
}

function setErr(msg, fieldId) {
  for (const id of ['first', 'last', 'email']) $(id).removeAttribute('aria-invalid');
  $('err').hidden = !msg;
  $('err').textContent = msg || '';
  if (fieldId) { $(fieldId).setAttribute('aria-invalid', 'true'); $(fieldId).focus(); }
}

function submitLabel() {
  if (mode === 'member') return 'Get my advance copy';
  if (mode === 'resend') return 'Send my reading link';
  return 'Send my advance copy';
}

function busy(on, label) {
  $('submit').disabled = on;
  $('submit').textContent = on ? label : submitLabel();
}

function setMode(next) {
  mode = next;
  const member = mode === 'member';
  const resend = mode === 'resend';
  $('name-row').hidden = member || resend;
  $('email-row').hidden = member;
  $('signed-in').hidden = !member;
  $('promise-rows').hidden = resend;
  $('seats').hidden = resend || !seatsText;
  $('form-title').textContent = resend ? 'Get A Fresh Link' : 'Claim Your Copy';
  $('form-sub').textContent = member
    ? 'You are signed in. Confirm below and the book opens right away.'
    : resend
      ? 'Enter the email you signed up with. We will send a new link that opens your book.'
      : 'Tell us where to send it. We email you a link that opens the book. No password needed.';
  $('switch-wrap').hidden = member;
  $('switch-text').textContent = resend ? 'New here?' : 'Already have your copy?';
  $('switch').textContent = resend ? 'Claim an advance copy' : 'Get a fresh reading link';
  if (member) {
    $('signed-in').innerHTML = '';
    const who = document.createElement('span');
    who.innerHTML = 'Signed in as <strong></strong>. ';
    who.querySelector('strong').textContent = user.email || user.displayName || 'you';
    const out = document.createElement('button');
    out.type = 'button'; out.className = 'linkish'; out.textContent = 'Not you?';
    out.addEventListener('click', async () => { await signOut(); user = null; setMode('new'); });
    $('signed-in').append(who, out);
  }
  busy(false);
  setErr('');
}

// From the form: back to the right screen for a new reader.
function toSignup() {
  if (signups !== 'open') { showClosedFor(signups); return; }
  setMode(user ? 'member' : 'new');
  show('st-form');
}

function toResend(email) {
  setMode('resend');
  if (email) $('email').value = email;
  show('st-form');
  $('email').focus();
}

function functionsMessage(e, fallback) {
  const code = (e && e.code) || '';
  if (code === 'functions/resource-exhausted' && /too many|rate/i.test(e.message || '')) {
    return 'Too many tries. Wait a few minutes and try again.';
  }
  if (code === 'functions/unavailable' || code === 'functions/internal') {
    return (e && e.message && code === 'functions/unavailable') ? e.message : 'We could not reach the server. Please try again.';
  }
  return (e && e.message) || fallback;
}

// A closed or full answer from the server wins over what config/arc said.
function handleClosed(e) {
  const code = (e && e.code) || '';
  const msg = (e && e.message) || '';
  if (code === 'functions/failed-precondition' && /closed/i.test(msg)) { signups = 'closed'; closed('Sign-ups Are Closed', msg); return true; }
  if (code === 'functions/resource-exhausted' && /claimed/i.test(msg)) { signups = 'full'; closed('All Copies Claimed', msg); return true; }
  return false;
}

// ── Step 1: the form emails a sign-in link ──────────────────────────────

async function requestLink(payload) {
  busy(true, 'Sending…');
  try {
    await httpsCallable(functions, 'requestArcLink')(payload);
    lsSet(LS_EMAIL, payload.email);
    lastRequest = payload;
    $('sent-msg').textContent = payload.resend
      ? `If ${payload.email} has an advance copy, a fresh reading link is on its way. Tap Start reading in that email and your book opens.`
      : `We sent your reading link to ${payload.email}. Tap Start reading in that email and the book opens.`;
    show('st-sent');
    track(payload.resend ? 'arc_link_resent' : 'arc_link_requested');
    return true;
  } catch (e) {
    if (!handleClosed(e)) setErr(functionsMessage(e, 'We could not send your link. Please try again.'));
    return false;
  } finally {
    busy(false);
  }
}

async function onSubmit(ev) {
  ev.preventDefault();
  setErr('');

  if (mode === 'member') {
    if (!$('agree').checked) { setErr(PROMISE_MSG); return; }
    await claimAndOpen({ agreesToReview: true, consent: $('updates').checked, name: user.displayName || '' });
    return;
  }

  const email = $('email').value.trim().toLowerCase();
  if (mode === 'resend') {
    if (!EMAIL_RE.test(email)) { setErr('Please enter a valid email address.', 'email'); return; }
    await requestLink({ email, resend: true });
    return;
  }

  const firstName = $('first').value.trim();
  const lastName = $('last').value.trim();
  if (!firstName) { setErr('Please enter your first name.', 'first'); return; }
  if (!lastName) { setErr('Please enter your last name.', 'last'); return; }
  if (!EMAIL_RE.test(email)) { setErr('Please enter a valid email address.', 'email'); return; }
  if (!$('agree').checked) { setErr(PROMISE_MSG); return; }
  await requestLink({ firstName, lastName, email, agreesToReview: true, consent: $('updates').checked });
}

async function onResend() {
  if (!lastRequest) { toResend(lsGet(LS_EMAIL)); return; }
  const btn = $('resend');
  btn.disabled = true;
  const sent = await requestLink(lastRequest);
  btn.disabled = false;
  if (sent) $('sent-msg').textContent += ' We just sent it again.';
  else { show('st-form'); }
}

// ── Step 2: the link comes back here and opens the book ─────────────────

async function finishLink(email, fromConfirm) {
  if (!email) {
    show('st-confirm');
    $('confirm-email').focus();
    return;
  }
  loading('Opening your advance copy…');
  try {
    const cred = await signInWithEmailLink(auth, email, location.href);
    user = cred.user;
  } catch (e) {
    const code = (e && e.code) || '';
    if (code === 'auth/invalid-email' || code === 'auth/missing-email') {
      show('st-confirm');
      $('confirm-err').hidden = false;
      $('confirm-err').textContent = fromConfirm
        ? 'That email does not match the link. Use the email you signed up with.'
        : 'Confirm the email you signed up with.';
      $('confirm-email').focus();
      return;
    }
    if (code === 'auth/network-request-failed') {
      show('st-confirm');
      $('confirm-email').value = email;
      $('confirm-err').hidden = false;
      $('confirm-err').textContent = 'No connection. Check your internet and try again.';
      return;
    }
    // Expired, already used, or mangled by an email scanner.
    history.replaceState(null, '', '/arc');
    toResend(email);
    setErr('That link has expired or was already used. Tap below and we will send a fresh one.');
    return;
  }
  lsDel(LS_EMAIL);
  history.replaceState(null, '', '/arc');
  try { await ensureUserDoc(user); } catch (e) { console.warn('[arc] profile setup failed', e); }
  await claimAndOpen({});
}

async function onConfirm(ev) {
  ev.preventDefault();
  $('confirm-err').hidden = true;
  const email = $('confirm-email').value.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    $('confirm-err').hidden = false;
    $('confirm-err').textContent = 'Please enter a valid email address.';
    return;
  }
  await finishLink(email, true);
}

async function claimAndOpen(data) {
  loading('Opening your advance copy…');
  try {
    const res = await httpsCallable(functions, 'claimArcCopy')(data);
    const already = !!(res.data && res.data.already);
    const readUrl = (res.data && res.data.readUrl) || '/read?book=i-cant';
    $('read-link').href = readUrl;
    $('done-msg').textContent = already
      ? 'Welcome back. Opening your book now.'
      : 'Your advance copy is in your library. Opening it now.';
    show('st-done');
    track('arc_claim', { already });
    setTimeout(() => location.assign(readUrl), 1500);
  } catch (e) {
    if (handleClosed(e)) return;
    // Signed in from here on, so a retry claims without a new link.
    setMode('member');
    show('st-form');
    if ((e && e.code) === 'functions/invalid-argument') setErr('Confirm the review promise below to get your copy.');
    else setErr(functionsMessage(e, 'We could not open your copy. Please try again.'));
  }
}

// ── Start ───────────────────────────────────────────────────────────────

async function main() {
  if (!firebaseReady) {
    closed('Temporarily Unavailable', 'We could not reach the sign-up service. Refresh the page in a moment.');
    return;
  }
  $('arc-form').addEventListener('submit', onSubmit);
  $('confirm-form').addEventListener('submit', onConfirm);
  $('switch').addEventListener('click', () => { if (mode === 'resend') toSignup(); else toResend($('email').value.trim()); });
  $('closed-switch').addEventListener('click', () => toResend(''));
  $('resend').addEventListener('click', onResend);
  $('change-email').addEventListener('click', () => {
    if (lastRequest && lastRequest.resend) toResend('');
    else { toSignup(); $('email').value = ''; $('email').focus(); }
  });

  if (isSignInWithEmailLink(auth, location.href)) {
    await finishLink(lsGet(LS_EMAIL), false);
    return;
  }

  const params = new URLSearchParams(location.search);
  const [cfgSnap, u] = await Promise.all([
    getDoc(doc(db, 'config', 'arc')).catch(() => null),
    onAuthReady()
  ]);
  user = u;
  const cfg = cfgSnap && cfgSnap.exists() ? cfgSnap.data() : {};
  const limit = Number(cfg.limit) > 0 ? Math.floor(Number(cfg.limit)) : null;
  const claimed = Math.max(0, Math.floor(Number(cfg.claimed) || 0));
  signups = cfg.open === false ? 'closed' : (limit != null && claimed >= limit ? 'full' : 'open');
  if (limit != null && signups === 'open') {
    seatsText = `${limit - claimed} of ${limit} copies left`;
    $('seats').textContent = seatsText;
  }

  if (params.get('resend') === '1') { toResend(lsGet(LS_EMAIL)); return; }
  toSignup();
}

main();
