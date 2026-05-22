// Course registry — metadata for every course shown in /courses.html.
// Add a course by appending to COURSES. Set `status: 'live'` when ready.
//
// For `live` courses you must also provide a `mount` function that initialises
// the course workspace (sidebar + main) when that tab is activated.
//
// `coming-soon` courses render a centered placeholder; no mount needed.

export const COURSES = [
  {
    slug: '1p-clc',
    title: '1P Certified Leader Coach',
    short: 'Leader Coach',
    subtitle: 'Mindset, structure, and disciplined progress — one percent at a time.',
    status: 'coming-soon',
    eyebrow: 'Certification · 7 Modules',
    price: 497,
    priceLabel: '$497',
    priceNote: 'Full certification · lifetime access',
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
    price: 197,
    priceLabel: '$197',
    priceNote: 'Book included FREE · was $216.99',
    bundleHref: '/bundle.html'
  },
  {
    slug: 'icant',
    title: 'I Can\'t: The Course',
    short: 'I Can\'t',
    subtitle: 'Break the beliefs that have been running your life — and build the ones that set you free.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 8 Modules',
    price: 197,
    priceLabel: '$197',
    priceNote: 'Full course · lifetime access',
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
    price: 197,
    priceLabel: '$197'
  },
  {
    slug: 'business-alignment',
    title: 'Business Alignment',
    short: 'Business',
    subtitle: 'Build a business that reflects your values and sustains your life.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 6 Modules',
    price: 297,
    priceLabel: '$297'
  },
  {
    slug: 'faith-leadership',
    title: 'Faith & Leadership',
    short: 'Faith',
    subtitle: 'Lead from purpose — grounded in principle, not performance.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 4 Modules',
    price: 197,
    priceLabel: '$197'
  },
  {
    slug: 'performance-discipline',
    title: 'Performance & Discipline',
    short: 'Performance',
    subtitle: 'Daily structure and habits that compound into long-term results.',
    status: 'coming-soon',
    eyebrow: 'Self-paced · 5 Modules',
    price: 247,
    priceLabel: '$247'
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
