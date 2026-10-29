#!/usr/bin/env node
// Seeds the I Can't audiobook launch email as a branded campaign draft in
// /campaigns.html. Nothing sends on its own: open the draft, press
// "Send test to me", check it, then press Send now.
//
// It goes to all CRM contacts (opt-outs are always dropped) and skips anyone
// whose library already holds the audiobook (recipientFilter.excludeOwnersOf,
// applied by buildRecipients in functions/index.js when Send is pressed, so
// a buyer is never pitched what they own).
//
// Safe to re-run: a fixed id, and a campaign that is sending or sent is never
// touched. A re-run refreshes the copy of the draft only.
//
// Run with Admin credentials, from the scripts/ directory after `npm install`:
//   node seed-audiobook-campaign.js
// See scripts/README.md for the two ways to authenticate.

const OWNER_EMAIL = 'the1percentnation@gmail.com';
const UTM = 'utm_source=email&utm_medium=campaign&utm_campaign=icant-audiobook-launch';
const LISTEN_URL = `https://the1pnation.com/icantaudio?${UTM}`;
const BOOK_ID = 'i-cant-audio';

const FILTER = {
  mode: 'all_contacts',
  excludeOwnersOf: BOOK_ID,
  excludeOwnersLabel: "I Can't: The Audiobook"
};

const CAMPAIGN = {
  id: 'icant-audiobook-launch',
  name: "I Can't Audiobook Launch",
  subject: "I Can't is now an audiobook",
  preheader: 'All ten chapters, ready for your commute, your workout, or your quiet time.',
  heroImageUrl: 'https://the1pnation.com/assets/i-cant-audio-share.jpg',
  heroAlt: "I Can't: Strategies To Overcoming Your Limiting Beliefs. Now in audio.",
  body: `
I wrote **I Can't** for the version of me who grew up one of six, moving from hotel to hotel, with stretches of no address at all.

Almost everything I'm doing today, I once believed I could not do. That book is the path I took out of that belief.

# Today, you can listen to it.

**I Can't: The Audiobook** is live. All ten chapters, ready for your commute, your workout, or your quiet time.

Inside, you'll learn how to:

- Find the beliefs quietly running your decisions
- Understand why your brain holds on to them
- Replace them with beliefs that move you forward

Every chapter ends with an exercise, so you finish with something to put into practice, not just something to think about.

It's **$9.99 and yours to keep.** It plays in your browser or your podcast app. You can press play on the introduction for free before you buy.

[Get the Audiobook](${LISTEN_URL})

If you're successful on paper but still hear the voice that says you're not ready, this one is for you.

**One percent better, every day.**
`
};

async function resolveCompanyId(db) {
  if (process.env.COMPANY_ID) return process.env.COMPANY_ID;
  // Same order seed-brief-campaigns.js uses, so the draft lands in the CRM
  // the contacts live in: the owner's company, then one they administer.
  const users = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
  if (!users.empty) {
    const owner = users.docs[0];
    if (owner.data().companyId) return owner.data().companyId;
    const admin0 = await db.collection('companies').where('adminUids', 'array-contains', owner.id).limit(1).get();
    if (!admin0.empty) return admin0.docs[0].id;
  }
  throw new Error('No company found for the owner. Set COMPANY_ID to the one the CRM uses.');
}

async function main() {
  const { initAdmin, assertCredentials } = require('./lib/init');
  const { admin, db, projectId } = initAdmin();
  console.log(`Project: ${projectId}`);
  await assertCredentials(db, projectId);
  const companyId = await resolveCompanyId(db);
  console.log(`Company: ${companyId}`);

  const c = CAMPAIGN;
  const ref = db.collection('companies').doc(companyId).collection('campaigns').doc(c.id);
  const existing = await ref.get();
  const status = existing.exists ? (existing.data().status || 'draft') : null;
  if (status && status !== 'draft') {
    console.log(`  kept     ${c.name} (${status})`);
    return;
  }
  const bodyText = c.body.trim();
  await ref.set({
    name: c.name,
    subject: c.subject,
    fromName: 'Anthony Brown Sr.',
    layout: 'branded',
    preheader: c.preheader,
    heroImageUrl: c.heroImageUrl,
    heroAlt: c.heroAlt,
    bodyText,
    // Shown by older clients only. sendCampaign renders branded campaigns
    // from bodyText at send time and ignores this.
    bodyHtml: '',
    recipientFilter: FILTER,
    status: 'draft',
    createdBy: 'seed-audiobook-campaign',
    createdAt: existing.exists
      ? existing.data().createdAt || admin.firestore.FieldValue.serverTimestamp()
      : admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { stats: { delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 } })
  }, { merge: true });
  console.log(`  ${existing.exists ? 'updated' : 'created'}  ${c.name}`);
  console.log('\nOpen https://the1pnation.com/campaigns.html, send yourself a test, then press Send now.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { CAMPAIGN, FILTER, BOOK_ID, LISTEN_URL };
