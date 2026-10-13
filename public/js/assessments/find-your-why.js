// Find Your Why: a profile assessment that reveals the person's core driver.
export default {
  slug: 'find-your-why',
  title: 'Find Your Why',
  category: 'purpose',
  mode: 'profile',
  minutes: 5,
  hook: 'You know what you do. Do you know why you do it?',
  short: 'Discover the core driver behind your best work: Impact, Mastery, Freedom, Legacy, or Connection.',
  intro: 'Twenty statements about what energizes you. Answer for what genuinely lights you up, not what sounds impressive.',
  prompt: 'I exist to ___ so that ___.',
  dimensions: [
    {
      key: 'impact',
      label: 'Impact',
      headline: 'Your Why is Impact',
      desc: 'You are driven by making a visible difference in people and problems.',
      summary: 'You come alive when your effort changes something real for someone else. That drive makes you a powerful force for progress, and people feel it when you show up. The blind spot: you can tie your worth to results and overlook the impact you are already having. Your purpose is not only in the big wins. It is in the people you help along the way.',
      actions: [
        'Write down three people your work helped in the last month and exactly what changed for them.',
        'Choose one problem you care about and give it one focused hour this week.',
        'Ask someone you serve what difference you have made. Write their answer down and keep it.'
      ]
    },
    {
      key: 'mastery',
      label: 'Mastery',
      headline: 'Your Why is Mastery',
      desc: 'You are driven by getting better and doing excellent work.',
      summary: 'You are energized by growth, skill, and the quiet satisfaction of doing something exceptionally well. That discipline makes you someone others trust with hard things. The blind spot: the pursuit of better can turn into never good enough. Your purpose grows when you let your mastery serve something beyond your own standards.',
      actions: [
        'Pick the one skill that would most change your next year and give it fifteen minutes a day this week.',
        'Teach something you know well to one person this week. Notice what you learn by explaining it.',
        'At the end of this week, write down three things you did well before you list what to improve.'
      ]
    },
    {
      key: 'freedom',
      label: 'Freedom',
      headline: 'Your Why is Freedom',
      desc: 'You are driven by choice, autonomy, and owning your time.',
      summary: 'You do your best work when you have room to decide how, when, and where. That independence fuels creativity and bold decisions. The blind spot: guarding your freedom can make commitment feel like a cage. Real freedom grows from clarity about what you are free to build, not only what you are free from.',
      actions: [
        'Write down what you would do with one fully free day each week. Then block two hours this week to do part of it.',
        'Identify one obligation that drains your autonomy and take one step to renegotiate or remove it.',
        'Name one commitment you are choosing on purpose and write why it is worth giving up some freedom for.'
      ]
    },
    {
      key: 'legacy',
      label: 'Legacy',
      headline: 'Your Why is Legacy',
      desc: 'You are driven by building something that lasts beyond you.',
      summary: 'You think in decades, and you want your life to leave something meaningful behind for your family, your community, or your field. That long view gives you patience and a strong sense of responsibility. The blind spot: focusing on the future can cost you presence today. Your legacy is shaped as much by how you live this week as by what you build.',
      actions: [
        'Write a short paragraph about what you want to be true because you lived. Read it on Sunday evening.',
        'Spend one intentional hour this week with someone you hope to influence long term.',
        'Choose one action this week that builds something lasting: a document, a habit, a mentoring session, or a plan.'
      ]
    },
    {
      key: 'connection',
      label: 'Connection',
      headline: 'Your Why is Connection',
      desc: 'You are driven by relationships, belonging, and bringing people together.',
      summary: 'You are energized by people, trust, and the sense that you are part of something together. That gift makes you the person others turn to and rally around. The blind spot: you can put everyone else first until there is little left for you. Your purpose is strongest when your relationships include the one you have with yourself.',
      actions: [
        'Reach out to one person you have lost touch with this week and tell them why they matter to you.',
        'Introduce two people in your network who should know each other.',
        'Block one evening this week for yourself alone, and treat it as seriously as plans with others.'
      ]
    }
  ],
  questions: [
    { dim: 'impact', text: 'I feel most alive when my work clearly changes something for someone else.' },
    { dim: 'impact', text: 'Seeing a real problem get solved gives me more energy than recognition does.' },
    { dim: 'impact', text: 'I am drawn to work where the results are visible and meaningful.' },
    { dim: 'impact', text: 'I would choose a role with greater impact over one with a bigger title.' },

    { dim: 'mastery', text: 'I love the process of getting better at something difficult.' },
    { dim: 'mastery', text: 'Doing excellent work is satisfying to me, even when nobody notices.' },
    { dim: 'mastery', text: 'I am energized by learning new skills and going deeper in my field.' },
    { dim: 'mastery', text: 'I enjoy being the person others trust to get the hard things right.' },

    { dim: 'freedom', text: 'I do my best work when I can decide how and when to do it.' },
    { dim: 'freedom', text: 'Owning my time matters more to me than most other rewards.' },
    { dim: 'freedom', text: 'I feel energized when I am building something on my own terms.' },
    { dim: 'freedom', text: 'Having choices about my future gives me a strong sense of purpose.' },

    { dim: 'legacy', text: 'I often think about what I want to leave behind for the next generation.' },
    { dim: 'legacy', text: 'I am motivated by building something that will outlast me.' },
    { dim: 'legacy', text: 'Providing long-term stability for my family or community drives many of my decisions.' },
    { dim: 'legacy', text: 'I find meaning in investing in people who will carry the work forward.' },

    { dim: 'connection', text: 'I feel most energized when I am working closely with people I trust.' },
    { dim: 'connection', text: 'Bringing people together gives me a deep sense of purpose.' },
    { dim: 'connection', text: 'The relationships I build matter more to me than the results I achieve.' },
    { dim: 'connection', text: 'I am at my best when I am part of a team or community working toward something together.' }
  ],
  related: ['purpose-at-work', 'success-on-paper', 'alignment-scorecard'],
  cta: { label: 'Book a free strategy call', href: '/book-a-call' }
};
