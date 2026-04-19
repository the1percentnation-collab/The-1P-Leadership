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
    status: 'live',
    eyebrow: 'Certification · 7 Modules',
    mount: async () => {
      const mod = await import('./app.js');
      if (mod && typeof mod.mount === 'function') await mod.mount();
    }
  },
  {
    slug: 'mindset-foundations',
    title: 'Mindset Foundations',
    short: 'Mindset',
    subtitle: 'Rewire how you relate to success, setbacks, and self.',
    status: 'coming-soon',
    eyebrow: 'Coming Soon'
  },
  {
    slug: 'business-alignment',
    title: 'Business Alignment',
    short: 'Business',
    subtitle: 'Build a business that reflects your values and sustains your life.',
    status: 'coming-soon',
    eyebrow: 'Coming Soon'
  }
];

export function getActiveCourse() {
  const slug = new URLSearchParams(location.search).get('course');
  return COURSES.find((c) => c.slug === slug) || COURSES[0];
}
