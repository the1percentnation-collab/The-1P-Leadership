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

module.exports = { RECRUITING_TAG, CAREER_ROLE_TAGS, CAREER_SOURCE_TAGS, careerTags };
