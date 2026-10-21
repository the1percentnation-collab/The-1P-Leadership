# My Plan

My Plan turns assessment results into goals that live in the member portal,
instead of a report someone prints and forgets.

## How a member uses it

1. **Take an assessment.** The report ends with "Build my plan."
2. **The wizard (`/plan-build?a=<slug>`)** has four steps:
   - **Pick your focus.** Every area as a card, weakest score first (or the
     member's own type first on profile assessments). One is marked
     Recommended. Up to two can be picked. "Use the recommended plan" skips
     straight to Step 4.
   - **Choose your actions.** Each area's three actions, as tasks to keep or drop.
   - **Make it yours.** Reword the goal and every task, change due dates
     (filled in one week apart), add their own tasks, and answer the area's
     reflection question for their private journal.
   - **Commit.** Start date, weekly check-in day, and reminders (email, portal
     notice, push).
3. **My Plan (`/plan`)** shows their goals, with the focus goal first. On each
   goal they can check off tasks, add or edit tasks, do the weekly check-in,
   and do the day-30 review. The page also has their journal, a calendar
   export (.ics), and Print as a secondary option.

The Goal Planner (`/goal-planning`) now has a "Save to My Plan" button. It
turns the 90-day plan into one goal with the key results as tasks and a review
at day 90.

## The rules

- **Three active goals at most.** When a member is at the limit, the wizard
  asks them to move a goal to Later or mark it done, or to add the new goal to
  Later.
- **Goal = area, task = action.** Each area has a goal statement (the `goal`
  field in `public/js/assessments/*.js`). The test suite fails if an
  assessment ships without one.
- **Targets come from the score.** A score area aims 10 points higher by its
  review. A pattern you want less of (limiting beliefs) aims 10 lower. A type
  or style gets no target.
- **Retakes are history.** Every result is saved to
  `users/{uid}/assessmentHistory`. The latest result keeps the one it
  replaced as `previous`. A retake also updates the score on every goal built
  from that assessment, so the review shows "34 → 46."
- **Points reward the habit, not the volume.** A check-in earns 3 points (at
  most once every five days). A finished review earns 10. Checking off tasks
  earns nothing.

## Sharing

- **Coaches.** A member can share one goal with a certified coach from the
  directory. The coach sees that goal's tasks, score and check-ins under
  "People you coach" on their own My Plan page. The journal is never shared.
- **Teams.** A company admin sees team totals on My Plan: plan adoption,
  tasks done, check-ins, and average scores by area. Nothing appears until at
  least three people are counted. No individual goals or scores are ever shown.

## What Anthony sees

- Every member who starts a plan gets the **My Plan** tag in the CRM.
- When a **Priority Lead** (leads 11 or more people, or runs an organization
  with a team) finishes a goal, an open CRM task is created: "Morgan finished
  a goal," with the score change. On team assessments, the task suggests
  offering the Alignment Audit.
- When a Priority Lead's goal goes 14 days with no activity, a CRM task
  suggests a short note.

## Behind the scenes

| Piece | Where |
| --- | --- |
| Goal rules (one source) | `public/js/plan-core.js`, generated into `functions/plan-core.js` by `node scripts/build-plan-server.cjs` |
| Every write | `managePlan` callable. Goals, journal and history are read-only to the browser (`firestore.rules`). |
| Visitors who unlocked a report with name and email but have no password yet | `claimPlan` saves only to an account created in the last week that nobody can sign in to yet and that has no goals |
| Weekly check-in and day-30 review reminders | `sendPlanReminders`, a step in the hourly automation tick. Sent 9 AM to 9 PM in the member's timezone, once per day at most. |
| Coach view / team totals | `getCoachClients` / `getTeamPlanSummary` |
| Dashboard | A due review, a due check-in, or the focus goal's next task appear first in "Your next step." |

Deleting an account now deletes goals, journal, assessment results and their
history. Assessment results and course commitments were previously left
behind after a deletion; that gap is closed too.

## Tests

- `node tests/plan.test.mjs`: goal rules, reminders, team totals, calendar
  export, and the wiring (rules, indexes, rate limits, account deletion).
- `npm run e2e:plan` in `tests/`: the whole flow on the emulators.
- The rules suite (`npm run emulator`) covers who can read and write plans.
