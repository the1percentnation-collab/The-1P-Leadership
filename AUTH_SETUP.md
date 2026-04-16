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

## Data model (for reference)

```
users/{uid}                   { email, displayName, role, companyId|null, tier, createdAt, lastActiveAt, currentModule }
users/{uid}/progress/{id}     { completed, completedAt, notes, noteSlots }
users/{uid}/capstone/...      { reflection, recordingUrl, submittedAt, reviewStatus }
companies/{companyId}         { name, adminUids[], seatCount, seatsUsed, tier, createdAt }
companies/{companyId}/invites/{code}  { email, code, status, companyId, createdAt, acceptedByUid }
```
