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
  },

  // ───── Module 2: The Discipline Gap ─────
  {
    id: 2,
    section: 'Module 2 — The Discipline Gap',
    sectionTag: 'M02',
    sectionColor: 'tag-p1',
    title: 'The Gap Between Knowing and Doing',
    subtitle: 'You are not missing the information. You are missing the identity that would make the information automatic.',
    duration: '25 min',
    blocks: [
      {
        type: 'lead',
        title: 'The gap is not an information gap',
        body: [
          'If knowing was enough, everyone with access to the internet would be a Producer by now. The information is free. The frameworks are posted. The books are on the shelf. Yet the gap between people who know what to do and people who actually do it stays enormous.',
          'That gap is not a knowledge gap. It is a discipline gap — and underneath the discipline gap is an identity gap. People do not execute what they know because executing it would require becoming someone they do not yet see themselves as.'
        ]
      },
      {
        type: 'callout',
        label: 'Core Principle',
        body: 'Behavior follows identity. If the identity has not shifted, willpower will close the gap for a week or two and then fail. Every time. This is not a flaw in you — it is how humans are wired.'
      },
      {
        type: 'framework',
        title: 'Why knowing does not produce doing',
        cards: [
          { icon: '🧠', title: 'Knowing is cheap', desc: 'Information costs nothing. Your brain can store it without any change in behavior required. This is why courses often feel productive but change little.' },
          { icon: '💪', title: 'Doing is expensive', desc: 'Execution costs energy, comfort, and the old version of you. That is a price willpower alone cannot pay for long.' },
          { icon: '🧬', title: 'Identity is the bridge', desc: 'When the identity shifts, the expensive action becomes cheap — because it is just "what I do." The cost drops because the friction drops.' }
        ]
      },
      {
        type: 'list',
        title: 'Symptoms of a discipline gap',
        items: [
          'You can teach the principle but cannot quite live it.',
          'You start strong on Monday and drift by Thursday — every single week.',
          'You consume more than you apply. New course, new book, new podcast — same output.',
          'You know exactly what you "should" be doing and feel vaguely ashamed that you are not.',
          'Your plans are ambitious. Your execution is negotiable.'
        ]
      },
      {
        type: 'framework',
        title: 'How a Producer closes the gap',
        cards: [
          { icon: '🎯', title: 'Name the identity', desc: 'State, in the present tense, who you are becoming: "I am the kind of person who ___." Vague intentions cannot produce specific action.' },
          { icon: '📏', title: 'Shrink the rep', desc: 'Make the first action so small that your identity cannot argue with it. Tiny + daily beats massive + occasional every time.' },
          { icon: '🪞', title: 'Cast the vote', desc: 'Every action is a vote for an identity. Ten daily votes for "Producer" beat one heroic weekend of effort. Consistency compounds. Intensity burns out.' },
          { icon: '🛑', title: 'Remove the escape', desc: 'Design your environment so the old identity does not have a convenient place to hide. Friction toward the new, friction away from the old.' }
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'Discipline is not forcing yourself to do what you do not want to do. Discipline is becoming the kind of person for whom the right action is the default. That shift is installable — and it is the work of this course.'
      },
      {
        type: 'list',
        title: 'The three questions that close the gap',
        items: [
          'What would a Producer do in this exact situation?',
          'What is the smallest version of that I can do in the next ten minutes?',
          'If I did that every day for 90 days, who would I have become?'
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'assignment',
        title: 'The Discipline Gap Audit',
        intro: 'Pick one specific thing you know you should be doing but are not consistently doing. This is your test case. Work through the questions below for that one thing.',
        questions: [
          'Name it plainly: the thing you know to do and are not consistently doing.',
          'What would it say about your identity if you did this without negotiation, every day, for the next 90 days?',
          'What is the identity you are currently operating from that makes this action feel heavy? Name it without judgment.',
          'What is the smallest version of this action — the one your current identity cannot argue with? Commit to that version.',
          'What one piece of your environment needs to change so the old identity cannot hide there anymore?'
        ],
        notesKey: 'ip_2_discipline_gap',
        notesPlaceholder: 'Your audit — saved automatically as you type...',
        notesMinHeight: '260px'
      },
      {
        type: 'quote',
        text: 'You do not rise to the level of your goals. You fall to the level of your identity. Raise the identity, and the goals take care of themselves.',
        attr: 'Adapted from James Clear'
      }
    ]
  },

  // ───── Module 3: Emotional Detachment ─────
  {
    id: 3,
    section: 'Module 3 — Emotional Detachment',
    sectionTag: 'M03',
    sectionColor: 'tag-p2',
    title: 'Stop Letting Feelings Decide Revenue',
    subtitle: 'Your feelings are information. They are not your instructions.',
    duration: '25 min',
    blocks: [
      {
        type: 'lead',
        title: 'The hidden cost of emotional decision-making',
        body: [
          'Most people do not realize it, but their revenue rises and falls with their mood. They make the follow-up call when they feel confident. They skip it when they feel off. They post when they feel inspired. They go quiet when they feel unsure. Their business is, quietly, being run by feelings.',
          'A Producer does not do that. Not because a Producer is cold or disconnected, but because a Producer has learned to honor feelings as information without handing feelings the steering wheel. Revenue cannot be entrusted to moods. It is too important for that.'
        ]
      },
      {
        type: 'callout',
        label: 'Core Principle',
        body: 'Emotional detachment is not the absence of emotion. It is the refusal to let emotion set the agenda. You can feel every feeling fully and still do the thing that needs to be done.'
      },
      {
        type: 'framework',
        title: 'Feelings as data vs. feelings as directive',
        cards: [
          { icon: '📊', title: 'Feelings as data', desc: 'A signal. You notice it, name it, and ask what it is pointing to. Then you decide what to do — consciously.' },
          { icon: '🎚️', title: 'Feelings as directive', desc: 'An order. You obey it without examining it. "I don\'t feel like it" closes the laptop. "I feel anxious" cancels the call.' },
          { icon: '🧭', title: 'The shift', desc: 'A Producer treats feelings as intelligence from the body. Useful, sometimes crucial — but never the final decision-maker on revenue behavior.' }
        ]
      },
      {
        type: 'list',
        title: 'Signs your revenue is being run by feelings',
        items: [
          'Your income line chart looks like your mood chart.',
          'You "don\'t feel like" making the call — and you don\'t make it.',
          'You wait for motivation before doing the work you committed to yesterday.',
          'One rejection throws off the rest of the day.',
          'You need to "get in the right headspace" before every action that scares you.',
          'You are most productive when things are going well — and most paralyzed when they are not.'
        ]
      },
      {
        type: 'framework',
        title: 'How a Producer detaches',
        cards: [
          { icon: '🔔', title: 'Notice the feeling', desc: 'Name it out loud: "I am feeling resistance. I am feeling fear. I am feeling discouraged." Naming is the first act of separation.' },
          { icon: '🪟', title: 'See it as a weather pattern', desc: 'This feeling is passing through you. It is not who you are. Observe it the way you would observe a storm — with respect, without surrender.' },
          { icon: '✅', title: 'Do the committed thing anyway', desc: 'The commitment was made by a clearer version of you. Honor that version by acting as they would — even if today\'s version does not feel like it.' },
          { icon: '🔁', title: 'Debrief afterward', desc: 'Ask what the feeling was actually about. Often the fear was pointing at something real. Learn from it — without having let it run the day.' }
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'Your commitments outrank your moods. When the two disagree, the commitment wins. This is not harshness — this is self-respect at a higher level. The Producer inside you is counting on you not to negotiate with the noise.'
      },
      {
        type: 'list',
        title: 'Practical detachment practices',
        items: [
          'Decide the week\'s non-negotiables on Sunday, when the emotion is neutral. Then execute them regardless of how the week feels.',
          'Separate the decision from the execution. "Whether or not I make the call" is not a daily question — it is already decided. Only "when" is up for discussion.',
          'Install a 90-second pause before obeying any "I don\'t feel like it." Nine times out of ten the feeling passes before the pause ends.',
          'Track the behavior, not the mood. Did you do the committed thing? Yes or no. That is the only scoring that matters at the level of execution.',
          'After an emotional day, do a short debrief: what was I feeling, where was it coming from, did I honor my commitments anyway? Build the muscle.'
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'assignment',
        title: 'The Emotional Audit',
        intro: 'Look back at the last 30 days. Be honest — this is diagnostic, not a judgment.',
        questions: [
          'Which revenue-producing behaviors did you skip in the last 30 days because you "didn\'t feel like it"? Be specific.',
          'What feeling was present in those moments? Fear, shame, resentment, overwhelm, something else? Name it without softening.',
          'If you had treated that feeling as data instead of a directive, what would the decision have been?',
          'What are your three revenue non-negotiables — the behaviors that must happen regardless of mood? Write them as sentences.',
          'What 90-second pause or environmental cue will you install this week to interrupt the old pattern of obeying the feeling?'
        ],
        notesKey: 'ip_3_emotional_audit',
        notesPlaceholder: 'Your audit — saved automatically as you type...',
        notesMinHeight: '260px'
      },
      {
        type: 'quote',
        text: 'Feel everything. Decide anyway. That is the discipline of a Producer.',
        attr: 'Anthony Brown'
      }
    ]
  },

  // ───── Module 4: The Producer Calendar ─────
  {
    id: 4,
    section: 'Module 4 — The Producer Calendar',
    sectionTag: 'M04',
    sectionColor: 'tag-p2',
    title: 'The Producer Calendar',
    subtitle: 'Constant activity does not guarantee meaningful results. A Producer\'s calendar is architected, not reactive.',
    duration: '25 min',
    blocks: [
      {
        type: 'lead',
        title: 'The trap of constant activity',
        body: [
          'Busy has become a badge. We admire people whose calendars are packed to the minute, whose inboxes never empty, whose days run on adrenaline. But busy is not the same as productive. Reactive is not the same as intentional. Motion is not the same as progress.',
          'Constant activity does not guarantee meaningful results. In fact, it usually guarantees the opposite — because the highest-leverage work always requires space to think, space to execute deeply, and space to prepare before the conversation, the launch, the decision that actually moves revenue.'
        ]
      },
      {
        type: 'callout',
        label: 'Core Principle',
        body: 'If you did not design the day, the day was designed for you — by notifications, inboxes, and other people\'s urgency. A Producer refuses to let the urgent edit the important.'
      },
      {
        type: 'framework',
        title: 'Reactive calendar vs. Producer calendar',
        cards: [
          { icon: '🌪️', title: 'Reactive calendar', desc: 'Filled by whoever asks first. Meetings stack. Revenue behaviors get whatever is left — usually nothing. Ends each day exhausted and vaguely behind.' },
          { icon: '🏛️', title: 'Producer calendar', desc: 'Architected before the week starts. Revenue-producing behaviors are placed first, protected, and non-negotiable. Everything else fits around them.' },
          { icon: '🎯', title: 'The shift', desc: 'Stop asking "what do I have to do today?" and start asking "what must be true by the end of this week — and when is it scheduled?"' }
        ]
      },
      {
        type: 'list',
        title: 'Signs your calendar is running you',
        items: [
          'You schedule your day around meetings — and hope revenue work fits in the cracks.',
          'You cannot point to a block on your calendar labeled "revenue" or "deep work."',
          'You finish the day tired but cannot name what actually moved.',
          'Your highest-leverage work consistently gets pushed to "tomorrow."',
          'You respond to email faster than you execute your own priorities.',
          'You say yes to invitations before you check what they are displacing.'
        ]
      },
      {
        type: 'framework',
        title: 'The four Producer blocks',
        cards: [
          { icon: '💰', title: 'Revenue blocks', desc: 'Direct income-producing behavior — offers, outreach, conversations that close. Scheduled first. Protected. Daily, if possible.' },
          { icon: '🔨', title: 'Build blocks', desc: 'Creation — the product, the content, the systems. Deep work. Phone on do-not-disturb. Minimum 90 minutes.' },
          { icon: '🤝', title: 'Connection blocks', desc: 'People conversations — team, clients, partners. Batched into a window so they do not fragment the rest of the day.' },
          { icon: '♻️', title: 'Admin + recovery blocks', desc: 'Email, logistics, rest. Contained to specific windows so they cannot colonize the rest of the calendar.' }
        ]
      },
      {
        type: 'callout',
        label: 'The 1P Standard',
        body: 'Your calendar is the clearest picture of your identity. Show me your week and I will show you the version of yourself you are currently voting for. If the calendar says "reactive employee," the identity will follow.'
      },
      {
        type: 'list',
        title: 'Architecting the week — a Producer\'s Sunday',
        items: [
          'Name the one or two outcomes that must be true by Friday. If everything else failed and those happened, the week was a win.',
          'Place the revenue blocks on the calendar first — before anyone else has access to your time.',
          'Place the build blocks next — protected, labeled, non-negotiable.',
          'Batch connection and admin into windows. No scattered calls. No all-day email.',
          'Leave at least one unscheduled block per day for the unexpected — so the unexpected does not steal from the revenue block.',
          'Finish with a rest block. Rest is a Producer\'s investment, not a reward.'
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'assignment',
        title: 'The Calendar Architect',
        intro: 'Open your calendar for next week. Do not just read this assignment — build the week as you work through it.',
        questions: [
          'What are the one or two outcomes that must be true by the end of next week for it to count as a win?',
          'Which revenue-producing behaviors directly create those outcomes? Name them as specific actions.',
          'Place them on the calendar — at least one revenue block per day. Write down the days and times.',
          'Where are the build blocks going? Phone off, door closed, minimum 90 minutes. Name the days and times.',
          'What are you consciously saying no to or batching away (email, meetings, "quick questions") so the important can survive?'
        ],
        notesKey: 'ip_4_calendar_architect',
        notesPlaceholder: 'Your architected week — saved automatically as you type...',
        notesMinHeight: '260px'
      },
      {
        type: 'quote',
        text: 'Your calendar does not lie. It tells you — honestly — what you actually believe about what matters.',
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
