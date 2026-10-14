// The Toolkit registry — everything a member uses rather than enrolls in.
//
// /toolkit renders one section per TOOLKIT_SECTIONS entry, in order:
//   assessments  read from assessments-data.js, so a new assessment file shows
//                up with no edit here
//   reads        free series that run on the course player, marked
//                `shelf: 'toolkit'` in the course registry (isToolkitItem)
//   calculators  and every other section: the TOOLS list below
//
// Adding a calculator or planner: build its page, then add one TOOLS entry.
// `status: 'coming-soon'` shows the card without a link, so a section can
// announce what is next before it ships. tests/toolkit.test.mjs checks that
// every live internal href exists in public/.

export const TOOLKIT_SECTIONS = [
  {
    key: 'assessments',
    label: 'Assessments',
    blurb: 'Five minutes, an honest score and a plan. Every result saves, so you can retake one later and see how far you have come.'
  },
  {
    key: 'reads',
    label: 'Free Reads',
    blurb: 'Short series you can finish in one sitting. Read the piece, run the one thing at the end, move on.'
  },
  {
    key: 'calculators',
    label: 'Calculators & Planners',
    blurb: 'Put real numbers on the goal, then turn them into a plan you can run this week.'
  },
  {
    key: 'templates',
    label: 'Templates & Worksheets',
    blurb: 'Frameworks and worksheets that go with the courses. Built to be used, not collected.'
  }
];

export const TOOLS = [
  {
    slug: 'goal-planner',
    section: 'calculators',
    title: 'Custom Goal Planner',
    short: 'Start from the income you want and work back to the weekly actions and 90-day plan that get you there.',
    href: '/goal-planning.html',
    minutes: 10,
    status: 'live'
  },
  {
    slug: 'worksheets',
    section: 'templates',
    title: 'Course worksheets',
    short: 'Printable frameworks and worksheets from every course, in one place.',
    href: null,
    status: 'coming-soon'
  }
];
