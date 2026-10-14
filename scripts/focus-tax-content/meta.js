// The Focus Tax · per-piece workbook and summary.
//
// The prose for each piece lives in its own markdown file beside this one.
// What cannot be derived from that prose lives here: the workbook tab
// (reflection, action, prompts) and the key-takeaways tab (summary), keyed by
// the `slug` in each file's frontmatter.
//
// `brief` is optional. When set, it names a module of The One Percent Brief
// that goes deeper on the same subject, and the seed appends a one-line
// pointer to the end of the piece. That pointer is the whole funnel: the
// Focus Tax is free and short, the Brief is paid and long.
//
// Adding a piece is a new markdown file plus an entry here, then a re-run of
// seed-focus-tax.js. Brand voice: grounded, clear, no hype, no em dashes.

module.exports = {
  'the-tab-you-never-closed': {
    brief: 3,
    workbook: {
      reflection: 'Think about the last time you sat down to do the thing that mattered and did something else instead. What did you do instead, and what did that substitute task let you avoid feeling?',
      action: 'Tonight, write down the one thing you have been avoiding, write what you did instead of it last time, and give it a start time and an end time on tomorrow\'s calendar inside your first protected hour.',
      prompts: [
        'Name the hard thing you are currently avoiding, in one plain line. Not the category, the actual task.',
        'What did you do instead of it the last three times? Look for the pattern in what those substitutes have in common.',
        'What specifically are you afraid will happen when you do the hard thing? Rejection, conflict, being seen as not good enough, or something else?',
        'List every open commitment you are carrying right now, personal and professional, and put a date and time beside each one.'
      ]
    },
    summary: [
      'Avoidance almost never looks like doing nothing. It looks like doing something easier that still counts as work.',
      'Unfinished commitments keep surfacing and cost you capacity whether you act on them or not.',
      'The hard task loses every time it has to compete in the moment, because you are deciding while standing next to the thing you are afraid of.',
      'A specific time and place raises follow-through dramatically. The decision has to get made somewhere cheaper than the moment.'
    ]
  },

  'your-todo-list-is-lying': {
    workbook: {
      reflection: 'Pull up your current list. How many items have been carried over from a previous week, and what does that number tell you that the list itself never did?',
      action: 'Put a time estimate on every item, add forty percent, total it, compare it to the hours you actually have next week, cut until the numbers match, and calendar what survives with a start and end time.',
      prompts: [
        'How many hours of work is on your list right now, honestly estimated and then increased by forty percent?',
        'How many working hours do you actually have next week after everything already committed?',
        'What has to be cut for those two numbers to match? Name it specifically.',
        'What have you been telling yourself about your discipline that is really a capacity math error?'
      ]
    },
    summary: [
      'A list has no capacity, so it will let you plan fourteen hours of work into a four-hour day without objecting.',
      'People reliably underestimate how long their own tasks take, and knowing about the bias does not correct it.',
      'A calendar has fixed capacity, a start time, and a neighbor on either side. All three are things a list is missing.',
      'If it is not on the calendar it is not a commitment yet. It is an intention.'
    ]
  },

  'meeting-brain-wont-stay-in-the-room': {
    brief: 3,
    workbook: {
      reflection: 'Think about your last meeting. What was decided, what did you agree to, and how much of that could you reconstruct without asking anyone?',
      action: 'In your next meeting, write continuously in three columns (decisions, questions, my commitments), offer to recap in the last three minutes, say your commitments out loud before leaving, and block ten minutes afterward to turn them into calendar blocks.',
      prompts: [
        'How often do commitments you made in a meeting resurface later as problems?',
        'What are you currently trying to hold in your head during a meeting, all at the same time?',
        'Which recurring meeting on your calendar has no clear agenda, and what would you ask for before the next one?',
        'What has stopped you from taking the recap role before now?'
      ]
    },
    summary: [
      'Paying better attention is not an available instruction. The constraint is working memory, not effort.',
      'A meeting asks you to hold the thread, track who said what, form a position and remember your commitments with no external support.',
      'Stop holding and start externalizing. Everything you push onto a surface is capacity returned to thinking.',
      'Taking the recap role does more than every focus technique combined, and it reads as leadership because it is.',
      'A commitment that lives only in your notes is already at risk. Turn it into a calendar block within ten minutes.'
    ]
  },

  'fewer-decisions-not-more-focus': {
    workbook: {
      reflection: 'Count the decisions between sitting down to work and actually starting. Write them all out, then ask which ones could have been made last night instead.',
      action: 'Cut decision load in four places this week: pre-decide tomorrow\'s most important thing the night before, default your repeating choices, batch work by type, and protect your first two hours with a published rule rather than willpower.',
      prompts: [
        'Write tonight\'s sentence: the most important thing tomorrow is this, and it happens at this time.',
        'Which choices do you make more than twice a week that should be standing rules instead?',
        'How often do you switch between different kinds of work in a day, and what would grouping them look like?',
        'What rule about your mornings could you publish to the people around you this week?'
      ]
    },
    summary: [
      'The exhausting part of a day is often not the work. It is the forty small negotiations before the work starts.',
      'Unstructured time does not sit waiting to be used well. It generates decisions continuously, and each one draws down capacity.',
      'Structure outperforms motivation because a pre-decided day does not require discipline at two in the afternoon.',
      'Every piece in this series points at the same move: take the decision out of the moment and make it somewhere cheaper.',
      'Decide once, when it is cheap. Execute many times, when it is not.'
    ]
  }
};
