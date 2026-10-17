#!/usr/bin/env node
// Seeds the two drip sequences behind the free chapter preview (/read).
//
// The preview's lead gate (public/js/reader-lead.js) submits through
// submitLeadForm with formType 'chapter-preview', which tags the contact:
//
//   opened the preview   → "Chapter Preview", "Book Reader", "Preview: <title>"
//   finished the preview → the above, plus "Preview Finished"
//
// Tagging a contact fires onContactWrittenForSequences → autoEnroll with
// trigger type 'tag_added', so these two sequences need no new enrollment
// code. They are ordinary Firestore sequence docs, visible and editable at
// /sequences.html like any other.
//
//   Chapter Preview Nurture   tag_added "Chapter Preview"   4 emails
//   Preview Finisher          tag_added "Preview Finished"  3 emails
//
// A reader who finishes gets tagged twice, so the finisher sequence carries
// stopOthersOnEnroll: true (functions/index.js → autoEnroll). Enrolling in it
// stops the nurture drip first, and they never receive both.
//
// Timing note: the tick is a GitHub Actions cron (.github/workflows/
// crm-tick.yml) and lands roughly hourly, sometimes with a two hour gap. A
// step at 0 hours means "on the next tick", not "immediately". Delays here
// are spaced in days for that reason.
//
// Safe to re-run: both docs have fixed ids, so a second run overwrites the
// copy rather than creating duplicates. Re-running does NOT disturb contacts
// already enrolled; their enrollment keeps its own currentStep and picks up
// the new copy at the step it is on.
//
// Run against the emulator:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-1p \
//     node scripts/seed-preview-sequences.js
//
// Run against production (deliberate, and it will say so):
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-preview-sequences.js
//
// Seed them paused, to read the copy in the UI before anything sends:
//   ... node scripts/seed-preview-sequences.js --paused

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const OWNER_EMAIL = 'the1percentnation@gmail.com';
const PAUSED = process.argv.includes('--paused');

const PREVIEW_URL = 'https://the1pnation.com/read?book=i-cant-preview';
const BUNDLE_URL = 'https://the1pnation.com/bundle.html';
const CORPORATE_URL = 'https://the1pnation.com/corporate.html';

// Every sending step is email. The gate collects a name and an email and no
// phone, so an SMS step here would have nothing to send to.
const email = (delayHours, subject, body) => ({
  channel: 'email', delayHours, subject, body: body.trim(), templateId: null
});

const SEQUENCES = [
  {
    id: 'preview-nurture',
    name: 'Chapter Preview Nurture',
    trigger: { type: 'tag_added', value: 'Chapter Preview' },
    stopOthersOnEnroll: false,
    steps: [
      email(0, 'Chapter one is open', `
{{firstName}},

Here is chapter one, where you left it:
${PREVIEW_URL}

It opens on any device and remembers your page.

One thing to notice while you read. The first "I can't" that comes to mind is almost never yours. Someone handed it to you, at some point, and you have been carrying it since. That sentence is what the whole book is built to work on.

When you finish, reply and tell me what yours was. I read every one.

Anthony
`),
      email(48, 'The sentence you did not write', `
{{firstName}},

Most limiting beliefs do not sound like beliefs. They sound like facts.

"I'm not a numbers person." "I don't have the discipline for that." "That's just how I am."

A belief you inherited gets treated as a description of reality, so you never argue with it. You plan around it instead. Then you build a life that fits the plan, and the belief looks like it was right all along.

Here is something to run today. Write down one sentence you say about yourself that starts with "I'm not" or "I can't." Then write the name of the first person you remember saying it about you.

If a name comes up, it was never a fact. It was a handoff.

Chapter one is still open if you have not finished it:
${PREVIEW_URL}

Anthony
`),
      email(96, 'Reading it is not the same as doing it', `
{{firstName}},

I have watched people finish this book, feel something real, and change nothing.

Not because they did not care. Because reading is input and change is reps. The exercise at the end of each chapter is the rep, and it is the part most people skip.

So I built the course to make skipping harder. Ten modules, one per chapter, in the book's order. Each one takes that chapter's exercise and turns it into a workbook you keep, with your answers saved. The sentence you write in chapter one is the one you rewrite in chapter eight.

The book comes free with it:
${BUNDLE_URL}

If you would rather just read the book on its own, that is a fine answer too. Reply and I will send you that link instead.

Anthony
`),
      email(168, 'One question, then I will leave the book alone', `
{{firstName}},

Last note about the book.

What is the one thing you would be doing right now if the sentence you have been carrying was not true?

Not the five year version. The thing this month.

Reply with it and I will tell you honestly whether it is a mindset problem, a plan problem, or a capacity problem, and what I would do first. No pitch attached.

If you lead a team carrying this same thing at scale, that is a different conversation:
${CORPORATE_URL}

Anthony
`)
    ]
  },
  {
    id: 'preview-finisher',
    name: 'Preview Finisher',
    trigger: { type: 'tag_added', value: 'Preview Finished' },
    // Reaching the end supersedes the opener drip. See autoEnroll.
    stopOthersOnEnroll: true,
    steps: [
      email(0, 'You finished chapter one', `
{{firstName}},

You read it all the way through. Most people do not, and that tells me something.

Chapter one only does one job. It names the problem. The nine chapters after it are where the method gets built, one piece at a time, with an exercise at the end of each that you actually do.

Here is the rest, with the course that turns those exercises into reps you keep:
${BUNDLE_URL}

Before you decide anything, reply with the "I can't" that came up while you were reading. That is the one I would start with.

Anthony
`),
      email(48, 'What the other nine chapters do', `
{{firstName}},

A quick map, so you know what you would be getting.

Chapters one through three name the belief and trace where it came from. Four through seven are the rebuild: what you replace it with, how you hold it when it gets tested, and what six honest weeks actually look like. Eight through ten are about keeping it, because the old sentence does not leave quietly. It waits for a hard week.

Every chapter ends with an exercise, and they build on each other. The sentence you write in chapter one is the one you rewrite in chapter eight. That is why doing them in order, and keeping them somewhere, matters more than reading quickly.

That is what the course is for:
${BUNDLE_URL}

Anthony
`),
      email(120, 'If this is bigger than a book', `
{{firstName}},

One more thought, then I will stop.

Most people who finish chapter one are not struggling. They are successful on paper and misaligned in practice. The belief is not holding back the career. It is holding back the part of life the career was supposed to buy.

If that is close, there are two doors.

The personal one is the book and the course:
${BUNDLE_URL}

The other one is for leaders whose team is carrying the same thing. I run a free 45 minute Alignment Audit for that, and you leave with a written scorecard inside 48 hours whether or not we ever work together:
${CORPORATE_URL}

Either way, thank you for reading. One percent better today, and the rest takes care of itself.

Anthony
`)
    ]
  }
];

async function resolveCompanyId() {
  if (process.env.COMPANY_ID) return process.env.COMPANY_ID;
  // Same order submitLeadForm uses, so the sequences land in the CRM the
  // leads land in: the owner's company, then one they administer.
  const users = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
  if (!users.empty) {
    const owner = users.docs[0];
    if (owner.data().companyId) return owner.data().companyId;
    const admin0 = await db.collection('companies').where('adminUids', 'array-contains', owner.id).limit(1).get();
    if (!admin0.empty) return admin0.docs[0].id;
  }
  const any = await db.collection('companies').limit(1).get();
  if (!any.empty) {
    console.warn(`[seed] owner has no company; using ${any.docs[0].id}`);
    return any.docs[0].id;
  }
  throw new Error('No company found. Set COMPANY_ID to the one the CRM uses.');
}

(async () => {
  const live = !process.env.FIRESTORE_EMULATOR_HOST;
  const companyId = await resolveCompanyId();
  console.log(`${live ? 'PRODUCTION' : 'emulator'} · company ${companyId}${PAUSED ? ' · seeding paused' : ''}`);

  for (const s of SEQUENCES) {
    const ref = db.collection('companies').doc(companyId).collection('sequences').doc(s.id);
    const existing = await ref.get();
    await ref.set({
      name: s.name,
      active: !PAUSED,
      trigger: s.trigger,
      stopOthersOnEnroll: s.stopOthersOnEnroll,
      steps: s.steps.map((step, i) => ({ ...step, order: i })),
      stopOnReply: true,
      // A re-run must not reset the running total on a live sequence.
      enrolledCount: existing.exists ? (existing.data().enrolledCount || 0) : 0,
      createdBy: 'seed-preview-sequences',
      createdAt: existing.exists
        ? existing.data().createdAt || admin.firestore.FieldValue.serverTimestamp()
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    const when = s.steps.map((x) => `${x.delayHours}h`).join(' → ');
    console.log(`  ${existing.exists ? 'updated' : 'created'}  ${s.name}`);
    console.log(`            on tag "${s.trigger.value}" · ${s.steps.length} emails · ${when}`);
  }

  console.log('\nReview and edit the copy at https://the1pnation.com/sequences.html');
  process.exit(0);
})().catch((e) => {
  console.error('[seed] failed:', e && e.message);
  process.exit(1);
});
