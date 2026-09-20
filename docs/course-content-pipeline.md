# Course content pipeline

How a self-paced course goes from an outline on the sales page to lessons a
member can actually open. Built for Mindset Foundations and designed so the
next course costs writing time only.

## The split

Three things live in three places, on purpose.

| What | Where | Who changes it |
|---|---|---|
| Price, sales copy, curriculum outline, status | `public/js/courses-registry.js`, overridden by `courses/{slug}` in Firestore | Anthony, in `/manage-courses.html`, no deploy |
| Lesson content (the teaching) | `scripts/course-content/{slug}/` in this repo, pushed to `courses/{slug}/modules/{id}` | Written here, reviewed, then seeded |
| Member progress | `users/{uid}/progress/...` | The member |

The seeder writes the middle row and nothing else. It cannot set a price,
cannot edit the sales page, and cannot flip a course live. That is deliberate:
a seed script that could put a product on sale is a seed script that eventually
does, on the wrong day.

## Building a new course

1. **Confirm the outline.** The `curriculum` array for that slug in
   `courses-registry.js` is the promise the sales page already makes. Lessons
   are written to match it, not the other way around.
2. **Create the pack.** `scripts/course-content/{slug}/` with one file per
   module and an `index.js` manifest.
3. **Write the modules.** One file each, exporting the shape below.
4. **Run the tests.** `cd tests && npm run test:courses`.
5. **Dry run it.** `cd scripts && node seed-course.js {slug} --dry-run`.
6. **Seed it.** Same command without the flag.
7. **Review in the portal**, then flip the course live when Stripe is verified.

## Module shape

Every module file exports one object. These field names are what
`course-renderer.js` reads, so they are not negotiable.

```js
module.exports = {
  id: 2,                        // positive integer, also the sort order
  title: 'Module 1: The Operating System',
  subtitle: 'How beliefs drive behavior, and how to catch one in the act.',
  pillar: 'The Five Foundations',   // section label, written as tagLabel
  duration: '20 min',
  published: true,
  html: `<p>...</p>`,           // the lesson body, sanitized on render
  workbook: {
    reflection: '...',          // one deep prompt
    action: '...',              // what they do in the real world this week
    prompts: ['...', '...']     // 5 to 8 saved fields
  },
  summary: ['...']              // key takeaways tab
};
```

The manifest (`index.js`) exports `{ slug, expectTitle, modules, postSeed }`.
`expectTitle` is the identity guard: the seeder refuses to write if the live
course doc carries a different title, because a slug quietly holding two
programs at once is a failure this project has already paid for once.

## Standards a pack has to meet

Enforced by `tests/course-content.test.cjs`, which runs in `npm test`:

- Every module carries the fields the renderer reads.
- Module ids are `1..n` with no gaps.
- Lessons are at teaching depth. The floor is 6,000 characters of lesson HTML;
  the target is 9,000 to 14,000, the same standard the Life Coach modules hold.
- No em dashes anywhere in learner-facing copy.
- Every workbook has a reflection and an action.
- **Assessment parity.** If a course uses a before and after instrument, the
  statements must be word for word identical in both modules. The 1% Method
  sells a measured change, and an instrument that drifted between the baseline
  and the retake measures nothing. The test compares them statement by
  statement and names the one that differs.

## Publishing rule

Self-paced courses are seeded **published**, every module. There is no drip in
this codebase, so a draft module is an invisible hole in the middle of a
product someone paid for. The thing that keeps buyers out is the course
`status`, not the module toggles.

Cohort programs are the opposite. The Life Coach seeds modules 2 through 8 as
drafts on purpose, because its weeks open one at a time. That course has its
own script, `seed-clc.js`, which also handles cohort dates, the exam bank, the
FOUNDING coupon and the certification config. Do not fold it into this one.

## Current packs

| Slug | Modules | State |
|---|---|---|
| `mindset-foundations` | 7 (Start Here, five teaching modules, the 1% Challenge) | Written, not yet seeded |

Still outlined in the registry with no lessons written: `business-alignment`
(6 modules, $297), `faith-leadership` (4 modules, $197),
`performance-discipline` (5 modules, $197). Each is now content work only.

## Known gap: assessments and challenge tracking

Four courses promise a baseline assessment, a final retake, and daily tracking
through a four week 1% Challenge. There is no assessment engine and no habit
tracker in the codebase today.

Mindset Foundations delivers all three as workbook instruments: the member
scores themselves inside the lesson and records the numbers in saved workbook
fields. That is honest and it works, but it means no scoring, no stored
history, and no before and after chart the portal can render.

If that becomes a product priority, the build is a scored assessment type in
the course builder plus a streak field on the member's progress doc. It is a
portal feature, not a content problem, and it should not block the remaining
three courses.
