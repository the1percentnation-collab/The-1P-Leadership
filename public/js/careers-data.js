// Join the Team (/join): the open roles.
//
// One place to change what is posted. To open or close a role, flip `open`.
// A closed role disappears from the page and from the form's role list.
// To add a role, add an entry here AND its tag in functions/careers.js, so
// the inquiry lands in the CRM filtered under the right tag.
// tests/careers.test.mjs fails if the two lists drift.
//
// Copy rules for the financial roles: no compensation figures, no product
// offers, no named broker-dealer or carrier. Licensing, registration and
// supervision are discussed in conversation, never on the page.

export const TEAMS = [
  {
    key: 'coaching',
    label: 'The Coaching Team',
    org: 'The One Percent Nation',
    intro: 'Certified 1P coaches deliver the workshops and monthly coaching inside our corporate programs. Same frameworks, same standard, more rooms.'
  },
  {
    key: 'financial',
    label: 'The Financial Team',
    org: 'Aligned Wealth',
    intro: 'Aligned growth includes your money. We are building a team of financial professionals who bring the same intention to a client\'s finances that The One Percent brings to everything else.',
    disclaimer: 'Aligned Wealth is a separate company from The One Percent Nation. This page describes roles we are building toward. It is not an offer of employment or a contract, and nothing here offers or recommends any insurance or securities product. Licensing, registration, and supervision are discussed directly, never on this page.'
  }
];

export const ROLES = [
  {
    key: 'coach',
    team: 'coaching',
    open: true,
    title: '1P Certified Coach',
    meta: ['Delivery team', 'Remote and on-site', 'Per engagement'],
    summary: 'Deliver One Percent workshops and monthly team coaching inside corporate annual programs, using the framework you are certified in.',
    does: [
      'Facilitate workshops built on One Percent content modules',
      'Run monthly coaching sessions for teams inside annual programs',
      'Report progress against the measures each client agreed to up front'
    ],
    fits: [
      'Holds the 1P Certified Life Coach credential, or is enrolled and on track to finish',
      'Comfortable leading sales teams, leadership teams, and faith-based organizations',
      'Runs a session on structure and time, not on personality'
    ],
    path: { text: 'Not certified yet? The 16-week certification is the way in.', href: '/clc', label: 'See the certification' }
  },
  {
    key: 'life-insurance',
    team: 'financial',
    open: true,
    title: 'Life Insurance Professional',
    meta: ['Aligned Wealth', 'Building now'],
    summary: 'Help families and business owners protect what they are building, with a team that trains together and holds a standard.',
    does: [
      'Meet with clients to understand what they need to protect and why',
      'Build coverage recommendations around the client\'s goals',
      'Grow a long-term practice with the support of the team'
    ],
    fits: [
      'Holds a life and health license, or is ready to earn one',
      'Wants to build a lasting practice, not chase quick wins',
      'Leads with service, integrity, and follow-through'
    ]
  },
  {
    key: 'securities',
    team: 'financial',
    open: true,
    title: 'Investment and Securities Professional',
    meta: ['Aligned Wealth', 'Building now'],
    summary: 'Help clients plan for the long term, as part of a financial team built on alignment and discipline.',
    does: [
      'Work with clients on long-term planning goals',
      'Translate a client\'s priorities into a plan they understand and own',
      'Do the work the right way, inside the rules that govern it'
    ],
    fits: [
      'Holds the securities registrations the role requires, or is committed to earning them',
      'Treats compliance as part of the craft, not an obstacle',
      'Thinks in decades, not quarters'
    ]
  }
];

export const NOT_SURE = { key: 'not-sure', title: 'Not sure yet' };

export const openRoles = () => ROLES.filter((r) => r.open);

/** The role a ?role= link or an Inquire button asked for, if it is open. */
export function roleByKey(key) {
  if (key === NOT_SURE.key) return NOT_SURE;
  return openRoles().find((r) => r.key === key) || null;
}
