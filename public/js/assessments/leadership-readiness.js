// Leadership Readiness: are you ready to lead at the next level?
export default {
  slug: 'leadership-readiness',
  title: 'Leadership Readiness Assessment',
  category: 'leader',
  mode: 'score',
  minutes: 7,
  hook: 'Ready for the next level, or just ready for the title?',
  short: 'Measure how prepared you are to lead at the next level across self-leadership, communication, decisions, developing others, and strategy.',
  intro: 'Twenty-five statements about how you lead today. Answer honestly. The goal is clarity on where to grow, not a grade.',
  dimensions: [
    {
      key: 'selfLeadership',
      label: 'Self-Leadership',
      desc: 'Leading yourself with discipline and consistency before you lead anyone else.',
      why: 'People follow what you do long before they follow what you say. If you cannot lead yourself on a hard day, a bigger title only makes the gap more visible.',
      levels: {
        low: 'Right now your day often leads you more than you lead it. Mood, energy and other people set the agenda, and the commitments you make to yourself are the first to go. That is common under pressure, and it is the best place to start, because small promises kept rebuild trust with yourself quickly.',
        mid: 'You lead yourself well when life is calm and slip when it gets loud. The habits are there, but they bend under stress. Your growth is in making two or three of them non-negotiable so they hold on your hardest weeks.',
        high: 'You are steady, disciplined and consistent, even when no one is watching. People feel that calm and borrow from it. Protect the habits that got you here, because the next level will test them more than this one did.'
      },
      reflect: 'What is one promise I keep making to myself and breaking, and what does that cost my leadership?',
      leverage: 'Use your discipline to build a small daily rep in your weakest area. Fifteen minutes on the same thing every day will move it faster than one big push.',
      actions: [
        'Write down the three commitments you most often break to yourself. Pick one and keep it every day for the next seven days, checking it off on paper each night.',
        'For the next two weeks, plan tomorrow before you end today: write three priorities on paper before you close your laptop.',
        'Notice the moment you feel most reactive this week. Within an hour, write down what triggered it and what you would do differently next time.'
      ]
    },
    {
      key: 'communication',
      label: 'Communication',
      desc: 'Saying what matters clearly, listening fully, and handling hard conversations well.',
      why: 'Every result a leader gets passes through a conversation first. Unclear words create rework, and avoided conversations create problems that grow in the dark.',
      levels: {
        low: 'People may leave your conversations unsure of what you need, or the hard conversations may be waiting on your list for weeks. That is usually a sign of care or caution, not a lack of ability. Start with one clear sentence before every important conversation and the rest becomes easier.',
        mid: 'You communicate well in everyday settings and lose clarity when the stakes or emotions rise. You may soften the message until the point gets lost. Writing your key sentence in advance will help you stay kind and clear at the same time.',
        high: 'You say what matters clearly and people know where they stand with you. You listen well and you do not run from hard conversations. Your next level is helping others on your team communicate the same way.'
      },
      reflect: 'Which conversation am I avoiding right now, and what is the one sentence that needs to be said?',
      leverage: 'Use your communication strength to name your weakest area out loud to someone you trust. Saying it clearly is the first step to getting help with it.',
      actions: [
        'Before your next important meeting, write the one sentence you want people to remember on a card. Say it in the first two minutes.',
        'In one conversation this week, listen without interrupting and summarize what you heard in your own words before you respond.',
        'Name one hard conversation you have postponed. Put it on your calendar for this week and write your opening line in advance.'
      ]
    },
    {
      key: 'decisionMaking',
      label: 'Decision Making',
      desc: 'Making sound, timely decisions and owning the results.',
      why: 'A slow decision is often a decision to let the situation decide for you. Your team moves at the speed of your decisions.',
      levels: {
        low: 'Decisions may be stacking up on your desk while you wait for certainty that will not come. That delay quietly slows everyone who depends on you. The fix is not being braver. It is setting a deadline for each decision and deciding with what you know on that date.',
        mid: 'You make most decisions well, but the big or uncomfortable ones tend to linger. You may gather information long after you have enough. Giving each major decision a date and a written reason will tighten your timing and your judgment.',
        high: 'You decide in a reasonable time, you think about both the short and long term, and you own the outcome. People trust your calls. Your growth is in teaching others how you decide so fewer decisions need to come to you.'
      },
      reflect: 'What decision have I been calling "not ready yet" that I already know the answer to?',
      leverage: 'Bring your decisiveness to your weakest area. Make one clear decision about it this week, even a small one, and act on it within 48 hours.',
      actions: [
        'List every decision currently waiting on you. Make the two oldest ones by Friday and tell the people affected the same day.',
        'For your next big decision, write down what you expect to happen and why. Set a calendar reminder for 30 days later and compare.',
        'Set a deadline for one decision you have been circling and tell someone else the date today.'
      ]
    },
    {
      key: 'developingOthers',
      label: 'Developing Others',
      desc: 'Multiplying your impact by growing the people around you.',
      why: 'At the next level, your success is measured by what your people can do without you. Developing others is how your impact grows past your own hours.',
      levels: {
        low: 'Right now it probably feels faster to do things yourself, and in the short run it is. The cost is a team that waits on you and a ceiling on how far you can grow. Start with one person and one skill, and invest thirty minutes a week.',
        mid: 'You invest in people when you have room, and they likely appreciate it. The development tends to stop when things get busy, which is exactly when people need it. Make one short growth conversation a fixed part of your week.',
        high: 'You grow people on purpose, with honest feedback and real opportunities. Others are becoming leaders because of you. Your next step is building a bench: someone who could step into your role so you are free to step into the next one.'
      },
      reflect: 'If I were promoted tomorrow, who would be ready to take my place, and what have I done to prepare them?',
      leverage: 'Ask someone you have developed to help you in your weakest area. Letting them teach you builds their confidence and your skill at the same time.',
      actions: [
        'Pick one person you lead or influence. Ask them this week: what skill would change your next year? Help them take a first step on it within seven days.',
        'Give one piece of specific, useful feedback each day this week, positive or corrective, within an hour of seeing the moment.',
        'Choose one meeting or task you usually handle and hand it to someone else this week. Walk them through it once, then let them run it for the next month.'
      ]
    },
    {
      key: 'strategicThinking',
      label: 'Strategic Thinking',
      desc: "Seeing the bigger picture and connecting today's work to where you are going.",
      why: 'The higher you lead, the more your value comes from seeing around corners. Strategy is what keeps hard work pointed at the right target.',
      levels: {
        low: 'Most of your week is spent reacting, and the urgent keeps crowding out the important. That is not a lack of vision. It is a lack of protected time to think. One hour a week away from email will change how you see your work.',
        mid: 'You understand the bigger picture and you think about it when you can. The challenge is turning that thinking into choices about what you stop doing. Strategy shows up in what you say no to, so start there.',
        high: 'You see problems and opportunities early and you connect daily work to long-term goals. That makes you valuable well beyond your current role. Your growth is in sharing that thinking so your team can make strategic choices without you.'
      },
      reflect: 'What will matter most twelve months from now that I am giving almost no time to today?',
      leverage: 'Use your big-picture view to explain why your weakest area matters for where you are going. When you can see the connection, the work there gets easier to start.',
      actions: [
        'Block sixty minutes this week, away from email, to answer one question in writing: what will matter most for us twelve months from now?',
        'Look at your calendar from last week. Mark each item as urgent or important. Remove or delegate one urgent item from next week before Monday.',
        'Within the next two weeks, ask a leader one level above you what they worry about most. Write down how your work connects to it.'
      ]
    }
  ],
  questions: [
    { dim: 'selfLeadership', text: 'I keep the commitments I make to myself, even when no one is watching.' },
    { dim: 'selfLeadership', text: 'I stay calm and clear-headed under pressure.' },
    { dim: 'selfLeadership', text: 'My energy and mood often decide how productive my day is.', reverse: true },
    { dim: 'selfLeadership', text: 'I have daily habits that keep me focused on what matters most.' },
    { dim: 'selfLeadership', text: 'I regularly take honest stock of my own strengths and weaknesses.' },

    { dim: 'communication', text: 'People leave conversations with me knowing exactly what I need from them.' },
    { dim: 'communication', text: 'I listen to understand, not just to respond.' },
    { dim: 'communication', text: 'I tend to avoid difficult conversations as long as I can.', reverse: true },
    { dim: 'communication', text: 'I can explain complex ideas simply.' },
    { dim: 'communication', text: 'When I give hard news, I am honest without being harsh.' },

    { dim: 'decisionMaking', text: 'I make important decisions in a reasonable amount of time.' },
    { dim: 'decisionMaking', text: 'I take ownership of my decisions, including the ones that do not work out.' },
    { dim: 'decisionMaking', text: 'I often wait for more information long after I have enough to decide.', reverse: true },
    { dim: 'decisionMaking', text: 'I weigh both short-term and long-term effects before I decide.' },
    { dim: 'decisionMaking', text: 'I second-guess my decisions so much that others notice.', reverse: true },

    { dim: 'developingOthers', text: 'I regularly invest time in helping others grow.' },
    { dim: 'developingOthers', text: 'I give honest, specific feedback, not just general encouragement.' },
    { dim: 'developingOthers', text: 'It is usually faster to do things myself than to teach someone else.', reverse: true },
    { dim: 'developingOthers', text: 'At least one person I work with could step into my role someday because of my investment in them.' },
    { dim: 'developingOthers', text: 'I give people real responsibility, not just tasks, so they can stretch.' },

    { dim: 'strategicThinking', text: 'I set aside time to think about the future, not just manage the present.' },
    { dim: 'strategicThinking', text: 'I understand how my work connects to the bigger goals of my organization.' },
    { dim: 'strategicThinking', text: 'Most of my week is spent reacting to whatever is most urgent.', reverse: true },
    { dim: 'strategicThinking', text: 'I can see problems and opportunities coming before they arrive.' },
    { dim: 'strategicThinking', text: 'I regularly stop doing things that no longer serve our bigger goals.' }
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
