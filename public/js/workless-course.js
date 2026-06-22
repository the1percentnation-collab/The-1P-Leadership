// Work Less, Gain More — vanilla JS course workspace
// Built from Anthony Brown's book "How to Work Less and Gain More: The Time
// Blocking Blueprint for Predictable Success."
// Mounted via courses-registry.js when ?course=work-less&module=N is active.

// The B.L.O.C.K. Method — the course's organizing framework.
const BLOCK = {
  B: { label: 'Budget',   desc: 'Treat time like money' },
  L: { label: 'Lock',     desc: 'Protect what matters' },
  O: { label: 'Organize', desc: 'Build the plan' },
  C: { label: 'Curate',   desc: 'Cut what drains you' },
  K: { label: 'Keep',     desc: 'Sustain the system' },
};

export const MODULES = [
  {
    id: 1,
    title: 'Structure Beats Motivation',
    subtitle: 'Why willpower fails and systems win',
    blockKey: 'B',
    chapterRef: 'Phase 1',
    duration: '10 min',
    stat: '91% vs 39%',
    welcome: 'Motivation feels powerful, but it is neurologically unstable. This module replaces the thing that fails you on hard days with the thing that works regardless of how you feel.',
    coreTeaching: {
      headline: 'Structure Outperforms Motivation — Every Time',
      points: [
        'Motivation is an emotion. It rises and falls with sleep, stress, and mood. Building results on it is like building on sand.',
        'In a British Journal of Health Psychology study, 91% of people who scheduled specific actions followed through — versus 39% who only intended to. The difference was not desire. It was structure.',
        'Time blocking pre-decides your day, so your energy goes to executing instead of deciding. High performers are not more motivated — they are more intentional.',
      ],
    },
    workbook: {
      action: 'Pick one goal you keep "meaning to" work on. Give it a specific day and time block this week — turn the intention into an appointment.',
      prompts: [
        'The goal I keep postponing is...',
        'The exact day and time I am assigning it is...',
        'What usually pulls me off it, and how I will prevent that:',
      ],
    },
    summary: [
      'Motivation is unreliable; structure is repeatable.',
      'Scheduling an action more than doubles follow-through.',
      'Decide once, then execute — protect your willpower.',
    ],
    bridge: 'Phase 2 — why those small scheduled actions, repeated, compound into results most people never see coming.',
  },
  {
    id: 2,
    title: 'Daily Activities Compound',
    subtitle: 'Success is process-based, not event-based',
    blockKey: 'B',
    chapterRef: 'Phase 2',
    duration: '9 min',
    stat: '250+ hrs / yr',
    welcome: 'Most people are waiting for a breakthrough. The people who actually get ahead did the small thing, every day, until the results became impossible to ignore.',
    coreTeaching: {
      headline: 'Small Blocks, Compounded, Beat Big Bursts',
      points: [
        'Success is process-based, not event-based. The winners did the boring, unsexy thing daily for months and years — and it works every time.',
        'One protected hour a day is over 250 hours a year — six full work weeks aimed at what matters most.',
        'Habits take about 66 days to form, not 21. Most people quit before the compounding shows. The problem is rarely the strategy — it is the timeline.',
      ],
    },
    workbook: {
      action: 'Choose one high-value daily action (one prospecting call, 30 minutes of skill practice). Commit to doing it every workday for the next two weeks.',
      prompts: [
        'My one daily high-value action is...',
        'When in the day it will happen...',
        'What 250 hours of this per year could produce for me:',
      ],
    },
    summary: [
      'Results compound from consistent daily inputs.',
      'One protected hour equals 250+ hours a year.',
      'Trust the 66-day timeline — do not quit early.',
    ],
    bridge: 'Before we build, Phase 3 — the hidden cost of the distraction and drift quietly draining your day.',
  },
  {
    id: 3,
    title: 'The Cost of Distraction',
    subtitle: 'Drift feels busy but produces little',
    blockKey: 'L',
    chapterRef: 'Phase 3',
    duration: '10 min',
    stat: '23 min to refocus',
    welcome: 'Distraction is not harmless. It is expensive — and most of the cost is invisible. What feels like a busy day often produces very little meaningful output.',
    coreTeaching: {
      headline: 'What Distraction Actually Costs You',
      points: [
        'It takes about 23 minutes to fully refocus after an interruption. Five interruptions can quietly erase nearly two hours of real output.',
        'Multitasking drops productivity by up to 40%. The brain does not multitask — it task-switches, and every switch costs you.',
        'Unplanned time defaults to urgency over importance. Loud and urgent wins; important and quiet loses — unless you protect it first.',
      ],
    },
    workbook: {
      action: 'Track your interruptions for one workday. Note each one and what triggered it — you cannot eliminate what you cannot see.',
      prompts: [
        'My most frequent interruption is...',
        'Roughly how many times it happened in a day...',
        'The one interruption I will eliminate first:',
      ],
    },
    summary: [
      'Refocusing after a distraction costs ~23 minutes.',
      'Multitasking is task-switching — it costs up to 40%.',
      'Unprotected time defaults to urgent, not important.',
    ],
    bridge: 'Phase 4 — how the hours you protect quietly build the person you are becoming.',
  },
  {
    id: 4,
    title: 'Identity Is Built in Scheduled Hours',
    subtitle: 'You become who you repeatedly behave as',
    blockKey: 'L',
    chapterRef: 'Phase 4',
    duration: '10 min',
    stat: '2–4 hrs deep work',
    welcome: 'There is a version of you that you are trying to become. That version is not waiting for the right opportunity — it is built one kept commitment at a time.',
    coreTeaching: {
      headline: 'You Become Who You Repeatedly Behave As',
      points: [
        'Every kept commitment strengthens self-trust; every broken one weakens it. Self-efficacy is built through repeated action, not affirmation.',
        'People with high self-efficacy are about 3x more likely to persist through difficulty. Belief comes from proof that you follow through.',
        'High performers protect 2–4 hours of deep, uninterrupted work — not more hours, better ones. One focused hour beats several scattered ones.',
      ],
    },
    workbook: {
      action: 'Define the identity you are building ("I am someone who ___"), then schedule one deep-work block this week that proves it.',
      prompts: [
        'The version of me I am building is...',
        'The repeated behavior that defines that person...',
        'The deep-work block I will protect this week to prove it:',
      ],
    },
    summary: [
      'Identity is built by repeated, kept commitments.',
      'Self-efficacy comes from evidence, not motivation.',
      'Protect 2–4 deep-work hours — quality over quantity.',
    ],
    bridge: 'Phase 5 — your calendar is not just a schedule. It is a forecast of your future.',
  },
  {
    id: 5,
    title: 'Your Calendar Predicts Your Future',
    subtitle: 'What gets scheduled grows',
    blockKey: 'O',
    chapterRef: 'Phase 5',
    duration: '10 min',
    stat: '10:1 planning ROI',
    welcome: 'Open your real calendar — not the one in your head. It is a mirror of what you are actually committed to, as opposed to what you say you are committed to.',
    coreTeaching: {
      headline: 'Your Calendar Is a Forecast, Not Just a Schedule',
      points: [
        'Whatever you consistently assign time to grows; whatever stays unscheduled stays where it is. Revenue blocks predict income; learning blocks predict skill.',
        'People who write goals down and schedule the steps are about 2.5x more likely to achieve them. Writing makes it real; scheduling makes it happen.',
        'For every 10 minutes spent planning your week, you recover up to 100 minutes of wasted execution — a 10-to-1 return.',
      ],
    },
    workbook: {
      action: 'Block 15 minutes to plan next week. Put your most important work on the calendar before anything else goes on it.',
      prompts: [
        'The one thing that would make next week a success if I got it done...',
        'The revenue or high-value activity I will protect time for...',
        'What I have been putting off that keeps costing me:',
      ],
    },
    summary: [
      'What gets scheduled grows; the rest stagnates.',
      'Writing plus scheduling makes you ~2.5x more likely to follow through.',
      'Planning pays back roughly 10x in recovered time.',
    ],
    bridge: 'You see why it works. Phase 6 — let us build your first weekly time block plan.',
  },
  {
    id: 6,
    title: 'Build Your First Weekly Plan',
    subtitle: 'Fill the important blocks first',
    blockKey: 'O',
    chapterRef: 'Phase 6',
    duration: '11 min',
    stat: '15 min to plan a week',
    welcome: 'Most people quit time blocking within two weeks — not because it fails, but because they overcomplicate it. The goal is simple: protect what matters and give everything else somewhere to live.',
    coreTeaching: {
      headline: 'The Five-Step First Plan',
      points: [
        'Start with your non-negotiables, then fill the important blocks first and let everything else fit around them — not the other way around.',
        'The order: (1) deep work in your sharpest hours, (2) two communication windows, (3) admin work in your low-energy window, (4) buffer blocks for surprises.',
        'Do not leave large unblocked stretches assuming you will fill them well — you will not. Unblocked time defaults to reactive, low-value work. Start simple, adjust as you go.',
      ],
    },
    workbook: {
      action: 'Build next week\'s skeleton: one deep-work block, two communication windows, one admin block, and a daily buffer.',
      prompts: [
        'My deep-work window will be...',
        'My two communication windows are...',
        'My admin block and daily buffer:',
      ],
    },
    summary: [
      'Fill important blocks first; everything else fits around them.',
      'Order: deep work, then comms, then admin, then buffer.',
      'Start simple — progress, not perfection.',
    ],
    bridge: 'A great plan gets tested immediately. Phase 7 — how to protect your blocks when life pushes back.',
  },
  {
    id: 7,
    title: 'Protect Your Blocks',
    subtitle: 'Defend your time when life pushes back',
    blockKey: 'L',
    chapterRef: 'Phase 7',
    duration: '10 min',
    stat: '70% self-interruption',
    welcome: 'You will build a beautiful schedule, and then the world will test it. Protecting your blocks is a skill — and one of the most valuable you can develop.',
    coreTeaching: {
      headline: 'Five Tools to Defend Your Time',
      points: [
        'Use the redirect ("I am not free then, but I can do X"), kill notifications during blocks, and communicate your focus hours so people work around them.',
        '70% of workplace interruptions are self-generated. The biggest distraction is often you — so turn off your own access first.',
        'Drop the guilt and keep a recovery plan: when a block gets blown up, reschedule it like an appointment instead of abandoning the system.',
      ],
    },
    workbook: {
      action: 'Choose one protection tool and apply it to your most important block this week.',
      prompts: [
        'The block I most need to protect is...',
        'The protection tool I will use...',
        'How I will recover it if it gets disrupted:',
      ],
    },
    summary: [
      'Redirect, silence access, and communicate your hours.',
      '70% of interruptions are self-generated.',
      'Recover disrupted blocks — do not abandon the system.',
    ],
    bridge: 'Phase 8 — the most valuable, least-used real estate on your calendar: the start of your day.',
  },
  {
    id: 8,
    title: 'Front-Load Your Day',
    subtitle: 'Win the first two hours, win the day',
    blockKey: 'O',
    chapterRef: 'Phase 8',
    duration: '10 min',
    stat: 'First 2 hrs = peak',
    welcome: 'There is a quiet window at the start of every day, before everyone else\'s problems become your problems. It is the most valuable real estate on your calendar — and most people waste it.',
    coreTeaching: {
      headline: 'Win the First Two Hours, Win the Day',
      points: [
        'Your prefrontal cortex is sharpest and willpower is highest in the first 2–4 hours after waking, before decision fatigue sets in.',
        'Spend that window on email or your phone and you hand your best cognitive hours to your lowest-value tasks.',
        'Decide the night before the single most important thing for tomorrow. Do not check your phone first — do that one thing before the noise arrives.',
      ],
    },
    workbook: {
      action: 'Tonight, write down tomorrow\'s single most important task. Protect the first 60–90 minutes for it before any communication.',
      prompts: [
        'Tomorrow\'s one most important task...',
        'The time I will protect for it...',
        'What I will do to avoid the phone first thing:',
      ],
    },
    summary: [
      'Your first 2–4 hours are peak cognition — guard them.',
      'Front-load your most important work before the noise.',
      'Decide the night before; execute first thing.',
    ],
    bridge: 'Phase 9 — the skill that protects all of this: learning to say no.',
  },
  {
    id: 9,
    title: 'Learning to Say No',
    subtitle: 'Every yes is a no to something else',
    blockKey: 'C',
    chapterRef: 'Phase 9',
    duration: '9 min',
    stat: '1 hr / day given away',
    welcome: 'Every yes you give is a no to something else. That is not a motivational quote — it is math. Your no is what makes your yes powerful.',
    coreTeaching: {
      headline: 'Your No Is What Makes Your Yes Powerful',
      points: [
        'Time is fixed. Saying yes to everything means nothing is truly a priority — the important competes equally with the trivial.',
        'The average professional gives away at least an hour a day to commitments they did not need — that is 250 hours a year.',
        'Say no without burning bridges: the redirect, the honest reason, the delayed yes ("let me check and get back to you"), and publishing your blocks.',
      ],
    },
    workbook: {
      action: 'Identify one recurring commitment that does not serve your priorities. Decline or renegotiate it this week.',
      prompts: [
        'The commitment that drains me without real return is...',
        'How I will say no (which method)...',
        'What I will protect with the time I reclaim:',
      ],
    },
    summary: [
      'Every yes is a no to something else.',
      'Saying yes too easily costs ~250 hours a year.',
      'Decline gracefully with a redirect or honest reason.',
    ],
    bridge: 'Phase 10 — find the hours you did not know you were losing with a weekly audit.',
  },
  {
    id: 10,
    title: 'The Weekly Audit',
    subtitle: 'Find the hours you are losing',
    blockKey: 'C',
    chapterRef: 'Phase 10',
    duration: '9 min',
    stat: '80 / 20',
    welcome: 'You cannot fix what you cannot see. Most people sense time is getting away from them but have no idea where it is actually going. The fix is a brief, honest weekly look.',
    coreTeaching: {
      headline: 'Ten Minutes That Sharpen Every Week',
      points: [
        'This is a visibility problem, not a willpower problem. Audit your time the way a business audits its finances — briefly and honestly.',
        'About 80% of results come from 20% of activities. The audit reveals which 20% to do more of and which 80% to cut.',
        'End each week with five questions: what consumed my time, what produced results, what wasted it, was my key work protected, and what one thing will I change.',
      ],
    },
    workbook: {
      action: 'Run your first weekly audit using the five questions. Commit to one specific change for next week.',
      prompts: [
        'What actually consumed most of my time this week...',
        'What produced real results versus what wasted time...',
        'The one change I am making next week:',
      ],
    },
    summary: [
      'Visibility creates accountability.',
      '80% of results come from 20% of activities.',
      'Five questions, one change — every week.',
    ],
    bridge: 'Phase 11 — managing your energy, because not all hours are equal.',
  },
  {
    id: 11,
    title: 'Manage Your Energy',
    subtitle: 'Not all hours are equal',
    blockKey: 'C',
    chapterRef: 'Phase 11',
    duration: '10 min',
    stat: '~4 peak hrs / day',
    welcome: 'Two people can have the exact same schedule and get completely different results. The difference is not the plan. It is the energy behind it.',
    coreTeaching: {
      headline: 'Match Your Best Work to Your Best Energy',
      points: [
        'An hour exhausted is not the same as an hour rested. Most people have about 4 hours of genuine high-focus capacity a day — the rest is maintenance.',
        'Stack your most important work in your peak window; put admin and routine tasks in your natural afternoon dip.',
        'Treat sleep, breaks, movement, and food as performance inputs — one poor night can cut cognitive performance by up to 33%.',
      ],
    },
    workbook: {
      action: 'Identify your peak energy window this week, then move one high-value task into it and one low-value task out.',
      prompts: [
        'My peak energy window is roughly...',
        'The high-value work I will move into it...',
        'The low-value work I will move to my dip:',
      ],
    },
    summary: [
      'You get ~4 hours of real high-focus capacity a day — use them well.',
      'Match task difficulty to energy level.',
      'Sleep and recovery are inputs, not rewards.',
    ],
    bridge: 'Phase 12 — stop paying the switching tax. Start batching.',
  },
  {
    id: 12,
    title: 'The Power of Batching',
    subtitle: 'Stop switching, start stacking',
    blockKey: 'C',
    chapterRef: 'Phase 12',
    duration: '9 min',
    stat: '~20 min per switch',
    welcome: 'Every time you switch from one type of task to a completely different one, your brain pays a tax. Do it dozens of times a day and the productivity account is overdrawn.',
    coreTeaching: {
      headline: 'Stop Switching, Start Stacking',
      points: [
        'Switching task types forces your brain to unload and reload context — about 20 minutes lost each time. 64% of workers switch every few minutes.',
        'Group similar tasks into single blocks: email together, calls together, creative work together. Stay in one context until the block is done.',
        'Batched work is easier to defend — "that is my project time, but I have call slots Tuesday and Thursday." Specificity earns respect.',
      ],
    },
    workbook: {
      action: 'Pick one task type (email or calls) and batch it into one or two windows this week instead of all day.',
      prompts: [
        'The task I will batch is...',
        'The window or windows I will do it in...',
        'What I will protect by closing it the rest of the day:',
      ],
    },
    summary: [
      'Each context switch costs around 20 minutes.',
      'Group similar tasks into single blocks.',
      'Batching makes your schedule easier to defend.',
    ],
    bridge: 'Phase 13 — the single biggest threat to a structured day: meetings.',
  },
  {
    id: 13,
    title: 'Handle Meetings',
    subtitle: 'Without letting them run your life',
    blockKey: 'K',
    chapterRef: 'Phase 13',
    duration: '10 min',
    stat: '37% unnecessary',
    welcome: 'Meetings are the single biggest threat to a structured day — not because they are inherently bad, but because most are poorly designed, poorly timed, and poorly necessary.',
    coreTeaching: {
      headline: 'A Meeting Without an Outcome Is Just a Conversation',
      points: [
        '37% of meetings are considered unnecessary by the people attending them. Audit your recurring meetings: if you cannot name the outcome, it should not exist.',
        'Stop attending where your presence is optional, set a 30-minute default, and require a one-line agenda before anyone commits.',
        'Batch meetings into designated windows so they do not fragment your focus hours — offer people a slot instead of your best time.',
      ],
    },
    workbook: {
      action: 'Audit your recurring meetings. Decline, shorten, or consolidate at least one this week.',
      prompts: [
        'A recurring meeting with no clear outcome is...',
        'What I will do with it (decline, shorten, or consolidate)...',
        'The meeting window I will designate going forward:',
      ],
    },
    summary: [
      'If you cannot name the outcome, the meeting should not exist.',
      'Default to 30 minutes and require an agenda.',
      'Batch meetings to protect your focus hours.',
    ],
    bridge: 'Phase 14 — time blocking is not just for work. It is for your life.',
  },
  {
    id: 14,
    title: 'Time Block Your Personal Life',
    subtitle: 'Not just your work',
    blockKey: 'K',
    chapterRef: 'Phase 14',
    duration: '9 min',
    stat: '2x follow-through',
    welcome: 'Most people apply this only to work — and the moment five o\'clock hits, the system disappears. That is a mistake that quietly costs people more than they realize.',
    coreTeaching: {
      headline: 'Your Personal Life Deserves a Place on the Calendar',
      points: [
        'Relationships, health, and personal goals grow the same way professional results do — through scheduled, protected time. 76% of people drop these first when busy.',
        'People who schedule personal goals with work-level specificity are 2x more likely to follow through. The calendar does not care what kind of goal it is.',
        'Health and relationships are time-management issues. They need real, present time — not the leftover, depleted version of you.',
      ],
    },
    workbook: {
      action: 'Add three personal blocks to next week (exercise, a relationship, personal growth) with the same standing as work.',
      prompts: [
        'The personal block I keep dropping is...',
        'The three personal blocks I am scheduling next week...',
        'How I will protect them like work commitments:',
      ],
    },
    summary: [
      'Personal goals grow through scheduled time too.',
      'Scheduling them doubles your follow-through.',
      'Health and relationships are time-management issues.',
    ],
    bridge: 'The final phase — what to do when (not if) you fall off the system.',
  },
  {
    id: 15,
    title: 'When You Fall Off the System',
    subtitle: 'Never miss twice',
    blockKey: 'K',
    chapterRef: 'Phase 15',
    duration: '9 min',
    stat: 'Missing twice is a choice',
    welcome: 'You will fall off. That is not pessimism — it is the honest reality of building any system in a life that keeps moving. The failure is never the disruption. It is the response to it.',
    coreTeaching: {
      headline: 'Never Miss Twice',
      points: [
        '88% of people who abandon a habit cite a single missed day or week as the trigger. Missing once is an accident; deciding it is over is the real failure.',
        'Restart small: reclaim one block for three days in a row. Skip the guilt and the heroic catch-up plan — they both collapse by Wednesday.',
        'Consistent people are not the ones who never miss — they are the ones who never quit. One day, one block is all a restart ever requires.',
      ],
    },
    workbook: {
      action: 'Write your restart plan now, before you need it: the one block you will reclaim first when a week goes sideways.',
      prompts: [
        'When I fall off, the one block I will reclaim first is...',
        'How I will restart without guilt or a catch-up plan...',
        'The result that reminds me the system is worth returning to:',
      ],
    },
    summary: [
      'Missing once is an accident; quitting is the failure.',
      'Restart with one small block, not a heroic plan.',
      'Consistency means never quitting, not never missing.',
    ],
    bridge: 'You have built the whole system. Now there is just one decision left: stop drifting, start designing. Your future is determined by your daily design.',
  },
];

const STORAGE_KEY = 'work-less-course-v1';

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

function blockBadgeHtml(letter) {
  const item = BLOCK[letter];
  return `
    <div style="display:inline-flex;align-items:center;gap:8px;background:#1A0000;border:1px solid #E60306;border-radius:6px;padding:6px 12px;">
      <span style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#E60306;line-height:1;">${esc(letter)}</span>
      <div>
        <div style="font-size:11px;font-weight:600;color:#fff;letter-spacing:1px;">${esc(item.label.toUpperCase())}</div>
        <div style="font-size:10px;color:#AAAAAA;">${esc(item.desc)}</div>
      </div>
    </div>`;
}

function blockBarHtml(activeKey) {
  return `
    <div style="display:flex;gap:4px;padding:12px 0;border-bottom:1px solid #1A1A1A;margin-bottom:24px;">
      ${Object.entries(BLOCK).map(([key]) => `
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
      <button class="wl-mod-btn" data-mod="${mod.id}"
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
            <div style="font-size:10px;color:#444;margin-top:2px;">${esc(mod.duration)} · ${esc(BLOCK[mod.blockKey].label)}</div>
          </div>
        </div>
      </button>`;
  }).join('');

  const blockLegend = Object.entries(BLOCK).map(([key]) => `
    <div style="flex:1;text-align:center;font-family:'Bebas Neue',sans-serif;font-size:16px;color:#E60306;">${esc(key)}</div>
  `).join('');
  const blockLabels = Object.entries(BLOCK).map(([, val]) => `
    <div style="flex:1;text-align:center;font-size:7px;color:#444;overflow:hidden;">${esc(val.label)}</div>
  `).join('');

  return `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <div style="padding:20px 20px 16px;border-bottom:1px solid #1A1A1A;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:3px;color:#E60306;margin-bottom:2px;">THE ONE PERCENT NATION</div>
        <div style="font-family:'Bebas Neue',sans-serif;font-size:19px;color:#fff;line-height:1.1;margin-bottom:12px;">WORK LESS, GAIN MORE</div>
        ${progressBarHtml(completedCount, MODULES.length)}
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 0;">
        ${items}
      </div>
      <div style="padding:14px 16px;border-top:1px solid #1A1A1A;background:#080808;">
        <div style="font-size:9px;letter-spacing:2px;color:#444;font-weight:600;margin-bottom:8px;">THE B.L.O.C.K. METHOD</div>
        <div style="display:flex;gap:0;">${blockLegend}</div>
        <div style="display:flex;gap:0;margin-top:2px;">${blockLabels}</div>
      </div>
    </div>`;
}

function lessonTabHtml(mod) {
  const points = mod.coreTeaching.points.map((p, i) => `
    <div style="display:flex;gap:14px;align-items:flex-start;padding:14px 16px;background:#111;border:1px solid #1E1E1E;border-radius:8px;">
      <div style="min-width:24px;height:24px;border-radius:50%;background:#E60306;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex-shrink:0;">${i + 1}</div>
      <p style="color:#D0D0D0;line-height:1.6;font-size:13px;margin:0;">${esc(p)}</p>
    </div>`).join('');

  const statBlock = mod.stat ? `
      <div style="background:#0A0000;border:1px solid #330000;border-radius:12px;padding:16px 20px;display:flex;align-items:center;gap:16px;">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:30px;color:#E60306;line-height:1;white-space:nowrap;">${esc(mod.stat)}</div>
        <div style="font-size:11px;letter-spacing:2px;color:#AAAAAA;font-weight:600;">KEY NUMBER FROM THIS PHASE</div>
      </div>` : '';

  return `
    <div style="display:flex;flex-direction:column;gap:28px;">
      <div style="background:linear-gradient(135deg,#1A0000 0%,#110000 100%);border:1px solid #330000;border-radius:12px;padding:20px;border-left:3px solid #E60306;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:10px;">WELCOME TO THIS MODULE</div>
        <p style="color:#E0E0E0;line-height:1.7;font-size:14px;margin:0;">${esc(mod.welcome)}</p>
      </div>
      ${statBlock}
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:12px;">CORE TEACHING</div>
        <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:16px;letter-spacing:0.5px;">${esc(mod.coreTeaching.headline)}</h2>
        <div style="display:flex;flex-direction:column;gap:12px;">${points}</div>
      </div>
      <div style="background:#0D0D0D;border:1px solid #2A2A2A;border-radius:12px;padding:20px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
          ${blockBadgeHtml(mod.blockKey)}
          <div style="font-size:10px;letter-spacing:2px;color:#AAAAAA;font-weight:600;">B.L.O.C.K. METHOD STAGE</div>
        </div>
      </div>
      ${mod.id === 1 ? `
      <div style="background:#0A0000;border:1px solid #330000;border-radius:12px;padding:20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:6px;">THE COMPANION BOOK</div>
          <div style="font-size:15px;font-weight:600;color:#fff;margin-bottom:4px;font-style:italic;">How to Work Less and Gain More</div>
          <div style="font-size:12px;color:#AAAAAA;line-height:1.5;">This course is the companion to Anthony Brown's book. The book gives you the map; the course gives you the journey. Read them together to accelerate everything.</div>
        </div>
        <a href="/book-bonus.html"
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
        <textarea class="wl-textarea" data-key="${esc(key)}"
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
        <p style="color:#AAAAAA;font-size:13px;margin:0;">Your answers are saved on this device. Be honest — no one else sees this.</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div style="background:#111;border:1px solid #222;border-radius:12px;padding:20px;">
          <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:8px;">THIS WEEK'S ACTION</div>
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
    : `<button class="wl-complete-btn" style="background:#E60306;border:none;border-radius:10px;padding:16px 24px;color:#fff;font-size:14px;font-weight:600;cursor:pointer;letter-spacing:1px;transition:all 0.2s;font-family:'DM Sans',sans-serif;">MARK MODULE COMPLETE →</button>`;

  return `
    <div style="display:flex;flex-direction:column;gap:24px;">
      <div>
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:14px;">KEY TAKEAWAYS</div>
        <div style="display:flex;flex-direction:column;gap:10px;">${items}</div>
      </div>
      <div style="background:linear-gradient(135deg,#0A0000 0%,#1A0000 100%);border:1px solid #E60306;border-radius:12px;padding:20px;">
        <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:10px;">WHAT'S NEXT</div>
        <p style="color:#E0E0E0;line-height:1.7;font-size:13px;margin:0;">${esc(mod.bridge)}</p>
      </div>
      ${completeBtn}
      ${mod.id === MODULES.length && isCompleted ? `
      <div style="background:#0A0A00;border:1px solid #555500;border-radius:12px;padding:20px;text-align:center;">
        <div style="font-size:10px;letter-spacing:2px;color:#CCCC00;font-weight:600;margin-bottom:10px;">STOP DRIFTING. START DESIGNING.</div>
        <p style="color:#E0E0D0;line-height:1.7;font-size:14px;margin-bottom:16px;">You finished the course. Now do it for real: open your calendar, block your deep work before anything else lands on it, and start next week — not next month. Your future is determined by your daily design.</p>
        <a href="/book-bonus.html"
          style="display:inline-flex;align-items:center;gap:8px;padding:13px 24px;
            background:#E60306;color:#fff;border-radius:8px;font-size:14px;font-weight:600;
            letter-spacing:0.5px;text-decoration:none;transition:opacity 0.2s;"
          onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
          Get the Companion Book →
        </a>
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
    <button class="wl-tab-btn" data-tab="${t.id}"
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
        ${blockBarHtml(mod.blockKey)}
        <div style="display:flex;gap:0;">${tabBtns}</div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:24px 28px;" id="wl-tab-content">
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
      #workspace-work-less *{box-sizing:border-box;}
      #workspace-work-less textarea:focus{outline:none;border-color:#E60306!important;}
      #workspace-work-less .wl-mod-btn:hover{background:#150000!important;}
      #workspace-work-less .wl-tab-btn:hover{color:#fff!important;}
      #workspace-work-less .wl-complete-btn:hover{opacity:0.85;}
      #wl-sidebar::-webkit-scrollbar{width:4px;}
      #wl-sidebar::-webkit-scrollbar-thumb{background:#E60306;border-radius:2px;}
      #wl-tab-content::-webkit-scrollbar{width:4px;}
      #wl-tab-content::-webkit-scrollbar-thumb{background:#E60306;border-radius:2px;}
    </style>
    <div style="display:flex;height:100%;background:#0A0A0A;overflow:hidden;font-family:'DM Sans',sans-serif;">

      <!-- Sidebar -->
      <div id="wl-sidebar" style="
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
          <button id="wl-toggle" style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:6px;color:#fff;width:32px;height:32px;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;">≡</button>
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
  const container = document.getElementById('workspace-work-less');
  if (!container) return;
  container.innerHTML = fullHtml();
  bindEvents(container);
}

function bindEvents(container) {
  // Sidebar module buttons
  container.querySelectorAll('.wl-mod-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeModule = Number(btn.dataset.mod);
      state.tab = 'lesson';
      render();
    });
  });

  // Tab buttons
  container.querySelectorAll('.wl-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      render();
    });
  });

  // Sidebar toggle
  const toggle = container.querySelector('#wl-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      state.sidebarOpen = !state.sidebarOpen;
      render();
    });
  }

  // Mark complete
  const completeBtn = container.querySelector('.wl-complete-btn');
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
  container.querySelectorAll('.wl-textarea').forEach((ta) => {
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
  ['workspace-welcome', 'workspace-roadmap', 'workspace-live-content', 'workspace-coming-soon', 'workspace-icant']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  const section = document.getElementById('workspace-work-less');
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
