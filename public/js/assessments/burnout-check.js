// The Burnout Check: energy, recovery, boundaries, meaning and the body's signals.
export default {
  slug: 'burnout-check',
  title: 'The Burnout Check',
  category: 'self',
  mode: 'score',
  minutes: 7,
  hook: 'Are you building, or burning out?',
  short: 'See whether your pace is sustainable across energy, recovery, boundaries, meaning, and the signals your body is sending.',
  intro: 'Twenty-five statements about the last month. Answer for how things actually are. Clarity comes before change.',
  dimensions: [
    {
      key: 'energy',
      label: 'Energy',
      desc: 'Having enough in the tank to do your best work and still show up for your life.',
      why: 'Energy is the currency you spend on everything else. When it runs low, your work, your patience and your relationships all pay the price.',
      levels: {
        low: 'You are getting through your days, but often by pushing rather than flowing. Caffeine, adrenaline or sheer will may be carrying more of the load than you realize. This is a signal, not a weakness. The first step is to learn when your energy is naturally highest and protect that time.',
        mid: 'You have decent energy for work, but there is not always much left for the rest of your life. Evenings and weekends may feel like recovery instead of living. Small changes to how you spend your best hours can give you more to bring home.',
        high: 'You usually have enough energy to do good work and still enjoy your life afterward. That is a strong foundation. Keep paying attention to what fuels you so you can protect it when demands increase.'
      },
      reflect: 'What gave me energy this past week, and what quietly took it away?',
      leverage: 'Use your strong energy to give your weakest area your best hour, not your leftover one. Even one high-energy block a week can shift it.',
      actions: [
        'For five days this week, note your energy from 1 to 10 at 10am, 2pm, and 7pm. On Friday, look for the pattern, not the average.',
        'Next week, move your most demanding task into your highest-energy hour on at least three days.',
        'By the end of this week, choose one recurring task that drains you more than it is worth and cut it, shorten it, or hand it to someone else.'
      ]
    },
    {
      key: 'recovery',
      label: 'Recovery',
      desc: 'Truly resetting, so rest restores you instead of just pausing the pressure.',
      why: 'Hard work is sustainable only if recovery keeps up with it. Without real rest, effort slowly turns into exhaustion.',
      levels: {
        low: 'Rest is not really restoring you right now. Even on days off, your mind stays at work, and you wake up tired. That is not because you are bad at resting. It is because pressure has nowhere to go. Clear stopping points and one truly restful activity will help.',
        mid: 'You recover some of the time, but not reliably. A good weekend helps, then the pressure builds again within a few days. Building small daily recovery habits, not just waiting for weekends, will steady you.',
        high: 'You know how to switch off and refill. Your rest actually restores you, and you come back ready. That ability is one of the strongest protections against burnout you can have.'
      },
      reflect: 'When was the last time I felt truly rested, and what was different about that time?',
      leverage: 'Your recovery habits give you room to stretch. Use the energy you restore to take on one small change in your weakest area this week.',
      actions: [
        'Set a fixed shutdown time for three workdays this week. When it arrives, write tomorrow\'s first task on paper and close the laptop.',
        'Plan one half day this weekend with no work, no errands, and no screens before noon. Put it on the calendar today.',
        'Pick one activity that genuinely restores you, such as a walk, a hobby, or time with a friend, and schedule it twice this week.'
      ]
    },
    {
      key: 'boundaries',
      label: 'Boundaries',
      desc: 'Protecting your time and attention so other people do not set your pace for you.',
      why: 'Without boundaries, your time belongs to whoever asks first. Boundaries are how you protect the energy you need for what matters most.',
      levels: {
        low: 'Other people are setting much of your pace right now. You say yes to avoid letting anyone down, and being unreachable makes you anxious. That comes from caring, but it leaves little for you. One small, kind boundary this week is the place to start.',
        mid: 'You hold some boundaries well and let others slip, especially when someone important asks. You likely know which requests always win. Deciding your limits in advance will make them easier to keep in the moment.',
        high: 'You protect your time and attention with clarity and kindness. People know what to expect from you, and you do not feel guilty about it. That steadiness gives you more to offer when it matters.'
      },
      reflect: 'What am I saying yes to right now that I would say no to if I were not worried about disappointing someone?',
      leverage: 'Use your boundary skills to make room for your weakest area. Protect one block of time for it the same way you protect your evenings.',
      actions: [
        'Tonight, turn off work notifications on your phone after a set hour and keep them off after that hour for the next seven days.',
        'Decline one request this week that you would normally accept out of obligation. Keep the reply to two sentences and kind.',
        'On Monday, write down your three non-negotiables for this week and share them with someone who will help you keep them.'
      ]
    },
    {
      key: 'meaning',
      label: 'Meaning',
      desc: 'Remembering why the work matters, which is often what keeps effort from turning into exhaustion.',
      why: 'Meaning is what makes hard work feel worth it. When it fades, even a reasonable workload can start to feel crushing.',
      levels: {
        low: 'The work may feel like a series of tasks with no clear purpose behind them. Going through the motions is one of the earliest signs of burnout, and it is common. Reconnecting with who your work helps, even in small ways, can bring some of the meaning back.',
        mid: 'You still believe your work matters, but the feeling comes and goes. Busy seasons crowd it out, and you can lose sight of why you started. Building small daily reminders of impact will keep meaning in view.',
        high: 'You know why your work matters, and that sense of purpose carries you through hard days. Meaning is a powerful buffer against burnout. Keep it close by noticing the difference you make regularly.'
      },
      reflect: 'Who is better off because of the work I did this month?',
      leverage: 'Your sense of purpose can make change in your weakest area feel worth it. Connect that area to the people and causes your work serves.',
      actions: [
        'At the end of each workday this week, write one sentence about who your work helped and how.',
        'Within the next two weeks, reach out to one person who benefited from your work. Ask them what difference it made, and save their answer.',
        'By Wednesday, identify the part of your role that feels most meaningful and block one hour for it on your calendar this week.'
      ]
    },
    {
      key: 'body',
      label: 'Physical Signals',
      desc: 'Listening to sleep, tension, and health before they force you to listen.',
      why: 'Your body often notices burnout before your mind admits it. Listening early keeps small signals from becoming serious problems.',
      levels: {
        low: 'Your body is sending signals: short sleep, tension, headaches or other strain. It is easy to push through these, but they are asking for attention. Start with one basic, like a steady bedtime or a daily walk, and give it a full week.',
        mid: 'You take care of your body some of the time, but stress shows up physically when work gets heavy. Sleep or movement may be the first thing to go. Protecting one physical habit during busy weeks will make a big difference.',
        high: 'You sleep, move and pay attention to your health with real consistency. Your body is supporting your work instead of breaking down under it. Keep listening, especially during your busiest seasons.'
      },
      reflect: 'What has my body been trying to tell me that I have been too busy to hear?',
      leverage: 'Your physical habits give you a steady base. Use the clarity and stamina they create to make one change in your weakest area.',
      actions: [
        'Starting tonight, set a consistent bedtime for the next five nights. Each morning, rate how you feel from 1 to 10.',
        'Take a twenty-minute walk without your phone on at least three days this week. Put the walks on your calendar now.',
        'If a physical symptom has lingered for more than two weeks, call and book the appointment by Friday instead of waiting it out.'
      ]
    }
  ],
  questions: [
    { dim: 'energy', text: 'I usually have enough energy to finish the day well, not just survive it.' },
    { dim: 'energy', text: 'I rely on caffeine, sugar, or adrenaline to get through most days.', reverse: true },
    { dim: 'energy', text: 'I have energy left for the people I love after work.' },
    { dim: 'energy', text: 'I know which times of day I do my best work and plan around them.' },
    { dim: 'energy', text: 'By mid afternoon, I am usually running on fumes.', reverse: true },

    { dim: 'recovery', text: 'I wake up most mornings feeling rested.' },
    { dim: 'recovery', text: 'When I take time off, I actually stop thinking about work.' },
    { dim: 'recovery', text: 'Even on my days off, I feel like I am falling behind.', reverse: true },
    { dim: 'recovery', text: 'I have a regular practice that genuinely restores me.' },
    { dim: 'recovery', text: 'I take short breaks during the workday that help me reset.' },

    { dim: 'boundaries', text: 'I protect time in my week that work does not get to touch.' },
    { dim: 'boundaries', text: 'I say yes to things I should decline because I do not want to disappoint people.', reverse: true },
    { dim: 'boundaries', text: 'I can be unreachable for an evening without feeling anxious about it.' },
    { dim: 'boundaries', text: 'I check work messages late at night or first thing in the morning.', reverse: true },
    { dim: 'boundaries', text: 'I am comfortable telling people when I do not have capacity for more.' },

    { dim: 'meaning', text: 'I still believe the work I do matters.' },
    { dim: 'meaning', text: 'I often feel like I am going through the motions.', reverse: true },
    { dim: 'meaning', text: 'I can see clear progress toward something I care about.' },
    { dim: 'meaning', text: 'My effort is connected to a purpose bigger than the next deadline.' },
    { dim: 'meaning', text: 'I regularly see the difference my work makes for real people.' },

    { dim: 'body', text: 'I sleep at least seven hours on most nights.' },
    { dim: 'body', text: 'I regularly notice tension, headaches, or stomach trouble when work gets heavy.', reverse: true },
    { dim: 'body', text: 'I move my body in a way I enjoy several times a week.' },
    { dim: 'body', text: 'I take care of my health before small issues become big ones.' },
    { dim: 'body', text: 'I eat in a way that keeps my energy steady through the day.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Running on Empty',
      summary: 'You have been giving more than you have been getting back, and it is showing up in your energy and your body. That is not a character flaw. It is a capacity problem, and capacity can be rebuilt. Start with one boundary and one form of real rest this week.'
    },
    {
      min: 50,
      label: 'Stretched Thin',
      summary: 'You are holding it together, and that takes real discipline. But some of your reserves are being spent faster than they are refilled. A few deliberate changes to recovery and boundaries now will protect the progress you are working so hard to build.'
    },
    {
      min: 75,
      label: 'Sustainably Building',
      summary: 'You are working hard and recovering well, which is the combination that lasts. Your pace fits your purpose. Keep an eye on the lowest area below, because that is usually where pressure finds its way in first.'
    }
  ],
  related: ['success-on-paper', 'discipline-score', 'purpose-at-work'],
  cta: { label: 'Book a free strategy call', href: '/book-a-call' }
};
