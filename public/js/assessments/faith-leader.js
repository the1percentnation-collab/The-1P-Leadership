// The Faith Leader Health Check: for pastors, ministry, and nonprofit leaders.
export default {
  slug: 'faith-leader',
  title: 'The Faith Leader Health Check',
  category: 'leader',
  mode: 'score',
  minutes: 5,
  hook: 'You pour into everyone. Who is pouring into you?',
  short: 'A health check for pastors and ministry leaders across spiritual health, rhythm, team leadership, vision, and family.',
  intro: 'Twenty statements for those who lead in ministry and mission. Answer as you are today. This is a space for honesty, not performance.',
  dimensions: [
    {
      key: 'spiritualHealth',
      label: 'Spiritual Health',
      desc: 'Nurturing your own faith, not only the faith of the people you serve.',
      actions: [
        'Set aside fifteen minutes each morning this week for prayer or scripture that is only for you, not for a sermon or a lesson.',
        'Write down the last time you felt spiritually refreshed. Name what was present then that is missing now.',
        'Reach out to one trusted peer or mentor this week and ask them to pray with you, not for your ministry, for you.'
      ]
    },
    {
      key: 'sustainableRhythm',
      label: 'Sustainable Rhythm',
      desc: 'Working from rest instead of running on empty.',
      actions: [
        'Choose one day this week as a true Sabbath. Put it on the calendar and tell your team it is protected.',
        'Look at the last two weeks of your calendar. Circle every commitment you could have said no to. Decline one upcoming commitment like it.',
        'Go to bed at a set time for five nights this week. Rest is part of faithful leadership, not a break from it.'
      ]
    },
    {
      key: 'teamLeadership',
      label: 'Team and Volunteer Leadership',
      desc: 'Equipping staff and volunteers so ministry does not rest on your shoulders alone.',
      actions: [
        'Identify one responsibility you carry that a volunteer or staff member could own. Ask them this week.',
        'Send a short, specific note of thanks to three volunteers. Name what they did and why it mattered.',
        'Schedule a thirty-minute conversation with one emerging leader about their gifts and where they want to grow.'
      ]
    },
    {
      key: 'visionClarity',
      label: 'Vision Clarity',
      desc: 'Knowing where God is leading your community, and helping others see it too.',
      actions: [
        'Write your ministry\'s vision in one sentence a ten-year-old could understand. Share it with one leader and ask what they hear.',
        'List every program or event you currently run. Mark the ones that clearly serve the vision, and pray over the rest.',
        'Ask three people in your community: where do you think we are headed? Compare their answers with yours.'
      ]
    },
    {
      key: 'familyBoundaries',
      label: 'Family and Boundaries',
      desc: 'Honoring your first calling at home while you serve your community.',
      actions: [
        'Ask your spouse, family, or closest friend this week: do you feel like you get the best of me or what is left? Listen without defending.',
        'Set one boundary on ministry calls or messages, such as no phone after 8 p.m. one night a week, and keep it.',
        'Put one family or personal commitment on your calendar this week and protect it as seriously as a church commitment.'
      ]
    }
  ],
  questions: [
    { dim: 'spiritualHealth', text: 'I spend time with God that is not connected to preparing to teach or lead.' },
    { dim: 'spiritualHealth', text: 'My own faith feels alive, not just my ministry.' },
    { dim: 'spiritualHealth', text: 'I often feel spiritually dry even while I am pouring into others.', reverse: true },
    { dim: 'spiritualHealth', text: 'I have at least one person who cares for my soul, not my ministry.' },

    { dim: 'sustainableRhythm', text: 'I take a regular day of rest each week.' },
    { dim: 'sustainableRhythm', text: 'My current pace is one I could keep for the next ten years.' },
    { dim: 'sustainableRhythm', text: 'I feel tired most of the time, even after a day off.', reverse: true },
    { dim: 'sustainableRhythm', text: 'I can say no to good opportunities in order to protect what matters most.' },

    { dim: 'teamLeadership', text: 'Our ministry would continue well if I stepped away for a month.' },
    { dim: 'teamLeadership', text: 'I regularly invest in developing new leaders.' },
    { dim: 'teamLeadership', text: 'Our volunteers feel valued and know how their service makes a difference.' },
    { dim: 'teamLeadership', text: 'I end up doing a lot of things myself because it is easier than finding someone else.', reverse: true },

    { dim: 'visionClarity', text: 'I can clearly explain where our ministry is going in the next three to five years.' },
    { dim: 'visionClarity', text: 'Our staff and key volunteers could describe our vision in their own words.' },
    { dim: 'visionClarity', text: 'Most of what we do on a typical week clearly connects to our mission.' },
    { dim: 'visionClarity', text: 'We are so busy running programs that there is little time to ask why we run them.', reverse: true },

    { dim: 'familyBoundaries', text: 'My family gets my best, not what is left over after ministry.' },
    { dim: 'familyBoundaries', text: 'I have clear boundaries around when I am available.' },
    { dim: 'familyBoundaries', text: 'People closest to me have said they feel second to my ministry.', reverse: true },
    { dim: 'familyBoundaries', text: 'I protect time for my own health, friendships, and personal life.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Running on Empty',
      summary: 'You have been giving a great deal, and your reserves are low. That is not a lack of faith or calling. It is a signal that the way you are serving needs to change so you can keep serving well. Begin with rest and one honest conversation, and let the rest follow from there.'
    },
    {
      min: 50,
      label: 'Faithful but Stretched',
      summary: 'You are faithful in your calling, and much is going well. Some areas are being carried by effort rather than by rhythm and support. Strengthen the one area that is lagging most, and your ministry and your home will both feel the difference.'
    },
    {
      min: 75,
      label: 'Rooted and Flourishing',
      summary: 'You are leading from a healthy place, with rhythms that sustain you and a team that shares the load. That is a gift to your community and your family. Your next step is to help other leaders around you build the same foundation.'
    }
  ],
  related: ['burnout-check', 'delegation-audit', 'find-your-why'],
  cta: { label: 'Book a free Alignment Audit', href: '/book-a-call' }
};
