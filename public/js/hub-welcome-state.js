// First-login state — the decisions behind the welcome experience, with no
// Firebase, no DOM and no storage, so they can be tested directly.
//
// Two questions live here:
//   1. Is this member's first visit? (drives "Welcome" vs "Welcome back" and
//      whether the tour opens by itself)
//   2. What is still missing from their account? (drives the setup checklist)
//
// hub-welcome.js owns everything impure: reading the profile, writing the
// seen-flag, and rendering.

const DAY = 24 * 60 * 60 * 1000;

// How recently someone has to have joined for the tour to still be relevant.
// Without this, shipping the tour would greet every long-standing member with
// a modal explaining what the Dashboard tab is.
export const NEW_MEMBER_WINDOW = 21 * DAY;

/** Firestore Timestamp, epoch millis or ISO string → millis (0 if unusable). */
export function toMillis(v) {
  if (!v) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v.toMillis === 'function') {
    try { return v.toMillis(); } catch (e) { return 0; }
  }
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * True the first time a member lands on the dashboard: they have never been
 * shown the tour, and they joined recently enough for that to be the reason.
 *
 * An account with no join timestamp at all predates this bookkeeping, so it
 * is treated as established and left alone.
 */
export function isNewMember(profile, { now = Date.now(), seenLocally = false } = {}) {
  if (!profile) return false;
  if (toMillis(profile.welcomeTourAt)) return false;
  if (seenLocally) return false;
  const joined = toMillis(profile.onboardingAt) || toMillis(profile.createdAt);
  if (!joined) return false;
  return now - joined < NEW_MEMBER_WINDOW;
}

// Each step is one thing a member can finish in under a minute, in the order
// that pays off soonest: be recognisable, be findable, be reachable.
export const SETUP_STEPS = [
  {
    key: 'avatarUrl',
    label: 'Add a profile photo',
    hint: 'People engage with a face, not a placeholder.',
    href: '/profile.html',
    done: (p) => !!p.avatarUrl
  },
  {
    key: 'bio',
    label: 'Write a short bio',
    hint: 'Two lines on who you are and what you are building.',
    href: '/profile.html',
    done: (p) => !!p.bio
  },
  {
    key: 'work',
    label: 'Add your role and company',
    hint: 'So the right people in the community can find you.',
    href: '/profile.html',
    done: (p) => !!(p.profession || p.company)
  },
  {
    key: 'communityGoals',
    label: 'Set your goals',
    hint: 'What you want from the Academy shapes what we surface.',
    href: '/profile.html',
    done: (p) => !!p.communityGoals
  },
  {
    key: 'location',
    label: 'Add your location',
    hint: 'Used for local events and chapter invites.',
    href: '/profile.html',
    done: (p) => !!p.location
  },
  {
    key: 'links',
    label: 'Link your site or LinkedIn',
    hint: 'Turn a profile view into a real connection.',
    href: '/profile.html',
    done: (p) => !!(p.website || p.linkedinUrl)
  },
  {
    key: 'course',
    label: 'Enroll in your first course',
    hint: 'Pick one track and take the first module today.',
    href: '/courses.html',
    done: (p, ctx) => ctx.enrolled === true
  }
];

/** The checklist as the card renders it: every step, plus the running count. */
export function setupState(profile, ctx = {}) {
  const p = profile || {};
  const steps = SETUP_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    hint: s.hint,
    href: s.href,
    isDone: !!s.done(p, ctx)
  }));
  const done = steps.filter((s) => s.isDone).length;
  return { steps, done, total: steps.length, pct: Math.round((done / steps.length) * 100) };
}

// The tour, mirroring the rail in the same order, with one line on why a
// member would ever open each tab. `icon` keys come straight from
// academy-shell so the tour shows the exact icon they will look for.
export const TOUR_STOPS = [
  {
    key: 'dashboard', icon: 'dashboard', label: 'Dashboard', href: '/dashboard.html',
    blurb: 'Your home base. Your streak, your level, what to do next, and everything happening across the Academy this week.'
  },
  {
    key: 'courses', icon: 'courses', label: 'Courses', href: '/courses.html',
    blurb: 'Every track you own, plus everything you can add. Progress saves automatically, so you can stop mid-module and pick it up anywhere.'
  },
  {
    key: 'community', icon: 'community', label: 'Community', href: '/community.html',
    blurb: 'Where the work gets discussed. Post a win, ask a question, answer one. Posting is also how you earn points and climb the leaderboard.'
  },
  {
    key: 'resources', icon: 'resources', label: 'Resources', href: '/resources.html',
    blurb: 'Templates, worksheets and downloads that go with the courses. Grab what you need, when you need it.'
  },
  {
    key: 'store', icon: 'store', label: 'Store', href: '/store.html',
    blurb: 'Books, programs and tools from The One Percent, including anything open for pre-order.'
  },
  {
    key: 'events', icon: 'events', label: 'Events', href: '/events',
    blurb: 'Live calls, workshops and sessions. Register here and the ones you are booked on show up on your dashboard.'
  },
  {
    key: 'profile', icon: 'profile', label: 'Profile', href: '/profile.html',
    blurb: 'Your photo, bio, goals and links. Finish this first — it is what everyone else in the community sees.'
  }
];

/** Clamp a step index to a real stop, whatever a caller hands in. */
export function clampStep(i) {
  const n = Number(i);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(0, Math.trunc(n)), TOUR_STOPS.length - 1);
}
