// Join the Team inquiries: which CRM tag each role's inquiry gets.
//
// Every inquiry is tagged "Recruiting" so the whole pipeline is one filter,
// plus one tag for the role so each hiring track is its own. Keys match
// public/js/careers-data.js; tests/careers.test.mjs fails if they drift.
// The page sends the key, never a tag, so the form cannot write arbitrary
// tags onto a contact.

const RECRUITING_TAG = 'Recruiting';

const CAREER_ROLE_TAGS = {
  'coach': 'Recruit: 1P Coach',
  'life-insurance': 'Recruit: Life Insurance',
  'securities': 'Recruit: Securities',
  'not-sure': 'Recruit: Not Sure'
};

// Where the recruiting link was shared: /join?role=...&src=linkedin. Same
// rule as roles: the page sends a key, and only a key on this list becomes a
// tag, so each channel is one CRM filter. An unknown src still reaches the
// inquiry as a field, just without a tag.
const CAREER_SOURCE_TAGS = {
  'linkedin': 'Recruit Source: LinkedIn',
  'instagram': 'Recruit Source: Instagram',
  'facebook': 'Recruit Source: Facebook',
  'tiktok': 'Recruit Source: TikTok',
  'text': 'Recruit Source: Text',
  'email': 'Recruit Source: Email',
  'referral': 'Recruit Source: Referral',
  'event': 'Recruit Source: Event',
  'indeed': 'Recruit Source: Indeed',
  'website': 'Recruit Source: Website'
};

/** Tags for an inquiry about `roleKey` from `sourceKey`. Unknown roles fall back to Not Sure. */
function careerTags(roleKey, sourceKey) {
  const role = CAREER_ROLE_TAGS[roleKey] || CAREER_ROLE_TAGS['not-sure'];
  const tags = [RECRUITING_TAG, role];
  const source = Object.prototype.hasOwnProperty.call(CAREER_SOURCE_TAGS, sourceKey) ? CAREER_SOURCE_TAGS[sourceKey] : null;
  if (source) tags.push(source);
  return tags;
}

// The reply an applicant gets the moment their inquiry is saved: a link to
// pick a time to talk, so nobody waits on a hand-written email to take the
// next step. Role titles and team names come from this list, never from the
// form, so the form cannot put arbitrary text into an email we send.
// tests/careers.test.mjs holds the titles to the page's, and holds the copy
// to the financial roles' rules (no pay or income language, no firm name).
const CAREER_ROLE_REPLY = {
  'coach': { title: '1P Certified Coach', team: 'The One Percent Nation' },
  'life-insurance': { title: 'Financial Representative', team: 'Aligned Wealth' },
  'securities': { title: 'Investment and Securities Representative', team: 'Aligned Wealth' }
};
const CAREER_BOOKING_URL = 'https://the1pnation.com/book-a-call?for=team';
// Don't send the same person the reply twice in a week (double submits,
// asking about two roles back to back).
const CAREER_REPLY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * A greeting-safe first name, or '' (the email then opens "Hi,"). Anything
 * that is not plainly a name (a link, digits, markup) is dropped rather than
 * cleaned up, so the form cannot smuggle text into the greeting.
 */
function replyFirstName(name) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first.length >= 2 && /^\p{L}[\p{L}'\-]{0,28}\.?$/u.test(first) ? first : '';
}

/** The applicant's reply: { subject, text, html }. */
function careerReplyEmail({ name, roleKey }) {
  const role = CAREER_ROLE_REPLY[roleKey] || null;
  const first = replyFirstName(name);
  const hi = first ? `Hi ${first},` : 'Hi,';
  const about = role ? `the ${role.title} role` : 'joining the team';
  const subject = role ? `Next step: pick a time to talk (${role.title})` : 'Next step: pick a time to talk';
  const lines = [
    `Thanks for asking about ${about}. Your inquiry is in.`,
    'The next step is a short conversation. We walk through the work, the standard, and how getting started works, and you can ask anything you want.',
    'Pick a time that works for you below. The video link comes to your inbox as soon as you book.'
  ];
  const sign = ['Anthony Brown Sr.', role ? role.team : 'The One Percent Nation'];
  const text = [
    hi, '', ...lines.flatMap((l) => [l, '']),
    `Pick a time: ${CAREER_BOOKING_URL}`, '',
    'None of the times work? Reply to this email and we will find one.', '',
    ...sign
  ].join('\n');
  const p = (t) => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${escHtml(t)}</p>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#222;">
    <div style="height:3px;background:#E60306;margin-bottom:22px;"></div>
    ${p(hi)}
    ${lines.map(p).join('\n    ')}
    <p style="margin:22px 0 24px;"><a href="${CAREER_BOOKING_URL}" style="background:#E60306;color:#fff;padding:13px 24px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Pick a time to talk</a></p>
    <p style="font-size:13px;line-height:1.6;color:#777;margin:0 0 22px;">None of the times work? Reply to this email and we will find one.</p>
    <p style="font-size:14px;line-height:1.5;margin:0;">${sign.map(escHtml).join('<br>')}</p>
  </div>`;
  return { subject, text, html };
}

module.exports = {
  RECRUITING_TAG, CAREER_ROLE_TAGS, CAREER_SOURCE_TAGS, careerTags,
  CAREER_ROLE_REPLY, CAREER_BOOKING_URL, CAREER_REPLY_COOLDOWN_MS, replyFirstName, careerReplyEmail
};
