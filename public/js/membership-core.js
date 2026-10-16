// The One Percent Membership: one monthly or annual subscription that opens
// every self-paced course in the membership. Certifications, books (the
// ebook library included), and live sessions are never part of it.
//
// Pure: no imports, no DOM. The membership page, the course gates, and the
// server (functions/membership-core.js, a generated CommonJS copy) all use
// this one source:
//   node scripts/build-membership-server.cjs
// tests/membership.test.mjs fails if the copies drift.
//
// Access is never written into a member's enrolledCourseSlugs. Membership is
// its own flag (users/{uid}.membershipActive, server-written), checked beside
// enrollment, so ending a membership can never take away a course someone
// bought outright, and buying a course never depends on staying a member.

export const MEMBERSHIP_NAME = 'The One Percent Membership';

// Founding members keep their rate for as long as they stay members.
export const FOUNDING_LIMIT = 100;

export const PLANS = {
  founding: { key: 'founding', label: 'Founding member', month: 29, year: 290 },
  standard: { key: 'standard', label: 'Member', month: 39, year: 390 }
};

// Certifications are paid programs and are never included, whatever any
// course record or admin setting says. The server, the security rules, and
// the course console all enforce this list.
export const CERTIFICATION_SLUGS = ['1p-clc', '1p-clc-leader'];

// Included until the owner changes the list in the course console.
export const DEFAULT_INCLUDED = [
  'icant', 'mindset-foundations', 'performance-discipline', 'business-alignment',
  'faith-leadership', 'one-percent-brief', 'the-focus-tax'
];

// Members who move on to a certification get up to this many months of dues
// credited toward it, once.
export const CERT_CREDIT_MONTHS = 3;

export function isCertification(slug, course) {
  return CERTIFICATION_SLUGS.includes(String(slug || '')) || !!(course && course.certification === true);
}

/** The included course list from config/membership, certifications removed. */
export function includedSlugs(config) {
  const list = config && Array.isArray(config.includedSlugs) ? config.includedSlugs : DEFAULT_INCLUDED;
  return [...new Set(list.map(String))].filter((s) => s && !isCertification(s));
}

export function isActiveMember(user) {
  return !!(user && user.membershipActive === true);
}

/** Does this user's membership open this course? (Enrollment is separate.) */
export function memberHasCourse(user, config, slug, course) {
  return isActiveMember(user) && !isCertification(slug, course) && includedSlugs(config).includes(slug);
}

/** Founding rate while founding spots remain, standard after. */
export function planForSignup(foundingCount) {
  return (Number(foundingCount) || 0) < FOUNDING_LIMIT ? 'founding' : 'standard';
}

export function foundingSpotsLeft(foundingCount) {
  return Math.max(0, FOUNDING_LIMIT - (Number(foundingCount) || 0));
}

/** Price in whole dollars for a plan and billing period. */
export function priceFor(planKey, billing) {
  const plan = PLANS[planKey] || PLANS.standard;
  return billing === 'year' ? plan.year : plan.month;
}

/**
 * The credit an active member gets toward a certification, in dollars:
 * their monthly rate for each paid month, up to CERT_CREDIT_MONTHS, once.
 * Zero for anything that is not a certification.
 */
export function certificationCredit(user, slug, course) {
  if (!isCertification(slug, course) || !isActiveMember(user)) return 0;
  const m = (user && user.membership) || {};
  if (m.certCreditUsedAt) return 0;
  const months = Math.min(CERT_CREDIT_MONTHS, Math.max(0, Math.floor(Number(m.paidMonths) || 0)));
  const plan = PLANS[m.plan] || PLANS.standard;
  return months * plan.month;
}
