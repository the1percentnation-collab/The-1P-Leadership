# 1P-CLC Auth — One-Time Setup Checklist

Do these steps IN ORDER before auth will work end-to-end. Everything below happens in the Google/Firebase consoles — code is already wired up.

---

## 1. Upgrade to Blaze plan (required for Cloud Functions)

1. Open <https://console.firebase.google.com/project/the-1p-leadership/usage/details>
2. Click **Modify plan** → choose **Blaze (pay as you go)**.
3. Link a billing account. (Free quotas still apply; you only pay for overage.)

Why: Cloud Functions v2 cannot deploy on the Spark plan.

---

## 2. Enable Firestore Database

1. Open <https://console.firebase.google.com/project/the-1p-leadership/firestore>
2. Click **Create database**.
3. Region: **us-central1** (nam5 also fine, but keep it consistent with Functions).
4. Start in **Production mode** — the custom rules in `firestore.rules` will be deployed on push.

---

## 3. Enable Auth sign-in methods

1. Open <https://console.firebase.google.com/project/the-1p-leadership/authentication/providers>
2. Enable **Email/Password**.
3. Enable **Google** (pick a project support email — the owner email is fine).

---

## 4. First deploy + bootstrap the owner claim

1. Push to `main` — this triggers BOTH workflows:
   - `firebase-hosting-merge.yml` (already existed) → deploys `public/`
   - `firebase-deploy-backend.yml` (new) → deploys `firestore.rules` + `functions/`
2. Once the backend workflow is green, visit <https://the-1p-leadership.web.app/signup.html> and create an account with **the1percentnation@gmail.com**. (Or sign in with that Google account.)
3. Go to <https://the-1p-leadership.web.app/owner.html>. You'll see a notice that you are not yet an owner. Click **Run bootstrapOwner**.
4. The page reloads. You now have the `role=owner` custom claim and can create companies.

> If bootstrapOwner fails with `permission-denied`, double-check that you are signed in as exactly `the1percentnation@gmail.com` (case-insensitive, but it must be that address).

---

## 5. Grant extra IAM roles to the GitHub Actions service account

The existing secret `FIREBASE_SERVICE_ACCOUNT_THE_1P_LEADERSHIP` grants hosting deploys. For Firestore rules + Functions deploys it needs more.

1. Open <https://console.cloud.google.com/iam-admin/iam?project=the-1p-leadership>
2. Find the service account tied to the existing GitHub workflow (looks like `github-action-XXXXXXXXX@the-1p-leadership.iam.gserviceaccount.com`).
3. Add these roles:
   - **Firebase Rules Admin** (`roles/firebaserules.admin`)
   - **Cloud Functions Developer** (`roles/cloudfunctions.developer`)
   - **Service Account User** (`roles/iam.serviceAccountUser`)
   - Also helpful: **Artifact Registry Writer** (Functions v2 stores images in Artifact Registry) and **Cloud Run Admin** (v2 functions run on Cloud Run under the hood).

---

## Manual local deploy (first time, if you want to do it before the workflow runs)

```bash
npx firebase-tools login
cd functions && npm install && cd ..
npx firebase-tools deploy --only firestore:rules,functions --project the-1p-leadership
```

Firestore rules deploy **separately** from hosting. Hosting continues to auto-deploy via the existing workflow on every push.

---

## Smoke test after setup

1. `https://the-1p-leadership.web.app/login.html` — sign in as the owner email.
2. `/owner.html` — create a company, assign an admin by email. (That admin must have already signed up at `/signup.html` so their user doc exists.)
3. That admin signs in and goes to `/admin.html` — they should see the roster + can generate invites.
4. Send the invite link to an employee. They open it, sign up, and land on `/index.html`. Their `companyId` is now set and seats used has incremented.

---

## Security & compliance hardening (added in the security audit)

These changes are wired in code and deploy automatically. A few require a
one-time console step or content edit to fully activate.

### Rate limiting (active on deploy — no setup)
Expensive/abusable callables are throttled by a Firestore-backed limiter
(`rateLimits/{doc}`, server-only). Limits: AI chat 20/5 min per user, bug
reports 5/10 min per uid+IP, contact email 60/10 min, campaigns 10/hr, SMS
100/10 min, checkout 15/10 min, community invites 30/hr, affiliate clicks
30/10 min per IP, data export 5/hr. Tune the numbers in `functions/index.js`
(search `rateLimitCaller` / `enforceRateLimit`). Optionally add a Firestore TTL
policy on `rateLimits.expiresAt` to auto-prune old counters.

### Firebase App Check (optional — off until you add a key)
App Check adds bot/abuse attestation. To enable:
1. Firebase Console → **App Check** → register this web app with the
   **reCAPTCHA v3** provider; copy the site key.
2. Paste it into `RECAPTCHA_V3_SITE_KEY` in `public/js/firebase.js`.
3. After confirming tokens flow (Console → App Check → Requests), optionally set
   `enforceAppCheck: true` on sensitive callables in `functions/index.js`.
Leaving the key blank is a safe no-op, so nothing breaks before you configure it.

### Session timeout / forced re-login (active on deploy — no setup)
`public/js/session.js` signs users out after **30 min idle** or **12 hr** since
sign-in, and periodically force-refreshes the ID token so a revoked session is
caught. Adjust the limits at the top of that file.

### Privacy / Terms / data rights (needs content review)
- `public/privacy.html` and `public/terms.html` are live and linked in the
  footer. **Fill in every highlighted `[[placeholder]]`** (legal business name,
  address, contact email, governing state, effective date) and have counsel
  review them before launch.
- Signed-in members can export or delete their own data from
  `/profile.html` (backed by the `requestDataExport` / `deleteMyAccount`
  callables). No setup needed.
- SMS `STOP`/`START` opt-out is handled in `twilioInboundWebhook`; `sendSms`
  refuses opted-out contacts. Works once Twilio is configured.
- A cookie-consent banner (`public/js/consent-banner.js`) is included on
  `index`, `login`, and `signup`. Add the same
  `<script src="/js/consent-banner.js" defer></script>` tag to other public
  pages if you want it site-wide.

> Note: code provides the mechanisms for privacy compliance (CCPA/CPRA and other
> state laws, TCPA, CAN-SPAM). It does **not** constitute legal advice or certify
> compliance — confirm with qualified counsel.

## New member pipeline (welcome email + CRM contact)

Every account that lands in `users/{uid}` (email signup, Google sign-in, or an
invite) runs through `onUserCreated` in `functions/index.js`, which:

1. Applies any pending course grants for that email.
2. Upserts the member into the academy CRM (`companies/{academy}/contacts`),
   matching on email so a lead who filled a form earlier is updated rather
   than duplicated. The contact gets the `Member` tag, `memberUid`, and a
   `member_signup` activity. The link is stored on the user doc as
   `crmContactId` / `crmCompanyId`.
3. Sends the welcome email via SendGrid and records `welcomeEmailStatus`
   (`sent` / `failed`), `welcomeEmailSentAt` and `welcomeEmailMessageId` on the
   user doc. SendGrid opens and clicks land on the contact's activity timeline
   through the existing event webhook.

Both steps are idempotent. `submitOnboarding` re-runs them as a safety net, so
a member whose signup trigger failed is still linked and still welcomed the
moment they finish onboarding. To catch up members who signed up before this
existed, use **Sync members to CRM** on `/owner.html` (safe to re-run; tick the
checkbox to also send the welcome email to anyone who never received one).

Requirements: the academy company must exist (the owner's `companyId`, or a
company the owner administers; falls back to the first company). Until one
exists the CRM step logs a warning and skips, and the backfill picks those
members up later. `SENDGRID_API_KEY` must be set for the email step.

## Data model (for reference)

```
users/{uid}                   { email, displayName, role, companyId|null, tier, createdAt, lastActiveAt, currentModule,
                                crmContactId, crmCompanyId, crmSyncedAt,
                                welcomeEmailStatus, welcomeEmailSentAt, welcomeEmailMessageId, welcomeEmailError }
users/{uid}/progress/{id}     { completed, completedAt, notes, noteSlots }
users/{uid}/capstone/...      { reflection, recordingUrl, submittedAt, reviewStatus }
companies/{companyId}         { name, adminUids[], seatCount, seatsUsed, tier, createdAt }
companies/{companyId}/invites/{code}  { email, code, status, companyId, createdAt, acceptedByUid }
```

## Dialer, calling, and Google Calendar

The CRM's calling and calendar features ship dormant: every button exists,
and each one reports "not set up yet" until its credentials are present.
Nothing below is needed for SMS, which keeps working as before.

### Twilio Voice (softphone + cell bridge)

Runtime environment variables (functions/.env or the Cloud Run env), in
addition to the existing `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_FROM_NUMBER`:

| Variable | Where it comes from |
|---|---|
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | Twilio Console → Account → API keys & tokens → Create API key (Standard). Needed to mint the browser softphone's access token; the account auth token cannot do this. |
| `TWILIO_TWIML_APP_SID` | Twilio Console → Voice → TwiML Apps → Create. Set **Voice Request URL** to `https://us-central1-the-1p-leadership.cloudfunctions.net/voiceOutboundTwiml` (POST). |
| `TWILIO_CALLER_ID` | Optional. A verified or purchased number used as outbound caller ID when it differs from `TWILIO_FROM_NUMBER`. |

Then, on the Twilio phone number itself (Phone Numbers → Manage → the
number → Voice & Fax): set **A call comes in** to the webhook
`https://us-central1-the-1p-leadership.cloudfunctions.net/voiceInboundTwiml`
(POST). Inbound calls ring the assigned rep's softphone (or every admin's),
create the caller as a contact if unknown, and fall to voicemail.

Each rep chooses their mode in CRM Settings → Calling: the browser softphone
(needs microphone permission; `firebase.json` now sends
`Permissions-Policy: microphone=(self)` for this) or "ring my cell, then the
lead", which needs their mobile number saved on the same card.

Recording is off by default. "On, with a spoken notice" prepends a consent
announcement; silent recording is illegal in two-party-consent states, and
the settings page says so.

The Voice SDK is vendored at `public/vendor/twilio-voice-<version>.min.js`
(see the README there) rather than loaded from a CDN.

### Texting: toll-free, no EIN needed

A2P 10DLC brand registration wants a federal Tax ID. Toll-free verification
does not — Twilio exempts sole proprietors from the business-registration-number
requirement — so toll-free is the path for a practice without an EIN, and it
reaches every major US carrier plus most major Canadian ones.

Changing provider does not avoid 10DLC: it is enforced by The Campaign Registry
for the carriers, so Telnyx, Plivo, SignalWire and the rest all require the
identical registration.

The full submission — the opt-in URL to give them, the use-case wording, the
workflow description and the message samples — is in
[`docs/toll-free-verification.md`](docs/toll-free-verification.md). Note that
`TWILIO_FROM_NUMBER` must not be pointed at the toll-free number until
verification is approved, because a toll-free number cannot send to the US or
Canada before then.

Voice is unaffected by any of this and needs no registration.

### Google Calendar (two-way sync)

| Variable | Where it comes from |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application. Enable the **Google Calendar API** on the project first. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Optional override. Defaults to `https://us-central1-the-1p-leadership.cloudfunctions.net/googleOAuthCallback`, which must be listed as an **Authorized redirect URI** on that OAuth client. |

Connect from CRM Settings → Google Calendar. Appointments booked anywhere in
the CRM then create real calendar events with a Meet link, and can invite
the contact by email; edits made in Google flow back through a push channel
(`googleCalendarPush`). Refresh tokens are stored at
`companies/{cid}/private/googleOAuth`, which the security rules close to
every client including the owner.

Push channels expire after 7 days. They are renewed from the calendar and
settings pages, from every push, and from the automation tick below.

### The automation tick (sequences, reminders, watch renewal)

This project cannot deploy Cloud Scheduler jobs (the deploy service account
lacks `roles/cloudscheduler.admin`; see `scripts/deploy-functions.sh`).
Time-based work therefore runs from the `runAutomationTick` HTTP function,
which `.github/workflows/crm-tick.yml` calls every 15 minutes.

| Variable | Where it goes |
|---|---|
| `CRM_TICK_SECRET` | Any long random string. Set it on the functions runtime **and** as a GitHub Actions repository secret with the same name. The tick refuses requests without it. |

The tick sends due sequence steps (SMS, email, or a task), renews Google
watch channels, and sends the task/appointment reminder emails that the two
stranded `onSchedule` functions were written for. "Run due steps now" on the
Sequences page runs the same work for one company on demand.

The proper fix remains the IAM grant: once `cloudscheduler.admin` is in
place, export a scheduled function calling the same logic and delete the
workflow.

### Voicemail drop

No credentials needed beyond Twilio Voice. Record a greeting in CRM
Settings → Voicemail drop (the browser records and converts it to 8 kHz WAV,
which Twilio plays natively). The audio lives in Cloud Storage under
`companies/{cid}/voicemails/`, closed to all client reads; Twilio fetches it
through `voicemailAudio` with a per-file token written server-side.
