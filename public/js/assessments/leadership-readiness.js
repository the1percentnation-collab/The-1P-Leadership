// Leadership Readiness: are you ready to lead at the next level?
export default {
  slug: 'leadership-readiness',
  title: 'Leadership Readiness Assessment',
  category: 'leader',
  mode: 'score',
  minutes: 5,
  hook: 'Ready for the next level, or just ready for the title?',
  short: 'Measure how prepared you are to lead at the next level across self-leadership, communication, decisions, developing others, and strategy.',
  intro: 'Twenty statements about how you lead today. Answer honestly. The goal is clarity on where to grow, not a grade.',
  dimensions: [
    {
      key: 'selfLeadership',
      label: 'Self-Leadership',
      desc: 'Leading yourself with discipline and consistency before you lead anyone else.',
      actions: [
        'Write down the three commitments you most often break to yourself. Pick one and keep it every day this week.',
        'Plan tomorrow before you end today: three priorities, written down, before you close your laptop.',
        'Notice the moment you feel most reactive this week. Afterward, write what triggered it and what you would do differently.'
      ]
    },
    {
      key: 'communication',
      label: 'Communication',
      desc: 'Saying what matters clearly, listening fully, and handling hard conversations well.',
      actions: [
        'Before your next important meeting, write the one sentence you want people to remember. Say it first.',
        'In one conversation this week, listen without interrupting and summarize what you heard before you respond.',
        'Name one hard conversation you have postponed. Schedule it for this week and write your opening line in advance.'
      ]
    },
    {
      key: 'decisionMaking',
      label: 'Decision Making',
      desc: 'Making sound, timely decisions and owning the results.',
      actions: [
        'List every decision currently waiting on you. Make the two oldest ones by Friday.',
        'For your next big decision, write down what you expect to happen. Review it in 30 days to sharpen your judgment.',
        'Set a deadline for one decision you have been circling and tell someone else the date.'
      ]
    },
    {
      key: 'developingOthers',
      label: 'Developing Others',
      desc: 'Multiplying your impact by growing the people around you.',
      actions: [
        'Pick one person you lead or influence. Ask them: what skill would change your next year? Help them start on it this week.',
        'Give one piece of specific, useful feedback today, positive or corrective, within an hour of seeing the moment.',
        'Hand off one meeting or task you usually handle so someone else can grow into it.'
      ]
    },
    {
      key: 'strategicThinking',
      label: 'Strategic Thinking',
      desc: 'Seeing the bigger picture and connecting today\'s work to where you are going.',
      actions: [
        'Block sixty minutes this week, away from email, to answer one question: what will matter most for us twelve months from now?',
        'Look at your calendar from last week. Mark each item as urgent or important. Move one urgent item off next week.',
        'Ask a leader one level above you what they worry about most. Write down how your work connects to it.'
      ]
    }
  ],
  questions: [
    { dim: 'selfLeadership', text: 'I keep the commitments I make to myself, even when no one is watching.' },
    { dim: 'selfLeadership', text: 'I stay calm and clear-headed under pressure.' },
    { dim: 'selfLeadership', text: 'My energy and mood often decide how productive my day is.', reverse: true },
    { dim: 'selfLeadership', text: 'I have daily habits that keep me focused on what matters most.' },

    { dim: 'communication', text: 'People leave conversations with me knowing exactly what I need from them.' },
    { dim: 'communication', text: 'I listen to understand, not just to respond.' },
    { dim: 'communication', text: 'I tend to avoid difficult conversations as long as I can.', reverse: true },
    { dim: 'communication', text: 'I can explain complex ideas simply.' },

    { dim: 'decisionMaking', text: 'I make important decisions in a reasonable amount of time.' },
    { dim: 'decisionMaking', text: 'I take ownership of my decisions, including the ones that do not work out.' },
    { dim: 'decisionMaking', text: 'I often wait for more information long after I have enough to decide.', reverse: true },
    { dim: 'decisionMaking', text: 'I weigh both short-term and long-term effects before I decide.' },

    { dim: 'developingOthers', text: 'I regularly invest time in helping others grow.' },
    { dim: 'developingOthers', text: 'I give honest, specific feedback, not just general encouragement.' },
    { dim: 'developingOthers', text: 'It is usually faster to do things myself than to teach someone else.', reverse: true },
    { dim: 'developingOthers', text: 'At least one person I work with could step into my role someday because of my investment in them.' },

    { dim: 'strategicThinking', text: 'I set aside time to think about the future, not just manage the present.' },
    { dim: 'strategicThinking', text: 'I understand how my work connects to the bigger goals of my organization.' },
    { dim: 'strategicThinking', text: 'Most of my week is spent reacting to whatever is most urgent.', reverse: true },
    { dim: 'strategicThinking', text: 'I can see problems and opportunities coming before they arrive.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Building the Foundation',
      summary: 'You have real leadership potential, and this is the season to build the base that will hold it. The next level starts with leading yourself well and making a few key skills consistent. Focus on your lowest area first, and progress will come faster than you expect.'
    },
    {
      min: 50,
      label: 'Ready to Stretch',
      summary: 'You already lead well in several areas, and people likely see it. A few gaps are keeping you from being fully ready for more responsibility. Close the one or two that matter most, and you will be leading at the next level with clarity instead of hoping you are ready.'
    },
    {
      min: 75,
      label: 'Next-Level Ready',
      summary: 'You lead with discipline, clarity, and intention. You are ready for more, and others are probably already counting on you for it. Your growth now is about multiplying: developing leaders, not just leading well yourself.'
    }
  ],
  related: ['leadership-style', 'delegation-audit', 'limiting-beliefs'],
  cta: { label: 'Book a free Alignment Audit', href: '/book-a-call' }
};
