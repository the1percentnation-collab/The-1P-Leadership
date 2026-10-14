// Financial Readiness: flagship of the money category. Six areas that show how ready your money is for the life you want.
export default {
  slug: 'financial-readiness',
  title: 'The Financial Readiness Score',
  category: 'money',
  mode: 'score',
  minutes: 6,
  featured: true,
  hook: "You're building a life on purpose. Is your money keeping up?",
  short: 'See how ready your money is for the life you want across cash flow, safety net, debt, protection, future and clarity.',
  intro: 'Twenty-four honest statements about where your money stands today. Answer for how things are right now, not how you plan for them to be.',
  disclaimer: 'This assessment is for educational purposes only and is not financial, legal, tax or investment advice. Talk with a licensed professional about your situation.',
  dimensions: [
    {
      key: 'cashFlow',
      label: 'Cash Flow',
      desc: 'Knowing where your money goes each month and keeping more coming in than going out.',
      why: 'Cash flow is the engine for every other money goal. Saving, paying down debt and investing all come from the gap between what you earn and what you spend.',
      levels: {
        low: 'Right now your money is moving faster than your attention. That does not mean you are careless. It usually means no one ever showed you a simple system. Start by simply seeing where it goes for one month, without judging any of it.',
        mid: 'You have a general sense of your spending and you usually stay ahead. The gap is precision: a few categories quietly take more than you think. A short weekly check-in will turn a general sense into real control.',
        high: 'You know where your money goes and you keep a healthy margin each month. That margin is what funds everything else on this list. Protect it as your income grows so lifestyle does not quietly absorb it.'
      },
      reflect: 'If my spending last month were a statement of my priorities, what would it say I value most?',
      leverage: 'Your monthly margin is your fuel. Point a fixed amount of it at your weakest area on payday so progress happens automatically.',
      actions: [
        'This weekend, pull your last 30 days of bank and card statements and sort every expense into three columns: needs, wants and savings.',
        'Within the next seven days, list every subscription and auto-payment you have and cancel at least one you would not sign up for again today.',
        'Put a 15 minute money check-in on your calendar every Sunday for the next four weeks, and use it to compare what you spent against what you planned.'
      ]
    },
    {
      key: 'safetyNet',
      label: 'Safety Net',
      desc: 'Having cash set aside so a surprise expense stays an inconvenience, not a crisis.',
      why: 'Life will hand you a surprise expense. A safety net decides whether that moment is a hassle or a setback that sends you to a credit card.',
      levels: {
        low: 'A surprise expense would likely land on a card or a loan right now. That is a very common place to be, and it changes faster than most people expect. Many people start with a first goal of $1,000, then build toward one full month of essential expenses.',
        mid: 'You have some cushion, enough to handle a small surprise. The next step is depth. Many people aim for three to six months of essential expenses, and more if their income is variable or they support others.',
        high: 'You have a real cushion, and it gives you choices most people do not have. Make sure it lives in a separate account and is clearly labeled, so it stays an emergency fund and not a spending fund.'
      },
      reflect: 'What would change in how I feel day to day if I knew a surprise $1,000 bill would not shake me?',
      leverage: 'Your cushion buys you calm. Use that calm to make a clear, unhurried decision in your weakest area instead of a reactive one.',
      actions: [
        'This week, open a separate savings account used only for emergencies, and give it a name like "Safety Net" so its purpose is clear.',
        'Before your next payday, set up an automatic transfer to that account for the day your pay arrives, even if it starts at $25.',
        'Tonight, add up one month of essential expenses (housing, utilities, food, transportation, insurance, minimum payments) and write that number down as your first milestone.'
      ]
    },
    {
      key: 'debt',
      label: 'Debt',
      desc: 'Owing on purpose, with a clear plan to pay it down, instead of letting balances run your choices.',
      why: 'Every dollar going to interest is a dollar that cannot build your future. A clear debt plan turns a weight you carry into a finish line you can see.',
      levels: {
        low: 'Debt is likely shaping more of your choices than you would like, and it may feel heavy to look at. Looking is still the first step, and it almost always feels lighter afterward. One page with every balance on it is where your plan begins.',
        mid: 'You know your debts and you are making progress, but the plan may not be fully written down. Many people choose either the smallest balance first for momentum, or the highest interest rate first to save the most. Picking one method and sticking with it speeds things up.',
        high: 'Your debt is under control and serves a purpose. You know your balances, your rates and your timeline. Keep it that way by deciding in advance what new debt, if any, fits your goals.'
      },
      reflect: 'What would I do with the money I send to debt payments each month once those payments are gone?',
      leverage: 'The discipline you use on debt is the same discipline any goal needs. Once a balance is paid off, roll that payment straight into your weakest area.',
      actions: [
        'This weekend, write every debt on one page with its balance, interest rate, minimum payment and due date.',
        'This month, choose one debt to focus on first, either smallest balance or highest rate, and add any extra amount, even $20, to that payment.',
        'Within the next seven days, turn on autopay for the minimum payment on every debt so nothing is ever late by accident.'
      ]
    },
    {
      key: 'protection',
      label: 'Protection',
      desc: 'Having the right coverage in place so one hard event does not undo years of progress.',
      why: 'Everything you build can be undone by one illness, accident or loss if it is not protected. Coverage is what keeps a hard event from becoming a financial reset.',
      levels: {
        low: 'You may not be sure what your coverage includes, or whether you have the right kinds. That is common, because policies are not written to be easy to read. Gathering what you have in one place is a calm, simple first step.',
        mid: 'You have some coverage in place and a general idea of what it does. The gaps are usually in disability coverage or in life coverage that has not kept up with your family or income. A yearly review keeps it current.',
        high: 'You understand your coverage and you have reviewed it recently. That is real peace of mind for you and the people who count on you. Revisit it after any major life change, like a new child, home or job.'
      },
      reflect: 'If I could not work for six months starting tomorrow, what would happen to my household?',
      leverage: 'Knowing you are protected frees you to take thoughtful steps elsewhere. Use that security to make the change your weakest area needs without fear of one bad break.',
      actions: [
        'This week, gather every insurance policy you have (health, life, disability, home or renters, auto) into one physical or digital folder.',
        'Over the weekend, write one line for each policy saying what it covers and who it protects, and circle anything you are unsure about.',
        'Before the end of the month, write three questions about your coverage and bring them to a licensed professional.'
      ]
    },
    {
      key: 'future',
      label: 'Future',
      desc: 'Putting money to work today for the version of you that will need it later.',
      why: 'Time is the biggest advantage you have when saving for the future. Small, steady contributions made early do more work than large ones made late.',
      levels: {
        low: 'Saving for later has probably taken a back seat to the needs of today. That is understandable, and it is not too late. A small automatic contribution started now matters more than the perfect amount started someday.',
        mid: 'You are contributing to your future, which puts you ahead of many people. The next step is intention. Many people aim to save 10 to 15 percent of income for retirement over time, and capturing any full employer match is a common first target.',
        high: 'You are investing in your future on a steady schedule and you have a picture of what you are building toward. Keep reviewing it once a year and increase your contribution when your income rises.'
      },
      reflect: 'What does a good day look like for me at 70, and what am I doing today to pay for it?',
      leverage: 'You already think long term. Apply that patience to your weakest area by choosing one small step you can repeat every month rather than one big fix.',
      actions: [
        'This week, log in to your retirement account, or ask HR whether your employer offers one, and write down your current contribution percentage.',
        'Before your next paycheck, confirm whether you are contributing enough to receive your full employer match, if one is offered.',
        'Tonight, write the age at which you hope work becomes optional and three sentences about what that life looks like.'
      ]
    },
    {
      key: 'clarity',
      label: 'Clarity',
      desc: 'Knowing your numbers and having written goals that give your money a direction.',
      why: 'Money without direction tends to drift toward whatever is loudest. Clear numbers and written goals tell every dollar where it is supposed to go.',
      levels: {
        low: 'Your money does not have a clear destination yet, so it is hard to know if you are winning. That is not a character flaw. It is a missing map. One page with your net worth and three goals will change how every money decision feels.',
        mid: 'You have a sense of your goals, but some of them are wishes without numbers or dates. Adding both turns a hope into a plan you can track.',
        high: 'You know your numbers and your money has a direction. That clarity makes every decision faster and calmer. Share your goals with the people they affect so you are building together.'
      },
      reflect: 'If my money could talk, what would it say it is being used for right now?',
      leverage: 'Your clarity is a planning tool. Write one specific, dated goal for your weakest area and put it next to your other goals.',
      actions: [
        'This weekend, calculate your net worth on one page: list what you own, list what you owe and subtract. No judgment, just a starting point.',
        'Within the next seven days, write your top three financial goals for the next 12 months, each with a dollar amount and a target date.',
        'Before Sunday, share those three goals with your spouse, partner or one trusted person and ask them to check in with you in 30 days.'
      ]
    }
  ],
  questions: [
    { dim: 'cashFlow', text: 'I know roughly how much I spend each month and where it goes.' },
    { dim: 'cashFlow', text: 'I often reach the end of the month wondering where my money went.', reverse: true },
    { dim: 'cashFlow', text: 'I spend less than I earn in a typical month.' },
    { dim: 'cashFlow', text: 'I have a simple plan for my money before each month begins.' },

    { dim: 'safetyNet', text: 'I could cover an unexpected $1,000 expense without using a credit card or borrowing.' },
    { dim: 'safetyNet', text: 'I have savings set aside that I use only for emergencies.' },
    { dim: 'safetyNet', text: 'If my income stopped next month, I would be in trouble almost immediately.', reverse: true },
    { dim: 'safetyNet', text: 'I know how many months of essential expenses my savings would cover.' },

    { dim: 'debt', text: 'I know the balance and interest rate on every debt I have.' },
    { dim: 'debt', text: 'I have a clear plan and timeline for paying down my debt.' },
    { dim: 'debt', text: 'I regularly carry a credit card balance I cannot pay off in full.', reverse: true },
    { dim: 'debt', text: 'My debt payments leave me enough room to save each month.' },

    { dim: 'protection', text: 'I understand what my current insurance policies cover.' },
    { dim: 'protection', text: 'If I could not work for several months, I know how my bills would get paid.' },
    { dim: 'protection', text: 'I have not reviewed my insurance coverage in years.', reverse: true },
    { dim: 'protection', text: 'The people who depend on me would be financially cared for if something happened to me.' },

    { dim: 'future', text: 'I contribute to a retirement account on a regular schedule.' },
    { dim: 'future', text: 'I have a rough idea of what I will need to retire the way I want.' },
    { dim: 'future', text: 'I am putting off saving for the future until my income is higher.', reverse: true },
    { dim: 'future', text: 'When my income goes up, I increase what I save for the future.' },

    { dim: 'clarity', text: 'I have written financial goals with specific numbers and dates.' },
    { dim: 'clarity', text: 'I know my approximate net worth.' },
    { dim: 'clarity', text: 'My spending reflects what I say matters most to me.' },
    { dim: 'clarity', text: 'I am not sure whether I am making real financial progress from year to year.', reverse: true }
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
