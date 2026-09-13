# Dialer setup (Twilio Programmable Voice)

The CRM dialer is a browser softphone. Agents call from `/dialer.html` or from
the **Call** tab on any contact; audio runs over WebRTC from the browser to
Twilio, and Twilio bridges it to the PSTN with your number as the caller ID.
Nothing is installed on the agent's machine and no personal number is exposed.

Everything below is one-time configuration. The code is already deployed-ready;
until these values exist, every voice endpoint returns a clear
"calling is not configured yet" rather than half-working.

---

## 1. Twilio console

You already have an account and a number for SMS. Add three things.

**API key pair** — Console → Account → API keys & tokens → Create API key.
Choose a *Standard* key, name it `1p-crm-voice`, and copy the **SID** and
**Secret**. The secret is shown once. This pair signs the short-lived access
tokens the browser uses; the account auth token never leaves the server.

**TwiML App** — Console → Voice → TwiML → TwiML Apps → Create.

| Field | Value |
| --- | --- |
| Friendly name | `1P CRM Dialer` |
| Voice Request URL | `https://us-central1-the-1p-leadership.cloudfunctions.net/voiceOutbound` |
| Voice Method | `POST` |

Copy the **Application SID** (starts with `AP`).

**Phone number webhooks** — Console → Phone Numbers → your number → Voice
Configuration:

| Field | Value |
| --- | --- |
| A call comes in | Webhook → `https://us-central1-the-1p-leadership.cloudfunctions.net/voiceInbound` (POST) |
| Call status changes | `https://us-central1-the-1p-leadership.cloudfunctions.net/voiceStatus` (POST) |

Leave the existing Messaging webhooks alone — SMS is unchanged.

## 2. Environment variables

Add to `functions/.env` (alongside the Twilio SMS values) and redeploy:

```
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Already present from SMS and reused by voice: `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

Optional:

```
TWILIO_RECORD_CALLS=true      # dual-channel recording of every outbound call
TWILIO_VOICEMAIL_TEXT=...     # the greeting read when nobody picks up
FUNCTIONS_BASE_URL=...        # override the callback base (see below)
```

`FUNCTIONS_BASE_URL` is only needed if you move the functions off
`https://us-central1-<project>.cloudfunctions.net`, which is what the code
derives by default. It is what Twilio is told to post status and recording
callbacks to, so it must be the base that actually routes to these functions.

Deploy: `./scripts/deploy-functions.sh`, then
`firebase deploy --only firestore:rules,firestore:indexes,hosting`.

## 3. Who rings on inbound

By default every uid in the company's `adminUids` rings in parallel (capped at
five). To narrow it, set `voiceRingUids` on the company document to the uids
that should ring. Unanswered calls fall through to voicemail after 20 seconds;
the recording lands on the call record and on the contact's timeline.

---

## How it fits the CRM

- **Call records** live at `companies/{cid}/calls/{callSid}` and are written
  only by the Twilio webhooks. Clients read them; they cannot forge or edit
  them. Dispositions go through the `logCallOutcome` callable.
- **Every call writes a contact activity**, so the timeline stays the single
  source of truth next to notes, texts, and emails.
- **Dispositions** (`connected`, `booked`, `callback`, `voicemail`,
  `no_answer`, `busy`, `wrong_number`, `not_interested`, `do_not_call`) write
  an activity, optionally a note, and optionally a follow-up task — one round
  trip, so the power dialer never stalls between calls.
- **`do_not_call` is a hard stop across channels.** It sets `doNotCall` on the
  contact *and* `smsOptedOut`, so the dialer skips them and `sendSms` /
  `sendCampaign` refuse to message them.
- **Dialer runs** are recorded at `companies/{cid}/dialerSessions/{id}` with
  dials placed, calls logged, and a per-outcome breakdown.

## Using the dialer

`/dialer.html` builds a queue from contacts that have a phone number and are
not marked do-not-call, coldest-contacted first. Filter by stage or search, and
leave "skip already called today" on for multi-day pushes.

Keyboard, because speed is the whole point:

| Key | Action |
| --- | --- |
| `C` | Call / hang up |
| `M` | Mute |
| `N` | Next contact |
| `1`–`9` | Pick an outcome and advance |

Hanging up drops the cursor straight into the notes box.

## Compliance

- A contact who says do-not-call is flagged on the spot and never dialed or
  texted again by this system.
- Inbound `STOP` already sets `smsOptedOut`; do-not-call now sets it too.
- Recording is off unless `TWILIO_RECORD_CALLS=true`. In two-party-consent
  states you must announce the recording — say it at the top of the call, or
  leave recording off.
- Calling hours and DNC-registry scrubbing are **not** enforced by this code.
  If you dial cold lists, scrub them before import.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| "Calling is not configured yet" | One of the three new env vars is missing; redeploy functions after adding them. |
| Softphone shows "Connecting…" forever | The browser blocked the microphone, or the page is not on HTTPS. WebRTC needs both. |
| Call connects but no audio | Corporate firewall blocking UDP; Twilio needs STUN/TURN egress. |
| Calls ring but never log | The Voice status callback URL is missing on the number, or its signature failed — check the `voiceStatus` function logs. |
| Inbound goes straight to voicemail | Nobody has `/dialer.html` or a contact Call tab open, so no browser client is registered. |
