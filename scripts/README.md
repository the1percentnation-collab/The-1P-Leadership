# Admin scripts

One-off migrations and seeds that run against Firestore with Admin
credentials, from your machine. They are not deployed and nothing calls them
automatically.

## One-time setup

```bash
cd scripts
npm install
```

Then authenticate, using **either** option.

**a) A service account key.** In the Firebase Console, go to Project settings →
Service accounts → Generate new private key. Save the JSON somewhere outside
this repo (it is a credential, do not commit it), then:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/key.json
```

**b) Your own Google account,** if you have the gcloud CLI installed:

```bash
gcloud auth application-default login
```

The project (`the-1p-leadership`) is read from `.firebaserc` automatically.
Every script prints which project it is about to touch before doing anything,
and checks that the credentials actually work before it writes.

## The scripts

| Script | What it does | Run it? |
|---|---|---|
| `fix-clc-slugs.js` | Moves the Leader Coach off the `1p-clc` slug onto `1p-clc-leader` with its lessons, members and purchases; resets `1p-clc` to the Life Coach identity; archives the superseded `silence-the-voice` draft. | **Yes, once.** See below. |
| `seed-clc.js` | Creates the 8 module shells, exam bank and certification config for the $3,497 Life Coach program. | Not yet. Only once its content is written. |
| `seed-booking.js` | Writes `config/booking` with the Zoom scheduler URL. | Optional. `/book-a-call.html` already works from a hardcoded fallback. |
| `seed-resale-products.js` | Creates the A.L.I.G.N. client workbook, assessment and six-week program as draft products. | Not yet. They have no content or final pricing. |
| `seed-financial-partner.js` | Creates the financial services partner company and its waitlist products. | Not yet. The partner name is still a placeholder. |

## Running the CLC slug fix

This is the one to run now. It is destructive, so it defaults to a dry run.

```bash
cd scripts
node fix-clc-slugs.js            # prints the plan, writes nothing
node fix-clc-slugs.js --apply    # commits it
```

Read the dry-run output first and confirm the project name at the top is
`the-1p-leadership`. The apply pass copies the Leader Coach lessons and
verifies they landed before deleting the originals, so a failure partway
through leaves the old data intact. Running it a second time aborts on an
identity check rather than doing anything twice.

Back up first if you want belt and braces:

```bash
gcloud firestore export gs://the-1p-leadership.appspot.com/backups/$(date +%F)
```

## After it runs

`courses/1p-clc-leader` holds the finished 7-module Leader Coach at $497, and
`courses/1p-clc` becomes the Life Coach at $3,497 with no lessons yet. Neither
can be bought until Stripe is connected. See `docs/launch-runbook.md` for the
rest of the sequence.
