// The Team Alignment Assessment: for leaders, about their team.
export default {
  slug: 'team-alignment',
  title: 'The Team Alignment Assessment',
  category: 'team',
  mode: 'score',
  minutes: 5,
  hook: 'Is your team rowing in the same direction?',
  short: 'See how aligned your team really is across vision, roles, trust, accountability, communication, and engagement.',
  intro: 'Eighteen statements about the team you lead. Answer for how the team actually works today, not how it looks on the org chart.',
  dimensions: [
    {
      key: 'sharedVision',
      label: 'Shared Vision',
      desc: 'Everyone knows where the team is going and why it matters.',
      actions: [
        'Ask each team member this week to write the team\'s top goal in one sentence. Compare the answers in your next meeting.',
        'Open your next team meeting by connecting one current project to the bigger purpose behind it.',
        'Write the team\'s three priorities for the next 90 days and post them where everyone sees them daily.'
      ]
    },
    {
      key: 'roleClarity',
      label: 'Clarity of Roles',
      desc: 'Each person knows what they own and what they do not.',
      actions: [
        'List your team\'s five most important outcomes. Next to each, write one owner. Share the list and fix any gaps or overlaps.',
        'Ask each person: what do you think you are responsible for that no one has told you directly? Clarify each answer.',
        'Pick one recurring task that falls through the cracks and assign it a single owner by Friday.'
      ]
    },
    {
      key: 'trust',
      label: 'Trust',
      desc: 'People feel safe to speak up, disagree, and admit mistakes.',
      actions: [
        'Share one mistake you made recently with your team and what you learned. Go first so others can follow.',
        'In your next meeting, ask: what is one thing we are not saying out loud? Thank whoever answers, whatever they say.',
        'Have one honest one-on-one this week where you ask: what would make it easier for you to tell me hard things?'
      ]
    },
    {
      key: 'accountability',
      label: 'Accountability',
      desc: 'Commitments are kept, and the team holds a shared standard.',
      actions: [
        'End every meeting this week by reading back each commitment: who, what, and by when.',
        'Address one missed commitment directly and privately within 24 hours, with curiosity first and clarity second.',
        'Start a simple weekly scorecard of three numbers the team owns. Review it together every Friday.'
      ]
    },
    {
      key: 'communication',
      label: 'Communication',
      desc: 'Information flows clearly, and the right people know what they need to know.',
      actions: [
        'Send a short Friday update to your team: what we finished, what is next, what is blocked.',
        'Ask your team which meeting is least useful. Shorten it, change it, or cancel it this week.',
        'After your next decision, tell the team what you decided, why, and what it means for them, all in one message.'
      ]
    },
    {
      key: 'engagement',
      label: 'Engagement',
      desc: 'People bring energy and ownership, not just effort.',
      actions: [
        'Ask each person this week: what part of your work gives you the most energy? Look for one way to give them more of it.',
        'Recognize one specific contribution publicly in your next team meeting.',
        'Invite the team to solve one real problem you would normally solve alone. Use their best idea.'
      ]
    }
  ],
  questions: [
    { dim: 'sharedVision', text: 'Every person on my team could describe where we are headed in the same words.' },
    { dim: 'sharedVision', text: 'My team understands why our work matters, not just what to do.' },
    { dim: 'sharedVision', text: 'Different people on my team seem to be working toward different goals.', reverse: true },

    { dim: 'roleClarity', text: 'Everyone on my team knows exactly what they are responsible for.' },
    { dim: 'roleClarity', text: 'Important tasks regularly fall through the cracks because no one owns them.', reverse: true },
    { dim: 'roleClarity', text: 'My team members understand how their roles connect to each other.' },

    { dim: 'trust', text: 'People on my team feel safe disagreeing with me.' },
    { dim: 'trust', text: 'Team members admit mistakes openly instead of hiding them.' },
    { dim: 'trust', text: 'Real concerns are usually discussed after the meeting, not in it.', reverse: true },

    { dim: 'accountability', text: 'When someone on my team commits to something, it gets done.' },
    { dim: 'accountability', text: 'Team members hold each other accountable, not only through me.' },
    { dim: 'accountability', text: 'Missed deadlines are addressed quickly and directly.' },

    { dim: 'communication', text: 'Important information reaches the right people at the right time.' },
    { dim: 'communication', text: 'Our meetings end with clear decisions and next steps.' },
    { dim: 'communication', text: 'People on my team are often surprised by decisions that affect them.', reverse: true },

    { dim: 'engagement', text: 'My team brings ideas and energy, not just completed tasks.' },
    { dim: 'engagement', text: 'People on my team take ownership of results without being told.' },
    { dim: 'engagement', text: 'Most of my team is doing what is required and not much more.', reverse: true }
  ],
  bands: [
    {
      min: 0,
      label: 'Pulling Apart',
      summary: 'Your team has good people, but they are not yet moving as one. Effort is getting lost in unclear goals, roles, or conversations. That is a leadership opportunity, not a verdict on your team. Start with clarity on the vision and one owner per outcome, and alignment will build from there.'
    },
    {
      min: 50,
      label: 'Moving Together',
      summary: 'Your team works well in several areas, and the foundation is real. A few gaps are creating friction that costs time and energy. Close the lowest one and the team will feel the difference within weeks.'
    },
    {
      min: 75,
      label: 'Fully Aligned',
      summary: 'Your team shares a clear direction, trusts one another, and holds a high standard together. That is rare and worth protecting. Your next step is to keep alignment strong as the team grows and to develop leaders within it.'
    }
  ],
  related: ['delegation-audit', 'leadership-style', 'leadership-readiness'],
  cta: { label: 'Request a free Alignment Audit for your team', href: '/corporate#audit' }
};
