// Join the Team (/join): the open roles.
//
// One place to change what is posted. To open or close a role, flip `open`.
// A closed role disappears from the page and from the form's role list.
// To add a role, add an entry here AND its tag in functions/careers.js, so
// the inquiry lands in the CRM filtered under the right tag.
// tests/careers.test.mjs fails if the two lists drift.
//
// Copy rules for the financial roles: no compensation figures or income
// claims, no product offers, and never the name of the affiliated firm, its
// broker-dealer, or a carrier. The licensing path (life license first, then
// SIE / Series 6 / Series 63 by choice) is described; fees, contracts and
// supervision are covered in conversation and in writing, never on the page.
// tests/careers.test.mjs holds the page to these rules.

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
    intro: 'Aligned growth includes your money. We are building a team of financial professionals who bring the same intention to a family\'s finances that The One Percent brings to everything else. You do not need a background in finance. You need to be coachable, consistent, and willing to earn the licenses the work requires.',
    // How someone gets started, in order. Shown above the financial roles.
    path: [
      { title: 'Inquire and talk', text: 'Tell us about you below. If it fits, we sit down and walk through the work, the standard, and how the business runs.' },
      { title: 'Join and clear a background check', text: 'Joining is part of onboarding with the national financial services firm our team is affiliated with. Any onboarding fee is explained in writing before you commit.' },
      { title: 'Earn your life license', text: 'An online pre-licensing course, then your state\'s life and health licensing exam. You study at your own pace, with the team helping you prepare.' },
      { title: 'Train in the field', text: 'Your first client appointments run alongside a licensed field trainer, until you are ready to run them on your own.' },
      { title: 'Add securities, if you choose', text: 'Once you are life licensed, you can pursue the SIE, Series 6, and Series 63 exams. The Series 6 and 63 require a sponsoring broker-dealer, which comes through the firm after you join.' },
      { title: 'Grow into leadership', text: 'Promotions are earned, not bought: by your licensed client work, and by training and developing licensed people on your own team.' }
    ],
    disclaimer: 'Aligned Wealth is a separate company from The One Percent Nation. Financial representatives are independent contractors who contract with the affiliated national financial services firm. They are not employees of Aligned Wealth or The One Percent Nation. Earnings are based entirely on the work you do: there is no salary, no guaranteed income, and results vary. Representatives offer products only where they are properly licensed. This page is not an offer of employment or a contract, and nothing here offers or recommends any insurance or securities product.'
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
    title: 'Financial Representative',
    meta: ['Aligned Wealth', 'Part-time or full-time', 'Independent contractor'],
    summary: 'The starting role on the team. Help families protect the people who depend on them and get a clear picture of their money, beginning with your life license.',
    does: [
      'Sit down with families to understand their protection, debt, and savings, and what they want for the people they love',
      'Help them put life insurance in place that fits their real needs and budget',
      'Run your first appointments alongside a licensed field trainer until you lead them yourself',
      'Build a client base you serve for years, on a schedule you set'
    ],
    fits: [
      '18 or older and able to pass a background check',
      'Holds a state life and health license, or is ready to earn one with the team\'s help',
      'Coachable: shows up to training, follows the process, and does the reps',
      'Starting part-time around a current job is welcome'
    ]
  },
  {
    key: 'securities',
    team: 'financial',
    open: true,
    title: 'Investment and Securities Representative',
    meta: ['Aligned Wealth', 'Next step after life licensing', 'Independent contractor'],
    summary: 'For representatives ready to help families plan for the long term, from retirement to college savings, inside the rules that govern the work.',
    does: [
      'Help clients set long-term goals and understand the plan they are building toward',
      'Work with families on retirement and education savings once you hold the registrations it requires',
      'Treat suitability, documentation, and supervision as part of doing the work right'
    ],
    fits: [
      'Life licensed first, or on the way there',
      'Holds or is committed to passing the SIE, Series 6, and Series 63 (Series 63 where your state requires it)',
      'Thinks in decades, not quarters, and treats compliance as part of the craft'
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
