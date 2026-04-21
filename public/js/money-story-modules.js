// The Money Story — course content.
//
// 6 lessons:
//   0. Welcome Aboard!
//   1. Who Taught You What Money Means?
//   2. The Stories You Inherited About Worth
//   3. Your Money Shadow
//   4. The Money Shame Audit
//   5. Rewriting The Story
//
// Same data-driven block system as the other courses.
// Block types: lead, callout, list, framework, quote, divider, assignment.

import { store, getNotes } from './money-story-store.js';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function completionBanner(id, text = 'You have completed this lesson. Revisit it anytime or move forward.') {
  if (!store.isComplete(id)) return '';
  return `<div class="completion-banner"><h3>✓ Lesson Complete</h3><p>${escapeHtml(text)}</p></div>`;
}

function notesField(key, placeholder, minHeight = '120px') {
  const val = getNotes(key);
  return `<textarea class="notes-area" data-note-key="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}" style="min-height:${minHeight}">${escapeHtml(val)}</textarea>`;
}

function renderBlock(block, lessonId) {
  switch (block.type) {
    case 'lead': {
      const paragraphs = (block.body || []).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
      const title = block.title ? `<h2>${escapeHtml(block.title)}</h2>` : '';
      return `<div class="lesson-block">${title}${paragraphs}</div>`;
    }
    case 'callout':
      return `<div class="callout"><div class="callout-label">${escapeHtml(block.label || 'Key Insight')}</div><p>${escapeHtml(block.body || '')}</p></div>`;
    case 'list': {
      const title = block.title ? `<h2>${escapeHtml(block.title)}</h2>` : '';
      const items = (block.items || []).map((i) => `<li>${escapeHtml(i)}</li>`).join('');
      return `<div class="lesson-block">${title}<ul class="key-list">${items}</ul></div>`;
    }
    case 'framework': {
      const title = block.title ? `<h2>${escapeHtml(block.title)}</h2>` : '';
      const cards = (block.cards || []).map((c) => `
        <div class="framework-card">
          <div class="fc-icon">${escapeHtml(c.icon || '●')}</div>
          <div class="fc-title">${escapeHtml(c.title || '')}</div>
          <div class="fc-desc">${escapeHtml(c.desc || '')}</div>
        </div>`).join('');
      return `<div class="lesson-block">${title}<div class="framework-grid">${cards}</div></div>`;
    }
    case 'quote': {
      const attr = block.attr ? `<div class="quote-attr">— ${escapeHtml(block.attr)}</div>` : '';
      return `<div class="quote-block"><div class="quote-text">"${escapeHtml(block.text || '')}"</div>${attr}</div>`;
    }
    case 'divider':
      return '<div class="divider-line"></div>';
    case 'assignment': {
      const qs = (block.questions || []).map((q, i) => `<li data-n="${String(i + 1).padStart(2, '0')}">${escapeHtml(q)}</li>`).join('');
      const intro = block.intro ? `<p>${escapeHtml(block.intro)}</p>` : '';
      const list = qs ? `<ul class="exercise-questions">${qs}</ul>` : '';
      return `
        <div class="exercise">
          <div class="exercise-header">
            <span class="exercise-badge">Assignment</span>
            <span class="exercise-title">${escapeHtml(block.title || 'Reflection')}</span>
          </div>
          ${intro}
          ${list}
          ${notesField(block.notesKey || `ms_${lessonId}`, block.notesPlaceholder || 'Write your response here. These notes save automatically...', block.notesMinHeight || '160px')}
        </div>`;
    }
    default:
      return '';
  }
}

function renderLesson(lesson) {
  const num = String(lesson.id).padStart(2, '0');
  const blocksHtml = (lesson.blocks || []).map((b) => renderBlock(b, lesson.id)).join('');
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">MODULE ${num}</span>
        <span class="divider"></span>
        <span class="pillar-name">${escapeHtml(lesson.section || '')}</span>
      </div>
      <div class="module-title">${escapeHtml((lesson.title || '').toUpperCase())}</div>
      ${lesson.subtitle ? `<p class="module-desc">${escapeHtml(lesson.subtitle)}</p>` : ''}
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> ${escapeHtml(lesson.duration || '15 min')}</div>
        ${lesson.isAssignment ? `<div class="meta-item"><div class="meta-dot"></div> Assignment</div>` : ''}
      </div>
    </div>
    ${completionBanner(lesson.id)}
    ${blocksHtml}
  `;
}

function renderOverview(lesson) {
  const done = store.completed ? store.completed.size : 0;
  const total = LESSONS.length;
  const pct = Math.round((done / total) * 100);
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">WELCOME</span>
        <span class="divider"></span>
        <span class="pillar-name">The Money Story</span>
      </div>
      <div class="module-title">THE<br><span>MONEY</span><br>STORY</div>
      <p class="module-desc">A six-module excavation of the beliefs about money you inherited — and never agreed to. The work is to see them clearly, name them honestly, and rewrite the ones that are ceiling your life.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 6 modules</div>
        <div class="meta-item"><div class="meta-dot"></div> Self-paced</div>
        <div class="meta-item"><div class="meta-dot"></div> Deeply personal</div>
      </div>
    </div>

    <div class="overview-grid">
      <div class="stat-card">
        <div class="stat-label">Modules</div>
        <div class="stat-value red">${total}</div>
        <div class="stat-sub">Reflective · excavative</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Progress</div>
        <div class="stat-value">${pct}<span style="font-size:20px;color:var(--gray-mid)">%</span></div>
        <div class="stat-sub">${done} of ${total} complete</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Outcome</div>
        <div class="stat-value gold">1P</div>
        <div class="stat-sub">New money relationship</div>
      </div>
    </div>

    <div class="divider-line"></div>

    ${(lesson.blocks || []).map((b) => renderBlock(b, lesson.id)).join('')}
  `;
}

// ─── Lesson content ──────────────────────────────────────────────────────

export const LESSONS = [
  // ───── Welcome ─────
  {
    id: 0,
    section: 'Welcome · Course Contents',
    sectionTag: 'WEL',
    sectionColor: 'tag-all',
    title: 'Welcome Aboard!',
    subtitle: 'Read this first. It sets the posture you will need for the excavation ahead.',
    duration: '10 min',
    isOverview: true,
    blocks: [
      {
        type: 'lead',
        title: 'This is not a budgeting course',
        body: [
          'Most money courses teach you what to do with money. This one is different. This course asks a harder question: what do you believe about money — and who taught you to believe it?',
          'Your income has a ceiling. That ceiling is almost never a skill ceiling or a market ceiling. It is a belief ceiling. And beliefs about money are usually installed so early — by parents, by community, by the culture you grew up in — that you never consciously chose them. You just inherited them.'
        ]
      },
      {
        type: 'framework',
        title: 'What each module will uncover',
        cards: [
          { icon: '🏡', title: 'Module 1', desc: 'Who taught you what money means? Family of origin, the first lessons you did not know were lessons.' },
          { icon: '⚖️', title: 'Module 2', desc: 'The stories you inherited about worth — and how "self-worth" got quietly tangled with "net worth."' },
          { icon: '🕳️', title: 'Module 3', desc: 'Your Money Shadow — the defensive pattern (scarcity, hoarding, avoidance, overspending) that runs in the dark.' },
          { icon: '🔦', title: 'Module 4', desc: 'The Money Shame Audit — the specific things you refuse to look at, priced in dollars and emotion.' },
          { icon: '✍️', title: 'Module 5', desc: 'Rewriting the story — new beliefs, daily reps, and the relationship you choose from here.' }
        ]
      },
      {
        type: 'callout',
        label: 'How to use this course',
        body: 'Go slowly. Do the assignments in writing, not in your head — writing is what pulls the belief into the light where it can be examined. Expect some lessons to sting; that sting is the work showing up.'
      },
      {
        type: 'callout',
        label: 'A note on privacy',
        body: 'Every assignment is saved privately to your account. No one — not coaches, not peers, not even company admins — can read your notes. This is for you.'
      },
      {
        type: 'quote',
        text: 'You do not have a money problem. You have a money story. Change the story, and the numbers will move with it.',
        attr: 'Anthony Brown'
      }
    ]
  },

  // ───── Module 1: Who Taught You What Money Means? ─────
  {
    id: 1,
    section: 'Module 1 — Family of Origin',
    sectionTag: 'M01',
    sectionColor: 'tag-p1',
    title: 'Who Taught You What Money Means?',
    subtitle: 'You adopted your money beliefs before you were old enough to refuse them. Time to meet the people who handed them to you.',
    duration: '30 min',
    blocks: [
      {
        type: 'lead',
        title: 'The beliefs were installed before you had a vote',
        body: [
          'Long before you ever earned a dollar, you were being taught what money meant. You were taught by how your parents spoke about it — and by how they avoided speaking about it. You were taught by the tension at the kitchen table on the first of the month, and by the silence after the envelope was opened. You were taught by what got celebrated, what got hidden, and what got weaponized.',
          'Most adults are running money software that was written when they were seven years old, by people whose own money software was written at seven. Before we can rewrite anything, we have to see what was installed — and by whom.'
        ]
      },
      {
        type: 'callout',
        label: 'Core Principle',
        body: 'You did not choose your money beliefs. You inherited them. That is not your fault. But what you do with them from this moment forward — that is entirely yours.'
      },
      {
        type: 'framework',
        title: 'The four channels of installation',
        cards: [
          { icon: '👀', title: 'Watching', desc: 'What you saw adults do with money. Spending patterns, work habits, reactions to bills, attitudes toward wealthier or poorer people.' },
          { icon: '👂', title: 'Hearing', desc: 'What was said out loud — directly to you or within earshot. "Money doesn\'t grow on trees." "Rich people are greedy." "We can\'t afford that."' },
          { icon: '⚡', title: 'Tension', desc: 'The feelings in the room around money. Arguments, anxiety, relief, shame. Your body logged each one and built associations you still carry.' },
          { icon: '🕳️', title: 'Absence', desc: 'What was never said. If no one taught you about money directly, you filled the silence with your own theory. Often a fearful one.' }
        ]
      },
      {
        type: 'list',
        title: 'Common scripts that get inherited',
        items: [
          '"Money doesn\'t grow on trees." — installs scarcity as the default posture.',
          '"We\'re not those kinds of people." — installs class as destiny, wealth as for somebody else.',
          '"Rich people are greedy / corrupt / lost their soul." — installs shame on the path to your own prosperity.',
          '"You have to work yourself to death for every dollar." — installs hustle as the only acceptable relationship with money.',
          '"We don\'t talk about money." — installs secrecy, which is the soil shame grows in.',
          '"Just be grateful you have anything." — installs the belief that wanting more is ungrateful.',
          '"Money changes people." — installs fear of your own future success.',
          '"Your father was bad with money." — installs an inherited identity about who you will be with money.'
        ]
      },
      {
        type: 'framework',
        title: 'Where the inherited belief shows up now',
        cards: [
          { icon: '💸', title: 'Earning', desc: 'The ceiling you hit, the raise you did not ask for, the offer you under-priced, the pay you accept without negotiation.' },
          { icon: '🛒', title: 'Spending', desc: 'What you deny yourself and what you compulsively allow. What you cannot spend on yourself without guilt. What you overspend on to soothe.' },
          { icon: '🔐', title: 'Saving + investing', desc: 'Whether you can hold money or whether it seems to "leak" out. Whether you trust yourself — or the future — enough to plant.' },
          { icon: '🗣️', title: 'Talking', desc: 'Whether you can say numbers out loud. Whether you avoid conversations about rates, contracts, household finances, or debt.' }
        ]
      },
      {
        type: 'callout',
        label: 'Key Insight',
        body: 'The belief is not the enemy. The hidden belief is. A belief you can see and name loses most of its power the moment it is brought into the light.'
      },
      {
        type: 'list',
        title: 'Questions that surface what was installed',
        items: [
          'What was said about money in your house — and how was it said? Whispered? Shouted? Avoided entirely?',
          'Who handled the money? What did that person\'s face look like when they did?',
          'When was the first time money made you feel afraid, ashamed, or small?',
          'Who in your family was labeled "good with money"? Who was labeled "bad"? What did those labels teach you about who you were allowed to become?',
          'What did money "mean" in your house — safety, status, love, control, survival, freedom, all of the above?'
        ]
      },
      {
        type: 'callout',
        label: 'A note on honoring where it came from',
        body: 'Naming an inherited belief is not betraying the people who installed it. They gave you what they had. You can love them, honor their effort, and still refuse to keep paying the price of a belief that no longer fits the life you are building.'
      },
      {
        type: 'divider'
      },
      {
        type: 'assignment',
        title: 'Excavate the First Installation',
        intro: 'Set aside 30 quiet minutes. Answer in writing — not in your head. Specific memories hold more truth than general summaries, so be specific.',
        questions: [
          'Describe the earliest memory you have involving money. Not the cleanest memory — the earliest. Where were you, who was there, what did you feel?',
          'List three specific things that were said about money in your home. Quote them as closely as you can remember — phrasing matters.',
          'Who in your family had what role around money — the earner, the spender, the saver, the hider, the enforcer, the avoider? Name them by name.',
          'What did money seem to mean in your house? Pick the closest two or three: safety, status, love, control, survival, freedom, shame, power.',
          'Pick one belief from Module 1 that you now suspect you carry. Write it in one sentence — exactly as it would sound in your own head when money gets tight.',
          'What did this belief cost you in the last year? Be specific — an offer you did not make, a price you did not raise, a conversation you did not have.'
        ],
        notesKey: 'ms_1_origin',
        notesPlaceholder: 'Your excavation — saved automatically as you type. No one else can read this...',
        notesMinHeight: '300px'
      },
      {
        type: 'quote',
        text: 'You cannot out-earn a money belief you have not yet been brave enough to look at.',
        attr: 'Anthony Brown'
      }
    ]
  }
];

// ─── Adapters exposed to the workspace controller ────────────────────────

export const MODULES = LESSONS.map((lesson) => ({
  id: lesson.id,
  title: lesson.title,
  subtitle: lesson.subtitle || '',
  pillar: lesson.section || '',
  pillarTag: lesson.sectionTag || '',
  duration: lesson.duration || '',
  tag: lesson.sectionColor || 'tag-all',
  tagLabel: lesson.sectionTag || '',
  isAssignment: !!lesson.isAssignment,
  isOverview: !!lesson.isOverview,
  render: () => (lesson.isOverview ? renderOverview(lesson) : renderLesson(lesson))
}));

export const PILLARS = (() => {
  const groups = [];
  let current = null;
  for (const lesson of LESSONS) {
    const label = lesson.section || 'Lessons';
    if (!current || current.label !== label) {
      current = { label, ids: [] };
      groups.push(current);
    }
    current.ids.push(lesson.id);
  }
  return groups;
})();

export { renderLesson, renderOverview };
