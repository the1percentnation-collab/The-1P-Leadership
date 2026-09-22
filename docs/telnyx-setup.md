# Telnyx setup

Telnyx is the provider for texting, and will be for calling once the voice
port lands. The reason is the registration path: Telnyx offers a **Sole
Proprietor 10DLC brand** that takes your name, address, mobile number and the
last four digits of your SSN. No EIN, no business documents.

Nothing here has to be done all at once. Every feature checks its own
environment variables and reports "not set up yet" until they exist, so a
deploy with none of this configured still succeeds.

Two Claude for Chrome prompts drive this from the browser:
[`telnyx-chrome-prompt.md`](telnyx-chrome-prompt.md) sets up an account from
nothing, and [`telnyx-chrome-activate-prompt.md`](telnyx-chrome-activate-prompt.md)
is the finishing pass when the account exists but the CRM still says "SMS is
not configured yet" — it collects the IDs, adds the repository secrets,
re-runs the deploy, and reads the log back to prove the values landed.

## 1. Register the brand and campaign

Mission Control → **Messaging → 10DLC**.

1. Create a brand, entity type **Sole Proprietor**. It asks for personal
   details, address, mobile number and the last four of your SSN.
2. Answer the OTP text it sends to that mobile number. The Campaign Registry
   gives you a **24 hour window** and the brand fails if it lapses.
3. Create one campaign. A sole proprietor campaign is capped at **one phone
   number** and a lower daily volume than a standard brand. The campaign copy
   — use case, opt-in description, sample messages — is already written in
   [`sms-registration.md`](sms-registration.md) and matches the real `/webinar`
   opt-in form on the site. Paste it as-is.
4. Buy a local number and attach it to the campaign.

Expect a few days end to end. Until the campaign is approved, carriers block
the traffic, so leave `TELNYX_FROM_NUMBER` unset rather than sending into a
block and paying the sender fees.

## 2. Collect the credentials

| Value | Where |
|---|---|
| `TELNYX_API_KEY` | Mission Control → **API Keys** → create key. One bearer token for the whole v2 API. |
| `TELNYX_PUBLIC_KEY` | Mission Control → **Account Settings → Keys & Credentials** → your account's *public* key. Per-account, base64. |
| `TELNYX_FROM_NUMBER` | The local number attached to the approved campaign, E.164 (`+14055550123`). |
| `TELNYX_MESSAGING_PROFILE_ID` | Optional. Mission Control → **Messaging → Messaging Profiles**. Only needed to force a specific profile instead of the number's default. |

Add each one as a **GitHub repository secret** under Settings → Secrets and
variables → Actions. CI writes `functions/.env` from those secrets on every
backend deploy, which makes the repository secrets the single source of truth:
a value set by hand with `firebase functions:config` or a local `.env` is wiped
by the next merge to `main`.

`TELNYX_PUBLIC_KEY` is not optional in practice. Webhooks are verified with
Ed25519 against it, and with no key configured every webhook is **rejected**.
That is deliberate fail-closed behaviour: an unverified webhook could create
contacts and flip opt-out flags, so rejecting is the only safe default. The
symptom of forgetting it is inbound texts never appearing, not an error.

## 3. Point the webhooks at the functions

Mission Control → **Messaging → Messaging Profiles** → your profile → Inbound
and Outbound settings:

- **Inbound (webhook URL):** `https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxInboundWebhook`
- **Outbound / delivery receipts:** `https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxStatusWebhook`
- **Webhook API version:** API v2 (the Ed25519-signed format).

Telnyx will send every message event to whichever URL you give it, so the two
are kept separate here: a flood of delivery receipts can then never reach the
contact-creation path.

## 4. Verify

1. Send a text from a contact record. It should appear on that contact's
   timeline immediately and pick up a delivery status within a few seconds
   once `telnyxStatusWebhook` fires.
2. Reply from that phone. The reply should land on the same timeline, and any
   active follow-up sequence for the contact should stop — a lead who replies
   is a live conversation, not a cadence.
3. Reply **STOP**. The contact flips to opted out, a further send is refused
   with a clear error, and every active enrollment stops. This is TCPA
   behaviour, not a nicety.
4. Signature handling has unit tests that do not need an account:
   `cd tests && npm run test:telnyx`. They generate a real Ed25519 keypair and
   check that a valid signature passes, a tampered body fails, a wrong key
   fails, a stale timestamp fails, and re-serialised JSON fails (which is what
   proves the raw request bytes are being used).

## 5. Calling

Voice needs no registration at all. No 10DLC, no campaign, no waiting: buy a
number, add the credentials, and the softphone works.

### The SIP connection is a security control

Mission Control → **Voice → SIP Connections** → create a connection of type
**Credentials**. Copy its id into `TELNYX_SIP_CONNECTION_ID`.

WebRTC credentials hang off that connection, and its **outbound voice profile**
is what authorises PSTN calls. Read that as security, not billing. The browser
holds a real SIP credential, so it can dial anywhere the profile permits — and
unlike the old Twilio path, there is no server-side document in the middle that
could refuse. Before going live, on the connection's outbound voice profile:

- restrict destinations to the countries you actually call (US and Canada),
- set a **daily spend limit** you would not mind losing,
- leave concurrent-call limits at something sane for one operator.

Without those, a compromised admin session is toll fraud with no ceiling.

The CRM's own consent check still runs: `authorizeCall` re-reads the contact
server-side immediately before each dial and refuses a do-not-call record, and
a refusal is a hard stop rather than a fall-through to the phone's dialer. That
holds against an honest client. The voice profile is what holds against a
tampered one.

### Per-agent credentials

The first time a rep opens the dialer, the server creates a telephony
credential for them on that connection and mints a short-lived JWT against it.
Nothing to configure. Two consequences worth knowing: a rep who has never
opened the dialer cannot be rung by an inbound call (their browser has no SIP
identity yet, so the call goes to voicemail), and revoking one rep means
deleting one credential in Mission Control rather than rotating a shared
secret.

### Inbound calls and the cell bridge

Both need a TeXML application: Mission Control → **Voice → TeXML
Applications**. Copy its id into `TELNYX_TEXML_APP_ID`, and set its voice URL
to:

    https://us-central1-the-1p-leadership.cloudfunctions.net/voiceInboundTwiml

Then assign your number to that application. Inbound calls ring whichever rep
owns the contact, fall back to every admin, and record a voicemail if nobody
picks up.

Cell-bridge mode — Telnyx rings your own phone first, then the lead, so no
WebRTC and no microphone permission — needs the same application plus your
mobile number in CRM Settings. It is also the only mode where one-click
voicemail drop works: a browser call has no server-side leg to redirect into a
greeting, and the dock says so rather than failing quietly.

`voiceInboundTwiml`'s URL is configured by hand in the portal, so it cannot
carry a token we issued and the Ed25519 signature is its only check. If inbound
calls never ring, `TELNYX_PUBLIC_KEY` is the first thing to check. The
callbacks the CRM builds itself carry an HMAC token as well, so they stay
verifiable either way.

### Optional

| Value | Where |
|---|---|
| `TELNYX_CALLER_ID` | The number leads see. Optional — falls back to `TELNYX_FROM_NUMBER`. |
| `TELNYX_TEXML_APP_ID` | Only needed for inbound routing and cell bridge. The browser softphone works without it. |

Recording is a per-company setting in CRM Settings (`off`, `announce`, `on`),
and `announce` plays a notice before connecting. Two-party-consent states make
announcement the only defensible default, which is why it is worded plainly in
the UI rather than hidden in a toggle.

## What is still on Twilio

Nothing in the live path. The Twilio SMS and voice functions are still in the
file, and the Twilio SDK is still vendored, deliberately: until texting and
calling have been exercised against a real Telnyx account, keeping that code
means a failed migration is a revert rather than a rebuild. Once both are
proven, the `twilio` dependency, its functions,
`public/vendor/twilio-voice-2.18.5.min.js` and
[`twilio-setup.md`](twilio-setup.md) all come out.
