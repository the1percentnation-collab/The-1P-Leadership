// "Your next step" — the one honest answer to "what should I do here?".
//
// A dashboard that only reports state makes the member decide what matters.
// This decides for them: it walks an ordered list of candidate actions, keeps
// the ones that actually apply, and hands back the top few.
//
// Pure by design — it reads a context object and returns data. hub.js gathers
// the context and renders the result, so the ordering rules stay testable and
// in one place instead of smeared across render functions.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Profile fields that make a member findable and worth following in the
// community. Deliberately short: a completeness meter nobody can finish is
// just a permanent red mark.
const PROFILE_FIELDS = ['displayName', 'avatarUrl', 'bio', 'profession', 'location'];

export function profileCompleteness(profile) {
  if (!profile) return { pct: 0, missing: PROFILE_FIELDS.slice() };
  const missing = PROFILE_FIELDS.filter((f) => !String(profile[f] || '').trim());
  return {
    pct: Math.round(((PROFILE_FIELDS.length - missing.length) / PROFILE_FIELDS.length) * 100),
    missing
  };
}

function fmtWhen(ms) {
  if (!ms) return '';
  const delta = ms - Date.now();
  if (delta < 0) return 'Started';
  if (delta < HOUR) return `In ${Math.max(1, Math.round(delta / (60 * 1000)))} min`;
  if (delta < DAY) return `In ${Math.round(delta / HOUR)} hr`;
  const days = Math.round(delta / DAY);
  return days === 1 ? 'Tomorrow' : `In ${days} days`;
}

/**
 * Build the ranked action list.
 *
 * context: {
 *   enrolled:      [{ course, completion }]  // completion from loadCourseCompletion
 *   events:        [{ id, title, startsAtMs, registered, joinUrl }]
 *   notifications: [{ type, read, fromName, postId }]
 *   profile, certification, hasPosted
 *   profileNudgeShown: true when the first-login setup card is already on the
 *                      page, so this list does not repeat its ask
 * }
 *
 * Returns [{ key, eyebrow, title, sub, ctaLabel, href, external, urgent }].
 */
export function buildNextSteps(context = {}, { max = 4 } = {}) {
  const {
    enrolled = [],
    events = [],
    notifications = [],
    profile = null,
    certification = null,
    hasPosted = true,
    profileNudgeShown = false
  } = context;

  const out = [];
  const now = Date.now();

  // 1. Resume the course with real momentum — the one furthest along but not
  //    finished. Starting a member on the course they have already invested in
  //    beats sending them back to a catalog.
  const resumable = enrolled
    .filter((e) => e.completion && e.completion.total > 0 && !e.completion.isComplete)
    .sort((a, b) => b.completion.done - a.completion.done)[0];
  if (resumable) {
    const { course, completion } = resumable;
    const nextModule = completion.modules.find((m) => !completion.completed.has(m.id)) || completion.modules[0];
    out.push({
      key: 'resume',
      eyebrow: 'Pick up where you left off',
      title: nextModule ? nextModule.title : course.title,
      sub: `${course.title} · ${completion.done} of ${completion.total} modules · ${completion.pct}%`,
      ctaLabel: completion.done === 0 ? 'Start' : 'Resume',
      href: `/courses.html?course=${encodeURIComponent(course.slug)}${nextModule ? `&module=${nextModule.id}` : ''}`
    });
  }

  // 2. A call you already registered for, starting within two days. This is
  //    the only card that carries a live join link, so it outranks everything
  //    except unfinished work the member chose to do.
  const imminent = events
    .filter((e) => e.registered && e.startsAtMs && e.startsAtMs > now - 2 * HOUR && e.startsAtMs < now + 2 * DAY)
    .sort((a, b) => a.startsAtMs - b.startsAtMs)[0];
  if (imminent) {
    out.push({
      key: `join-${imminent.id}`,
      eyebrow: fmtWhen(imminent.startsAtMs),
      title: imminent.title,
      sub: "You're registered. The room opens at start time.",
      ctaLabel: imminent.joinUrl ? 'Join' : 'Details',
      href: imminent.joinUrl || '/events',
      external: !!imminent.joinUrl,
      urgent: true
    });
  }

  // 3. An event inside a week that they have not claimed a seat for.
  const upcoming = events
    .filter((e) => !e.registered && e.startsAtMs && e.startsAtMs > now && e.startsAtMs < now + 7 * DAY)
    .sort((a, b) => a.startsAtMs - b.startsAtMs)[0];
  if (upcoming) {
    out.push({
      key: `register-${upcoming.id}`,
      eyebrow: fmtWhen(upcoming.startsAtMs),
      title: upcoming.title,
      sub: 'Open to members. Claim your seat before it fills.',
      ctaLabel: 'Register',
      href: '/events'
    });
  }

  // 4. Certification requirements. These block a credential the member has
  //    already paid for, so the specific gap is worth naming outright.
  if (certification && !certification.certified) {
    const gaps = [];
    if (certification.hoursMet === false) {
      const short = Math.max(0, Number(certification.requiredHours || 0) - Number(certification.approvedHours || 0));
      if (short > 0) gaps.push({ title: `Log ${short} more coaching hours` });
    }
    if (!certification.capstoneSubmitted) gaps.push({ title: 'Submit your capstone' });
    else if (!certification.capstoneApproved) gaps.push({ title: 'Capstone under review' });
    if (!certification.examPassed && Number(certification.attemptsUsed || 0) === 0) {
      gaps.push({ title: 'Take the written exam' });
    }
    if (gaps.length) {
      out.push({
        key: 'certification',
        eyebrow: 'Certification',
        title: gaps[0].title,
        sub: gaps.length > 1 ? `${gaps.length} requirements left before you certify.` : 'One requirement left before you certify.',
        ctaLabel: 'Open',
        // The certification console lives inside the CLC player, not on a page
        // of its own — see clcPlayerExtras() in clc-certification.js.
        href: '/courses.html?course=1p-clc'
      });
    }
  }

  // 5. Somebody is waiting on a reply. Mentions first — being named and
  //    ignored is the fastest way to lose a member.
  const unread = notifications.filter((n) => !n.read);
  const mention = unread.find((n) => n.type === 'mention') || unread.find((n) => n.type === 'comment');
  if (mention) {
    out.push({
      key: 'reply',
      eyebrow: mention.type === 'mention' ? 'You were mentioned' : 'New reply',
      title: mention.fromName ? `${mention.fromName} is waiting on you` : 'Someone replied to you',
      sub: (mention.preview || '').slice(0, 90) || 'Head into the community and answer.',
      ctaLabel: 'Reply',
      // Same deep-link shape the notification bell uses (notifHref in topbar.js).
      href: mention.postId
        ? `/community.html?channel=${encodeURIComponent(mention.category || 'general')}#post-${encodeURIComponent(mention.postId)}`
        : '/community.html'
    });
  }

  // 6. An incomplete profile makes a member invisible to everyone else here.
  //    Skipped when the setup card above is already making the same ask with a
  //    full checklist — two nudges for one job is noise.
  const prof = profileCompleteness(profile);
  if (prof.pct < 100 && !profileNudgeShown) {
    out.push({
      key: 'profile',
      eyebrow: `Profile ${prof.pct}% complete`,
      title: 'Finish your profile',
      sub: `Add your ${prof.missing.slice(0, 2).join(' and ')} so other members know who they're talking to.`,
      ctaLabel: 'Edit profile',
      href: '/profile.html'
    });
  }

  // 7. No courses at all — the only sensible next step is the catalog.
  if (!enrolled.length) {
    out.push({
      key: 'browse',
      eyebrow: 'Start your work',
      title: 'Choose your first course',
      sub: 'The Academy library is open. Pick the track that matches where you are.',
      ctaLabel: 'Browse courses',
      href: '/courses.html'
    });
  }

  // 8. Lurkers. A first post is the strongest predictor that somebody stays.
  if (!hasPosted) {
    out.push({
      key: 'introduce',
      eyebrow: 'Community',
      title: 'Introduce yourself',
      sub: 'Post in #general. Members who say hello in week one stay.',
      ctaLabel: 'Say hello',
      href: '/community.html?channel=general'
    });
  }

  return out.slice(0, max);
}
