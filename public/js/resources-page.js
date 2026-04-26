// Resources page — stub for now. Just renders the shared user chip.

import { onAuthReady, currentUser } from './auth.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile } from './community.js';
import { renderTopbar } from './topbar.js';

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html');
      return;
    }
  }

  let role = null;
  let profile = null;
  try {
    if (firebaseReady && currentUser()) {
      const info = await getRoleInfo();
      role = info.role;
      try { profile = await getUserProfile(currentUser().uid); } catch (e) {}
    }
  } catch (e) {}

  // resources.html has its own primary nav (academy-tabs); chip carries
  // only the bell + avatar + sign-out so we don't duplicate the nav.
  renderTopbar({ user: currentUser(), profile, role, currentPage: null, links: [] });
}

main();
