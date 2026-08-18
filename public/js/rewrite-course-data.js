// The Rewrite Method — course structure.
//
// This file is the shape of the course, not its content. It ships to the
// browser, so it deliberately holds NOTHING that a paying member paid for:
// no video provider ids, no worksheet URLs. Those live in
// `courses/rewrite-method/modules/{order}/content/main`, which the security
// rules gate on entitlement AND the member's drip date (see firestore.rules).
//
// Everything here is the visible path forward: week titles, what each week
// covers, how long the videos run, and the check-in questions. Locked weeks
// show all of it — the product is partly the knowing-what's-coming.
//
// The module id IS the week number and IS the drip offset: week N unlocks at
// enrolledAt + N * 7 days. The bonus module is 99 and unlocks on the review
// step instead. Changing an id changes when content unlocks — don't.

export const COURSE_SLUG = 'rewrite-method';

// Course vocabulary, used verbatim in UI copy: the sentence, the handwriting,
// the draft, the new line, the pen, the Manuscript. Completers are Rewriters.
export const BONUS_ID = 99;
export const DRIP_INTERVAL_DAYS = 7;

export const COPY = {
  subline: 'Six weeks to take back the pen.',
  courseWelcome: 'This is where the reading stops and the writing starts. One week at a time. Never miss twice.',
  lockedTooltip: 'The rewrite happens at the speed of reps, not the speed of reading.',
  completion: "You're a Rewriter now. The work doesn't end on the last page — it's just getting started.",
  reviewAsk: 'If the book earned it, an honest Amazon review is the highest-leverage two minutes you can give another reader standing where you stood.',
  bookUrl: 'https://a.co/d/0fSUaomu'
};

export const MODULES = [
  {
    id: 0,
    slug: 'week-0',
    title: 'Pick Up the Pen',
    subtitle: 'Why reading the book was never going to be enough',
    eyebrow: 'Week 0',
    duration: '12 min',
    videoCount: 2,
    videos: [
      { id: 'v0-1', title: "Why Reading Alone Doesn't Rewrite Anything", runtime: '5–7 min' },
      { id: 'v0-2', title: 'Open Your Manuscript', runtime: '5–7 min' }
    ],
    worksheetLabel: 'The Manuscript (full workbook)',
    welcome: 'You already read the book. That is the map. This is the six weeks where you actually walk it. Start by naming what you are here to change, in your own handwriting.',
    checkin: {
      prompt: 'Before anything unlocks, put your commitment on the page. You are the only one who will read it, and you are the only one it has to convince.',
      fields: [
        {
          key: 'commitmentLine',
          label: 'What are you here to rewrite, and what are you committing to for the next six weeks?',
          type: 'textarea',
          required: true,
          placeholder: 'For the next six weeks I am committing to…'
        }
      ]
    }
  },
  {
    id: 1,
    slug: 'week-1',
    title: 'Find the Sentence',
    subtitle: 'Drag the line you were handed into the light',
    eyebrow: 'Week 1',
    duration: '22 min',
    videoCount: 3,
    videos: [
      { id: 'v1-1', title: 'Drag It Into the Light', runtime: '8–10 min' },
      { id: 'v1-2', title: 'The Shrink List', runtime: '7–9 min' },
      { id: 'v1-3', title: 'Lock Your Sentence', runtime: '5–6 min' }
    ],
    worksheetLabel: 'Week 1 — Find the Sentence',
    welcome: 'Everyone is living inside a sentence somebody else wrote. This week you find yours and say it out loud, in one line, without softening it.',
    checkin: {
      prompt: 'One line. Not a paragraph, not a story. The sentence itself.',
      fields: [
        {
          key: 'theSentence',
          label: 'Your sentence, in one line',
          type: 'text',
          required: true,
          maxLength: 200,
          note: 'Private to you.',
          placeholder: 'I am…'
        }
      ]
    }
  },
  {
    id: 2,
    slug: 'week-2',
    title: 'Trace the Handwriting',
    subtitle: 'See the line fire before you think',
    eyebrow: 'Week 2',
    duration: '16 min',
    videoCount: 2,
    videos: [
      { id: 'v2-1', title: 'Why It Fires Before You Think', runtime: '6–8 min' },
      { id: 'v2-2', title: 'The Two-Column Log, Demonstrated', runtime: '7–9 min' }
    ],
    worksheetLabel: 'Week 2 — Seven-Day Log',
    welcome: 'You cannot change a line you never catch in the act. Seven days of honest logging tells you where the handwriting shows up and what sets it off.',
    checkin: {
      prompt: 'Count first, explain second. The number is the data.',
      fields: [
        {
          key: 'oldRoadCount',
          label: 'How many times did the old line fire this week?',
          type: 'number',
          required: true,
          min: 0,
          max: 999
        },
        {
          key: 'noticed',
          label: 'What did you notice about when it fires?',
          type: 'textarea',
          required: false,
          placeholder: 'Optional — patterns, triggers, times of day…'
        }
      ]
    }
  },
  {
    id: 3,
    slug: 'week-3',
    title: 'Challenge the Draft',
    subtitle: 'Put the sentence on trial',
    eyebrow: 'Week 3',
    duration: '20 min',
    videoCount: 3,
    videos: [
      { id: 'v3-1', title: 'Put the Sentence on Trial', runtime: '7–9 min' },
      { id: 'v3-2', title: 'Your Two Minds', runtime: '6–8 min' },
      { id: 'v3-3', title: 'The Three-Second Window', runtime: '5–7 min' }
    ],
    worksheetLabel: 'Week 3 — To Me or For Me',
    welcome: 'A draft is not a verdict. This week you cross-examine the sentence, look at the evidence honestly, and decide what the story was actually for.',
    checkin: {
      prompt: 'The old line told you what you are. Write what replaces it.',
      fields: [
        {
          key: 'newExpectation',
          label: 'Your new expectation line: I am ______',
          type: 'text',
          required: true,
          maxLength: 200,
          placeholder: 'I am…'
        }
      ]
    }
  },
  {
    id: 4,
    slug: 'week-4',
    title: 'Write the New Line: The System',
    subtitle: 'Understanding is not change',
    eyebrow: 'Week 4',
    duration: '26 min',
    videoCount: 3,
    videos: [
      { id: 'v4-1', title: 'Understanding Is Not Change', runtime: '7–9 min' },
      { id: 'v4-2', title: 'Shrink It, Anchor It, Mark It', runtime: '9–11 min' },
      { id: 'v4-3', title: 'Convert the Hours You Already Live', runtime: '6–8 min' }
    ],
    worksheetLabel: 'Week 4 — The One Move',
    welcome: 'Insight without a system fades in a week. Shrink the change until it is impossible to skip, anchor it to something you already do, and mark it where you can see it.',
    checkin: {
      prompt: 'Show the mark. A calendar, a tracker, a wall — whatever you will actually look at.',
      fields: [
        {
          key: 'markPhoto',
          label: 'A photo of your mark: the calendar, the tracker, the wall',
          type: 'file',
          required: true,
          accept: 'image/*',
          note: 'Stored privately under your account. Only you and Anthony can open it.'
        }
      ]
    }
  },
  {
    id: 5,
    slug: 'week-5',
    title: 'Write the New Line: Protect the Manuscript',
    subtitle: 'The old author will try to take the pen back',
    eyebrow: 'Week 5',
    duration: '20 min',
    videoCount: 3,
    videos: [
      { id: 'v5-1', title: 'Evict and Replace', runtime: '7–9 min' },
      { id: 'v5-2', title: 'The Daily Vote', runtime: '5–7 min' },
      { id: 'v5-3', title: 'The Old Author Will Try to Take the Pen Back', runtime: '6–8 min' }
    ],
    worksheetLabel: 'Week 5 — New Line + Comeback Plan',
    welcome: 'Removing the old line leaves a gap, and a gap fills itself. This week you decide what fills it, and you plan the comeback before you need it.',
    checkin: {
      prompt: 'The line you are writing, and the vote you cast for it every day.',
      fields: [
        {
          key: 'newLine',
          label: 'Your new line',
          type: 'text',
          required: true,
          maxLength: 200
        },
        {
          key: 'dailyVote',
          label: 'The daily vote you cast for it',
          type: 'text',
          required: true,
          maxLength: 200,
          placeholder: 'Every day I…'
        }
      ]
    }
  },
  {
    id: 6,
    slug: 'week-6',
    title: 'Keep Writing',
    subtitle: 'There is no final draft',
    eyebrow: 'Week 6',
    duration: '20 min',
    videoCount: 3,
    videos: [
      { id: 'v6-1', title: 'The Five and the Rooms', runtime: '7–9 min' },
      { id: 'v6-2', title: 'Inputs and the Portable Environment', runtime: '5–7 min' },
      { id: 'v6-3', title: 'There Is No Final Draft', runtime: '6–8 min' }
    ],
    worksheetLabel: 'Week 6 — Environment Audit',
    welcome: 'The five people, the rooms you sit in, the inputs you let run. Audit them, then decide what stays. This is the week the work becomes permanent.',
    checkin: {
      prompt: 'Last one. Then the pen is yours.',
      fields: [
        {
          key: 'growersLine',
          label: 'The line you are taking forward',
          type: 'text',
          required: true,
          maxLength: 200
        },
        {
          key: 'milestone',
          label: 'What changed in six weeks?',
          type: 'textarea',
          required: false,
          placeholder: 'Optional — but worth writing down while it is fresh.'
        }
      ]
    }
  },
  {
    id: BONUS_ID,
    slug: 'relapse-protocol',
    title: 'Bonus: The Relapse Protocol',
    subtitle: 'When the old sentence comes back',
    eyebrow: 'Bonus',
    duration: '9 min',
    videoCount: 1,
    videos: [
      { id: 'vR-1', title: 'When the Old Sentence Comes Back', runtime: '8–10 min' }
    ],
    worksheetLabel: null,
    welcome: 'It will come back. That is not failure, that is the old handwriting doing what it was trained to do. Here is what you run when it does.',
    checkin: null
  }
];

export const WEEK_MODULES = MODULES.filter((m) => m.id !== BONUS_ID);

export function moduleById(id) {
  return MODULES.find((m) => m.id === Number(id)) || null;
}

export function moduleBySlug(slug) {
  return MODULES.find((m) => m.slug === slug) || null;
}
