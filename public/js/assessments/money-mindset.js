// Money Mindset: a profile assessment that reveals your money personality and how it shapes your goals.
export default {
  slug: 'money-mindset',
  title: 'What Is Your Money Personality?',
  category: 'money',
  mode: 'profile',
  minutes: 5,
  hook: 'Your habits with money are not random. They have a personality.',
  short: 'Discover your money personality, the strength it gives you and the blind spot that may be slowing your progress.',
  intro: 'Twenty statements about how you think and feel about money. There is no best type, only a clearer picture of yours.',
  disclaimer: 'This assessment is for educational purposes only and is not financial, legal, tax or investment advice. Talk with a licensed professional about your situation.',
  dimensions: [
    {
      key: 'protector',
      label: 'The Protector',
      desc: 'Security comes first. You save, you prepare and you feel best with a cushion.',
      headline: 'Your money personality is The Protector',
      summary: 'Your strength is discipline: you save consistently and you are rarely caught off guard. Your blind spot is that caution can turn into holding back, keeping money idle or saying no to growth because it feels uncertain. Left unchecked, safety can quietly cost you progress. Your next level is letting a clear plan, not fear of loss, decide what your money does.',
      actions: [
        'Write down how many months of expenses you have saved, then decide on a number that is truly enough for your safety net.',
        'Pick one goal you have delayed because it felt risky. Write the smallest first step and take it this week.',
        'Schedule one conversation with a licensed professional about how money beyond your safety net could be working for your goals.'
      ]
    },
    {
      key: 'enjoyer',
      label: 'The Enjoyer',
      desc: 'Money is for living. You value experiences, generosity toward yourself and today.',
      headline: 'Your money personality is The Enjoyer',
      summary: 'Your strength is that you know money is a tool for a full life, and you do not let it sit unused. Your blind spot is that today can crowd out tomorrow, with spending decisions made in the moment rather than by plan. That can leave your bigger goals underfunded. Your next level is keeping the joy and adding a system so your future self gets a share first.',
      actions: [
        'Set up an automatic transfer to savings on payday so your future self gets paid before you spend.',
        'Create a guilt-free spending amount for the month, and enjoy it fully once the bills and savings are covered.',
        'Before any purchase over $100 this week, wait 48 hours and ask whether it moves you toward what matters most.'
      ]
    },
    {
      key: 'avoider',
      label: 'The Avoider',
      desc: 'Money feels heavy, so you would rather not look too closely. You are capable, just not engaged.',
      headline: 'Your money personality is The Avoider',
      summary: 'Your strength is that you do not let money define your worth or consume your attention. Your blind spot is that not looking lets small issues grow quietly, like fees, missed opportunities or a plan that never gets made. The cost is usually less clarity, not less ability. Your next level is short, regular check-ins that make money feel lighter, not heavier.',
      actions: [
        'Set a 10 minute timer and log in to every account you have. Just look. Write down each balance.',
        'Put a recurring 15 minute money check-in on your calendar every Sunday for the next month.',
        'Choose one money task you have been putting off and finish it before Friday.'
      ]
    },
    {
      key: 'builder',
      label: 'The Builder',
      desc: 'Money is a tool for growth. You think in goals, plans and long-term progress.',
      headline: 'Your money personality is The Builder',
      summary: 'Your strength is vision: you see money as fuel for growth and you plan with purpose. Your blind spot is that building can become the whole point, with rest, protection or relationships getting less attention than the next goal. Growth without protection can leave everything exposed to one hard season. Your next level is making sure what you build is protected and aligned with why you are building it.',
      actions: [
        'Write one sentence on why you are building wealth. Read it before your next big money decision.',
        'Review your insurance and beneficiaries this week to make sure what you have built is protected.',
        'Plan one meaningful experience this month that you pay for without counting it against your goals.'
      ]
    },
    {
      key: 'giver',
      label: 'The Giver',
      desc: 'Money is a way to care for people. You are generous with family, friends and causes.',
      headline: 'Your money personality is The Giver',
      summary: 'Your strength is generosity: people around you are better off because of you. Your blind spot is that giving without limits can leave your own foundation thin, with your savings and future coming last. You cannot keep giving from an empty account. Your next level is building a plan that funds your future and your generosity on purpose.',
      actions: [
        'Decide on a monthly giving amount and give from that budget instead of case by case.',
        'Practice one kind, clear no this week to a request that does not fit your plan.',
        'Make sure your own emergency savings gets funded on payday before anything else goes out.'
      ]
    }
  ],
  questions: [
    { dim: 'protector', text: 'I feel most at peace when I have a healthy amount saved.' },
    { dim: 'protector', text: 'I think carefully about what could go wrong before I spend or invest.' },
    { dim: 'protector', text: 'Saving money comes more naturally to me than spending it.' },
    { dim: 'protector', text: 'I would rather keep money safe than take a chance on growing it.' },

    { dim: 'enjoyer', text: 'I believe money is meant to be enjoyed now, not just saved for later.' },
    { dim: 'enjoyer', text: 'I often spend on experiences, treats or upgrades that make life feel good.' },
    { dim: 'enjoyer', text: 'I tend to make spending decisions in the moment.' },
    { dim: 'enjoyer', text: 'Treating myself is an important part of how I reward hard work.' },

    { dim: 'avoider', text: 'I would rather not think about money unless I have to.' },
    { dim: 'avoider', text: 'I sometimes put off opening bills or checking my balance.' },
    { dim: 'avoider', text: 'Money conversations make me want to change the subject.' },
    { dim: 'avoider', text: 'I trust things will work out without me tracking every detail.' },

    { dim: 'builder', text: 'I see money mainly as a tool to build something bigger.' },
    { dim: 'builder', text: 'I enjoy setting financial goals and tracking my progress toward them.' },
    { dim: 'builder', text: 'I regularly look for ways to grow my income or my net worth.' },
    { dim: 'builder', text: 'I think about where my money will be ten years from now.' },

    { dim: 'giver', text: 'Helping family and friends with money brings me real joy.' },
    { dim: 'giver', text: 'I find it hard to say no when someone I care about needs help.' },
    { dim: 'giver', text: 'Giving to my church, community or causes is a priority in my budget.' },
    { dim: 'giver', text: 'I often put other people\'s needs ahead of my own savings goals.' }
  ],
  related: ['financial-readiness', 'limiting-beliefs', 'find-your-why'],
  cta: { label: 'Explore financial services', href: '/financial-services' }
};
