// Course registry — metadata for every course shown in /courses.html.
// Add a course by appending to COURSES. Set `status: 'live'` when ready.
//
// For `live` courses you must also provide a `mount` function that initialises
// the course workspace (sidebar + main) when that tab is activated.
//
// `coming-soon` courses render a centered placeholder; no mount needed.
//
// ─── The 1% Method (Learn → Rewire → Measure) ────────────────────────────
// Every course follows the same evidence-based structure used by the most
// popular online courses in the world (Yale's "The Science of Well-Being"):
//   1. Baseline  — a self-assessment before the first lesson, so change is
//                  measurable instead of assumed.
//   2. Learn     — short lessons that teach the principle and the science
//                  behind it in plain language.
//   3. Rewire    — every lesson ends with a "rewirement": a small practice
//                  applied to real life the same day. Knowing isn't the goal;
//                  rewiring is.
//   4. Measure   — progress check-ins, then a final multi-week 1% Challenge
//                  where one rewirement is practiced daily and the baseline
//                  assessment is retaken to prove the change.
// The landing page (course.html) renders `curriculum`, `whatYoullLearn`,
// `requirements`, `includes`, and `description` from the fields below.
// Firestore `courses/{slug}` fields override any of this without a deploy.

const METHOD_REQUIREMENTS = [
  'No prerequisites — the course is built to meet you at any starting point.',
  '15–20 minutes a day for the rewirement practices. The lessons teach; the practices change you.',
  'A willingness to measure yourself honestly — you\'ll take a baseline assessment at the start and retake it at the end.'
];

const METHOD_PARAGRAPH =
  'This course is built on the same structure behind the most popular online courses ever made: ' +
  'short science-backed lessons, a practice (we call it a <b>rewirement</b>) applied to your real life ' +
  'the same day, and honest measurement. You\'ll take a baseline self-assessment before the first ' +
  'lesson and retake it at the end — so your growth is measured, not assumed. Knowledge that isn\'t ' +
  'practiced fades in weeks; that\'s why every lesson ends with a rewirement, and the course ends ' +
  'with a 4-week 1% Challenge that turns your biggest shift into a daily habit.';

// ─── I Can't: The Course (companion to the book) ─────────────────────────
// Unlike the courses below, I Can't does not run the Learn → Rewire → Measure
// method. It follows the book "I Can't: Is Not A Strategy" chapter for chapter,
// and its Workbook is the book's own ten exercises. Keep this copy honest to
// what icant-course.js actually renders.

const ICANT_REQUIREMENTS = [
  'A copy of I Can\'t: Is Not A Strategy. The course follows it chapter for chapter (it comes free in the bundle).',
  'Ten to twenty minutes per chapter for the exercise. The chapters explain the machinery. The exercises take it apart.',
  'A willingness to write the honest version, not the polite one. Your answers are private and saved.'
];

const ICANT_PARAGRAPH =
  'Every module matches one chapter of the book, in the book\'s order. The Lesson tab carries ' +
  'Anthony\'s story and the chapter\'s core teaching. The Workbook tab is that chapter\'s exercise, ' +
  'the same ten exercises collected in the book\'s Appendix, with a saved field for every step. ' +
  'They build on each other, so nothing you write gets lost.';

const ICANT_OUTCOMES = [
  'Split your limiting belief into its fact and its verdict, and put the verdict on trial.',
  'Catch the old belief firing in real time with a seven-day two-column log, and pave the new road.',
  'Find the beliefs hiding under your wins with the Shrink List, and name the one running your life.',
  'Run the reframe engine: the same facts read as something that happened for you, not to you.',
  'Build one small system, anchored to a habit you already have, with the rule: never miss twice.',
  'Pre-decide your first move after a setback, and install the empowering belief that replaces the old one.'
];

const ICANT_CURRICULUM_SUMMARY = [
  { t: 'Start Here: how the course follows the book', d: '8 min' },
  { t: 'Chapters 1–3: Understanding, Neuroscience, Identifying (3 exercises)', d: '1hr 4min' },
  { t: 'Chapters 4–5: Reframing, Mindset Shifts (2 exercises)', d: '44 min' },
  { t: 'Chapters 6–7: Six Weeks Deep, Resilience (2 exercises)', d: '49 min' },
  { t: 'Chapters 8–10: Empowering Beliefs, Environment, Continuous Growth (3 exercises)', d: '1hr 8min' }
];

export const COURSES = [
  {
    slug: '1p-clc',
    title: '1P Certified Life Coach',
    short: 'Life Coach Certification',
    subtitle: 'Certified in 16 weeks. A credential, a framework license, and a client-ready program to sell.',
    status: 'coming-soon',
    eyebrow: 'Certification \u00b7 16 Weeks',
    category: 'Leadership & Coaching',
    price: 3497,
    priceLabel: '$3,497',
    priceNote: 'Includes your first-year A.L.I.G.N. Practitioner License',
    contentSource: 'firestore',
    whatYoullLearn: [
      'Coach real clients through the A.L.I.G.N. framework: Awareness, Leadership, Identity, Growth, Navigation.',
      'Run coaching conversations with a repeatable session structure that creates real movement.',
      'Build client engagements: discovery calls, packages, and a six-week client program you can deliver day one.',
      'Log 25 real practice coaching hours and get certified on evidence, not attendance.',
      'Pass a written certification exam and a reviewed, recorded coaching session scored against a published rubric.',
      'Leave with the 1P Certified Life Coach credential and a license to deliver A.L.I.G.N. commercially.'
    ],
    requirements: [
      'No prior coaching experience required. Come ready to practice, not just watch.',
      'Four to five hours per week for sixteen weeks: live calls, module work, and real coaching practice.',
      'A willingness to coach real people during the program. Your 25 practice hours are part of certification.'
    ],
    includes: [
      'Eight modules mapped to the A.L.I.G.N. framework',
      'Live weekly coaching call for twelve weeks',
      'Four-week practicum: exam, recorded session review, certification',
      'Coaching hour log with 25-hour certification requirement',
      'Written certification exam and published session rubric',
      'Certificate: 1P Certified Life Coach, with track designation',
      'First-year A.L.I.G.N. Practitioner License included'
    ],
    description: [
      'Certified in 16 weeks. Four to five hours per week. Live weekly coaching, a certification exam, ' +
      'and a reviewed coaching session. You finish with a credential, a framework license, and a ' +
      'client-ready program to sell.',
      'This is a proprietary certification in the A.L.I.G.N. framework. You earn the credential once. ' +
      'The practitioner license that comes with it is what lets you deliver A.L.I.G.N. commercially, ' +
      'under The One Percent name, with client-facing products built for you.',
      'The difference between a certification and a course is what it asks of you. Here that means all ' +
      'eight modules, a written exam, one recorded coaching session reviewed against a published rubric, ' +
      'and a minimum of 25 logged practice coaching hours. You get certified for coaching real people ' +
      'through real change.'
    ],
    curriculum: [
      {
        title: 'Weeks 1\u20132 \u00b7 Awareness',
        lessons: [
          { t: 'Module 1: Foundations of 1P Coaching. What coaching is, ethics, and the non-advising stance', d: 'Week 1' },
          { t: 'Module 2: The A.L.I.G.N. Framework. The full arc and the client journey map', d: 'Week 2' }
        ]
      },
      {
        title: 'Weeks 3\u20136 \u00b7 Leadership & Identity',
        lessons: [
          { t: 'Module 3: Leadership of Self and Session. Presence, listening, session structure', d: 'Weeks 3\u20134' },
          { t: 'Module 4: Identity Work. Beliefs, story rewriting, values alignment', d: 'Weeks 5\u20136' }
        ]
      },
      {
        title: 'Weeks 7\u201310 \u00b7 Growth & Navigation',
        lessons: [
          { t: 'Module 5: Powerful Questions and Growth Plans. Question craft and goal architecture', d: 'Weeks 7\u20138' },
          { t: 'Module 6: Navigation and Accountability. Execution systems and progress reviews', d: 'Weeks 9\u201310' }
        ]
      },
      {
        title: 'Weeks 11\u201312 \u00b7 Your Practice',
        lessons: [
          { t: 'Module 7: The Client Engagement. Discovery calls, packages, the six-week client program', d: 'Week 11' },
          { t: 'Module 8: Practicum Preparation. Rubric walkthrough, recording requirements, hour log', d: 'Week 12' }
        ]
      },
      {
        title: 'Weeks 13\u201316 \u00b7 Practicum & Certification',
        lessons: [
          { t: 'Written certification exam', d: 'Week 13', kind: 'assessment' },
          { t: 'Recorded coaching session, reviewed against the published rubric', d: 'Weeks 14\u201315', kind: 'assessment' },
          { t: 'Hour log review and certification', d: 'Week 16' }
        ]
      }
    ]
  },
  {
    slug: '1p-clc-leader',
    title: '1P Certified Leader Coach',
    short: 'Leader Coach',
    showOnSite: false,
    subtitle: 'Mindset, structure, and disciplined progress — one percent at a time.',
    status: 'coming-soon',
    eyebrow: 'Certification · 7 Modules',
    category: 'Leadership & Coaching',
    price: 497,
    priceLabel: '$497',
    priceNote: 'Full certification · lifetime access',
    whatYoullLearn: [
      'Measure your leadership baseline before you start — and prove the change when you finish.',
      'Redefine what success means for you and the people you lead, using the 1P success scorecard.',
      'Apply the I Can\'t framework to break the limiting beliefs that cap your leadership.',
      'Run coaching conversations with a repeatable session structure that creates real movement.',
      'Build accountability systems that produce follow-through instead of guilt.',
      'Complete a live coaching practicum and earn your 1P Certified Leader Coach credential.'
    ],
    requirements: METHOD_REQUIREMENTS,
    includes: [
      '7 certification modules of on-demand lessons',
      'Baseline + final leadership self-assessments',
      'A rewirement practice after every module',
      'Live coaching practicum (capstone)',
      '21-day leadership challenge with tracking',
      'Certificate: 1P Certified Leader Coach',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'Most leadership training tells you what great leaders do. This certification trains you to ' +
      'actually do it — and to coach others through the same transformation.',
      METHOD_PARAGRAPH,
      'Across three pillars — Lead Yourself, Lead Others, Lead with Purpose — you\'ll rebuild your ' +
      'definition of success, master the coaching conversation, and design accountability that works. ' +
      'The program ends with a live coaching practicum: you don\'t get certified for watching videos, ' +
      'you get certified for coaching a real person through real change.',
      'By the end you\'ll hold two things: a credential, and a measurable before-and-after of your own leadership.'
    ],
    curriculum: [
      {
        title: 'Start Here: Your Leadership Baseline',
        lessons: [
          { t: 'How this program works: Learn → Rewire → Measure', d: '5 min' },
          { t: 'Your Leadership Baseline Self-Assessment', d: '15 min', kind: 'assessment' },
          { t: 'Program overview & certification roadmap', d: '10 min' }
        ]
      },
      {
        title: 'Pillar 1 — Lead Yourself',
        lessons: [
          { t: 'Redefining Leadership Success', d: '45 min' },
          { t: 'Rewirement: Rewrite your success scorecard', d: '15 min', kind: 'practice' },
          { t: 'Mindset Mastery for Leaders — the I Can\'t framework applied', d: '50 min' },
          { t: 'Rewirement: The daily belief audit', d: '10 min', kind: 'practice' }
        ]
      },
      {
        title: 'Pillar 2 — Lead Others',
        lessons: [
          { t: 'The Coaching Conversation: frameworks + session structure', d: '55 min' },
          { t: 'Practice lab: run your first coaching session', d: '20 min', kind: 'practice' },
          { t: 'Accountability That Works: goal architecture + follow-through', d: '50 min' },
          { t: 'Rewirement: The follow-through framework', d: '15 min', kind: 'practice' }
        ]
      },
      {
        title: 'Pillar 3 — Lead with Purpose',
        lessons: [
          { t: 'Culture, Vision & Values: building purpose-aligned teams', d: '55 min' },
          { t: 'Rewirement: Write your leadership creed', d: '15 min', kind: 'practice' }
        ]
      },
      {
        title: 'Certification & The 1% Challenge',
        lessons: [
          { t: 'Certification Capstone: live coaching practicum', d: '90 min' },
          { t: 'The 21-day leadership challenge', d: '10 min', kind: 'practice' },
          { t: 'Retake your baseline: measure the change', d: '15 min', kind: 'assessment' }
        ]
      }
    ],
    mount: async (opts) => {
      const mod = await import('./app.js');
      if (mod && typeof mod.mount === 'function') await mod.mount(opts);
    }
  },
  {
    slug: 'bundle-icant',
    title: 'The Complete I Can\'t Experience',
    short: 'Bundle Deal',
    subtitle: 'Book + Course together. Read the chapter, then do the work.',
    status: 'coming-soon',
    eyebrow: 'Best Value · Book + 10 Chapters',
    category: 'Mindset & Personal Growth',
    price: 197,
    priceLabel: '$197',
    priceNote: 'Paperback shipped to you · US addresses',
    shipsBook: true,
    bundleHref: '/bundle.html',
    whatYoullLearn: ICANT_OUTCOMES,
    requirements: ICANT_REQUIREMENTS,
    includes: [
      'The I Can\'t: Is Not A Strategy book — included free',
      'All 10 chapter modules plus a Start Here module',
      'The book\'s 10 exercises as a guided, saved Workbook',
      'A three-point summary and the chapter\'s hand-off after every module',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'The book and the course do one job together. Read the chapter, then open its module and do ' +
      'that chapter\'s exercise with your answers saved, so the sentence you write in Chapter 1 is ' +
      'the one you rewrite in Chapter 8.',
      ICANT_PARAGRAPH,
      'This bundle exists because the book is where the teaching lives and the course is where the ' +
      'work gets done and kept. Buying them together saves you money and gives the work its best ' +
      'chance of sticking.'
    ],
    curriculum: [
      {
        title: 'The Book: I Can\'t: Is Not A Strategy',
        lessons: [
          { t: 'Your copy of the book — paperback or digital, yours for life', d: 'included' }
        ]
      },
      {
        title: 'The Course: everything in I Can\'t: The Course',
        lessons: ICANT_CURRICULUM_SUMMARY
      }
    ]
  },
  {
    slug: 'icant',
    title: 'I Can\'t: The Course',
    short: 'I Can\'t',
    subtitle: 'The companion to the book. One module per chapter, and every Workbook is the book\'s own exercise.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 10 Chapters',
    category: 'Mindset & Personal Growth',
    price: 197,
    priceLabel: '$197',
    priceNote: 'Included in The Complete I Can\'t Experience',
    // Sold only through the bundle: hidden from the library and the homepage
    // for people who don't own it, and checkout refuses the slug directly.
    // Members enrolled through the bundle open it here as normal.
    sellable: false,
    showOnSite: false,
    bundleHref: '/bundle.html',
    whatYoullLearn: ICANT_OUTCOMES,
    requirements: ICANT_REQUIREMENTS,
    includes: [
      '10 chapter modules plus a Start Here module',
      'The book\'s 10 exercises as a guided, saved Workbook',
      'Anthony\'s story and the core teaching from every chapter',
      'A three-point summary and the chapter\'s hand-off after every module',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      '"I can\'t" is rarely a fact. It is a sentence about yourself that you did not choose, that you ' +
      'now defend without noticing. This course walks the book chapter for chapter and makes you do ' +
      'the work the book asks for, with every answer kept.',
      ICANT_PARAGRAPH,
      'You will catch the belief in the act, split its fact from its verdict, reframe it, build the ' +
      'small daily system that outlasts motivation, pre-build your comeback, install the empowering ' +
      'belief that replaces the old one, fix the room you are growing in, and set up the one percent ' +
      'practice you keep for life.',
      'The course is built to be used with the book. It stands on its own, but it is the book\'s ' +
      'exercises that do the changing.'
    ],
    curriculum: [
      {
        title: 'Start Here',
        lessons: [
          { t: 'How this works: one module per chapter, and the exercises are the book', d: '8 min' }
        ]
      },
      {
        title: 'See the Voice · Chapters 1–3',
        lessons: [
          { t: 'Chapter 1 — Understanding Limiting Beliefs', d: '20 min' },
          { t: 'Exercise: Fact vs. Verdict', d: '10 min', kind: 'practice' },
          { t: 'Chapter 2 — The Neuroscience of Belief', d: '22 min' },
          { t: 'Exercise: Catch the Reflex, Pave the New Road (a 7-day log)', d: '7 days', kind: 'practice' },
          { t: 'Chapter 3 — Identifying Limiting Beliefs', d: '22 min' },
          { t: 'Exercise: The Shrink List', d: '15 min', kind: 'practice' }
        ]
      },
      {
        title: 'Take the Wheel · Chapters 4–5',
        lessons: [
          { t: 'Chapter 4 — Challenging and Reframing Beliefs', d: '24 min' },
          { t: 'Exercise: To Me, or For Me', d: '20 min', kind: 'practice' },
          { t: 'Chapter 5 — The Power of Mindset Shifts', d: '20 min' },
          { t: 'Exercise: Your Two Minds', d: '15 min', kind: 'practice' }
        ]
      },
      {
        title: 'Build · Chapters 6–7',
        lessons: [
          { t: 'Chapter 6 — Six Weeks Deep', d: '25 min' },
          { t: 'Exercise: Build Your One Move', d: '15 min', kind: 'practice' },
          { t: 'Chapter 7 — Building Resilience and Overcoming Setbacks', d: '24 min' },
          { t: 'Exercise: Your Comeback Plan', d: '15 min', kind: 'practice' }
        ]
      },
      {
        title: 'Become · Chapters 8–10',
        lessons: [
          { t: 'Chapter 8 — Embracing Empowering Beliefs', d: '22 min' },
          { t: 'Exercise: Write Your New Sentence', d: '10 min', kind: 'practice' },
          { t: 'Chapter 9 — Creating a Supportive Environment', d: '24 min' },
          { t: 'Exercise: Audit Your Environment', d: '20 min', kind: 'practice' },
          { t: 'Chapter 10 — The Journey of Continuous Growth', d: '22 min' },
          { t: 'Exercise: Your One Percent (the one you keep)', d: '15 min', kind: 'practice' }
        ]
      }
    ],
    mount: async (opts) => {
      const mod = await import('./icant-course.js');
      if (mod && typeof mod.mount === 'function') await mod.mount(opts);
    }
  },
  {
    slug: 'mindset-foundations',
    title: 'Mindset Foundations',
    short: 'Mindset',
    subtitle: 'Rewire how you relate to success, setbacks, and self.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 5 Modules',
    category: 'Mindset & Personal Growth',
    price: 197,
    priceLabel: '$197',
    whatYoullLearn: [
      'Take a mindset baseline assessment first — so the change you make is measurable, not a feeling.',
      'See the operating system underneath your behavior: how beliefs drive decisions before you notice.',
      'Redefine success on your terms instead of inheriting someone else\'s scoreboard.',
      'Build a setback response that turns failure into data instead of identity.',
      'Rewire your self-talk with a daily practice that compounds.',
      'Finish with the 4-week 1% Challenge and a retaken assessment that shows your shift.'
    ],
    requirements: METHOD_REQUIREMENTS,
    includes: [
      '5 modules of on-demand lessons',
      'Baseline + final mindset self-assessments',
      'A rewirement practice after every module',
      '4-week 1% Challenge with daily tracking',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'Your mindset is the operating system every other skill runs on. If it\'s built on borrowed ' +
      'definitions of success and a fear of setbacks, no productivity tactic will save you. This course ' +
      'rebuilds the foundation.',
      METHOD_PARAGRAPH,
      'Five modules take you from awareness to identity: how your mental operating system formed, what ' +
      'success actually means to you, how to respond to setbacks, how to talk to yourself, and how to ' +
      'make consistency automatic. Each one ends with a rewirement you practice the same day.'
    ],
    curriculum: [
      {
        title: 'Start Here: Your Baseline',
        lessons: [
          { t: 'How this course works: Learn → Rewire → Measure', d: '4 min' },
          { t: 'The Mindset Baseline Assessment', d: '10 min', kind: 'assessment' }
        ]
      },
      {
        title: 'The Five Foundations',
        lessons: [
          { t: 'Module 1 — The Operating System: how beliefs drive behavior', d: '20 min' },
          { t: 'Rewirement: The decision replay', d: '8 min', kind: 'practice' },
          { t: 'Module 2 — Success, Redefined: whose scoreboard are you on?', d: '22 min' },
          { t: 'Rewirement: Write your own definition', d: '10 min', kind: 'practice' },
          { t: 'Module 3 — The Setback Response: failure as data', d: '20 min' },
          { t: 'Rewirement: The 24-hour reset rule', d: '8 min', kind: 'practice' },
          { t: 'Module 4 — Self-Talk & Identity: the voice becomes the person', d: '22 min' },
          { t: 'Rewirement: The evidence journal', d: '10 min', kind: 'practice' },
          { t: 'Module 5 — The Consistency Loop: make showing up automatic', d: '20 min' },
          { t: 'Rewirement: Your minimum daily rep', d: '8 min', kind: 'practice' }
        ]
      },
      {
        title: 'The 1% Challenge',
        lessons: [
          { t: 'Choose your 4-week rewirement', d: '6 min', kind: 'practice' },
          { t: 'Retake the Mindset Baseline: measure the change', d: '10 min', kind: 'assessment' }
        ]
      }
    ]
  },
  {
    slug: 'business-alignment',
    title: 'Business Alignment',
    short: 'Business',
    subtitle: 'Build a business that reflects your values and sustains your life.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 6 Modules',
    category: 'Business & Purpose',
    price: 297,
    priceLabel: '$297',
    whatYoullLearn: [
      'Run the alignment audit first — a baseline of where your business and your values diverge.',
      'Translate your values into offers, pricing, and positioning that feel like you.',
      'Set boundaries and capacity limits that protect the life the business is supposed to fund.',
      'Connect money, mission, and metrics so growth doesn\'t drift you off course.',
      'Install an operating rhythm — weekly and quarterly — that keeps the business aligned by default.',
      'Finish with the 4-week 1% Challenge and a re-run audit that shows the realignment.'
    ],
    requirements: [
      'A business, side hustle, or serious business idea to apply the work to.',
      '15–20 minutes a day for the rewirement practices, plus one honest audit at the start and end.',
      'A willingness to change what the audit reveals — including offers and prices.'
    ],
    includes: [
      '6 modules of on-demand lessons',
      'The Alignment Audit (baseline + final)',
      'A rewirement practice after every module',
      '4-week 1% Challenge with daily tracking',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'Plenty of businesses grow while their owners shrink. This course is for builders who want the ' +
      'other thing: a business that reflects their values and sustains their life — and still performs.',
      METHOD_PARAGRAPH,
      'Six modules walk the full realignment: audit where you actually are, turn values into value, ' +
      'rebuild offers, set capacity boundaries, wire money to mission with honest metrics, and install ' +
      'an operating rhythm that keeps you aligned when things get busy. Every module ends with a ' +
      'rewirement applied directly to your business that day.'
    ],
    curriculum: [
      {
        title: 'Start Here: The Alignment Audit',
        lessons: [
          { t: 'How this course works: Learn → Rewire → Measure', d: '4 min' },
          { t: 'The Alignment Audit — your baseline', d: '15 min', kind: 'assessment' }
        ]
      },
      {
        title: 'Realign the Business',
        lessons: [
          { t: 'Module 1 — The Alignment Audit, debriefed: where you drifted', d: '22 min' },
          { t: 'Rewirement: Name the one misalignment costing you most', d: '10 min', kind: 'practice' },
          { t: 'Module 2 — Values Into Value: positioning that feels like you', d: '25 min' },
          { t: 'Rewirement: Rewrite one piece of your messaging', d: '12 min', kind: 'practice' },
          { t: 'Module 3 — Offers That Reflect You', d: '25 min' },
          { t: 'Rewirement: The offer alignment scorecard', d: '12 min', kind: 'practice' },
          { t: 'Module 4 — Boundaries & Capacity: protect the life the business funds', d: '22 min' },
          { t: 'Rewirement: Set one boundary this week', d: '8 min', kind: 'practice' },
          { t: 'Module 5 — Money, Mission & Metrics', d: '25 min' },
          { t: 'Rewirement: Your three aligned metrics', d: '10 min', kind: 'practice' },
          { t: 'Module 6 — The Aligned Operating Rhythm', d: '22 min' },
          { t: 'Rewirement: Book your weekly alignment review', d: '8 min', kind: 'practice' }
        ]
      },
      {
        title: 'The 1% Challenge',
        lessons: [
          { t: 'Choose your 4-week rewirement', d: '6 min', kind: 'practice' },
          { t: 'Re-run the Alignment Audit: measure the shift', d: '15 min', kind: 'assessment' }
        ]
      }
    ]
  },
  {
    slug: 'faith-leadership',
    title: 'Faith & Leadership',
    short: 'Faith',
    subtitle: 'Lead from purpose — grounded in principle, not performance.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 4 Modules',
    category: 'Faith & Purpose',
    price: 197,
    priceLabel: '$197',
    whatYoullLearn: [
      'Take a grounded-identity baseline first — where your leadership runs on principle vs. performance.',
      'Anchor your identity in something sturdier than results, titles, or applause.',
      'Lead by principle when performance pressure says to cut the corner.',
      'Serve the people you lead without losing the authority to lead them.',
      'Build endurance practices for the seasons when faith and leadership both get heavy.',
      'Finish with the 4-week 1% Challenge and a retaken assessment that shows the grounding.'
    ],
    requirements: METHOD_REQUIREMENTS,
    includes: [
      '4 modules of on-demand lessons',
      'Baseline + final grounded-identity assessments',
      'A rewirement practice after every module',
      '4-week 1% Challenge with daily tracking',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'Performance-driven leadership burns hot and burns out. Purpose-driven leadership endures. This ' +
      'course is about leading from the second place — grounded in principle and faith, not the ' +
      'scoreboard.',
      METHOD_PARAGRAPH,
      'Four modules move from identity to endurance: who you are before what you produce, principle ' +
      'over performance under pressure, serving while leading, and staying faithful through the long ' +
      'seasons. Each module ends with a rewirement — a practice done in your real week, with the real ' +
      'people you lead.'
    ],
    curriculum: [
      {
        title: 'Start Here: Your Baseline',
        lessons: [
          { t: 'How this course works: Learn → Rewire → Measure', d: '4 min' },
          { t: 'The Grounded Identity Assessment', d: '10 min', kind: 'assessment' }
        ]
      },
      {
        title: 'The Four Groundings',
        lessons: [
          { t: 'Module 1 — Grounded Identity: who you are before what you produce', d: '22 min' },
          { t: 'Rewirement: The identity inventory', d: '10 min', kind: 'practice' },
          { t: 'Module 2 — Principle Over Performance', d: '22 min' },
          { t: 'Rewirement: Name your non-negotiables', d: '10 min', kind: 'practice' },
          { t: 'Module 3 — Serving While Leading', d: '20 min' },
          { t: 'Rewirement: One act of unseen service this week', d: '8 min', kind: 'practice' },
          { t: 'Module 4 — Enduring Faithfully: leadership for long seasons', d: '22 min' },
          { t: 'Rewirement: Your endurance practice', d: '10 min', kind: 'practice' }
        ]
      },
      {
        title: 'The 1% Challenge',
        lessons: [
          { t: 'Choose your 4-week rewirement', d: '6 min', kind: 'practice' },
          { t: 'Retake the Grounded Identity Assessment', d: '10 min', kind: 'assessment' }
        ]
      }
    ]
  },
  {
    slug: 'performance-discipline',
    title: 'Performance & Discipline',
    short: 'Performance',
    subtitle: 'Daily structure and habits that compound into long-term results.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 5 Modules',
    category: 'Productivity & Habits',
    price: 247,
    priceLabel: '$247',
    whatYoullLearn: [
      'Take a discipline baseline first — your real consistency, measured, before any tactics.',
      'Drop the discipline myth: why willpower fails and what reliable people use instead.',
      'Design systems that make the right action the easy action.',
      'Lock in your daily non-negotiables — the minimum reps that compound.',
      'Manage energy, not just time, so performance survives hard weeks.',
      'Finish with the 4-week 1% Challenge and a retaken baseline that proves the consistency.'
    ],
    requirements: METHOD_REQUIREMENTS,
    includes: [
      '5 modules of on-demand lessons',
      'Baseline + final discipline self-assessments',
      'A rewirement practice after every module',
      '4-week 1% Challenge with daily tracking',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'Discipline isn\'t a personality trait you were born without. It\'s a structure you haven\'t built ' +
      'yet. This course builds it — one small, tracked, daily rep at a time.',
      METHOD_PARAGRAPH,
      'Five modules cover the full system: why willpower was never the answer, how to design your ' +
      'environment and defaults, choosing daily non-negotiables, managing energy through hard weeks, ' +
      'and running the compounding review that keeps 1% daily improvement actually compounding. Every ' +
      'module ends with a rewirement you execute that day — because a course about discipline should ' +
      'make you practice some.'
    ],
    curriculum: [
      {
        title: 'Start Here: Your Baseline',
        lessons: [
          { t: 'How this course works: Learn → Rewire → Measure', d: '4 min' },
          { t: 'The Discipline Baseline Assessment', d: '10 min', kind: 'assessment' }
        ]
      },
      {
        title: 'The Five Systems',
        lessons: [
          { t: 'Module 1 — The Discipline Myth: why willpower fails', d: '20 min' },
          { t: 'Rewirement: The willpower audit', d: '8 min', kind: 'practice' },
          { t: 'Module 2 — Systems Beat Willpower: design your defaults', d: '22 min' },
          { t: 'Rewirement: Remove one point of friction tonight', d: '8 min', kind: 'practice' },
          { t: 'Module 3 — The Daily Non-Negotiables', d: '20 min' },
          { t: 'Rewirement: Pick your minimum daily rep', d: '8 min', kind: 'practice' },
          { t: 'Module 4 — Energy Management: perform through hard weeks', d: '22 min' },
          { t: 'Rewirement: The energy ledger', d: '10 min', kind: 'practice' },
          { t: 'Module 5 — The Compounding Review', d: '20 min' },
          { t: 'Rewirement: Book your weekly review', d: '8 min', kind: 'practice' }
        ]
      },
      {
        title: 'The 1% Challenge',
        lessons: [
          { t: 'Choose your 4-week rewirement', d: '6 min', kind: 'practice' },
          { t: 'Retake the Discipline Baseline: measure the change', d: '10 min', kind: 'assessment' }
        ]
      }
    ]
  }
];

// Returns the active course if ?course=<slug> matches a known course, else null
// (null = library view). The first course is no longer auto-selected; users land
// on the library and pick a course explicitly.
export function getActiveCourse() {
  const slug = new URLSearchParams(location.search).get('course');
  if (!slug) return null;
  return COURSES.find((c) => c.slug === slug) || null;
}
