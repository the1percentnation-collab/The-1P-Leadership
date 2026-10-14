// The Delegation Audit: are you the bottleneck in your own organization?
export default {
  slug: 'delegation-audit',
  title: 'The Delegation Audit',
  category: 'leader',
  mode: 'score',
  minutes: 7,
  hook: 'Are you the bottleneck?',
  short: 'Find out whether your team is growing around you or waiting on you, across trust, systems, letting go, capability, and focus.',
  intro: 'A few honest minutes on how work moves through you. Answer for a typical week, not your best one.',
  dimensions: [
    {
      key: 'trust',
      label: 'Trust',
      desc: 'Believing your people can deliver, and giving them room to prove it.',
      why: 'Delegation without trust is just supervision with extra steps. People rise to the level of ownership you actually give them.',
      levels: {
        low: 'Right now it is hard for you to fully hand things off, so you stay close, check often and keep the final say. That usually comes from being burned before or caring deeply about the result. Start rebuilding trust in small, low-risk pieces so both you and your team can see it work.',
        mid: 'You trust your people with some things and hold tight on others. They can probably feel where the line is. Agreeing on the result up front and then stepping back will let you extend trust without lowering the standard.',
        high: 'You give people real authority and let them prove what they can do. That builds confidence and ownership across your team. Keep stretching that trust to the next level of responsibility so your people keep growing.'
      },
      reflect: 'What would I hand off tomorrow if I fully trusted the person in front of me, and what would it take to get there?',
      leverage: 'Use the trust you already extend to give your team a hand in your weakest area. Ask one person to own part of it and report back.',
      actions: [
        'Pick one person and give them full ownership of an outcome this week. Agree on the result and the deadline in writing, not the method.',
        'For the next two weeks, when someone brings you work, ask "what do you recommend?" before you give your answer.',
        'This week, skip one check-in you would normally make on a delegated task. Put a single update time on the calendar and wait for them to report back.'
      ]
    },
    {
      key: 'systems',
      label: 'Systems',
      desc: 'Having processes in place so work does not depend on your memory or presence.',
      why: 'If the work lives in your head, your head becomes the ceiling. Systems let your team move without waiting for you.',
      levels: {
        low: 'A lot of how things get done lives in your memory, so people come to you for answers and wait when you are not available. That is normal for a team that grew quickly. Writing down one process a week will start to free you faster than you expect.',
        mid: 'Some of your key processes are written down and others still depend on you. Things run smoothly until you step away, then questions start piling up. Pick the process that generates the most questions and document it first.',
        high: 'Your team can find answers, learn the work and keep moving without you. That is a sign of a mature operation. Keep your systems current, and ask the people who use them to own their upkeep.'
      },
      reflect: 'If I were unreachable for two weeks, where exactly would the work stop?',
      leverage: 'Apply your systems thinking to your weakest area. Turn one part of it into a simple checklist or template someone else can follow.',
      actions: [
        'Write down the one task you explain over and over. Record a ten-minute screen or phone walkthrough of it this week and share the link.',
        'Within seven days, create a simple checklist for one recurring task and hand it to someone with the checklist attached.',
        'List the decisions that only you can make right now. By Friday, choose one and write the rule someone else could use to make it.'
      ]
    },
    {
      key: 'lettingGo',
      label: 'Letting Go',
      desc: 'Releasing control of how things get done, as long as they get done well.',
      why: 'Your way is not the only way that works. Holding on to how things get done keeps your people small and keeps you busy with work beneath your role.',
      levels: {
        low: 'You find it hard to let others do things their way, so you redo, adjust or simply keep the work. That comes from high standards, which are a strength. The shift is separating the result you need from the method you prefer, and accepting a different path to the same outcome.',
        mid: 'You let go of some things and keep a tight grip on others, usually the work closest to your expertise. You may still take tasks back when the pressure rises. Noticing each take-back, and why, will show you exactly where to loosen your hold.',
        high: 'You release control of how work gets done and focus on whether it gets done well. That gives your team room to grow and gives you room to lead. Keep handing off work early, before it becomes urgent, so people have time to do it well.'
      },
      reflect: 'What task do I keep because "no one does it like me," and is that actually true?',
      leverage: 'Use your ability to let go to release one task tied to your weakest area. The space you free up is space to work on what is lagging.',
      actions: [
        'Write down three tasks you do because "no one does it like me." Hand off one this week, and accept 80 percent as good enough for the first month.',
        'This week, when you see delegated work done differently than you would, ask one question before you change anything.',
        'Notice every time you take a task back this week and write down why in one line. On Friday, read the list and look for the pattern.'
      ]
    },
    {
      key: 'teamCapability',
      label: 'Team Capability',
      desc: 'Building a team that is equipped to carry more than it does today.',
      why: 'You can only delegate as much as your team is ready to carry. Building their capability is how you build your own freedom.',
      levels: {
        low: 'Right now your team may not feel ready to take more off your plate, so the work keeps coming back to you. That is a gap in development, not in people. A small, steady investment in training will change what you can hand off within a few months.',
        mid: 'Your team has real skill and could carry more with the right preparation. The training tends to happen when there is time, which is rarely. Scheduling short, regular teaching moments will turn potential into capacity.',
        high: 'Your team is capable and growing, and at least some of them could step into parts of your role. That is a strong position. Keep developing your next layer of leaders so the team can keep up with where you are going.'
      },
      reflect: 'Who on my team is ready for more right now, and what is stopping me from giving it to them?',
      leverage: 'Ask your most capable team member to help you strengthen your weakest area. Their growth and your relief can happen at the same time.',
      actions: [
        'This week, ask each person on your team: what is one thing you could own that I am still doing? Write down every answer and act on one within 30 days.',
        'Choose one skill gap on your team and schedule thirty minutes in the next seven days to teach it, or book a course for someone to learn it.',
        'Identify the person who could replace you in one key area. Tell them this week, and give them their first piece of it by Friday.'
      ]
    },
    {
      key: 'highValueWork',
      label: 'High-Value Work',
      desc: 'Spending your time on the work only you can do.',
      why: 'Every hour you spend on work someone else could do is an hour taken from work only you can do. Your calendar shows what you are really leading.',
      levels: {
        low: 'Most of your week is going to tasks that others could handle, and the work only you can do keeps getting pushed back. That is exhausting and it slows your whole team. Start by tracking your time for a few days so you can see exactly what to hand off.',
        mid: 'You spend part of your week on high-value work and part on tasks below your role. Strategy and planning get time when the week allows, which is rarely. Protecting one block each week for your most important work will change the direction of your month.',
        high: 'Your calendar reflects your role as a leader. You spend most of your time on work that only you can do, with real time for strategy. Guard that focus carefully, because it erodes quietly when things get busy.'
      },
      reflect: 'What is the highest-value thing I could do this week, and how much of my calendar is actually set aside for it?',
      leverage: 'Use your protected focus time to work on your weakest area for one session a week. Treat it as part of the work only you can do.',
      actions: [
        'Track your time in 30-minute blocks for three days. Circle the tasks only you can do. Everything else is a delegation candidate.',
        'Block two hours on your calendar this week for your most important, non-urgent work. Protect it like a client meeting.',
        'Within the next two weeks, remove yourself from one recurring meeting where your presence is not required, and ask for written notes instead.'
      ]
    }
  ],
  questions: [
    { dim: 'trust', text: 'I trust my team to make good decisions without me in the room.' },
    { dim: 'trust', text: 'I check in on delegated work more often than I need to.', reverse: true },
    { dim: 'trust', text: 'When I hand off a task, I give people real authority, not just responsibility.' },
    { dim: 'trust', text: 'When someone on my team makes a mistake, I still give them the next opportunity.' },
    { dim: 'trust', text: 'I let people solve problems their own way before I step in.' },

    { dim: 'systems', text: 'Our key processes are written down, not just in my head.' },
    { dim: 'systems', text: 'If I were unreachable for a week, the work would keep moving.' },
    { dim: 'systems', text: 'People regularly have to wait on me before they can move forward.', reverse: true },
    { dim: 'systems', text: 'New people can learn how we work without me training them personally.' },
    { dim: 'systems', text: 'My team has clear guidelines for which decisions they can make on their own.' },

    { dim: 'lettingGo', text: 'I am comfortable when others do things differently than I would, as long as the result is good.' },
    { dim: 'lettingGo', text: 'I often redo work others have done because it is not quite how I want it.', reverse: true },
    { dim: 'lettingGo', text: 'I hand off tasks early, before they become urgent.' },
    { dim: 'lettingGo', text: 'I hold on to tasks because it is faster to do them myself.', reverse: true },
    { dim: 'lettingGo', text: 'I can step away from a delegated project without worrying about it all day.' },

    { dim: 'teamCapability', text: 'My team has the skills to take on more than they do now.' },
    { dim: 'teamCapability', text: 'I invest time in training people so they can handle more responsibility.' },
    { dim: 'teamCapability', text: 'At least one person could step into a key part of my role today.' },
    { dim: 'teamCapability', text: 'I hesitate to delegate because my team is not ready for more.', reverse: true },
    { dim: 'teamCapability', text: 'People on my team are growing into bigger responsibilities each year.' },

    { dim: 'highValueWork', text: 'Most of my week is spent on work that only I can do.' },
    { dim: 'highValueWork', text: 'I have regular, protected time for strategy and planning.' },
    { dim: 'highValueWork', text: 'I spend a lot of my day on tasks someone else could handle.', reverse: true },
    { dim: 'highValueWork', text: 'My calendar reflects my role as a leader, not just a doer.' },
    { dim: 'highValueWork', text: 'I often end the week without touching the work that matters most.', reverse: true }
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
