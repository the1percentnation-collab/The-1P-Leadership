// Financial Readiness: flagship of the money category. Six areas that show how ready your money is for the life you want.
export default {
  slug: 'financial-readiness',
  title: 'The Financial Readiness Score',
  category: 'money',
  mode: 'score',
  minutes: 5,
  featured: true,
  hook: "You're building a life on purpose. Is your money keeping up?",
  short: 'See how ready your money is for the life you want across cash flow, safety net, debt, protection, future and clarity.',
  intro: "Eighteen honest statements about where your money stands today. Answer for how things are right now, not how you plan for them to be.",
  disclaimer: 'This assessment is for educational purposes only and is not financial, legal, tax or investment advice. Talk with a licensed professional about your situation.',
  dimensions: [
    {
      key: 'cashFlow',
      label: 'Cash Flow',
      desc: 'Knowing where your money goes each month and keeping more coming in than going out.',
      actions: [
        "Pull your last 30 days of bank and card statements. Sort every expense into needs, wants and savings.",
        'List every monthly subscription and auto-payment. Cancel one you would not sign up for again today.',
        'Set a 15 minute money check-in on your calendar every Sunday for the next four weeks.'
      ]
    },
    {
      key: 'safetyNet',
      label: 'Safety Net',
      desc: 'Having cash set aside so a surprise expense stays an inconvenience, not a crisis.',
      actions: [
        'Open a separate savings account used only for emergencies, and name it so you know what it is for.',
        'Set up an automatic transfer to that account on payday, even if it starts small.',
        'Add up one month of your essential expenses. That number is your first emergency fund milestone.'
      ]
    },
    {
      key: 'debt',
      label: 'Debt',
      desc: 'Owing on purpose, with a clear plan to pay it down, instead of letting balances run your choices.',
      actions: [
        'Write every debt on one page: balance, interest rate, minimum payment and due date.',
        'Pick one debt to focus on first and add any extra amount, even a small one, to that payment this month.',
        'Turn on autopay for every minimum payment so nothing is ever late by accident.'
      ]
    },
    {
      key: 'protection',
      label: 'Protection',
      desc: 'Having the right coverage in place so one hard event does not undo years of progress.',
      actions: [
        'Gather every insurance policy you have (health, life, disability, home or renters, auto) into one folder.',
        'For each policy, write down what it covers and who it protects. Note any gaps you are unsure about.',
        'Write three questions about your coverage to bring to a licensed professional.'
      ]
    },
    {
      key: 'future',
      label: 'Future',
      desc: 'Putting money to work today for the version of you that will need it later.',
      actions: [
        'Log in to your retirement account, or find out whether your employer offers one, and write down your current contribution.',
        'If your employer offers a match, confirm whether you are contributing enough to receive all of it.',
        'Write down the age you hope to have work be optional, and one sentence about what that life looks like.'
      ]
    },
    {
      key: 'clarity',
      label: 'Clarity',
      desc: 'Knowing your numbers and having written goals that give your money a direction.',
      actions: [
        'Calculate your net worth on one page: what you own minus what you owe. No judgment, just a starting point.',
        'Write your top three financial goals for the next 12 months, each with a number and a date.',
        'Share those goals with your spouse, partner or one trusted person this week.'
      ]
    }
  ],
  questions: [
    { dim: 'cashFlow', text: 'I know roughly how much I spend each month and where it goes.' },
    { dim: 'cashFlow', text: 'I often reach the end of the month wondering where my money went.', reverse: true },
    { dim: 'cashFlow', text: 'I spend less than I earn in a typical month.' },

    { dim: 'safetyNet', text: 'I could cover an unexpected $1,000 expense without using a credit card or borrowing.' },
    { dim: 'safetyNet', text: 'I have savings set aside that I use only for emergencies.' },
    { dim: 'safetyNet', text: 'If my income stopped next month, I would be in trouble almost immediately.', reverse: true },

    { dim: 'debt', text: 'I know the balance and interest rate on every debt I have.' },
    { dim: 'debt', text: 'I have a clear plan and timeline for paying down my debt.' },
    { dim: 'debt', text: 'I regularly carry a credit card balance I cannot pay off in full.', reverse: true },

    { dim: 'protection', text: 'I understand what my current insurance policies cover.' },
    { dim: 'protection', text: 'If I could not work for several months, I know how my bills would get paid.' },
    { dim: 'protection', text: 'I have not reviewed my insurance coverage in years.', reverse: true },

    { dim: 'future', text: 'I contribute to a retirement account on a regular schedule.' },
    { dim: 'future', text: 'I have a rough idea of what I will need to retire the way I want.' },
    { dim: 'future', text: 'I am putting off saving for the future until my income is higher.', reverse: true },

    { dim: 'clarity', text: 'I have written financial goals with specific numbers and dates.' },
    { dim: 'clarity', text: 'I know my approximate net worth.' },
    { dim: 'clarity', text: 'My spending reflects what I say matters most to me.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Starting Line',
      summary: 'Your money is not yet set up to support the life you want, and that is a common place to be. Most people were never taught this. Clarity comes first, and a few simple steps this month will create real momentum.'
    },
    {
      min: 50,
      label: 'Building Momentum',
      summary: 'You have real pieces in place and you are making progress. A few gaps are still exposed, and they are usually the ones that feel least urgent until they matter. Strengthen your lowest area and the rest of your plan gets steadier.'
    },
    {
      min: 75,
      label: 'Financially Aligned',
      summary: 'Your money is working with your goals, not against them. That takes discipline. Your next step is to review your plan on a schedule and make sure your protection and future goals keep pace as your life grows.'
    }
  ],
  related: ['money-mindset', 'legacy-protection', 'alignment-scorecard'],
  cta: { label: 'Explore financial services', href: '/financial-services' }
};
