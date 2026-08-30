#!/usr/bin/env node
// Seeds the 1P Certified Life Coach course (slug: 1p-clc):
//   - cohort placeholders on the course doc + the private live-call doc
//   - eight module drafts mapped to A.L.I.G.N. (module 1 published,
//     the rest left as drafts to finish in the course builder)
//   - the FOUNDING coupon: $1,500 off, capped at 20 redemptions
//   - a draft written-exam bank (replace/extend in Firestore before launch)
//   - config/certification thresholds
//
// Safe to re-run: everything writes with merge, and the coupon is only
// created if it doesn't exist (so its redemption count is never reset).
//
// Run with Admin credentials:
//   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-clc.js

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const SLUG = '1p-clc';

const MODULES = [
  {
    id: 1,
    title: 'Foundations of 1P Coaching',
    subtitle: 'What coaching is, what it is not, and the stance that makes it work.',
    pillar: 'Module 1 · Awareness',
    duration: 'Week 1',
    published: true,
    html: `
<h2>What coaching actually is</h2>
<p>Coaching is not advice, therapy, mentoring, or consulting. A coach does not hand the client answers. A coach creates the conditions for the client to see clearly, choose deliberately, and act with intention. That distinction is the foundation of everything in this program, and it is the first thing your clients will feel when you hold it well.</p>
<p>The 1P definition: coaching is a structured partnership that helps a person close the gap between who they are and how they operate. Success on paper and alignment in practice are not the same thing. Your client usually has the first and is missing the second. That gap is your work.</p>
<h2>The non-advising stance</h2>
<p>The hardest discipline in coaching is staying out of the client's answer. When you advise, the client rents your clarity. When you coach, they build their own. Advice creates dependency. Questions create ownership. You will practice this stance in every module and it is scored directly on your certification rubric.</p>
<h2>Ethics and scope</h2>
<p>You are not a therapist, and part of serving clients well is knowing where coaching ends. In this module you will learn the referral signals: when a client needs clinical support, when a topic is outside your scope, and how to name that with care. You will also set your confidentiality standard, your session boundaries, and your agreement structure before you ever take a practice client.</p>
<h2>Awareness first</h2>
<p>The A of A.L.I.G.N. is Awareness: seeing the belief clearly. Nothing changes that the client cannot yet see. Your first job in any engagement is not motion. It is sight.</p>`,
    workbook: {
      reflection: 'Where in your own life are you successful on paper but misaligned in practice? Write the honest version, not the polished one.',
      action: 'Write your coaching scope statement: what you coach, what you refer out, and the confidentiality standard you hold.',
      prompts: [
        'What is the difference, in your own words, between giving advice and coaching?',
        'Describe a time someone gave you the answer versus a time someone asked you the question that unlocked it. What changed?',
        'What will be hardest for you personally about the non-advising stance?'
      ]
    },
    summary: [
      'Coaching is a structured partnership, not advice, therapy, or consulting.',
      'The non-advising stance builds client ownership; advice builds dependency.',
      'Know your scope: coaching serves growth, clinical needs get referred with care.',
      'Awareness comes first. Nothing changes that the client cannot yet see.'
    ]
  },
  {
    id: 2,
    title: 'The A.L.I.G.N. Framework',
    subtitle: 'The full arc your clients will move through, and the map you will coach from.',
    pillar: 'Module 2 · Awareness',
    duration: 'Week 2',
    published: false,
    html: `
<h2>The framework</h2>
<p>A.L.I.G.N. is the spine of every 1P coaching engagement: Awareness (seeing the belief clearly), Leadership (taking ownership of your story), Identity (rewriting who you believe you are), Growth (choosing expansion over comfort), and Navigation (executing the path forward).</p>
<p>This module walks the full arc end to end: what each stage looks like in a real client, the signals that a client is ready to move to the next stage, and the mistakes coaches make when they rush the sequence.</p>
<h2>The client journey map</h2>
<p>You will build the six-session journey map you will later deliver commercially: where each A.L.I.G.N. stage lands in the engagement, what each session produces, and how progress is measured so the client sees the change instead of taking your word for it.</p>`,
    workbook: {
      reflection: 'Walk yourself through A.L.I.G.N. on one real area of your life. Which stage are you actually in? Most people overestimate by one.',
      action: 'Draft your six-session client journey map with one outcome per session.',
      prompts: [
        'For each of the five stages, write one question you could ask a client in that stage.',
        'What signal tells you a client has real Awareness rather than intellectual agreement?'
      ]
    },
    summary: [
      'A.L.I.G.N.: Awareness, Leadership, Identity, Growth, Navigation.',
      'The stages are a sequence. Rushing past Awareness produces relapse, not growth.',
      'The six-session journey map turns the framework into a sellable engagement.'
    ]
  },
  {
    id: 3,
    title: 'Leadership of Self and Session',
    subtitle: 'Presence, listening, and the structure that makes a session produce movement.',
    pillar: 'Module 3 · Leadership',
    duration: 'Weeks 3 to 4',
    published: false,
    html: `
<h2>Lead yourself first</h2>
<p>The L of A.L.I.G.N. is Leadership: taking ownership of your story. In the coach's chair that starts with you. Your presence, your regulation, and your attention set the ceiling for the session. A distracted coach produces a shallow session every time.</p>
<h2>The three levels of listening</h2>
<p>Level one hears the words. Level two hears the meaning. Level three hears what is not being said: the energy shifts, the avoided subject, the word the client keeps circling. Certification requires demonstrated level-two listening and visible reaching for level three.</p>
<h2>Session structure</h2>
<p>Every 1P session runs the same spine: open with intention, establish the session goal, explore, distill the insight, commit to action, close with accountability. Structure is not rigidity. It is what makes the session land somewhere instead of everywhere.</p>`,
    workbook: {
      reflection: 'Record yourself in one ordinary conversation. Where did you stop listening and start preparing your reply?',
      action: 'Run one 20-minute practice conversation using the full session spine and log it in your hour log.',
      prompts: [
        'What pulls you out of presence most reliably, and what is your reset?',
        'Write your session-opening question, word for word.'
      ]
    },
    summary: [
      'Your presence sets the ceiling of the session.',
      'Listen for meaning and for what is not said, not just for words.',
      'One session spine: intention, goal, explore, insight, action, accountability.'
    ]
  },
  {
    id: 4,
    title: 'Identity Work',
    subtitle: 'Beliefs, story rewriting, and coaching values back into alignment.',
    pillar: 'Module 4 · Identity',
    duration: 'Weeks 5 to 6',
    published: false,
    html: `
<h2>The identity layer</h2>
<p>The I of A.L.I.G.N. is Identity: rewriting who you believe you are. Behavior change that contradicts identity does not hold. This module gives you the tools to work at the layer where change actually sticks: surfacing limiting beliefs, tracing the story that installed them, and coaching the client through writing a truer one.</p>
<h2>Values excavation</h2>
<p>Misalignment is usually a values problem wearing a productivity costume. You will learn the 1P values excavation: identifying what the client actually values, where their calendar and commitments contradict it, and how to close that gap without burning their life down.</p>`,
    workbook: {
      reflection: 'What is one "I am not the kind of person who..." belief you carry, and what did it cost you this year?',
      action: 'Run the values excavation on yourself before you ever run it on a client.',
      prompts: [
        'Write a limiting belief a client might bring, then the three questions you would ask before ever challenging it.',
        'Where does your calendar contradict your stated values?'
      ]
    },
    summary: [
      'Change that contradicts identity does not hold.',
      'Surface the belief, trace the story, coach the client to write a truer one.',
      'Misalignment is usually a values problem. Excavate before you optimize.'
    ]
  },
  {
    id: 5,
    title: 'Powerful Questions and Growth Plans',
    subtitle: 'Question craft, and turning insight into a plan the client owns.',
    pillar: 'Module 5 · Growth',
    duration: 'Weeks 7 to 8',
    published: false,
    html: `
<h2>Question craft</h2>
<p>The G of A.L.I.G.N. is Growth: choosing expansion over comfort. Growth begins with the question that makes the comfortable answer unavailable. This module drills the craft: short questions over long ones, open over closed, curious over leading, one at a time, then silence. Your certification rubric scores question quality directly.</p>
<h2>Goal architecture</h2>
<p>Insight without architecture evaporates. You will learn the 1P goal structure: outcome, identity, and process goals stacked so daily action connects to who the client is becoming. One percent better every day is the compounding logic your clients will live on.</p>`,
    workbook: {
      reflection: 'What question has someone asked you that you never forgot? Study why it worked.',
      action: 'Build a full goal stack (outcome, identity, process) for one practice client.',
      prompts: [
        'Rewrite these into powerful questions: "Do you not think you should delegate more?" and "Have you tried waking up earlier?"',
        'What is the difference between a goal the client owns and a goal the client agreed to?'
      ]
    },
    summary: [
      'Short, open, curious, one at a time, then silence.',
      'Stack goals: outcome, identity, process. Daily action connects to becoming.',
      'The client owns the plan or the plan fails. Ownership is built, not assigned.'
    ]
  },
  {
    id: 6,
    title: 'Navigation and Accountability',
    subtitle: 'Execution systems, habit design, and progress reviews that keep change alive.',
    pillar: 'Module 6 · Navigation',
    duration: 'Weeks 9 to 10',
    published: false,
    html: `
<h2>From plan to path</h2>
<p>The N of A.L.I.G.N. is Navigation: executing the path forward. Most coaching fails after the session, not in it. This module builds your between-session system: habit design around the client's real constraints, friction audits, and the accountability cadence that produces follow-through instead of guilt.</p>
<h2>The progress review</h2>
<p>You will learn to run the 1P progress review: measuring movement against the baseline, naming drift without shame, and recalibrating the plan while keeping the client in ownership. Accountability is not pressure. It is honest measurement plus belief.</p>`,
    workbook: {
      reflection: 'Think of a habit you kept and one you dropped this year. What was structurally different?',
      action: 'Design the accountability cadence you will offer clients: what happens between sessions, in what channel, at what rhythm.',
      prompts: [
        'How do you hold a client accountable without becoming their parent?',
        'Write the three questions of your progress review.'
      ]
    },
    summary: [
      'Coaching fails between sessions unless a system carries it.',
      'Design habits around real constraints; audit friction before blaming willpower.',
      'Accountability is honest measurement plus belief, never guilt.'
    ]
  },
  {
    id: 7,
    title: 'The Client Engagement',
    subtitle: 'Discovery calls, packages, and the six-week client program you will deliver.',
    pillar: 'Module 7 · Your Practice',
    duration: 'Week 11',
    published: false,
    html: `
<h2>From skill to practice</h2>
<p>A certified coach without clients is a certificate, not a practice. This module covers the commercial spine of your coaching business: the discovery call that serves before it sells, the engagement structures that work (and the ones that quietly fail), and how to price with confidence instead of apology.</p>
<h2>The six-week client program</h2>
<p>As a licensed A.L.I.G.N. practitioner you will deliver the 1P six-week client program: a structured engagement with a workbook and an assessment, built for you so your first client experience is professional from day one. This module walks the full program session by session.</p>`,
    workbook: {
      reflection: 'What is your honest hesitation about charging for coaching? Name it so it stops running the business.',
      action: 'Script your discovery call and run it once with a practice client.',
      prompts: [
        'Who is your first ideal client, described in one sentence?',
        'What does your coaching offer include, at what price, and why that number?'
      ]
    },
    summary: [
      'The discovery call serves first; the sale is a byproduct of clarity.',
      'The six-week A.L.I.G.N. program is your ready-to-deliver first offer.',
      'Price with confidence. An apologetic price signals an apologetic result.'
    ]
  },
  {
    id: 8,
    title: 'Practicum Preparation',
    subtitle: 'The rubric, the recording, and the hour log: exactly how certification works.',
    pillar: 'Module 8 · Your Practice',
    duration: 'Week 12',
    published: false,
    html: `
<h2>How certification is earned</h2>
<p>Four requirements, no exceptions: complete all eight modules, pass the written exam at 80 percent or better, submit one recorded coaching session that passes the rubric review, and log 25 approved practice coaching hours. Every requirement is reviewed. That is what makes the credential worth holding.</p>
<h2>The rubric</h2>
<p>Your recorded session is scored 0 to 5 on four criteria: Presence and Listening, Question Quality, Session Structure, and Non-Advising. This module walks each criterion with examples of what a 2, a 3, and a 5 sound like, so nothing about the review is a surprise.</p>
<h2>The recording</h2>
<p>Record one full session (30 minutes or more) with a practice client who has given written permission. Zoom, Loom, or a shared drive link all work. Submit it from the Certification tab. If it comes back for another take, that is the process working: you get the feedback, you grow, you resubmit.</p>
<h2>After certification</h2>
<p>Certification is earned once. The A.L.I.G.N. Practitioner License renews annually and is what authorizes you to deliver the framework and the client-facing 1P products commercially. Keep logging hours after you certify: renewal requires continued practice and continuing education.</p>`,
    workbook: {
      reflection: 'Read the rubric as a client. Which criterion would you most want your own coach to hold?',
      action: 'Schedule your recorded session and confirm written permission from your practice client.',
      prompts: [
        'Which rubric criterion is currently your weakest, and what will you practice this week?',
        'What is your plan to reach 25 approved hours, week by week?'
      ]
    },
    summary: [
      'Four requirements: modules, exam, reviewed session, 25 approved hours.',
      'The rubric has four criteria scored 0 to 5. Study it before you record.',
      'A returned recording is feedback, not failure. Resubmit stronger.',
      'The certification is earned once; the practitioner license renews annually.'
    ]
  }
];

// Draft exam bank. Real launch bank should be reviewed and extended by
// Anthony in Firestore (examBank/1p-clc/questions) before the first cohort.
const EXAM_QUESTIONS = [
  { prompt: 'A client asks, "What would you do in my situation?" The strongest coaching response is to:', choices: ['Share what worked for you, since they asked directly', 'Redirect with a question that returns ownership, such as "What options do you see?"', 'Decline to answer and change the subject', 'Give advice but label it clearly as advice'], correctIndex: 1 },
  { prompt: 'The five stages of A.L.I.G.N., in order, are:', choices: ['Awareness, Leadership, Identity, Growth, Navigation', 'Alignment, Learning, Intention, Goals, Navigation', 'Awareness, Listening, Identity, Growth, Negotiation', 'Action, Leadership, Insight, Growth, Navigation'], correctIndex: 0 },
  { prompt: 'A client repeatedly describes symptoms of clinical depression. The certified coach should:', choices: ['Design a habit plan to improve their mood', 'Coach harder on mindset', 'Refer them to a licensed mental health professional with care, and stay within coaching scope', 'End the engagement immediately without explanation'], correctIndex: 2 },
  { prompt: 'Level-three listening means hearing:', choices: ['The exact words the client says', 'The meaning behind the words', 'What is not being said: energy shifts, avoided subjects, repeated words', 'The advice the client is hoping for'], correctIndex: 2 },
  { prompt: 'Why does the 1P method work at the identity layer rather than the behavior layer alone?', choices: ['Identity work is faster', 'Behavior change that contradicts identity does not hold', 'Clients prefer talking about identity', 'Behavior change is impossible without a coach'], correctIndex: 1 },
  { prompt: 'The 1P session spine is:', choices: ['Small talk, problem, solution, homework', 'Intention, session goal, explore, insight, action, accountability', 'Review, advice, plan, close', 'Goal, obstacles, options, way forward, celebration, referral'], correctIndex: 1 },
  { prompt: 'A powerful coaching question is usually:', choices: ['Long and detailed so the client understands the context', 'Closed, so the client can answer quickly', 'Short, open, curious, and asked one at a time', 'Leading, so the client reaches the right conclusion'], correctIndex: 2 },
  { prompt: 'The 1P goal stack, in full, is:', choices: ['Outcome goals only', 'Outcome, identity, and process goals', 'Daily, weekly, and monthly goals', 'Stretch, realistic, and safety goals'], correctIndex: 1 },
  { prompt: 'Accountability in the 1P method is best described as:', choices: ['Applying pressure so the client performs', 'Honest measurement plus belief, never guilt', 'Checking in only when the client fails', 'Making the client report to you daily'], correctIndex: 1 },
  { prompt: 'A client agrees to every plan but completes none of them. The first coaching move is to:', choices: ['Assign smaller tasks', 'Explore ownership: whose goal is this, really?', 'Add more accountability check-ins', 'End the engagement'], correctIndex: 1 },
  { prompt: 'During a session the client falls silent after a strong question. You should:', choices: ['Rephrase the question immediately', 'Fill the silence with an example from your life', 'Hold the silence and let the client think', 'Move to the next agenda item'], correctIndex: 2 },
  { prompt: 'The discovery call exists primarily to:', choices: ['Close the sale as fast as possible', 'Serve the prospect with real clarity; the sale is a byproduct', 'Demonstrate how much you know', 'Qualify whether the client can afford you'], correctIndex: 1 },
  { prompt: 'Misalignment in a successful-on-paper client is most often rooted in:', choices: ['Laziness', 'A values conflict between what they say matters and how they operate', 'Lack of information', 'Too few goals'], correctIndex: 1 },
  { prompt: 'The four criteria of the certification rubric are:', choices: ['Presence and Listening, Question Quality, Session Structure, Non-Advising', 'Energy, Charisma, Knowledge, Closing', 'Empathy, Advice Quality, Speed, Results', 'Preparation, Punctuality, Politeness, Persistence'], correctIndex: 0 },
  { prompt: 'Which statement about the credential is accurate?', choices: ['The 1P-CLC is a state-issued life coach license', 'The 1P-CLC is an ICF-accredited credential', 'The 1P-CLC is a proprietary certification; the A.L.I.G.N. Practitioner License is the annually renewed right to deliver the framework commercially', 'The certification and the license are the same thing'], correctIndex: 2 },
  { prompt: 'A practice hour counts toward the 25-hour requirement when:', choices: ['You watched a coaching video', 'You logged a real coaching session and an admin approved the entry', 'You planned a session that did not happen', 'You attended the live weekly call'], correctIndex: 1 },
  { prompt: 'Confidentiality in a coaching engagement should be:', choices: ['Implied and never discussed', 'Stated in the agreement before coaching begins, with its limits named', 'Absolute with no exceptions of any kind', 'Optional for practice clients'], correctIndex: 1 },
  { prompt: 'The compounding logic at the heart of The One Percent is:', choices: ['Massive action in short bursts', 'Becoming one percent better every day through small, consistent, aligned progress', 'Working more hours than anyone else', 'Waiting for motivation before acting'], correctIndex: 1 }
];

async function main() {
  // Cohort placeholders on the public course doc. Replace before launch.
  await db.collection('courses').doc(SLUG).set({
    cohort: {
      label: 'Founding Cohort',
      enrollCloseAt: null,   // TODO Anthony: set enrollment close date
      startAt: null,         // TODO Anthony: set module 1 drop date
      capacity: 20,
      callDay: 'TBD',        // TODO Anthony: fixed weekly call day
      callTime: 'TBD'        // TODO Anthony: fixed weekly call time
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Live-call join link lives out of public view (enrolled + admin only).
  await db.collection('courses').doc(SLUG).collection('private').doc('cohort').set({
    joinUrl: ''             // TODO Anthony: paste the Zoom link
  }, { merge: true });

  for (const m of MODULES) {
    const { id, ...rest } = m;
    await db.collection('courses').doc(SLUG).collection('modules').doc(String(id)).set({
      id,
      ...rest,
      html: rest.html.trim(),
      tagLabel: rest.pillar,
      sortOrder: id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Module ${id} seeded (${rest.published ? 'published' : 'draft'})`);
  }

  // Founding cohort: $1,500 off $3,497 = $1,997, publicly capped at 20.
  const couponRef = db.collection('coupons').doc('FOUNDING');
  const coupon = await couponRef.get();
  if (!coupon.exists) {
    await couponRef.set({
      code: 'FOUNDING',
      amountOff: 1500,
      appliesTo: { kind: 'course', ids: [SLUG] },
      active: true,
      maxRedemptions: 20,
      redemptions: 0,
      note: 'Founding cohort: $1,997, 20 seats, never repeated.',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('FOUNDING coupon created');
  } else {
    console.log('FOUNDING coupon already exists; left untouched');
  }

  let qNum = 0;
  for (const q of EXAM_QUESTIONS) {
    qNum += 1;
    await db.collection('examBank').doc(SLUG).collection('questions')
      .doc(`q${String(qNum).padStart(3, '0')}`).set({ ...q, active: true }, { merge: true });
  }
  console.log(`${qNum} exam questions seeded`);

  await db.collection('config').doc('certification').set({
    passingScorePercent: 80,
    maxExamAttempts: 3,
    requiredHours: 25,
    examQuestionCount: 15,
    renewalHours: 10,
    renewalCeCredits: 10
  }, { merge: true });
  console.log('config/certification seeded');
  console.log('Done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
