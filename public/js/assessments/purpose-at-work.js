// Purpose at Work: is your work aligned with your calling.
export default {
  slug: 'purpose-at-work',
  title: 'Purpose at Work',
  category: 'purpose',
  mode: 'score',
  minutes: 5,
  hook: 'Is your work a job, a career, or a calling?',
  short: 'See how well your work lines up with your purpose across meaning, fit, growth, contribution, and future.',
  intro: 'A few honest minutes on the work you do today. Answer for how it really is, not how it reads on your resume.',
  dimensions: [
    {
      key: 'meaning',
      label: 'Meaning',
      desc: 'Feeling that your work matters and connects to something you care about.',
      goal: 'Connect your daily work to something you care about',
      why: 'You spend a large share of your waking hours at work. When that time connects to something you care about, effort feels like investment instead of a trade for a paycheck.',
      levels: {
        low: 'Right now, your work feels mostly like a way to pay the bills. The days may blur together, and the weekend carries most of the weight. That is common and it is not permanent. Finding even one thread between your work and something you care about can change how the week feels.',
        mid: 'You feel a sense of purpose in parts of your work, especially on good days. On busy or political days, it fades and the work feels like a job again. Naming what makes the meaningful moments meaningful will help you find more of them.',
        high: 'Your work matters to you personally, and you can explain why. That sense of meaning gives you staying power when the work gets hard. Keep it fresh by noticing the moments and people that remind you why you do this.'
      },
      reflect: 'When did my work last feel like it truly mattered, and what was I doing in that moment?',
      leverage: 'Use your sense of meaning to fuel change in your weakest area. Connect the effort there to the reason your work matters to you.',
      actions: [
        'Tomorrow morning, write one sentence that connects your current role to a cause or person you care about. Read it at the start of each workday this week.',
        'At the end of each workday for the next five days, note one moment that felt meaningful and why.',
        'Within the next two weeks, ask a colleague or client what they value most about your work, and listen for the purpose in their answer.'
      ]
    },
    {
      key: 'fit',
      label: 'Fit',
      desc: 'Doing work that uses your strengths and suits who you are.',
      goal: 'Spend more of your workday in your strengths',
      why: 'Work that fits your strengths and values takes less out of you and gives more back. Poor fit wears you down, even when the job looks good on paper.',
      levels: {
        low: 'Much of your work asks you to be someone you are not, or to rely on skills that drain you. That can leave you tired in a way rest does not fix. The first step is to get specific about which tasks drain you and which ones bring you alive.',
        mid: 'Your role uses some of your best strengths, but a good part of your week goes to work that does not suit you. You may also feel some gap between your values and the culture around you. Shifting even a few hours toward your strengths can change how your work feels.',
        high: 'Your work fits who you are. You use your strengths most days and feel at home in the values around you. That fit is a big reason your energy holds up. Keep shaping your role to protect it as things change.'
      },
      reflect: 'Which parts of my work would I happily do even if nobody asked me to?',
      leverage: 'Your strengths are your best tool for change. Look for a way to use them to make progress in your weakest area.',
      actions: [
        'On Friday, list the five tasks you did most this week. Mark each one as energizing, neutral, or draining.',
        'Next week, choose one draining task from that list and find a way to delegate, automate, or reduce it by at least half.',
        'Within the next two weeks, volunteer for one assignment that plays directly to your strongest skill.'
      ]
    },
    {
      key: 'growth',
      label: 'Growth',
      desc: 'Becoming more capable and closer to your potential through the work itself.',
      goal: 'Grow your skills through the work you already do',
      why: 'Work that stops growing you slowly shrinks your future options. Growth keeps you capable, engaged and ready for the next opportunity.',
      levels: {
        low: 'You have not learned much in your role lately, and the work no longer stretches you. That can feel comfortable at first, then quietly frustrating. You do not need to change jobs to restart growth. You need one deliberate stretch inside the work you already do.',
        mid: 'You are still growing, but more slowly than you would like. Some of your learning happens on purpose and some only when a crisis forces it. Choosing one skill to build on purpose will speed things up.',
        high: 'Your work is making you more capable, and you feel it. You take on challenges that stretch you and learn from them. Keep pointing that growth toward the work you want to be doing next.'
      },
      reflect: 'What skill, if I built it this year, would open the most doors for my future work?',
      leverage: 'Your appetite for growth can lift your weakest area. Treat it as the next skill to learn rather than a problem to tolerate.',
      actions: [
        'This week, write down the one skill your next role will require and spend thirty minutes on it before Friday.',
        'Within the next two weeks, ask your manager or a mentor: what would it take for me to grow faster here? Write down their answer.',
        'By the end of this week, take on one task that is slightly beyond what you know how to do, and note what you learned.'
      ]
    },
    {
      key: 'contribution',
      label: 'Contribution',
      desc: 'Seeing how your effort serves people beyond your own paycheck.',
      goal: 'See and serve the people your work helps',
      why: 'Knowing who your work serves turns tasks into contribution. It is one of the strongest sources of meaning and motivation at work.',
      levels: {
        low: 'You may not be able to see who benefits from your work, or you wonder whether anyone would notice if you stopped. That feeling is painful, and it is more common than people admit. Reconnecting with the people on the other end of your effort is the place to start.',
        mid: 'You know your work helps people, but you do not always see it or hear about it. Your contributions may be valued more than you realize. Making that impact more visible to yourself will strengthen your sense of purpose.',
        high: 'You can see the difference your work makes and the people it serves. Your contributions are valued, and you know it. That clarity is a powerful motivator. Keep sharing what you know so your impact multiplies through others.'
      },
      reflect: 'Who is better off this month because I did my job well?',
      leverage: 'Your sense of contribution can make hard changes feel worth it. Connect your weakest area to the people who would benefit if you improved it.',
      actions: [
        'Today, identify who ultimately benefits from your work and write their name or role at the top of your task list for the week.',
        'By Thursday, share one useful idea, resource, or lesson with your team without being asked.',
        'Within the next two weeks, spend one hour helping a colleague or client succeed at something that matters to them.'
      ]
    },
    {
      key: 'future',
      label: 'Future',
      desc: 'Seeing a path from where you are now to the work you feel called to do.',
      goal: 'Map a path from your current role to your calling',
      why: 'Hope for the future makes today\'s work easier to carry. A clear path turns a calling from a daydream into a plan.',
      levels: {
        low: 'You feel stuck in a role that does not lead where you want to go, and the future may feel uncertain or heavy. That is a hard place to be, and it is a starting point, not a verdict. Getting clear on what you feel called to do is the first step toward building a bridge.',
        mid: 'You have a sense of the work you want to be doing, but the path from here to there is still blurry. You may be waiting for the right moment to start. Mapping one concrete bridge between your current role and that calling will give you momentum.',
        high: 'You can see a path from where you are to the work you feel called to do, and you are taking real steps on it. That direction gives your current work extra meaning. Keep checking that the path still fits as you grow.'
      },
      reflect: 'If my current role were a bridge to the work I feel called to do, what would I build next?',
      leverage: 'Your clear sense of direction can give your weakest area a purpose. Link the change you need there to the future you are building toward.',
      actions: [
        'This weekend, take twenty minutes to describe the work you feel called to do in three sentences. Be specific about who it serves.',
        'Before the end of this month, map one bridge between your current role and that calling: a project, skill, or relationship, and take the first step on it.',
        'Within the next two weeks, have one conversation with someone already doing the kind of work you feel drawn to. Bring three questions.'
      ]
    }
  ],
  questions: [
    { dim: 'meaning', text: 'The work I do every day matters to me personally.' },
    { dim: 'meaning', text: 'I can clearly explain how my work connects to something bigger than a paycheck.' },
    { dim: 'meaning', text: 'I mostly work for the money and the weekend.', reverse: true },
    { dim: 'meaning', text: 'I would describe my work as an expression of what I care about.' },

    { dim: 'fit', text: 'My role uses the strengths I am best at.' },
    { dim: 'fit', text: 'I often feel like I am pretending to be someone else at work.', reverse: true },
    { dim: 'fit', text: 'The values of the organization I work in match my own.' },
    { dim: 'fit', text: 'Most of my week is spent on tasks that suit how I naturally work.' },

    { dim: 'growth', text: 'I am becoming more capable because of the work I do.' },
    { dim: 'growth', text: 'I have learned very little in my role over the last year.', reverse: true },
    { dim: 'growth', text: 'I have someone at work who helps me develop, such as a mentor or manager.' },
    { dim: 'growth', text: 'I am building skills that will matter for the work I want to do next.' },

    { dim: 'contribution', text: 'I can see the people who benefit from my work.' },
    { dim: 'contribution', text: 'My contributions are valued by the people I work with.' },
    { dim: 'contribution', text: 'I am making the kind of difference I hoped to make when I started this work.' },
    { dim: 'contribution', text: 'If I stopped tomorrow, I am not sure anyone would feel the difference.', reverse: true },

    { dim: 'future', text: 'I can see a clear path from my current work to the work I feel called to do.' },
    { dim: 'future', text: 'I feel stuck in a role that does not lead where I want to go.', reverse: true },
    { dim: 'future', text: 'I am taking intentional steps toward the work I want to be doing in five years.' },
    { dim: 'future', text: 'When I picture my career a few years from now, I feel excited about it.' },
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
