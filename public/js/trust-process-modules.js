// Trust The Process — course content.
//
// 55 lessons grouped into an Introduction, 10 modules, and an Advanced Tips
// section. Each lesson is a data record rendered by a single generic
// `renderLesson()` function so the file stays readable.
//
// Block types supported by the renderer:
//   { type: 'lead',      title, body: [p, p, ...] }        // lesson-block with paragraphs
//   { type: 'callout',   label, body }                      // highlighted principle card
//   { type: 'list',      title?, items: [str, ...] }        // key-list bullets
//   { type: 'framework', title?, cards: [{icon,title,desc}] } // framework-grid of cards
//   { type: 'quote',     text, attr? }                      // quote-block
//   { type: 'divider' }                                     // horizontal divider
//   { type: 'assignment', title, intro?, questions?: [],
//                         notesKey, notesPlaceholder,
//                         notesMinHeight? }                 // reflection/assignment exercise

import { store, getNotes } from './trust-process-store.js';

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
    case 'callout': {
      return `
        <div class="callout">
          <div class="callout-label">${escapeHtml(block.label || 'Key Insight')}</div>
          <p>${escapeHtml(block.body || '')}</p>
        </div>`;
    }
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
          ${notesField(block.notesKey || `tp_${lessonId}`, block.notesPlaceholder || 'Write your response here. These notes save automatically...', block.notesMinHeight || '160px')}
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
        <span class="num">LESSON ${num}</span>
        <span class="divider"></span>
        <span class="pillar-name">${escapeHtml(lesson.section || '')}</span>
      </div>
      <div class="module-title">${escapeHtml((lesson.title || '').toUpperCase())}</div>
      ${lesson.subtitle ? `<p class="module-desc">${escapeHtml(lesson.subtitle)}</p>` : ''}
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> ${escapeHtml(lesson.duration || '10 min')}</div>
        ${lesson.isAssignment ? `<div class="meta-item"><div class="meta-dot"></div> Assignment</div>` : ''}
      </div>
    </div>
    ${completionBanner(lesson.id)}
    ${blocksHtml}
  `;
}

// ─── Overview (Lesson 0 is the intro itself; this is the welcome shown on
// the course's module-0 view.) ───────────────────────────────────────────

function renderOverview(lesson) {
  const done = store.completed ? store.completed.size : 0;
  const total = LESSONS.length;
  const pct = Math.round((done / total) * 100);
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">WELCOME</span>
        <span class="divider"></span>
        <span class="pillar-name">Trust The Process</span>
      </div>
      <div class="module-title">TRUST<br><span>THE</span><br>PROCESS</div>
      <p class="module-desc">Instructor: Anthony Brown, Founder &amp; CEO. A 55-lesson journey through resilience, purpose, and the quiet discipline of trusting the path — even when it bends.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 55 lessons</div>
        <div class="meta-item"><div class="meta-dot"></div> 10 modules + intro</div>
        <div class="meta-item"><div class="meta-dot"></div> Self-paced</div>
      </div>
    </div>

    <div class="overview-grid">
      <div class="stat-card">
        <div class="stat-label">Lessons</div>
        <div class="stat-value red">${total}</div>
        <div class="stat-sub">Across 10 modules</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Progress</div>
        <div class="stat-value">${pct}<span style="font-size:20px;color:var(--gray-mid)">%</span></div>
        <div class="stat-sub">${done} of ${total} complete</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Format</div>
        <div class="stat-value gold">1P</div>
        <div class="stat-sub">Reflective + practical</div>
      </div>
    </div>

    <div class="divider-line"></div>

    ${(lesson.blocks || []).map((b) => renderBlock(b, lesson.id)).join('')}
  `;
}

// ─── Lesson content ──────────────────────────────────────────────────────
//
// The array below is the single source of truth for the course. IDs are
// sequential integers so ordering + nav line up with the module-0...N pattern
// used by the workspace controller.

export const LESSONS = [
  // ───── Introduction ─────
  {
    id: 0,
    section: 'Introduction',
    sectionTag: 'INTRO',
    sectionColor: 'tag-all',
    title: 'Outline and Objectives',
    subtitle: 'What to expect from this course',
    duration: '10 min',
    isOverview: true,
    blocks: [
      {
        type: 'lead',
        title: 'Why this course exists',
        body: [
          'Trust The Process is built for the moments when the map runs out. It is a course for people who are already doing the work — and who need language, tools, and structure to keep going when the results have not yet arrived.',
          'The goal is not to remove the uncertainty from your path. The goal is to teach you how to walk it with clarity, resilience, and grace.'
        ]
      },
      {
        type: 'list',
        title: 'Course objectives',
        items: [
          'Understand why life\'s challenges are not detours — they are the path itself.',
          'Build emotional resilience as a repeatable, trainable skill.',
          'Set goals with enough structure to move and enough flexibility to adapt.',
          'Maintain motivation through setbacks, plateaus, and long stretches of invisible progress.',
          'Cultivate a practice of trust, reflection, and rest that sustains you over the long run.'
        ]
      },
      {
        type: 'callout',
        label: 'How to use this course',
        body: 'Work through the lessons in order the first time. Complete the assignments — they are where the real work happens. After that, revisit any lesson as often as you need. This is a resource, not a race.'
      },
      {
        type: 'quote',
        text: 'Trust the process. Even the parts that feel like they\'re breaking you are shaping you.',
        attr: 'Anthony Brown'
      }
    ]
  },

  // ───── Module 1: Understanding the Journey ─────
  {
    id: 1,
    section: 'Module 1 — Understanding the Journey',
    sectionTag: 'M01',
    sectionColor: 'tag-p1',
    title: 'The Nature of Life\'s Challenges',
    subtitle: 'Challenges are not obstacles on the path — they are the path.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The path bends',
        body: [
          'Life is a journey filled with unexpected twists and turns. No matter how meticulously you plan, surprises and obstacles will inevitably emerge along the way.',
          'These challenges, though daunting, carry within them opportunities for growth and transformation. They are not just barriers — they are stepping stones. Every difficulty is a chance to build capacity you did not have before.'
        ]
      },
      {
        type: 'callout',
        label: 'Core Principle',
        body: 'The presence of difficulty is not a sign you are off course. It is a sign you are on one.'
      },
      {
        type: 'list',
        title: 'What challenges reveal',
        items: [
          'The beliefs you were still holding on to that no longer serve you',
          'The skills you did not know you would need to develop',
          'The people you can actually count on when the weather turns',
          'The version of you who shows up when comfort is removed'
        ]
      },
      {
        type: 'quote',
        text: 'The obstacle is not in the way. The obstacle is the way.',
        attr: 'Marcus Aurelius'
      }
    ]
  },
  {
    id: 2,
    section: 'Module 1 — Understanding the Journey',
    sectionTag: 'M01',
    sectionColor: 'tag-p1',
    title: 'Embracing Setbacks as Learning Opportunities',
    subtitle: 'Setbacks are universal. What you do with them is not.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The psychology of setbacks',
        body: [
          'Setbacks, though often unpleasant, are universal experiences. They provide the opportunity to transform challenges into milestones for growth.',
          'To better understand and utilize these moments, it is essential to delve deeper into the psychology of setbacks, their impact on our lives, and strategies to overcome them.'
        ]
      },
      {
        type: 'framework',
        title: 'A setback has three stages',
        cards: [
          { icon: '💥', title: 'Impact', desc: 'The moment the thing did not go the way you planned. Pain is valid — let it land.' },
          { icon: '🪞', title: 'Meaning', desc: 'The story you tell yourself about why it happened. This is where most people lose themselves.' },
          { icon: '🧭', title: 'Movement', desc: 'The action you take next. This is where a setback becomes a stepping stone.' }
        ]
      },
      {
        type: 'list',
        title: 'Reframes that help',
        items: [
          'This is data, not a verdict.',
          'This did not happen to me. It happened for me — even if I cannot see how yet.',
          'Pain is information. What is it telling me I need to learn, change, or release?',
          'I am not behind. I am on a different timeline than I expected.'
        ]
      }
    ]
  },
  {
    id: 3,
    section: 'Module 1 — Understanding the Journey',
    sectionTag: 'M01',
    sectionColor: 'tag-p1',
    title: 'Defining Success on Your Own Terms',
    subtitle: 'If you do not define success, someone else will define it for you.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Success is subjective',
        body: [
          'Success is a concept deeply ingrained in our culture, often defined by external markers such as wealth, status, power, or fame.',
          'While these measures are visible and celebrated by society, they are not universally meaningful or fulfilling. True success is subjective, rooted in personal values and aspirations.',
          'The work of this lesson is to strip away the definitions you inherited and decide — consciously — what you actually want your life to feel like.'
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'Success is the alignment of how you spend your days with what you say matters most. Everything else is decoration.'
      },
      {
        type: 'list',
        title: 'Questions that cut through the noise',
        items: [
          'What would I chase if no one was watching and no one would applaud?',
          'What am I currently chasing that I would not choose again if I were honest?',
          'Whose approval am I organizing my life around — and is it worth it?',
          'What does a good day look like for me? A good year? A good life?'
        ]
      }
    ]
  },
  {
    id: 4,
    section: 'Module 1 — Understanding the Journey',
    sectionTag: 'M01',
    sectionColor: 'tag-p1',
    title: 'Assignment: Personal Reflection',
    subtitle: 'Put the work in writing — clarity lives on the other side of the page.',
    duration: '25 min',
    isAssignment: true,
    blocks: [
      {
        type: 'assignment',
        title: 'Personal Reflection',
        intro: 'Set aside 20 minutes. Turn off notifications. Answer each question honestly — nobody else has to read this.',
        questions: [
          'What is the biggest challenge you are navigating right now — and what might it be trying to teach you?',
          'Write about a past setback you once saw as failure. Looking back, what did it actually give you?',
          'Define success in your own words — without referencing money, status, or any external measure.',
          'If you already trusted the process fully, how would you behave differently this week?'
        ],
        notesKey: 'tp_m1_reflection',
        notesPlaceholder: 'Your reflection — saved automatically as you type...',
        notesMinHeight: '220px'
      }
    ]
  },

  // ───── Module 2: Building Emotional Resilience ─────
  {
    id: 5,
    section: 'Module 2 — Building Emotional Resilience',
    sectionTag: 'M02',
    sectionColor: 'tag-p1',
    title: 'Managing Negative Emotions',
    subtitle: 'You cannot manage what you have not first understood.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Finding the root cause',
        body: [
          'To manage negative emotions effectively, it is essential to identify their root causes. While surface-level triggers may be obvious — a missed deadline, an argument with a loved one — the deeper origins often stem from unmet needs and past experiences.',
          'Emotions are not the enemy. They are messengers. The work is not to silence them but to learn to listen long enough to understand what they are trying to tell you.'
        ]
      },
      {
        type: 'framework',
        title: 'The emotion beneath the emotion',
        cards: [
          { icon: '😤', title: 'Anger', desc: 'Often covers hurt, fear, or a boundary that has been crossed without being named.' },
          { icon: '😔', title: 'Sadness', desc: 'Often covers grief for something lost — a dream, a version of you, a relationship.' },
          { icon: '😰', title: 'Anxiety', desc: 'Often covers a value at risk and a lack of clarity on what action would protect it.' },
          { icon: '😶', title: 'Numbness', desc: 'Often covers emotion overload — the body\'s protective shut-down when feeling becomes too much.' }
        ]
      },
      {
        type: 'list',
        title: 'A practice for the moment',
        items: [
          'Name it: say out loud, "I am feeling _____."',
          'Locate it: where is the feeling sitting in your body right now?',
          'Ask it: "What are you trying to tell me? What do I need right now?"',
          'Respond, do not react: take one conscious action that honors the need, even if it is just a breath.'
        ]
      },
      {
        type: 'callout',
        label: 'Key Insight',
        body: 'The goal is not to stop feeling negative emotions. The goal is to stop being controlled by them.'
      }
    ]
  },
  {
    id: 6,
    section: 'Module 2 — Building Emotional Resilience',
    sectionTag: 'M02',
    sectionColor: 'tag-p1',
    title: 'Cultivating Patience and Persistence',
    subtitle: 'Two quiet traits that compound into everything.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The twin engines of endurance',
        body: [
          'Patience and persistence are fundamental traits that act as cornerstones for achieving long-term success. They empower individuals to face challenges head-on, maintain focus, and overcome obstacles without losing sight of their goals.',
          'Patience is the capacity to wait without resentment. Persistence is the capacity to act without guarantee. You need both — because real results rarely arrive on your preferred schedule.'
        ]
      },
      {
        type: 'framework',
        title: 'Patience vs. Persistence',
        cards: [
          { icon: '⏳', title: 'Patience', desc: 'The willingness to let time do its work. Trusting that what is planted in faith eventually shows above ground.' },
          { icon: '🛠️', title: 'Persistence', desc: 'The willingness to keep watering the seed — even when nothing is visibly growing yet.' },
          { icon: '🧘', title: 'The blend', desc: 'Patient on timelines, persistent on actions. The opposite combination will burn you out.' }
        ]
      },
      {
        type: 'list',
        title: 'Daily practices',
        items: [
          'Pick one thing worth doing imperfectly every day for 90 days.',
          'Measure inputs (actions) instead of outputs (outcomes) when you are early in the journey.',
          'When you feel impatient, ask: "Am I impatient because it is taking too long, or because I am afraid it is not working?"',
          'Celebrate any streak, no matter how small. Consistency is its own reward.'
        ]
      }
    ]
  },
  {
    id: 7,
    section: 'Module 2 — Building Emotional Resilience',
    sectionTag: 'M02',
    sectionColor: 'tag-p1',
    title: 'Final Thoughts: Building Emotional Resilience',
    subtitle: 'Resilience is not a personality trait — it is a practice.',
    duration: '12 min',
    blocks: [
      {
        type: 'lead',
        title: 'Resilience is built, not born',
        body: [
          'Emotional resilience is not a fixed trait — it is a skill that can be cultivated with intention, patience, and practice.',
          'Life will inevitably present challenges, uncertainties, and setbacks, but your ability to navigate through these moments is what defines your strength. Every time you sit with a hard emotion instead of running from it, you build the muscle a little stronger.'
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'Resilience is not about never breaking. It is about the speed with which you come back together — with more self-knowledge than you had before.'
      },
      {
        type: 'quote',
        text: 'You are not fragile. You are practicing.',
        attr: 'The One Percent Nation'
      }
    ]
  },
  {
    id: 8,
    section: 'Module 2 — Building Emotional Resilience',
    sectionTag: 'M02',
    sectionColor: 'tag-p1',
    title: 'Assignment: Emotional Resilience Journal',
    subtitle: 'A seven-day practice of naming, locating, and learning from your emotions.',
    duration: '20 min',
    isAssignment: true,
    blocks: [
      {
        type: 'lead',
        title: 'Your seven-day journal',
        body: [
          'For the next seven days, each evening spend five minutes with the prompts below. Do not skip a day — the pattern is only visible across the week.'
        ]
      },
      {
        type: 'assignment',
        title: 'Emotional Resilience Journal',
        intro: 'Use the text area below to log your daily entries. Date each one. Be specific.',
        questions: [
          'What emotion showed up strongest today, and what triggered it?',
          'Where did I feel it in my body?',
          'What was the emotion beneath the emotion? What need was it pointing to?',
          'How did I respond — and what would I do differently next time?',
          'One thing I want to remember from today.'
        ],
        notesKey: 'tp_m2_journal',
        notesPlaceholder: 'Day 1 — Date:\n\n— What emotion showed up...\n— Where I felt it...\n— What it was pointing to...\n— How I responded...\n— What I want to remember...',
        notesMinHeight: '260px'
      }
    ]
  },

  // ───── Module 3: Goal Setting with Flexibility ─────
  {
    id: 9,
    section: 'Module 3 — Goal Setting with Flexibility',
    sectionTag: 'M03',
    sectionColor: 'tag-p2',
    title: 'Setting SMART Goals',
    subtitle: 'Structure is not the enemy of freedom — it is what makes freedom possible.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Why structure comes first',
        body: [
          'Before you can incorporate flexibility into your goals, you must first set them up for success. The SMART goal framework is a powerful tool for creating clear, structured, and achievable objectives.',
          'Without a structured approach to goal-setting, individuals often struggle with vague ambitions — the kind that feel motivating on Sunday night and evaporate by Tuesday morning.'
        ]
      },
      {
        type: 'framework',
        title: 'The SMART framework',
        cards: [
          { icon: '🎯', title: 'Specific', desc: 'Name exactly what will be true when the goal is done. No vague verbs like "improve" or "grow."' },
          { icon: '📏', title: 'Measurable', desc: 'If you cannot measure it, you cannot track it. Pick a number, a metric, or a visible outcome.' },
          { icon: '✅', title: 'Achievable', desc: 'Ambitious but not delusional. A stretch, not a fantasy.' },
          { icon: '🧭', title: 'Relevant', desc: 'Aligned with your actual values and season of life — not someone else\'s idea of what matters.' },
          { icon: '⏰', title: 'Time-bound', desc: 'A deadline. A real one. Goals without dates are just wishes.' }
        ]
      },
      {
        type: 'list',
        title: 'A SMART goal, rewritten',
        items: [
          'Before: "I want to get healthier."',
          'After: "I will walk for 30 minutes, 5 days a week, for the next 90 days, and log every session."',
          'Before: "I want to grow my business."',
          'After: "I will book 12 new discovery calls in Q3 by sending 10 personalized outreach messages every Tuesday and Thursday morning."'
        ]
      }
    ]
  },
  {
    id: 10,
    section: 'Module 3 — Goal Setting with Flexibility',
    sectionTag: 'M03',
    sectionColor: 'tag-p2',
    title: 'Applying Flexibility to SMART Goals',
    subtitle: 'Hold the goal loosely. Hold the direction tightly.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'When life changes, the plan changes',
        body: [
          'Even with clean, well-described SMART goals, life can change unexpectedly. Being flexible with your goals does not suggest abandoning them or giving up — it means finding new ways to stay on track when things do not go according to plan.',
          'Rigid goals break under pressure. Flexible goals bend, adapt, and continue. The direction stays the same even when the path has to shift.'
        ]
      },
      {
        type: 'framework',
        title: 'Three levels to flex',
        cards: [
          { icon: '🗓️', title: 'Timeline', desc: 'The deadline can move. What cannot change is that the work continues.' },
          { icon: '🛤️', title: 'Path', desc: 'The specific steps can change as you learn. Stay attached to outcomes, not tactics.' },
          { icon: '📐', title: 'Scope', desc: 'The size of the goal can expand or contract with your season. Shrink without shame when needed.' }
        ]
      },
      {
        type: 'callout',
        label: 'Key Principle',
        body: 'A goal that cannot bend will eventually break. A goal that bends too easily will never produce anything. Flexibility with conviction is the art.'
      }
    ]
  },
  {
    id: 11,
    section: 'Module 3 — Goal Setting with Flexibility',
    sectionTag: 'M03',
    sectionColor: 'tag-p2',
    title: 'Overcoming the Fear of Failure',
    subtitle: 'The fear is not that you will fail. The fear is what failing would mean about you.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Failure is a detour, not a verdict',
        body: [
          'Fear of failure is one of the biggest obstacles that prevent people from pursuing their goals with flexibility and confidence. Many individuals believe that if things do not go exactly as planned, they have failed.',
          'However, failure is not the end of the road — it is merely a detour. The question is never "did this attempt succeed?" The question is "what am I carrying forward from it?"'
        ]
      },
      {
        type: 'list',
        title: 'What fear of failure sounds like',
        items: [
          '"I should wait until I\'m ready" (you will never feel ready).',
          '"What will people think if this doesn\'t work?" (they are thinking about themselves).',
          '"I already tried something like this and it didn\'t work" (this is not that; you are not the same person).',
          '"If I don\'t attempt it, I can\'t fail" (you already failed, quietly, by not trying).'
        ]
      },
      {
        type: 'callout',
        label: 'The reframe',
        body: 'Failure is tuition. Every so-called failure is the cost of learning something you could not have learned any other way. The people you admire have all paid that tuition — publicly.'
      }
    ]
  },
  {
    id: 12,
    section: 'Module 3 — Goal Setting with Flexibility',
    sectionTag: 'M03',
    sectionColor: 'tag-p2',
    title: 'Final Thoughts: Setting Goals is Essential',
    subtitle: 'Flexibility is not weakness. It is wisdom.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'The balance',
        body: [
          'Setting goals is an essential part of building the life you want, but rigid goals can sometimes become a source of stress rather than motivation.',
          'Flexibility in goal setting allows you to adapt, pivot, and stay on track, even when life throws curveballs your way. Hold the direction tightly and the plan loosely — that is the whole game.'
        ]
      },
      {
        type: 'quote',
        text: 'A good plan today is better than a perfect plan tomorrow. A flexible plan in both hands is better than either.',
        attr: 'Anthony Brown'
      }
    ]
  },
  {
    id: 13,
    section: 'Module 3 — Goal Setting with Flexibility',
    sectionTag: 'M03',
    sectionColor: 'tag-p2',
    title: 'Assignment: Setting SMART Goals and Preparing for Challenges',
    subtitle: 'Write three SMART goals — and the flex plan for each.',
    duration: '30 min',
    isAssignment: true,
    blocks: [
      {
        type: 'assignment',
        title: 'SMART Goals + Flex Plan',
        intro: 'Write three SMART goals. For each goal, also write one sentence each for timeline flex, path flex, and scope flex — what would you adjust first if the plan needs to change?',
        questions: [
          'Goal 1 (SMART) — and how will you flex it if needed?',
          'Goal 2 (SMART) — and how will you flex it if needed?',
          'Goal 3 (SMART) — and how will you flex it if needed?',
          'What is the fear most likely to stop you from starting — and what will you do when it shows up?'
        ],
        notesKey: 'tp_m3_goals',
        notesPlaceholder: 'Goal 1: (Specific/Measurable/Achievable/Relevant/Time-bound)\nFlex plan:\n\nGoal 2: ...\nGoal 3: ...\n\nFear + response:',
        notesMinHeight: '260px'
      }
    ]
  },

  // ───── Module 4: Maintaining Motivation in Tough Times ─────
  {
    id: 14,
    section: 'Module 4 — Maintaining Motivation in Tough Times',
    sectionTag: 'M04',
    sectionColor: 'tag-p2',
    title: 'Identifying Your "Why"',
    subtitle: 'Motivation is unreliable. Meaning is durable.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The power of knowing your "why"',
        body: [
          'One of the most powerful tools for maintaining motivation and perseverance in life is understanding your deeper purpose — your "why."',
          'This underlying reason is what fuels your drive, keeps you pushing forward, and gives meaning to your actions. When motivation fades — and it will — your "why" is what remains.'
        ]
      },
      {
        type: 'list',
        title: 'Layers of "why"',
        items: [
          'Surface "why": "I want to hit this goal."',
          'Deeper "why": "Because it will change my life in this specific way."',
          'Core "why": "Because I refuse to be the person who didn\'t try."',
          'Legacy "why": "Because the people watching me need to see it is possible."'
        ]
      },
      {
        type: 'callout',
        label: 'The discipline',
        body: 'Write your "why" somewhere you will see it every morning. Read it on the days you want to quit. That is what it is for.'
      }
    ]
  },
  {
    id: 15,
    section: 'Module 4 — Maintaining Motivation in Tough Times',
    sectionTag: 'M04',
    sectionColor: 'tag-p2',
    title: 'The Power of Small Wins',
    subtitle: 'The big milestones are built out of tiny, unglamorous ones.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The unseen architecture of success',
        body: [
          'We often celebrate the big milestones: landing a dream job, launching a successful business, finishing a marathon. These are great achievements — but they do not happen overnight.',
          'What often gets overlooked are the tiny, incremental victories that paved the way. These "small wins" are the backbone of lasting success. They are what keeps you in the game long enough to reach the big ones.'
        ]
      },
      {
        type: 'framework',
        title: 'Why small wins matter',
        cards: [
          { icon: '⚡', title: 'Momentum', desc: 'Each small win creates proof that you are capable of the next one.' },
          { icon: '🧠', title: 'Identity', desc: 'You become the kind of person who finishes what they start — one small completion at a time.' },
          { icon: '🔁', title: 'Feedback', desc: 'Small wins tell you what is working so you can do more of it.' }
        ]
      },
      {
        type: 'list',
        title: 'Make small wins visible',
        items: [
          'Keep a "done" list alongside your to-do list.',
          'At the end of each day, write one thing you did today that moved the needle, even slightly.',
          'Share one small win per week with someone who gets it.',
          'Celebrate completions, not just outcomes.'
        ]
      }
    ]
  },
  {
    id: 16,
    section: 'Module 4 — Maintaining Motivation in Tough Times',
    sectionTag: 'M04',
    sectionColor: 'tag-p2',
    title: 'Overcoming Procrastination',
    subtitle: 'Procrastination is not laziness — it is emotional regulation in disguise.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'What procrastination actually is',
        body: [
          'Procrastination is not laziness. It is a complex psychological behavior that affects nearly everyone at some point.',
          'Whether you are an entrepreneur delaying launching a business, a writer staring at a blank page, or a professional postponing an important project, procrastination can quietly erode productivity. And it is almost always a symptom of something deeper — often fear, perfectionism, or overwhelm.'
        ]
      },
      {
        type: 'framework',
        title: 'The three flavors',
        cards: [
          { icon: '😨', title: 'Fear-based', desc: 'You avoid the task because finishing it means being judged.' },
          { icon: '💎', title: 'Perfection-based', desc: 'You avoid the task because doing it imperfectly feels worse than not doing it at all.' },
          { icon: '🌪️', title: 'Overwhelm-based', desc: 'You avoid the task because you cannot see where to even begin.' }
        ]
      },
      {
        type: 'list',
        title: 'Tools that actually work',
        items: [
          'The 2-minute rule: commit to two minutes. You almost always keep going.',
          'Task shrinking: if a task feels too big, make it smaller until it feels dumb-easy.',
          'Name the emotion: "I am avoiding this because I am afraid of ___." Naming it cuts its power in half.',
          'Environment design: remove the friction to start, and add friction to the distraction.'
        ]
      }
    ]
  },
  {
    id: 17,
    section: 'Module 4 — Maintaining Motivation in Tough Times',
    sectionTag: 'M04',
    sectionColor: 'tag-p2',
    title: 'Staying Motivated in the Face of Setbacks',
    subtitle: 'Motivation dies. Discipline carries you through.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Life does not always go as planned',
        body: [
          'Whether you are an entrepreneur watching your startup struggle, a parent navigating the unpredictable terrain of family life, or a professional aiming for a promotion that just slipped through your fingers — setbacks are part of the journey.',
          'The people who keep going are not the ones who feel motivated every day. They are the ones who have built systems that carry them through the days motivation takes the week off.'
        ]
      },
      {
        type: 'callout',
        label: 'Core Principle',
        body: 'Motivation is a feeling. Discipline is a decision. Build your life on the decision, not the feeling.'
      },
      {
        type: 'list',
        title: 'Systems that keep you going',
        items: [
          'Non-negotiable morning anchors — three things you do before checking the world.',
          'A weekly review to remind yourself of the "why" and adjust the plan without abandoning it.',
          'A support system (covered in Module 9) that you let in when things get hard.',
          'Permission to rest — rest is part of the plan, not a failure of it.'
        ]
      }
    ]
  },
  {
    id: 18,
    section: 'Module 4 — Maintaining Motivation in Tough Times',
    sectionTag: 'M04',
    sectionColor: 'tag-p2',
    title: 'Assignment: Discipline Tracking System',
    subtitle: 'Design a 30-day system that keeps you moving when motivation does not.',
    duration: '25 min',
    isAssignment: true,
    blocks: [
      {
        type: 'assignment',
        title: 'Discipline Tracking System',
        intro: 'Design your system below. Keep it simple — if it is too complex, you will not use it.',
        questions: [
          'Your "why" — in one sentence, written so you will actually remember it.',
          'Three non-negotiable daily anchors (behaviors you will do every day for 30 days).',
          'How will you track them — a notebook, an app, a whiteboard? Be specific.',
          'What is your weekly review ritual — when will you do it, and what three questions will you ask?',
          'What will you do on the day you want to quit?'
        ],
        notesKey: 'tp_m4_discipline',
        notesPlaceholder: 'Write your 30-day discipline system here...',
        notesMinHeight: '240px'
      }
    ]
  },

  // ───── Module 5: Trusting the Process ─────
  {
    id: 19,
    section: 'Module 5 — Trusting the Process',
    sectionTag: 'M05',
    sectionColor: 'tag-p3',
    title: 'Letting Go of Control',
    subtitle: 'The illusion costs more than the surrender.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The illusion of control',
        body: [
          'In a fast-paced world that celebrates hustle, productivity, and certainty, it is no wonder many of us cling to control.',
          'We are told that if we work hard enough and plan well enough, we can control outcomes — but this is an illusion. You can control your actions, your attitude, and your response. Everything else is weather.'
        ]
      },
      {
        type: 'framework',
        title: 'What you can vs. cannot control',
        cards: [
          { icon: '✅', title: 'You can control', desc: 'Your effort, your attention, your habits, your response, your words, your next decision.' },
          { icon: '⛔', title: 'You cannot control', desc: 'Other people, outcomes, timing, markets, weather, other people\'s opinions of you.' },
          { icon: '🎯', title: 'The discipline', desc: 'Pour your energy into the first column. Stop bleeding energy on the second.' }
        ]
      },
      {
        type: 'callout',
        label: 'Key Insight',
        body: 'Letting go of control is not passivity. It is putting your strength where it can actually make a difference.'
      }
    ]
  },
  {
    id: 20,
    section: 'Module 5 — Trusting the Process',
    sectionTag: 'M05',
    sectionColor: 'tag-p3',
    title: 'The Importance of Faith in the Journey',
    subtitle: 'Faith is the compass for the parts of the path you cannot yet see.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'When the road disappears',
        body: [
          'Life rarely hands us a road map. We find ourselves navigating winding paths, unexpected detours, and moments where the next step feels shrouded in fog.',
          'For the dreamers, builders, leaders, and seekers — faith becomes the quiet but powerful compass that guides them forward. Faith is not the absence of doubt. It is walking forward anyway.'
        ]
      },
      {
        type: 'list',
        title: 'What faith looks like in practice',
        items: [
          'Taking the next right step before you can see the whole staircase.',
          'Trusting your track record — you have made it through every hard day so far.',
          'Releasing the need to know how before you are willing to begin.',
          'Believing that the version of you on the other side of this season is worth the walk.'
        ]
      },
      {
        type: 'quote',
        text: 'Faith is taking the first step, even when you don\'t see the whole staircase.',
        attr: 'Martin Luther King Jr.'
      }
    ]
  },
  {
    id: 21,
    section: 'Module 5 — Trusting the Process',
    sectionTag: 'M05',
    sectionColor: 'tag-p3',
    title: 'Focusing on Progress, Not Perfection',
    subtitle: 'Progress is real. Perfection is a moving target you designed to never reach.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Why progress beats perfection',
        body: [
          'We live in a world that often celebrates flawless outcomes, perfect images, and impeccable performance. Social media shows highlight reels, not the behind-the-scenes struggles.',
          'But progress — not perfection — is the true measure of growth. The willingness to do it imperfectly is what separates people who finish from people who dream about finishing.'
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: '1% better. Every day. Imperfectly. That is the whole philosophy.'
      },
      {
        type: 'list',
        title: 'Progress markers that count',
        items: [
          'You are doing something today that would have felt impossible a year ago.',
          'Your questions are getting better, even when your answers are not.',
          'You recover from setbacks faster than you used to.',
          'You are kinder to yourself in the middle of hard things.'
        ]
      }
    ]
  },
  {
    id: 22,
    section: 'Module 5 — Trusting the Process',
    sectionTag: 'M05',
    sectionColor: 'tag-p3',
    title: 'Conclusion: Trusting the Process',
    subtitle: 'Challenges do not define you. Your response does.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'The posture of trust',
        body: [
          'Trusting the process means embracing the journey with an open heart and mind. It is about letting go of the need for control, having faith in your capability to navigate whatever comes your way, and celebrating progress, not perfection.',
          'Life\'s challenges and uncertainties do not define you — your response to them does. And the response you practice today becomes the response that shows up automatically when it really counts.'
        ]
      },
      {
        type: 'quote',
        text: 'The process is the point. The destination is just where the process left you.',
        attr: 'Anthony Brown'
      }
    ]
  },
  {
    id: 23,
    section: 'Module 5 — Trusting the Process',
    sectionTag: 'M05',
    sectionColor: 'tag-p3',
    title: 'Assignment: Letter to Your Future Self',
    subtitle: 'Write yourself a letter you\'ll need on a hard day a year from now.',
    duration: '30 min',
    isAssignment: true,
    blocks: [
      {
        type: 'lead',
        title: 'Reflecting on your journey of trusting the process',
        body: [
          'Write a thoughtful letter to your future self — to be read one year from today. Focus on how you are learning to embrace progress over perfection, release control, and trust the journey.'
        ]
      },
      {
        type: 'assignment',
        title: 'Letter to Your Future Self',
        intro: 'Use the questions below as guides. Write as if you are speaking to the version of you who will need to hear it most.',
        questions: [
          'Letting Go of Control: how have you learned to release the need for control in your life?',
          'The Role of Faith: what role has faith played in helping you trust the process?',
          'Celebrating Progress: what progress have you made that you are most proud of?',
          'What do you want to remind your future self when they forget everything they learned this year?'
        ],
        notesKey: 'tp_m5_letter',
        notesPlaceholder: 'Dear Future Me,\n\n',
        notesMinHeight: '320px'
      }
    ]
  },

  // ───── Module 6: Overcoming Obstacles with Grace ─────
  {
    id: 24,
    section: 'Module 6 — Overcoming Obstacles with Grace',
    sectionTag: 'M06',
    sectionColor: 'tag-p3',
    title: 'Reframing Failures as Opportunities',
    subtitle: 'Failure is not the opposite of success. It is part of it.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The hidden power of failure',
        body: [
          'Failure is a word that often comes with heavy emotional baggage — disappointment, shame, frustration, even fear.',
          'But what if we redefined failure entirely? What if, instead of seeing it as a dead end, we saw it as a doorway to greater growth? Every failure carries inside it a lesson, a refinement, or a redirection that success rarely provides.'
        ]
      },
      {
        type: 'framework',
        title: 'What failure actually gives you',
        cards: [
          { icon: '🔎', title: 'Clarity', desc: 'You learn exactly which assumption was wrong — something success would have hidden from you.' },
          { icon: '💪', title: 'Capacity', desc: 'You build the muscle of recovering. That muscle is what every future version of you will need.' },
          { icon: '🧭', title: 'Redirection', desc: 'Sometimes "failure" is the universe rerouting you toward something that was actually meant for you.' }
        ]
      },
      {
        type: 'callout',
        label: 'The reframe',
        body: 'You are not a failure. You had a failure. There is an ocean of difference between those two sentences.'
      }
    ]
  },
  {
    id: 25,
    section: 'Module 6 — Overcoming Obstacles with Grace',
    sectionTag: 'M06',
    sectionColor: 'tag-p3',
    title: 'Developing Problem-Solving Skills',
    subtitle: 'A solution-oriented mindset is a muscle. Build it on purpose.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The power of a solution-oriented mindset',
        body: [
          'Every one of us encounters challenges — daily, weekly, and throughout our lives. Whether you are an entrepreneur navigating business growth, a professional managing team dynamics, or an individual tackling personal hurdles — problem-solving skills are essential.',
          'The difference between people who drown in problems and people who move through them is not intelligence. It is a practiced habit of asking better questions.'
        ]
      },
      {
        type: 'list',
        title: 'A five-question problem-solving rhythm',
        items: [
          '1. What is actually the problem here? (Often different from what it first looked like.)',
          '2. What is within my control to influence?',
          '3. What are at least three possible responses — not just the first one I thought of?',
          '4. What is the smallest experiment I can run this week to test one of them?',
          '5. How will I know if it worked, and what will I do next?'
        ]
      },
      {
        type: 'callout',
        label: 'Key Habit',
        body: 'Replace "why is this happening to me?" with "what is this asking me to learn or change?" Every time.'
      }
    ]
  },
  {
    id: 26,
    section: 'Module 6 — Overcoming Obstacles with Grace',
    sectionTag: 'M06',
    sectionColor: 'tag-p3',
    title: 'Handling Setbacks with Grace',
    subtitle: 'Grace is the space between what happens and how you respond.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Grace in the middle of chaos',
        body: [
          'Setbacks are an inevitable part of life. No matter how meticulously we plan, how passionately we pursue our goals, or how disciplined we are in execution — life has a way of throwing curveballs.',
          'What sets successful, resilient individuals apart is how they respond. Grace is not weakness. It is the refusal to add unnecessary suffering to something that is already hard.'
        ]
      },
      {
        type: 'framework',
        title: 'What grace looks like in real time',
        cards: [
          { icon: '🕊️', title: 'Self-grace', desc: 'You do not beat yourself up for having a bad day. You give yourself the kindness you would give a friend.' },
          { icon: '🌾', title: 'Grace toward others', desc: 'You assume the best about people in the middle of their worst moments. Everyone is fighting something.' },
          { icon: '🌬️', title: 'Grace toward the situation', desc: 'You stop demanding the circumstance be different and start asking what it is here to teach.' }
        ]
      },
      {
        type: 'quote',
        text: 'Between stimulus and response there is a space. In that space is our power to choose our response.',
        attr: 'Viktor Frankl'
      }
    ]
  },
  {
    id: 27,
    section: 'Module 6 — Overcoming Obstacles with Grace',
    sectionTag: 'M06',
    sectionColor: 'tag-p3',
    title: 'Conclusion: Obstacles are Part of the Path',
    subtitle: 'Resilience is built here.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'Obstacles do not derail you',
        body: [
          'Obstacles and setbacks are a natural part of any meaningful journey — but they do not have to derail your progress or diminish your motivation.',
          'When you choose to reframe failure, strengthen your problem-solving skills, cultivate a growth mindset, and respond with grace — you build the resilience needed to succeed over the long run.'
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'Your response to obstacles is your actual leadership. Everything else is commentary.'
      }
    ]
  },
  {
    id: 28,
    section: 'Module 6 — Overcoming Obstacles with Grace',
    sectionTag: 'M06',
    sectionColor: 'tag-p3',
    title: 'Assignment: Overcoming Obstacles with Grace',
    subtitle: 'Take one real obstacle and run it through the full process.',
    duration: '25 min',
    isAssignment: true,
    blocks: [
      {
        type: 'assignment',
        title: 'Overcoming Obstacles with Grace',
        intro: 'Pick a real obstacle you are facing right now — work, relational, internal. Work through every question below for that specific situation.',
        questions: [
          'Describe the obstacle in one clear paragraph. No drama — just the facts.',
          'What is within your control here, and what is not? Be honest.',
          'Reframe: what might this obstacle be preparing you for?',
          'List three possible responses. Circle the one you will actually try this week.',
          'How will you show grace — to yourself, to others involved, to the situation itself?'
        ],
        notesKey: 'tp_m6_obstacle',
        notesPlaceholder: 'Your obstacle + full response here...',
        notesMinHeight: '280px'
      }
    ]
  },

  // ───── Module 7: Self-Care as a Foundation for Success ─────
  {
    id: 29,
    section: 'Module 7 — Self-Care as a Foundation for Success',
    sectionTag: 'M07',
    sectionColor: 'tag-p3',
    title: 'Prioritizing Physical, Mental, and Emotional Well-Being',
    subtitle: 'You cannot pour from an empty cup for long before the cup cracks.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'A holistic approach to high performance',
        body: [
          'To thrive in both your personal and professional life, you must nurture the entire spectrum of your well-being: physical, mental, and emotional.',
          'Each of these aspects is deeply interconnected. Neglecting one inevitably impacts the others. The body keeps score; the mind amplifies it; the heart eventually sends the bill.'
        ]
      },
      {
        type: 'framework',
        title: 'The three layers',
        cards: [
          { icon: '🏃', title: 'Physical', desc: 'Sleep, nutrition, movement, hydration. Non-negotiable inputs your nervous system runs on.' },
          { icon: '🧠', title: 'Mental', desc: 'Focused attention, learning, boundaries around input, space for thinking without a screen.' },
          { icon: '❤️', title: 'Emotional', desc: 'Processing feelings, meaningful relationships, time for reflection, permission to rest.' }
        ]
      },
      {
        type: 'callout',
        label: 'Key Insight',
        body: 'You cannot out-hustle a burnt-out nervous system. At some point, the only way forward is through taking care of yourself.'
      }
    ]
  },
  {
    id: 30,
    section: 'Module 7 — Self-Care as a Foundation for Success',
    sectionTag: 'M07',
    sectionColor: 'tag-p3',
    title: 'Creating a Self-Care Routine that Supports Growth',
    subtitle: 'Routine is how care becomes compound interest.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Self-care as a foundation for sustainable growth',
        body: [
          'Long-term success does not come solely from hustle, productivity, or willpower — it is sustained by how well we take care of ourselves along the way.',
          'In a world that often glorifies constant output, self-care is the quiet engine that keeps us going. It is not a reward you earn after the work — it is the condition that makes the work sustainable.'
        ]
      },
      {
        type: 'list',
        title: 'Principles of a routine that lasts',
        items: [
          'Anchor self-care to something you already do daily (after coffee, before bed, etc.).',
          'Start with one change at a time. Stacking too many habits at once is why they fall apart.',
          'Design for your worst day, not your best. If it only works on a good day, it will not work when you need it most.',
          'Track it visibly — a simple tick on a calendar is often enough.'
        ]
      }
    ]
  },
  {
    id: 31,
    section: 'Module 7 — Self-Care as a Foundation for Success',
    sectionTag: 'M07',
    sectionColor: 'tag-p3',
    title: 'The Connection Between Self-Care and Success',
    subtitle: 'Rested people outperform exhausted people. Every time.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The misunderstood link between hustle and health',
        body: [
          'In today\'s fast-paced, achievement-driven culture, success is often equated with hustle, grind, and sleepless nights.',
          'We admire those who work 16-hour days, who skip meals to meet deadlines, and who wear busyness as a badge of honor — but this approach is unsustainable. It is also usually a slower path to the real goal.'
        ]
      },
      {
        type: 'framework',
        title: 'What self-care actually produces',
        cards: [
          { icon: '⚡', title: 'Energy', desc: 'Real creative output comes from a full tank, not a dragging one.' },
          { icon: '🎯', title: 'Focus', desc: 'A rested brain solves in an hour what an exhausted one cannot solve in a week.' },
          { icon: '🛡️', title: 'Resilience', desc: 'When the inevitable storm arrives, your reserves decide how you weather it.' }
        ]
      },
      {
        type: 'callout',
        label: 'Reframe',
        body: 'Self-care is not a break from the work. Self-care is part of the work.'
      }
    ]
  },
  {
    id: 32,
    section: 'Module 7 — Self-Care as a Foundation for Success',
    sectionTag: 'M07',
    sectionColor: 'tag-p3',
    title: 'Conclusion: Self-Care is Foundational',
    subtitle: 'Long-term well-being is the quiet prerequisite for everything else.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'The foundation holds everything up',
        body: [
          'Self-care is not a luxury — it is a vital foundation for achieving fulfillment and maintaining long-term well-being.',
          'By prioritizing your physical, mental, and emotional health, you equip yourself with the strength, clarity, and resilience needed to tackle challenges and keep becoming the person your goals require.'
        ]
      },
      {
        type: 'quote',
        text: 'Almost everything will work again if you unplug it for a few minutes — including you.',
        attr: 'Anne Lamott'
      }
    ]
  },
  {
    id: 33,
    section: 'Module 7 — Self-Care as a Foundation for Success',
    sectionTag: 'M07',
    sectionColor: 'tag-p3',
    title: 'Assignment: Develop Your Personalized Self-Care Plan',
    subtitle: 'Design a routine you will actually keep.',
    duration: '30 min',
    isAssignment: true,
    blocks: [
      {
        type: 'lead',
        title: 'Identify your needs',
        body: [
          'Reflect on your current physical, mental, and emotional state. Write down the activities that make you feel balanced, energized, and rejuvenated. Consider:',
          'Physical: exercise, nutrition, sleep, hydration, rest. Mental: mindfulness, learning, creativity, deep focus. Emotional: journaling, therapy, relationships, prayer/meditation.'
        ]
      },
      {
        type: 'assignment',
        title: 'Personalized Self-Care Plan',
        intro: 'Design a plan with one physical, one mental, and one emotional anchor you will keep for the next 30 days.',
        questions: [
          'Physical anchor: what, when, how often — and how will you make it easy to do?',
          'Mental anchor: what, when, how often — and what will you remove to make space for it?',
          'Emotional anchor: what, when, how often — and who (if anyone) is involved?',
          'What is one thing you will stop doing because it is draining you?',
          'How will you track this, and what will you do on the days you miss?'
        ],
        notesKey: 'tp_m7_selfcare',
        notesPlaceholder: 'Your 30-day self-care plan...',
        notesMinHeight: '260px'
      }
    ]
  },

  // ───── Module 8: The Power of Positive Reflection ─────
  {
    id: 34,
    section: 'Module 8 — The Power of Positive Reflection',
    sectionTag: 'M08',
    sectionColor: 'tag-all',
    title: 'The Role of Reflection in Personal Growth',
    subtitle: 'Experience does not teach. Reflected-on experience teaches.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Presence over productivity',
        body: [
          'In our fast-paced world, where productivity often trumps presence and action overshadows awareness, reflection might feel like a luxury.',
          'But true personal growth does not just come from experiences — it comes from learning from those experiences through intentional reflection. The same event can pass by invisibly or become a turning point, depending on whether you sit with it.'
        ]
      },
      {
        type: 'list',
        title: 'What reflection does',
        items: [
          'Turns raw experience into usable wisdom.',
          'Surfaces patterns you would otherwise repeat without noticing.',
          'Reconnects you to your values when decisions get foggy.',
          'Slows you down enough to notice what is actually working in your life.'
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'Never let an experience pass unexamined when it cost you something to live through it.'
      }
    ]
  },
  {
    id: 35,
    section: 'Module 8 — The Power of Positive Reflection',
    sectionTag: 'M08',
    sectionColor: 'tag-all',
    title: 'Gratitude as a Tool for Success',
    subtitle: 'Gratitude is not soft. It is one of the most efficient tools you will ever use.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The unseen power of gratitude',
        body: [
          'In a world that often demands more — more success, more achievement, more hustle — it is easy to overlook what we already have.',
          'Yet, one of the most transformative tools for personal and professional success lies not in striving, but in appreciating. Gratitude is not a replacement for ambition — it is the steady ground that makes ambition sustainable.'
        ]
      },
      {
        type: 'framework',
        title: 'Three kinds of gratitude',
        cards: [
          { icon: '🫶', title: 'Situational', desc: 'Appreciation for something that happened today — small or large.' },
          { icon: '🪞', title: 'Relational', desc: 'Appreciation for a specific person and what they do or have done for you.' },
          { icon: '🧭', title: 'Existential', desc: 'Appreciation for being here at all — the broader sense that you get to live this one life.' }
        ]
      },
      {
        type: 'list',
        title: 'A simple daily practice',
        items: [
          'Each morning: one thing you are grateful for, written down.',
          'Each evening: one thing from today you are grateful for.',
          'Weekly: one person you will tell you appreciate them — and why, specifically.'
        ]
      }
    ]
  },
  {
    id: 36,
    section: 'Module 8 — The Power of Positive Reflection',
    sectionTag: 'M08',
    sectionColor: 'tag-all',
    title: 'Building a Reflection Practice',
    subtitle: 'Reflection is a habit. Habits need a structure.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'A transformative habit for growth and clarity',
        body: [
          'Every high achiever, conscious leader, and emotionally intelligent human being shares a powerful habit that quietly fuels their growth: reflection.',
          'It is not loud. It is not showy. But it is transformative. When you consistently reflect, you gain clarity, direction, and deeper self-understanding. The goal is not to journal beautifully — it is to think honestly, on paper.'
        ]
      },
      {
        type: 'list',
        title: 'The four reflection cadences',
        items: [
          'Daily (5 min): one win, one lesson, one intention for tomorrow.',
          'Weekly (20 min): what worked, what did not, what needs to change.',
          'Monthly (30 min): am I aligned with my values and goals? What season am I in?',
          'Quarterly (60 min): full recalibration — what am I starting, stopping, continuing?'
        ]
      },
      {
        type: 'callout',
        label: 'Key Habit',
        body: 'The cadence you keep is more important than the depth you go. Pick one you can actually sustain.'
      }
    ]
  },
  {
    id: 37,
    section: 'Module 8 — The Power of Positive Reflection',
    sectionTag: 'M08',
    sectionColor: 'tag-all',
    title: 'The Power of Reflecting on Progress',
    subtitle: 'You have done more than you remember. Write it down.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The journey matters too',
        body: [
          'In the pursuit of big dreams and long-term goals, there are often moments when progress feels slow, efforts feel futile, and motivation begins to fade.',
          'It is easy to get caught in the cycle of what is next — constantly striving, pushing, and chasing after the end result without pausing to appreciate the journey. But progress is happening. The problem is usually that you are not looking.'
        ]
      },
      {
        type: 'list',
        title: 'Where to look for hidden progress',
        items: [
          'Conversations you handle differently than you would have a year ago.',
          'Problems that used to overwhelm you that now feel manageable.',
          'Old goals you achieved and then moved past without celebrating.',
          'Skills you now take for granted that you had to learn from zero.'
        ]
      },
      {
        type: 'callout',
        label: 'Reframe',
        body: 'You are not behind. You are further along than the version of you who started. That counts.'
      }
    ]
  },
  {
    id: 38,
    section: 'Module 8 — The Power of Positive Reflection',
    sectionTag: 'M08',
    sectionColor: 'tag-all',
    title: 'Conclusion: Reflection Fuels the Journey',
    subtitle: 'Gratitude, reflection, and celebration compound into momentum.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'A mindset that stays inspired',
        body: [
          'Positive reflection is a powerful practice that allows you to grow, learn, and stay motivated on your journey to fulfillment.',
          'By taking the time to reflect on your progress, practice gratitude, and celebrate your wins, you cultivate a mindset that keeps you focused, resilient, and inspired — no matter how long the path is.'
        ]
      },
      {
        type: 'quote',
        text: 'Reflection turns information into wisdom.',
        attr: 'Anthony Brown'
      }
    ]
  },
  {
    id: 39,
    section: 'Module 8 — The Power of Positive Reflection',
    sectionTag: 'M08',
    sectionColor: 'tag-all',
    title: 'Assignment: The Power of Positive Reflection',
    subtitle: 'Define it, apply it, install it as a habit.',
    duration: '25 min',
    isAssignment: true,
    blocks: [
      {
        type: 'assignment',
        title: 'Positive Reflection',
        intro: 'Objective: understand the significance of positive reflection in personal development and how it can be applied to improve mindset and achieve life goals.',
        questions: [
          'Define positive reflection in your own words — and why it matters to you.',
          'List three specific moments from the last 90 days where you made real progress (no matter how small).',
          'List three people you are grateful for, and one specific thing each of them has given you.',
          'Design your own reflection cadence — daily, weekly, monthly, or some combination. When will you do it, and where will you write?',
          'What is one lie about yourself that reflection has helped you stop believing?'
        ],
        notesKey: 'tp_m8_reflection',
        notesPlaceholder: 'Your reflections...',
        notesMinHeight: '260px'
      }
    ]
  },

  // ───── Module 9: Building a Support System for Success ─────
  {
    id: 40,
    section: 'Module 9 — Building a Support System for Success',
    sectionTag: 'M09',
    sectionColor: 'tag-all',
    title: 'The Importance of a Strong Support System',
    subtitle: 'Solo is romantic in theory. In practice, it slows you down.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'You were never meant to do this alone',
        body: [
          'Life is full of highs and lows, triumphs and trials, forward leaps and unexpected setbacks. Navigating that journey alone is not just difficult — it is unnecessary.',
          'Behind every great achievement is often a network of people who helped make it possible. A support system does not replace your effort. It protects it.'
        ]
      },
      {
        type: 'framework',
        title: 'What a support system gives you',
        cards: [
          { icon: '🪶', title: 'Perspective', desc: 'People outside your head see what you cannot see from inside it.' },
          { icon: '🧭', title: 'Accountability', desc: 'Being witnessed in your commitments changes whether you keep them.' },
          { icon: '🛟', title: 'Rescue', desc: 'When you fall, the right people help you stand up faster than you would alone.' }
        ]
      },
      {
        type: 'callout',
        label: 'Key Insight',
        body: 'Every goal you have ever achieved had at least one other person in its backstory. Honor that — and build the relationships on purpose.'
      }
    ]
  },
  {
    id: 41,
    section: 'Module 9 — Building a Support System for Success',
    sectionTag: 'M09',
    sectionColor: 'tag-all',
    title: 'Finding the Right People',
    subtitle: 'Not everyone deserves a seat at your table. Choose carefully.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Building a support system that works',
        body: [
          'Success is rarely a solo journey. Behind every high-achiever is often a web of relationships that empower, support, and challenge them to grow.',
          'Whether you are launching a business, chasing a lifelong dream, or navigating personal development — the right people make all the difference. The wrong people will quietly shrink your ambition. Both happen slowly enough that you may not notice.'
        ]
      },
      {
        type: 'framework',
        title: 'The five seats at the table',
        cards: [
          { icon: '🧑‍🏫', title: 'Mentor', desc: 'Someone further along who has walked where you are walking.' },
          { icon: '🤝', title: 'Peer', desc: 'Someone on your level who pushes you forward by modeling what is possible.' },
          { icon: '🌱', title: 'Mentee', desc: 'Someone behind you who sharpens you by forcing you to articulate what you know.' },
          { icon: '🛡️', title: 'Truth-teller', desc: 'Someone who tells you the truth you do not want to hear — and loves you anyway.' },
          { icon: '🎉', title: 'Cheerleader', desc: 'Someone who believes in you on the days you do not believe in yourself.' }
        ]
      }
    ]
  },
  {
    id: 42,
    section: 'Module 9 — Building a Support System for Success',
    sectionTag: 'M09',
    sectionColor: 'tag-all',
    title: 'Strengthening Your Support System',
    subtitle: 'Relationships do not thrive by accident. They thrive by attention.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Maintain and strengthen, not just build',
        body: [
          'We often hear about the importance of building a support system, but the true value lies not just in its creation, but in how we maintain and strengthen it.',
          'Relationships — whether personal, professional, or communal — do not thrive by accident. They require attention, energy, and intentionality. Treat them the way you would treat the most important investments of your life, because that is what they are.'
        ]
      },
      {
        type: 'list',
        title: 'Practices that strengthen relationships',
        items: [
          'Send unprompted appreciation — tell people what they mean to you, before they earn it.',
          'Show up in the small moments, not just the big ones.',
          'Be the person you want in your circle — reciprocity starts with you.',
          'Have the hard conversations early. Resentment compounds faster than affection.',
          'Celebrate their wins loudly. Scarcity mindset kills support systems.'
        ]
      }
    ]
  },
  {
    id: 43,
    section: 'Module 9 — Building a Support System for Success',
    sectionTag: 'M09',
    sectionColor: 'tag-all',
    title: 'Conclusion: Your People Carry You',
    subtitle: 'A strong support system is the quiet force behind every sustained journey.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'The network holds',
        body: [
          'A robust support system is essential for sustained fulfillment. By surrounding yourself with those who encourage, guide, and hold you accountable, you create a network that helps you stay resilient, focused, and motivated.',
          'Take the time to build, nurture, and strengthen your support system — because the version of you that is coming cannot get here alone.'
        ]
      },
      {
        type: 'quote',
        text: 'Show me your five closest people and I will show you your future.',
        attr: 'Jim Rohn'
      }
    ]
  },
  {
    id: 44,
    section: 'Module 9 — Building a Support System for Success',
    sectionTag: 'M09',
    sectionColor: 'tag-all',
    title: 'Assignment: Build Your Support System Plan',
    subtitle: 'Name the seats. Name the people. Make the plan.',
    duration: '30 min',
    isAssignment: true,
    blocks: [
      {
        type: 'assignment',
        title: 'Support System Plan',
        intro: 'Use the five seats — Mentor, Peer, Mentee, Truth-teller, Cheerleader — as your structure.',
        questions: [
          'Who currently occupies each of the five seats in your life? Which seats are empty?',
          'For any empty seat, who could realistically fill it — and what is one step you can take this month to begin that relationship?',
          'Who in your current circle is subtly shrinking your ambition? What boundary do you need to draw?',
          'What is one specific appreciation you will send this week — and to whom?',
          'How will you tend this network going forward — frequency, rituals, and check-ins?'
        ],
        notesKey: 'tp_m9_support',
        notesPlaceholder: 'Your support system plan...',
        notesMinHeight: '260px'
      }
    ]
  },

  // ───── Module 10: Celebrating Progress and Resting for Renewal ─────
  {
    id: 45,
    section: 'Module 10 — Celebrating Progress and Resting for Renewal',
    sectionTag: 'M10',
    sectionColor: 'tag-all',
    title: 'The Importance of Celebrating Progress',
    subtitle: 'You cannot build a life you love without stopping to notice it.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Pausing is a practice',
        body: [
          'In a world driven by achievement, where perfection often overshadows effort, the idea of pausing to celebrate progress might seem counterintuitive.',
          'Yet, it is one of the most effective and empowering practices you can adopt in your personal and professional growth journey. Celebration is not vanity — it is how the brain encodes: "this is a direction worth continuing."'
        ]
      },
      {
        type: 'list',
        title: 'What to actually celebrate',
        items: [
          'Completions, not just outcomes.',
          'The hard conversation you had, even if it was messy.',
          'The thing you did not do that you used to do automatically.',
          'The person you are becoming, not just the results they produce.'
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'If you only celebrate at the finish line, most of your life goes uncelebrated. Celebrate the miles, not just the medal.'
      }
    ]
  },
  {
    id: 46,
    section: 'Module 10 — Celebrating Progress and Resting for Renewal',
    sectionTag: 'M10',
    sectionColor: 'tag-all',
    title: 'The Role of Rest and Renewal',
    subtitle: 'Rest is not the enemy of ambition. It is the engine room.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'Rest is not weakness',
        body: [
          'In a culture that celebrates hustle and champions the idea of being "always on," rest can seem like a luxury — or worse, a weakness.',
          'We wear exhaustion like a badge of honor and hustle like it is a moral virtue. But the truth is: rest is not a sign of weakness — it is a strategic necessity. Rested people make better decisions, lead with more compassion, and sustain longer.'
        ]
      },
      {
        type: 'framework',
        title: 'The four kinds of rest',
        cards: [
          { icon: '🛌', title: 'Physical', desc: 'Sleep and bodily recovery. The foundation everything else rests on.' },
          { icon: '🧠', title: 'Mental', desc: 'Space without input. Walks, silence, staring out a window.' },
          { icon: '❤️', title: 'Emotional', desc: 'Time with people where you do not have to perform or caretake.' },
          { icon: '🌿', title: 'Spiritual', desc: 'Reconnection to meaning — prayer, nature, worship, contemplation.' }
        ]
      }
    ]
  },
  {
    id: 47,
    section: 'Module 10 — Celebrating Progress and Resting for Renewal',
    sectionTag: 'M10',
    sectionColor: 'tag-all',
    title: 'Creating a Balance Between Work and Rest',
    subtitle: 'Not harder. Smarter. And rested.',
    duration: '15 min',
    blocks: [
      {
        type: 'lead',
        title: 'The real secret of long-term success',
        body: [
          'In today\'s hustle-driven culture, the idea of pressing pause can often feel like falling behind. We glorify the grind, celebrate busyness, and measure worth by productivity.',
          'But what if the real secret to long-term success is not working harder — it is working smarter and resting intentionally? Rhythm beats intensity over a lifetime.'
        ]
      },
      {
        type: 'list',
        title: 'Principles of sustainable rhythm',
        items: [
          'Plan rest the way you plan work — on the calendar, non-negotiable.',
          'End your workday with a closing ritual, not a slow drift.',
          'Protect at least one day per week as input-light and obligation-light.',
          'Take the vacation, the walk, the nap. The work will still be there.',
          'Sprint seasons are fine. Sprint years are not.'
        ]
      },
      {
        type: 'callout',
        label: 'Key Insight',
        body: 'The goal is a life that is sustainable, not impressive. Impressive looks great for a year. Sustainable changes the whole arc of who you become.'
      }
    ]
  },
  {
    id: 48,
    section: 'Module 10 — Celebrating Progress and Resting for Renewal',
    sectionTag: 'M10',
    sectionColor: 'tag-all',
    title: 'Conclusion: Celebrate and Rest',
    subtitle: 'You are allowed to enjoy the journey you are on.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'The two forgotten disciplines',
        body: [
          'Celebrating your progress and taking time to rest are vital components of a successful and fulfilling journey.',
          'By acknowledging your achievements, you build confidence and maintain motivation. By prioritizing rest, you ensure that you have the energy and clarity needed to keep moving forward. Celebration and rest are not the reward at the end — they are the fuel along the way.'
        ]
      },
      {
        type: 'quote',
        text: 'You are allowed to be both a masterpiece and a work in progress, simultaneously.',
        attr: 'Sophia Bush'
      }
    ]
  },
  {
    id: 49,
    section: 'Module 10 — Celebrating Progress and Resting for Renewal',
    sectionTag: 'M10',
    sectionColor: 'tag-all',
    title: 'Assignment: Celebrate and Rest Plan',
    subtitle: 'Design the rituals — and actually put them on the calendar.',
    duration: '25 min',
    isAssignment: true,
    blocks: [
      {
        type: 'assignment',
        title: 'Celebrate and Rest Plan',
        intro: 'Design a rhythm that honors both celebration and rest — at a daily, weekly, and seasonal level.',
        questions: [
          'Daily celebration: how will you acknowledge one win at the end of each day?',
          'Weekly celebration: what ritual will mark the end of each week, and who (if anyone) is involved?',
          'Quarterly celebration: what will you do to mark 90 days of progress?',
          'Daily rest: what will you stop doing at the end of your workday to truly close it out?',
          'Weekly rest: what day or block each week will be obligation-light?',
          'What will you do on the days this all feels too hard to maintain?'
        ],
        notesKey: 'tp_m10_celebrate',
        notesPlaceholder: 'Your celebrate + rest plan...',
        notesMinHeight: '280px'
      }
    ]
  },

  // ───── Advanced Tips ─────
  {
    id: 50,
    section: 'Advanced Tips — Course Wrap Up',
    sectionTag: 'WRAP',
    sectionColor: 'tag-all',
    title: 'Wrapping Things Up',
    subtitle: 'The course ends. The work continues.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'What you have done',
        body: [
          'You have walked through ten modules on resilience, purpose, discipline, trust, and rest. That is a lot of ground.',
          'But none of this is theoretical anymore. The assignments, the reflections, the frameworks — they only mean something if you take them into the next week, the next month, the next year of your life. This is where most people stop. Do not be most people.'
        ]
      },
      {
        type: 'list',
        title: 'A small commitment list',
        items: [
          'Choose two practices from this course you will install in the next 30 days.',
          'Choose one belief from this course you will argue for in your own life.',
          'Choose one person you will share this journey with.',
          'Choose one assignment you will revisit at the next low moment.'
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'A course is not "complete" when you mark the last lesson. It is complete when it changes how you live.'
      }
    ]
  },
  {
    id: 51,
    section: 'Advanced Tips — Course Wrap Up',
    sectionTag: 'WRAP',
    sectionColor: 'tag-all',
    title: 'Resources',
    subtitle: 'Where to go next — and how to keep going.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'Keep the momentum',
        body: [
          'The Academy is built to be a resource, not a milestone. Come back to any of these modules whenever life asks you to — and lean into the community of people walking a similar road.'
        ]
      },
      {
        type: 'list',
        title: 'Suggested next steps inside the Academy',
        items: [
          'Revisit your Module 5 Letter to Your Future Self every 90 days.',
          'Post one reflection from this course in the Community feed — your story helps someone else.',
          'Pair this course with 1P-CLC if you want to go deeper on leadership and coaching.',
          'Book yourself a 30-minute monthly review on the calendar — treat it like a meeting with your most important stakeholder.'
        ]
      },
      {
        type: 'list',
        title: 'Outside the Academy',
        items: [
          'Books: Man\'s Search for Meaning (Viktor Frankl), The Gap and the Gain (Dan Sullivan), Atomic Habits (James Clear).',
          'Daily practice: a five-minute morning reflection and a five-minute evening gratitude note.',
          'Quarterly practice: a 90-minute personal retreat to review your life as honestly as you review your work.',
          'Emergency practice: when you forget everything, come back to one sentence — "trust the process."'
        ]
      }
    ]
  },
  {
    id: 52,
    section: 'Advanced Tips — Fundamentals',
    sectionTag: 'FDMT',
    sectionColor: 'tag-all',
    title: 'Concept 1: The Gap and the Gain',
    subtitle: 'Measure backward, not forward.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'Where happiness actually lives',
        body: [
          'Most people measure their lives by the gap between where they are and where they want to be. That gap is infinite — as soon as you reach a goal, the gap just relocates. This is why high-achievers so often feel unsatisfied.',
          'Measuring the gain is different. You measure the distance between where you are now and where you started. That distance is always positive, always visible, and always fuel for the next chapter.'
        ]
      },
      {
        type: 'callout',
        label: 'The practice',
        body: 'Every week, write down three gains — three specific ways you are further along than you were a year ago. Do this for a year and watch your relationship to progress change permanently.'
      }
    ]
  },
  {
    id: 53,
    section: 'Advanced Tips — Fundamentals',
    sectionTag: 'FDMT',
    sectionColor: 'tag-all',
    title: 'Concept 2: Identity-Based Change',
    subtitle: 'Behavior follows identity. Change the identity first.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'Who before what',
        body: [
          'Most change efforts focus on outcomes (what you want) or behaviors (what you will do). But the most durable change starts one level up — with identity: who you are becoming.',
          'A person who is "trying to run" will stop the first week it rains. A person who is "a runner" runs in the rain. The sentence you tell yourself about who you are is stronger than your motivation will ever be.'
        ]
      },
      {
        type: 'list',
        title: 'Installing a new identity',
        items: [
          'Pick the identity you want to step into. Say it in the present tense: "I am a person who ___."',
          'Ask: what would that person do today, even imperfectly?',
          'Do that. Repeat. Every small action is a vote for the identity.',
          'After enough votes, the identity becomes self-evident — to you and to everyone watching.'
        ]
      }
    ]
  },
  {
    id: 54,
    section: 'Advanced Tips — Fundamentals',
    sectionTag: 'FDMT',
    sectionColor: 'tag-all',
    title: 'Concept 3: The 1% Principle',
    subtitle: 'Small, consistent, compounding. That is the whole secret.',
    duration: '10 min',
    blocks: [
      {
        type: 'lead',
        title: 'The compounding math of 1%',
        body: [
          '1% better every day is imperceptible in the moment. Over a year, it is a 37x transformation. That is not motivational math — it is the actual mechanics of how real change happens in real lives.',
          'The trap is looking for 100% change in a week. The path is accepting 1% change every day and letting time do the work.'
        ]
      },
      {
        type: 'framework',
        title: 'Three places to apply it',
        cards: [
          { icon: '🧠', title: 'Mindset', desc: 'One better thought pattern a day. One reframe you did not make before.' },
          { icon: '🤝', title: 'Relationships', desc: 'One more thoughtful message, one more honest conversation, one less avoided one.' },
          { icon: '⚙️', title: 'Craft', desc: 'One more rep, one more iteration, one more small refinement in your work.' }
        ]
      },
      {
        type: 'quote',
        text: 'One percent better. Every day. Imperfectly. That is the whole philosophy. Trust the process — the compounding is real.',
        attr: 'The One Percent Nation'
      }
    ]
  }
];

// ─── Adapters exposed to the workspace controller ────────────────────────
//
// MODULES matches the shape expected by the 1P-CLC-style app.js controller:
// each item has { id, title, subtitle, pillar, pillarTag, duration, tag,
// tagLabel, render }. PILLARS groups lesson ids by section label so the nav
// can render them in blocks.

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

// Build PILLARS by grouping consecutive lessons with the same section label.
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
