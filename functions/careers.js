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

/** Tags for an inquiry about `roleKey`. Unknown keys fall back to Not Sure. */
function careerTags(roleKey) {
  const role = CAREER_ROLE_TAGS[roleKey] || CAREER_ROLE_TAGS['not-sure'];
  return [RECRUITING_TAG, role];
}

module.exports = { RECRUITING_TAG, CAREER_ROLE_TAGS, careerTags };
