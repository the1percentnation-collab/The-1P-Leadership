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

  'run-a-company-not-answer-a-text': {
    brief: 3,
    workbook: {
      reflection: 'Where in your life are you excellent under pressure and stuck on something small? Write both down side by side and notice that the difference is not difficulty.',
      action: 'List every low-stakes task sitting unanswered, put one twenty-minute window on your calendar this week to handle all of them in one pass, and add a condition that supplies what the tasks do not: a timer, another person, a different room.',
      prompts: [
        'What is the smallest task you have been unable to do for the longest time? How long has it actually been sitting there?',
        'What conclusion have you drawn about your character because of it, and what is the evidence against that conclusion?',
        'Which conditions reliably pull your focus: urgency, novelty, challenge, or genuine interest? Name a recent example of each.',
        'How could you supply one of those conditions to the task you have been avoiding, without changing the task itself?'
      ]
    },
    summary: [
      'Attention responds to engagement, not to importance. Something mattering to you does not help you start it.',
      'High-stakes work supplies urgency, novelty and challenge. Low-stakes admin supplies none of them.',
      'The conclusion that you are lazy or inconsiderate costs more than the unanswered message ever did.',
      'The same wiring that makes the small thing hard is what makes you good when something is live and consequential.',
      'Stop trying to want the small things more. Build the conditions instead, and batch them so they carry each other.'
    ]
  },

  'the-4pm-collapse': {
    brief: 5,
    workbook: {
      reflection: 'Look at last week honestly. What hour of the day did your most important work actually land in, and was that a decision or a leftover?',
      action: 'For five days, note the hour your best thinking happened. Then put next week\'s most important work inside that window before anything else lands on it, and move admin into the afternoon dip on purpose.',
      prompts: [
        'When in the day does thinking come easily for you? Not when you are busiest, when you are sharpest.',
        'What is currently occupying that window, and who decided it would go there?',
        'Which tasks on your list genuinely do not need your best brain? Name at least five.',
        'What story have you built about your own discipline that is really a story about scheduling?'
      ]
    },
    summary: [
      'Energy is a curve, not a resource you ration evenly across the day.',
      'Most people have two to four hours of genuine high-focus capacity, and the afternoon dip is biological rather than motivational.',
      'Giving your most valuable work the hour your brain is least equipped for teaches you a false lesson about yourself.',
      'Match the work to the hour. Hard work in the best window, low-thinking work in the dip, a recovery gap between them.'
    ]
  },

  'boredom-is-a-medical-event': {
    brief: 3,
    workbook: {
      reflection: 'Think of a task that takes under fifteen minutes and has sat undone for over a week. What happens in your body when you look at it?',
      action: 'Take that task and change its conditions rather than your attitude: a visible timer, another person present, motion or sound, a defined end point, and a two-minute entry commitment.',
      prompts: [
        'Which task is currently costing you more in avoidance than it would cost in execution?',
        'Describe the resistance physically. Where do you feel it, and what does it most resemble?',
        'What tasks never trigger that resistance, and what do they have that this one does not?',
        'Which of the five conditions is easiest for you to add this week, and to which task?'
      ]
    },
    summary: [
      'People differ considerably in how understimulation registers. For some it is mild, for others it behaves like discomfort to be escaped.',
      'If that is your system, a boring task asks you to sit inside something your nervous system is pushing you out of, with willpower as the only counterweight.',
      'The useful question is not how do I force myself to care. It is how do I raise the stimulation enough to stay in it.',
      'Add a clock, a body, motion, a visible end point, and a two-minute entry. You are supplying an input the task does not supply itself.'
    ]
  },

  'anxiety-prediction-machine': {
    brief: 4,
    workbook: {
      reflection: 'What conversation or outcome have you rehearsed most often in the last month? Count how many times you ran it, then write what actually happened.',
      action: 'Start a single running note. Every time you catch yourself rehearsing an outcome, write the date and the specific prediction. After the event, write what actually happened. Do not read it for a month, then read the whole list at once and count.',
      prompts: [
        'Write your current prediction about something coming up, as specifically as you can. Vague does not count.',
        'Where did your forecasting model learn what it believes about conflict, being wrong, or disappointing people?',
        'How much capacity did last week\'s rehearsing cost you, and what did it buy that actual preparation would not have?',
        'When someone reassures you, how long does it hold? What does that tell you about where the model lives?'
      ]
    },
    summary: [
      'The brain is a prediction engine, and it is only as good as the data it was trained on.',
      'An outdated model is not malfunctioning. It is running accurately on a dataset that stopped describing your life.',
      'Reassurance argues with the output and leaves the model untouched, which is why it never holds.',
      'You cannot talk the forecast down. You can collect your own track record, which is the only evidence the system will accept.'
    ]
  },

  'the-hyperfocus-hangover': {
    brief: 5,
    workbook: {
      reflection: 'Think back to your last very long work session. What did the two or three days after it look like, and did you ever connect them to each other?',
      action: 'Before your next long session, set an end time and an alarm you have to stand up to turn off, keep water and one real meal in place, protect the ninety minutes before sleep, and put a deliberately light day on the calendar for the day after.',
      prompts: [
        'When was your last long session, and what did the following three days actually produce?',
        'What do you currently tell yourself those flat days were caused by?',
        'What does a long session reliably cost you in sleep, food and patience with the people around you?',
        'Which sessions are genuinely worth that cost, and how would you know in advance?'
      ]
    },
    summary: [
      'Deep absorption is a state with a physiological cost, and the people best at entering it are usually worst at pricing it.',
      'A very long session does not find extra capacity. It borrows the next two days and bills you quietly.',
      'The fog and the irritability that follow are the invoice, not a separate slump.',
      'The goal is not to stop entering that state. It is to stop entering it blind, with a hard stop, food, protected sleep and a scheduled recovery day.'
    ]
  },

  'your-todo-list-is-lying': {
    brief: 3,
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

  'the-shame-loop': {
    brief: 6,
    workbook: {
      reflection: 'What commitment are you currently late on? Separate two things on paper: the work itself, and everything you have concluded about yourself since you first put it down.',
      action: 'Send the repair line first, before doing the work. One sentence, no explanation. Then give the actual work a start time within forty-eight hours and cut the scope to the smallest version that honors the commitment.',
      prompts: [
        'Write the repair line you owe someone, in one sentence, with no justification in it.',
        'How long has the task actually been sitting, and how long would the work itself genuinely take?',
        'What sentence about yourself have you been repeating? Write what actually happened next to it, at the size of the facts.',
        'What is the smallest version of this that still honors what you promised?'
      ]
    },
    summary: [
      'Guilt says I did a bad thing and pushes toward repair. Shame says I am a bad thing and pushes toward hiding.',
      'The avoidance is not about capability. It is that the task has become a mirror.',
      'Each miss adds evidence to the story, which deepens the shame, which strengthens the avoidance.',
      'Self-criticism is the fuel this loop runs on. The way out is to shrink what the task means until it is small enough to touch.',
      'Self-trust is rebuilt the way it was lost, one kept commitment at a time.'
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

  'why-rest-makes-you-more-anxious': {
    brief: 5,
    workbook: {
      reflection: 'The last time you sat down to rest and felt worse, what was actually competing for your attention? Write down everything that surfaced in that first quiet ten minutes.',
      action: 'Build a closing sequence. Fifteen minutes before you stop: empty your head onto paper, give every item a day and a time, write a next action for anything waiting on someone else, close the notebook, and name the transition.',
      prompts: [
        'What surfaces first when the noise stops? Those are your loudest open loops.',
        'Which items on your list are stuck because they depend on someone else, and what is the next action and check-in date for each?',
        'What does your current end-of-day transition look like, and is there one at all?',
        'What do you dread about coming back from your next stretch of time off, and what would it take to schedule those first two days now?'
      ]
    },
    summary: [
      'Rest does not cause the anxiety. It removes the noise that was covering it.',
      'Open loops surface hardest when nothing else is occupying you, which is exactly what rest is.',
      'You do not have to finish an open loop to quiet it. A specific plan for when it gets handled is what your brain accepts as proof.',
      'Rest needs a gate in front of it. The closing sequence is the gate.',
      'Before time off, run the sequence at a larger scale and schedule your first two days back before you leave.'
    ]
  },

  'the-system-you-abandoned': {
    brief: 2,
    workbook: {
      reflection: 'How many times have you started a system, had it work, and lost it? Write down what you decided that loss meant about you.',
      action: 'Write your restart protocol now, while nothing is broken: one block, within forty-eight hours, named in advance, with no makeup math, plus a fifteen-minute weekly review on the calendar.',
      prompts: [
        'Name the single block that comes back first after a disruption. Decide it now, not in the middle of a bad week.',
        'What are the three situations that have historically knocked you off? Those are design problems, not mysteries.',
        'What catch-up plan have you built after a bad week before, and when did it collapse?',
        'When is your weekly fifteen-minute review going to happen? Put it on the calendar before you finish this.'
      ]
    },
    summary: [
      'A system that worked for three weeks did not fail. The restart failed.',
      'Habit formation takes considerably longer than people expect, and a single missed occasion does not meaningfully damage it.',
      'The slip is not what breaks a system. Quitting after the slip is what breaks it.',
      'You do not owe the system the hours you missed. There is no debt, and today\'s block is worth as much as any other.',
      'A system with a scheduled weekly check-in recovers in days. One without it recovers in months, if at all.'
    ]
  },

  'fewer-decisions-not-more-focus': {
    brief: 1,
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
