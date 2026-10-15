// What Kind of Leader Are You? A profile: your strongest style is the result.
export default {
  slug: 'leadership-style',
  title: 'What Kind of Leader Are You?',
  category: 'leader',
  mode: 'profile',
  minutes: 4,
  hook: 'Every leader has a natural style. Do you know yours?',
  short: 'Discover whether you lead most like a Visionary, a Builder, a Coach, or a Driver, and how to grow from there.',
  intro: 'A few honest minutes on how you naturally lead. Answer for what you actually do, not what you think a leader should do.',
  dimensions: [
    {
      key: 'visionary',
      label: 'Visionary',
      desc: 'Leading by painting a clear picture of where we are going and why it matters.',
      headline: 'You lead like a Visionary',
      summary: "You see what could be before anyone else does, and you give people a reason to care about it. Others experience you as inspiring and energizing, especially at the start of something new. Your blind spot is the space between the idea and the execution: people can feel lost when the vision moves faster than the plan.",
      why: 'People will work hard for a plan, but they give their best to a picture they believe in. Vision is what turns a task list into a shared mission.',
      levels: {
        low: 'Big-picture vision is not where you naturally start. You likely lead from what is in front of you, which keeps things grounded and real. The risk is that your people know what to do but not always why, so borrow a little vision by telling them the purpose behind one priority each week.',
        mid: 'You can paint the picture when it matters, but it is not your default setting. You probably reach for vision at launches and turning points, then go quiet once the work begins. Repeating the why in ordinary weeks will keep your team connected long after the kickoff energy fades.',
        high: 'You think in possibilities and you naturally pull people toward a future they can feel. That is a real gift, and it can also run ahead of your team. Your growth is in slowing the idea down long enough to turn it into steps others can follow.'
      },
      reflect: 'Which of my ideas has my team heard about many times but never seen a plan for?',
      actions: [
        'Take your biggest idea right now and write the first three concrete steps by Wednesday. Share those steps, not just the idea, with your team by Friday.',
        'Before you introduce a new direction this week, ask one person: what is still unclear about the last one? Write down their answer and address it first.',
        'Book thirty minutes this week with the most detail-minded person you know and let them poke holes in your plan. Write down every question they ask and answer each one in writing.'
      ]
    },
    {
      key: 'builder',
      label: 'Builder',
      desc: 'Leading by creating systems, structure, and processes that make progress repeatable.',
      headline: 'You lead like a Builder',
      summary: "You turn ideas into systems that work, and you bring order to chaos. Others experience you as reliable and steady: when you are in charge, things get done the right way. Your blind spot is people and possibility: a perfect process can feel cold, and protecting the system can make you slow to embrace change.",
      why: 'Good intentions do not scale, but good systems do. Structure is what lets a team succeed on an ordinary Tuesday, not just on its best day.',
      levels: {
        low: 'Structure and process are not your first instinct. You probably lead through relationships, ideas or sheer effort, and you can improvise well. The cost shows up when the same problem keeps coming back, so pick one recurring headache and give it a simple written process.',
        mid: 'You value order and you build it when things get messy enough. Your systems tend to show up as fixes after the fact rather than as foundations from the start. Building one process before it is needed will save you more time than any fix after.',
        high: 'You naturally bring order, clarity and repeatable ways of working. People trust things to get done when you are in charge. Your growth is in staying open: let the people inside your systems help shape them, and leave room for ideas that do not fit the current process.'
      },
      reflect: 'Where am I protecting a process that no longer serves the people using it?',
      actions: [
        'In your next team meeting, spend the first five minutes on people before process. Ask each person how they are really doing and listen without moving to the agenda.',
        'Pick one process you own and ask the team this week: what would you change about this if it were your call? Implement one suggestion within fourteen days.',
        'Block thirty minutes this week to write a one-page answer to one question: where should our work be in three years, not just how do we run it better this month?'
      ]
    },
    {
      key: 'coach',
      label: 'Coach',
      desc: 'Leading by developing people and helping them become the best version of themselves.',
      headline: 'You lead like a Coach',
      summary: "You see potential in people and you invest in drawing it out. Others experience you as supportive and safe, and people tend to grow under your leadership. Your blind spot is hard conversations: caring about how people feel can make you slow to hold the line on standards and results.",
      why: 'Your reach as a leader is limited by how many people you help grow. Coaching turns your influence into capacity that outlasts you.',
      levels: {
        low: 'Developing people is not where your energy naturally goes. You may focus on the work and expect people to keep up, which can be efficient in the short run. Ask one person a growth question this week, such as what skill they want to build, and you will see a side of them you have been missing.',
        mid: 'You care about people growing, and you invest in them when there is time. The coaching tends to slip when deadlines get loud. Protecting one short development conversation each week keeps it from disappearing when you need it most.',
        high: 'You see potential in people and you draw it out, often before they see it themselves. People feel safe with you and tend to grow under your leadership. Your growth is in pairing that care with clear standards, because honest feedback is also a form of investment.'
      },
      reflect: 'Who on my team needs a clear standard from me more than they need encouragement right now?',
      actions: [
        'Identify one conversation you have been softening or avoiding. Write the one sentence that needs to be said, and say it before Friday.',
        'In your next one-on-one, end with a clear commitment: what will you do, and by when? Put the date on your calendar and follow up on that day.',
        'Choose one measurable result your team owns and review it with them every Friday for the next four weeks, alongside how they are growing.'
      ]
    },
    {
      key: 'driver',
      label: 'Driver',
      desc: 'Leading by setting a high bar, making decisions quickly, and pushing toward results.',
      headline: 'You lead like a Driver',
      summary: "You make decisions, set the pace, and move things forward when others hesitate. Others experience you as decisive and focused, and they trust you to deliver. Your blind spot is the people moving with you: speed and high standards can leave others feeling unheard, and you may carry more than your share because it feels faster.",
      why: 'Without someone willing to decide and push, good plans stall in discussion. Drive is what turns intention into results on a deadline.',
      levels: {
        low: 'Setting the pace and pushing for results is not your default. You likely lead through patience, collaboration or careful thought, which builds buy-in. The risk is that decisions drift, so set a clear deadline for the next decision in front of you and hold to it.',
        mid: 'You can drive hard when it matters and ease off when it does not. You may hesitate when the call is unpopular or the information is incomplete. Practice making one decision a week with eighty percent of the facts, and notice how rarely the last twenty percent would have changed it.',
        high: 'You move things forward, decide quickly and hold a high bar. People trust you to deliver. Your growth is in bringing others with you: slow down long enough to hear them, and let them carry more of the load so your pace becomes the team pace.'
      },
      reflect: 'What am I carrying myself because it feels faster, and what is that costing the people around me?',
      actions: [
        'In your next decision meeting, ask for two other opinions before you share yours. Let silence sit for five seconds after each question.',
        'Hand one task you would normally do yourself to someone on your team this week. Agree on the result and the deadline, then do not take it back.',
        'Before Friday, thank one person in writing for how they did something, not only for what they delivered. Name the specific behavior you want to see again.'
      ]
    }
  ],
  questions: [
    { dim: 'visionary', text: 'I often see possibilities that others have not noticed yet.' },
    { dim: 'visionary', text: 'I get energized by talking about where we could be in a few years.' },
    { dim: 'visionary', text: 'People tell me I inspire them to think bigger.' },
    { dim: 'visionary', text: 'When I explain a project, I start with why it matters before how it will work.' },

    { dim: 'builder', text: 'When something keeps going wrong, my first instinct is to build a better process.' },
    { dim: 'builder', text: 'I feel most effective when roles, steps, and expectations are clearly defined.' },
    { dim: 'builder', text: 'People count on me to bring order when things feel chaotic.' },
    { dim: 'builder', text: 'I like to write down how something is done so anyone can repeat it.' },

    { dim: 'coach', text: 'I get real satisfaction from watching someone I lead grow.' },
    { dim: 'coach', text: 'I would rather ask a good question than give the answer.' },
    { dim: 'coach', text: 'I pay close attention to how the people around me are doing, not just what they are doing.' },
    { dim: 'coach', text: 'I will give someone a stretch assignment even if I could do it better myself.' },

    { dim: 'driver', text: 'I make decisions quickly, even without perfect information.' },
    { dim: 'driver', text: 'I hold myself and others to a high standard of results.' },
    { dim: 'driver', text: 'When a project stalls, I am usually the one who pushes it forward.' },
    { dim: 'driver', text: 'I am comfortable being direct, even when the message is hard to hear.' }
  ],
  related: ['leadership-readiness', 'delegation-audit', 'team-alignment'],
  cta: { label: 'Request a free Alignment Audit', href: '/corporate#audit' }
};
