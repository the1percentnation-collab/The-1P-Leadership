// The 1% Discipline Score: consistency, routines, follow-through, focus and bouncing back.
export default {
  slug: 'discipline-score',
  title: 'The 1% Discipline Score',
  category: 'self',
  mode: 'score',
  minutes: 5,
  hook: 'One percent better every day. Are you actually doing it?',
  short: 'Measure the daily discipline behind lasting growth: consistency, routines, follow-through, focus, and how fast you recover from a slip.',
  intro: 'Eighteen statements about how you actually operate day to day. Answer honestly. Discipline is built on clarity, not guilt.',
  dimensions: [
    {
      key: 'consistency',
      label: 'Consistency',
      desc: 'Showing up for what matters on ordinary days, not just motivated ones.',
      actions: [
        'Pick one habit and shrink it until it takes five minutes or less. Do that version every day this week.',
        'Put a simple mark on a paper calendar each day you complete it. Do not break the chain twice in a row.',
        'Attach the habit to something you already do daily, like your first coffee or your commute.'
      ]
    },
    {
      key: 'routines',
      label: 'Routines',
      desc: 'Structuring your mornings and evenings so good choices happen by default.',
      actions: [
        'Write down a three-step morning routine you can finish in twenty minutes. Run it for five days.',
        'Set out tomorrow\'s first task tonight, before you shut down for the day.',
        'Choose a consistent wake-up time for the next seven days, weekends included.'
      ]
    },
    {
      key: 'followThrough',
      label: 'Follow-Through',
      desc: 'Finishing what you start and keeping the commitments you make to yourself.',
      actions: [
        'List every open commitment you have made to yourself. Finish one, schedule one, and drop one this week.',
        'Before you start anything new this week, finish one thing that is already in progress.',
        'Tell one person a specific goal for this week and ask them to check in on Friday.'
      ]
    },
    {
      key: 'focus',
      label: 'Focus',
      desc: 'Giving your best attention to the few things that move you forward.',
      actions: [
        'Block one ninety-minute focus session on three days this week. Phone in another room, notifications off.',
        'Each morning, write down the one task that would make the day a win. Do it before checking email.',
        'Delete or hide the one app that steals the most of your attention for the next seven days.'
      ]
    },
    {
      key: 'recovery',
      label: 'Bounce Back',
      desc: 'Returning quickly after a missed day instead of letting one slip become a slide.',
      actions: [
        'Write a one-line rule for missed days, such as: never miss twice. Put it where you will see it.',
        'The next time you slip, restart within 24 hours with the smallest possible version of the habit.',
        'At the end of this week, write down what caused your last slip and one change that would prevent it.'
      ]
    }
  ],
  questions: [
    { dim: 'consistency', text: 'I do the important things even on days I do not feel like it.' },
    { dim: 'consistency', text: 'My habits depend mostly on how motivated I feel that day.', reverse: true },
    { dim: 'consistency', text: 'I have at least one daily habit I have kept for more than a month.' },
    { dim: 'consistency', text: 'I can see small, steady progress in at least one important area of my life.' },

    { dim: 'routines', text: 'I have a morning routine that sets me up for a productive day.' },
    { dim: 'routines', text: 'I plan my day before it starts instead of reacting as it unfolds.' },
    { dim: 'routines', text: 'Most of my days feel unstructured and rushed.', reverse: true },

    { dim: 'followThrough', text: 'When I commit to something, I see it through to the end.' },
    { dim: 'followThrough', text: 'I have several projects or goals that I started and never finished.', reverse: true },
    { dim: 'followThrough', text: 'I keep the promises I make to myself as seriously as the ones I make to others.' },
    { dim: 'followThrough', text: 'I break big goals into small steps I can actually complete.' },

    { dim: 'focus', text: 'I protect time each day for deep, focused work.' },
    { dim: 'focus', text: 'I check my phone or email far more often than I need to.', reverse: true },
    { dim: 'focus', text: 'I know the one or two priorities that matter most this week.' },

    { dim: 'recovery', text: 'When I miss a day, I get back on track quickly.' },
    { dim: 'recovery', text: 'One bad day can easily turn into a bad week for me.', reverse: true },
    { dim: 'recovery', text: 'I treat a slip as information about my system, not proof that I lack discipline.' },
    { dim: 'recovery', text: 'I adjust my plan when life gets busy instead of abandoning it.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Starting Line',
      summary: 'Right now, your progress depends more on motivation than on systems. That is where almost everyone begins, and it is not a measure of your potential. One small habit, done daily, is all it takes to start compounding from here.'
    },
    {
      min: 50,
      label: 'Building Momentum',
      summary: 'You have real discipline in some areas and gaps in others. The foundation is there. Tightening your weakest area below will turn good intentions into the kind of steady, daily growth that adds up over a year.'
    },
    {
      min: 75,
      label: 'Compounding',
      summary: 'Your habits are doing the heavy lifting, and that is exactly how lasting growth works. You show up, you follow through, and you recover fast. Your next level is focusing that discipline on the few priorities that matter most.'
    }
  ],
  related: ['alignment-scorecard', 'burnout-check', 'playing-small'],
  cta: { label: 'Join the next free webinar', href: '/webinar' }
};
