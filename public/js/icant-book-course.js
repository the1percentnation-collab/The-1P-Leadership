// I Can't: Read & Apply — the book, chapter by chapter, with application built in.
//
// This course follows Anthony Brown's book "I Can't: Strategies To Overcoming
// Your Limiting Beliefs" in its real structure — Introduction, ten chapters, and
// the Conclusion — so a member can READ the ideas of each chapter inside the
// platform and immediately APPLY them, while or after reading their own copy.
//
// Each module renders three tabs through the shared Coursera-style player
// (course-player.js): "Read" (the chapter, section by section), "Apply"
// (reflection + action prompts saved locally), and "Takeaways" (the 3 things to
// keep + a bridge into the next chapter).
//
// Content is written as a faithful companion to the book — it teaches and
// summarizes each chapter's ideas so they can be read and worked here; the full
// book remains the primary text this course points members back to.

import { mountCoursePlayer } from './course-player.js';

// The book link members can jump to at any time.
export const BOOK_URL = 'https://a.co/d/0fSUaomu';
export const BOOK_TITLE = "I Can't: Strategies To Overcoming Your Limiting Beliefs";
export const BOOK_AUTHOR = 'Anthony Brown';

// ── The book, as modules ────────────────────────────────────────────────────
// read:      [{ heading, body:[paragraphs] }]   — the readable chapter
// apply:     { reflection, action, prompts:[] }  — do the work
// takeaways: [3 strings]                         — what to keep
// bridge:    string                              — what's next

export const MODULES = [
  {
    id: 0,
    part: 'Introduction',
    title: 'The Power of Belief',
    subtitle: 'The invisible engine behind every result in your life',
    duration: '12 min read',
    read: [
      {
        heading: 'Belief is a force',
        body: [
          'Belief is a remarkable force. It drives human potential, influencing how we perceive ourselves and navigate the world. It shapes our thoughts, guides our actions, and defines the limits of what we think is possible. At its core, belief is deeply personal — capable of propelling us toward greatness or confining us within doubt and fear.',
          'Belief is the invisible engine that drives our actions, decisions, and ultimately our lives. It is the force that quietly determines whether we aim high or settle for less, whether we push through challenges or give up when things get tough. Whether you realize it or not, your beliefs about yourself and your world shape every aspect of your experience. They define what you think is possible and, more importantly, what you think is impossible.',
          'Think of belief as the lens through which you see the world. For some it is a lens of opportunity — one that shows them possibilities and fuels their ambitions. For others it is a filter of limitation, casting shadows of doubt and fear on even the brightest dreams. But here is the truth: that lens can be changed. And when it does, the entire landscape of your life changes with it.'
        ]
      },
      {
        heading: 'Why beliefs matter more than we realize',
        body: [
          'Beliefs are the invisible scripts running in the background of your mind, subtly influencing how you see the world and your place in it. Two people can face the exact same challenge, yet one will rise to the occasion while the other shrinks back. The difference is rarely intelligence or talent. It is belief — what each person believes about themselves, their capabilities, and the situation at hand.',
          'Positive beliefs can be empowering, but limiting beliefs are like chains that hold you back. Listen for the phrases that echo in your mind: "I’m not smart enough to do that." "I could never be successful." "I’m just not the type of person who takes risks." Each of these is a belief. And as long as you continue to believe them, they become self-fulfilling prophecies.',
          'The most important thing to understand before you go any further is this: beliefs are not fixed. They can be changed, reshaped, and reprogrammed. The power to transform your life is already inside you, embedded in your beliefs. This book — and this course — is the practical work of changing the ones that have been holding you back.'
        ]
      },
      {
        heading: 'How to use this course with the book',
        body: [
          'This course mirrors the book chapter by chapter. Read the chapter here (or in your own copy), then move to the Apply tab and do the work the same day. Knowledge that is not applied fades within weeks. Applied knowledge becomes who you are.',
          'You are not here to collect ideas. You are here to change the lens. Read, then apply. That is the whole method.'
        ]
      }
    ],
    apply: {
      reflection: 'Before you change anything, notice the lens you are already looking through. Where in your life do you consistently expect the door to be closed before you even reach for the handle?',
      action: 'Name the lens. Write the first honest answers that come — no editing, no impressing anyone. No one else sees this.',
      prompts: [
        'One area of my life where I quietly expect the worst is…',
        'A phrase I catch myself saying or thinking (an "I can’t / I’m not / I never") is…',
        'If that belief were not true, one thing I would attempt is…'
      ]
    },
    takeaways: [
      'Belief is the lens you see your life through — and the lens can be changed.',
      'Limiting beliefs become self-fulfilling prophecies only while you keep believing them.',
      'Beliefs are learned, which means they can be unlearned and rebuilt on purpose.'
    ],
    bridge: 'To change a belief you first have to see it clearly. Chapter One turns on the light — what a limiting belief actually is, where it comes from, and how it has been shaping your reality without your permission.'
  },
  {
    id: 1,
    part: 'Chapter One',
    title: 'Understanding Limiting Beliefs',
    subtitle: 'The invisible chains — and why awareness breaks them',
    duration: '16 min read',
    read: [
      {
        heading: 'The nature of limiting beliefs',
        body: [
          'Limiting beliefs are like invisible chains that hold us back — barriers that keep us from reaching our full potential. They show up as whispers of doubt that tell us we are not good enough or not capable of succeeding. To free ourselves from their control, we first have to understand their nature, their origin, and their impact.',
          'Limiting beliefs are deeply ingrained perceptions that restrict our capabilities and choices, often without us even realizing it. They operate unconsciously and act as self-imposed limitations on what we believe is possible. They manifest as fear, doubt, and negative self-talk, and they quietly push us to avoid the risks and challenges that would grow us.',
          'Fear of failure is one of the most common. It tells us that mistakes are a verdict on our worth, so we stay in our comfort zone and miss the chance to learn. Fear of judgment is another — it makes us prize other people’s opinions over our own aspirations, so we conform instead of pursuing what is true to us.'
        ]
      },
      {
        heading: 'Where limiting beliefs come from',
        body: [
          'Limiting beliefs are not innate. They are learned — formed by personal experience, social conditioning, and cultural influence. Childhood experiences leave the deepest imprints: a child who struggles in school may conclude they are "not smart," and carry that conclusion for decades. Painful or traumatic experiences can plant beliefs about being unworthy or powerless.',
          'Social conditioning does the rest. Family dynamics, peer pressure, and social norms teach us what is "realistic" for people like us. Cultural messages about success, roles, and identity harden those lessons into rules we never agreed to — rules that quietly steer us away from the paths we would naturally take.'
        ]
      },
      {
        heading: 'The impact — and the invisible chains',
        body: [
          'Limiting beliefs have far-reaching effects. They shape our identity, erode our self-esteem, strain our relationships, and cap our professional growth. Someone who believes they don’t deserve good things will sabotage the good things when they arrive. Someone who fears rejection will keep people at a distance and call it independence.',
          'The danger is not the belief itself. It is the silence around it. An unexamined belief runs your life while pretending to be simply "the way things are." It feels like a fact. It is not. It is a learned narrative — and anything learned can be unlearned.'
        ]
      },
      {
        heading: 'Why awareness is the key to breaking free',
        body: [
          'You cannot change what you refuse to look at. Awareness is where every transformation begins — not judging the belief, not excusing it, just seeing it and calling it by its name. Most people live on autopilot, mistaking their beliefs for reality. Awareness breaks the automation.',
          'This chapter is your flashlight. The goal is not yet to fix anything. The goal is to see clearly — because a belief you can name is a belief you can finally challenge.'
        ]
      }
    ],
    apply: {
      reflection: 'Think about one area of your life where you consistently feel stuck, small, or like you are playing it safe. What is the story you tell yourself about that area?',
      action: 'Surface three limiting beliefs. Do not filter — write the first honest things that come. Naming a belief is the first act of breaking its power.',
      prompts: [
        'The area where I feel most stuck is…',
        'The story I tell myself about that area is…',
        'My three "I can’t / I’m not / I never" beliefs are…',
        'The belief I would least like to admit is…'
      ]
    },
    takeaways: [
      'Limiting beliefs are learned narratives, not permanent truths.',
      'They operate beneath awareness, silently shaping behavior and outcomes.',
      'Naming a belief out loud is the first act of breaking its grip.'
    ],
    bridge: 'You can see the belief now. The next question is why it is so hard to shake. Chapter Two goes inside the brain — how beliefs get physically wired in, and why that same wiring is your way out.'
  },
  {
    id: 2,
    part: 'Chapter Two',
    title: 'The Neuroscience of Belief',
    subtitle: 'Your brain is wired to keep you safe — not free',
    duration: '15 min read',
    read: [
      {
        heading: 'How beliefs are formed and reinforced',
        body: [
          'Understanding your brain is not a science lecture — it is strategy. When you know how beliefs get formed and hardwired, you stop feeling broken and start feeling equipped.',
          'Every time you act on a belief — true or false — your brain strengthens the neural pathway behind it. Repeat a thought often enough and it becomes automatic, a road so worn it feels like the only road. This is neuroplasticity, and left unmanaged it works against you. But neuroplasticity runs both directions: every new thought you deliberately choose and repeat begins to build a new pathway.'
        ]
      },
      {
        heading: 'Emotions, the amygdala, and the prefrontal cortex',
        body: [
          'Your prefrontal cortex handles logic, planning, and decisions. Your amygdala handles fear and emotion. When the two disagree, the amygdala usually fires first — which is why fear can hijack a decision before reason gets a word in.',
          'Emotionally charged experiences create the strongest beliefs. That is why something a parent said once when you were eight can still run your behavior at thirty-eight. The brain tagged that moment as important and built a protective rule around it. The rule is not trying to harm you — it is trying to keep you from repeating pain. Your job is to teach it a new definition of safety.'
        ]
      },
      {
        heading: 'Changing beliefs through brain rewiring',
        body: [
          'Because beliefs are pathways, they can be rewired. The process is not mystical: it is repeated, deliberate practice of a new thought paired with new action, until the new pathway becomes stronger than the old one.',
          'Practical strategies for harnessing this: notice the automatic thought as it fires, interrupt it, and consciously choose the replacement. Attach emotion to the new belief — say it like you mean it. Repeat it in real situations, not just on paper. And give it time; the brain adopts a new belief once it has collected enough evidence that the belief is safe and true.'
        ]
      }
    ],
    apply: {
      reflection: 'Trace one of your limiting beliefs back to its origin. What experience — real or perceived — planted the seed? How old were you? Who was involved?',
      action: 'Separate what actually happened from what you concluded. The event was real; the conclusion was a guess your brain made to keep you safe. Then choose a truer interpretation.',
      prompts: [
        'The limiting belief I am tracing is…',
        'The original experience I can trace it to is…',
        'What actually happened vs. what I concluded from it:',
        'A truer interpretation I can choose to rehearse is…'
      ]
    },
    takeaways: [
      'Beliefs are neural pathways — and pathways can be rewired.',
      'Emotionally intense experiences form the strongest, stickiest beliefs.',
      'Neuroplasticity becomes your greatest asset the moment you use it on purpose.'
    ],
    bridge: 'You know how beliefs form. Now get specific. Chapter Three is a surgical excavation — moving from "I have limiting beliefs" to naming the exact ones running your money, your work, and your relationships right now.'
  },
  {
    id: 3,
    part: 'Chapter Three',
    title: 'Identify Your Limiting Beliefs',
    subtitle: 'Stop guessing. Start excavating.',
    duration: '14 min read',
    read: [
      {
        heading: 'Beliefs hide in patterns and emotions',
        body: [
          'Most people know they have limiting beliefs in the abstract. Very few can name the specific ones steering their life today. This chapter is about precision, because generic awareness does not create change — specific awareness does.',
          'Limiting beliefs hide inside emotions. Anxiety, avoidance, defensiveness, and self-sabotage are symptoms; the belief is the root beneath them. They also hide inside patterns. If you keep hitting the same ceiling in money, relationships, or confidence, there is a belief holding the ceiling in place.'
        ]
      },
      {
        heading: 'The categories to search',
        body: [
          'Four categories catch most limiting beliefs. Worthiness: "I don’t deserve this." Capability: "I’m not smart, talented, or experienced enough." Safety: "If I succeed I’ll be judged, exposed, or overwhelmed." Belonging: "People like me don’t do things like that."',
          'The most revealing question is not "What am I afraid of?" It is: "What do I believe would happen if I actually succeeded?" The answer that surfaces when you are honest is usually the belief running the show — the one quietly making sure you never have to find out.'
        ]
      },
      {
        heading: 'Ownership is leadership',
        body: [
          'Identifying your beliefs is an act of ownership. Not blaming your upbringing, not excusing your patterns — owning them. The moment you stop being a passive observer of your life and become an active analyst of it, you take back the authorship. Leaders do not run from hard truths about themselves. They use them.'
        ]
      }
    ],
    apply: {
      reflection: 'In which area of your life are you consistently playing smaller than you know you could? What do you believe would happen if you stopped playing small there?',
      action: 'Complete the belief excavation. For each category, write the belief you sense might be holding you back. Do not overthink — write the first honest thing.',
      prompts: [
        'In my finances, I believe…',
        'In my career or purpose, I believe…',
        'In my relationships, I believe…',
        'About my own potential, I believe…',
        'The belief I am most afraid to look at is…'
      ]
    },
    takeaways: [
      'Limiting beliefs hide in patterns, emotions, and avoidance — not just in thoughts.',
      'Precision beats generic awareness: name the exact belief, in the exact area.',
      '"What would happen if I succeeded?" exposes the belief fear is protecting.'
    ],
    bridge: 'You have named them. Now break them. Chapter Four is the confrontation — a repeatable method for taking any belief you just wrote down and dismantling it.'
  },
  {
    id: 4,
    part: 'Chapter Four',
    title: 'Challenging and Reframing Beliefs',
    subtitle: 'The belief was never the truth — just the loudest voice',
    duration: '16 min read',
    read: [
      {
        heading: 'Challenging the belief',
        body: [
          'Identifying a belief gives you something to aim at. Challenging it changes the trajectory. Start by interrogating the belief: "Is this 100% objectively true, or is it an interpretation?" Most limiting beliefs collapse under honest examination, because they were never facts — they were conclusions.',
          'Then challenge the negative self-talk that keeps the belief alive. The voice that says "you always mess this up" is not a narrator of reality; it is a habit. Question its evidence the way you would question a stranger who said the same thing about your best friend.'
        ]
      },
      {
        heading: 'Find the counter-evidence and the cost',
        body: [
          'You have spent years collecting evidence for the belief. Now deliberately collect evidence against it — times you did succeed, were capable, were enough. Your brain will resist this; do it anyway, because it is how you starve the old pathway.',
          'Then make the cost real. What has this belief actually cost you? Opportunities declined, relationships strained, goals abandoned, years spent small. Vague beliefs are easy to keep. A belief with a receipt attached is much harder to hold on to.'
        ]
      },
      {
        heading: 'Reframe — and test it',
        body: [
          'Do not just reject the old belief; replace it with a specific, believable new one. Not toxic positivity — earned truth. "I am incapable" does not become "I am unstoppable." It becomes something you can actually stand behind: "I have learned hard things before, and I can learn this."',
          'Then test the reframe in low-stakes situations first and let evidence build. The brain needs proof before it fully adopts a new belief. Give it small, undeniable wins, and the reframe stops being a sentence you wrote and becomes a truth you live.'
        ]
      }
    ],
    apply: {
      reflection: 'Take the most powerful limiting belief you identified in Chapter Three. Walk it through the challenge: Is it fact or interpretation? What is the evidence against it? What has it cost you?',
      action: 'Write your reframe declaration — one clear sentence that replaces the belief. Make it specific, present tense, and earned. Then pick where you will test it this week.',
      prompts: [
        'The belief I am challenging is…',
        'The evidence against this belief is…',
        'The real cost this belief has had on my life is…',
        'My reframe declaration (specific, present tense, earned):',
        'One low-stakes place I will test the new belief this week is…'
      ]
    },
    takeaways: [
      'Every limiting belief is an interpretation, not a fact — and interpretations can change.',
      'Counter-evidence is a skill; you have to practice collecting it deliberately.',
      'A reframe only sticks once you test it and let real evidence back it up.'
    ],
    bridge: 'A single reframed belief is a win. A changed mindset makes the wins permanent. Chapter Five upgrades the operating system underneath every belief you hold.'
  },
  {
    id: 5,
    part: 'Chapter Five',
    title: 'The Power of Mindset Shifts',
    subtitle: 'A changed belief without a changed mindset is a temporary fix',
    duration: '13 min read',
    read: [
      {
        heading: 'How mindset influences behavior',
        body: [
          'Mindset is not motivation. It is the operating system underneath your motivation — the default assumptions that decide how you read a challenge before you have consciously thought about it. A fixed mindset treats your abilities as a ceiling. A growth mindset treats them as a floor. The difference is not optimism; it is your relationship with difficulty.',
          'Behavior follows mindset quietly and constantly. With a fixed mindset, a setback means "I am not cut out for this," so you retreat. With a growth mindset, the same setback means "I have not figured this out yet," so you adjust and continue. Same event, opposite trajectory.'
        ]
      },
      {
        heading: 'Adopting a growth mindset',
        body: [
          'You do not "decide" to have a growth mindset in a single moment. You build it through repeated choices to engage with difficulty instead of avoiding it. Mindset shifts happen through three mechanisms: new information that challenges old assumptions, new experiences that create new evidence, and new environments that surround you with different standards.',
          'The biggest trap is selective growth — being willing to grow in the areas that already feel safe while staying rigid in the areas that actually matter. Real mindset work is uncomfortable. If your growth feels easy, you are probably rearranging your comfort zone, not expanding it.'
        ]
      },
      {
        heading: 'Challenging strong beliefs',
        body: [
          'The strongest beliefs are the ones you have never questioned because they feel like your personality. "I’m just not a numbers person." "I’m not disciplined." These are not traits; they are untested assumptions wearing a costume. Challenge them the same way you challenge any belief — with evidence and deliberate practice — and watch how much of your "personality" was actually just a habit.'
        ]
      }
    ],
    apply: {
      reflection: 'Where do you already have a growth mindset? Where is your mindset still fixed — especially in the areas that matter most to your goals? Be honest about the gap.',
      action: 'Pick one fixed-mindset area and design a 7-day difficulty engagement plan — small daily actions that specifically require you to grow in that area.',
      prompts: [
        'Areas where my mindset is genuinely growth-oriented:',
        'Areas where my mindset is still fixed (the ones I avoid admitting):',
        'The fixed area I am committing to shift is…',
        'My 7-day difficulty engagement plan (Day 1–7):'
      ]
    },
    takeaways: [
      'Mindset is built through repeated engagement with difficulty, not one-time decisions.',
      'Selective growth is the enemy — go after the areas that actually scare you.',
      'Many "personality traits" are unquestioned beliefs that will move once challenged.'
    ],
    bridge: 'Mindset without action is inspiration that evaporates. Chapter Six is the execution engine — turning your new beliefs into a system that runs on your low-motivation days.'
  },
  {
    id: 6,
    part: 'Chapter Six',
    title: 'Actionable Strategies for Change',
    subtitle: 'Transformation without execution is just journaling',
    duration: '16 min read',
    read: [
      {
        heading: 'The nature of change — and assessing the need for it',
        body: [
          'Change does not happen in moments of inspiration. It happens in systems that function even when motivation is gone. Before you build the system, get honest about what actually needs to change. Not everything — the one or two things whose change would make the rest easier.',
          'Beliefs and mindsets either fuel change or fight it. A fixed mindset frames change as threat: proof you were doing it wrong. A growth mindset frames change as design: the natural next iteration. Which frame you hold decides whether you resist the very change you say you want.'
        ]
      },
      {
        heading: 'The strategies that create change',
        body: [
          'Environment design: your environment is a constant message to your subconscious. Redesign it to reinforce your new identity, not your old one. Make the right action the easy action and the wrong action the inconvenient one.',
          'Identity-based habits: do not build habits around outcomes, build them around who you are becoming. The question shifts from "What do I have to do?" to "What would this version of me do today?" Then do that, one small rep at a time.',
          'Accountability and review: you need witnesses — not to perform for, but to accelerate for. Find people whose standards challenge yours. And run a weekly review, not to judge yourself but to notice where old beliefs showed up in your decisions.'
        ]
      },
      {
        heading: 'Time management and productivity',
        body: [
          'Discipline is a structure, not a personality trait. Protect your highest-value work with time blocks before the day fills with other people’s priorities. Decide your daily non-negotiables — the minimum reps that compound — and treat them as appointments you do not cancel. Productivity is not doing more; it is making sure the few things that matter actually happen.'
        ]
      }
    ],
    apply: {
      reflection: 'Look at the last 90 days. Where have your actions aligned with your new beliefs? Where have you defaulted to old patterns — and what was the trigger?',
      action: 'Design your 30-day change protocol. Be specific: what you will do, when, and how you will know it is working.',
      prompts: [
        'The message my current environment sends about who I am:',
        'The environment signal I want to create instead:',
        'My identity-based daily habit (who am I becoming, and what does that person do daily):',
        'My accountability structure (person + how we check in):',
        'My weekly review ritual (day, time, questions I will ask):'
      ]
    },
    takeaways: [
      'Systems outlast motivation — build for your low-energy days, not your peak ones.',
      'Identity-based habits change you faster than outcome-based ones.',
      'Accountability and a weekly review turn intention into consistent behavior.'
    ],
    bridge: 'Even a great system meets adversity. Chapter Seven builds the muscle that keeps you executing when things get hard — resilience as a practice, not a personality trait.'
  },
  {
    id: 7,
    part: 'Chapter Seven',
    title: 'Building Resilience and Overcoming Setbacks',
    subtitle: 'The setback is part of the strategy — not a sign it is failing',
    duration: '14 min read',
    read: [
      {
        heading: 'Why resilience matters daily',
        body: [
          'Resilience is not bounce-back; it is forward movement through adversity. It is not the absence of pain — resilient people feel it fully. They simply process it faster and extract the lesson before the emotion finishes writing its story.',
          'The difference between a setback and a failure is the meaning you assign it. One is feedback; the other is identity. "That approach did not work" keeps you moving. "I am a failure" stops you cold. Choose the meaning carefully, because the meaning becomes the outcome.'
        ]
      },
      {
        heading: 'What resilient people have in common',
        body: [
          'Resilience is built in four ways. Clarity of purpose: you remember why when things get hard. Flexible thinking: you look for another path instead of insisting on the blocked one. Emotional processing: you neither suppress the feeling nor drown in it. And community: you refuse to white-knuckle it alone.',
          'Be aware of your brain’s negativity bias — it records failures far more strongly than wins. Left unmanaged, that bias convinces you that you fail more than you do. Counter it deliberately by keeping and revisiting evidence of the times you came through.'
        ]
      },
      {
        heading: 'Harnessing the power of resilience',
        body: [
          'Here is the data your fear ignores: you have survived 100% of your hardest days so far. That is not a slogan; it is a track record. Resilience is what keeps your new beliefs intact when your circumstances try to confirm your old ones. Build it on purpose, and setbacks stop being proof you were wrong and start being part of how you get it right.'
        ]
      }
    ],
    apply: {
      reflection: 'Think of a recent setback. How did your limiting beliefs show up in how you interpreted it? What would the resilient, growth-oriented version of you say about the same situation?',
      action: 'Write your resilience evidence record — five moments where you overcame something you did not think you could. This is your proof of concept.',
      prompts: [
        'The setback I am reinterpreting is…',
        'My old (limiting) interpretation was…',
        'My growth-oriented interpretation is…',
        'My five resilience-evidence moments:',
        'The purpose that pulls me forward when things get hard is…'
      ]
    },
    takeaways: [
      'Resilience is a practice built from purpose, flexibility, processing, and community.',
      'A setback is feedback; failure is a meaning you assign — choose it deliberately.',
      'You already hold more evidence of your resilience than you give yourself credit for.'
    ],
    bridge: 'You have removed what held you back. Now install what carries you forward. Chapter Eight is about the empowering beliefs that become your new default operating system.'
  },
  {
    id: 8,
    part: 'Chapter Eight',
    title: 'Embracing Empowering Beliefs',
    subtitle: 'Earned truth, not positive self-talk over unresolved doubt',
    duration: '14 min read',
    read: [
      {
        heading: 'What an empowering belief actually is',
        body: [
          'An empowering belief is not a positive phrase layered over unresolved doubt. It is a conclusion you reached through evidence, action, and honest self-examination. That is why it holds when things get hard — you did not decorate the doubt, you replaced it.',
          'Empowering beliefs share a few traits. They expand your perception of what is possible. They fuel action rather than replace it. They survive failure without collapsing. And they align with your actual values, not a borrowed definition of success.'
        ]
      },
      {
        heading: 'How belief and mindset drive empowerment',
        body: [
          'Empowerment is not a feeling you wait for; it is a byproduct of beliefs that put you back in the driver’s seat. When you believe you can influence outcomes, you take the actions that influence outcomes — and the results become new evidence, which strengthens the belief. That is the empowerment loop, and self-confidence is what keeps it turning.',
          'Self-confidence beliefs have an outsized impact on growth because they determine whether you attempt the very things that would grow you. Believe you can figure it out, and you start; start, and you gather proof; gather proof, and confidence compounds.'
        ]
      },
      {
        heading: 'The path forward — beliefs in action',
        body: [
          'Empowering beliefs are not embraced once; they are practiced daily. Speak them, act from them, and surround them with evidence until they stop feeling like aspiration and start feeling like fact. The person who does this work is not the person who began it — and that gap between who you were and who you are choosing to be is the one-percent shift, repeated.'
        ]
      }
    ],
    apply: {
      reflection: 'Compare who you were at the start of this book to who you are now. What beliefs have you released? What beliefs have you installed? What is different about how you see your own potential?',
      action: 'Write your empowering-beliefs declaration — the statements you now choose to live from. Make them earned and specific. Return to it weekly.',
      prompts: [
        'The limiting beliefs I have released through this work:',
        'The empowering beliefs I now hold about myself:',
        'My empowering-beliefs declaration (in my own words):',
        'One action this week that proves I am living from these beliefs:'
      ]
    },
    takeaways: [
      'Empowering beliefs are earned through action and evidence — not affirmation alone.',
      'Self-confidence starts the loop: attempt, gather proof, compound.',
      'Beliefs must be practiced daily to become your default, not just declared once.'
    ],
    bridge: 'Beliefs do not live in a vacuum. Chapter Nine is about architecture — building the environment and the people around you that keep empowering beliefs alive.'
  },
  {
    id: 9,
    part: 'Chapter Nine',
    title: 'Creating a Supportive Environment',
    subtitle: 'Your surroundings vote on who you become — every day',
    duration: '13 min read',
    read: [
      {
        heading: 'Why environment is not a luxury',
        body: [
          'A supportive environment is not a nice-to-have; it is architecture. The people around you, the spaces you occupy, and the inputs you consume are constantly reinforcing or eroding your beliefs — whether you designed them to or not. Willpower is a poor substitute for an environment that pulls you in the right direction by default.',
          'Your beliefs and your environment shape each other. Limiting beliefs make you tolerate environments that confirm them; empowering beliefs make you seek environments that stretch you. Change the environment on purpose and you give the new belief somewhere to grow.'
        ]
      },
      {
        heading: 'Building a supportive environment',
        body: [
          'Start with people. Who raises your standard just by being around them, and who quietly lowers it? You do not have to cut people off, but you do have to be intentional about proximity and influence. Add voices — mentors, communities, peers — whose normal is your next level.',
          'Then shape the physical and digital spaces. Remove the cues that trigger old patterns and add cues that prompt the new ones. Curate your inputs — what you read, watch, and scroll — because your mind adopts the standards it is repeatedly exposed to.'
        ]
      },
      {
        heading: 'How environment accelerates growth',
        body: [
          'The right environment makes growth feel less like force and more like current. When your surroundings assume you are capable, disciplined, and rising, you begin to meet the assumption. Design the room so that becoming your next self is the path of least resistance.'
        ]
      }
    ],
    apply: {
      reflection: 'Look honestly at your current environment — people, spaces, and inputs. Which parts reinforce the person you are becoming, and which quietly pull you back?',
      action: 'Design one upgrade in each layer. Small and specific beats sweeping and vague.',
      prompts: [
        'One relationship or community that raises my standard (and how I will get more of it):',
        'One influence that lowers my standard (and how I will limit it):',
        'One change to my physical or digital space this week:',
        'One input (read/watch/listen) I will add to reinforce my new beliefs:'
      ]
    },
    takeaways: [
      'Environment is architecture — it reinforces or erodes your beliefs daily.',
      'Proximity is influence: be intentional about the people and inputs closest to you.',
      'Design your surroundings so becoming your next self is the easiest path.'
    ],
    bridge: 'You have the beliefs, the system, and the environment. Chapter Ten makes it a way of life — growth not as a finish line, but as a direction you keep choosing.'
  },
  {
    id: 10,
    part: 'Chapter Ten',
    title: 'The Journey of Continuous Growth',
    subtitle: 'Not a destination — an orientation you keep choosing',
    duration: '13 min read',
    read: [
      {
        heading: 'Understanding continuous growth',
        body: [
          'Continuous growth is the practice of getting one percent better, repeatedly, for longer than most people are willing to. It is not about dramatic transformation; it is about a trajectory you refuse to abandon. Small, consistent improvement compounds into results that look like overnight success to everyone who missed the years of reps.',
          'The mindset underneath it is simple but demanding: the work is never "done," and that is the good news. There is always a next level, which means there is always somewhere to go. Growth stops being pressure and becomes the point.'
        ]
      },
      {
        heading: 'How beliefs and mindset sustain the journey',
        body: [
          'Your beliefs decide whether you keep going when the novelty wears off. Believe growth is finite and you will quit at the first plateau. Believe growth is continuous and you will treat the plateau as the base camp for the next climb. The one-percent philosophy lives or dies on this belief.',
          'Sustaining it requires rhythm: regular reflection, honest measurement, and the willingness to adjust. You are not chasing perfection — you are protecting momentum. The question is never "Am I there yet?" It is "Am I still moving toward who I am becoming?"'
        ]
      },
      {
        heading: 'Growth and personal empowerment',
        body: [
          'Continuous growth is the engine of lasting empowerment. Every rep is more evidence that you can change, which strengthens every empowering belief you have built. The person committed to growth is never at the mercy of a single outcome, because they are always building the next version of themselves. That is what it means to live in the top one percent — not comparison to others, but relentless improvement over who you were yesterday.'
        ]
      }
    ],
    apply: {
      reflection: 'What would "one percent better" look like in the single area that matters most to you right now — daily, not someday? What has stopped you from sustaining it before?',
      action: 'Design your continuous-growth loop: one daily rep, one weekly review, and one signal that will tell you it is working.',
      prompts: [
        'My one-percent daily rep is…',
        'My weekly reflection question is…',
        'How I will measure that I am still moving (not perfect, just moving):',
        'The version of me I am building toward over the next 90 days:'
      ]
    },
    takeaways: [
      'Growth is a direction you keep choosing, not a finish line you cross.',
      'Small, consistent improvement compounds — the plateau is base camp, not the end.',
      'Momentum, measured and protected, is what turns growth into lasting empowerment.'
    ],
    bridge: 'One chapter remains — and it is less a summary than a send-off. The Conclusion is about the limitless potential all this work was really for.'
  },
  {
    id: 11,
    part: 'Conclusion',
    title: 'Embracing Your Limitless Potential',
    subtitle: 'This is not the end of the journey — it is the starting line',
    duration: '10 min read',
    read: [
      {
        heading: 'Understanding infinite potential',
        body: [
          'Potential is not a fixed amount you were issued at birth. It is what remains possible the moment you stop believing you have reached your limit. Every chapter of this book has been chipping away at the false ceilings — the learned "I can’ts" — that made your potential look smaller than it is.',
          'The point was never to make you feel good for an afternoon. It was to change the lens permanently, so that possibility, not limitation, becomes your default way of seeing.'
        ]
      },
      {
        heading: 'How beliefs shape what is possible',
        body: [
          'Your beliefs and your potential are inseparable. Believe you are capped, and you will act in ways that confirm the cap. Believe you can grow, and you will take the actions that expand what is possible — and each action becomes evidence that raises the ceiling again. Potential is not discovered all at once; it is unlocked one belief and one action at a time.'
        ]
      },
      {
        heading: 'Embrace it — and keep going',
        body: [
          'The person who finishes this work is not the person who started it. You have named the chains, understood how they formed, challenged and reframed them, upgraded your mindset, built systems and resilience, installed empowering beliefs, and designed an environment to protect them. That is not a small thing. That is a new operating system.',
          'So do not close the book and drift back to autopilot. Keep reading, keep applying, keep growing one percent at a time. Your potential is limitless — not as a slogan, but as a practical fact you now have the tools to prove. Go prove it.'
        ]
      }
    ],
    apply: {
      reflection: 'If there were no ceiling on what is possible for you — and there is not — what would you finally give yourself permission to pursue?',
      action: 'Write your one-percent declaration and your first move. Then take the first move within 48 hours.',
      prompts: [
        'The false ceiling I am officially retiring is…',
        'What becomes possible now that I have done this work:',
        'My one-percent declaration (the beliefs I will live from):',
        'My first action in the next 48 hours is…'
      ]
    },
    takeaways: [
      'Potential is not fixed — it expands every time you challenge a false ceiling.',
      'Belief and action unlock potential together, one rep at a time.',
      'You now hold a new operating system; the work is to keep running it.'
    ],
    bridge: 'You have read and applied the whole book. The next environment is the community — bring what you built here, and build further.'
  }
];

const STORAGE_KEY = 'icant-book-course-v1';

// ── State ────────────────────────────────────────────────────────────────────

const state = { completed: {}, answers: {} };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    state.completed = s.completed || {};
    state.answers = s.answers || {};
  } catch {}
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      completed: state.completed,
      answers: state.answers
    }));
  } catch {}
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bookBanner(compact) {
  return `
    <div style="background:#0A0000;border:1px solid #330000;border-radius:12px;padding:${compact ? '14px 16px' : '18px 20px'};display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:6px;">THE BOOK</div>
        <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px;font-style:italic;">${esc(BOOK_TITLE)}</div>
        <div style="font-size:12px;color:#AAAAAA;line-height:1.5;">Read the chapter here, then apply it — with or after your own copy. By ${esc(BOOK_AUTHOR)}.</div>
      </div>
      <a href="${esc(BOOK_URL)}" target="_blank" rel="noopener"
        style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;background:#E60306;color:#fff;
          border-radius:8px;font-size:13px;font-weight:600;letter-spacing:0.5px;white-space:nowrap;flex-shrink:0;
          transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
        Get the Book →
      </a>
    </div>`;
}

function readTabHtml(mod) {
  const sections = mod.read.map((sec) => `
    <section style="display:flex;flex-direction:column;gap:12px;">
      <h3 style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:#E60306;letter-spacing:0.5px;margin:0;">${esc(sec.heading)}</h3>
      ${sec.body.map((p) => `<p style="color:#D6D6D6;line-height:1.8;font-size:15px;margin:0;">${esc(p)}</p>`).join('')}
    </section>`).join('<div style="height:8px;border-bottom:1px solid #1A1A1A;margin:6px 0;"></div>');

  return `
    <div style="display:flex;flex-direction:column;gap:24px;max-width:720px;">
      <div style="background:linear-gradient(135deg,#1A0000 0%,#110000 100%);border-left:3px solid #E60306;border-radius:12px;padding:18px 20px;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:6px;">${esc((mod.part || '').toUpperCase())} · READ</div>
        <p style="color:#EDEDED;line-height:1.7;font-size:14px;margin:0;">${esc(mod.subtitle)}</p>
      </div>
      ${sections}
      <div style="margin-top:8px;">${bookBanner(true)}</div>
      <div style="background:#0D0D0D;border:1px dashed #2A2A2A;border-radius:10px;padding:16px 18px;text-align:center;">
        <p style="color:#AAAAAA;font-size:13px;line-height:1.6;margin:0;">Done reading? Open the <strong style="color:#fff;">Apply It</strong> tab and do the work while it is fresh. Reading changes what you know; applying changes who you are.</p>
      </div>
    </div>`;
}

function applyTabHtml(mod) {
  const prefix = `m${mod.id}`;
  const prompts = mod.apply.prompts.map((prompt, i) => {
    const key = `${prefix}_${i}`;
    const val = esc(state.answers[key] || '');
    return `
      <div>
        <label style="display:block;font-size:12px;color:#AAAAAA;margin-bottom:6px;font-style:italic;">${esc(prompt)}</label>
        <textarea class="icant-textarea" data-key="${esc(key)}" placeholder="Write your answer here..."
          style="width:100%;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;color:#fff;padding:10px 12px;
            font-size:13px;line-height:1.5;font-family:inherit;resize:vertical;min-height:80px;box-sizing:border-box;">${val}</textarea>
      </div>`;
  }).join('');

  return `
    <div style="max-width:720px;">
      <div style="margin-bottom:20px;">
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:6px;letter-spacing:0.5px;">APPLY IT</h2>
        <p style="color:#AAAAAA;font-size:13px;margin:0;">Your answers save automatically on this device. Be honest — no one else sees this.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:8px;">REFLECT</div>
          <p style="color:#CCC;line-height:1.7;font-size:14px;margin:0;">${esc(mod.apply.reflection)}</p>
        </div>
        <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:8px;">DO THE WORK</div>
          <p style="color:#CCC;line-height:1.7;font-size:14px;margin-bottom:20px;">${esc(mod.apply.action)}</p>
          <div style="display:flex;flex-direction:column;gap:14px;">${prompts}</div>
        </div>
      </div>
    </div>`;
}

function takeawaysTabHtml(mod) {
  const isCompleted = !!state.completed[mod.id];
  const items = mod.takeaways.map((item, i) => `
    <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;background:#111;border:1px solid #1E1E1E;border-radius:8px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:#E60306;line-height:1;flex-shrink:0;width:20px;">${i + 1}</div>
      <p style="color:#D0D0D0;line-height:1.6;font-size:13px;margin:0;">${esc(item)}</p>
    </div>`).join('');

  const completeBanner = isCompleted
    ? `<div style="background:#001A00;border:1px solid #00AA00;border-radius:10px;padding:14px 20px;color:#00AA00;font-size:13px;font-weight:600;text-align:center;">✓ Chapter Complete — Keep Moving</div>`
    : '';

  const isLast = mod.id === MODULES[MODULES.length - 1].id;

  return `
    <div style="display:flex;flex-direction:column;gap:24px;max-width:720px;">
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:14px;">KEY TAKEAWAYS</div>
        <div style="display:flex;flex-direction:column;gap:10px;">${items}</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A0000 0%,#1A0000 100%);border:1px solid #E60306;border-radius:12px;padding:20px;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:10px;">WHAT'S NEXT</div>
        <p style="color:#E0E0E0;line-height:1.7;font-size:13px;margin:0;">${esc(mod.bridge)}</p>
      </div>
      ${completeBanner}
      ${isLast && isCompleted ? `
      <div style="background:#0A0A00;border:1px solid #555500;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:10px;letter-spacing:2px;color:#CCCC00;font-weight:600;margin-bottom:10px;">YOU FINISHED THE BOOK</div>
        <p style="color:#E0E0D0;line-height:1.7;font-size:14px;margin-bottom:16px;">You read and applied every chapter. That puts you in a very small group. If this work moved you, help someone else find it — an honest review takes two minutes and can change a life.</p>
        <a href="${esc(BOOK_URL)}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:8px;padding:13px 24px;background:#E60306;color:#fff;border-radius:8px;
            font-size:14px;font-weight:600;letter-spacing:0.5px;transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">★ Leave a Review →</a>
      </div>` : ''}
    </div>`;
}

// ── Public mount ──────────────────────────────────────────────────────────────

const byId = (id) => MODULES.find((m) => m.id === id);

let _loaded = false;

export async function mount({ startAt } = {}) {
  if (!_loaded) {
    loadState();
    _loaded = true;
  }

  mountCoursePlayer({
    brand: 'THE ONE PERCENT NATION',
    courseTitle: "I CAN'T: READ & APPLY",
    modules: MODULES.map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: m.subtitle,
      eyebrow: m.part,
      duration: m.duration,
      meta: `${m.part} · ${m.duration}`
    })),
    tabs: [
      { id: 'read', label: 'Read', html: (m) => readTabHtml(byId(m.id)) },
      {
        id: 'apply', label: 'Apply It', html: (m) => applyTabHtml(byId(m.id)),
        bind: (root) => {
          root.querySelectorAll('.icant-textarea').forEach((ta) => {
            ta.addEventListener('input', () => {
              state.answers[ta.dataset.key] = ta.value;
              persistState();
            });
          });
        }
      },
      { id: 'takeaways', label: 'Takeaways', html: (m) => takeawaysTabHtml(byId(m.id)) }
    ],
    labels: {
      complete: 'Mark Complete & Continue →',
      completeLast: 'Mark Complete & Finish →',
      completed: '✓ Completed — Next Chapter →',
      completedLast: '✓ Book Complete'
    },
    progress: {
      isComplete: (id) => !!state.completed[id],
      markComplete: async (id) => {
        state.completed[id] = true;
        persistState();
      }
    },
    startAt: typeof startAt === 'number' ? startAt : undefined
  });
}
