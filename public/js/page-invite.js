import { onAuthReady, acceptInvite } from './auth.js';
    import { firebaseReady } from './firebase.js';

    const $ = (id) => document.getElementById(id);
    const msg = $('auth-msg');
    function showErr(txt) { msg.innerHTML = `<div class="auth-error">${txt}</div>`; }
    function showOk(txt) { msg.innerHTML = `<div class="auth-ok">${txt}</div>`; }

    const params = new URLSearchParams(location.search);
    const code = (params.get('code') || '').trim();

    if (!code) {
      $('sub').textContent = 'No invite code was provided in the link.';
      showErr('The link you followed is missing ?code=XXX.');
    } else {
      $('code-display').style.display = 'block';
      $('code-display').textContent = code;
      $('sub').textContent = 'Accept your invite to join the company workspace.';
      $('btn-signup').href = `/signup.html?code=${encodeURIComponent(code)}`;
      $('btn-login').href = `/login.html?next=${encodeURIComponent('/invite.html?code=' + code)}`;
      $('actions').style.display = 'block';
    }

    if (!firebaseReady) {
      showErr('Authentication service is unreachable. Check your connection and retry.');
    } else if (code) {
      // If already signed in, accept right now.
      onAuthReady(async (u) => {
        if (!u) return;
        try {
          const res = await acceptInvite(code);
          showOk('Invite accepted. Redirecting to your dashboard…');
          setTimeout(() => location.replace('/index.html'), 1200);
        } catch (err) {
          showErr(err.message || 'Could not accept invite.');
        }
      });
    }

