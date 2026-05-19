// I Can't: The Course — vanilla JS course workspace
// Mounted via courses-registry.js when ?course=icant&module=N is active.

const ALIGN = {
  A: { label: 'Awareness',  desc: 'Seeing the belief clearly' },
  L: { label: 'Leadership', desc: 'Taking ownership of your story' },
  I: { label: 'Identity',   desc: 'Rewriting who you believe you are' },
  G: { label: 'Growth',     desc: 'Choosing expansion over comfort' },
  N: { label: 'Navigation', desc: 'Executing the path forward' },
};

const MODULES = [
  {
    id: 1,
    title: 'Understanding Limiting Beliefs',
    subtitle: 'Name the invisible chains',
    alignKey: 'A',
    chapterRef: 'Chapter 1',
    duration: '18 min',
    welcome: 'Before you can break free from anything, you have to see it. This module is your flashlight. Most people never examine their beliefs — they just live inside them. We\'re going to change that today.',
    coreTeaching: {
      headline: 'What a Limiting Belief Actually Is',
      points: [
        'A limiting belief is not a personality trait — it\'s a conclusion you drew from an experience, then never questioned again.',
        'These beliefs operate beneath your awareness, quietly steering your decisions, your relationships, and your ceiling.',
        'They feel like facts. They are not. They are learned narratives — and anything learned can be unlearned.',
        'Common forms: \'I\'m not smart enough,\' \'I don\'t deserve success,\' \'I\'m too old to start over,\' \'This is just who I am.\'',
        'The danger isn\'t the belief itself. It\'s the silence around it. The unchallenged belief runs your life.',
      ],
    },
    alignIntegration: {
      key: 'A',
      teaching: 'Awareness is where every transformation starts. You cannot navigate out of a cage you refuse to acknowledge. In the A.L.I.G.N. framework, Awareness means calling the belief by its name — not judging it, not excusing it. Just seeing it. Most people live on autopilot. Awareness breaks the automation.',
    },
    workbook: {
      reflection: 'Think about one area of your life where you consistently feel stuck, small, or like you\'re playing it safe. What is the story you tell yourself about that area?',
      action: 'Write down 3 beliefs you hold about yourself that begin with \'I can\'t,\' \'I\'m not,\' or \'I never.\' Don\'t filter. Just surface them.',
      prompts: [
        'The area where I feel most stuck is...',
        'The story I tell myself about that area is...',
        'My 3 \'I can\'t / I\'m not / I never\' beliefs:',
      ],
    },
    summary: [
      'Limiting beliefs are learned narratives, not permanent truths.',
      'They operate beneath awareness, silently shaping behavior.',
      'Naming a belief is the first act of breaking its power.',
    ],
    bridge: 'Now that you can see the belief, the next question is: where did it come from? Chapter 2 takes us inside the neuroscience — and what the brain actually does when a belief takes root.',
  },
  {
    id: 2,
    title: 'The Neuroscience of Belief',
    subtitle: 'Your brain is wired to keep you safe — not free',
    alignKey: 'A',
    chapterRef: 'Chapter 2',
    duration: '22 min',
    welcome: 'Understanding your brain isn\'t a science lecture — it\'s strategy. When you know how beliefs get formed and hardwired, you stop feeling broken and start feeling equipped. This module gives you the blueprint.',
    coreTeaching: {
      headline: 'How Your Brain Locks In a Belief',
      points: [
        'Your prefrontal cortex (PFC) processes logic and decisions. Your amygdala processes fear and emotion. When they clash, the amygdala usually wins first.',
        'Every time you act on a belief — true or false — your brain reinforces that neural pathway. The more you repeat it, the more automatic it becomes.',
        'This is neuroplasticity working against you. But neuroplasticity works both ways: every new thought you choose and repeat builds a new pathway.',
        'Emotionally charged experiences create the strongest beliefs. That\'s why something a parent said once when you were 8 can still run your behavior at 38.',
        'The brain isn\'t trying to harm you. It\'s trying to protect you from repeating pain. Your job is to teach it a new definition of safety.',
      ],
    },
    alignIntegration: {
      key: 'A',
      teaching: 'Awareness at the neurological level means understanding that your reactions to challenges aren\'t random — they\'re patterned. The A.L.I.G.N. framework starts with Awareness because real transformation requires you to see not just what you believe, but why your brain has been protecting that belief so fiercely. When you understand the why, you stop fighting yourself and start redirecting yourself.',
    },
    workbook: {
      reflection: 'Trace one of your limiting beliefs back to its origin. What experience — real or perceived — planted that seed? How old were you? Who was involved?',
      action: 'Identify one emotional memory that has been reinforcing a belief about your limitations. Write out what actually happened versus what you concluded from it.',
      prompts: [
        'The limiting belief I\'m tracing is...',
        'The original experience I can trace it to is...',
        'What actually happened vs. what I concluded:',
        'The new interpretation I can choose is...',
      ],
    },
    summary: [
      'Beliefs are neural pathways — and pathways can be rewired.',
      'Emotionally intense experiences form the strongest (and most limiting) beliefs.',
      'Neuroplasticity is your greatest asset once you understand how to use it intentionally.',
    ],
    bridge: 'You now know how beliefs form. The next move is precision — identifying exactly which beliefs are operating in your specific life. Generic awareness doesn\'t create change. Specific awareness does.',
  },
  {
    id: 3,
    title: 'Identifying Your Limiting Beliefs',
    subtitle: 'Stop guessing. Start excavating.',
    alignKey: 'L',
    chapterRef: 'Chapter 3',
    duration: '20 min',
    welcome: 'Most people know they have limiting beliefs in the abstract. Very few can name the specific ones running their life right now. This module is a surgical excavation. We go deep, we get specific, and we call it what it is.',
    coreTeaching: {
      headline: 'The Precision Identification Process',
      points: [
        'Limiting beliefs hide inside emotions. Anxiety, avoidance, defensiveness, and self-sabotage are symptoms. The belief is the root.',
        'They also hide inside patterns. If you keep hitting the same ceiling in money, relationships, or confidence — there\'s a belief underneath it.',
        'Common categories: Worthiness (\'I don\'t deserve this\'), Capability (\'I\'m not smart/talented/experienced enough\'), Safety (\'If I succeed, I\'ll be judged/alone/overwhelmed\'), and Belonging (\'People like me don\'t do things like that\').',
        'The question to ask isn\'t \'What am I afraid of?\' It\'s \'What do I believe would happen if I actually succeeded?\'',
        'The belief that surfaces when you answer that honestly is the one running the show.',
      ],
    },
    alignIntegration: {
      key: 'L',
      teaching: 'Leadership, the L in A.L.I.G.N., begins with radical ownership. Not blaming your upbringing, not excusing your patterns — owning them. Identifying your limiting beliefs is an act of Leadership because it requires you to stop being a passive observer of your life and become an active analyst of it. Leaders don\'t run from hard truths. They use them.',
    },
    workbook: {
      reflection: 'In which area of your life are you consistently playing smaller than you know you could? What do you believe would happen if you stopped playing small there?',
      action: 'Complete the Belief Excavation: For each life category below, write the belief that you sense might be holding you back. Don\'t overthink it. Write the first honest thing that comes.',
      prompts: [
        'In my finances, I believe...',
        'In my career/purpose, I believe...',
        'In my relationships, I believe...',
        'About my own potential, I believe...',
        'The belief I\'m most afraid to look at is...',
      ],
    },
    summary: [
      'Limiting beliefs hide in patterns, emotions, and avoidance — not just thoughts.',
      'Precision identification beats generic awareness every time.',
      'Ownership of your beliefs is the beginning of Leadership over your life.',
    ],
    bridge: 'You\'ve named them. Now it\'s time to break them. The next module is where the real confrontation happens — we go head-to-head with every belief you just wrote down.',
  },
  {
    id: 4,
    title: 'Challenging and Reframing Beliefs',
    subtitle: 'The belief was never the truth. It was just the loudest voice.',
    alignKey: 'I',
    chapterRef: 'Chapter 4',
    duration: '25 min',
    welcome: 'Identifying a belief gives you something to aim at. Challenging it changes the trajectory. This module is where you stop being the person the belief defined and start becoming the person you actually are.',
    coreTeaching: {
      headline: 'The Challenge and Reframe Method',
      points: [
        'Step 1 — Interrogate it: Ask \'Is this belief 100% objectively true, or is it an interpretation?\' Most beliefs collapse under honest examination.',
        'Step 2 — Find the counter-evidence: You\'ve been collecting evidence FOR the belief. Now deliberately collect evidence AGAINST it. Your brain will resist this. Do it anyway.',
        'Step 3 — Identify the cost: What has this belief cost you? Be specific. Opportunities declined, relationships damaged, goals abandoned. Make the cost real.',
        'Step 4 — Reframe deliberately: Don\'t just reject the old belief. Replace it with a specific, believable new one. Not toxic positivity — earned truth.',
        'Step 5 — Test the new belief in low-stakes situations first. Let evidence build. The brain needs proof before it fully adopts the reframe.',
      ],
    },
    alignIntegration: {
      key: 'I',
      teaching: 'Identity — the I in A.L.I.G.N. — is where the real transformation lives. Challenging a belief isn\'t just changing a thought. It\'s declaring that who you are is no longer defined by what you were taught to believe. When you reframe a belief, you are issuing a new identity statement. You\'re saying: \'This is not who I am anymore.\' That declaration, backed by consistent action, is how identity shifts.',
    },
    workbook: {
      reflection: 'Take the most powerful limiting belief you identified in Module 3. Walk it through all five challenge steps above. Be brutally honest with yourself.',
      action: 'Write your Reframe Declaration: a single clear sentence that replaces your top limiting belief. Make it specific, present tense, and earned — not a wish, a direction.',
      prompts: [
        'The belief I\'m challenging is...',
        'The evidence AGAINST this belief is...',
        'The real cost this belief has had on my life is...',
        'My Reframe Declaration (present tense, specific, earned):',
        'One low-stakes situation where I can test this new belief this week:',
      ],
    },
    summary: [
      'Every limiting belief is an interpretation, not a fact — and interpretations can change.',
      'Counter-evidence is a skill. You have to practice collecting it.',
      'The reframe is an identity declaration, not just a new thought.',
    ],
    bridge: 'You\'ve challenged the belief and declared a new identity. Now we have to do the harder thing: make it stick. Module 5 is about the mindset infrastructure that makes the reframe permanent.',
  },
  {
    id: 5,
    title: 'The Power of Mindset Shifts',
    subtitle: 'A changed belief without a changed mindset is a temporary fix.',
    alignKey: 'I',
    chapterRef: 'Chapter 5',
    duration: '20 min',
    welcome: 'Mindset isn\'t motivation. It\'s the operating system underneath your motivation. This module upgrades the OS — so the new beliefs you\'ve planted have soil worth growing in.',
    coreTeaching: {
      headline: 'The Shift from Fixed to Growth: What It Actually Requires',
      points: [
        'A fixed mindset treats your abilities as a ceiling. A growth mindset treats them as a floor. The difference isn\'t optimism — it\'s your relationship with difficulty.',
        'Mindset shifts happen through three mechanisms: new information that challenges old assumptions, new experiences that create new evidence, and new environments that surround you with different standards.',
        'You don\'t \'decide\' to have a growth mindset. You build it through repeated choices to engage with difficulty instead of avoiding it.',
        'The biggest mindset trap is selective growth — willing to grow in areas that feel safe, but rigid in the areas that actually matter most.',
        'Real mindset work is uncomfortable. If your growth feels easy, you\'re probably not growing — you\'re just rearranging your comfort zone.',
      ],
    },
    alignIntegration: {
      key: 'I',
      teaching: 'Identity work and mindset work are the same work. The I in A.L.I.G.N. isn\'t a one-time declaration. It\'s a daily practice of choosing who you are becoming over who you\'ve been. Mindset is the daily practice. Identity is the destination. You need both. Without the mindset infrastructure, the reframes from the last module fade. With it, they compound.',
    },
    workbook: {
      reflection: 'Where do you have a growth mindset already? Where is your mindset still fixed? Be honest about the gap — specifically in the areas that matter most to your goals.',
      action: 'Identify one area where your mindset has been fixed and design a 7-day \'difficulty engagement\' plan — small daily actions that specifically require you to grow in that area.',
      prompts: [
        'Areas where my mindset is genuinely growth-oriented:',
        'Areas where my mindset is still fixed (the ones I\'ve been avoiding admitting):',
        'The fixed mindset area I\'m committing to shift:',
        'My 7-day difficulty engagement plan (Day 1–7):',
      ],
    },
    summary: [
      'Mindset is built through repeated engagement with difficulty, not decisions alone.',
      'Selective growth is the enemy — go after the areas that actually scare you.',
      'Identity and mindset work together: one declares, the other delivers.',
    ],
    bridge: 'The mindset is shifting. Now we need to talk about action — because beliefs without strategy remain inspiration. Module 6 is where we build the execution engine.',
  },
  {
    id: 6,
    title: 'Actionable Strategies for Change',
    subtitle: 'Transformation without execution is just journaling.',
    alignKey: 'G',
    chapterRef: 'Chapter 6',
    duration: '22 min',
    welcome: 'This is the module most people skip to first — and then wonder why nothing changes. You needed everything before this for the strategies to actually work. Now they will. Let\'s build your system.',
    coreTeaching: {
      headline: 'The Execution Framework for Belief-Level Change',
      points: [
        'Change doesn\'t happen in moments of inspiration. It happens in systems that function on low-motivation days.',
        'Strategy 1 — Environment Design: Your environment is a constant message to your subconscious. Redesign it to reinforce your new identity, not your old one.',
        'Strategy 2 — Identity-Based Habits: Don\'t build habits around outcomes. Build them around who you\'re becoming. Ask \'What would this new version of me do today?\'',
        'Strategy 3 — Compression Cycles: Change accelerates through compressed action — periods of intentional, focused growth with clear deadlines and defined outcomes.',
        'Strategy 4 — The Accountability Structure: You need witnesses. Not to perform for — to accelerate for. Find people whose standards challenge yours.',
        'Strategy 5 — The Review Protocol: Weekly review of where beliefs showed up in your decisions. Not judgment. Pattern recognition.',
      ],
    },
    alignIntegration: {
      key: 'G',
      teaching: 'Growth, the G in A.L.I.G.N., is where belief becomes behavior. This is where you stop studying the cage and start walking through the door. Growth isn\'t passive — it requires design. The strategies in this module aren\'t add-ons to your life. They are the infrastructure of a life that no longer operates under limiting beliefs. Without structure, the best intentions collapse under pressure. With it, growth becomes the default.',
    },
    workbook: {
      reflection: 'Look at the last 90 days. Where have your actions aligned with your new beliefs? Where have you defaulted back to old patterns? What was the trigger?',
      action: 'Design your 30-Day Change Protocol using the 5 strategies above. Be specific: What will you do, when, and how will you know it\'s working?',
      prompts: [
        'My environment currently sends me this message about who I am:',
        'The environment signal I want to create instead:',
        'My identity-based daily habit (who am I becoming, what does that person do daily):',
        'My 30-day compression cycle focus area:',
        'My accountability structure (person + how we check in):',
        'My weekly review ritual:',
      ],
    },
    summary: [
      'Systems outlast motivation — build for your low-energy days, not your peak ones.',
      'Identity-based habits accelerate change faster than outcome-based ones.',
      'Accountability isn\'t weakness. It\'s a strategic asset.',
    ],
    bridge: 'You have the strategy. But strategy without resilience breaks the moment adversity shows up. Module 7 is about building the mental muscle that keeps you executing when things get hard.',
  },
  {
    id: 7,
    title: 'Building Resilience and Overcoming Setbacks',
    subtitle: 'The setback is part of the strategy — not a sign it\'s failing.',
    alignKey: 'G',
    chapterRef: 'Chapter 7',
    duration: '18 min',
    welcome: 'Resilience isn\'t bounce-back. It\'s forward movement through adversity. This module reframes every setback you\'ve faced and equips you for every one that\'s coming.',
    coreTeaching: {
      headline: 'Resilience Is a Practice, Not a Personality Trait',
      points: [
        'Resilient people are not immune to pain. They process it faster and extract the lesson before the emotion finishes its narrative.',
        'The difference between setback and failure is the meaning you assign. One is feedback. The other is identity. Choose carefully.',
        'Resilience is built in four ways: strong clarity of purpose (you remember why when things get hard), flexible thinking (you find new paths), emotional processing (you don\'t suppress or drown), and community (you don\'t white-knuckle it alone).',
        'Your brain\'s negativity bias means it records failures 3–5x more strongly than wins. Counter this deliberately — review your evidence of resilience regularly.',
        'You have survived 100% of your hardest days so far. That is data.',
      ],
    },
    alignIntegration: {
      key: 'G',
      teaching: 'Growth requires friction. Not all friction is failure. In the A.L.I.G.N. framework, Growth means developing the capacity to keep moving not despite setbacks but because of what setbacks reveal. The G isn\'t just about forward momentum — it\'s about building the kind of depth that doesn\'t break under pressure. Resilience is what keeps your new beliefs intact when your circumstances try to confirm your old ones.',
    },
    workbook: {
      reflection: 'Think of a recent setback. How did your limiting beliefs show up in how you interpreted it? What would the resilient, growth-oriented version of you say about that same situation?',
      action: 'Write your Resilience Evidence Record — 5 moments from your life where you overcame something you didn\'t think you could. These are your proof of concept.',
      prompts: [
        'The setback I\'m reinterpreting is...',
        'My old (limiting belief) interpretation was...',
        'My growth-oriented interpretation is...',
        'My 5 Resilience Evidence moments:',
        'The purpose that pulls me forward when things get hard is...',
      ],
    },
    summary: [
      'Resilience is a practice built through clarity, flexibility, processing, and community.',
      'Setbacks are feedback — failure is a meaning, not an event.',
      'You already have more resilience evidence than you\'ve been giving yourself credit for.',
    ],
    bridge: 'You\'ve built the foundation. You\'ve done the hard internal work. Module 8 is where we move from removing what held you back to installing what carries you forward — empowering beliefs as your new operating system.',
  },
  {
    id: 8,
    title: 'Embracing Empowering Beliefs',
    subtitle: 'This is not the end of the journey. This is who you\'ve become.',
    alignKey: 'N',
    chapterRef: 'Chapters 8, 9 & 10',
    duration: '25 min',
    welcome: 'Every module brought you here. Empowering beliefs aren\'t given — they\'re built. Through awareness, through challenge, through action, through resilience. You\'ve done that work. Now we integrate it.',
    coreTeaching: {
      headline: 'Empowering Beliefs: What They Are and How to Live From Them',
      points: [
        'An empowering belief is not positive self-talk layered over unresolved doubt. It is a conclusion reached through evidence, action, and honest self-examination.',
        'Characteristics of empowering beliefs: They expand your perception of what\'s possible. They fuel action rather than replace it. They survive failure without collapsing. They align with your actual values.',
        'A supportive environment isn\'t a luxury — it\'s architecture. The people around you, your physical spaces, and your daily inputs either reinforce or erode empowering beliefs constantly.',
        'Continuous growth isn\'t about perfection. It\'s about trajectory. The question isn\'t \'Am I there yet?\' It\'s \'Am I still moving toward who I\'m becoming?\'',
        'The person who finishes this course is not the same person who started it. That gap — between who you were and who you\'re choosing to be — is the One Percent shift.',
      ],
    },
    alignIntegration: {
      key: 'N',
      teaching: 'Navigation — the N in A.L.I.G.N. — is the final mile. It\'s not a destination. It\'s an orientation. You now have Awareness of your beliefs, Leadership over your narrative, a new Identity declared and practiced, Growth structures in place, and Resilience to sustain it. Navigation means moving forward with all of that — not waiting until it\'s perfect, not stalling for more confidence. Moving. With what you have. Toward who you\'re becoming. That is the One Percent life.',
    },
    workbook: {
      reflection: 'Compare who you were when you started Module 1 to who you are now. What beliefs have you released? What beliefs have you installed? What\'s different about how you see your own potential?',
      action: 'Write your One Percent Declaration — a personal statement of the empowering beliefs you now choose to live from. This is your operating system. Return to it weekly.',
      prompts: [
        'The limiting beliefs I have released through this course:',
        'The empowering beliefs I now hold about myself:',
        'The environment I\'m committed to building to reinforce these beliefs:',
        'My One Percent Declaration (the beliefs I will live from, in your own words):',
        'My first action this week that demonstrates I\'m living from my new beliefs:',
      ],
    },
    summary: [
      'Empowering beliefs are earned through action and evidence — not given through affirmation.',
      'Your environment and your community are constant inputs into your belief system. Design them with intention.',
      'Navigation means moving forward now — with the person you\'ve become through this work.',
    ],
    bridge: 'This is not the end. This is your new starting line. The One Percent Nation community is your next environment. Bring what you\'ve built here — and build further.',
  },
];

const STORAGE_KEY = 'icant-course-v1';

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  activeModule: 1,
  completed: {},
  answers: {},
  sidebarOpen: true,
  tab: 'lesson',
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

function progressBarHtml(current, total) {
  const pct = Math.round((current / total) * 100);
  return `
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="flex:1;height:3px;background:#2A2A2A;border-radius:2px;">
        <div style="height:100%;width:${pct}%;background:#E60306;border-radius:2px;transition:width 0.4s ease;"></div>
      </div>
      <span style="font-size:12px;color:#AAAAAA;white-space:nowrap;">${current}/${total} modules</span>
    </div>`;
}

function alignBadgeHtml(letter) {
  const item = ALIGN[letter];
  return `
    <div style="display:inline-flex;align-items:center;gap:8px;background:#1A0000;border:1px solid #E60306;border-radius:6px;padding:6px 12px;">
      <span style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#E60306;line-height:1;">${esc(letter)}</span>
      <div>
        <div style="font-size:11px;font-weight:600;color:#fff;letter-spacing:1px;">${esc(item.label.toUpperCase())}</div>
        <div style="font-size:10px;color:#AAAAAA;">${esc(item.desc)}</div>
      </div>
    </div>`;
}

function alignBarHtml(activeKey) {
  return `
    <div style="display:flex;gap:4px;padding:12px 0;border-bottom:1px solid #1A1A1A;margin-bottom:24px;">
      ${Object.entries(ALIGN).map(([key]) => `
        <div style="flex:1;text-align:center;padding:8px 4px;border-radius:6px;
          background:${activeKey === key ? '#1A0000' : 'transparent'};
          border:1px solid ${activeKey === key ? '#E60306' : '#2A2A2A'};
          transition:all 0.2s;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:20px;color:${activeKey === key ? '#E60306' : '#444'};">${esc(key)}</div>
        </div>`).join('')}
    </div>`;
}

function sidebarHtml() {
  const completedCount = Object.keys(state.completed).length;
  const items = MODULES.map((mod) => {
    const isActive = mod.id === state.activeModule;
    const isDone   = !!state.completed[mod.id];
    return `
      <button class="icant-mod-btn" data-mod="${mod.id}"
        style="width:100%;background:${isActive ? '#1A0000' : 'none'};border:none;
          border-left:3px solid ${isActive ? '#E60306' : 'transparent'};
          cursor:pointer;padding:12px 16px;text-align:left;transition:all 0.15s;
          font-family:'DM Sans',sans-serif;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:28px;height:28px;border-radius:50%;flex-shrink:0;
            display:flex;align-items:center;justify-content:center;
            background:${isDone ? '#00AA00' : isActive ? '#E60306' : '#2A2A2A'};
            font-size:11px;font-weight:700;
            color:${isDone || isActive ? '#fff' : '#AAAAAA'};
            transition:all 0.2s;">
            ${isDone ? '✓' : mod.id}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:600;
              color:${isActive ? '#fff' : isDone ? '#888' : '#666'};
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(mod.title)}</div>
            <div style="font-size:10px;color:#444;margin-top:2px;">${esc(mod.duration)} · ${esc(ALIGN[mod.alignKey].label)}</div>
          </div>
        </div>
      </button>`;
  }).join('');

  const alignLegend = Object.entries(ALIGN).map(([key]) => `
    <div style="flex:1;text-align:center;font-family:'Bebas Neue',sans-serif;font-size:16px;color:#E60306;">${esc(key)}</div>
  `).join('');
  const alignLabels = Object.entries(ALIGN).map(([, val]) => `
    <div style="flex:1;text-align:center;font-size:7px;color:#444;overflow:hidden;">${esc(val.label)}</div>
  `).join('');

  return `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <div style="padding:20px 20px 16px;border-bottom:1px solid #1A1A1A;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:3px;color:#E60306;margin-bottom:2px;">THE ONE PERCENT NATION</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:19px;color:#fff;line-height:1.1;margin-bottom:12px;">I CAN'T: THE COURSE</div>
        ${progressBarHtml(completedCount, MODULES.length)}
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 0;">
        ${items}
      </div>
      <div style="padding:14px 16px;border-top:1px solid #1A1A1A;background:#080808;">
        <div style="font-size:9px;letter-spacing:2px;color:#444;font-weight:600;margin-bottom:8px;">A.L.I.G.N. FRAMEWORK</div>
        <div style="display:flex;gap:0;">${alignLegend}</div>
        <div style="display:flex;gap:0;margin-top:2px;">${alignLabels}</div>
      </div>
    </div>`;
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
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:10px;">WELCOME TO THIS MODULE</div>
        <p style="color:#E0E0E0;line-height:1.7;font-size:14px;margin:0;">${esc(mod.welcome)}</p>
      </div>
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:12px;">CORE TEACHING</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:16px;letter-spacing:0.5px;">${esc(mod.coreTeaching.headline)}</h2>
        <div style="display:flex;flex-direction:column;gap:12px;">${points}</div>
      </div>
      <div style="background:#0D0D0D;border:1px solid #2A2A2A;border-radius:12px;padding:20px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
          ${alignBadgeHtml(mod.alignKey)}
          <div style="font-size:10px;letter-spacing:2px;color:#AAAAAA;font-weight:600;">A.L.I.G.N. FRAMEWORK APPLICATION</div>
        </div>
        <p style="color:#C0C0C0;line-height:1.7;font-size:13px;margin:0;">${esc(mod.alignIntegration.teaching)}</p>
      </div>
      ${mod.id === 1 ? `
      <div style="background:#0A0000;border:1px solid #330000;border-radius:12px;padding:20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:6px;">THE COMPANION BOOK</div>
          <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px;font-style:italic;">I Can't: Is Not A Strategy</div>
          <div style="font-size:12px;color:#AAAAAA;line-height:1.5;">This course is the companion to Anthony Brown's book. Reading them together accelerates everything — the book gives you the map, the course gives you the journey.</div>
        </div>
        <a href="https://a.co/d/0fSUaomu" target="_blank" rel="noopener"
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
  const prefix = `m${mod.id}`;
  const prompts = mod.workbook.prompts.map((prompt, i) => {
    const key = `${prefix}_${i}`;
    const val = esc(state.answers[key] || '');
    return `
      <div>
        <label style="display:block;font-size:12px;color:#AAAAAA;margin-bottom:6px;font-style:italic;">${esc(prompt)}</label>
        <textarea class="icant-textarea" data-key="${esc(key)}"
          placeholder="Write your answer here..."
          style="width:100%;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;
            color:#fff;padding:10px 12px;font-size:13px;line-height:1.5;
            font-family:'DM Sans',sans-serif;resize:vertical;min-height:80px;
            box-sizing:border-box;">${val}</textarea>
      </div>`;
  }).join('');

  return `
    <div>
      <div style="margin-bottom:20px;">
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:6px;letter-spacing:0.5px;">YOUR WORKBOOK</h2>
        <p style="color:#AAAAAA;font-size:13px;margin:0;">Your answers are saved locally. Be honest — no one else sees this.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:8px;">REFLECTION PROMPT</div>
          <p style="color:#CCC;line-height:1.6;font-size:14px;margin:0;">${esc(mod.workbook.reflection)}</p>
        </div>
        <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:8px;">ACTION PROMPT</div>
          <p style="color:#CCC;line-height:1.6;font-size:14px;margin-bottom:20px;">${esc(mod.workbook.action)}</p>
          <div style="display:flex;flex-direction:column;gap:14px;">${prompts}</div>
        </div>
      </div>
    </div>`;
}

function summaryTabHtml(mod) {
  const isCompleted = !!state.completed[mod.id];
  const items = mod.summary.map((item, i) => `
    <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;background:#111;border:1px solid #1E1E1E;border-radius:8px;">
      <div style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:#E60306;line-height:1;flex-shrink:0;width:20px;">${i + 1}</div>
      <p style="color:#D0D0D0;line-height:1.6;font-size:13px;margin:0;">${esc(item)}</p>
    </div>`).join('');

  const completeBtn = isCompleted
    ? `<div style="background:#001A00;border:1px solid #00AA00;border-radius:10px;padding:14px 20px;color:#00AA00;font-size:13px;font-weight:600;text-align:center;">✓ Module Complete — Keep Moving</div>`
    : `<button class="icant-complete-btn" style="background:#E60306;border:none;border-radius:10px;padding:16px 24px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:1px;transition:all 0.2s;font-family:'DM Sans',sans-serif;">MARK MODULE COMPLETE →</button>`;

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
      ${completeBtn}
      ${mod.id === 8 && isCompleted ? `
      <div style="background:#0A0A00;border:1px solid #555500;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:10px;letter-spacing:2px;color:#CCCC00;font-weight:600;margin-bottom:10px;">ONE LAST THING</div>
        <p style="color:#E0E0D0;line-height:1.7;font-size:14px;margin-bottom:16px;">You finished the course. That puts you in a very small group. If this work moved you, help someone else find the book — an honest Amazon review takes 2 minutes and can change someone's trajectory.</p>
        <a href="https://a.co/d/0fSUaomu" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:8px;padding:13px 24px;
            background:#E60306;color:#fff;border-radius:8px;font-size:14px;font-weight:600;
            letter-spacing:0.5px;text-decoration:none;transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          ★ Leave an Amazon Review →
        </a>
        <div style="margin-top:12px;">
          <a href="/bundle.html"
            style="font-size:12px;color:#AAAAAA;text-decoration:underline;text-underline-offset:3px;">
            Know someone who needs this? Share the bundle deal →
          </a>
        </div>
      </div>` : ''}
    </div>`;
}

function moduleViewHtml(mod) {
  const tab = state.tab;
  const isCompleted = !!state.completed[mod.id];
  const tabs = [
    { id: 'lesson',   label: 'Lesson'   },
    { id: 'workbook', label: 'Workbook' },
    { id: 'summary',  label: 'Summary'  },
  ];

  const tabBtns = tabs.map((t) => `
    <button class="icant-tab-btn" data-tab="${t.id}"
      style="background:none;border:none;cursor:pointer;padding:10px 20px;
        font-size:13px;font-weight:500;
        color:${tab === t.id ? '#fff' : '#AAAAAA'};
        border-bottom:2px solid ${tab === t.id ? '#E60306' : 'transparent'};
        transition:all 0.2s;font-family:'DM Sans',sans-serif;">${esc(t.label)}</button>`).join('');

  let content = '';
  if (tab === 'lesson')   content = lessonTabHtml(mod);
  if (tab === 'workbook') content = workbookTabHtml(mod);
  if (tab === 'summary')  content = summaryTabHtml(mod);

  const completedBadge = isCompleted
    ? `<div style="background:#001A00;border:1px solid #00AA00;border-radius:20px;padding:4px 12px;font-size:11px;color:#00AA00;font-weight:600;">✓ COMPLETE</div>`
    : '';

  return `
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
      <div style="padding:24px 28px 0;border-bottom:1px solid #1A1A1A;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
          <div>
            <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:6px;">MODULE ${mod.id} · ${esc(mod.chapterRef.toUpperCase())} · ${esc(mod.duration.toUpperCase())}</div>
            <h1 style="font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:1px;color:#fff;line-height:1;margin:0;">${esc(mod.title)}</h1>
            <p style="color:#AAAAAA;font-size:13px;margin-top:4px;">${esc(mod.subtitle)}</p>
          </div>
          ${completedBadge}
        </div>
        ${alignBarHtml(mod.alignKey)}
        <div style="display:flex;gap:0;">${tabBtns}</div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:24px 28px;" id="icant-tab-content">
        ${content}
      </div>
    </div>`;
}

function fullHtml() {
  const completedCount = Object.keys(state.completed).length;
  const mod = MODULES.find((m) => m.id === state.activeModule);

  return `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600&display=swap');
      #workspace-icant *{box-sizing:border-box;}
      #workspace-icant textarea:focus{outline:none;border-color:#E60306!important;}
      #workspace-icant .icant-mod-btn:hover{background:#150000!important;}
      #workspace-icant .icant-tab-btn:hover{color:#fff!important;}
      #workspace-icant .icant-complete-btn:hover{opacity:0.85;}
      #icant-sidebar::-webkit-scrollbar{width:4px;}
      #icant-sidebar::-webkit-scrollbar-thumb{background:#E60306;border-radius:2px;}
      #icant-tab-content::-webkit-scrollbar{width:4px;}
      #icant-tab-content::-webkit-scrollbar-thumb{background:#E60306;border-radius:2px;}
    </style>
    <div style="display:flex;height:100%;background:#0A0A0A;overflow:hidden;font-family:'DM Sans',sans-serif;">

      <!-- Sidebar -->
      <div id="icant-sidebar" style="
        width:${state.sidebarOpen ? '280px' : '0'};
        min-width:${state.sidebarOpen ? '280px' : '0'};
        background:#0D0D0D;border-right:1px solid #1A1A1A;
        display:flex;flex-direction:column;overflow:hidden;transition:all 0.3s ease;">
        ${sidebarHtml()}
      </div>

      <!-- Main -->
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;overflow:hidden;">

        <!-- Topbar -->
        <div style="height:48px;border-bottom:1px solid #1A1A1A;display:flex;align-items:center;padding:0 20px;gap:12px;background:#0A0A0A;">
          <button id="icant-toggle" style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;color:#fff;width:32px;height:32px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">≡</button>
          <div style="flex:1;"></div>
          <div style="font-size:11px;color:#AAAAAA;">${completedCount}/${MODULES.length} complete</div>
          <div style="width:80px;height:4px;background:#1A1A1A;border-radius:2px;">
            <div style="width:${Math.round((completedCount / MODULES.length) * 100)}%;height:100%;background:#E60306;border-radius:2px;transition:width 0.4s ease;"></div>
          </div>
        </div>

        <!-- Module view -->
        ${mod ? moduleViewHtml(mod) : ''}
      </div>
    </div>`;
}

// ── Render + bind ─────────────────────────────────────────────────────────────

function render() {
  const container = document.getElementById('workspace-icant');
  if (!container) return;
  container.innerHTML = fullHtml();
  bindEvents(container);
}

function bindEvents(container) {
  // Sidebar module buttons
  container.querySelectorAll('.icant-mod-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeModule = Number(btn.dataset.mod);
      state.tab = 'lesson';
      render();
    });
  });

  // Tab buttons
  container.querySelectorAll('.icant-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      render();
    });
  });

  // Sidebar toggle
  const toggle = container.querySelector('#icant-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      state.sidebarOpen = !state.sidebarOpen;
      render();
    });
  }

  // Mark complete
  const completeBtn = container.querySelector('.icant-complete-btn');
  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      state.completed[state.activeModule] = true;
      persistState();
      if (state.activeModule < MODULES.length) {
        setTimeout(() => {
          state.activeModule += 1;
          state.tab = 'lesson';
          render();
        }, 400);
      } else {
        render();
      }
    });
  }

  // Workbook textareas — live save
  container.querySelectorAll('.icant-textarea').forEach((ta) => {
    ta.addEventListener('input', () => {
      state.answers[ta.dataset.key] = ta.value;
      persistState();
    });
  });
}

// ── Public mount ──────────────────────────────────────────────────────────────

let _mounted = false;

export async function mount({ startAt } = {}) {
  // Show our section, hide the standard 1P-CLC workspace panels.
  ['workspace-welcome', 'workspace-roadmap', 'workspace-live-content', 'workspace-coming-soon']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  const section = document.getElementById('workspace-icant');
  if (section) section.hidden = false;

  if (!_mounted) {
    loadState();
    _mounted = true;
  }

  if (typeof startAt === 'number' && startAt >= 1 && startAt <= MODULES.length) {
    state.activeModule = startAt;
  }

  render();
}
