// Which purchases put which books in the digital library.
//
// Every way into a course (checkout, a $0 promo code, enrollFree, an admin or
// beta grant) writes users/{uid} through enrollmentFields(), and
// storage.rules hands out the EPUB on the ownedBookIds it writes. These pin
// the I Can't formats: both bundles grant the book, only the print bundle
// ships a paperback, and a Firestore override on the course record wins.
//
// Extracted from the shipped functions/index.js so the rules asserted here
// are the rules that run.
//
// Run: node tests/books-fulfillment.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('const COURSE_FULFILLMENT');
const end = src.indexOf('// Stripe moved the collected address');
assert.ok(start > 0 && end > start, 'could not locate the fulfillment helpers in functions/index.js');

const admin = {
  firestore: {
    FieldValue: { arrayUnion: (...xs) => ({ __union: xs }) }
  }
};
// eslint-disable-next-line no-new-func
const lib = new Function('admin', `${src.slice(start, end)}
  return { courseFulfillment, booksForCourse, enrollmentFields, grantingSlugsFor };`)(admin);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

console.log('books — which purchases fill the library');

ok('the digital bundle grants the book and ships nothing', () => {
  const f = lib.courseFulfillment('bundle-icant', {});
  assert.strictEqual(f.shipsBook, false);
  assert.deepStrictEqual(lib.booksForCourse('bundle-icant', {}), ['i-cant']);
});

ok('the print bundle grants the book and ships the paperback', () => {
  const f = lib.courseFulfillment('bundle-icant-print', {});
  assert.strictEqual(f.shipsBook, true);
  assert.deepStrictEqual(f.enrollsAlso, ['icant']);
  assert.deepStrictEqual(lib.booksForCourse('bundle-icant-print', {}), ['i-cant']);
});

ok('a grant of the course itself (beta, comp) also grants the book', () => {
  assert.deepStrictEqual(lib.booksForCourse('icant', {}), ['i-cant']);
});

ok('an unrelated course grants no books and writes no ownedBookIds', () => {
  assert.deepStrictEqual(lib.booksForCourse('1p-clc', {}), []);
  const w = lib.enrollmentFields('1p-clc', {});
  assert.deepStrictEqual(w.enrolledCourseSlugs.__union, ['1p-clc']);
  assert.ok(!('ownedBookIds' in w));
});

ok('a bundle write enrolls the wrapped course and adds the book', () => {
  const w = lib.enrollmentFields('bundle-icant', {});
  assert.deepStrictEqual(w.enrolledCourseSlugs.__union, ['bundle-icant', 'icant']);
  assert.deepStrictEqual(w.ownedBookIds.__union, ['i-cant']);
});

ok('books attached to the wrapped course come along with the bundle', () => {
  // A Firestore record for a new bundle that only names the course it
  // unlocks still grants that course's book.
  const w = lib.enrollmentFields('bundle-new', { enrollsAlso: ['icant'] });
  assert.deepStrictEqual(w.ownedBookIds.__union, ['i-cant']);
});

ok('the course record in Firestore overrides the code defaults', () => {
  assert.strictEqual(lib.courseFulfillment('bundle-icant', { shipsBook: true }).shipsBook, true);
  assert.deepStrictEqual(lib.booksForCourse('mindset-foundations', { grantsBooks: ['work-less'] }), ['work-less']);
  assert.deepStrictEqual(lib.booksForCourse('icant', { grantsBooks: [] }), []);
});

ok('a missing course record is treated as empty, not a crash', () => {
  assert.deepStrictEqual(lib.booksForCourse('icant', null), ['i-cant']);
  assert.strictEqual(lib.courseFulfillment('icant', undefined).sellable, false);
});

ok('the courses a bundle unlocks contribute the books on THEIR records', () => {
  const real = 'i-cant-strategies-to-overcoming-your-limiting-beliefs';
  // Exactly what Manage Library writes: the book attached to icant only.
  const docs = { icant: { grantsBooks: [real] } };
  // The bundle's own default plus the real book from the icant record.
  assert.deepStrictEqual(lib.booksForCourse('bundle-icant', {}, docs), ['i-cant', real]);
  // With the bundle record also pointing at the real book, nothing stale remains.
  assert.deepStrictEqual(lib.booksForCourse('bundle-icant', { grantsBooks: [real] }, docs), [real]);
  assert.deepStrictEqual(lib.enrollmentFields('bundle-icant-print', { grantsBooks: [real] }, docs).ownedBookIds.__union, [real]);
  // Without records the defaults still apply.
  assert.deepStrictEqual(lib.booksForCourse('bundle-icant', {}), ['i-cant']);
});

ok('the sync picks every course that grants the book, from code defaults or the record', () => {
  const docs = { 'bundle-icant': {}, 'bundle-icant-print': {}, 'icant': {}, '1p-clc': {}, 'mindset-foundations': { grantsBooks: ['i-cant'] } };
  assert.deepStrictEqual(lib.grantingSlugsFor('i-cant', docs).sort(),
    ['bundle-icant', 'bundle-icant-print', 'icant', 'mindset-foundations']);
  assert.deepStrictEqual(lib.grantingSlugsFor('work-less', docs), []);
  // A record can also take a default grant away.
  assert.deepStrictEqual(lib.grantingSlugsFor('i-cant', { icant: { grantsBooks: [] }, 'bundle-icant': {} }), ['bundle-icant']);
});

console.log(`\n${passed} passed`);
