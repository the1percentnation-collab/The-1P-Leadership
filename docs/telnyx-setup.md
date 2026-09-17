# Telnyx setup

Telnyx is the provider for texting, and will be for calling once the voice
port lands. The reason is the registration path: Telnyx offers a **Sole
Proprietor 10DLC brand** that takes your name, address, mobile number and the
last four digits of your SSN. No EIN, no business documents.

Nothing here has to be done all at once. Every feature checks its own
environment variables and reports "not set up yet" until they exist, so a
deploy with none of this configured still succeeds.

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

- **Inbound (webhook URL):** `https://<region>-<project>.cloudfunctions.net/telnyxInboundWebhook`
- **Outbound / delivery receipts:** `https://<region>-<project>.cloudfunctions.net/telnyxStatusWebhook`
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

## What is still on Twilio

Voice only: the softphone, the cell bridge, inbound call routing and voicemail
drop. Those still read the `TWILIO_*` variables documented in
[`twilio-setup.md`](twilio-setup.md), and keep working untouched while texting
runs on Telnyx. The Twilio code stays in place until the voice port is proven,
which keeps a failed migration to a one-line revert.
