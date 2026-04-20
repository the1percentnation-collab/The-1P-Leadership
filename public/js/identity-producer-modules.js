// The Identity of A Producer — course content.
//
// 6 lessons total, one per module:
//   0. Welcome Aboard! (overview)
//   1. You Don't Have an Activity Problem         (M1 — The Conversation Standard)
//   2. The Gap Between Knowing and Doing          (M2 — The Discipline Gap)
//   3. Stop Letting Feelings Decide Revenue       (M3 — Emotional Detachment)
//   4. The Producer Calendar                      (M4)
//   5. Identity Is Installed Through Repetition   (M5 — Installing the New Identity)
//
// Completing all 6 lessons earns the Course Completion Credential (surfaced
// by identity-producer-app.js in the status chip when `completed.size === MODULES.length`).
//
// Shape: same data-driven block system used by trust-process-modules.js:
//   { type: 'lead',       title, body: [p, ...] }
//   { type: 'callout',    label, body }
//   { type: 'list',       title?, items }
//   { type: 'framework',  title?, cards: [{icon,title,desc}] }
//   { type: 'quote',      text, attr? }
//   { type: 'divider' }
//   { type: 'assignment', title, intro?, questions?, notesKey, notesPlaceholder, notesMinHeight? }

import { store, getNotes } from './identity-producer-store.js';

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
          ${notesField(block.notesKey || `ip_${lessonId}`, block.notesPlaceholder || 'Write your response here. These notes save automatically...', block.notesMinHeight || '160px')}
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
        <span class="pillar-name">The Identity of A Producer</span>
      </div>
      <div class="module-title">THE IDENTITY<br><span>OF A</span><br>PRODUCER</div>
      <p class="module-desc">Six modules on the internal work it takes to produce at a new level — without waiting for motivation, permission, or the perfect feeling.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 6 modules</div>
        <div class="meta-item"><div class="meta-dot"></div> Self-paced</div>
        <div class="meta-item"><div class="meta-dot"></div> Credential on completion</div>
      </div>
    </div>

    <div class="overview-grid">
      <div class="stat-card">
        <div class="stat-label">Modules</div>
        <div class="stat-value red">${total}</div>
        <div class="stat-sub">Sequential · identity first</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Progress</div>
        <div class="stat-value">${pct}<span style="font-size:20px;color:var(--gray-mid)">%</span></div>
        <div class="stat-sub">${done} of ${total} complete</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Outcome</div>
        <div class="stat-value gold">1P</div>
        <div class="stat-sub">Producer Credential</div>
      </div>
    </div>

    <div class="divider-line"></div>

    ${(lesson.blocks || []).map((b) => renderBlock(b, lesson.id)).join('')}
  `;
}

// ─── Lesson content ──────────────────────────────────────────────────────

export const LESSONS = [
  // ───── Welcome Badge ─────
  {
    id: 0,
    section: 'Welcome Badge · Course Contents',
    sectionTag: 'WEL',
    sectionColor: 'tag-all',
    title: 'Welcome Aboard!',
    subtitle: 'Read this first — it will set the tone for the other five modules.',
    duration: '10 min',
    isOverview: true,
    blocks: [
      {
        type: 'lead',
        title: 'Why this course exists',
        body: [
          'Most people don\'t have a skill problem. They don\'t have a strategy problem. They have an identity problem. They are operating from a version of themselves that cannot produce at the level they are asking themselves to produce at.',
          'This course is not going to give you a new tactic. It is going to do something harder and more durable — it is going to install a new internal standard. The standard of someone who produces by default, not by mood. The standard of a Producer.'
        ]
      },
      {
        type: 'framework',
        title: 'What each module will shift',
        cards: [
          { icon: '🗣️', title: 'Module 1', desc: 'The Conversation Standard — you don\'t have an activity problem, you have a conversation one.' },
          { icon: '🪜', title: 'Module 2', desc: 'The Discipline Gap — the space between knowing and doing, and how to close it.' },
          { icon: '🧊', title: 'Module 3', desc: 'Emotional Detachment — stop letting how you feel decide what you earn.' },
          { icon: '📅', title: 'Module 4', desc: 'The Producer Calendar — constant activity is not the same as meaningful output.' },
          { icon: '🧬', title: 'Module 5', desc: 'Installing the New Identity — repetition is how a new self becomes automatic.' }
        ]
      },
      {
        type: 'callout',
        label: 'How to use this course',
        body: 'Go through the modules in order. Do the reflection — it is where the re-identification actually happens. Then come back to the modules you resist most. Those are the ones doing the real work.'
      },
      {
        type: 'quote',
        text: 'You will never outproduce the identity you quietly hold about yourself. Change the identity, and production follows.',
        attr: 'Anthony Brown'
      }
    ]
  },

  // ───── Module 1: The Conversation Standard ─────
  {
    id: 1,
    section: 'Module 1 — The Conversation Standard',
    sectionTag: 'M01',
    sectionColor: 'tag-p1',
    title: 'You Don\'t Have an Activity Problem',
    subtitle: 'You have a conversation problem. And the fix is not more outreach — it is a higher standard of conversation.',
    duration: '25 min',
    blocks: [
      {
        type: 'lead',
        title: 'The wrong diagnosis',
        body: [
          'Most people, when their numbers are down, reach for the same prescription: do more. Make more calls. Send more messages. Run more ads. Post more content. Hustle harder. The assumption underneath all of it is that the problem is activity — not enough of it.',
          'That diagnosis is almost always wrong. The real problem is rarely the volume of activity. The real problem is the caliber of conversation that activity leads to. You can 10x the volume of low-caliber conversations and still produce the same weak result.'
        ]
      },
      {
        type: 'callout',
        label: 'Core Principle',
        body: 'You do not have an activity problem. You have a conversation problem. Until the conversation changes, adding activity only makes you tired faster.'
      },
      {
        type: 'framework',
        title: 'Volume activity vs. Producer conversation',
        cards: [
          { icon: '📢', title: 'Volume activity', desc: 'Outputs. Touches. Sends. Measured in quantity. Driven by the belief that "enough attempts" will eventually convert.' },
          { icon: '🗣️', title: 'Producer conversation', desc: 'Depth. Discernment. Direction. Measured in clarity earned and decisions moved. One good one outproduces fifty shallow ones.' },
          { icon: '🎯', title: 'The standard', desc: 'Every conversation has a job. You walk in knowing what needs to be true by the end — and you have the internal capacity to actually get there.' }
        ]
      },
      {
        type: 'list',
        title: 'Signs you have a conversation problem (not an activity one)',
        items: [
          'Your pipeline is full but very little closes.',
          'People like you, nod along — then nothing happens after the call.',
          'You end conversations and cannot name what specifically shifted.',
          'You avoid the hard question because you are afraid it will cost you the "yes."',
          'You leave the conversation performing, not leading.',
          'You are exhausted by the end of your day but not clear on what actually moved.'
        ]
      },
      {
        type: 'framework',
        title: 'What a Producer\'s conversation does differently',
        cards: [
          { icon: '🔎', title: 'Names reality', desc: 'A Producer will say the true thing — gently, but without flinching — even when it is uncomfortable for both people.' },
          { icon: '🧱', title: 'Sets the frame', desc: 'A Producer does not let the other person\'s anxiety, objections, or stories set the tone. They hold the frame.' },
          { icon: '⚖️', title: 'Earns the decision', desc: 'A Producer is not attached to the outcome, but they are attached to the person leaving with clarity — yes or no.' },
          { icon: '🪞', title: 'Reflects the cost', desc: 'A Producer makes the cost of inaction visible. Not pressure — just the truth of what "no change" actually produces.' }
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'The conversation is your real product. Everything else — the platform, the pitch, the pipeline — exists to create more of those conversations. If the conversation is weak, every other lever is also weak.'
      },
      {
        type: 'list',
        title: 'A new measurement',
        items: [
          'Stop tracking only activity (how many calls, how many messages).',
          'Start tracking conversation quality — did it move, did they leave clearer, did you hold the frame?',
          'Review your last five "didn\'t close" conversations. Find the exact moment you failed to lead the frame. That is your real homework.',
          'Raise the floor: the lowest-quality conversation you are willing to have is the actual ceiling of your production.'
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'assignment',
        title: 'The Conversation Audit',
        intro: 'Look at the last week of conversations you had that were supposed to move something — sales calls, coaching sessions, negotiations, partnership chats. Be honest. No one else reads this.',
        questions: [
          'Pick one conversation this week that did not produce what you hoped. Describe in plain language what actually happened.',
          'Where in that conversation did you lower your standard — softening the truth, avoiding a question, letting them set the frame?',
          'What would a Producer have said at that exact moment — without being harsh, but also without shrinking?',
          'What is the conversation standard you are willing to hold from this point forward? Write it as a single sentence you could read before every call.',
          'Who in your world already holds this standard? What do you observe about how they show up?'
        ],
        notesKey: 'ip_1_conversation_audit',
        notesPlaceholder: 'Your audit — saved automatically as you type...',
        notesMinHeight: '260px'
      },
      {
        type: 'quote',
        text: 'A Producer does not do more. A Producer does differently. And the difference shows up first in how they speak.',
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
