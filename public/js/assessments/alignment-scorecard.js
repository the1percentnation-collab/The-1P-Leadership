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
  intro: 'A few honest minutes. Answer for how things are, not how you wish they were. There are no wrong answers, only clearer ones.',
  dimensions: [
    {
      key: 'awareness',
      label: 'Awareness',
      desc: 'Seeing clearly what is driving your choices and what is holding you back.',
      goal: 'See clearly what drives your choices and holds you back',
      why: 'You cannot change what you cannot see. Awareness is the first letter for a reason: every other area depends on an honest read of where you are.',
      levels: {
        low: 'You are running on autopilot more than you realize. Days fill up, but the reasons behind your choices and the patterns that keep repeating are mostly out of view. This is the most fixable place to be low, because seeing clearly costs nothing but attention.',
        mid: 'You see a lot of what is going on, especially in hindsight. The gap is in the moment: you notice the pattern after it has already played out. Shortening that delay is where your growth is.',
        high: 'You have an honest, clear read on yourself. You know what drives you, what drains you and where you get stuck. That clarity is an asset most people never build.'
      },
      reflect: 'What is one pattern in my life I keep explaining instead of changing?',
      leverage: 'Use your clarity to name the real obstacle in your weakest area, not the convenient one. Then write it down where you will see it daily.',
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
      goal: 'Own your results instead of waiting on circumstances',
      why: 'Ownership is the difference between waiting for life to change and changing it. Nothing in your plan moves until you decide it is yours to move.',
      levels: {
        low: 'Right now a lot of your life is being decided by circumstances, timing and other people. That is exhausting, and it is also reversible. Ownership starts with small decisions you make on purpose and keep.',
        mid: 'You take ownership in the areas where you feel confident and defer in the areas where you do not. Those deferred areas are usually the ones holding you back most.',
        high: 'You own your story. When things go wrong, you look at what you control first. People around you feel that steadiness, and it gives you real influence.'
      },
      reflect: 'Where am I waiting for permission, timing or money that I do not actually need?',
      leverage: 'Bring the same ownership you show here into your lowest area. Make one decision there this week instead of waiting for it to feel right.',
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
      goal: 'Believe you are the person your goals require',
      why: 'You will not hold onto a life that does not match who you believe you are. Identity sets the ceiling on what you allow yourself to keep.',
      levels: {
        low: 'Some part of you does not yet believe you are the person who gets to have what you are working for. That shows up as self-sabotage, second guessing or tying your worth to results. The work here is rewriting the story, not working harder.',
        mid: 'You believe in yourself in some rooms and not in others. Notice where you shrink. That room is where your next level is waiting.',
        high: 'Who you are and how you show up line up. Your worth is not on the line every time you perform, which frees you to take bigger, cleaner swings.'
      },
      reflect: 'If I fully believed I was capable of the life I want, what would I stop doing?',
      leverage: 'Your settled identity makes it safe to be a beginner. Use it to try the uncomfortable thing your lowest area needs, without needing to be good at it yet.',
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
      goal: 'Stretch past comfort a little more each week',
      why: 'Comfort keeps you where you are. One percent better every day only compounds if you are actually stretching, not just staying busy.',
      levels: {
        low: 'Your days have settled into a routine that keeps you comfortable but not growing. That is not laziness. It is usually fatigue or a lack of clear direction. A small, deliberate stretch each day is enough to restart momentum.',
        mid: 'You are growing in bursts: a book, a course, a push, then a long plateau. The opportunity is consistency, small reps that do not depend on motivation.',
        high: 'You treat discomfort as a signal of growth, not a stop sign. Setbacks teach you instead of defining you. That posture compounds over years.'
      },
      reflect: 'What skill, if I built it this year, would change the next five?',
      leverage: 'Point your growth habit at your lowest area. Treat it like a skill to learn rather than a flaw to fix.',
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
      goal: 'Turn your intentions into a plan you follow',
      why: 'Clarity without execution is just a good intention. Navigation turns what you want into what you do on Tuesday afternoon.',
      levels: {
        low: 'You know some of what you want, but it is not showing up on your calendar. Goals live in your head instead of in a plan, so urgent things win every day. A simple written plan will change more than extra effort.',
        mid: 'You plan well and start strong, then drift once the week gets loud. The fix is a short weekly review that pulls you back on course before you lose a month.',
        high: 'You turn intentions into action consistently. Your calendar reflects your priorities and you can point to real progress. That is rare, and it is the engine that makes everything else work.'
      },
      reflect: 'If someone read my calendar from last week, what would they say I care about?',
      leverage: 'Use your planning muscle on your lowest area. Give it one protected block on your calendar each week.',
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
  cta: { label: 'Request a free Alignment Audit', href: '/corporate#audit' }
};
