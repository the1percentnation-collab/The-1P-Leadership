// Resources page — stub for now. Renders the Academy shell and the user chip.

import { onAuthReady, currentUser } from './auth.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { getRoleInfo } from './roles.js';
import { firebaseReady } from './firebase.js';
import { getUserProfile } from './community.js';
import { renderTopbar, renderTopbarEarly } from './topbar.js';
import { renderShell } from './academy-shell.js';

async function main() {
  if (firebaseReady) {
    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
      return;
    }
    if (!(await ensureOnboarded(user))) return;
  }

  // Shell first — it carries navigation and must survive a slow or failed
  // load below. It paints from the role cached in localStorage.
  renderShell({ current: 'resources' });
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });

  let role = null;
  let profile = null;
  try {
    if (firebaseReady && currentUser()) {
      const info = await getRoleInfo();
      role = info.role;
      try { profile = await getUserProfile(currentUser().uid); } catch (e) {}
    }
  } catch (e) {}

  // Nav and sign-out live in the sidebar, so the chip keeps only search,
  // the bell and the avatar.
  renderShell({ current: 'resources', role });
  renderTopbar({ user: currentUser(), profile, role, currentPage: null, links: [], withSignOut: false });
}

main();
