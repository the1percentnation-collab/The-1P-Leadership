// Money Mindset: a profile assessment that reveals your money personality and how it shapes your goals.
export default {
  slug: 'money-mindset',
  title: 'What Is Your Money Personality?',
  category: 'money',
  mode: 'profile',
  minutes: 4,
  hook: 'Your habits with money are not random. They have a personality.',
  short: 'Discover your money personality, the strength it gives you and the blind spot that may be slowing your progress.',
  intro: 'A few honest minutes on how you think and feel about money. There is no best type, only a clearer picture of yours.',
  disclaimer: 'This assessment is for educational purposes only and is not financial, legal, tax or investment advice. Talk with a licensed professional about your situation.',
  dimensions: [
    {
      key: 'protector',
      label: 'The Protector',
      desc: 'Security comes first. You save, you prepare and you feel best with a cushion.',
      why: 'The Protector shapes how much risk you are willing to take and how safe you need to feel before you act. Knowing its pull helps you save on purpose instead of out of worry.',
      headline: 'Your money personality is The Protector',
      summary: 'Your strength is discipline: you save consistently and you are rarely caught off guard. Your blind spot is that caution can turn into holding back, keeping money idle or saying no to growth because it feels uncertain. Left unchecked, safety can quietly cost you progress. Your next level is letting a clear plan, not fear of loss, decide what your money does.',
      levels: {
        low: 'Security is not the main thing driving your money decisions. You are comfortable with some uncertainty, which can free you to act. Just make sure a basic safety net still exists, since many people aim for at least three months of essential expenses.',
        mid: 'You value a cushion and you think about what could go wrong, but it does not run the show. That balance is healthy. Check that your savings has a clear target, so caution stays a tool and not a habit.',
        high: 'Security is a strong pull for you, and it has likely kept you steady through hard seasons. The risk is that money past your safety net sits idle because moving it feels uncomfortable. Naming a clear "enough" number for your cushion lets the rest work toward your goals.'
      },
      reflect: 'How much would truly be enough for me to feel safe, and what would I do with anything beyond that?',
      actions: [
        'Tonight, write down how many months of essential expenses you have saved, then decide on the number that would truly be enough for your safety net.',
        'This week, pick one goal you have delayed because it felt risky, write the smallest possible first step and take it before Sunday.',
        'Within the next 30 days, schedule one conversation with a licensed professional about how money beyond your safety net could be working toward your goals.'
      ]
    },
    {
      key: 'enjoyer',
      label: 'The Enjoyer',
      desc: 'Money is for living. You value experiences, generosity toward yourself and today.',
      why: 'The Enjoyer shapes how you balance today against tomorrow. Understanding its pull lets you enjoy your money fully without leaving your future self underfunded.',
      headline: 'Your money personality is The Enjoyer',
      summary: 'Your strength is that you know money is a tool for a full life, and you do not let it sit unused. Your blind spot is that today can crowd out tomorrow, with spending decisions made in the moment rather than by plan. That can leave your bigger goals underfunded. Your next level is keeping the joy and adding a system so your future self gets a share first.',
      levels: {
        low: 'Enjoying money in the moment is not a big driver for you. You may even feel guilty spending on yourself. Planning a small, guilt-free amount for things you enjoy can make your other goals easier to stick with.',
        mid: 'You like to enjoy your money and you also keep an eye on the bigger picture. Most of the time that balance works. The gap shows up in busy or stressful weeks, when in-the-moment spending can slip past the plan.',
        high: 'Enjoying life is a strong pull, and it makes you generous with yourself and fun to be around. The risk is that spending happens first and saving gets what is left. Automating savings on payday lets you keep the joy without the second guessing.'
      },
      reflect: 'Which of my recent purchases truly added to my life, and which ones did I forget about within a week?',
      actions: [
        'Before your next payday, set up an automatic transfer to savings for the day your pay arrives so your future self gets paid before you spend.',
        'At the start of this month, choose a guilt-free spending amount, write it down and enjoy it fully once bills and savings are covered.',
        'For the next seven days, wait 48 hours before any purchase over $100 and ask whether it moves you toward what matters most.'
      ]
    },
    {
      key: 'avoider',
      label: 'The Avoider',
      desc: 'Money feels heavy, so you would rather not look too closely. You are capable, just not engaged.',
      why: 'The Avoider shapes how often you look at your money at all. When avoidance is strong, small problems grow quietly simply because no one is watching them.',
      headline: 'Your money personality is The Avoider',
      summary: 'Your strength is that you do not let money define your worth or consume your attention. Your blind spot is that not looking lets small issues grow quietly, like fees, missed opportunities or a plan that never gets made. The cost is usually less clarity, not less ability. Your next level is short, regular check-ins that make money feel lighter, not heavier.',
      levels: {
        low: 'You are generally willing to look at your money and deal with it. That engagement is a quiet advantage. Keep it steady with a short, regular check-in so it stays easy.',
        mid: 'You engage with money when you need to, but some tasks get put off until they feel urgent. That is very common. Pairing a short weekly check-in with something you enjoy, like coffee or music, can make it feel lighter.',
        high: 'Avoidance is a strong pull for you, and it is usually protecting you from stress, not a sign you cannot handle money. Short, low-pressure check-ins help most. Ten minutes of simply looking, without fixing anything, is a real win.'
      },
      reflect: 'What feeling am I trying to avoid when I put off looking at my money?',
      actions: [
        'This weekend, set a 10 minute timer, log in to every account you have and write down each balance. Just look, do not fix anything yet.',
        'Today, put a recurring 15 minute money check-in on your calendar every Sunday for the next four weeks.',
        'Choose one money task you have been putting off, like a bill, a form or a call, and finish it before Friday.'
      ]
    },
    {
      key: 'builder',
      label: 'The Builder',
      desc: 'Money is a tool for growth. You think in goals, plans and long-term progress.',
      why: 'The Builder shapes how you think about growth, goals and the future. Its pull drives progress, and it also needs protection and purpose so what you build lasts.',
      headline: 'Your money personality is The Builder',
      summary: 'Your strength is vision: you see money as fuel for growth and you plan with purpose. Your blind spot is that building can become the whole point, with rest, protection or relationships getting less attention than the next goal. Growth without protection can leave everything exposed to one hard season. Your next level is making sure what you build is protected and aligned with why you are building it.',
      levels: {
        low: 'Long-term growth is not a strong focus for you right now. That may be because today needs your attention. Writing one simple goal for the next 12 months, with a number and a date, is an easy way to start building.',
        mid: 'You think about growth and you set goals, though not always on a schedule. Adding a quarterly review of your progress turns good intentions into steady momentum.',
        high: 'Building is a strong pull. You think in goals and long-term progress, and that vision is powerful. Make sure what you build is protected with the right coverage and documents, and that you leave room to enjoy the life you are building.'
      },
      reflect: 'What am I really building toward, and how will I know when I have built enough?',
      actions: [
        'Tonight, write one sentence on why you are building wealth and keep it where you will read it before your next big money decision.',
        'This week, review your insurance policies and the beneficiaries on every account to make sure what you have built is protected.',
        'Within the next 30 days, plan and pay for one meaningful experience without counting it against your goals.'
      ]
    },
    {
      key: 'giver',
      label: 'The Giver',
      desc: 'Money is a way to care for people. You are generous with family, friends and causes.',
      why: 'The Giver shapes how you balance caring for others with caring for your own future. Generosity lasts longest when it comes from a strong foundation.',
      headline: 'Your money personality is The Giver',
      summary: 'Your strength is generosity: people around you are better off because of you. Your blind spot is that giving without limits can leave your own foundation thin, with your savings and future coming last. You cannot keep giving from an empty account. Your next level is building a plan that funds your future and your generosity on purpose.',
      levels: {
        low: 'Giving money is not a major driver for you right now. That may reflect a season of building your own foundation, which is wise. When you are ready, a small, planned giving amount can bring real meaning without strain.',
        mid: 'You give generously and you also keep your own goals in view. That balance is healthy. The test comes when someone you love asks for help, so decide ahead of time what you can give without hurting your plan.',
        high: 'Generosity is a strong pull, and the people around you feel it. The risk is that your own savings and future get funded last, or not at all. Setting a giving budget lets you keep being generous for decades instead of until the money runs out.'
      },
      reflect: 'If I treated my own future the way I treat the people I love, what would I do differently this month?',
      actions: [
        'Before the end of this month, decide on a monthly giving amount and give from that budget instead of deciding case by case.',
        'This week, practice one kind, clear no to a request that does not fit your plan, using a simple line like "I cannot this time, but I care about you."',
        'Before your next payday, set your emergency savings transfer to go out first, before any gifts or giving.'
      ]
    }
  ],
  questions: [
    { dim: 'protector', text: 'I feel most at peace when I have a healthy amount saved.' },
    { dim: 'protector', text: 'I think carefully about what could go wrong before I spend or invest.' },
    { dim: 'protector', text: 'I would rather keep money safe than take a chance on growing it.' },

    { dim: 'enjoyer', text: 'I believe money is meant to be enjoyed now, not just saved for later.' },
    { dim: 'enjoyer', text: 'I often spend on experiences, treats or upgrades that make life feel good.' },
    { dim: 'enjoyer', text: 'I tend to make spending decisions in the moment.' },
    { dim: 'enjoyer', text: 'Treating myself is an important part of how I reward hard work.' },

    { dim: 'avoider', text: 'I would rather not think about money unless I have to.' },
    { dim: 'avoider', text: 'I sometimes put off opening bills or checking my balance.' },
    { dim: 'avoider', text: 'Money conversations make me want to change the subject.' },

    { dim: 'builder', text: 'I see money mainly as a tool to build something bigger.' },
    { dim: 'builder', text: 'I enjoy setting financial goals and tracking my progress toward them.' },
    { dim: 'builder', text: 'I regularly look for ways to grow my income or my net worth.' },

    { dim: 'giver', text: 'Helping family and friends with money brings me real joy.' },
    { dim: 'giver', text: 'I find it hard to say no when someone I care about needs help.' },
    { dim: 'giver', text: 'Giving to my church, community or causes is a priority in my budget.' }
  ],
  related: ['financial-readiness', 'limiting-beliefs', 'find-your-why'],
  cta: { label: 'Explore financial services', href: '/financial-services' }
};
