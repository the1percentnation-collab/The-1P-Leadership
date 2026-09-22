// Business Alignment · content pack manifest.
//
// A content pack is everything scripts/seed-course.js needs to push one
// self-paced course into Firestore: which course it belongs to, the modules in
// order, and the human steps that remain after the write.
//
// Course metadata (price, copy, curriculum outline shown on the landing page)
// lives in public/js/courses-registry.js and is NOT written from here. This
// pack owns lesson content only, so seeding can never overwrite the sales page
// or flip a course live by accident.

const modules = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
  require(`./module-${String(n).padStart(2, '0')}.js`));

module.exports = {
  slug: 'business-alignment',

  // Identity guard. seed-course.js refuses to write if the live course doc
  // carries a different title, because a slug holding another program is how
  // two courses get merged into one subcollection with no undo.
  expectTitle: 'Business Alignment',

  modules,

  postSeed: [
    'Review all eight modules in /manage-courses.html. They are seeded as',
    'published because this is a self-paced course with no weekly drip: a',
    'draft module would be an invisible hole in the middle of a $297 product.',
    'The gate that keeps buyers out is the course status, not the modules.',
    '',
    'If the run refused because courses/business-alignment does not exist,',
    'open the "..." menu in /manage-courses.html and choose "Seed built-in',
    'courses to database" first. It only creates what is missing.',
    '',
    'Then, in order:',
    '  1. Read modules 1 and 8 side by side. The 30 audit statements are',
    '     identical on purpose. If you edit one, edit both or the before/after',
    '     comparison the course sells is invalid.',
    '  2. The rewirements in this course are client-facing: repricing, stated',
    '     boundaries, published messaging. Read them as the owner before you',
    '     sell them, because a buyer will ask you about at least one.',
    '  3. STRIPE_WEBHOOK_SECRET must be a real whsec_ value, or a purchase is',
    '     charged and never enrolled. See docs/launch-runbook.md step 2.',
    '  4. Flip courses/business-alignment to status live in',
    '     /manage-courses.html when you are ready to sell it at $297.'
  ]
};
