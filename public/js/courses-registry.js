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

export const COURSES = [
  {
    slug: 'icant-book',
    title: "I Can't: Read & Apply",
    short: "I Can't (Book)",
    subtitle: 'Read the book chapter by chapter — then apply it the same day.',
    status: 'live',
    eyebrow: 'The Book · 12 Chapters',
    category: 'Mindset & Personal Growth',
    price: 0,
    priceLabel: 'Included',
    priceNote: 'Read + apply the full book',
    whatYoullLearn: [
      'Read every part of the book — Introduction, all ten chapters, and the Conclusion — inside the platform.',
      'Apply each chapter the same day with a Reflect + Do-the-Work exercise built right into the lesson.',
      'See your limiting beliefs clearly, then challenge and reframe them with a repeatable method.',
      'Understand the neuroscience of why beliefs stick — and how to rewire them on purpose.',
      'Build the mindset, systems, resilience, and environment that make the change permanent.',
      'Finish with an empowering-beliefs declaration and a first action you take within 48 hours.'
    ],
    requirements: [
      'No prerequisites — the course meets you wherever you are starting.',
      '15–20 minutes per chapter: read it here, then do the application while it is fresh.',
      'A willingness to be honest on the page. Your answers save privately on your device.'
    ],
    includes: [
      'The full book, chapter by chapter, readable in-app',
      'A Read → Apply → Takeaways flow for every chapter',
      'Application exercises that save automatically on your device',
      'Progress tracking across all 12 chapters',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'This is the book itself, built to be read and worked. Each chapter of Anthony Brown\'s ' +
      '<i>I Can\'t: Strategies To Overcoming Your Limiting Beliefs</i> becomes a lesson you read in the ' +
      'platform, followed immediately by the application that turns the idea into a change in your life.',
      'The method is simple and it is the whole point: read the chapter, then apply it the same day. ' +
      'Knowledge that is not applied fades within weeks. Applied knowledge becomes who you are. Every ' +
      'chapter ends with a Reflect prompt and a Do-the-Work exercise, plus the three takeaways to keep.',
      'Move through it start to finish, or read alongside your own copy and use each Apply tab as your ' +
      'workbook. Either way, you finish with your limiting beliefs named, challenged, and replaced — and ' +
      'a declaration of the beliefs you now choose to live from.'
    ],
    curriculum: [
      {
        title: 'Introduction',
        lessons: [
          { t: 'The Power of Belief — read', d: '12 min' },
          { t: 'Apply: name the lens you already see through', d: '10 min', kind: 'practice' }
        ]
      },
      {
        title: 'Part 1 — See the Beliefs (Chapters 1–3)',
        lessons: [
          { t: 'Ch 1 — Understanding Limiting Beliefs', d: '16 min' },
          { t: 'Ch 2 — The Neuroscience of Belief', d: '15 min' },
          { t: 'Ch 3 — Identify Your Limiting Beliefs', d: '14 min' },
          { t: 'Apply after each chapter', d: '30 min', kind: 'practice' }
        ]
      },
      {
        title: 'Part 2 — Break & Rebuild (Chapters 4–7)',
        lessons: [
          { t: 'Ch 4 — Challenging and Reframing Beliefs', d: '16 min' },
          { t: 'Ch 5 — The Power of Mindset Shifts', d: '13 min' },
          { t: 'Ch 6 — Actionable Strategies for Change', d: '16 min' },
          { t: 'Ch 7 — Building Resilience and Overcoming Setbacks', d: '14 min' }
        ]
      },
      {
        title: 'Part 3 — Become & Sustain (Chapters 8–10 + Conclusion)',
        lessons: [
          { t: 'Ch 8 — Embracing Empowering Beliefs', d: '14 min' },
          { t: 'Ch 9 — Creating a Supportive Environment', d: '13 min' },
          { t: 'Ch 10 — The Journey of Continuous Growth', d: '13 min' },
          { t: 'Conclusion — Embracing Your Limitless Potential', d: '10 min' }
        ]
      }
    ],
    mount: async (opts) => {
      const mod = await import('./icant-book-course.js');
      if (mod && typeof mod.mount === 'function') await mod.mount(opts);
    }
  },
  {
    slug: '1p-clc',
    title: '1P Certified Leader Coach',
    short: 'Leader Coach',
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
    subtitle: 'Book + Course together. The book gives you the map. The course gives you the journey.',
    status: 'coming-soon',
    eyebrow: 'Best Value · Book + 8 Modules',
    category: 'Mindset & Personal Growth',
    price: 197,
    priceLabel: '$197',
    priceNote: 'Book included FREE · was $216.99',
    bundleHref: '/bundle.html',
    whatYoullLearn: [
      'Everything in I Can\'t: The Course — all 8 modules, rewirements, and the 1% Challenge.',
      'The complete I Can\'t book to read alongside the course — the map and the journey together.',
      'Measure your belief baseline before module one, and retake it at the end to see the shift.',
      'Identify the exact limiting beliefs running your decisions, then reframe them with a repeatable drill.',
      'Turn one breakthrough into a 4-week daily practice so the change survives contact with real life.',
      'Build the setback protocol that keeps you moving when motivation doesn\'t show up.'
    ],
    requirements: METHOD_REQUIREMENTS,
    includes: [
      'The I Can\'t book — included free',
      'All 8 course modules of on-demand lessons',
      'Baseline + final belief self-assessments',
      'A rewirement practice after every module',
      '4-week 1% Challenge with daily tracking',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      'The book gives you the map. The course gives you the journey. Together they\'re the complete ' +
      'I Can\'t experience — read the principle, then rewire it into your life the same day.',
      METHOD_PARAGRAPH,
      'This bundle exists because the two formats do different jobs: the book builds understanding you ' +
      'can return to for years, and the course turns that understanding into assessments, rewirements, ' +
      'and a tracked 4-week challenge. Buying them together saves you money and gives the work its best ' +
      'chance of sticking.'
    ],
    curriculum: [
      {
        title: 'The Book: I Can\'t',
        lessons: [
          { t: 'Your copy of the I Can\'t book — shipped to you, yours for life', d: 'included' }
        ]
      },
      {
        title: 'The Course: everything in I Can\'t: The Course',
        lessons: [
          { t: 'Start Here: baseline assessment + how the method works', d: '20 min' },
          { t: 'Part 1 — See the Chains (3 modules + rewirements)', d: '1hr 28min' },
          { t: 'Part 2 — Break the Pattern (3 modules + rewirements)', d: '1hr 30min' },
          { t: 'Part 3 — Become Who You Decided to Be (2 modules + rewirements)', d: '1hr 3min' },
          { t: 'The 1% Challenge: 4 weeks + your final assessment', d: '25 min' }
        ]
      }
    ]
  },
  {
    slug: 'icant',
    title: 'I Can\'t: The Course',
    short: 'I Can\'t',
    subtitle: 'Break the beliefs that have been running your life — and build the ones that set you free.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 8 Modules',
    category: 'Mindset & Personal Growth',
    price: 197,
    priceLabel: '$197',
    priceNote: 'Full course · lifetime access',
    whatYoullLearn: [
      'Measure your belief baseline before module one — and retake it at the end to see exactly what changed.',
      'Understand the neuroscience of why your brain defends the beliefs that limit you.',
      'Excavate the specific "I can\'t" beliefs running your decisions, using a guided worksheet.',
      'Challenge and reframe limiting beliefs with a repeatable drill you can run for life.',
      'Practice a rewirement after every module — small daily actions that make the shift stick.',
      'Finish with the 4-week 1% Challenge: one practice, tracked daily, with a measured result.'
    ],
    requirements: METHOD_REQUIREMENTS,
    includes: [
      '8 modules of on-demand lessons',
      'Baseline + final belief self-assessments',
      'A rewirement practice after every module',
      'Guided belief-excavation worksheet',
      '4-week 1% Challenge with daily tracking',
      'Lifetime access on desktop and mobile'
    ],
    description: [
      '"I can\'t" is rarely a fact. It\'s a belief — installed early, rehearsed for years, and defended ' +
      'by a brain that prefers safe over free. This course is a guided demolition of those beliefs, and ' +
      'a build of the ones that set you free.',
      METHOD_PARAGRAPH,
      'In three parts — See the Chains, Break the Pattern, Become Who You Decided to Be — you\'ll learn ' +
      'why limiting beliefs form, find yours by name, and replace them with beliefs you chose on purpose. ' +
      'Every module ends with a rewirement so the work happens in your life, not just in your notes.',
      'By the end you won\'t just feel different. You\'ll have two assessment scores that prove you are.'
    ],
    curriculum: [
      {
        title: 'Start Here: Your Baseline',
        lessons: [
          { t: 'How this course works: Learn → Rewire → Measure', d: '4 min' },
          { t: 'The Belief Baseline Assessment', d: '10 min', kind: 'assessment' },
          { t: 'What inspired I Can\'t — and why it will work for you', d: '6 min' }
        ]
      },
      {
        title: 'Part 1 — See the Chains',
        lessons: [
          { t: 'Understanding Limiting Beliefs: name the invisible chains', d: '18 min' },
          { t: 'Rewirement: Catch one "I can\'t" in the wild today', d: '8 min', kind: 'practice' },
          { t: 'The Neuroscience of Belief: wired for safe, not free', d: '22 min' },
          { t: 'Rewirement: Name your safety pattern', d: '8 min', kind: 'practice' },
          { t: 'Identifying Your Limiting Beliefs: stop guessing, start excavating', d: '20 min' },
          { t: 'Rewirement: The excavation worksheet', d: '12 min', kind: 'practice' }
        ]
      },
      {
        title: 'Part 2 — Break the Pattern',
        lessons: [
          { t: 'Challenging and Reframing Beliefs: the belief was never the truth', d: '25 min' },
          { t: 'Rewirement: The reframe drill', d: '10 min', kind: 'practice' },
          { t: 'The Power of Mindset Shifts: beyond the temporary fix', d: '20 min' },
          { t: 'Rewirement: Your daily shift practice', d: '8 min', kind: 'practice' },
          { t: 'Actionable Strategies for Change: transformation needs execution', d: '22 min' },
          { t: 'Rewirement: One action before noon', d: '5 min', kind: 'practice' }
        ]
      },
      {
        title: 'Part 3 — Become Who You Decided to Be',
        lessons: [
          { t: 'Building Resilience: the setback is part of the strategy', d: '18 min' },
          { t: 'Rewirement: The setback protocol', d: '10 min', kind: 'practice' },
          { t: 'Embracing Empowering Beliefs: this is who you\'ve become', d: '25 min' },
          { t: 'Rewirement: Write the new belief — and sign it', d: '10 min', kind: 'practice' }
        ]
      },
      {
        title: 'The 1% Challenge',
        lessons: [
          { t: 'Choose your 4-week rewirement', d: '6 min', kind: 'practice' },
          { t: 'Track it daily: the challenge scoreboard', d: '4 min', kind: 'practice' },
          { t: 'Retake the Belief Baseline: measure the change', d: '10 min', kind: 'assessment' },
          { t: 'Where you go from here', d: '5 min' }
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
