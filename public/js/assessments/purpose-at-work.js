// Purpose at Work: is your work aligned with your calling.
export default {
  slug: 'purpose-at-work',
  title: 'Purpose at Work',
  category: 'purpose',
  mode: 'score',
  minutes: 5,
  hook: 'Is your work a job, a career, or a calling?',
  short: 'See how well your work lines up with your purpose across meaning, fit, growth, contribution, and future.',
  intro: 'Eighteen statements about the work you do today. Answer for how it really is, not how it reads on your resume.',
  dimensions: [
    {
      key: 'meaning',
      label: 'Meaning',
      desc: 'Feeling that your work matters and connects to something you care about.',
      actions: [
        'Write one sentence that connects your current role to a cause or person you care about. Read it each morning this week.',
        'At the end of each workday, note one moment that felt meaningful and why.',
        'Ask a colleague or client what they value most about your work, and listen for the purpose in their answer.'
      ]
    },
    {
      key: 'fit',
      label: 'Fit',
      desc: 'Doing work that uses your strengths and suits who you are.',
      actions: [
        'List the five tasks you did most this week. Mark each one as energizing, neutral, or draining.',
        'Choose one draining task and find a way to delegate, automate, or reduce it.',
        'Volunteer for one assignment this week that plays directly to your strongest skill.'
      ]
    },
    {
      key: 'growth',
      label: 'Growth',
      desc: 'Becoming more capable and closer to your potential through the work itself.',
      actions: [
        'Write down the one skill your next role will require. Spend thirty minutes on it this week.',
        'Ask your manager or a mentor: what would it take for me to grow faster here?',
        'Take on one task this week that is slightly beyond what you know how to do.'
      ]
    },
    {
      key: 'contribution',
      label: 'Contribution',
      desc: 'Seeing how your effort serves people beyond your own paycheck.',
      actions: [
        'Identify who ultimately benefits from your work and write their name or role at the top of your task list.',
        'Share one useful idea, resource, or lesson with your team this week without being asked.',
        'Spend one hour helping a colleague or client succeed at something that matters to them.'
      ]
    },
    {
      key: 'future',
      label: 'Future',
      desc: 'Seeing a path from where you are now to the work you feel called to do.',
      actions: [
        'Describe the work you feel called to do in three sentences. Be specific about who it serves.',
        'Map one bridge between your current role and that calling: a project, skill, or relationship you can start this month.',
        'Have one conversation this week with someone already doing the kind of work you feel drawn to.'
      ]
    }
  ],
  questions: [
    { dim: 'meaning', text: 'The work I do every day matters to me personally.' },
    { dim: 'meaning', text: 'I can clearly explain how my work connects to something bigger than a paycheck.' },
    { dim: 'meaning', text: 'I mostly work for the money and the weekend.', reverse: true },
    { dim: 'meaning', text: 'I often feel a sense of purpose during my workday.' },

    { dim: 'fit', text: 'My role uses the strengths I am best at.' },
    { dim: 'fit', text: 'I often feel like I am pretending to be someone else at work.', reverse: true },
    { dim: 'fit', text: 'The values of the organization I work in match my own.' },

    { dim: 'growth', text: 'I am becoming more capable because of the work I do.' },
    { dim: 'growth', text: 'I have learned very little in my role over the last year.', reverse: true },
    { dim: 'growth', text: 'My work regularly challenges me in ways that help me grow.' },

    { dim: 'contribution', text: 'I can see the people who benefit from my work.' },
    { dim: 'contribution', text: 'My contributions are valued by the people I work with.' },
    { dim: 'contribution', text: 'I am making the kind of difference I hoped to make when I started this work.' },
    { dim: 'contribution', text: 'If I stopped tomorrow, I am not sure anyone would feel the difference.', reverse: true },

    { dim: 'future', text: 'I can see a clear path from my current work to the work I feel called to do.' },
    { dim: 'future', text: 'I feel stuck in a role that does not lead where I want to go.', reverse: true },
    { dim: 'future', text: 'I am taking intentional steps toward the work I want to be doing in five years.' },
    { dim: 'future', text: 'When I picture my career a few years from now, I feel excited about it.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Just a Job',
      summary: 'Right now, your work is paying the bills more than it is feeding your purpose. That is more common than people admit, and it is not permanent. Clarity about what you are called to do is the first step, and you can start building that bridge from exactly where you are.'
    },
    {
      min: 50,
      label: 'Career in Progress',
      summary: 'Parts of your work genuinely fit you, and parts feel disconnected from why you do it. You are closer to alignment than it may feel. Strengthening your lowest area below can turn a solid career into work that feels like it is truly yours.'
    },
    {
      min: 75,
      label: 'Calling in Motion',
      summary: 'Your work and your purpose are largely moving in the same direction. That alignment is a real advantage, for you and for the people you serve. Your next step is to protect it and to keep growing into the fullest version of that calling.'
    }
  ],
  related: ['find-your-why', 'success-on-paper', 'burnout-check'],
  cta: { label: 'Book a free strategy call', href: '/book-a-call' }
};
