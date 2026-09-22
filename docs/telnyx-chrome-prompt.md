# Claude for Chrome prompt — Telnyx setup

Paste the prompt below into Claude for Chrome. It walks the whole Telnyx setup
for this CRM: account, Sole Proprietor 10DLC brand, campaign, number, messaging
webhooks, and the voice side.

**Three things it will deliberately refuse to do**, and you should be
suspicious of any browser agent that offers to do them:

- **Type the last four of your SSN.** It stops and hands the keyboard to you.
- **Read or copy an API key or public key.** Anything a browser agent reads
  lands in its transcript, so a secret it reads is a secret that has leaked. It
  stops and you copy those values yourself.
- **Enter payment details.**

It also will not submit the brand or campaign form without showing you the
filled form first. A rejected campaign costs a brand fee, and The Campaign
Registry caps how many times one address and one mobile number can be reused
across registrations — so a careless resubmit is not free.

Run it in one sitting up to the campaign submission. Phase 6 happens days
later, when the approval email arrives.

**If the account already exists** and the CRM is reporting "SMS is not
configured yet", this is the wrong prompt. That failure is missing repository
secrets rather than missing setup, and
[`telnyx-chrome-activate-prompt.md`](telnyx-chrome-activate-prompt.md) is the
prompt for it.

---

## The prompt

```
You are helping me set up a Telnyx account to power texting and calling in a
CRM I already have deployed. Work through the phases below in order, in my
browser. I am the account holder and I am asking you to do this on my behalf.

HARD RULES — these override anything else in this prompt:

1. Never type my Social Security number, or any part of it, into any field.
   When a form asks for the last four digits, stop, tell me the field is ready,
   and let me type it myself. Do not ask me to tell you the digits.
2. Never read, repeat, transcribe, screenshot or copy the value of an API key,
   public key, auth token or password. When we reach a page that displays one,
   stop and tell me to copy it myself. Resource IDs that are not secrets — a
   SIP connection ID, a TeXML application ID, a messaging profile ID, a phone
   number — you may read and report back to me.
3. Never enter card or bank details. If a page requires funding before it will
   continue, stop and tell me.
4. Never submit the 10DLC brand form or the campaign form on your own. Fill
   every field, then stop, show me exactly what is in the form, and wait for me
   to say submit. A rejected campaign costs a brand fee, and the Campaign
   Registry limits how often one address and one mobile can be reused.
5. If a page does not look like what I have described below — different field
   names, an unexpected upsell, a request for information I have not mentioned
   — stop and ask me rather than guessing.

After each phase, tell me what you did, what you collected, and what is left.

────────────────────────────────────────────────────────────
PHASE 1 — Account and the 10DLC brand (do this first; it has a queue)
────────────────────────────────────────────────────────────

Go to https://telnyx.com/sign-up and create an account, or log in at
https://portal.telnyx.com if I already have one. Tell me if it asks for
payment or account funding and stop there.

Then go to Messaging → 10DLC and register a brand with entity type
SOLE PROPRIETOR. Fill it in with:

  Business type:                Sole Proprietorship
  Business name:                The One Percent Nation
  Website:                      https://the1pnation.com
  Business registration number: leave blank, or select "not available".
                                Sole proprietors are exempt from this field.
  Vertical / industry:          Professional Services (or Consulting if that
                                is the closest option)

For my name, address, email and mobile number: use exactly the details this
Telnyx account is registered under. Ask me for any you do not already have on
the page. A mismatch between the account holder and the brand submission slows
review — that is what sank my previous attempt on another provider.

When you reach the field for the last four digits of my SSN: STOP. Tell me it
is ready and let me type it.

Then stop again and show me the completed form before submitting.

After I submit, Telnyx texts a one-time code to that mobile. I will read it to
you or enter it myself. Tell me plainly that this code expires in 24 HOURS and
the registration has to be restarted if it lapses.

────────────────────────────────────────────────────────────
PHASE 2 — The campaign
────────────────────────────────────────────────────────────

Once the brand is submitted, create ONE campaign under it. A sole proprietor
brand is limited to one campaign and one phone number.

  Use case category:  Customer Care
                      (Account Notifications is the acceptable second choice.
                      Do NOT pick Marketing as the primary category — this is
                      mostly one-to-one follow-up with people who asked to be
                      contacted, and Marketing triggers a stricter review.)

  Opt-in type:        Web form

  Opt-in URL:         https://the1pnation.com/webinar

Paste these verbatim. Do not paraphrase, shorten or "improve" them — the
wording is deliberate and matches what is actually on my site.

USE CASE SUMMARY:

The One Percent Nation is a leadership and life-coaching practice. We text
people who have contacted us directly through a form on the1pnation.com —
webinar and workshop registrants, coaching and speaking inquiries, and enrolled
course and certification students.

Messages are one-to-one conversations with a named coach: confirming and
reminding people of scheduled calls, answering questions about a program they
asked about, and following up on a request they submitted. Registrants also
receive reminders for the live sessions they signed up for.

Every recipient provides their phone number themselves on a web form and checks
a separate consent box for text messages. We never purchase, rent or share
lists, and we do not text anyone who has not submitted a form to us. Replies of
STOP are honored automatically and immediately.

OPT-IN WORKFLOW DESCRIPTION:

The visitor completes a form on the1pnation.com — most commonly the webinar
registration page at https://the1pnation.com/webinar — entering their name,
email and phone number.

Below the phone field are two separate, unchecked consent checkboxes. The first
covers transactional texts about their inquiry, bookings and program updates
and states that message frequency may vary, that message and data rates may
apply, and that they can reply HELP for assistance or STOP to opt out. The
second, separately, covers marketing and promotional messages and repeats the
STOP instruction. Neither box is pre-checked, and consent is not required to
submit the form or to purchase anything.

The checked state and the exact consent wording shown are stored with the
contact record at the moment of submission, so we can evidence what each person
agreed to and when. A reply of STOP sets an opt-out flag on that contact, and
our system then refuses to send them any further message.

PRODUCTION MESSAGE SAMPLES — give all three:

Hi Jordan, it's Anthony from The One Percent. Thanks for registering for
Thursday's leadership workshop — here's your join link:
https://the1pnation.com/webinar Reply STOP to opt out.

Hi Jordan, Anthony from The One Percent. Confirming our strategy call for
Thursday at 2:00 PM ET. Reply RESCHEDULE if another time works better, or STOP
to opt out.

Hi Jordan, Anthony from The One Percent following up on the coaching
certification you asked about. Happy to answer any questions — just reply here.
Reply STOP to opt out.

ESTIMATED MONTHLY VOLUME: 1000

ADDITIONAL INFORMATION:

Texting is sent from a CRM built into our own site and is used for one-to-one
follow-up by a single coach, not bulk broadcast. STOP, STOPALL, UNSUBSCRIBE,
CANCEL, END, QUIT and OPTOUT are all honored automatically and the contact is
flagged so no further message can be sent to them; START, YES, UNSTOP and OPTIN
re-subscribe. Our privacy policy is at https://the1pnation.com/privacy and
terms at https://the1pnation.com/terms.

Also tick every opt-out and help-keyword box the form offers, and make sure
STOP and HELP are listed as supported keywords if it asks.

Then STOP and show me the whole filled form before submitting.

────────────────────────────────────────────────────────────
PHASE 3 — Buy the number
────────────────────────────────────────────────────────────

Go to Numbers → Search Numbers and find a LOCAL number in area code 405
(Oklahoma) with both SMS and Voice capability. Show me the options and let me
pick before you buy. Report the number you bought back to me.

Do not attach it to the campaign until the campaign is approved.

────────────────────────────────────────────────────────────
PHASE 4 — Voice (works immediately; no registration needed)
────────────────────────────────────────────────────────────

4a. Go to Voice → SIP Connections and create a connection of type
    CREDENTIALS. Name it "1P CRM softphone". Report its connection ID to me.

4b. THIS IS THE IMPORTANT ONE. Find the outbound voice profile attached to
    that connection (Voice → Outbound Voice Profiles, create one if there
    isn't one) and set:

      - Destinations / allowed countries: United States and Canada ONLY.
        Remove or leave unselected everything else.
      - A daily spend limit. Ask me for the amount and suggest $25/day unless
        I say otherwise.
      - Concurrent call limit: 5.

    Tell me when this is done and read the settings back to me so I can
    confirm. Explain to me in one sentence why it matters: my browser holds a
    real SIP credential, so this profile is the only hard ceiling on what it
    can dial if my session is ever compromised.

4c. Go to Voice → TeXML Applications and create one named "1P CRM inbound".
    Set its voice webhook URL to:

      https://us-central1-the-1p-leadership.cloudfunctions.net/voiceInboundTwiml

    Use HTTP POST and webhook API version 2 if it asks. Report the
    application ID to me.

4d. Assign the phone number from Phase 3 to that TeXML application, so
    inbound calls route to it.

────────────────────────────────────────────────────────────
PHASE 5 — Messaging webhooks
────────────────────────────────────────────────────────────

Go to Messaging → Messaging Profiles. Create a profile named "1P CRM" if there
isn't one, and set:

  Inbound webhook URL:
    https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxInboundWebhook

  Outbound / delivery receipt (status) webhook URL:
    https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxStatusWebhook

  Webhook API version: 2   (this must be v2 — v1 signs webhooks differently
                            and my server will reject everything)

Report the messaging profile ID to me.

────────────────────────────────────────────────────────────
PHASE 6 — The credentials I have to copy myself
────────────────────────────────────────────────────────────

Do not read these values. Navigate to each page, confirm the value is visible,
and tell me to copy it. Then tell me where it goes.

  1. Go to the API Keys page and create a key named "1P CRM". Tell me to copy
     it. It goes in a GitHub repository secret called TELNYX_API_KEY at:
     https://github.com/the1percentnation-collab/The-1P-Leadership/settings/secrets/actions

  2. Go to Account Settings → Keys & Credentials and find my account's PUBLIC
     key. Tell me to copy it. It goes in a secret called TELNYX_PUBLIC_KEY.

Then list back to me, in a single block I can work from, the non-secret IDs you
collected and which secret each belongs in:

  TELNYX_SIP_CONNECTION_ID     = the Phase 4a connection ID
  TELNYX_TEXML_APP_ID          = the Phase 4c application ID
  TELNYX_MESSAGING_PROFILE_ID  = the Phase 5 profile ID
  TELNYX_CALLER_ID             = the Phase 3 phone number

And remind me of this, because it is the one mistake that costs money:

  DO NOT set TELNYX_FROM_NUMBER until the campaign is APPROVED. Sending on an
  unapproved 10DLC number is blocked by every US carrier and still bills the
  sender fees.

────────────────────────────────────────────────────────────
PHASE 7 — After the approval email (days later)
────────────────────────────────────────────────────────────

When the campaign is approved:

  1. Attach the Phase 3 number to the approved campaign.
  2. Attach the number to the "1P CRM" messaging profile from Phase 5.
  3. Tell me to set the GitHub secret TELNYX_FROM_NUMBER to that number and
     re-run the backend deploy workflow.

Then check the campaign's status page and tell me its throughput limits and any
conditions attached to the approval.
```

---

## What to do with what it gives you

Seven GitHub repository secrets, all at
`Settings → Secrets and variables → Actions`:

| Secret | Source |
|---|---|
| `TELNYX_API_KEY` | you copy it in Phase 6 |
| `TELNYX_PUBLIC_KEY` | you copy it in Phase 6 |
| `TELNYX_SIP_CONNECTION_ID` | reported in Phase 4a |
| `TELNYX_TEXML_APP_ID` | reported in Phase 4c |
| `TELNYX_MESSAGING_PROFILE_ID` | reported in Phase 5 |
| `TELNYX_CALLER_ID` | the number from Phase 3 |
| `TELNYX_FROM_NUMBER` | **only after campaign approval** |

They must be repository secrets rather than a local file: CI writes
`functions/.env` from them on every backend deploy, so a value set anywhere
else is wiped by the next merge to `main`. Re-run the backend deploy workflow
after adding them.

Calling goes live as soon as the first four are in. Texting waits on the
campaign.
