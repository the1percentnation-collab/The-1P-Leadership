# Claude for Chrome prompt: replace the SendGrid API key

Since Oct 21, every email the platform sends has failed with `Unauthorized`.
That word is SendGrid rejecting the API key (a Telnyx failure would read
`Telnyx 401`). This prompt walks the fix in your browser:

1. Check the SendGrid account itself. If it is suspended, a new key will not help.
2. Create a new key with only the permission the platform needs.
3. Store it in Google Cloud Secret Manager as a new version of `SENDGRID_API_KEY`.
4. Redeploy the functions so they pick up the new version.
5. Confirm a real email goes out, then delete the old key.
6. Optional, about five minutes: turn on signed event webhooks and save the
   verification key, which unblocks the webhook security fix (PR #201).

**What it will refuse to do:** read, repeat or copy the API key. Anything a
browser agent reads lands in its transcript, so a key it reads is a key that has
leaked. When the key is on screen, it stops and you copy and paste it yourself.

**Why the redeploy matters:** Cloud Functions read the secret version that was
current when they were last deployed. A new version sits unused until the
backend deploy runs again.

---

## The prompt

```
You are helping me replace the SendGrid API key behind my website's Cloud
Functions. Every email it sends has been failing with "Unauthorized" since
October 21. I am the account holder and I am asking you to do this in my
browser, phase by phase, in order.

HARD RULES (these override everything else in this prompt):

1. Never read, repeat, transcribe, screenshot, or copy the value of an API key,
   a secret, or a password. Never type one into any field. When a page shows a
   key, or a field needs one pasted, stop and tell me to do it myself. Key
   NAMES, key IDs, and the last few characters SendGrid shows in its key list
   are fine to read.
2. Never delete or revoke a SendGrid API key until Phase 5, and only after I
   say yes.
3. Never change billing, plans, DNS records, sender authentication, or any
   SendGrid setting I do not name below.
4. If a page does not match what I describe (different menus, a warning, a
   request for information I have not mentioned), stop and ask me instead of
   guessing.

After each phase, tell me what you found, what you did, and what is next.

────────────────────────────────────────────────────────────
PHASE 1: Check the SendGrid account (read only)
────────────────────────────────────────────────────────────

Go to https://app.sendgrid.com and make sure I am logged in to the account
that sends for the1pnation.com.

Report back:
- Any banner or notice about the account: suspended, under review, credits
  exhausted, a failed payment, or a compliance hold. If you find one, STOP
  here and read it to me word for word. A new key will not fix a suspended
  account.
- Settings → API Keys: the name, the creation date, and the permission level
  ("Full Access", "Restricted Access" or "Billing Access") of every key listed.
  Do not click into any key.
- Settings → Sender Authentication: whether the1pnation.com shows as
  Verified. Change nothing.

────────────────────────────────────────────────────────────
PHASE 2: Create the new key
────────────────────────────────────────────────────────────

In Settings → API Keys, click "Create API Key".

  API Key Name:  1PN Cloud Functions 2026-10
  Permissions:   Restricted Access
                 Mail Send: Full Access
                 Every other category: No Access

Show me the form before you click Create, and wait for me to say go.

After it is created, SendGrid shows the key exactly once. STOP. Do not look at
it. Tell me: "The key is on screen. Copy it now, then tell me when you have it."
Wait for me to confirm before you click Done.

────────────────────────────────────────────────────────────
PHASE 3: Store it in Secret Manager
────────────────────────────────────────────────────────────

Open this page (Google Cloud Console, project the-1p-leadership):

https://console.cloud.google.com/security/secret-manager/secret/SENDGRID_API_KEY/versions?project=the-1p-leadership

Report the existing versions: number, state (Enabled, Disabled, Destroyed) and
creation date.

Click "+ NEW VERSION". STOP when the "Secret value" box appears. Tell me:
"Paste the key into the Secret value box and click Add new version yourself."
Do not read the box and do not click Add for me. Leave "Disable all past
versions" unchecked; old versions get cleaned up once the new key is proven.

When I say it is done, refresh and confirm a new version is listed as Enabled.

────────────────────────────────────────────────────────────
PHASE 4: Redeploy the functions
────────────────────────────────────────────────────────────

Open:

https://github.com/the1percentnation-collab/The-1P-Leadership/actions/workflows/firebase-deploy-backend.yml

Click "Run workflow", choose branch main, and run it. Watch until it finishes
(about five minutes) and report whether it succeeded. If it failed, open the
failed step and read me the last 20 lines of the log.

Then open:

https://github.com/the1percentnation-collab/The-1P-Leadership/actions/workflows/crm-tick.yml

Click "Run workflow" on main. When it finishes, open the run, expand the step
"Call runAutomationTick", and read me the final JSON line. I am looking for:
- no "failedSteps"
- no "Unauthorized" anywhere in it

────────────────────────────────────────────────────────────
PHASE 5: Confirm a real send, then retire the old key
────────────────────────────────────────────────────────────

In SendGrid, open Activity (https://app.sendgrid.com/email_activity) and tell
me whether any message has been processed or delivered in the last hour. Read
me the subject and status of the most recent three. Do not open them.

If at least one shows Delivered or Processed, go to Settings → API Keys and
tell me which key or keys are NOT "1PN Cloud Functions 2026-10". Ask me which
of them to delete. Delete only the ones I name, one at a time, confirming each.

If nothing has been sent, do not delete anything. Tell me, and stop.

────────────────────────────────────────────────────────────
PHASE 6 (optional): Signed event webhooks
────────────────────────────────────────────────────────────

Only start this if I say "do phase 6".

In SendGrid, go to Settings → Mail Settings → Event Webhooks (on older
dashboards: Settings → Mail Settings → Event Webhook).

1. Report the webhook's Post URL and which events are ticked. The URL should be:
     https://us-central1-the-1p-leadership.cloudfunctions.net/sendgridEventWebhook
   If it is different or missing, stop and tell me.
2. Turn on "Signed Event Webhook Requests" (Signature Verification) and save.
   Show me the setting before you save.
3. SendGrid then shows a Verification Key. Do not read it. Tell me to copy it.
4. Open:
     https://github.com/the1percentnation-collab/The-1P-Leadership/settings/secrets/actions/new
   Fill the Name field with exactly:
     SENDGRID_WEBHOOK_KEY
   Then STOP and tell me to paste the key into the Secret field and click
   "Add secret" myself.
5. When I confirm, run the backend deploy workflow again, exactly as in
   Phase 4, and report the result.

Finish with a short summary: what changed, which key versions exist now, and
anything you saw that looked wrong.
```

---

## After it runs

- **Retry happens on its own.** Once the new key is live, the digests resend on
  the next hourly tick (PR #213 makes a failed send retry instead of counting
  as sent).
- **Send the Brief launch draft** from `/campaigns.html` once Phase 5 shows a
  delivered message.
- **If you ran Phase 6,** PR #201 (the event webhook fails closed without a
  verification key) is safe to merge.
- **Clean up later:** once a week of sends looks healthy, disable the old
  `SENDGRID_API_KEY` versions in Secret Manager. They hold the rejected key.
