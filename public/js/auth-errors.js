// auth-errors.js — map raw Firebase Auth errors to generic, non-enumerating copy.
//
// Surfacing Firebase's raw messages lets an attacker enumerate accounts: they
// distinguish "user not found" from "wrong password" on sign-in and reveal
// whether an email is registered on password reset. This helper returns generic
// user-facing copy for those cases while keeping the real error in the console
// for debugging. Pair it with Firebase's console "Email Enumeration Protection".

export function friendlyAuthError(err, context = 'signin') {
  const code = (err && err.code) || '';
  // Always keep the real error available for debugging.
  try { console.warn('[auth]', context, code || (err && err.message) || err); } catch (e) {}

  // These are safe to surface specifically (not account-enumerating).
  if (code === 'auth/network-request-failed') {
    return 'Network error. Check your connection and try again.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a moment and try again.';
  }
  if (code === 'auth/invalid-email') {
    return 'Enter a valid email address.';
  }

  switch (context) {
    case 'signup':
      if (code === 'auth/email-already-in-use') {
        // A signup form inherently reveals this; keep it actionable.
        return 'That email is already registered — try signing in instead.';
      }
      if (code === 'auth/weak-password') {
        return 'Please choose a stronger password (8+ characters).';
      }
      return 'Could not create your account. Please try again.';
    case 'google':
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return 'Sign-in was cancelled.';
      }
      return 'Google sign-in failed. Please try again.';
    case 'signin':
    default:
      // Never distinguish user-not-found vs wrong-password.
      return 'Check your email and password and try again.';
  }
}
