// The Delegation Audit: are you the bottleneck in your own organization?
export default {
  slug: 'delegation-audit',
  title: 'The Delegation Audit',
  category: 'leader',
  mode: 'score',
  minutes: 4,
  hook: 'Are you the bottleneck?',
  short: 'Find out whether your team is growing around you or waiting on you, across trust, systems, letting go, capability, and focus.',
  intro: 'Eighteen statements about how work moves through you. Answer for a typical week, not your best one.',
  dimensions: [
    {
      key: 'trust',
      label: 'Trust',
      desc: 'Believing your people can deliver, and giving them room to prove it.',
      actions: [
        'Pick one person and give them full ownership of an outcome this week. Agree on the result, not the method.',
        'The next time someone brings you work, ask "what do you recommend?" before you give your answer.',
        'Skip one check-in you would normally make on a task you have delegated. Wait for them to report back.'
      ]
    },
    {
      key: 'systems',
      label: 'Systems',
      desc: 'Having processes in place so work does not depend on your memory or presence.',
      actions: [
        'Write down the one task you explain over and over. Record a ten-minute walkthrough of it this week.',
        'Create a simple checklist for one recurring task and hand it to someone with the checklist attached.',
        'List the decisions that only you can make right now. Choose one and write the rule someone else could use to make it.'
      ]
    },
    {
      key: 'lettingGo',
      label: 'Letting Go',
      desc: 'Releasing control of how things get done, as long as they get done well.',
      actions: [
        'Write down three tasks you do because "no one does it like me." Hand off one this week, and accept 80 percent as good enough.',
        'When you see delegated work done differently than you would, ask one question before you change anything.',
        'Notice every time you take a task back this week. Write down why. Look for the pattern on Friday.'
      ]
    },
    {
      key: 'teamCapability',
      label: 'Team Capability',
      desc: 'Building a team that is equipped to carry more than it does today.',
      actions: [
        'Ask each person on your team: what is one thing you could own that I am still doing? Write down every answer.',
        'Choose one skill gap on your team and schedule thirty minutes this week to teach it or pay for someone to.',
        'Identify the person who could replace you in one key area. Tell them, and give them their first piece of it.'
      ]
    },
    {
      key: 'highValueWork',
      label: 'High-Value Work',
      desc: 'Spending your time on the work only you can do.',
      actions: [
        'Track your time for three days. Circle the tasks only you can do. Everything else is a delegation candidate.',
        'Block two hours this week for your most important, non-urgent work. Protect it like a client meeting.',
        'Remove yourself from one recurring meeting where your presence is not required, and ask for notes instead.'
      ]
    }
  ],
  questions: [
    { dim: 'trust', text: 'I trust my team to make good decisions without me in the room.' },
    { dim: 'trust', text: 'I check in on delegated work more often than I need to.', reverse: true },
    { dim: 'trust', text: 'When I hand off a task, I give people real authority, not just responsibility.' },

    { dim: 'systems', text: 'Our key processes are written down, not just in my head.' },
    { dim: 'systems', text: 'If I were unreachable for a week, the work would keep moving.' },
    { dim: 'systems', text: 'People regularly have to wait on me before they can move forward.', reverse: true },
    { dim: 'systems', text: 'New people can learn how we work without me training them personally.' },

    { dim: 'lettingGo', text: 'I am comfortable when others do things differently than I would, as long as the result is good.' },
    { dim: 'lettingGo', text: 'I often redo work others have done because it is not quite how I want it.', reverse: true },
    { dim: 'lettingGo', text: 'I hand off tasks early, before they become urgent.' },
    { dim: 'lettingGo', text: 'I hold on to tasks because it is faster to do them myself.', reverse: true },

    { dim: 'teamCapability', text: 'My team has the skills to take on more than they do now.' },
    { dim: 'teamCapability', text: 'I invest time in training people so they can handle more responsibility.' },
    { dim: 'teamCapability', text: 'At least one person could step into a key part of my role today.' },

    { dim: 'highValueWork', text: 'Most of my week is spent on work that only I can do.' },
    { dim: 'highValueWork', text: 'I have regular, protected time for strategy and planning.' },
    { dim: 'highValueWork', text: 'I spend a lot of my day on tasks someone else could handle.', reverse: true },
    { dim: 'highValueWork', text: 'My calendar reflects my role as a leader, not just a doer.' }
  ],
  bands: [
    {
      min: 0,
      label: 'The Bottleneck',
      summary: 'Right now a lot of the work flows through you, and that is limiting both you and your team. That is not a character flaw. It usually means you grew faster than your systems did. A few deliberate handoffs will free up your time and grow your people at the same time.'
    },
    {
      min: 50,
      label: 'The Gatekeeper',
      summary: 'You delegate, but you still hold on to more than you need to. Your team is capable of carrying more, and you are capable of leading at a higher level. Letting go of one or two key areas will create real momentum for both.'
    },
    {
      min: 75,
      label: 'The Multiplier',
      summary: 'You lead through people, not around them. Your team carries real ownership, and your time is focused on the work only you can do. Keep raising the bar on who you are developing so the next level of growth has leaders ready for it.'
    }
  ],
  related: ['leadership-readiness', 'team-alignment', 'burnout-check'],
  cta: { label: 'Book a free Alignment Audit', href: '/book-a-call' }
};
