// The Alignment Assessment: the front door to the free Alignment Audit.
// A leader scores their organization on the same six areas the audit rates
// on the one-page Alignment Scorecard (scorecard-core.js takes its areas
// from team-alignment.js, and the tests keep these keys identical), then
// books the audit from the result.
export default {
  slug: 'alignment-assessment',
  title: 'The Alignment Assessment',
  category: 'team',
  mode: 'score',
  minutes: 4,
  hook: 'Successful on paper. Is your team actually aligned?',
  short: 'A short diagnostic for leaders. Score your organization on the six areas the Alignment Audit measures and see exactly where the gap is.',
  intro: 'Answer for how your team actually works today, not how it looks on the org chart. Your answers show where your organization is aligned, where it is drifting, and what to focus on first.',
  dimensions: [
    {
      key: 'sharedVision',
      label: 'Shared Vision',
      desc: 'Your people are pulling toward the same outcome, for the same reasons.',
      why: 'A team can hit its numbers and still be headed in five directions. When the destination is not shared, every gain costs more effort than it should and every setback splits the room.',
      levels: {
        low: 'Your organization may be producing, but not toward one picture of success. Ask five people what winning looks like this year and you would likely hear five answers. That is the most common gap in teams that look strong on paper, and it is fixed with clarity, not pressure.',
        mid: 'The direction is clear at the top and gets softer as it moves through the organization. People know the goal; fewer can tell you why it matters to them. Closing that gap is mostly repetition: the same why, in the same words, from every leader.',
        high: 'Your people describe the destination in similar words and connect their own work to it. That makes decisions faster and conflict cleaner. Protect it by retelling the vision every time the team grows or the plan shifts.'
      },
      reflect: 'If I asked five people on my team what winning looks like this year, how many different answers would I hear?',
      leverage: 'Use the shared direction you have built to rally the team around your weakest area. Frame fixing it as part of where you are already going, not as a new initiative.',
      actions: [
        'Write the one outcome that matters most this year in a single sentence a new hire could repeat. Share it with your leaders this week.',
        'Open your next team meeting by asking three people to say, in their own words, where the team is headed. Note where the answers differ.',
        'Before approving any new project this month, ask one question out loud: how does this move us toward the outcome we named?'
      ]
    },
    {
      key: 'roleClarity',
      label: 'Clarity of Roles',
      desc: 'Every important outcome has one clear owner.',
      why: 'Busy teams lose more time to unclear ownership than to a lack of effort. When two people own something, it gets argued over. When no one owns it, it quietly dies.',
      levels: {
        low: 'Work is likely getting dropped or done twice. Good people are waiting on each other, or redoing what someone else already started. This drains energy fast, and it is one of the quickest gaps to close once ownership is written down.',
        mid: 'Core jobs are clear, but handoffs are not. The friction lives where one role ends and the next begins. Naming an owner for each handoff will remove a lot of the noise.',
        high: 'People know what they own and where their lane meets someone else. That frees them to act without checking in on everything. Revisit ownership whenever roles change so it stays this clean.'
      },
      reflect: 'Which outcome on my team has two owners, or none?',
      leverage: 'Give your weakest area one named owner and a date. Your team already respects ownership, so use it.',
      actions: [
        'List the five outcomes your team is measured on. Write one owner next to each and share the list by Friday.',
        'Find the handoff that causes the most friction and agree in writing who owns it from start to finish.',
        'Ask each direct report: what are you doing that you were never formally asked to own? Decide which of those to keep, move or drop.'
      ]
    },
    {
      key: 'trust',
      label: 'Trust',
      desc: 'People tell the truth in the room, not after it.',
      why: 'Misalignment hides wherever people do not feel safe naming it. Every other area depends on whether the real problems get said out loud.',
      levels: {
        low: 'The real conversation is likely happening after the meeting. People nod in the room and disagree in the hallway, which means decisions are being made without the full picture. The fix starts with how you respond the next time someone tells you something you do not want to hear.',
        mid: 'People are candid on safe topics and careful on hard ones. The issues that matter most are the ones least likely to reach you directly. Making it clearly safe to disagree, starting with you, will bring them to the surface.',
        high: 'Your people raise problems early and disagree openly. That gives you an honest read on the organization, which most leaders never get. Keep it by thanking people for bad news as quickly as good news.'
      },
      reflect: 'What conversation is my team having about this place that they are not having with me?',
      leverage: 'Use the trust you have built to ask the team directly what is holding your weakest area back. They will tell you.',
      actions: [
        'In your next meeting, ask: what is one thing we keep avoiding talking about? Wait through the silence.',
        'The next time someone brings you a problem, thank them before you respond to the problem itself.',
        'Share one mistake you made this month, and what you learned from it, in front of the team.'
      ]
    },
    {
      key: 'accountability',
      label: 'Accountability',
      desc: 'Commitments are kept, and missed ones are addressed.',
      why: 'Without accountability, alignment is just agreement. The real standard on a team is set by what the leader allows to slide, not by what the leader announces.',
      levels: {
        low: 'Commitments are likely being missed without a clear conversation. Over time the people who deliver carry the people who do not, and your best performers notice. Raising the standard starts with one direct, respectful conversation you have been putting off.',
        mid: 'Accountability runs mostly through you. Things get done when you follow up and drift when you do not. The next level is a team that holds each other to the standard without waiting on you.',
        high: 'People do what they say, and they address it with each other when they do not. That standard is a competitive advantage. Protect it by addressing slippage early, even from strong performers.'
      },
      reflect: 'What am I tolerating on my team that I would not accept if I were starting from scratch?',
      leverage: 'Bring the same follow-through to your weakest area. Set one measurable commitment for it and review it in the open every week.',
      actions: [
        'End every meeting this week by reading back each commitment: who, what, and by when.',
        'Have the one accountability conversation you have been postponing. Keep it about the commitment, not the person.',
        'Start a short weekly review where each person reports on their own commitments, so follow-up stops running through you.'
      ]
    },
    {
      key: 'communication',
      label: 'Communication',
      desc: 'The right information reaches the right people in time to act on it.',
      why: 'Most alignment problems are communication problems under another name. When information moves late or not at all, good people make reasonable decisions that pull in different directions.',
      levels: {
        low: 'People are likely finding out about decisions after they are made, or hearing different versions from different leaders. That creates rework and quiet frustration. One consistent rhythm for sharing decisions will change how connected the team feels.',
        mid: 'Information flows well inside small groups and stalls between them. Meetings happen, but decisions do not always travel. Closing the loop after every key decision is where your gain is.',
        high: 'Decisions and updates reach people before they need them, and meetings end with clear next steps. That keeps the whole organization moving in step. Keep the rhythm steady as you grow, because communication is the first thing to break at scale.'
      },
      reflect: 'What decision did someone on my team learn about too late this month, and why?',
      leverage: 'Use your communication rhythm to report progress on your weakest area every week. What gets reported gets improved.',
      actions: [
        'After your next key decision, send a three-line note: what we decided, why, and what changes for you.',
        'End every meeting this week with two minutes on who needs to know what was decided, and who will tell them.',
        'Ask three people where they most often get surprised by a decision. Fix the first gap they name.'
      ]
    },
    {
      key: 'engagement',
      label: 'Engagement',
      desc: 'People bring ownership and energy, not just compliance.',
      why: 'Engagement is the result of the other five areas. When people are aligned, trusted and clear, they give discretionary effort. When they are not, you get exactly what the job description asks for.',
      levels: {
        low: 'Much of your team may be doing what is required and holding the rest in reserve. That is rarely a motivation problem. It is usually a sign that something upstream, like vision, roles or trust, is out of alignment, and it is often the first warning of turnover.',
        mid: 'You have a committed core and a group in the middle that is waiting to see. The middle moves when they can see how their work matters and that their ideas get used.',
        high: 'Your people take ownership and bring ideas without being asked. That energy is the payoff of alignment everywhere else. Keep it by giving credit in public and acting on the ideas people bring.'
      },
      reflect: 'Who on my team used to bring more energy than they do now, and what changed?',
      leverage: 'Hand the problem in your weakest area to your most engaged people. Ownership spreads faster than instructions.',
      actions: [
        'Ask each person this week: what part of your work gives you the most energy, and what drains it? Write down what you hear.',
        'Act on one idea a team member brought you in the last month, and credit them by name.',
        'Pick one person who has gone quiet and hold a one-on-one about them, not their tasks.'
      ]
    }
  ],
  questions: [
    { dim: 'sharedVision', text: 'If I asked five people on my team where we are headed this year, I would hear the same answer.' },
    { dim: 'sharedVision', text: 'My team can explain why our goals matter, not just what they are.' },
    { dim: 'sharedVision', text: 'Different people or departments are chasing priorities that compete with each other.', reverse: true },

    { dim: 'roleClarity', text: 'Every important outcome on my team has one clear owner.' },
    { dim: 'roleClarity', text: 'Work regularly stalls or gets done twice because ownership is unclear.', reverse: true },
    { dim: 'roleClarity', text: 'Handoffs between people or departments run smoothly.' },

    { dim: 'trust', text: 'People on my team bring me hard news early, before it becomes a crisis.' },
    { dim: 'trust', text: 'The real conversation often happens after the meeting instead of in it.', reverse: true },
    { dim: 'trust', text: 'Team members disagree with each other openly and respectfully.' },

    { dim: 'accountability', text: 'When someone on my team commits to a date, it is met.' },
    { dim: 'accountability', text: 'Missed commitments get addressed directly, without me having to step in.' },
    { dim: 'accountability', text: 'A few people regularly fall short without any real consequence.', reverse: true },

    { dim: 'communication', text: 'Decisions reach the people they affect before those people need to act on them.' },
    { dim: 'communication', text: 'People on my team are often surprised by changes that affect their work.', reverse: true },
    { dim: 'communication', text: 'Our meetings end with clear decisions, owners and next steps.' },

    { dim: 'engagement', text: 'Most of my team brings ideas and effort beyond what the job requires.' },
    { dim: 'engagement', text: 'We have lost, or are at risk of losing, people we did not want to lose.', reverse: true },
    { dim: 'engagement', text: 'People on my team talk about our work with pride.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Misaligned',
      summary: 'Your organization may look strong on paper, but the people in it are not moving as one. Effort is leaking into unclear priorities, crossed ownership and conversations that happen in the wrong room. That is not a verdict on your team. It is a map, and your lowest area is where to start.'
    },
    {
      min: 50,
      label: 'Holding',
      summary: 'The foundation is real, and several areas are working. A few gaps are costing time, energy and probably good people. Close the lowest one and the whole team will feel the difference within a quarter.'
    },
    {
      min: 75,
      label: 'Aligned',
      summary: 'Your people share a direction, trust each other and keep their commitments. That is rare. The work now is protecting it as you grow and keeping your lowest area from becoming the next gap.'
    }
  ],
  related: ['team-alignment', 'delegation-audit', 'leadership-style'],
  cta: {
    label: 'Book your free Alignment Audit',
    href: '/book-a-call',
    heading: 'Walk through these results with Anthony.',
    text: 'Your score is the starting point. The free Alignment Audit is a 45-minute working session on Zoom, with your team or one-on-one: a teaching module chosen for your lowest area, a live diagnostic with the people on the call, and a one-page Alignment Scorecard in your hands within 48 hours.',
    early: true
  }
};
