// Legacy Protection: a calm look at whether the people you love are covered and the plan is in place.
export default {
  slug: 'legacy-protection',
  title: 'The Legacy Protection Check',
  category: 'money',
  mode: 'score',
  minutes: 5,
  hook: 'If something happened to you tomorrow, would your family be okay?',
  short: 'A calm, clear look at whether the people you love are protected and your legacy plan is in place.',
  intro: 'Eighteen statements about the plans you have in place for the people who count on you. Answer honestly. Clarity is the first step toward peace of mind.',
  disclaimer: 'This assessment is for educational purposes only and is not financial, legal, tax or investment advice. Talk with a licensed professional about your situation.',
  dimensions: [
    {
      key: 'lifeCoverage',
      label: 'Life Coverage',
      desc: 'Having enough life insurance in place to care for the people who depend on your income.',
      actions: [
        'Find every life insurance policy you have, including any through work, and write down the coverage amount for each.',
        'Add up the debts and major costs your family would face, like the mortgage and education, and compare them to that coverage.',
        'Write three questions about your coverage to bring to a licensed professional.'
      ]
    },
    {
      key: 'documents',
      label: 'Estate Documents',
      desc: 'Having a will and key documents that make your wishes clear and legal.',
      actions: [
        'Write down whether you have a will, a power of attorney and a healthcare directive, and the date each was last updated.',
        'If you have minor children, write the name of the person you would want as their guardian.',
        'Schedule a consultation with an estate planning attorney to start or update your documents.'
      ]
    },
    {
      key: 'beneficiaries',
      label: 'Beneficiaries',
      desc: 'Making sure every account and policy goes to the right people, the way you intend.',
      actions: [
        'List every account and policy that has a beneficiary: retirement, life insurance, bank accounts.',
        'Log in to each one and confirm the named beneficiary is still who you want.',
        'Add a contingent beneficiary anywhere one is missing.'
      ]
    },
    {
      key: 'incomeProtection',
      label: 'Income Protection',
      desc: 'Knowing how your household would keep going if you could not work for a while.',
      actions: [
        'Check whether you have disability coverage through work and write down what it pays and for how long.',
        'Calculate how many months your savings would cover your essential bills.',
        'Write a one page plan for which expenses would pause and which would continue if your income stopped.'
      ]
    },
    {
      key: 'familyConversations',
      label: 'Family Conversations',
      desc: 'Making sure the people who matter know your wishes and where to find what they need.',
      actions: [
        'Create a simple document listing your accounts, policies, key contacts and where important papers are kept.',
        'Tell one trusted person where that document lives and how to access it.',
        'Set a time this month to talk with your spouse or family about your wishes, calmly and without pressure.'
      ]
    },
    {
      key: 'generationalPlan',
      label: 'Generational Plan',
      desc: 'Thinking beyond your lifetime about what you want to pass on, in money and in values.',
      actions: [
        'Write a short letter describing the values you hope to pass on to the next generation.',
        'Write down one financial goal that would benefit your children or grandchildren, with a number and a date.',
        'Start one money conversation with a younger family member this week, like how saving or giving works.'
      ]
    }
  ],
  questions: [
    { dim: 'lifeCoverage', text: 'I have life insurance in place for the people who depend on my income.' },
    { dim: 'lifeCoverage', text: 'I know roughly how much coverage my family would need to stay in their home and keep their plans.' },
    { dim: 'lifeCoverage', text: 'The only life insurance I have is whatever my employer provides, and I am not sure what it covers.', reverse: true },

    { dim: 'documents', text: 'I have a current will.' },
    { dim: 'documents', text: 'I have named someone to make financial and medical decisions if I cannot.' },
    { dim: 'documents', text: 'I keep meaning to set up my estate documents but have not gotten to it.', reverse: true },

    { dim: 'beneficiaries', text: 'I have reviewed the beneficiaries on my accounts and policies in the last two years.' },
    { dim: 'beneficiaries', text: 'Every account and policy I own has a named beneficiary.' },
    { dim: 'beneficiaries', text: 'I am not sure who is listed as the beneficiary on some of my accounts.', reverse: true },

    { dim: 'incomeProtection', text: 'If I could not work for six months, my household could still cover its essential bills.' },
    { dim: 'incomeProtection', text: 'I know whether I have disability coverage and what it would pay.' },
    { dim: 'incomeProtection', text: 'My household depends on my paycheck with no backup plan.', reverse: true },

    { dim: 'familyConversations', text: 'My spouse or a trusted person knows where to find my important documents and accounts.' },
    { dim: 'familyConversations', text: 'I have talked with my family about my wishes.' },
    { dim: 'familyConversations', text: 'My family would know who to call first if something happened to me.' },

    { dim: 'generationalPlan', text: 'I have a clear picture of what I want to leave behind for the next generation.' },
    { dim: 'generationalPlan', text: 'I am intentionally teaching my children or younger family members about money.' },
    { dim: 'generationalPlan', text: 'I am taking steps today to build wealth that can outlast me.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Foundation Needed',
      summary: 'Some key protections are not in place yet. That is more common than most people admit, and it is fully within your control. A few calm, simple steps this month will give your family far more security than they have today.'
    },
    {
      min: 50,
      label: 'Partly Protected',
      summary: 'You have taken real steps to care for the people you love. There are still a few gaps, often in documents, beneficiaries or family conversations. Close the one that matters most first and your plan becomes much stronger.'
    },
    {
      min: 75,
      label: 'Legacy Ready',
      summary: 'You have built a strong foundation of protection for the people who count on you. That is an act of love and discipline. Keep it current by reviewing your plan once a year and after every major life change.'
    }
  ],
  related: ['financial-readiness', 'money-mindset', 'find-your-why'],
  cta: { label: 'Explore financial services', href: '/financial-services' }
};
