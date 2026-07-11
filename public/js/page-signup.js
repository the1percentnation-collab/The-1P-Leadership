import { signupEmail, loginGoogle, acceptInvite, acceptCommunityInvite, onAuthReady } from './auth.js';
    import { firebaseReady } from './firebase.js';
    import { friendlyAuthError } from './auth-errors.js';

    const $ = (id) => document.getElementById(id);
    const msg = $('auth-msg');
    function showErr(txt) { msg.innerHTML = `<div class="auth-error">${txt}</div>`; }
    function showOk(txt) { msg.innerHTML = `<div class="auth-ok">${txt}</div>`; }
    function clearMsg() { msg.innerHTML = ''; }

    // Pre-fill invite code from ?code=
    const params = new URLSearchParams(location.search);
    const preCode = params.get('code');
    if (preCode) $('inviteCode').value = preCode;

    // Community invite token (?invite=) — surface a brief banner so the
    // user knows they're joining via someone's link, then quietly attach
    // it to the signup call so the server records the use.
    const communityInviteToken = params.get('invite') || null;
    if (communityInviteToken) {
      showOk('You\'ve been invited to The One Percent Academy. Create your account to accept.');
    }

    if (!firebaseReady) {
      showErr('Authentication service is unreachable. Check your connection and retry.');
    }

    $('signup-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMsg();
      const displayName = $('displayName').value.trim();
      const email = $('email').value.trim();
      const password = $('password').value;
      const inviteCode = $('inviteCode').value.trim() || null;

      if (!email || !password || password.length < 8) {
        return showErr('Enter a valid email and password (8+ characters).');
      }
      $('btn-submit').disabled = true;
      try {
        await signupEmail({ email, password, displayName, inviteCode, communityInviteToken });
        location.replace('/onboarding');
      } catch (err) {
        showErr(friendlyAuthError(err, 'signup'));
      } finally {
        $('btn-submit').disabled = false;
      }
    });

    $('btn-google').addEventListener('click', async () => {
      clearMsg();
      try {
        await loginGoogle();
        const code = $('inviteCode').value.trim();
        if (code) {
          try { await acceptInvite(code); } catch (err) { showErr('Signed in but invite failed: ' + (err.message || err)); return; }
        }
        if (communityInviteToken) {
          try { await acceptCommunityInvite(communityInviteToken); } catch (err) { /* tolerated */ }
        }
        location.replace('/onboarding');
      } catch (err) {
        showErr(friendlyAuthError(err, 'google'));
      }
    });

