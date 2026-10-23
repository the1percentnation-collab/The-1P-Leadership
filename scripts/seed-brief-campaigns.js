#!/usr/bin/env node
// Seeds three campaign drafts for The One Percent Brief's free window, which
// closes at 11:59 PM Eastern on December 6, 2026 (scripts/launch-brief-sale.js):
//
//   brief-free-launch     send now      the Brief is open, free through Dec 6
//   brief-free-one-week   Mon, Nov 30   one week left
//   brief-free-final-day  Sun, Dec 6    closes tonight (morning send)
//
// Each is a draft in /campaigns.html with its send date shown next to it.
// Nothing sends on its own: open the draft on its day and press Send.
//
// Every draft goes to all CRM contacts (opt-outs are always dropped) and
// skips anyone whose account is already enrolled in the Brief
// (recipientFilter.excludeEnrolledIn, applied by buildRecipients in
// functions/index.js when Send is pressed, so people who join between sends
// stop getting them).
//
// Safe to re-run: fixed ids, and a campaign that is sending or sent is never
// touched. A re-run refreshes the copy of drafts only.
//
// Run with Admin credentials, from the scripts/ directory after `npm install`:
//   node seed-brief-campaigns.js
// See scripts/README.md for the two ways to authenticate.

const OWNER_EMAIL = 'the1percentnation@gmail.com';
const UTM = 'utm_source=email&utm_medium=campaign&utm_campaign=brief-free-window';
const JOIN_URL = `https://the1pnation.com/course.html?course=one-percent-brief&${UTM}`;
const TEAM_URL = `https://the1pnation.com/assessments/team-alignment?${UTM}`;

const FILTER = {
  mode: 'all_contacts',
  excludeEnrolledIn: 'one-percent-brief',
  excludeEnrolledLabel: 'The One Percent Brief'
};

const CAMPAIGNS = [
  {
    id: 'brief-free-launch',
    name: 'The Brief: free window opens',
    sendOn: 'now',
    subject: 'The One Percent Brief is open, and free to join through December 6',
    body: `
The One Percent Brief is open.

Once a month you get one focused read on one real challenge. Not the kind that shows up on a résumé, the kind that shapes every week you live. Each brief comes with a toolkit you can use the day you finish: scripts, worksheets and checklists.

The first one is live now. It is called The Yes Trap. It is about the reflexive yes: why capable people agree to things they mean to decline, what that habit quietly costs, and a four-step framework called the Pause Principle for making calm decisions in real time.

Coming next: protecting your growth when your leader is holding you back, focus that works with an ADHD brain, breaking the overthinking loop, recovering from burnout, and having the conversation you have been avoiding.

Here is the offer. The Brief is regularly $12 a month. Join by December 6 and it is free for you, for good. No card, and nothing to cancel later.

Join free: ${JOIN_URL}

Read the first brief this week. Pick one idea and put it to work before Friday. That is the whole practice: one percent better, on purpose.

Anthony
`
  },
  {
    id: 'brief-free-one-week',
    name: 'The Brief: one week left',
    sendOn: 'Mon, Nov 30',
    subject: 'One week left to join The Brief free',
    body: `
A short note, because the window closes soon.

The One Percent Brief is free to join until 11:59 PM Eastern on Sunday, December 6. Join before then and it stays free for you for good. After that it is $12 a month.

If you have not opened it yet, start with The Yes Trap. Here is the question at the center of it:

Think of the last three things you agreed to that you wish you had not. For each one, ask: what was I afraid would happen if I said no?

Most people find the same fear repeating. That fear is the pattern, and you cannot change a pattern you cannot see. The brief walks you through what to do once you see it.

Join free: ${JOIN_URL}

If you have already joined, you are all set and can ignore this.

Anthony
`
  },
  {
    id: 'brief-free-final-day',
    name: 'The Brief: final day',
    sendOn: 'Sun, Dec 6 (morning)',
    subject: 'Last day to join The Brief free',
    body: `
Today is the last day to join The One Percent Brief for free.

At 11:59 PM Eastern tonight the free window closes. Anyone who joins before then keeps it free for good. After tonight it is $12 a month.

One read a month. One real challenge. Tools you can use the same week.

Join free: ${JOIN_URL}

If it is not for you, that is fine. I would rather you join something because it fits than because a clock ran out.

Anthony

P.S. If you lead a team and the misalignment you feel is bigger than you, take the free Team Alignment Assessment. It takes about six minutes and shows where your team is pulling in different directions: ${TEAM_URL}
`
  }
];

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Paragraphs to <p>, bare URLs to links. The server's own text-to-HTML only
// turns newlines into <br/>, which leaves the links as plain text.
function toHtml(text) {
  return text.split(/\n{2,}/).map((para) => {
    const html = escapeHtml(para).replace(/https:\/\/[^\s<]+/g,
      (u) => `<a href="${u}" style="color:#155eef;">${u.replace(/\?.*$/, '')}</a>`);
    return `<p style="margin:0 0 16px;line-height:1.6;">${html.replace(/\n/g, '<br/>')}</p>`;
  }).join('\n');
}

async function resolveCompanyId(db) {
  if (process.env.COMPANY_ID) return process.env.COMPANY_ID;
  // Same order seed-preview-sequences.js uses, so the campaigns land in the
  // CRM the contacts live in: the owner's company, then one they administer.
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

  for (const c of CAMPAIGNS) {
    const ref = db.collection('companies').doc(companyId).collection('campaigns').doc(c.id);
    const existing = await ref.get();
    const status = existing.exists ? (existing.data().status || 'draft') : null;
    if (status && status !== 'draft') {
      console.log(`  kept     ${c.name} (${status})`);
      continue;
    }
    const bodyText = c.body.trim();
    await ref.set({
      name: c.name,
      subject: c.subject,
      fromName: 'Anthony Brown Sr.',
      bodyText,
      bodyHtml: toHtml(bodyText),
      recipientFilter: FILTER,
      sendOn: c.sendOn,
      status: 'draft',
      createdBy: 'seed-brief-campaigns',
      createdAt: existing.exists
        ? existing.data().createdAt || admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { stats: { delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 } })
    }, { merge: true });
    console.log(`  ${existing.exists ? 'updated' : 'created'}  ${c.name} · send ${c.sendOn}`);
  }
  console.log('\nOpen https://the1pnation.com/campaigns.html and press Send on each draft on its day.');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
}

module.exports = { CAMPAIGNS, FILTER, toHtml };
