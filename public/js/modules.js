import { store, getNotes } from './store.js';

function completionBanner(id, text = 'You have completed this module. Review anytime or continue forward.') {
  if (!store.isComplete(id)) return '';
  return `<div class="completion-banner"><h3>✓ Module Complete</h3><p>${text}</p></div>`;
}

function notesField(key, placeholder, minHeight = '100px') {
  return `<textarea class="notes-area" data-note-key="${key}" placeholder="${placeholder}" style="min-height:${minHeight}">${getNotes(key)}</textarea>`;
}

function renderOverview() {
  const done = store.completed.size;
  const total = MODULES.length;
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">WELCOME</span>
        <span class="divider"></span>
        <span class="pillar-name">Program Overview</span>
      </div>
      <div class="module-title">ONE PERCENT<br><span>CERTIFIED</span><br>LEADER COACH</div>
      <p class="module-desc">This certification doesn't just teach leadership. It requires you to do the work that most leaders skip — starting with yourself. You will walk out of this program with a credential that proves you've done the internal work required to coach others with integrity.</p>
    </div>

    <div class="overview-grid">
      <div class="stat-card">
        <div class="stat-label">Core Modules</div>
        <div class="stat-value red">6</div>
        <div class="stat-sub">Across 3 pillars</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Time</div>
        <div class="stat-value">~5<span style="font-size:20px;color:var(--gray-mid)">hrs</span></div>
        <div class="stat-sub">Self-paced</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Credential</div>
        <div class="stat-value gold">1P</div>
        <div class="stat-sub">CLC Certified</div>
      </div>
    </div>

    <div class="divider-line"></div>

    <div class="lesson-block">
      <h2>The Three Pillars</h2>
      <p>The certification is built on three non-negotiable pillars. They are sequential because the philosophy is sequential. You cannot effectively lead others if you have not yet learned to lead yourself. You cannot build purpose-driven culture if you have not mastered the foundational coaching conversation.</p>
      <div class="framework-grid">
        <div class="framework-card">
          <div class="fc-icon">🔴</div>
          <div class="fc-title">Pillar 1 — Lead Yourself</div>
          <div class="fc-desc">Mindset, identity, and internal foundations. Modules 1–2.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">🟠</div>
          <div class="fc-title">Pillar 2 — Lead Others</div>
          <div class="fc-desc">Coaching frameworks, communication, accountability. Modules 3–4.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">🟡</div>
          <div class="fc-title">Pillar 3 — Lead with Purpose</div>
          <div class="fc-desc">Vision, culture, values-aligned teams. Modules 5–6.</div>
        </div>
      </div>
    </div>

    <div class="divider-line"></div>

    <div class="lesson-block">
      <h2>Certification Tiers</h2>
      <div class="tier-grid">
        <div class="tier-card">
          <div class="tier-name">1P-CLC Practitioner</div>
          <div class="tier-price"><sup>$</sup>497</div>
          <ul class="tier-features">
            <li>All 6 modules + workbooks</li>
            <li>Digital 1P-CLC certificate</li>
            <li>Coach individuals under 1P brand</li>
            <li>LinkedIn + employer credential badge</li>
            <li>1P Coach Community access</li>
          </ul>
        </div>
        <div class="tier-card featured">
          <div class="tier-tag">Most Popular</div>
          <div class="tier-name">1P-CLC Professional</div>
          <div class="tier-price"><sup>$</sup>997</div>
          <ul class="tier-features">
            <li>Everything in Practitioner</li>
            <li>1-on-1 practicum review with Anthony</li>
            <li>License to sell coaching as 1P brand</li>
            <li>Quarterly live coach calls</li>
            <li>Co-branded marketing assets</li>
            <li>Priority listing in 1P Coach Directory</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="divider-line"></div>

    <div class="lesson-block">
      <h2>The Certification Path</h2>
      <div class="flow-steps">
        <div class="flow-step ${done > 0 ? 'done' : 'current'}">
          <div class="flow-num">STEP 01</div>
          <div class="flow-name">Enroll</div>
          <div class="flow-desc">Complete intake and select your tier</div>
        </div>
        <div class="flow-step ${done >= 6 ? 'done' : (done > 0 ? 'current' : '')}">
          <div class="flow-num">STEP 02</div>
          <div class="flow-name">Learn</div>
          <div class="flow-desc">Complete 6 self-paced modules</div>
        </div>
        <div class="flow-step ${store.isComplete(5) ? 'done' : ''}">
          <div class="flow-num">STEP 03</div>
          <div class="flow-name">Practice</div>
          <div class="flow-desc">Submit coaching practicum session</div>
        </div>
        <div class="flow-step">
          <div class="flow-num">STEP 04</div>
          <div class="flow-name">Review</div>
          <div class="flow-desc">Assessment by Anthony Brown</div>
        </div>
        <div class="flow-step ${done === total ? 'done' : ''}">
          <div class="flow-num">STEP 05</div>
          <div class="flow-name">Certify</div>
          <div class="flow-desc">Credential issued + announced</div>
        </div>
      </div>
    </div>
  `;
}

function renderModule1() {
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">MODULE 01</span>
        <span class="divider"></span>
        <span class="pillar-name">Pillar 1 — Lead Yourself</span>
      </div>
      <div class="module-title">REDEFINING<br><span>LEADERSHIP</span><br>SUCCESS</div>
      <p class="module-desc">Before you can coach anyone else toward a better version of leadership, you have to confront and rebuild what you believe leadership actually means. This is where it starts.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 45 minutes</div>
        <div class="meta-item"><div class="meta-dot"></div> 3 reflections</div>
        <div class="meta-item"><div class="meta-dot"></div> 1 workbook exercise</div>
      </div>
    </div>
    ${completionBanner(1)}
    <div class="lesson-block">
      <h2>The Problem with Traditional Leadership</h2>
      <p>Most people who step into leadership roles were never actually taught how to lead. They were promoted because they were good at their previous job — high performer, dependable employee, top salesperson. And then they were handed a team and expected to figure it out.</p>
      <p>The result is a massive gap between people who hold leadership titles and people who actually lead. Title and authority are not the same as influence and impact. One Percent leadership starts by closing that gap.</p>
      <div class="callout">
        <div class="callout-label">Core Principle</div>
        <p>Leadership is not a title. It is a daily decision to invest in the growth of the people around you, even when — especially when — it is inconvenient.</p>
      </div>
    </div>
    <div class="lesson-block">
      <h2>The 1% Definition of Leadership Success</h2>
      <p>At The One Percent Nation, we define leadership success differently. It is not about your team's output metrics alone. It is about whether the people you lead are clearer, more capable, and more aligned to their purpose because of their time under your leadership.</p>
      <p>Rich looks different here. A team that has low turnover, high trust, and consistent growth is a successful team — whether or not they are the top performers in the organization. Sustainable performance is built on aligned people, not pressure.</p>
      <ul class="key-list">
        <li>Leadership success is measured in alignment, not just results</li>
        <li>People perform best when they feel seen, valued, and growing</li>
        <li>Your ceiling as a leader is determined by your investment in others</li>
        <li>The goal is 1% better every day — in you and in your team</li>
      </ul>
    </div>
    <div class="divider-line"></div>
    <div class="lesson-block">
      <h2>Defining Success on Your Own Terms</h2>
      <p>One of the most powerful things The One Percent teaches is that success is subjective. The same principle applies to leadership. Before you can coach others toward their version of leadership success, you need to get clear on what yours is.</p>
      <p>Too many leaders are chasing someone else's definition — the CEO who is never home, the manager who rules by fear, the executive who measures everything in dollars. That is not your model unless you decided it consciously.</p>
    </div>
    <div class="exercise">
      <div class="exercise-header">
        <span class="exercise-badge">Reflection Exercise</span>
        <span class="exercise-title">Your Leadership Definition</span>
      </div>
      <p>Take 10 minutes to answer the following questions honestly. There are no correct answers — only yours.</p>
      <ul class="exercise-questions">
        <li data-n="01">What does leadership success look like for you — not what you've been told, but what you actually believe?</li>
        <li data-n="02">What kind of leader did you have at your best? What made them memorable?</li>
        <li data-n="03">What leadership behavior do you most want to eliminate from your own practice?</li>
        <li data-n="04">If the people you lead described you in five words, what would you want those words to be?</li>
      </ul>
      ${notesField('m1', 'Write your reflections here. These are saved for your reference...')}
    </div>
    <div class="quote-block">
      <div class="quote-text">"The real 1%? They're the ones brave enough to live — and lead — on their own terms."</div>
      <div class="quote-attr">— The One Percent Nation</div>
    </div>
  `;
}

function renderModule2() {
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">MODULE 02</span>
        <span class="divider"></span>
        <span class="pillar-name">Pillar 1 — Lead Yourself</span>
      </div>
      <div class="module-title">MINDSET<br><span>MASTERY</span><br>FOR LEADERS</div>
      <p class="module-desc">Every limiting belief you carry as a leader gets amplified through your team. The I Can't framework doesn't just apply to individuals — it runs through entire organizations.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 50 minutes</div>
        <div class="meta-item"><div class="meta-dot"></div> 4 reflections</div>
      </div>
    </div>
    ${completionBanner(2)}
    <div class="lesson-block">
      <h2>The "I Can't" Framework in Leadership</h2>
      <p>The I Can't framework identifies the internal stories, fears, and patterns that prevent people from moving forward. As a leader, those same stories operate in you — and they show up in how you communicate, delegate, respond to pressure, and invest in your team.</p>
      <p>A leader who believes "I can't trust people to do this without me" creates a micromanaged team. A leader who believes "I can't show weakness" creates a team that never admits problems until they are crises. Your beliefs shape your environment whether you intend them to or not.</p>
      <div class="callout">
        <div class="callout-label">Key Insight</div>
        <p>Limiting beliefs in leaders don't just affect the leader. They ripple through every person that leader has authority over. Doing your mindset work is not optional — it is the most important leadership work you can do.</p>
      </div>
    </div>
    <div class="lesson-block">
      <h2>The Five Most Common Leadership Limiting Beliefs</h2>
      <div class="framework-grid">
        <div class="framework-card">
          <div class="fc-icon">🔒</div>
          <div class="fc-title">"I can't show weakness"</div>
          <div class="fc-desc">Creates cultures of silence where real problems hide until it's too late.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">⚙️</div>
          <div class="fc-title">"I can't let go of control"</div>
          <div class="fc-desc">Kills delegation, burns out the leader, and stunts team development.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">⏱️</div>
          <div class="fc-title">"I don't have time to coach"</div>
          <div class="fc-desc">The belief that costs the most time in the long run. Invest now or pay later.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">📊</div>
          <div class="fc-title">"Results matter more than people"</div>
          <div class="fc-desc">Short-term wins, long-term turnover. The math never works out.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">🪞</div>
          <div class="fc-title">"I wasn't trained for this"</div>
          <div class="fc-desc">True — but that's exactly why you're here. Leadership is learned, not inherited.</div>
        </div>
      </div>
    </div>
    <div class="divider-line"></div>
    <div class="exercise">
      <div class="exercise-header">
        <span class="exercise-badge">Reflection Exercise</span>
        <span class="exercise-title">Your Leadership Limiting Beliefs</span>
      </div>
      <p>Identify the beliefs that are currently limiting your effectiveness as a leader. Be specific — vague answers protect the belief.</p>
      <ul class="exercise-questions">
        <li data-n="01">What is the "I Can't" story you tell yourself most often as a leader?</li>
        <li data-n="02">Where did that belief come from? What experience reinforced it?</li>
        <li data-n="03">What has this belief cost you and your team in the last 90 days?</li>
        <li data-n="04">What would leadership look like if you operated as if that belief was false?</li>
      </ul>
      ${notesField('m2', 'Your reflections here...')}
    </div>
  `;
}

function renderModule3() {
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">MODULE 03</span>
        <span class="divider"></span>
        <span class="pillar-name">Pillar 2 — Lead Others</span>
      </div>
      <div class="module-title">THE COACHING<br><span>CONVERSATION</span></div>
      <p class="module-desc">This is the technical core of the certification. Coaching is not consulting, mentoring, or advising. It is a disciplined practice of creating the conditions for someone to discover their own clarity and take ownership of their own growth.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 55 minutes</div>
        <div class="meta-item"><div class="meta-dot"></div> Session framework</div>
        <div class="meta-item"><div class="meta-dot"></div> 25 powerful questions</div>
      </div>
    </div>
    ${completionBanner(3)}
    <div class="lesson-block">
      <h2>Coaching vs. Managing vs. Advising</h2>
      <p>Most people who call themselves coaches are actually advisers. They listen briefly, then tell the person what to do. This creates dependency — the person keeps coming back for answers instead of developing their own capacity to find them.</p>
      <p>A 1P-certified coach holds the space for the person to find their own answer. Your job is not to fix — it is to ask the right question at the right moment and let the person do the real work.</p>
      <div class="framework-grid">
        <div class="framework-card">
          <div class="fc-icon">📋</div>
          <div class="fc-title">Managing</div>
          <div class="fc-desc">Directing tasks and measuring output. Necessary but not sufficient for growth.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">💬</div>
          <div class="fc-title">Advising</div>
          <div class="fc-desc">"Here's what I would do." Efficient for quick decisions, builds dependency over time.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">🎯</div>
          <div class="fc-title">Coaching</div>
          <div class="fc-desc">"What do YOU think you should do?" Slower at first. Builds lasting capability.</div>
        </div>
      </div>
    </div>
    <div class="lesson-block">
      <h2>The 1P Coaching Session Structure</h2>
      <ul class="key-list">
        <li><strong style="color:var(--white)">Open (5 min):</strong> What is most important to focus on today? Let them set the agenda.</li>
        <li><strong style="color:var(--white)">Explore (20 min):</strong> Ask powerful questions. Listen more than you speak. Reflect what you hear.</li>
        <li><strong style="color:var(--white)">Clarify (10 min):</strong> What are the real blockers? What is the next right move from their perspective?</li>
        <li><strong style="color:var(--white)">Commit (5 min):</strong> What is one specific action they will take before the next session?</li>
        <li><strong style="color:var(--white)">Close (5 min):</strong> What was most valuable about today? What shifted?</li>
      </ul>
    </div>
    <div class="divider-line"></div>
    <div class="lesson-block">
      <h2>25 Powerful Coaching Questions</h2>
      <p>A coaching question creates space. It cannot be answered with yes or no. It invites reflection rather than a performance answer. These are your tools.</p>
      <ul class="key-list">
        <li>What is actually going on here beneath the surface?</li>
        <li>What would you do if you knew you couldn't fail?</li>
        <li>What are you tolerating that you should not be?</li>
        <li>What does success look like one year from now?</li>
        <li>What is the story you keep telling yourself about this?</li>
        <li>What is the cost of staying exactly where you are?</li>
        <li>What would the best version of you do right now?</li>
        <li>What support do you need that you haven't asked for?</li>
        <li>Where are you getting in your own way?</li>
        <li>What would change if you stopped waiting for permission?</li>
      </ul>
    </div>
    <div class="exercise">
      <div class="exercise-header">
        <span class="exercise-badge">Practice Exercise</span>
        <span class="exercise-title">Session Script Prep</span>
      </div>
      <p>Write a full opening for a coaching session. Include your opening check-in question, two follow-up questions based on a hypothetical response, and your closing commitment question.</p>
      ${notesField('m3', 'Write your practice session script here...', '140px')}
    </div>
  `;
}

function renderModule4() {
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">MODULE 04</span>
        <span class="divider"></span>
        <span class="pillar-name">Pillar 2 — Lead Others</span>
      </div>
      <div class="module-title">ACCOUNTABILITY<br><span>FRAMEWORKS</span><br>THAT WORK</div>
      <p class="module-desc">The gap between goal-setting and follow-through is where most leadership breaks down. This module gives you the system to close that gap without creating fear, resentment, or micromanagement.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 50 minutes</div>
        <div class="meta-item"><div class="meta-dot"></div> 3 frameworks</div>
      </div>
    </div>
    ${completionBanner(4)}
    <div class="lesson-block">
      <h2>Why Accountability Fails</h2>
      <p>Most accountability systems fail for one of three reasons: the goal was never truly owned by the person, there is no clear structure for follow-up, or the leader only shows up when things go wrong. Accountability practiced this way feels like surveillance. It creates anxiety, not ownership.</p>
      <p>True accountability is a relational contract — both parties agree on the standard, both parties track progress, and the leader shows up consistently regardless of whether things are going well or not.</p>
      <div class="callout">
        <div class="callout-label">The 1P Standard</div>
        <p>Accountability is not what you demand from people. It is what you model. If you hold yourself to the same standard you expect from others, accountability becomes culture rather than policy.</p>
      </div>
    </div>
    <div class="lesson-block">
      <h2>The Goal Architecture Framework</h2>
      <div class="framework-grid">
        <div class="framework-card">
          <div class="fc-icon">🎯</div>
          <div class="fc-title">Outcome goal</div>
          <div class="fc-desc">The measurable result. Specific, time-bound, and owned by the individual.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">⚡</div>
          <div class="fc-title">Process goals</div>
          <div class="fc-desc">The daily and weekly actions that produce the outcome. These are what you track.</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">🔄</div>
          <div class="fc-title">Review cadence</div>
          <div class="fc-desc">Weekly check-in on process. Monthly review of outcome progress. Quarterly recalibration.</div>
        </div>
      </div>
    </div>
    <div class="divider-line"></div>
    <div class="exercise">
      <div class="exercise-header">
        <span class="exercise-badge">Application Exercise</span>
        <span class="exercise-title">Build an Accountability Structure</span>
      </div>
      <p>Choose one person you currently lead or will coach. Build a full accountability structure for them using the framework above. Include the outcome goal, three process goals, and your review cadence.</p>
      <ul class="exercise-questions">
        <li data-n="01">What is their specific outcome goal and deadline?</li>
        <li data-n="02">What are the three weekly process behaviors that will produce that outcome?</li>
        <li data-n="03">How will you track progress without micromanaging?</li>
        <li data-n="04">What is your check-in question at the start of each weekly review?</li>
      </ul>
      ${notesField('m4', 'Build the accountability structure here...')}
    </div>
  `;
}

function renderModule5() {
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">MODULE 05</span>
        <span class="divider"></span>
        <span class="pillar-name">Pillar 3 — Lead with Purpose</span>
      </div>
      <div class="module-title">CULTURE,<br><span>VISION</span><br>& VALUES</div>
      <p class="module-desc">Culture is not a values statement on a wall. It is the aggregate of every decision every leader makes every day. You do not declare culture — you build it, one interaction at a time.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 55 minutes</div>
        <div class="meta-item"><div class="meta-dot"></div> Vision framework</div>
        <div class="meta-item"><div class="meta-dot"></div> Culture audit tool</div>
      </div>
    </div>
    ${completionBanner(5)}
    <div class="lesson-block">
      <h2>What Culture Actually Is</h2>
      <p>Culture is the answer to: what do we reward, what do we tolerate, and what do we celebrate? Those three answers — not your mission statement — define the actual culture your team lives in every day.</p>
      <p>A 1P-certified leader takes ownership of all three. If you reward hustle but tolerate burnout, your culture is unsustainable. If you celebrate results but ignore the process that got there, you are building a team that will eventually self-destruct.</p>
    </div>
    <div class="lesson-block">
      <h2>Vision-Casting That Activates People</h2>
      <p>Most leaders present vision as information. "Here is where we are going." That lands as a task, not an invitation. Vision that activates people connects the organizational goal to the individual's personal purpose.</p>
      <p>The question is not just "where are we going" — it is "why should you personally care that we get there?" When a leader can answer both, the team moves together.</p>
      <ul class="key-list">
        <li>State the direction clearly — no ambiguity about the destination</li>
        <li>Connect the destination to the team's existing values and strengths</li>
        <li>Name specifically what each person's contribution to the vision is</li>
        <li>Revisit the vision consistently — once is not enough</li>
      </ul>
      <div class="callout">
        <div class="callout-label">The 1P Vision Standard</div>
        <p>Your vision should answer this: "We are building __ so that __ can __, and the world is better because __." If you cannot fill that in, your vision is not ready to share.</p>
      </div>
    </div>
    <div class="divider-line"></div>
    <div class="exercise">
      <div class="exercise-header">
        <span class="exercise-badge">Culture Audit</span>
        <span class="exercise-title">What Does Your Team's Culture Reward, Tolerate, and Celebrate?</span>
      </div>
      <p>Be honest. This is private and for your growth only. The insights here will directly shape how you coach others on culture.</p>
      <ul class="exercise-questions">
        <li data-n="01">What behaviors does your current team or organization reward? Are those the behaviors you actually want?</li>
        <li data-n="02">What behaviors are being tolerated right now that should not be?</li>
        <li data-n="03">What does the team celebrate? What does that reveal about what is actually valued?</li>
        <li data-n="04">Complete the vision statement: "We are building ___ so that ___ can ___, and the world is better because ___."</li>
      </ul>
      ${notesField('m5', 'Your culture audit here...')}
    </div>
  `;
}

function renderCapstone() {
  return `
    <div class="module-header">
      <div class="module-eyebrow">
        <span class="num">MODULE 06</span>
        <span class="divider"></span>
        <span class="pillar-name">Certification Capstone</span>
      </div>
      <div class="module-title">LIVE COACHING<br><span>PRACTICUM</span></div>
      <p class="module-desc">This is where certification is earned, not granted. You will conduct a real coaching session, demonstrate command of the frameworks, and be assessed for certification by Anthony Brown.</p>
      <div class="module-meta">
        <div class="meta-item"><div class="meta-dot"></div> 90 minutes</div>
        <div class="meta-item"><div class="meta-dot"></div> Live or recorded</div>
        <div class="meta-item"><div class="meta-dot"></div> Anthony reviews</div>
      </div>
    </div>
    ${store.isComplete(6) ? '<div class="completion-banner"><h3>✓ Capstone Submitted — Awaiting Review</h3><p>Your submission is in. Anthony will review your practicum and issue your certification within 5 business days.</p></div>' : ''}
    <div class="lesson-block">
      <h2>Practicum Requirements</h2>
      <p>To complete the 1P-CLC Capstone, you must conduct a minimum 30-minute coaching session with a real person (not a friend roleplaying). The session must be recorded with the subject's consent, or conducted live in front of Anthony during a scheduled review call.</p>
      <ul class="key-list">
        <li>Minimum 30-minute session with a real coaching subject</li>
        <li>Must follow the 1P Coaching Session Structure from Module 3</li>
        <li>Must demonstrate use of at least 5 powerful questions from the question bank</li>
        <li>Must not slip into advising, fixing, or problem-solving mode</li>
        <li>A brief written reflection (300+ words) submitted with the recording</li>
      </ul>
    </div>
    <div class="lesson-block">
      <h2>Practicum Assessment Rubric</h2>
      <div class="framework-grid">
        <div class="framework-card">
          <div class="fc-icon">🎙️</div>
          <div class="fc-title">Presence & Listening</div>
          <div class="fc-desc">Did the coach listen more than they spoke? Were they fully present or distracted?</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">❓</div>
          <div class="fc-title">Question Quality</div>
          <div class="fc-desc">Were the questions open, powerful, and non-leading? Did they create real exploration?</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">🧱</div>
          <div class="fc-title">Session Structure</div>
          <div class="fc-desc">Was the 1P framework followed? Did the session have a clear arc with a commitment close?</div>
        </div>
        <div class="framework-card">
          <div class="fc-icon">🛑</div>
          <div class="fc-title">Non-Advising</div>
          <div class="fc-desc">Did the coach resist the urge to fix, solve, or advise? Was the client doing the work?</div>
        </div>
      </div>
    </div>
    <div class="divider-line"></div>
    <div class="exercise">
      <div class="exercise-header">
        <span class="exercise-badge">Submission</span>
        <span class="exercise-title">Practicum Reflection (Required — 300+ words)</span>
      </div>
      <p>After completing your coaching session, write your reflection below. Include what went well, where you struggled, what you would do differently, and what the experience revealed about you as a coach.</p>
      ${notesField('m6', 'Write your 300+ word practicum reflection here. This is submitted alongside your recording for Anthony\'s review...', '200px')}
    </div>
    <div class="callout">
      <div class="callout-label">Ready to Submit?</div>
      <p>Email your recording link and this reflection to certify@theonepercentnation.com with subject line: "1P-CLC Capstone Submission — [Your Name]". Anthony will review within 5 business days and reach out with your certification status.</p>
    </div>
  `;
}

export const MODULES = [
  { id: 0, title: 'Program Overview', subtitle: 'Your certification roadmap', pillar: 'Start Here', pillarTag: '', duration: '10 min', tag: 'tag-all', tagLabel: 'INTRO', render: renderOverview },
  { id: 1, title: 'Redefining Leadership Success', subtitle: 'The foundation module', pillar: 'Pillar 1 — Lead Yourself', pillarTag: 'P1', duration: '45 min', tag: 'tag-p1', tagLabel: 'P1', render: renderModule1 },
  { id: 2, title: 'Mindset Mastery for Leaders', subtitle: "The I Can't framework applied", pillar: 'Pillar 1 — Lead Yourself', pillarTag: 'P1', duration: '50 min', tag: 'tag-p1', tagLabel: 'P1', render: renderModule2 },
  { id: 3, title: 'The Coaching Conversation', subtitle: 'Frameworks + session structure', pillar: 'Pillar 2 — Lead Others', pillarTag: 'P2', duration: '55 min', tag: 'tag-p2', tagLabel: 'P2', render: renderModule3 },
  { id: 4, title: 'Accountability That Works', subtitle: 'Goal architecture + follow-through', pillar: 'Pillar 2 — Lead Others', pillarTag: 'P2', duration: '50 min', tag: 'tag-p2', tagLabel: 'P2', render: renderModule4 },
  { id: 5, title: 'Culture, Vision & Values', subtitle: 'Building purpose-aligned teams', pillar: 'Pillar 3 — Lead with Purpose', pillarTag: 'P3', duration: '55 min', tag: 'tag-p3', tagLabel: 'P3', render: renderModule5 },
  { id: 6, title: 'Certification Capstone', subtitle: 'Live coaching practicum', pillar: 'Pillar 3 — Lead with Purpose', pillarTag: 'P3', duration: '90 min', tag: 'tag-all', tagLabel: 'CAP', render: renderCapstone }
];

export const PILLARS = [
  { label: 'Introduction', ids: [0] },
  { label: 'Pillar 1 — Lead Yourself', ids: [1, 2] },
  { label: 'Pillar 2 — Lead Others', ids: [3, 4] },
  { label: 'Pillar 3 — Lead with Purpose', ids: [5, 6] }
];
