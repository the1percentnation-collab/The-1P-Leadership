// Mindset Foundations · content pack manifest.
//
// A content pack is everything scripts/seed-course.js needs to push one
// self-paced course into Firestore: which course it belongs to, the modules in
// order, and the human steps that remain after the write.
//
// Course metadata (price, copy, curriculum outline shown on the landing page)
// lives in public/js/courses-registry.js and is NOT written from here. This
// pack owns lesson content only, so seeding can never overwrite the sales page
// or flip a course live by accident.

const modules = [1, 2, 3, 4, 5, 6, 7].map((n) =>
  require(`./module-${String(n).padStart(2, '0')}.js`));

module.exports = {
  slug: 'mindset-foundations',

  // Identity guard. seed-course.js refuses to write if the live course doc
  // carries a different title, because a slug holding another program is how
  // two courses get merged into one subcollection with no undo.
  expectTitle: 'Mindset Foundations',

  modules,

  // Printed after a successful run. These need a decision or an action that a
  // seed script has no business taking on its own.
  postSeed: [
    'Review all seven modules in /manage-courses.html. They are seeded as',
    'published because this is a self-paced course with no weekly drip: a',
    'draft module would be an invisible hole in the middle of a $197 product.',
    'The gate that keeps buyers out is the course status, not the modules.',
    '',
    'If the run refused because courses/mindset-foundations does not exist,',
    'open the "..." menu in /manage-courses.html and choose "Seed built-in',
    'courses to database" first. It only creates what is missing.',
    '',
    'Then, in order:',
    '  1. Read modules 1 and 7 side by side. The 25 assessment statements are',
    '     identical on purpose. If you edit one, edit both or the before/after',
    '     comparison the course sells is invalid.',
    '  2. STRIPE_WEBHOOK_SECRET must be a real whsec_ value, or a purchase is',
    '     charged and never enrolled. See docs/launch-runbook.md step 2.',
    '  3. Flip courses/mindset-foundations to status live in',
    '     /manage-courses.html when you are ready to sell it at $197.'
  ]
};
