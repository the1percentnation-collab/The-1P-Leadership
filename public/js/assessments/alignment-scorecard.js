// The Alignment Scorecard — the flagship. Built on A.L.I.G.N. (js/align.js),
// so the free tool and the paid Alignment Audit speak the same framework.
export default {
  slug: 'alignment-scorecard',
  title: 'The Alignment Scorecard',
  category: 'self',
  mode: 'score',
  minutes: 5,
  featured: true,
  hook: 'Successful on paper. Something still feels off?',
  short: 'Find out exactly where the gap is between the life you built and the life you want, across the five A.L.I.G.N. areas.',
  intro: 'Twenty honest statements. Answer for how things are, not how you wish they were. There are no wrong answers, only clearer ones.',
  dimensions: [
    {
      key: 'awareness',
      label: 'Awareness',
      desc: 'Seeing clearly what is driving your choices and what is holding you back.',
      actions: [
        'Write down the one thing you keep saying you will change. Next to it, write the belief that keeps you from changing it.',
        'For seven days, end each day with one line: what drained me, what fueled me.',
        'Ask one person who knows you well: what do you see me avoiding? Listen without defending.'
      ]
    },
    {
      key: 'leadership',
      label: 'Leadership',
      desc: 'Owning your story and your results instead of waiting on circumstances.',
      actions: [
        'Pick one area where you have been blaming timing, money, or people. Write what you would do this week if it were fully your call.',
        'Replace one "I have to" with "I choose to" or "I will not." Say it out loud.',
        'Make one decision you have been postponing, today, and tell someone you made it.'
      ]
    },
    {
      key: 'identity',
      label: 'Identity',
      desc: 'Believing you are the person who can have the life you are working toward.',
      actions: [
        'Write a three-sentence description of who you are becoming. Read it before you check your phone each morning.',
        'List three things you have already overcome. Keep the list where you will see it.',
        'Notice the next time you say "I am just not a ___ person." Rewrite the sentence.'
      ]
    },
    {
      key: 'growth',
      label: 'Growth',
      desc: 'Choosing expansion over comfort, one percent at a time.',
      actions: [
        'Choose one skill that would change your next twelve months. Give it fifteen minutes a day for the next two weeks.',
        'Do one thing this week that makes you slightly uncomfortable on purpose.',
        'Trade thirty minutes of scrolling for thirty minutes of reading or listening that stretches you.'
      ]
    },
    {
      key: 'navigation',
      label: 'Navigation',
      desc: 'Turning intention into a plan you actually execute.',
      actions: [
        'Write your top three priorities for the next 90 days. If there are more than three, you do not have priorities yet.',
        'Block one hour on your calendar this week for your most important priority. Treat it like a meeting you cannot move.',
        'Every Friday, score your week 1 to 10 on what mattered most. Adjust next week, do not judge last week.'
      ]
    }
  ],
  questions: [
    { dim: 'awareness', text: 'I can clearly name what I want my life to look like five years from now.' },
    { dim: 'awareness', text: 'I know which of my habits are helping me and which are holding me back.' },
    { dim: 'awareness', text: 'I often feel busy without knowing what I am actually moving toward.', reverse: true },
    { dim: 'awareness', text: 'I understand why I keep getting stuck in the same places.' },

    { dim: 'leadership', text: 'When things do not go my way, I look at what I can control first.' },
    { dim: 'leadership', text: 'I tend to wait for the right time, the right money, or the right people before I act.', reverse: true },
    { dim: 'leadership', text: 'I make decisions about my life instead of letting them get made for me.' },
    { dim: 'leadership', text: 'I keep the promises I make to myself.' },

    { dim: 'identity', text: 'I believe I am capable of the life I am working toward.' },
    { dim: 'identity', text: 'My sense of worth depends mostly on my title, income, or what others think.', reverse: true },
    { dim: 'identity', text: 'The person I am in private matches the person I present in public.' },
    { dim: 'identity', text: 'I often feel like I am playing a role rather than being myself.', reverse: true },

    { dim: 'growth', text: 'I am intentionally learning something that will matter in the next year.' },
    { dim: 'growth', text: 'I regularly do things that stretch me, even when they are uncomfortable.' },
    { dim: 'growth', text: 'Most of my days look the same, and I am not getting much better.', reverse: true },
    { dim: 'growth', text: 'I treat setbacks as information, not as a verdict on who I am.' },

    { dim: 'navigation', text: 'I have written goals for the next 90 days.' },
    { dim: 'navigation', text: 'My calendar reflects what I say is most important to me.' },
    { dim: 'navigation', text: 'I start strong on new goals but rarely follow through.', reverse: true },
    { dim: 'navigation', text: 'At the end of most weeks, I can point to real progress on what matters most.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Drifting',
      summary: 'You are moving, but not in a direction you chose. That is not a failure. It is the most common place high performers end up when they have been running on effort instead of clarity. The good news: small, deliberate changes create fast momentum from here.'
    },
    {
      min: 50,
      label: 'Grinding',
      summary: 'You are doing a lot of things right, and you are working hard for it. The gap is alignment: some of your effort is going toward a version of success that does not fully fit you anymore. Close that gap and the same effort starts producing very different results.'
    },
    {
      min: 75,
      label: 'Aligned',
      summary: 'Your life and your values are mostly pointed in the same direction. That is rare. Your next level is not about doing more. It is about protecting what is working and sharpening the one area that is still lagging behind the rest.'
    }
  ],
  related: ['find-your-why', 'success-on-paper', 'burnout-check'],
  cta: { label: 'Book a free Alignment Audit', href: '/book-a-call' }
};
