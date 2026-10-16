// The Toolkit registry — everything a member uses rather than enrolls in.
//
// /toolkit renders one section per TOOLKIT_SECTIONS entry, in order:
//   assessments  read from assessments-data.js, so a new assessment file shows
//                up with no edit here
//   reads        READ_SERIES below (the essay series at /reads), then any free
//                series on the course player marked `shelf: 'toolkit'` in the
//                course registry (isToolkitItem)
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
    blurb: 'Essays worth finishing. Read the piece, run the one practice at the end, move on.'
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

// Essay series published at /reads (scripts/build-reads.js). The opening of
// every essay is public; signing up for a free account opens the full text.
export const READ_SERIES = [
  {
    slug: 'the-focus-tax',
    title: 'The Focus Tax',
    short: 'Four long-form essays on what an unstructured day really costs you, and the one practice that pays it back.',
    meta: 'Four essays · about 9 minutes each',
    href: '/reads'
  }
];

export const TOOLS = [
  {
    slug: 'focus-tax-calculator',
    section: 'calculators',
    title: 'Focus Tax Calculator',
    short: 'Put a dollar figure on interruptions, switching, meetings and drift, then see what the time blocking system in How to Work Less and Gain More gives back.',
    href: '/focus-tax-calculator',
    minutes: 3,
    status: 'live'
  },
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
