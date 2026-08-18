# Firestore rules tests — The Rewrite Method

These cover the drip release: who can read a week's video provider ids, and
when. The lock states in the course player are cosmetic; this is the boundary.

```bash
npm --prefix tests/rules install
npm --prefix tests/rules test
```

Requires Java — the Firestore emulator is a JVM binary. The `test` script runs
from the repo root so it picks up the project's own `firebase.json` and the
real `firestore.rules`; `emulators:exec` starts the emulator, runs the suite,
and shuts it down. Nothing connects to the real project.

Seventeen assertions, grouped:

| Group | What it proves |
|---|---|
| Unentitled readers | No provider id reaches anyone without an enrollment, signed in or not. The course doc stays public so the sales page still works. |
| Drip | At 10 days in, weeks 0 and 1 open; weeks 2 and 5 are refused. Locked week *metadata* stays readable — the path forward is visible. |
| Bonus module | Refused until `reviewChoice` is set, then allowed. `opted_out` unlocks it: the review ask is an ask, not a paywall. |
| `courseState` | A member can read their own state and nobody else's, and cannot backdate `enrolledAt`, self-declare `isRewriter`, or write a check-in directly. |
| Entitlement | A member cannot add a course slug to their own `enrolledCourseSlugs`. |

If you change the unlock rule, change it in all three places it lives:
`firestore.rules` (the boundary), `functions/index.js` (the writes), and
`public/js/rewrite-method.js` (the UI) — then re-run this suite.
