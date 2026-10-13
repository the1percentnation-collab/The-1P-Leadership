// Successful on Paper: the brand's core tension, achievement without alignment.
export default {
  slug: 'success-on-paper',
  title: 'Successful on Paper, Empty in Practice?',
  category: 'self',
  mode: 'score',
  minutes: 5,
  hook: 'You hit the goals. So why does it still feel empty?',
  short: 'Measure the gap between how your life looks from the outside and how it actually feels from the inside.',
  intro: 'Eighteen honest statements about the life you have built. Answer for how it feels today, not how it looks to everyone else.',
  dimensions: [
    {
      key: 'fulfillment',
      label: 'Fulfillment',
      desc: 'Whether the results you worked for actually feel like enough when you reach them.',
      actions: [
        'Write down your last three big wins. Next to each, rate from 1 to 10 how satisfied you felt one week later.',
        'Name one goal you are chasing right now. Write one sentence on what you believe it will give you that you do not have today.',
        'Spend thirty minutes this week on something you enjoy that nobody will ever see, measure, or praise.'
      ]
    },
    {
      key: 'values',
      label: 'Values',
      desc: 'Whether your daily choices reflect what you say matters most.',
      actions: [
        'Write your top three values. Then look at last week on your calendar and count the hours that served each one.',
        'Find one commitment that conflicts with a core value. Decide this week whether to change it, shrink it, or end it.',
        'Before your next big yes, ask one question: does this move me toward what I value, or just toward more?'
      ]
    },
    {
      key: 'presence',
      label: 'Presence',
      desc: 'Being fully there for the people and moments your success was supposed to make room for.',
      actions: [
        'Pick one meal this week with the people you love. Leave your phone in another room for the whole meal.',
        'Ask someone close to you: when do I seem most distracted? Thank them for the answer.',
        'Schedule one block this week with no work and no plan. Protect it like a client meeting.'
      ]
    },
    {
      key: 'ownership',
      label: 'Ownership',
      desc: 'Pursuing a definition of success you chose, not one you inherited.',
      actions: [
        'Write down whose approval you are still working for. Be specific: a parent, a peer, a former boss.',
        'Finish this sentence three different ways: success for me, in my own words, means ___.',
        'Remove one status goal from your list this week and replace it with one that serves your purpose.'
      ]
    },
    {
      key: 'direction',
      label: 'Direction',
      desc: 'Having a clear sense of what the next chapter is for, not just what comes next.',
      actions: [
        'Write a one-paragraph description of a meaningful year five years from now. Leave out titles and income.',
        'Identify one small step toward that picture you can take in the next seven days, and put it on your calendar.',
        'Share your answer with one person you trust and ask what they hear in it.'
      ]
    }
  ],
  questions: [
    { dim: 'fulfillment', text: 'When I reach a goal, the satisfaction lasts longer than a few days.' },
    { dim: 'fulfillment', text: 'I have achieved things I once dreamed of, yet something still feels missing.', reverse: true },
    { dim: 'fulfillment', text: 'Most days, I feel genuinely content with the life I have built.' },
    { dim: 'fulfillment', text: 'I often think the next promotion, deal, or milestone will finally make it feel worth it.', reverse: true },

    { dim: 'values', text: 'I can name the three values that matter most to me.' },
    { dim: 'values', text: 'The way I spend my time reflects what I say is most important.' },
    { dim: 'values', text: 'I have made compromises for success that I am not proud of.', reverse: true },
    { dim: 'values', text: 'I say no to opportunities that do not fit who I want to be.' },

    { dim: 'presence', text: 'The people closest to me get my full attention, not just what is left over.' },
    { dim: 'presence', text: 'I am often physically present but mentally somewhere else.', reverse: true },
    { dim: 'presence', text: 'I regularly enjoy the moments my hard work was meant to create.' },

    { dim: 'ownership', text: 'The definition of success I am chasing is one I chose for myself.' },
    { dim: 'ownership', text: 'Much of what I pursue is driven by what others expect of me.', reverse: true },
    { dim: 'ownership', text: 'I would still want my current goals even if nobody else ever knew about them.' },

    { dim: 'direction', text: 'I have a clear sense of what the next chapter of my life is for.' },
    { dim: 'direction', text: 'I know what I want my work to add up to beyond income and title.' },
    { dim: 'direction', text: 'When I think about the next ten years, I feel energized rather than tired.' },
    { dim: 'direction', text: 'I am making progress on something that matters to me beyond my career.' }
  ],
  bands: [
    {
      min: 0,
      label: 'Hollow Win',
      summary: 'From the outside, it works. From the inside, it feels thin. That gap is not ingratitude or weakness. It is a signal that your success has outgrown the reasons behind it, and that is exactly the moment to get clear on what you actually want.'
    },
    {
      min: 50,
      label: 'Quietly Restless',
      summary: 'Much of your success genuinely fits you, and some of it does not. You feel the difference, even if you have not named it yet. A few honest adjustments to where your time and energy go can turn restlessness into real alignment.'
    },
    {
      min: 75,
      label: 'Full Picture',
      summary: 'Your outward success and your inner life are largely telling the same story. That alignment is rare and worth protecting. Your next step is to keep it intentional, especially as new opportunities try to pull you off course.'
    }
  ],
  related: ['alignment-scorecard', 'find-your-why', 'purpose-at-work'],
  cta: { label: 'Book a free strategy call', href: '/book-a-call' }
};
