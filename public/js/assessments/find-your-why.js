// Find Your Why: a profile assessment that reveals the person's core driver.
export default {
  slug: 'find-your-why',
  title: 'Find Your Why',
  category: 'purpose',
  mode: 'profile',
  minutes: 4,
  hook: 'You know what you do. Do you know why you do it?',
  short: 'Discover the core driver behind your best work: Impact, Mastery, Freedom, Legacy, or Connection.',
  intro: 'A few honest minutes on what energizes you. Answer for what genuinely lights you up, not what sounds impressive.',
  prompt: 'I exist to ___ so that ___.',
  dimensions: [
    {
      key: 'impact',
      label: 'Impact',
      headline: 'Your Why is Impact',
      desc: 'You are driven by making a visible difference in people and problems.',
      why: 'Knowing that impact moves you explains why some work energizes you and other work feels empty. It helps you choose roles and projects where your effort clearly changes something.',
      summary: 'You come alive when your effort changes something real for someone else. That drive makes you a powerful force for progress, and people feel it when you show up. The blind spot: you can tie your worth to results and overlook the impact you are already having. Your purpose is not only in the big wins. It is in the people you help along the way.',
      levels: {
        low: 'Impact is a light pull for you. You care about making a difference, but visible results are not what gets you out of bed. You may find more energy in how the work is done or who you do it with than in the outcome itself.',
        mid: 'Impact is a moderate pull for you. Seeing your work change something matters, and it gives you a lift when it happens. It works best for you alongside another driver, so look for roles where results and your other motivations overlap.',
        high: 'Impact is a strong pull for you. You need to see that your work changes something real, and you lose energy fast when it does not. Make sure you have a way to see the results of your effort regularly, not only at the end of a big project.'
      },
      reflect: 'Whose life is different because of something I did this year, and how do I know?',
      actions: [
        'By Friday, write down three people your work helped in the last month and exactly what changed for them.',
        'Choose one problem you care about and block one focused hour on your calendar for it this week.',
        'Within the next two weeks, ask someone you serve what difference you have made. Write their answer down and keep it where you will see it.'
      ]
    },
    {
      key: 'mastery',
      label: 'Mastery',
      headline: 'Your Why is Mastery',
      desc: 'You are driven by getting better and doing excellent work.',
      why: 'Knowing that mastery moves you explains why you need to be learning and stretching to feel engaged. It helps you choose work that keeps you growing instead of coasting.',
      summary: 'You are energized by growth, skill, and the quiet satisfaction of doing something exceptionally well. That discipline makes you someone others trust with hard things. The blind spot: the pursuit of better can turn into never good enough. Your purpose grows when you let your mastery serve something beyond your own standards.',
      levels: {
        low: 'Mastery is a light pull for you. You like doing good work, but getting better for its own sake is not your main fuel. You may grow fastest when learning is tied to a person, a goal or a cause you care about.',
        mid: 'Mastery is a moderate pull for you. You enjoy building skill and doing excellent work, especially in areas that matter to you. Choosing one skill to go deep on this year will give that drive a clear target.',
        high: 'Mastery is a strong pull for you. You need to be learning and improving, and you get restless when work becomes routine. Protect time for deep practice, and remember to celebrate progress so excellence does not turn into never enough.'
      },
      reflect: 'What would I love to be truly excellent at five years from now, and who would that serve?',
      actions: [
        'Today, pick the one skill that would most change your next year and give it fifteen minutes a day for the next seven days.',
        'Before the end of this week, teach something you know well to one person. Notice what you learn by explaining it.',
        'On Friday, write down three things you did well this week before you list anything to improve.'
      ]
    },
    {
      key: 'freedom',
      label: 'Freedom',
      headline: 'Your Why is Freedom',
      desc: 'You are driven by choice, autonomy, and owning your time.',
      why: 'Knowing that freedom moves you explains why control over your time matters so much to your energy. It helps you design work that gives you room to do your best thinking.',
      summary: 'You do your best work when you have room to decide how, when, and where. That independence fuels creativity and bold decisions. The blind spot: guarding your freedom can make commitment feel like a cage. Real freedom grows from clarity about what you are free to build, not only what you are free from.',
      levels: {
        low: 'Freedom is a light pull for you. You value some choice in your work, but structure and clear expectations do not bother you much. You may even do your best work inside a well-defined system.',
        mid: 'Freedom is a moderate pull for you. You like having a say in how and when you work, and too much control from others wears on you over time. Negotiating a little more ownership over your schedule will likely boost your energy.',
        high: 'Freedom is a strong pull for you. Owning your time and choices is central to how you feel about your life and work. Build your freedom on purpose, and be clear about what you are using it to create.'
      },
      reflect: 'What am I trying to be free to do, not just free from?',
      actions: [
        'This weekend, write down what you would do with one fully free day each week. Then block two hours next week to do part of it.',
        'By Friday, identify one obligation that drains your autonomy and take one step to renegotiate or remove it, such as sending a single email.',
        'Within the next seven days, name one commitment you are choosing on purpose and write two sentences on why it is worth giving up some freedom for.'
      ]
    },
    {
      key: 'legacy',
      label: 'Legacy',
      headline: 'Your Why is Legacy',
      desc: 'You are driven by building something that lasts beyond you.',
      why: 'Knowing that legacy moves you explains why short-term wins often feel less important than long-term ones. It helps you invest your time in what will still matter years from now.',
      summary: 'You think in decades, and you want your life to leave something meaningful behind for your family, your community, or your field. That long view gives you patience and a strong sense of responsibility. The blind spot: focusing on the future can cost you presence today. Your legacy is shaped as much by how you live this week as by what you build.',
      levels: {
        low: 'Legacy is a light pull for you. You care about the future, but you are more motivated by what is happening now. That can keep you present and responsive. It may help to occasionally ask what your current choices are building over time.',
        mid: 'Legacy is a moderate pull for you. You think about what you will leave behind, especially for your family or the people you lead. Linking a few of your current goals to that longer view will give them more weight.',
        high: 'Legacy is a strong pull for you. You make decisions with the next generation in mind and want your life to add up to something lasting. Keep that long view, and make sure the people closest to you feel your presence today.'
      },
      reflect: 'What do I want to be true for the people who come after me because I lived the way I did?',
      actions: [
        'This week, write a short paragraph about what you want to be true because you lived. Read it on Sunday evening.',
        'Within the next seven days, spend one intentional hour with someone you hope to influence long term. Put it on both of your calendars.',
        'By Friday, choose one action that builds something lasting, such as a document, a habit, a mentoring session, or a plan, and finish it.'
      ]
    },
    {
      key: 'connection',
      label: 'Connection',
      headline: 'Your Why is Connection',
      desc: 'You are driven by relationships, belonging, and bringing people together.',
      why: 'Knowing that connection moves you explains why the people around you shape your energy as much as the work does. It helps you choose teams and communities where you can thrive.',
      summary: 'You are energized by people, trust, and the sense that you are part of something together. That gift makes you the person others turn to and rally around. The blind spot: you can put everyone else first until there is little left for you. Your purpose is strongest when your relationships include the one you have with yourself.',
      levels: {
        low: 'Connection is a light pull for you. You value good relationships, but you do not need constant collaboration to feel motivated. You may do your best work with some independence, coming together with people at key moments.',
        mid: 'Connection is a moderate pull for you. Working with people you trust gives you energy, and isolation slowly drains you. Make sure your week includes regular time with people who know and support you.',
        high: 'Connection is a strong pull for you. Relationships and belonging are at the center of what makes your work and life feel meaningful. Keep investing in your people, and protect time for yourself so you have something to give.'
      },
      reflect: 'Which relationships give me the most energy, and how much of my week do I actually spend in them?',
      actions: [
        'By Wednesday, reach out to one person you have lost touch with and tell them in a sentence or two why they matter to you.',
        'Within the next seven days, introduce two people in your network who should know each other, with a short note on why.',
        'Block one evening this week for yourself alone, put it on your calendar, and treat it as seriously as plans with others.'
      ]
    }
  ],
  questions: [
    { dim: 'impact', text: 'I feel most alive when my work clearly changes something for someone else.' },
    { dim: 'impact', text: 'Seeing a real problem get solved gives me more energy than recognition does.' },
    { dim: 'impact', text: 'I would choose a role with greater impact over one with a bigger title.' },
    { dim: 'impact', text: 'I lose motivation quickly when I cannot see how my work makes a difference.' },

    { dim: 'mastery', text: 'I love the process of getting better at something difficult.' },
    { dim: 'mastery', text: 'Doing excellent work is satisfying to me, even when nobody notices.' },
    { dim: 'mastery', text: 'I am energized by learning new skills and going deeper in my field.' },

    { dim: 'freedom', text: 'I do my best work when I can decide how and when to do it.' },
    { dim: 'freedom', text: 'Owning my time matters more to me than most other rewards.' },
    { dim: 'freedom', text: 'Close supervision drains my energy faster than hard work does.' },

    { dim: 'legacy', text: 'I often think about what I want to leave behind for the next generation.' },
    { dim: 'legacy', text: 'I am motivated by building something that will outlast me.' },
    { dim: 'legacy', text: 'I am willing to give up a quick win for something that will matter in twenty years.' },

    { dim: 'connection', text: 'Bringing people together gives me a deep sense of purpose.' },
    { dim: 'connection', text: 'The relationships I build matter more to me than the results I achieve.' },
    { dim: 'connection', text: 'Long stretches of working alone leave me feeling flat, even when the work is good.' }
  ],
  related: ['purpose-at-work', 'success-on-paper', 'alignment-scorecard'],
  cta: { label: 'Book a free strategy call', href: '/book-a-call' }
};
