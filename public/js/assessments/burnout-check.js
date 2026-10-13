// The Burnout Check: energy, recovery, boundaries, meaning and the body's signals.
export default {
  slug: 'burnout-check',
  title: 'The Burnout Check',
  category: 'self',
  mode: 'score',
  minutes: 5,
  hook: 'Are you building, or burning out?',
  short: 'See whether your pace is sustainable across energy, recovery, boundaries, meaning, and the signals your body is sending.',
  intro: 'Eighteen statements about the last month. Answer for how things actually are. Clarity comes before change.',
  dimensions: [
    {
      key: 'energy',
      label: 'Energy',
      desc: 'Having enough in the tank to do your best work and still show up for your life.',
      actions: [
        'For five days, note your energy from 1 to 10 at 10am, 2pm, and 7pm. Look for the pattern, not the average.',
        'Move your most demanding task this week into your highest-energy hour.',
        'Cut or delegate one recurring task that drains you more than it is worth.'
      ]
    },
    {
      key: 'recovery',
      label: 'Recovery',
      desc: 'Truly resetting, so rest restores you instead of just pausing the pressure.',
      actions: [
        'Set a fixed shutdown time for three workdays this week and close the laptop when it arrives.',
        'Plan one half day this weekend with no work, no errands, and no screens before noon.',
        'Pick one activity that genuinely restores you and schedule it twice this week.'
      ]
    },
    {
      key: 'boundaries',
      label: 'Boundaries',
      desc: 'Protecting your time and attention so other people do not set your pace for you.',
      actions: [
        'Turn off work notifications on your phone after a set hour for the next seven days.',
        'Decline one request this week that you would normally accept out of obligation. Keep the reply short and kind.',
        'Write down your three non-negotiables for this week and share them with someone who will help you keep them.'
      ]
    },
    {
      key: 'meaning',
      label: 'Meaning',
      desc: 'Remembering why the work matters, which is often what keeps effort from turning into exhaustion.',
      actions: [
        'At the end of each workday this week, write one sentence about who your work helped.',
        'Reconnect with one person who benefited from your work. Ask them what difference it made.',
        'Identify the part of your role that feels most meaningful and protect one hour for it this week.'
      ]
    },
    {
      key: 'body',
      label: 'Physical Signals',
      desc: 'Listening to sleep, tension, and health before they force you to listen.',
      actions: [
        'Set a consistent bedtime for the next five nights and track how you feel each morning.',
        'Take a twenty-minute walk without your phone on at least three days this week.',
        'If a physical symptom has lingered for weeks, book the appointment this week instead of waiting it out.'
      ]
    }
  ],
  questions: [
    { dim: 'energy', text: 'I usually have enough energy to finish the day well, not just survive it.' },
    { dim: 'energy', text: 'I rely on caffeine, sugar, or adrenaline to get through most days.', reverse: true },
    { dim: 'energy', text: 'I have energy left for the people I love after work.' },

    { dim: 'recovery', text: 'I wake up most mornings feeling rested.' },
    { dim: 'recovery', text: 'When I take time off, I actually stop thinking about work.' },
    { dim: 'recovery', text: 'Even on my days off, I feel like I am falling behind.', reverse: true },
    { dim: 'recovery', text: 'I have a regular practice that genuinely restores me.' },

    { dim: 'boundaries', text: 'I protect time in my week that work does not get to touch.' },
    { dim: 'boundaries', text: 'I say yes to things I should decline because I do not want to disappoint people.', reverse: true },
    { dim: 'boundaries', text: 'I can be unreachable for an evening without feeling anxious about it.' },

    { dim: 'meaning', text: 'I still believe the work I do matters.' },
    { dim: 'meaning', text: 'I often feel like I am going through the motions.', reverse: true },
    { dim: 'meaning', text: 'I can see clear progress toward something I care about.' },
    { dim: 'meaning', text: 'My effort is connected to a purpose bigger than the next deadline.' },

    { dim: 'body', text: 'I sleep at least seven hours on most nights.' },
    { dim: 'body', text: 'I regularly notice tension, headaches, or stomach trouble when work gets heavy.', reverse: true },
    { dim: 'body', text: 'I move my body in a way I enjoy several times a week.' },
    { dim: 'body', text: 'I take care of my health before small issues become big ones.' }
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
