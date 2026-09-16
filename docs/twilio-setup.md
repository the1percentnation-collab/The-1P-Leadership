# Twilio setup, step by step

Two independent tracks. **Voice needs no registration and can be done in about
fifteen minutes.** Texting waits on toll-free verification (1-3 business days),
covered in [`toll-free-verification.md`](toll-free-verification.md).

Do voice first. It is the part that works today.

---

## How credentials reach production

Every value below goes in as a **GitHub repository secret**, not into a file on
your machine:

> GitHub → `the1percentnation-collab/The-1P-Leadership` → Settings → Secrets
> and variables → Actions → New repository secret

The deploy workflow writes `functions/.env` from those secrets on every run, so
CI is the single source of truth. Setting them locally instead would work until
the next merge to `main` redeployed the functions without them and silently
switched calling back off.

`functions/.env.example` lists every variable with a note on what it is for.

**After adding or changing any secret, the functions must be redeployed** —
either merge anything that touches `functions/`, or: GitHub → Actions → "Deploy
Firestore rules + Storage rules + Cloud Functions" → Run workflow. The log
prints which variables it set, so you can confirm they landed.

Your function base URL, used throughout:

```
https://us-central1-the-1p-leadership.cloudfunctions.net
```

---

## Track 1 — Voice (no registration required)

### 1. Buy a number with Voice capability

Twilio Console → Phone Numbers → Manage → Buy a number. Tick **Voice**. A local
number is fine and gets better answer rates than toll-free on outbound.

If you also want this number to text later, tick **SMS** too — but note that a
*local* number needs 10DLC to send A2P SMS, which is the thing you do not have
an EIN for. The clean split is: local number for calling, toll-free number for
texting. They can coexist.

### 2. Create an API key

Console → Account → API keys & tokens → **Create API key**.

- Friendly name: `1P CRM voice`
- Key type: **Standard**

Copy both halves immediately; the secret is shown once.

| Secret name | Value |
|---|---|
| `TWILIO_API_KEY_SID` | the `SK…` SID |
| `TWILIO_API_KEY_SECRET` | the secret shown once |

This is separate from your account SID and auth token on purpose: minting a
Voice access token for the browser softphone requires an API key, and the
account auth token cannot do it.

Also add, from Console → Account → the dashboard:

| Secret name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | your `AC…` account SID |
| `TWILIO_AUTH_TOKEN` | your account auth token |

The auth token is what validates the signature on every inbound webhook, so
voice will not work without it.

### 3. Create a TwiML App

Console → Voice → Manage → TwiML Apps → **Create new TwiML App**.

- Friendly name: `1P CRM softphone`
- **Voice → Request URL:**
  `https://us-central1-the-1p-leadership.cloudfunctions.net/voiceOutboundTwiml`
  method **HTTP POST**

Leave the status callback blank — the CRM passes its own per-call callback URL
with the call id attached, which is more reliable than the app-level one.

Save, then copy the `AP…` SID:

| Secret name | Value |
|---|---|
| `TWILIO_TWIML_APP_SID` | the `AP…` SID |

### 4. Set the caller ID

| Secret name | Value |
|---|---|
| `TWILIO_CALLER_ID` | the number leads should see, e.g. `+15551230123` |

Optional — it falls back to `TWILIO_FROM_NUMBER`. Set it explicitly if your
calling number and texting number differ, which they will if you are using a
local number for voice and toll-free for SMS.

### 5. Point the number at the inbound handler

Phone Numbers → Manage → the number you bought → **Voice & Fax**:

- **A call comes in:** Webhook →
  `https://us-central1-the-1p-leadership.cloudfunctions.net/voiceInboundTwiml`
  method **HTTP POST**

Inbound calls then create the caller as a contact if they are unknown, ring the
assigned rep's softphone (or every admin if unassigned), and fall through to
voicemail on no answer.

### 6. Deploy and test

Run the backend workflow, then in the CRM:

1. Open any contact with a phone number. Click **Call**. The browser will ask
   for microphone permission — allow it. The call panel appears inside the
   contact card and the record stays on screen.
2. Call your own mobile. Confirm two-way audio.
3. Hang up. Pick a disposition. Confirm it appears on the contact timeline with
   the duration.
4. From an unknown phone, call the Twilio number. Confirm a new contact is
   created and your softphone rings.

### 7. Optional: your own cell instead of the browser

CRM → Settings → Calling → set **My call mode** to "Ring my cell, then the
lead" and fill in your mobile number. Twilio then calls your phone first and
bridges you to the lead. No microphone permission, works from anywhere, and no
WebRTC involved.

### 8. Optional: recording

CRM → Settings → Calling → **Call recording**.

Leave it **Off** unless you need it. If you turn it on, choose "On, with a
spoken notice" — silent recording is illegal in two-party-consent states
(California, Florida, Illinois and others), and an announcement is the only
defensible default when you cannot know where a lead is sitting.

---

## Track 2 — Texting (after toll-free approval)

Do not set `TWILIO_FROM_NUMBER` until verification is approved: a toll-free
number cannot send to the US or Canada before then, so every send fails.

Once the approval email arrives:

| Secret name | Value |
|---|---|
| `TWILIO_FROM_NUMBER` | the approved toll-free number, e.g. `+18005550123` |

Then Phone Numbers → Manage → the toll-free number → **Messaging**:

- **A message comes in:** Webhook →
  `https://us-central1-the-1p-leadership.cloudfunctions.net/twilioInboundWebhook`
  method **HTTP POST**
- **Status callback URL:**
  `https://us-central1-the-1p-leadership.cloudfunctions.net/twilioStatusWebhook`

Redeploy, then send a text from a contact record to your own phone. Reply STOP
and confirm the contact shows "Replied STOP — texting blocked" and that further
sends are refused.

---

## Track 3 — The automation tick

Needed for sequence steps, task and appointment reminder emails, and Google
Calendar watch renewal. Generate a secret:

```
openssl rand -hex 32
```

Add it **twice**, under the same name `CRM_TICK_SECRET`: once as a repository
secret (so the `crm-tick` workflow can authenticate) and that same value is
what the deploy writes into the functions env. One secret, one name, used by
both sides.

The `CRM automation tick` workflow runs every 15 minutes and currently exits
cleanly with a warning because the secret is unset. Once it is set the tick
starts doing real work.

---

## Troubleshooting

**"Calling is not set up yet. Missing: …"** — the message names exactly which
variables are absent. Check the deploy log's "Write functions runtime env" step
to see what CI actually wrote.

**Microphone blocked** — the site sends `Permissions-Policy: microphone=(self)`,
so the browser prompt is the only gate. Allow it for the1pnation.com. Failing
that, use cell-bridge mode, which needs no microphone.

**Calls connect but nothing appears on the timeline** — the auth token is wrong
or missing, so `voiceStatusWebhook` is rejecting Twilio's signature as invalid.
Check `TWILIO_AUTH_TOKEN`.

**"You are not authorized to place calls for this account"** — spoken down the
line rather than shown on screen. The signed-in user is not in the company's
`adminUids`. Add them from `/owner.html`.

**Everything 403s** — the webhook URLs must match exactly what Twilio calls,
including https and no trailing slash. Signature validation covers the full URL.
