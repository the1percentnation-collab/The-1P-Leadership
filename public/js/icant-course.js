// I Can't: The Course — course content + tab renderers.
// Mounted via courses-registry.js when ?course=icant&module=N is active.
// The workspace shell (sidebar, topbar, tabs, complete footer) is the shared
// Coursera-style player in course-player.js — the same UI every course uses.
//
// This course is the companion to Anthony Brown Sr.'s book "I Can't: Is Not
// A Strategy". It follows the book exactly: one module per chapter, in the
// book's order, and every Workbook is the book's own exercise for that chapter
// (the same ten exercises collected in the book's Appendix, "The Toolkit").
// The book's rule is that the exercises build on each other: the sentence you
// write in Chapter 1 is the one you rewrite in Chapter 8. The Workbook keeps
// every answer so that hand-off actually happens.
//
// Do not add teaching here that is not in the book. If the book changes, this
// file changes with it.

import { mountCoursePlayer } from './course-player.js';

export const BOOK_URL = 'https://a.co/d/0fSUaomu';
export const BOOK_TITLE = 'I Can\'t: Is Not A Strategy';

export const MODULES = [
  {
    id: 0,
    title: 'Start Here: How This Works',
    subtitle: 'Read with a pen. The exercises are the book.',
    chapterRef: 'Introduction',
    duration: '8 min',
    welcome: 'I moved more times than I can count. For a while there were six of us living hotel to hotel, and everything I owned traveled in trash bags. Not suitcases. Trash bags. I dropped out of high school and never sat in a college classroom. If someone had made a list of the people least likely to make anything of themselves, my name belonged near the top. I say that plainly because it was my reality. It was never my identity. This course, like the book, is for anyone who is tired of watching their own potential go to waste.',
    coreTeaching: {
      headline: 'How to Use This Course',
      points: [
        'Every module matches one chapter of the book, in the book\'s order. Read the chapter, then open the module. The lesson tab is the chapter\'s core teaching. The Workbook tab is that chapter\'s exercise.',
        'Every chapter ends with an exercise, and the exercises are the book. The chapters explain the machinery. The exercises are where you take it apart. Each one takes ten to twenty minutes.',
        'They build on each other. The sentence you write down in the first module is the same one you rewrite in module eight. Your answers are saved here so you can find them again.',
        'Do them for real. A belief loses most of its power the moment it has to sit still and be looked at, and that only happens when you write it down.',
        'Where you start does not get the final say on where you end up. That is the first line of the book and the whole point of the course.'
      ]
    },
    fromTheBook: 'The reading was never the point. The reps are.',
    exercise: {
      name: 'Your Starting Line',
      source: 'Before Chapter 1',
      intro: 'This one is not from the book. It is a marker so that when you finish, you can look back and see exactly where you began. Two lines, honest.',
      steps: [
        { label: 'Why you picked this up', prompt: 'In one or two sentences, what made you start this? Not the polished answer. The real one.' },
        { label: 'Where you play small', prompt: 'Name the one area of your life where you keep starting over, or play it safe to stay safe.' }
      ]
    },
    summary: [
      'One module per chapter. Read the chapter first, then do the module.',
      'The exercises are the book. Do them on paper or in the Workbook, never in your head.',
      'They build on each other, so keep every answer.'
    ],
    bridge: 'Chapter 1 starts with the day someone told me who I was going to be. Read it, then come back and put your own sentence on the page.'
  },

  {
    id: 1,
    title: 'Understanding Limiting Beliefs',
    subtitle: 'A sentence about yourself that you did not choose',
    chapterRef: 'Chapter 1',
    duration: '20 min',
    welcome: 'I was a kid the first time someone told me who I was going to be. It was my father. He looked at me and said I would never become anything, because I never finish what I start. He did not say it in anger. He said it flat. Like a fact. Like weather. I did not argue. I went quiet, turned, and walked away, and somewhere in those steps the sentence slid under my skin and set. That one sentence followed me for years. It moved in behind my eyes and started making decisions for me.',
    coreTeaching: {
      headline: 'What a Limiting Belief Really Is',
      points: [
        'A limiting belief is a conclusion you reached about yourself and then stopped questioning. You decided you are a certain kind of person, filed it away as fact, and stopped testing it.',
        'The trap is not the thought. Everyone has doubts. The trap is that the belief stops feeling like a belief and starts feeling like reality. When it crosses that line, it goes to work.',
        'It works quietly. It shows up as a reasonable-sounding reason not to try. It sounds like wisdom. It is fear wearing the costume of common sense.',
        'The belief makes itself true. It hands you the outcome, then points at the outcome as proof. The prediction causes the behavior, the behavior confirms the prediction. A closed loop.',
        'Almost nobody arrives at one on their own. It gets handed to you, early, by a voice with power over how you see yourself. Then the voice becomes yours. It is inherited, then self-administered.',
        'That is the best news in the chapter. A belief you learned is a belief you can trace. A belief you repeat is a belief you can interrupt.',
        'The cost is not that it makes you feel bad. It is every door you did not walk through because you had already decided how it would end.'
      ]
    },
    fromTheBook: 'A limiting belief does not have to be true to take hold. It does not even have to be fair. It just has to come from the right voice at the wrong age.',
    exercise: {
      name: 'Fact vs. Verdict',
      source: 'Chapter 1',
      intro: 'Most limiting beliefs survive because they are never examined. This exercise pulls one out of the blur and makes it answer for itself. Ten minutes. Do not do this in your head. On the page the belief loses the authority it has when it is only a feeling.',
      steps: [
        { label: '1. Write the sentence', prompt: 'In one line, write your limiting belief in the exact voice you first heard it. Not the polite version. The raw one. Mine was, "You will never become anything, because you never finish what you start."' },
        { label: '2. Name the source', prompt: 'Who handed you this sentence, and roughly when? A parent, a teacher, a single moment, a failure you turned into a rule. If you cannot name one moment, write the earliest time you remember believing it. You are dating the belief so you can stop treating it as timeless.' },
        { label: '3. Split it in two', prompt: 'Every limiting belief glues a fact to a verdict. The fact is what actually happened. The verdict is the meaning someone stamped onto it. Write your fact on one line and your verdict on the next.' },
        { label: '4. Put the verdict on trial', prompt: 'Find one piece of evidence from your own life that the verdict is not a law. One time you finished something. One time you were braver than the belief said. It only has to be real, because a single true counterexample is enough to prove a verdict was never a fact.' }
      ]
    },
    summary: [
      'A limiting belief is a conclusion you stopped questioning, not a fact about you.',
      'It survives by gluing a real fact to an unproven verdict, then collecting evidence for the verdict.',
      'It was handed to you, then repeated by you. What you repeat, you can interrupt.'
    ],
    bridge: 'Keep what you wrote. This one sentence, split into its fact and its verdict, is the belief we take apart across the rest of the course. Chapter 2 goes inside the brain to explain why it fired on its own, and why that same fact is the reason you are not stuck with it.'
  },

  {
    id: 2,
    title: 'The Neuroscience of Belief',
    subtitle: 'A belief is a road, not an opinion',
    chapterRef: 'Chapter 2',
    duration: '22 min',
    welcome: 'I was homeschooled, living hotel to hotel, and it was up to me to finish my workbooks. Nobody was checking. A skipped day became a skipped week. The day it all hit, I was trying to teach myself algebra, alone, feeling dumber with every problem I could not crack, and the voice said: there is no way you will overcome what comes next. Decades later, sitting down to write the book, the same thing fired. Who do you think you are. You are a ninth grade dropout. It arrived before I could think, the way your hand snaps back from a hot stove. That is the thing about a belief. It stops being something you think and becomes something your brain does automatically.',
    coreTeaching: {
      headline: 'Why the Belief Fires on Its Own, and Why You Are Not Stuck With It',
      points: [
        'A belief is a road, not an opinion. Your brain is a landscape and every thought is a path across it. Walk it once and it is barely there. Walk it ten thousand times and it is a paved road you travel without looking.',
        'That sits on a real idea from Donald Hebb in 1949: neurons that fire together wire together. Every repetition lays more asphalt. "I\'m not qualified" was not a thought I reached for. It was the highway.',
        'The emotional moments cut the deepest. James McGaugh showed the amygdala strengthens how firmly an experience is stored. The moments that shake you get written in permanent ink. The ordinary ones get pencil.',
        'The bad ones shout louder. Roy Baumeister\'s 2001 paper is titled "Bad Is Stronger Than Good." One criticism outweighs ten compliments. That is not weakness. It is the factory setting, and a setting can be changed.',
        'The part that sets you free: the brain that built the road can build a new one. Eleanor Maguire scanned London taxi drivers and found the hippocampus physically larger, and grown the longer they had driven. Grown adults. Brains reshaped by repetition.',
        'The road is not permanent. It only feels permanent because you have been driving it your whole life. Start walking a new path, again and again, with real feeling behind it, and your brain will pave that one too.',
        'This is a simplified picture, not a brain scan of you. But the core is real and it is enough to act on. What you repeat, you strengthen. What you feel deeply, you carve deeper. What you practice, you can rebuild, at any age.'
      ]
    },
    fromTheBook: 'I stopped only traveling the road that says I can\'t, and I started building the one that says watch me.',
    exercise: {
      name: 'Catch the Reflex, Pave the New Road',
      source: 'Chapter 2',
      intro: 'You cannot stop the old road from firing. You can catch it and take a different turn, and every time you do, you pave a little more of the new one. For the next seven days keep a simple two-column log. Two minutes at a time. Use the space below to start it and to record what you noticed at the end of the week.',
      steps: [
        { label: '1. Column one, "Old road"', prompt: 'Any time you catch the old belief firing, write three things fast: what triggered it, the exact automatic sentence in its real voice, and what your body did (chest tight, shoulders drop, the urge to quit). Log your first few entries here.' },
        { label: '2. Column two, "New road"', prompt: 'Right next to it, write the replacement you are choosing to run instead. Not a lie, and not a cheer. A truer sentence you can actually stand behind, plus one piece of real evidence. Mine: "I am not behind, I am building, and the proof is that I am doing the thing right now."' },
        { label: '3. After seven days', prompt: 'Read back through your log and write down one thing: how predictable the old road is. Same triggers. Same sentence. That predictability is not bad news. It means you finally know the exact stretch of road you are about to rebuild.' }
      ]
    },
    summary: [
      'Beliefs are paved by repetition. What fires automatically was practiced, not chosen.',
      'Emotion is the ink. The moments that hurt are the ones that got written permanently.',
      'The same brain that paved the old road can pave a new one, at any age. Repetition is the paving.'
    ],
    bridge: 'Some days the old road will win. Write it down anyway. The goal is not a perfect week. The goal is reps. Chapter 3 is about learning to catch the voice in the act, because you cannot fight what you cannot see.'
  },

  {
    id: 3,
    title: 'Identifying Limiting Beliefs',
    subtitle: 'Watch what you do with good news',
    chapterRef: 'Chapter 3',
    duration: '22 min',
    welcome: 'The first place that was ever mine held a sheet, a comforter, a pillow, one fork, one knife, one plate, and one Rubbermaid drawer for a dresser. I slept on the floor and I slept like a baby, because for the first time the environment answered to me. I worked in the detail department at a dealership. Effort in, money out. Then one day the general manager asked me to move up into service, and my first reaction was not pride. It was confusion. I actually asked him, why did you choose me. All I do is come to work and do my job. That reaction was not humility. It was a limiting belief, and for once it had stepped out into the light where I could see it.',
    coreTeaching: {
      headline: 'You Cannot Fight What You Cannot See',
      points: [
        'A limiting belief does not feel like a belief. It feels like a fact about the world, and you do not argue with facts. You cannot fight an enemy you have mistaken for the furniture.',
        'It wears disguises. Humility, so shrinking feels like being a good person. Realism, so playing small feels smart. "Just the way I am," so a belief you learned feels like a personality you were born with.',
        'A belief is not the same as a limit. A real limit lives in the world and is checkable. A limiting belief is about you, vague, sweeping, and impossible to prove. Ask any voice in your head: is this a fact about the world, or a verdict about me? Facts you deal with. Verdicts you question.',
        'The clearest tell: watch what you do the moment something good happens. If your instinct is to shrink, explain it away, credit luck, you have found the edge of a belief. It fights hardest at the exact moment life disagrees with it.',
        'Listen to your language. "All I do." "Just." "Only." "I got lucky." The word "just" alone will lead you to half of them. And notice what makes you defensive. We get angry defending the beliefs we built our safety on.',
        'The most expensive beliefs never produce a moment at all. You do not apply, so there is no rejection. You do not start, so there is no failure. Look at your avoidance. What do you never even let yourself want?',
        'Reality leaves clues. Within a year of that promotion I moved up two more times. If the results keep contradicting your story, it is not the results that are wrong. Keep an honest ledger. A limiting belief is a terrible accountant.',
        'Name it in one sentence. A blur cannot be fought, only felt. One clean sentence makes it an object on the table. Something with edges. Something you can pick up, turn over, and eventually set down.'
      ]
    },
    fromTheBook: 'The belief did not have to beat me. It just had to keep me from ever showing up.',
    exercise: {
      name: 'The Shrink List',
      source: 'Chapter 3',
      intro: 'You identify a limiting belief by catching what you do when reality tries to prove it wrong. This exercise makes you do that on purpose. About fifteen minutes, and it works best if you are willing to be honest to the point of a little discomfort.',
      steps: [
        { label: '1. List three recent wins', prompt: 'Three moments from the last month or two when something went right. A compliment, an opportunity, a time someone chose you, a goal you hit. They do not have to be big. My entire climb started with someone simply noticing how I worked.' },
        { label: '2. Write your real first reaction to each', prompt: 'Not the polite version. The honest one that fired before you could clean it up. Did you deflect it, explain it away, credit luck or timing, feel like a fraud, wait for the other shoe to drop, ask why me? Write the exact thought you had.' },
        { label: '3. Find the belief underneath', prompt: 'For each reaction, finish this sentence: "For me to react that way, I must secretly believe ______ about myself." Whatever fills that blank is a limiting belief. You just identified it by its shadow.' },
        { label: '4. Circle the repeat', prompt: 'If the same belief shows up under more than one win, write it here. That repeated one is the voice running the most of your life right now, and it is the one we go after first. Mine: "I am not the kind of person good things are supposed to happen to."' }
      ]
    },
    summary: [
      'Ask of every voice in your head: fact about the world, or verdict about me?',
      'The flinch when something good happens is the belief defending its territory. That is the tell.',
      'Get it into one sentence. A sentence has edges. A fog does not.'
    ],
    bridge: 'Keep this list. In Chapter 4 we start challenging what you just dragged into the light, and we begin the work of taking the wheel. You have already done the part most people never do. You looked straight at the voice instead of mistaking it for yourself.'
  },

  {
    id: 4,
    title: 'Challenging and Reframing Beliefs',
    subtitle: 'To me, or for me',
    chapterRef: 'Chapter 4',
    duration: '24 min',
    welcome: 'For years there was a lie I told myself: I had time. The most dangerous place to be is not stagnant. It is living in a state of potential. Then my phone rang at work. It was my wife, Kailey, telling me I was going to be a dad. Within seconds of the best news of my life, a limiting belief came rushing in. What kind of father can you possibly be, in the state you are in right now? When I got in my car that evening, before I turned the key, I made the decision. I had spent stretches of my childhood living out of a car. Now I sat in one and decided my child never would.',
    coreTeaching: {
      headline: 'Reframing Is Not Lying. It Is Choosing the Reading That Moves You.',
      points: [
        'Everything that ever happened to you can be read two ways. As a list of things that happened to me, or as things that happened for me. Not because they were good. Because of what they built, taught, and prepared in you.',
        'That is what reframing is. Not painting a smile over a hard thing. Choosing the reading that is just as true but moves you forward. The facts do not change. The meaning does. And the meaning is the part you have been giving away for free.',
        'My father\'s sentence, read to me, is a wound. Read for me, it is the exact fear I have spent my whole life outworking. Same words. I get to choose which version I carry into the room.',
        'Expectation decides what you reach for. It is not hype in a mirror. It is the standard you quietly hold, and it decides which doors you even walk toward. Low expectation closes them before you get near.',
        'Kids do not become what you tell them to be. They become what they watch you expect of yourself. That raised my standard faster than any motivation ever had.',
        'Your past was written for you. Your future is not. Nobody chooses the first chapter. But the first chapter is not the book.',
        'Breaking a cycle takes intention, and intention is not a feeling. It is a decision you make, then make again the next morning, and again on the days the old voice is loudest.',
        'How to challenge a belief in real time, in under a minute: catch it and name it in one sentence. Put it on trial (fact or verdict?). Reframe it (how is this happening for me?). Act before you feel ready. That last step is the one everyone skips.'
      ]
    },
    fromTheBook: 'Your past was written for you. Your future is not.',
    exercise: {
      name: 'To Me, or For Me',
      source: 'Chapter 4',
      intro: 'This exercise takes the belief you have been carrying and forces it through the reframe engine, then turns it into an expectation and a move. Give it twenty minutes and real honesty.',
      steps: [
        { label: '1. Write the belief', prompt: 'Take the belief you circled in Chapter 3, or the single hardest thing your past ever handed you. Put it in one sentence, in the real voice you hear it in.' },
        { label: '2. Write the "to me" version', prompt: 'How that belief reads as something that happened to you. The damage it did, the proof it seems to offer against you. Do not rush it. You have to see the heavy version clearly before you can set it down.' },
        { label: '3. Write the "for me" version', prompt: 'How the exact same facts could read as something that happened for you. What did it build, teach, toughen, or prepare in you? Not a lie and not a bright side. A truer, forward-facing angle on the same events.' },
        { label: '4. Set the new expectation', prompt: 'In one present-tense sentence, write who you are choosing to be and what you now expect of yourself. Not "I hope to" or "I want to." Write "I am," as if it is already true.' },
        { label: '5. Name who else it is for', prompt: 'One person, besides you, who is affected by whether you break this or not. A child, a partner, a friend, the younger version of you, someone coming up behind you who is watching. When your own reasons run thin, theirs will carry you. Mine had a due date.' },
        { label: '6. Take one action this week', prompt: 'One specific thing you will do in the next seven days that a person living your new expectation would do. Small is fine. Real is required. The reframe does not count until it moves your feet.' }
      ]
    },
    summary: [
      'Same facts, two readings. "To me" pins you down. "For me" points forward. Both are true. You choose.',
      'Expectation sets the ceiling. Raise the standard you hold for yourself and the doors reopen.',
      'A reframe that never becomes an action is a nicer daydream. Act before you feel ready.'
    ],
    bridge: 'Read the "for me" line and the new expectation out loud. That is not who you are pretending to be. That is who the facts of your life say you are already allowed to become. Chapter 5 goes into the shift itself: the difference between a mind that believes it is stuck and one that believes it can grow.'
  },

  {
    id: 5,
    title: 'The Power of Mindset Shifts',
    subtitle: 'You walk around with two minds',
    chapterRef: 'Chapter 5',
    duration: '20 min',
    welcome: 'I have spent four chapters telling you my story, so you would know I am not talking down to you from some finished place. This one is different. This one is not about me. It is about you. Everything so far, the beliefs, the identifying, the reframing, runs on top of one thing underneath it. Your mindset. The operating system your beliefs are installed on. I cannot shift yours for you. I can only show you where the switch is.',
    coreTeaching: {
      headline: 'The Stuck Mind and the Growing Mind',
      points: [
        'You have two minds and you switch between them all day. The stuck mind believes you are basically finished, that ability is fixed. A challenge is a threat, effort is proof you are not naturally good enough, and failure is a verdict about who you are.',
        'The growing mind believes you are still being built. What you cannot do today is a thing you cannot do yet. A challenge is interesting, effort is the price of growth, and failure is information.',
        'Carol Dweck\'s research calls these a fixed mindset and a growth mindset. You do not need the research. You have lived in both.',
        'You are already both. Mindset is not a personality type. There is an area where you are fully growth-minded right now, where a mistake just tells you what to fix. You own a growing mind. You just keep it locked in one small room.',
        'The stuck mind is concentrated in the exact places that matter most to you. It guards the doors you care about, because those are the doors where it has the most to protect.',
        'The stuck mind sounds like self-awareness. "I am just not a creative person" feels like honesty. True self-awareness says I have not developed this skill. The stuck mind says I cannot. Any time knowing yourself sounds like giving up on yourself, check which mind is talking.',
        'The most powerful word you are not using is yet. "I am not good at this." Closed door. "I am not good at this yet." Same sentence with a future attached.',
        'The shift happens in the three seconds right after something goes wrong. One mind says this proves it. The other says what does this teach me. Same failure. Two completely different next moves, and those next moves are your whole life.'
      ]
    },
    fromTheBook: 'You can look at it as an inadequacy, or an opportunity, and that is the entire shift.',
    exercise: {
      name: 'Your Two Minds',
      source: 'Chapter 5',
      intro: 'This one is all yours. About fifteen minutes, and the only way it works is if you answer honestly instead of the way you wish the answers were.',
      steps: [
        { label: '1. Name your growing mind', prompt: 'One area of your life where you are already fully growth-minded. Where you expect to get better with practice and a mistake does not shake you. This is your proof that you already own the growing mind. It is not missing. It is just being kept in one room.' },
        { label: '2. Name your stuck mind', prompt: 'One area where you go fixed. Where one bad attempt makes you want to walk away for good, or where you catch yourself saying "that is just not me." Be specific, and pick one that actually matters to you.' },
        { label: '3. Write the sentence', prompt: 'The exact fixed sentence you tell yourself about that area, in its real voice. "I am not a ___ person." "I could never ___." Get it out of the fog and onto the page.' },
        { label: '4. Add the word', prompt: 'Rewrite that sentence with "yet" on the end, then finish this line: "...yet, and the one next thing I could do to start changing that is ______." Name the step, however small. A search, a question, a first attempt, one lesson.' },
        { label: '5. Catch one window this week', prompt: 'For the next seven days, watch for a single three-second moment where something goes wrong in your stuck area. When it comes, ask the growing mind\'s question: what does this teach me, and what do I adjust? Record what happened here.' }
      ]
    },
    summary: [
      'You already own a growing mind. It is just locked in one room. Go find the room where you go stiff.',
      'Honesty leaves the door open. The stuck mind locks it and hands you the key like it did you a favor.',
      'The shift lives in the three seconds after something goes wrong. Choose the second voice on purpose.'
    ],
    bridge: 'You have the switch now, and you found it in your own life instead of reading about it in mine. Chapter 6 stops talking about the mind and starts building. It is the exact system I used to rebuild my own thinking, six weeks at a time.'
  },

  {
    id: 6,
    title: 'Six Weeks Deep',
    subtitle: 'Understanding is not change',
    chapterRef: 'Chapter 6',
    duration: '25 min',
    welcome: 'By now you can see the belief, question it, reframe it, and you know which mind you want driving. That is real progress. But I have to be honest with you, because it is the exact spot where people like us get stuck. None of it counts yet. Understanding is not change. Insight feels like movement, but it is not. It is just the map. This chapter is about actually driving.',
    coreTeaching: {
      headline: 'Stop Waiting to Feel Like It',
      points: [
        'Motivation is a liar. It arrives loud at the start and vanishes the second the work turns boring or hard, which it always does. It is predicated on emotion, and emotion is the most unreliable thing you own. Anything you build on a feeling is built on sand.',
        'The people who change are not more motivated than you. They stopped negotiating with their own feelings. Decide the action once, in advance, while you are clear. You do not have to want to. You just have to go.',
        'Discipline is built in a specific order. Small daily actions become habits. Habits, repeated, harden into discipline. Discipline, held long enough, becomes your character. Who you are is simply what you have practiced being.',
        'Six Weeks Deep: pick one subject, study only that subject, stay on it for six weeks before you move to anything else. I picked subjects by asking one question: where am I still not the man I say I am? Finances. Time. Leadership. Conflict.',
        'You will hit the wall mid-block, when the new subject stops being exciting. That is where most people switch and end up shallow in ten subjects instead of dangerous in one. Boring usually means the surface material ran out and the real learning started. Finish the block.',
        'When a block ends, the next subject chooses itself. Finances exposed my time. Time exposed my leadership. One subject hands you the next one, and the system feeds itself.',
        'Convert the hours you are already living. I never found time to study. I converted time I was already spending. No music in the car, only audiobooks. One converted hour a day is three hundred sixty-five hours a year, nine full work weeks of education, without adding a minute to your schedule.',
        'The ground rules: make the daily version small (five minutes, not thirty). Hook it onto something you already do. Set the room so the right thing is easy. Decide the move before the moment. Keep score where you can see it. And live by one rule above all: never miss twice.'
      ]
    },
    fromTheBook: 'Real change has never come from one heroic decision made on a big emotional day. It comes from small moves, repeated long past the day the old voice fully expected you to quit.',
    exercise: {
      name: 'Build Your One Move',
      source: 'Chapter 6',
      intro: 'Do not try to change everything. That is the stuck mind\'s favorite trap, because a plan that big is a plan you can quit. You are going to build one small system, for one change, right now. Fifteen minutes.',
      steps: [
        { label: '1. Pick one change', prompt: 'Just one. Take the area you found in Chapter 5 and name a single change you want to make in it. Not five. One.' },
        { label: '2. Shrink it', prompt: 'Write the two-minute version of that change, the piece so small you honestly cannot talk yourself out of it. If it still feels big, cut it in half again.' },
        { label: '3. Anchor it', prompt: 'Fill in this exact sentence: "After I ______ (something I already do every day), I will ______ (my two-minute action)." That existing habit is now your reminder.' },
        { label: '4. Set the room', prompt: 'Name one thing you will add to make the action easier to start, and one thing you will remove to make quitting harder. Then actually go set them up.' },
        { label: '5. Pick your mark', prompt: 'Decide how you will track it. A calendar on the wall, a note, an X in a box. Choose where you will physically see it every single day.' },
        { label: '6. Sign the rule', prompt: 'Write this in your own words and mean it: "I will not be perfect. I will never miss twice."' }
      ]
    },
    summary: [
      'Motivation is a liar. Decide the action in advance and take the mood out of it.',
      'One subject, six weeks, straight into the gap between who you are and who you say you are.',
      'Small, anchored, tracked, and never miss twice. That is the whole system.'
    ],
    bridge: 'Start it tomorrow, small and boring and repeatable, and let it run. You are going to move now, which means at some point you are also going to get knocked down. Chapter 7 is about exactly that.'
  },

  {
    id: 7,
    title: 'Building Resilience and Overcoming Setbacks',
    subtitle: 'Resilience is return speed',
    chapterRef: 'Chapter 7',
    duration: '24 min',
    welcome: 'Most of my early businesses failed. The one that hit hardest was my detail shop, my first real company, with a real employee named Bob who talked like there was nothing we could not do. Then I lost my biggest account to a lowest-bidder race I could not win, and everything went. I loaded what my life savings had turned into back into my car and unloaded it into the first apartment that was ever mine. And I sat there waiting for Kailey to get home, embarrassed, because we had not just lost what I worked for. We had lost what she worked for. That is the moment this chapter is about. Not the failure. The story I started telling myself about what the failure meant.',
    coreTeaching: {
      headline: 'The Setback Is Not the Problem',
      points: [
        'You are going to get knocked down. That is not a risk. It is a promise. The question was never whether life would hit you. It is what happens inside you when it does.',
        'The setback itself is almost never what takes people out. It is the meaning they wrap around it. Two people lose the same job on the same Tuesday. One spirals, one adjusts, and the only difference was the sentence they told themselves in the first hour.',
        'Resilience is return speed. Not whether you fall, because everyone falls, but how long you stay down. That is the one number you actually control, and every rep makes it stronger.',
        'Feel it, then move. Return speed does not mean you feel nothing. A setback is supposed to hurt. Give it a place and a limit, a day, a weekend, whatever the hit calls for. Then, when the window closes, you get up.',
        'Separate the setback from the story. The event says I failed. The story says I am a failure. That leap from what happened to who I am is where a setback turns into a limiting belief in real time. Pull them apart before they fuse.',
        'Treat every setback as tuition. It already charged you time, money, pride. Ask two questions: what did this cost me, and what did it teach me? The only real waste is paying the tuition and skipping the class.',
        'You were never meant to carry it alone. When you are flat on your back, the story in your head is at its loudest and its least honest. Say it out loud to someone you trust. Half the time you can already hear it is not as true as it felt.',
        'Build your comeback before you need it. Decide now, while you are calm, your first small move after a fall. When the comeback is a routine instead of a decision made from the floor, the fall loses most of its power.',
        'You grow through it. Tedeschi and Calhoun called it post-traumatic growth. Not that the hard thing was good. That the same event carries something in it you cannot get any other way, if you walk through it instead of around it.'
      ]
    },
    fromTheBook: 'Everything I have that is worth anything, I built on the far side of a setback that I was certain, at the time, would be the end of me. It was not. It never is.',
    exercise: {
      name: 'Your Comeback Plan',
      source: 'Chapter 7',
      intro: 'This exercise does two things at once. It processes a setback you are already carrying, and it builds the plan you will use for the next one. Fifteen honest minutes.',
      steps: [
        { label: '1. Name a real setback', prompt: 'Pick one, recent or still stinging. Write only the event itself, the plain facts, in one sentence. No meaning attached to it yet. Just what happened.' },
        { label: '2. Write the story you attached', prompt: 'Now write what you made that event mean about you. Be honest. This is the verdict you have quietly been carrying around ever since.' },
        { label: '3. Split them apart', prompt: 'Write it in this exact form: "What happened is ______. What I made it mean is ______." Read the second half back and decide, on purpose, whether it is actually true, or just the old machine doing what it always does.' },
        { label: '4. Collect the tuition', prompt: 'Answer both: "This cost me ______. What it taught me is ______." Keep that second answer somewhere you will see it, because you paid for it.' },
        { label: '5. Pre-decide your first move', prompt: 'Write the one small action you will take within twenty-four hours of any future fall, chosen now while you are clear. This is your comeback rule. When the next setback comes, you will not have to think your way out. You will already know the first step.' }
      ]
    },
    summary: [
      'Measure return speed, not whether you fall. Getting up is the muscle.',
      'What happened is one thing. What you made it mean is another. Keep the fact, drop the verdict.',
      'Pre-decide your first move so the comeback is a routine, not a decision made from the floor.'
    ],
    bridge: 'Get good at this, and setbacks stop being the thing that ends your story and start being the thing that quietly forges it. Everything so far was defense, clearing what was in the way. Chapter 8 is where we go on offense.'
  },

  {
    id: 8,
    title: 'Embracing Empowering Beliefs',
    subtitle: 'Now we go on offense',
    chapterRef: 'Chapter 8',
    duration: '22 min',
    welcome: 'Stop for a second. If you have been reading like a spectator, nodding along, collecting good ideas to use someday, I need you to feel me right here. Someday is the lie from Chapter 4. We spent seven chapters clearing ground. That was defense. Necessary, but defense. When you tear out a limiting belief, it leaves a hole, and if you do not fill it on purpose, the old belief grows right back into it. This chapter is about what you plant in that hole.',
    coreTeaching: {
      headline: 'Installing the Reasons You Can',
      points: [
        'An empowering belief is not standing in the mirror telling yourself you are a millionaire while your account is empty. That is pretending, and some part of you knows it, which is why it never sticks.',
        'A real empowering belief is a truth you have decided to finally give the same weight the limiting one has been getting for free. You already have evidence for it. You have been trained to throw it in the trash. Fire the bad accountant from Chapter 3 and hire one who counts what is real.',
        'You do not get to choose whether you live by beliefs. You already do. The only question is whether you chose the story you are running or inherited it and never checked.',
        'Aim it at who you are, not what you get. "I will make a lot of money" lives in the future and cracks when reality is slow. "I am someone who follows through" depends only on you. Build the identity and the outcomes show up as a byproduct.',
        'How to install one: choose the sentence, present tense, "I am the kind of person who ______." Back it with three real pieces of evidence. Feed it every day. Act like it is already true.',
        'You vote your way into it. Every time you do the thing the empowered version of you would do, you cast a vote for that person. One vote is nothing. A thousand votes is an identity.',
        'The belief comes before the proof. People say show me the evidence and then I will believe, while life says believe it and then you will build the evidence. Somebody has to move first, and it cannot be the proof.',
        'It will feel fake at first. Good. That is not a sign you are lying. Fake is just what new feels like before it becomes normal. Refuse to mistake fake for false.'
      ]
    },
    fromTheBook: 'I was handed a story that said I would be nothing. If I had kept living by that story, I would have been right.',
    exercise: {
      name: 'Write Your New Sentence',
      source: 'Chapter 8',
      intro: 'This is the most important exercise in the book, so do not skim it. You are going to install one empowering belief, start to finish, right now. Ten minutes.',
      steps: [
        { label: '1. Name the old belief', prompt: 'Write the limiting belief you are replacing. The one you have been carrying since Chapter 1. Get it on the page one more time, so you know exactly what you are evicting.' },
        { label: '2. Write your new sentence', prompt: 'The belief you are choosing to run instead, as one clear present-tense sentence. "I am the kind of person who ______." Make it something that would actually change how you move if you believed it all the way.' },
        { label: '3. Stack three pieces of evidence', prompt: 'Three real things from your life that already support the new sentence, even slightly. This is your case. When the old voice says it is not true, this is the proof you point to.' },
        { label: '4. Choose your daily vote', prompt: 'One specific action a person who fully believed this would take every day. This is your empowering belief plugged straight into the system you built in Chapter 6.' },
        { label: '5. Put it where you will see it', prompt: 'Where will you write the new sentence so you look at it every day? Your mirror, your phone, your desk. Name the place, then go put it there. You are going to read it until it stops sounding like a hope and starts sounding like a fact.' }
      ]
    },
    summary: [
      'An empowering belief is a truth you finally give equal weight, backed by evidence you already have.',
      'Aim it at who you are, not what you get. Identity produces outcomes. Outcomes never produce identity.',
      'The belief goes first. You vote your way into it, one action at a time, while it still feels fake.'
    ],
    bridge: 'You have your new belief and the first bricks of a case for it. But a belief does not grow in a vacuum. Most people try to grow a new self inside an environment built for the old one. Chapter 9 fixes that.'
  },

  {
    id: 9,
    title: 'Creating a Supportive Environment',
    subtitle: 'A new belief is a seed. Your environment is the soil.',
    chapterRef: 'Chapter 9',
    duration: '24 min',
    welcome: 'For most of my climb I never felt like I had the true support of the people around me. Nobody told me to quit. It was quieter than that. I would share what I was building and watch the interest drain out of the room. Polite nods. Changed subjects. What carried me through was not a crowd. It was one person. When we lost the shop, with the wreckage in a pile in our living room, Kailey looked at me and said: You built it once. You can build it again. She did not need to understand every detail of the plan. She believed in the person holding it.',
    coreTeaching: {
      headline: 'You Become the Room You Are In',
      points: [
        'You are not as self-made as you think. You rise or sink to the level of the room you are in, and it is closer to gravity than willpower. You are not going to out-willpower your surroundings for long. Change the surroundings instead.',
        'The people are the environment. The people closest to you set what feels normal. If everyone around you plays small, reaching feels like showing off. If everyone reaches, reaching feels like a Tuesday.',
        'Not everyone gets a front-row seat. As you grow, some relationships will not survive it, and usually not out of malice. Your climbing makes them feel their own standing still. You do not have to cut anyone off. Adjust the proximity, not the affection. Protecting your growth is not cruelty. It is maintenance.',
        'The loneliest stretch of the climb is not the loud doubter. It is the silence. Quiet indifference gives you nothing to push against. It just keeps shrinking the dream until settling feels like sense.',
        'Support is not a headcount. One real person in your corner can outweigh a room full of indifference. If you have that person, protect the relationship like it is load-bearing, because it is.',
        'Go find your rooms. One mentor who has walked it. One friend who expects more from you than you expect from yourself. One community where your goal is the baseline instead of the fantasy. You do not wait until you belong to walk in. You walk in, and belonging catches up.',
        'Design what you feed your mind. What you scroll and listen to is environment. It is soil. You would never let a person stand beside you six hours a day whispering that you are behind. Then you hand that job to a feed and call it relaxing.',
        'When you cannot change the room, change the ratio. Add voices that pull you up until the balance tips. Build a portable environment: a book in your bag, a voice in your headphones, one person you text who holds you to your word.'
      ]
    },
    fromTheBook: 'You can love someone deeply and still limit their access to your momentum.',
    exercise: {
      name: 'Audit Your Environment',
      source: 'Chapter 9',
      intro: 'This one asks for real honesty, because your environment is easy to defend and hard to look at straight. Twenty minutes, and be willing to write down things you would rather not admit.',
      steps: [
        { label: '1. List your five', prompt: 'The five people you spend the most time with. Next to each name, mark one thing: does being around them raise your standard, or lower it? Be honest even where it stings, especially where it stings.' },
        { label: '2. One back, one closer', prompt: 'Name one relationship you are going to move a few rows back, proximity and not affection, and one you are going to get more of. Write the actual change you will make, not just the intention.' },
        { label: '3. Find one room', prompt: 'One room you will get into. A community, a mentor, a space where your goal is normal instead of remarkable. Then write the one step you will take this week to walk into it.' },
        { label: '4. Audit your inputs', prompt: 'One input you will cut because it reliably leaves you feeling smaller, and one you will add because it feeds who you are becoming. Then go actually do both today.' },
        { label: '5. Build your portable environment', prompt: 'One thing you will carry with you no matter where you are. A book, a daily audio, or one accountability person you text. Set it up before you close this module.' }
      ]
    },
    summary: [
      'The room is stronger than your motivation. Change the room, or change the ratio.',
      'Adjust proximity, not affection. Some people belong in your life but not in your ear while you are building.',
      'Support is not a headcount. One person who still sees you when the evidence is on the floor is enough.'
    ],
    bridge: 'Get the soil right, and growth stops being a thing you have to force every day and starts becoming a thing that happens almost on its own. The final chapter is about how to keep all of this going. Not as a burst that fades in a month, but as a way of living.'
  },

  {
    id: 10,
    title: 'The Journey of Continuous Growth',
    subtitle: 'There is no finish line',
    chapterRef: 'Chapter 10',
    duration: '22 min',
    welcome: 'We are at the end of the book, and I have to be honest with you. There is no end to the thing this book is actually about. You were probably hoping I would hand you a finish line. Do these ten things, arrive somewhere better, be done. I am not going to do that, because it would be a lie, and you have had more than enough of those. There is no finish line. There is only who you are becoming, for the rest of your life. This last chapter is about making peace with that, and then falling in love with it.',
    coreTeaching: {
      headline: 'One Percent Better',
      points: [
        'Most people chase a place called there. The moment they arrive, there is gone, and a taller mountain shows up behind it. That is not a flaw in the design. It is the design. The goal was never the goal. The goal was who you had to become to reach it.',
        'What success actually is: not titles, income, or someone else\'s approval. It is alignment. Waking up and operating in a way that matches who you actually are and what you value. Redefining success, realigning purpose, releasing potential. That is the scoreboard.',
        'On that scoreboard the game is one question: did I move one percent closer to the person I am actually trying to become? That is a game you can win every single day.',
        'One percent is nothing on any given day. That is exactly why it works. Too small to intimidate, too small to wake the stuck mind, too small to talk yourself out of. But repeated, it compounds into a version of you that you could not have imagined from where you stand.',
        'The math is a picture, not a promise. One percent better every day for a year is roughly thirty-seven times better. One percent worse declines to almost nothing. Small things, repeated, do not add up. They multiply.',
        'The plateau is part of the climb. Long stretches where you do everything right and nothing seems to happen. That is not growth stopping. It is growth consolidating underneath the surface. The plateau asks one question: will you keep going when it stops applauding you?',
        'Growth has seasons. Push, rest, harvest. A field that is never allowed to rest stops producing. Rest is not the opposite of growth. It is part of it.',
        'Fall in love with the process. An outcome is a moment. The process is your actual life. The person who falls in love with the process never runs out of fuel and never runs out of mountain.',
        'You are not going back. You cannot un-see a limiting belief once you have learned to catch it. A slip is not a reset. Motivation buys you a good week. Identity builds you a life.'
      ]
    },
    fromTheBook: 'You did not come all this way to have a good week.',
    exercise: {
      name: 'Your One Percent',
      source: 'Chapter 10',
      intro: 'This is the exercise you keep after the book is closed. It is not a one-time thing. It is a way of running the rest of your life. Set it up now, and then actually use it.',
      steps: [
        { label: '1. Kill the finish line', prompt: 'Write down the "there" you have quietly been waiting to arrive at before you let yourself feel okay. Then cross it out, and underneath it write: "There is no finish line. I am becoming someone who grows."' },
        { label: '2. Name your one percent', prompt: 'The one small thing you can do to be one percent better tomorrow, in the area that matters most to you right now. Small enough that you honestly cannot fail it. That is the size that lasts.' },
        { label: '3. Set your review rhythm', prompt: 'Pick a recurring day, once a week or once a month, when you will stop and ask two questions: am I one percent better than last time, and what is the next small climb? Write the day here. Growth you never check on quietly drifts.' },
        { label: '4. Write your grower\'s line', prompt: 'Copy this down and make it yours: "I am someone who grows. A setback is not a reset. I keep going." Read it on the days you slip.' },
        { label: '5. Pre-decide the plateau', prompt: 'Write your rule for the flat stretch now, before you are standing in it: "When it feels like nothing is working, I keep going anyway, because the plateau is where it consolidates."' }
      ]
    },
    summary: [
      'There is no finish line. There is only the next one percent, and that is good news.',
      'Success is alignment: operating in a way that matches who you are and what you value.',
      'The plateau is consolidation, not failure. Keep going when it stops applauding you.'
    ],
    bridge: 'The kid they said would never finish anything finished this. Now it is your turn. Every exercise you just did is collected in the book\'s Appendix, The Toolkit. Go back to it long after the reading is done, because the reading was never the point. The reps are.'
  }
];

const LAST_ID = MODULES[MODULES.length - 1].id;
const CHAPTER_COUNT = MODULES.filter((m) => m.id > 0).length;

const STORAGE_KEY = 'icant-course-v1';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  completed: {},
  answers: {},
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    state.completed = s.completed || {};
    state.answers   = s.answers   || {};
  } catch {}
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      completed: state.completed,
      answers:   state.answers,
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

// Strip under the module title: where this module sits in the book and which
// exercise it carries. Replaces the framework bar the old course had.
function chapterStripHtml(mod) {
  const pos = mod.id > 0 ? `Chapter ${mod.id} of ${CHAPTER_COUNT}` : 'Before Chapter 1';
  return `
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;padding:12px 0;border-bottom:1px solid #1A1A1A;margin-bottom:24px;">
      <span style="font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:1px;color:#E60306;">${esc(pos)}</span>
      <span style="font-size:11px;letter-spacing:2px;color:#AAAAAA;font-weight:600;text-transform:uppercase;">Exercise · ${esc(mod.exercise.name)}</span>
    </div>`;
}

function sidebarFooterHtml() {
  return `
    <div style="font-size:9px;letter-spacing:2px;color:#444;font-weight:600;margin-bottom:8px;">THE COMPANION BOOK</div>
    <div style="font-size:12px;color:#CCCCCC;font-style:italic;line-height:1.4;">${esc(BOOK_TITLE)}</div>
    <div style="font-size:11px;color:#666;margin-top:4px;line-height:1.5;">One module per chapter. Every Workbook is the book's own exercise.</div>
    <a href="${BOOK_URL}" target="_blank" rel="noopener"
      style="display:inline-block;margin-top:8px;font-size:11px;color:#E60306;text-decoration:none;font-weight:600;">Get the book →</a>`;
}

function lessonTabHtml(mod) {
  const points = mod.coreTeaching.points.map((p, i) => `
    <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;background:#111;border:1px solid #1E1E1E;border-radius:8px;">
      <div style="min-width:24px;height:24px;border-radius:50%;background:#E60306;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;">${i + 1}</div>
      <p style="color:#D0D0D0;line-height:1.6;font-size:13px;margin:0;">${esc(p)}</p>
    </div>`).join('');

  return `
    <div style="display:flex;flex-direction:column;gap:28px;">
      <div style="background:linear-gradient(135deg,#1A0000 0%,#110000 100%);border:1px solid #330000;border-radius:12px;padding:20px;border-left:3px solid #E60306;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:10px;">FROM ANTHONY · ${esc(mod.chapterRef.toUpperCase())}</div>
        <p style="color:#E0E0E0;line-height:1.7;font-size:14px;margin:0;">${esc(mod.welcome)}</p>
      </div>
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:12px;">CORE TEACHING</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:16px;letter-spacing:0.5px;">${esc(mod.coreTeaching.headline)}</h2>
        <div style="display:flex;flex-direction:column;gap:12px;">${points}</div>
      </div>
      <div style="background:#0D0D0D;border:1px solid #2A2A2A;border-radius:12px;padding:20px 24px;">
        <div style="font-size:10px;letter-spacing:2px;color:#AAAAAA;font-weight:600;margin-bottom:10px;">FROM THE BOOK</div>
        <p style="color:#fff;line-height:1.6;font-size:16px;margin:0;font-style:italic;">&ldquo;${esc(mod.fromTheBook)}&rdquo;</p>
      </div>
      ${mod.id === 0 ? `
      <div style="background:#0A0000;border:1px solid #330000;border-radius:12px;padding:20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:6px;">THE COMPANION BOOK</div>
          <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px;font-style:italic;">${esc(BOOK_TITLE)}</div>
          <div style="font-size:12px;color:#AAAAAA;line-height:1.5;">This course follows the book chapter for chapter. Read each chapter first, then do its module. If you do not have the book yet, get it before Chapter 1.</div>
        </div>
        <a href="${BOOK_URL}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:8px;padding:12px 20px;
            background:#E60306;color:#fff;border-radius:8px;font-size:13px;font-weight:600;
            letter-spacing:0.5px;white-space:nowrap;text-decoration:none;flex-shrink:0;
            transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          Get the Book →
        </a>
      </div>` : ''}
    </div>`;
}

function workbookTabHtml(mod) {
  const ex = mod.exercise;
  const prefix = `m${mod.id}`;
  const steps = ex.steps.map((step, i) => {
    const key = `${prefix}_${i}`;
    const val = esc(state.answers[key] || '');
    return `
      <div style="background:#111;border:1px solid #222;border-radius:12px;padding:18px 20px;">
        <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:6px;">${esc(step.label)}</div>
        <p style="color:#AAAAAA;line-height:1.6;font-size:13px;margin:0 0 12px;">${esc(step.prompt)}</p>
        <textarea class="icant-textarea" data-key="${esc(key)}"
          placeholder="Write it here..."
          style="width:100%;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;
            color:#fff;padding:10px 12px;font-size:13px;line-height:1.5;
            font-family:inherit;resize:vertical;min-height:80px;
            box-sizing:border-box;">${val}</textarea>
      </div>`;
  }).join('');

  return `
    <div>
      <div style="margin-bottom:20px;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:8px;">EXERCISE · ${esc(ex.source.toUpperCase())}</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:26px;color:#fff;margin-bottom:10px;letter-spacing:0.5px;">${esc(ex.name)}</h2>
        <p style="color:#CCC;line-height:1.6;font-size:14px;margin:0 0 6px;">${esc(ex.intro)}</p>
        <p style="color:#666;font-size:12px;margin:0;">Your answers are saved on this device. Be honest. No one else sees this.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;">${steps}</div>
    </div>`;
}

function summaryTabHtml(mod) {
  const isCompleted = !!state.completed[mod.id];
  const items = mod.summary.map((item, i) => `
    <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;background:#111;border:1px solid #1E1E1E;border-radius:8px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:#E60306;line-height:1;flex-shrink:0;width:20px;">${i + 1}</div>
      <p style="color:#D0D0D0;line-height:1.6;font-size:13px;margin:0;">${esc(item)}</p>
    </div>`).join('');

  const completeBanner = isCompleted
    ? `<div style="background:#001A00;border:1px solid #00AA00;border-radius:10px;padding:14px 20px;color:#00AA00;font-size:13px;font-weight:600;text-align:center;">✓ Module Complete — Keep Moving</div>`
    : '';

  return `
    <div style="display:flex;flex-direction:column;gap:24px;">
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:14px;">3 KEY TAKEAWAYS</div>
        <div style="display:flex;flex-direction:column;gap:10px;">${items}</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A0000 0%,#1A0000 100%);border:1px solid #E60306;border-radius:12px;padding:20px;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:10px;">WHAT'S NEXT</div>
        <p style="color:#E0E0E0;line-height:1.7;font-size:13px;margin:0;">${esc(mod.bridge)}</p>
      </div>
      ${completeBanner}
      ${mod.id === LAST_ID && isCompleted ? `
      <div style="background:#0A0A00;border:1px solid #555500;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:10px;letter-spacing:2px;color:#CCCC00;font-weight:600;margin-bottom:10px;">ONE LAST THING</div>
        <p style="color:#E0E0D0;line-height:1.7;font-size:14px;margin-bottom:16px;">You finished the course. That puts you in a very small group. If this work moved you, help someone else find the book. An honest Amazon review takes two minutes and can change someone's trajectory.</p>
        <a href="${BOOK_URL}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:8px;padding:13px 24px;
            background:#E60306;color:#fff;border-radius:8px;font-size:14px;font-weight:600;
            letter-spacing:0.5px;text-decoration:none;transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          ★ Leave an Amazon Review →
        </a>
        <div style="margin-top:12px;">
          <a href="/bundle.html"
            style="font-size:12px;color:#AAAAAA;text-decoration:underline;text-underline-offset:3px;">
            Know someone who needs this? Share the bundle →
          </a>
        </div>
      </div>` : ''}
    </div>`;
}

// ── Public mount ──────────────────────────────────────────────────────────────

const byId = (id) => MODULES.find((m) => m.id === id);

let _loaded = false;

export async function mount({ startAt, certificateHref = null } = {}) {
  if (!_loaded) {
    loadState();
    _loaded = true;
  }

  mountCoursePlayer({
    brand: 'THE ONE PERCENT NATION',
    courseTitle: "I CAN'T: THE COURSE",
    modules: MODULES.map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: m.subtitle,
      eyebrow: m.chapterRef,
      duration: m.duration,
      meta: `${m.duration} · ${m.exercise.name}`
    })),
    moduleHeaderHtml: (m) => chapterStripHtml(byId(m.id)),
    sidebarFooterHtml,
    tabs: [
      { id: 'lesson',   label: 'Lesson',   html: (m) => lessonTabHtml(byId(m.id)) },
      {
        id: 'workbook', label: 'Workbook', html: (m) => workbookTabHtml(byId(m.id)),
        bind: (root) => {
          root.querySelectorAll('.icant-textarea').forEach((ta) => {
            ta.addEventListener('input', () => {
              state.answers[ta.dataset.key] = ta.value;
              persistState();
            });
          });
        }
      },
      { id: 'summary',  label: 'Summary',  html: (m) => summaryTabHtml(byId(m.id)) }
    ],
    progress: {
      isComplete: (id) => !!state.completed[id],
      markComplete: async (id) => {
        state.completed[id] = true;
        persistState();
      }
    },
    certificateHref,
    startAt: typeof startAt === 'number' ? startAt : undefined
  });
}
