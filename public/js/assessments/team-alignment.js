// The Team Alignment Assessment: for leaders, about their team.
export default {
  slug: 'team-alignment',
  title: 'The Team Alignment Assessment',
  category: 'team',
  mode: 'score',
  minutes: 6,
  hook: 'Is your team rowing in the same direction?',
  short: 'See how aligned your team really is across vision, roles, trust, accountability, communication, and engagement.',
  intro: 'Twenty-four statements about the team you lead. Answer for how the team actually works today, not how it looks on the org chart.',
  dimensions: [
    {
      key: 'sharedVision',
      label: 'Shared Vision',
      desc: 'Everyone knows where the team is going and why it matters.',
      why: 'A team that is not headed to the same place will work hard in different directions. Shared vision turns individual effort into collective progress.',
      levels: {
        low: 'Your team is likely working hard, but not toward the same picture of success. Different people may be chasing different goals, and priorities shift depending on who you ask. That is a clarity gap, not a people problem, and naming one shared goal in plain words is where alignment starts.',
        mid: 'Your team understands the general direction, but the details get fuzzy as you move further from the leadership table. People know what to do more than why it matters. Repeating the why every week, in the same words, will close that gap.',
        high: 'Your team knows where it is going and why it matters, and people describe it in similar words. That shared picture makes decisions faster and work more meaningful. Keep reinforcing it, especially when new people join or priorities shift.'
      },
      reflect: 'If I asked five people on my team to name our top goal, how many different answers would I get?',
      leverage: 'Use your shared vision to show the team why your weakest area matters. When people see the link to the goal, they are more willing to work on it.',
      actions: [
        "Ask each team member this week to write the team's top goal in one sentence. Compare the answers out loud in your next meeting and agree on one version.",
        'Open your next team meeting by connecting one current project to the bigger purpose behind it, in under two minutes.',
        "By Friday, write the team's three priorities for the next 90 days and post them where everyone sees them daily."
      ]
    },
    {
      key: 'roleClarity',
      label: 'Clarity of Roles',
      desc: 'Each person knows what they own and what they do not.',
      why: 'When everyone owns something, no one does. Clear roles prevent dropped balls, duplicated work and quiet resentment.',
      levels: {
        low: 'On your team, important work is likely slipping through the cracks or being done twice. People may be unsure where their job ends and someone else begins. Giving every key outcome one clear owner will remove a surprising amount of friction.',
        mid: 'Most people know their core responsibilities, but the edges are blurry. Handoffs and shared tasks are where things get dropped. Clarifying ownership at those edges will make the whole team move more smoothly.',
        high: 'Everyone on your team knows what they own and how their role connects to others. That clarity lets people act with confidence. Revisit roles whenever the team grows or priorities shift, so the clarity keeps pace with the change.'
      },
      reflect: 'Which important outcome on my team has more than one owner, or none at all?',
      leverage: 'Use your role clarity to assign one clear owner for improving your weakest area. A named owner turns a shared concern into a real plan.',
      actions: [
        "This week, list your team's five most important outcomes. Next to each, write one owner. Share the list by Friday and fix any gaps or overlaps.",
        'In your next round of one-on-ones, ask each person: what do you think you are responsible for that no one has told you directly? Clarify each answer in writing.',
        'Pick one recurring task that falls through the cracks and assign it a single owner by Friday.'
      ]
    },
    {
      key: 'trust',
      label: 'Trust',
      desc: 'People feel safe to speak up, disagree, and admit mistakes.',
      why: 'Without trust, problems go underground and the best ideas never get said. Trust is what makes honest conversation and fast learning possible.',
      levels: {
        low: 'On your team, people may be holding back: agreeing in meetings and disagreeing afterward, or hiding mistakes instead of surfacing them. That is usually a learned response, not bad intent. As the leader, going first with your own honesty is the fastest way to change it.',
        mid: 'People on your team speak up some of the time, usually when the topic feels safe. The harder conversations still happen in hallways instead of in the room. Rewarding honest disagreement when you hear it will teach the team that it is welcome.',
        high: 'People on your team feel safe to disagree, admit mistakes and raise real concerns. That openness is rare, and it makes your team smarter and faster. Protect it by staying curious when you hear something you do not like.'
      },
      reflect: 'What is my team not telling me, and what have I done that makes it hard for them to say it?',
      leverage: 'Use the trust on your team to talk openly about your weakest area. Ask the team what they see and what they would change.',
      actions: [
        'In your next team meeting, share one mistake you made recently and what you learned. Go first so others can follow.',
        'Within the next two weeks, ask in a meeting: what is one thing we are not saying out loud? Thank whoever answers, whatever they say.',
        'Have one honest one-on-one this week where you ask: what would make it easier for you to tell me hard things? Write down the answer and act on one part of it.'
      ]
    },
    {
      key: 'accountability',
      label: 'Accountability',
      desc: 'Commitments are kept, and the team holds a shared standard.',
      why: 'Commitments without follow-through slowly teach a team that deadlines are optional. Accountability is how a team keeps its word to itself.',
      levels: {
        low: 'On your team, commitments may slip without much consequence, and you may be the only one who notices. That is draining and it lowers the standard over time. Clear commitments at the end of each meeting and quick, kind follow-up will start to reset the bar.',
        mid: 'Most commitments get kept, and the ones that slip are usually addressed eventually. Accountability still flows mostly through you rather than between teammates. Making progress visible to everyone will help the team hold each other to the standard.',
        high: 'Your team keeps its commitments and holds each other to a shared standard. Missed deadlines get addressed quickly and directly. Keep the standard high and the tone respectful, so accountability feels like support rather than pressure.'
      },
      reflect: 'Which missed commitment have I let slide, and what message is that sending to the rest of the team?',
      leverage: 'Bring your team\'s follow-through to your weakest area. Set one clear commitment there with a date and review it together.',
      actions: [
        'End every meeting this week by reading back each commitment out loud: who, what, and by when.',
        'Address one missed commitment directly and privately within 24 hours, with curiosity first and clarity second.',
        'Start a simple weekly scorecard of three numbers the team owns this week. Review it together every Friday for the next month.'
      ]
    },
    {
      key: 'communication',
      label: 'Communication',
      desc: 'Information flows clearly, and the right people know what they need to know.',
      why: 'Most team friction is not about bad intent, it is about missing information. Clear communication keeps people from guessing, and guessing is expensive.',
      levels: {
        low: 'Information on your team is not reaching people when they need it, so decisions catch people off guard and meetings end without clear next steps. That creates rework and frustration. A simple weekly update and clear meeting wrap-ups will make a quick difference.',
        mid: 'Communication works in the core of your team and breaks down at the edges. Some people are in the loop and others find out late. A consistent rhythm, such as a short weekly update, will make sure the whole team hears the same thing.',
        high: 'Information flows well on your team. Meetings end with decisions and people rarely get surprised. Keep checking that your communication rhythm still fits as the team and the work change.'
      },
      reflect: 'Who on my team found out about something important later than they should have this month?',
      leverage: 'Use your clear communication to share a plan for your weakest area with the whole team. When everyone hears the same plan, it is easier to follow.',
      actions: [
        'Every Friday for the next four weeks, send a short update to your team: what we finished, what is next, what is blocked.',
        'Ask your team this week which meeting is least useful. Shorten it, change it, or cancel it before the next one is due.',
        'After your next decision, tell the team what you decided, why, and what it means for them, all in one message sent the same day.'
      ]
    },
    {
      key: 'engagement',
      label: 'Engagement',
      desc: 'People bring energy and ownership, not just effort.',
      why: 'A team that only does what is asked will never surprise you. Engagement is the difference between compliance and commitment.',
      levels: {
        low: 'Your team is likely doing what is required, but not much more, and new ideas are rare. That is often a sign that people do not feel heard or do not see how their work matters. Asking for their input on real problems, and using it, is the fastest way to bring energy back.',
        mid: 'Some people on your team bring real energy and ownership, and others are mostly showing up. The difference is often in how connected they feel to the work and to you. Learning what energizes each person will help you bring more of the team along.',
        high: 'Your team brings ideas, energy and ownership without being pushed. People care about results, not just tasks. Keep recognizing that effort specifically, and keep giving people real problems to solve.'
      },
      reflect: 'When did someone on my team last bring me an idea I did not ask for, and how did I respond?',
      leverage: 'Use your team\'s energy to tackle your weakest area together. Invite them to own one improvement there and give them room to run with it.',
      actions: [
        'Ask each person this week: what part of your work gives you the most energy? Within a month, give each of them more of it in one concrete way.',
        'Recognize one specific contribution publicly in your next team meeting. Name what they did and why it mattered.',
        'Within two weeks, invite the team to solve one real problem you would normally solve alone. Use their best idea and tell them you did.'
      ]
    }
  ],
  questions: [
    { dim: 'sharedVision', text: 'Every person on my team could describe where we are headed in the same words.' },
    { dim: 'sharedVision', text: 'My team understands why our work matters, not just what to do.' },
    { dim: 'sharedVision', text: 'Different people on my team seem to be working toward different goals.', reverse: true },
    { dim: 'sharedVision', text: 'When priorities change, the team quickly understands the new direction.' },

    { dim: 'roleClarity', text: 'Everyone on my team knows exactly what they are responsible for.' },
    { dim: 'roleClarity', text: 'Important tasks regularly fall through the cracks because no one owns them.', reverse: true },
    { dim: 'roleClarity', text: 'My team members understand how their roles connect to each other.' },
    { dim: 'roleClarity', text: 'People on my team rarely step on each other or duplicate work.' },

    { dim: 'trust', text: 'People on my team feel safe disagreeing with me.' },
    { dim: 'trust', text: 'Team members admit mistakes openly instead of hiding them.' },
    { dim: 'trust', text: 'Real concerns are usually discussed after the meeting, not in it.', reverse: true },
    { dim: 'trust', text: 'Team members ask each other for help without hesitation.' },

    { dim: 'accountability', text: 'When someone on my team commits to something, it gets done.' },
    { dim: 'accountability', text: 'Team members hold each other accountable, not only through me.' },
    { dim: 'accountability', text: 'Missed deadlines are addressed quickly and directly.' },
    { dim: 'accountability', text: 'Some people on my team regularly miss commitments without real consequences.', reverse: true },

    { dim: 'communication', text: 'Important information reaches the right people at the right time.' },
    { dim: 'communication', text: 'Our meetings end with clear decisions and next steps.' },
    { dim: 'communication', text: 'People on my team are often surprised by decisions that affect them.', reverse: true },
    { dim: 'communication', text: 'Team members share updates with each other without being asked.' },

    { dim: 'engagement', text: 'My team brings ideas and energy, not just completed tasks.' },
    { dim: 'engagement', text: 'People on my team take ownership of results without being told.' },
    { dim: 'engagement', text: 'Most of my team is doing what is required and not much more.', reverse: true },
    { dim: 'engagement', text: 'People on my team speak about our work with pride.' }
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
