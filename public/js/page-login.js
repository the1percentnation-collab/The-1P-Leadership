import { loginEmail, loginGoogle, resetPassword, onAuthReady, signOut } from './auth.js';
    import { firebaseReady } from './firebase.js';
    import { expiredReason } from './session.js';
    import { friendlyAuthError } from './auth-errors.js';

    const $ = (id) => document.getElementById(id);
    const msg = $('auth-msg');

    function showErr(txt) { msg.innerHTML = `<div class="auth-error">${txt}</div>`; }
    function showOk(txt) { msg.innerHTML = `<div class="auth-ok">${txt}</div>`; }
    function clearMsg() { msg.innerHTML = ''; }

    function nextUrl() {
      const p = new URLSearchParams(location.search);
      const n = p.get('next');
      return n && n.startsWith('/') ? n : '/dashboard';
    }

    if (!firebaseReady) {
      showErr('Authentication service is unreachable. Check your connection and retry.');
    }

    // If already signed in, bounce to next — unless the session has already
    // exceeded its idle/absolute limit, in which case end it here silently and
    // require a real sign-in instead of resuming.
    onAuthReady(async (u) => {
      if (!u) return;
      if (expiredReason(u)) {
        try { await signOut(); } catch (e) { /* ignore */ }
        return;
      }
      location.replace(nextUrl());
    });

    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMsg();
      const email = $('email').value.trim();
      const password = $('password').value;
      if (!email || !password) return showErr('Email and password required.');
      $('btn-submit').disabled = true;
      try {
        await loginEmail(email, password);
        location.replace(nextUrl());
      } catch (err) {
        showErr(friendlyAuthError(err, 'signin'));
      } finally {
        $('btn-submit').disabled = false;
      }
    });

    $('btn-google').addEventListener('click', async () => {
      clearMsg();
      try {
        await loginGoogle();
        location.replace(nextUrl());
      } catch (err) {
        showErr(friendlyAuthError(err, 'google'));
      }
    });

    $('link-forgot').addEventListener('click', async (e) => {
      e.preventDefault();
      clearMsg();
      const email = $('email').value.trim();
      if (!email) return showErr('Enter your email first, then click Forgot password.');
      try {
        await resetPassword(email);
      } catch (err) {
        // Swallow user-not-found (and similar) so we never reveal whether an
        // email is registered. Keep the real error in the console.
        console.warn('[auth] reset', err && (err.code || err.message));
      }
      // Same neutral message whether or not the address exists.
      showOk('If that email is registered, a reset link is on the way.');
    });

