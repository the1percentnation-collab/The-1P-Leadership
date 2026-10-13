// Limiting Beliefs: a profile built on "I Can't: Is Not A Strategy". The strongest pattern is the result.
export default {
  slug: 'limiting-beliefs',
  title: 'What Belief Is Holding You Back?',
  category: 'leader',
  mode: 'profile',
  minutes: 5,
  hook: "\"I can't\" is not a strategy. So what is really stopping you?",
  short: 'Uncover the limiting belief pattern that shows up most in your life, and the truth that breaks it.',
  intro: "Twenty statements. Agree with the ones that sound like you, even if you would not say them out loud. Honesty here is where the breakthrough starts.",
  dimensions: [
    {
      key: 'fearOfFailure',
      label: 'Fear of Failure',
      desc: 'Avoiding the attempt so you never have to face the result.',
      headline: 'Your pattern is Fear of Failure',
      summary: "This shows up as overpreparing, playing it safe, and quietly not trying the things that matter most. It costs you the growth that only comes from attempts, and it lets years pass while you wait to be sure. The truth that breaks it: failure is information, not identity. You cannot fail at something you are learning.",
      actions: [
        'Write down one thing you have not attempted because you might fail. Take the smallest possible first step on it this week.',
        'Next to that goal, write the worst realistic outcome and how you would recover. Seeing it on paper shrinks it.',
        'Share one recent failure and what it taught you with someone you trust. Say it plainly, without apologizing.'
      ]
    },
    {
      key: 'imposter',
      label: 'Imposter',
      desc: 'Believing you are not as capable as people think, and waiting to be found out.',
      headline: 'Your pattern is Imposter',
      summary: "This shows up as discounting your wins, overworking to prove yourself, and staying quiet when you have something valuable to say. It costs you confidence, energy, and the influence you have already earned. The truth that breaks it: you are not where you are by accident. Your results are evidence, not luck.",
      actions: [
        'List ten things you have accomplished that took real skill. Read the list before your next high-stakes moment.',
        'The next time someone compliments your work this week, say "thank you" and nothing else.',
        'Speak up once in a meeting where you would normally stay quiet. Share the idea before you talk yourself out of it.'
      ]
    },
    {
      key: 'waitingForPermission',
      label: 'Waiting for Permission',
      desc: 'Holding back until someone else says you are ready, qualified, or allowed.',
      headline: 'Your pattern is Waiting for Permission',
      summary: "This shows up as waiting for the right title, the right timing, or someone's approval before you move. It costs you momentum, and it hands control of your life to people who are not thinking about it. The truth that breaks it: no one is coming to give you permission. Leaders decide, then grow into the decision.",
      actions: [
        'Name one thing you are waiting on someone else to approve. Decide this week what you will do if that approval never comes.',
        'Start one project, idea, or conversation this week without asking whether you are allowed.',
        'Replace "when I am ready" with a date. Write it down and tell one person.'
      ]
    },
    {
      key: 'comfortZone',
      label: 'Comfort Zone',
      desc: 'Choosing what is familiar over what would help you grow.',
      headline: 'Your pattern is Comfort Zone',
      summary: "This shows up as routines that feel safe, goals that never quite get started, and a quiet sense that you are capable of more. It costs you your potential, one comfortable week at a time. The truth that breaks it: comfort and growth cannot live in the same place. Discomfort is the price of the life you want, and it is always smaller than it looks.",
      actions: [
        'Do one thing this week that makes you slightly uncomfortable on purpose. Write down how it actually felt afterward.',
        'Change one part of your daily routine for seven days: wake time, workout, or what you read first.',
        'Write down the goal you keep postponing. Give it fifteen minutes a day, every day this week.'
      ]
    },
    {
      key: 'peoplePleasing',
      label: 'People Pleasing',
      desc: 'Putting other people\'s approval ahead of your own priorities and values.',
      headline: 'Your pattern is People Pleasing',
      summary: "This shows up as saying yes when you mean no, softening the truth, and carrying more than your share to keep everyone happy. It costs you your time, your energy, and eventually your own sense of direction. The truth that breaks it: you can be kind and still disappoint people. Clarity is kinder than resentment.",
      actions: [
        'Say no to one request this week that does not fit your priorities. Keep it short, kind, and without a long explanation.',
        'Before you agree to anything new, pause and say: let me check and get back to you.',
        'Write down your top three priorities. Look at your calendar and remove one commitment that serves none of them.'
      ]
    }
  ],
  questions: [
    { dim: 'fearOfFailure', text: 'I often avoid trying something new because I might not be good at it.' },
    { dim: 'fearOfFailure', text: 'I overprepare for things long after I am actually ready.' },
    { dim: 'fearOfFailure', text: 'A mistake can stay on my mind for days.' },
    { dim: 'fearOfFailure', text: 'I would rather not attempt a big goal than attempt it and fall short.' },

    { dim: 'imposter', text: 'I worry that people will eventually discover I am not as capable as they think.' },
    { dim: 'imposter', text: 'When I succeed, I tend to credit luck or timing more than my own ability.' },
    { dim: 'imposter', text: 'I often feel like I do not belong in the rooms I am in.' },
    { dim: 'imposter', text: 'I work harder than necessary because I feel I have to prove myself.' },

    { dim: 'waitingForPermission', text: 'I wait for someone else to tell me I am ready before I go after something.' },
    { dim: 'waitingForPermission', text: 'I hold back ideas until I am sure they will be approved.' },
    { dim: 'waitingForPermission', text: 'I tell myself I will start when the timing is right.' },
    { dim: 'waitingForPermission', text: 'I feel I need more credentials or experience before I can lead.' },

    { dim: 'comfortZone', text: 'My days look mostly the same, and part of me likes it that way.' },
    { dim: 'comfortZone', text: 'I know I am capable of more, but the effort to change feels like too much right now.' },
    { dim: 'comfortZone', text: 'I choose what feels familiar over what would help me grow.' },
    { dim: 'comfortZone', text: 'I have goals I have talked about for years without really starting.' },

    { dim: 'peoplePleasing', text: 'I say yes to things I do not have time for because I do not want to disappoint anyone.' },
    { dim: 'peoplePleasing', text: 'I soften the truth so that people will not be upset with me.' },
    { dim: 'peoplePleasing', text: 'I often put other people\'s priorities ahead of my own.' },
    { dim: 'peoplePleasing', text: 'It bothers me for a long time when someone is unhappy with me.' }
  ],
  related: ['playing-small', 'alignment-scorecard', 'leadership-readiness'],
  cta: { label: "Read chapter one of I Can't free", href: '/icantpreview' }
};
