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
