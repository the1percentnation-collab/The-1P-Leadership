# 1P Certified Life Coach: Build Plan

Companion to `1p-certified-life-coach-spec.md` (the what). This is the how and
the order. Brand voice rules live in the one-percent-context skill. No em dashes.

## Where the build actually stands (audited 2026-09-11)

Built and deployed, in production Firestore:

- Course record `courses/1p-clc` at $3,497, status coming-soon, cohort
  placeholders (dates, call day/time, Zoom link all TBD).
- Eight modules seeded (1 published, 2 to 8 draft). Every module is a sketch:
  600 to 1,700 characters of lesson text. Not deliverable yet.
- Written exam: `startExam` / `submitExam` callables, 80 percent pass, 3
  attempts, 15 questions drawn from an 18-question bank. The bank is too small
  for three distinct attempts.
- Hour log (`users/{uid}/coachingHours`, admin approval), capstone recording
  submission and rubric review (four criteria scored 0 to 5), certification
  issuance with license expiry, annual renewal checkout, coach directory page,
  certificate page.
- Payment plans: 6 x $697 and 10 x $397 as Stripe subscriptions with a fixed
  installment count. FOUNDING coupon: $1,500 off, capped at 20.
- Generic course landing page (`/course.html?course=1p-clc`) with "Notify me"
  while the course is coming-soon.

So the portal is not the gap. The product is. Nothing below touches functions
or rules.

## What ships in this round

Four workstreams, built in parallel, each owning its own files.

### A. Modules 1 to 4 at teaching depth
Files: `scripts/clc-content/module-01.js` to `module-04.js`.
Each module becomes a full week of instruction: 6 to 9 sections, a live-call
agenda, a practice assignment that produces logged hours, a workbook with 5 to
7 prompts, and a takeaway summary. Target 9,000 to 14,000 characters of lesson
HTML per module. Module 1 stays published; the rest stay draft until Anthony
reviews.

### B. Modules 5 to 8 at teaching depth, plus the published rubric
Files: `scripts/clc-content/module-05.js` to `module-08.js`,
`docs/1p-clc-rubric.md`.
Same depth standard. Module 8 carries the full rubric with what a 2, a 3 and a
5 sound like on each of the four criteria (Presence and Listening, Question
Quality, Session Structure, Non-Advising), since the spec promises nothing
about the review is a surprise. The rubric doc is the admin's scoring guide and
must match module 8 word for word on the descriptors.

### C. Dedicated sales page
Files: `public/clc.html`, `public/js/clc-page.js`.
Reachable at `the1pnation.com/clc`. Leads with the spec's core copy. Reads
cohort dates, capacity and status from Firestore so the page flips from
"Notify me" to "Enroll" without a deploy, offers the two payment plans, and
states the founding offer. Says plainly what the credential is and is not.

### D. Exam bank and the client-facing kit
Files: `scripts/clc-content/exam.js`, `docs/clc-client-kit/*.md`.
Exam bank to 45 or more questions, tagged by module, so three attempts draw
materially different papers. The client kit is what the license actually sells:
the six-week A.L.I.G.N. client program (session by session), the client
workbook, and the Alignment Assessment. Delivered as reviewable documents
first; they become portal resources once Anthony signs off.

## After this round (needs Anthony)

1. Review modules 2 to 8 and flip `published: true` in each file.
2. Set cohort dates, call day and time, Zoom link (course builder or seed).
3. Run `scripts/seed-clc.js` against production to push the content.
4. Flip `courses/1p-clc` status to live when enrollment opens.
5. Decide the go/no-go on the founding cohort at $1,997.

## Guardrails for every workstream

- The credential is a certification. The license is the IP right. Never call
  the credential a license. Never imply ICF accreditation.
- A.L.I.G.N. is Awareness, Leadership, Identity, Growth, Navigation. Fixed.
- No invented statistics, testimonials, graduate outcomes, or income claims.
- Brand voice: grounded, direct, clear. No hype, no fear, no em dashes.
- Field names and Firestore shapes stay exactly as they are; the renderer and
  the callables depend on them.
