// Sales Mindset: for salespeople and sales leaders. Six areas that separate consistent producers from streaky ones.
export default {
  slug: 'sales-mindset',
  title: 'The Sales Mindset Score',
  category: 'team',
  mode: 'score',
  minutes: 5,
  hook: 'Your pipeline reflects your mindset before it reflects your market.',
  short: 'Find out which part of your sales mindset is driving your results and which part is quietly holding them back.',
  intro: 'Eighteen statements about how you sell. Answer for how you actually operate on an ordinary week, not your best one.',
  dimensions: [
    {
      key: 'prospecting',
      label: 'Prospecting Discipline',
      desc: 'Filling the pipeline on a schedule, whether or not you feel like it.',
      actions: [
        'Block the same 60 minutes on your calendar every weekday this week for prospecting only.',
        'Set a daily number of new conversations to start, write it down and track it each day.',
        'Build a list of 25 people you have not contacted in 90 days and reach out to five of them this week.'
      ]
    },
    {
      key: 'conviction',
      label: 'Belief in Your Offer',
      desc: 'Knowing your offer helps people, so asking for the business feels like service.',
      actions: [
        'Write down three clients your offer genuinely helped and the specific result each one got.',
        'Practice your offer out loud in under 60 seconds until you can say it without hedging.',
        'Ask one happy client this week for a short testimonial in their own words.'
      ]
    },
    {
      key: 'resilience',
      label: 'Handling Rejection',
      desc: 'Hearing no without taking it personally, and getting back to work quickly.',
      actions: [
        'Track every no this week. At the end of the week, write what each one taught you.',
        'After your next no, make your next call within ten minutes.',
        'Write the three objections you hear most, with a calm, honest response to each.'
      ]
    },
    {
      key: 'followUp',
      label: 'Follow-Up Systems',
      desc: 'Staying in contact with every lead until they buy or clearly say no.',
      actions: [
        'Put every open lead into one place, a CRM or a simple spreadsheet, with the date of your next touch.',
        'Write a follow-up sequence of five touches you can reuse for every new prospect.',
        'Contact every lead that has gone quiet in the last 30 days before Friday.'
      ]
    },
    {
      key: 'discovery',
      label: 'Listening and Discovery',
      desc: 'Understanding what someone needs before you present anything.',
      actions: [
        'Write five open questions you will ask before you present anything on your next call.',
        'On your next three calls, aim to listen for at least two thirds of the conversation.',
        'After each call this week, write down the prospect\'s main problem in their own words.'
      ]
    },
    {
      key: 'goalClarity',
      label: 'Goal Clarity',
      desc: 'Knowing your numbers and the daily activity it takes to hit them.',
      actions: [
        'Write your income goal for the next 90 days, then work backward to how many conversations you need each week.',
        'Track your conversion rate from conversations to sales for the next two weeks.',
        'Every Friday, score your activity against your target and adjust next week, without judging last week.'
      ]
    }
  ],
  questions: [
    { dim: 'prospecting', text: 'I have set times on my calendar for prospecting every week.' },
    { dim: 'prospecting', text: 'I prospect consistently, even when my pipeline feels full.' },
    { dim: 'prospecting', text: 'I mostly prospect when sales are slow and I am under pressure.', reverse: true },

    { dim: 'conviction', text: 'I fully believe the people I sell to are better off because they bought.' },
    { dim: 'conviction', text: 'I can explain the value of my offer clearly and confidently.' },
    { dim: 'conviction', text: 'I feel awkward asking for the sale.', reverse: true },

    { dim: 'resilience', text: 'When a prospect says no, I move on to the next conversation quickly.' },
    { dim: 'resilience', text: 'A few rejections in a row can throw off my whole week.', reverse: true },
    { dim: 'resilience', text: 'I see objections as questions to answer, not as attacks.' },

    { dim: 'followUp', text: 'I have a system that tells me exactly who to follow up with each day.' },
    { dim: 'followUp', text: 'I follow up with prospects multiple times before I let a lead go.' },
    { dim: 'followUp', text: 'Good leads regularly slip through the cracks because I forget to follow up.', reverse: true },

    { dim: 'discovery', text: 'I ask questions and listen before I present my offer.' },
    { dim: 'discovery', text: 'By the end of a sales conversation, I understand the prospect\'s real problem.' },
    { dim: 'discovery', text: 'I tend to talk more than the prospect does on sales calls.', reverse: true },

    { dim: 'goalClarity', text: 'I know my sales targets for this month and this quarter.' },
    { dim: 'goalClarity', text: 'I know how many conversations it takes for me to make one sale.' },
    { dim: 'goalClarity', text: 'At the end of each week, I review my numbers against my goals.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Riding the Waves',
      summary: 'Your results probably feel up and down, and that is a signal, not a verdict. Strong sellers are built on systems and belief, and both can be learned. Pick your lowest area, put one discipline in place this week and the swings start to smooth out.'
    },
    {
      min: 50,
      label: 'Building Consistency',
      summary: 'You have real sales skill and some solid habits. What is holding you back is usually one area that breaks down under pressure, like follow-up or prospecting when things get busy. Tighten that one area and your results become far more predictable.'
    },
    {
      min: 75,
      label: 'Closer Mindset',
      summary: 'You sell with discipline, belief and a clear plan. That is what top producers have in common. Your next level is leverage: teaching your system to others, raising your targets and protecting the habits that got you here.'
    }
  ],
  related: ['discipline-score', 'limiting-beliefs', 'team-alignment'],
  cta: { label: 'Book a free strategy call', href: '/book-a-call' }
};
