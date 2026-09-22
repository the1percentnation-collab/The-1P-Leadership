# Claude for Chrome prompt — turn texting on

This is the finishing pass, not the setup. Use it when the CRM shows:

> SMS is not configured yet. Add the Telnyx secrets first (missing
> TELNYX_API_KEY, TELNYX_FROM_NUMBER).

That message is not a bug. It is `sendSms` in `functions/index.js` reading
`process.env` and finding nothing, because the GitHub repository secrets those
values come from do not exist. The deploy log for run #97 confirmed it: every
Telnyx name printed `(unset)` and `functions/.env` was written with one value.

Setting up a Telnyx account from nothing is a different document:
[`telnyx-chrome-prompt.md`](telnyx-chrome-prompt.md). This one assumes the
account exists and walks the last mile: collect the IDs, put them in GitHub,
re-deploy, and prove it worked by sending a real text.

**What the agent will refuse to do**, and what you should be suspicious of any
browser agent offering to do:

- **Read an API key or public key.** Anything a browser agent reads lands in
  its transcript, so a secret it reads is a secret that has leaked. It opens
  the page, confirms the value is on screen, and hands the copy to you.
- **Delete or rotate an existing API key.** A key still in use somewhere else
  dies silently when rotated.
- **Set `TELNYX_FROM_NUMBER` before the 10DLC campaign is approved.** Sending
  on an unapproved number is blocked by every US carrier and still bills the
  sender fees.

The verification loop is the point of this prompt. A GitHub secret cannot be
read back after it is saved, so "I pasted it" is not proof. The deploy log is:
it prints `set TELNYX_API_KEY` or `(unset) TELNYX_API_KEY` for each name, with
no values, and the agent reads that line back to you.

---

## The prompt

```
You are helping me finish wiring up texting in a CRM I already have deployed.
The Telnyx account exists. The code is deployed and correct. What is missing is
that the credentials were never added as GitHub repository secrets, so the
deployed backend has no Telnyx configuration and every send fails with "SMS is
not configured yet."

Your job: find out what exists in Telnyx, get the credentials into GitHub,
re-run the deploy, and confirm a real text sends. Work the phases in order.

HARD RULES — these override anything else in this prompt:

1. Never read, repeat, transcribe, screenshot or copy the value of an API key,
   public key, auth token or password. When we reach a page showing one, stop
   and tell me to copy it myself. Resource IDs that are not secrets (a SIP
   connection ID, a TeXML application ID, a messaging profile ID, a phone
   number) you may read and report back to me.
2. Never delete, rotate or disable an existing Telnyx API key. If I need a new
   one, create an additional key and leave the old ones alone.
3. Never enter card or bank details. If a page requires funding before it will
   continue, stop and tell me what it is asking for.
4. Do not change, delete or overwrite any GitHub secret other than the ones
   named in Phase 3. Several unrelated secrets live in the same list.
5. If a page does not look like what I describe below, stop and ask me rather
   than guessing.

After each phase, tell me what you found, what is still missing, and what is
next.

────────────────────────────────────────────────────────────
PHASE 1 — Audit the Telnyx account
────────────────────────────────────────────────────────────

Log in at https://portal.telnyx.com and report back on each of these. Do not
change anything in this phase. I want a picture of what already exists before
we touch anything.

  a. Messaging → 10DLC. Is there a registered brand? What entity type, and
     what is its status? Is there a campaign under it, and what is the
     campaign's exact status (pending, in review, approved, rejected)?
     THIS IS THE GATE. Tell me the campaign status in plain words before you
     go on, because it decides Phase 3.

  b. Numbers → My Numbers. List every number on the account, with its area
     code and whether it has SMS and Voice capability. Tell me which messaging
     profile and which campaign each one is attached to, if any.

  c. Messaging → Messaging Profiles. Is there a profile? Report its ID and its
     current inbound webhook URL, status/delivery webhook URL, and webhook API
     version.

  d. Voice → SIP Connections. Is there a Credentials-type connection? Report
     its ID. Also check Voice → TeXML Applications and report any application
     ID.

Give me all of that as one short list before moving on.

────────────────────────────────────────────────────────────
PHASE 2 — Fix the webhooks while we are here
────────────────────────────────────────────────────────────

In Messaging → Messaging Profiles, on the profile from Phase 1c (create one
named "1P CRM" if there is none), set:

  Inbound webhook URL:
    https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxInboundWebhook

  Outbound / delivery receipt (status) webhook URL:
    https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxStatusWebhook

  Webhook API version: 2

The API version must be 2. Version 1 signs webhooks differently and my server
rejects every one of them, which shows up as replies never arriving rather than
as an error. Tell me what the values were before you changed them, in case we
need to put them back.

Confirm the phone number from Phase 1b is attached to this profile.

────────────────────────────────────────────────────────────
PHASE 3 — The GitHub secrets
────────────────────────────────────────────────────────────

Open https://github.com/the1percentnation-collab/The-1P-Leadership/settings/secrets/actions

First, read me the list of secret names that already exist. Names are visible;
values are not, by design. Do not open, edit or delete any secret that is not
named below.

We are adding these, using "New repository secret" for each. The names must
match exactly, including case:

  TELNYX_API_KEY
    Telnyx Mission Control → API Keys. If a key is listed but I cannot see its
    value (Telnyx only shows it once), create an ADDITIONAL key named
    "1P CRM deploy" and leave the existing keys alone. Open the page, confirm
    the value is on screen, then STOP and tell me to copy it. I will paste it
    into GitHub myself. Do not read it.

  TELNYX_PUBLIC_KEY
    Telnyx → Account Settings → Keys & Credentials → the account's PUBLIC key.
    Same handling: you navigate, I copy. Tell me plainly that without this one
    every inbound text and delivery receipt is rejected by my server, so I
    would be able to send and never see a reply. It is not optional.

  TELNYX_FROM_NUMBER
    ONLY IF the Phase 1a campaign status is APPROVED. If it is pending, in
    review, or rejected, skip this secret entirely, tell me why, and continue
    to Phase 4 without it. If it is approved, the value is the Phase 1b number
    in E.164 format, like +14055550123, with the plus sign and no spaces,
    dashes or parentheses.

  TELNYX_MESSAGING_PROFILE_ID
    The Phase 1c profile ID. Not a secret, you can read and report it.

  TELNYX_SIP_CONNECTION_ID and TELNYX_TEXML_APP_ID and TELNYX_CALLER_ID
    Only if Phase 1d found them. These turn on the browser softphone, which
    needs no 10DLC registration and works immediately. TELNYX_CALLER_ID is the
    same phone number in E.164.

When each one is saved, read the secret list back to me and confirm the name
appears. You cannot verify the value from here. Phase 4 does that.

────────────────────────────────────────────────────────────
PHASE 4 — Re-deploy, and prove the secrets landed
────────────────────────────────────────────────────────────

Adding a secret changes nothing on its own. The deploy workflow writes
functions/.env from these secrets, and it only fires on a push that touches
functions/, so it has to be run by hand now.

  1. Go to
     https://github.com/the1percentnation-collab/The-1P-Leadership/actions/workflows/firebase-deploy-backend.yml

  2. Click "Run workflow", branch main, and run it. It takes about five
     minutes.

  3. When it finishes green, open the run and expand the step named
     "Write functions runtime env". It prints one line per variable, either
     "set NAME" or "(unset) NAME", with no values, so it is safe for you to
     read. Read me back every line, and the "Wrote functions/.env with N
     value(s)" total.

     Before this fix the log said "(unset) TELNYX_API_KEY". If it still says
     that, the secret did not save under the exact name. Go back to Phase 3
     and check for a typo or trailing space in the NAME field.

  4. Confirm the final step "Deploy Cloud Functions" also finished green.
     The env step passes even when nothing is set, so a green run is not by
     itself proof.

────────────────────────────────────────────────────────────
PHASE 5 — Send a real text
────────────────────────────────────────────────────────────

Open https://the1pnation.com, sign in, go to the CRM and open a contact that
has a mobile number and recorded SMS consent. Use the TEXT tab and send a
short test message.

Tell me which of these happened:

  - The message sends and appears on the contact's timeline. Wait about
    thirty seconds and tell me whether it picks up a delivery status. If it
    stays "queued" or "sent" and never advances, the status webhook or
    TELNYX_PUBLIC_KEY is the suspect, not the send.

  - "SMS is not configured yet" still appears, naming what is missing. Read me
    the exact names in the message and go back to Phase 3.

  - A different error appears. Read it to me word for word. An error starting
    "Telnyx" followed by a number is Telnyx's own rejection passed straight
    through, and its wording tells us which of the number, the campaign or the
    profile is wrong.

Then reply STOP from the test phone and confirm the contact flips to opted out
on their record. That path is a legal requirement, not a nicety, and this is
the only moment it is convenient to test.

────────────────────────────────────────────────────────────
PHASE 6 — If the campaign was not approved
────────────────────────────────────────────────────────────

If Phase 1a came back pending or in review, texting cannot work yet no matter
what we configure, and that is a carrier decision rather than anything in my
account. In that case, tell me:

  - the campaign's current status and the date it was submitted,
  - anything the campaign page says is outstanding or needs a response from
    me, since a request for more information will sit there silently and the
    Campaign Registry drops registrations that go unanswered,
  - and that everything from Phases 2 through 4 is still worth doing now, so
    that approval day is one secret and one workflow run rather than a fresh
    setup.

If it came back rejected, read me the stated reason verbatim before we touch
anything, and do not resubmit. A rejected campaign costs a brand fee and the
Campaign Registry limits how often one address and one mobile can be reused.
```

---

## After it finishes

| Secret | Turns on | Blocked by |
|---|---|---|
| `TELNYX_API_KEY` | every Telnyx call | nothing, add it now |
| `TELNYX_PUBLIC_KEY` | inbound texts, delivery receipts | nothing, add it now |
| `TELNYX_MESSAGING_PROFILE_ID` | sending through a chosen profile | nothing |
| `TELNYX_SIP_CONNECTION_ID` | browser softphone | nothing, voice needs no registration |
| `TELNYX_TEXML_APP_ID` | inbound call routing | nothing |
| `TELNYX_CALLER_ID` | outbound caller ID | nothing |
| `TELNYX_FROM_NUMBER` | outbound texting | 10DLC campaign approval |

Every one of them is a repository secret rather than a local file, because CI
writes `functions/.env` from repository secrets on every backend deploy. A
value set by hand with `firebase functions:config` or in a local `.env` is
wiped by the next merge to `main`.

The deploy log for run #97 also showed `GOOGLE_OAUTH_CLIENT_ID`,
`EMAIL_PROVIDER` and the SendGrid names unset, so calendar sync and outbound
email are dormant for the same reason. `functions/.env.example` lists what each
one needs. Adding them in the same sitting costs one workflow run instead of
three.

Before going live on voice, set a destination restriction and a daily spend cap
on the SIP connection's outbound voice profile. The browser holds a real SIP
credential, so that profile is the only hard ceiling on what a compromised
session can dial. [`telnyx-setup.md`](telnyx-setup.md) has the detail.
