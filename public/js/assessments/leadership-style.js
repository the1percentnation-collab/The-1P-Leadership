// What Kind of Leader Are You? A profile: your strongest style is the result.
export default {
  slug: 'leadership-style',
  title: 'What Kind of Leader Are You?',
  category: 'leader',
  mode: 'profile',
  minutes: 4,
  hook: 'Every leader has a natural style. Do you know yours?',
  short: 'Discover whether you lead most like a Visionary, a Builder, a Coach, or a Driver, and how to grow from there.',
  intro: 'Sixteen statements about how you naturally lead. Answer for what you actually do, not what you think a leader should do.',
  dimensions: [
    {
      key: 'visionary',
      label: 'Visionary',
      desc: 'Leading by painting a clear picture of where we are going and why it matters.',
      headline: 'You lead like a Visionary',
      summary: "You see what could be before anyone else does, and you give people a reason to care about it. Others experience you as inspiring and energizing, especially at the start of something new. Your blind spot is the space between the idea and the execution: people can feel lost when the vision moves faster than the plan.",
      actions: [
        'Take your biggest idea right now and write the first three concrete steps. Share those steps, not just the idea, with your team.',
        'Before you introduce a new direction this week, ask one person: what is still unclear about the last one?',
        'Pair with the most detail-minded person you know for thirty minutes and let them poke holes in your plan. Write down every question they ask.'
      ]
    },
    {
      key: 'builder',
      label: 'Builder',
      desc: 'Leading by creating systems, structure, and processes that make progress repeatable.',
      headline: 'You lead like a Builder',
      summary: "You turn ideas into systems that work, and you bring order to chaos. Others experience you as reliable and steady: when you are in charge, things get done the right way. Your blind spot is people and possibility: a perfect process can feel cold, and protecting the system can make you slow to embrace change.",
      actions: [
        'In your next team meeting, spend the first five minutes on people before process. Ask each person how they are really doing.',
        'Pick one process you own and ask the team: what would you change about this if it were your call? Implement one suggestion.',
        'Block thirty minutes this week to think about where your work should be in three years, not just how to run it better this month.'
      ]
    },
    {
      key: 'coach',
      label: 'Coach',
      desc: 'Leading by developing people and helping them become the best version of themselves.',
      headline: 'You lead like a Coach',
      summary: "You see potential in people and you invest in drawing it out. Others experience you as supportive and safe, and people tend to grow under your leadership. Your blind spot is hard conversations: caring about how people feel can make you slow to hold the line on standards and results.",
      actions: [
        'Identify one conversation you have been softening or avoiding. Write the one sentence that needs to be said, and say it this week.',
        'In your next one-on-one, end with a clear commitment: what will you do, and by when? Follow up on the date.',
        'Choose one measurable result your team owns and review it with them on Friday, alongside how they are growing.'
      ]
    },
    {
      key: 'driver',
      label: 'Driver',
      desc: 'Leading by setting a high bar, making decisions quickly, and pushing toward results.',
      headline: 'You lead like a Driver',
      summary: "You make decisions, set the pace, and move things forward when others hesitate. Others experience you as decisive and focused, and they trust you to deliver. Your blind spot is the people moving with you: speed and high standards can leave others feeling unheard, and you may carry more than your share because it feels faster.",
      actions: [
        'In your next decision meeting, ask for two other opinions before you share yours. Let silence sit for a few seconds after each question.',
        'Hand one task you would normally do yourself to someone on your team this week, and do not take it back.',
        'Thank one person specifically for how they did something, not only for what they delivered.'
      ]
    }
  ],
  questions: [
    { dim: 'visionary', text: 'I often see possibilities that others have not noticed yet.' },
    { dim: 'visionary', text: 'I get energized by talking about where we could be in a few years.' },
    { dim: 'visionary', text: 'People tell me I inspire them to think bigger.' },
    { dim: 'visionary', text: 'I would rather start something new than maintain something that already works.' },

    { dim: 'builder', text: 'When something keeps going wrong, my first instinct is to build a better process.' },
    { dim: 'builder', text: 'I feel most effective when roles, steps, and expectations are clearly defined.' },
    { dim: 'builder', text: 'I enjoy turning a loose idea into a plan with clear steps and owners.' },
    { dim: 'builder', text: 'People count on me to bring order when things feel chaotic.' },

    { dim: 'coach', text: 'I get real satisfaction from watching someone I lead grow.' },
    { dim: 'coach', text: 'I would rather ask a good question than give the answer.' },
    { dim: 'coach', text: 'I pay close attention to how the people around me are doing, not just what they are doing.' },
    { dim: 'coach', text: 'People often come to me for advice about their career or their life.' },

    { dim: 'driver', text: 'I make decisions quickly, even without perfect information.' },
    { dim: 'driver', text: 'I hold myself and others to a high standard of results.' },
    { dim: 'driver', text: 'When a project stalls, I am usually the one who pushes it forward.' },
    { dim: 'driver', text: 'I am comfortable being direct, even when the message is hard to hear.' }
  ],
  related: ['leadership-readiness', 'delegation-audit', 'team-alignment'],
  cta: { label: 'Book a free Alignment Audit', href: '/book-a-call' }
};
