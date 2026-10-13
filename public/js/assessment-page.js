// /assessments/<slug> — runs one free assessment.
//
// The funnel: take it with no account → see the headline result → create a
// free portal account to unlock the full report → the result is saved to the
// portal and the CRM (submitAssessment). Answers live in localStorage until
// then, so a visitor who goes off to log in comes back to their result rather
// than a blank quiz.
import { getAssessment } from './assessments-data.js';
import {
  SCALE, PROFILE_QUESTIONS, scoreAssessment, headlineFor, isPriorityLead, cleanProfile
} from './assessment-core.js';
import { onAuthReady, signupEmail, loginGoogle } from './auth.js';
import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const track = (name, params) => {
  try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) { /* analytics never breaks the page */ }
  try { if (typeof fbq === 'function' && params && params.fb) fbq('track', params.fb, { content_name: params.assessment }); } catch (e) { /* optional */ }
};

// ── Which assessment ───────────────────────────────────────────────────────
const fromPath = location.pathname.replace(/\/+$/, '').split('/').pop();
const slug = /^assessments?$/.test(fromPath) || fromPath === 'assessment.html'
  ? new URLSearchParams(location.search).get('a')
  : fromPath;
const def = getAssessment(slug);

// ── Campaign attribution (first touch this session) ────────────────────────
function utm() {
  const KEY = '1p-utm';
  const p = new URLSearchParams(location.search);
  const fresh = { source: p.get('utm_source'), medium: p.get('utm_medium'), campaign: p.get('utm_campaign') };
  try {
    if (fresh.source || fresh.campaign) sessionStorage.setItem(KEY, JSON.stringify(fresh));
    return JSON.parse(sessionStorage.getItem(KEY) || 'null') || fresh;
  } catch (e) { return fresh; }
}

// ── Saved progress ─────────────────────────────────────────────────────────
const STORE = '1p-assess:' + slug;
function load() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null') || {}; } catch (e) { return {}; }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* private mode: progress just isn't kept */ }
}
let state = Object.assign({ answers: {}, profile: {}, index: 0, finished: false }, load());

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.id === id));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

// ── Intro ──────────────────────────────────────────────────────────────────
function renderIntro() {
  const resume = !state.finished && Object.keys(state.answers).length > 0;
  const points = def.mode === 'profile'
    ? ['<b>Your result:</b> the type that fits you best, and what it means.', '<b>Your full profile</b> across every type.', '<b>Three actions</b> to start this week.']
    : ['<b>Your score</b> out of 100, and what it means.', '<b>Your breakdown</b> across ' + def.dimensions.length + ' areas, with your weakest one named.', '<b>Three actions</b> to start this week.'];
  $('s-intro').innerHTML = `
    <div class="eyebrow">Free assessment</div>
    <h1 class="display">${esc(def.title)}</h1>
    <p class="hook">${esc(def.hook)}</p>
    <p class="lead">${esc(def.intro || def.short)}</p>
    <div class="intro-meta">
      <span class="pill">${def.questions.length} statements</span>
      <span class="pill">${def.minutes} minutes</span>
      <span class="pill">Free</span>
    </div>
    <ul class="intro-list">${points.map((p) => `<li><span>${p}</span></li>`).join('')}</ul>
    <button class="btn btn-red btn-block" type="button" id="start">${resume ? 'Pick up where you left off' : 'Start the assessment'}</button>
    ${resume ? '<div style="text-align:center;margin-top:10px;"><button class="text-btn" type="button" id="restart">Start over</button></div>' : ''}
    ${def.disclaimer ? `<p class="disclaimer">${esc(def.disclaimer)}</p>` : ''}`;
  $('start').addEventListener('click', () => {
    if (!resume) { state = { answers: {}, profile: {}, index: 0, finished: false }; save(); }
    track('assessment_start', { assessment: slug });
    renderQuestion();
    show('s-quiz');
  });
  const r = $('restart');
  if (r) r.addEventListener('click', () => { state = { answers: {}, profile: {}, index: 0, finished: false }; save(); renderIntro(); });
}

// ── Questions ──────────────────────────────────────────────────────────────
let advancing = null;
function renderQuestion() {
  const i = Math.min(state.index, def.questions.length - 1);
  const q = def.questions[i];
  $('q-count').textContent = `Statement ${i + 1} of ${def.questions.length}`;
  $('q-bar').style.width = `${(i / def.questions.length) * 100}%`;
  $('q-text').textContent = q.text;
  $('q-scale').innerHTML = SCALE.map((s) =>
    `<button type="button" data-v="${s.value}" aria-pressed="${state.answers[i] === s.value}"><kbd>${s.value}</kbd>${esc(s.label)}</button>`).join('');
  $('q-scale').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.v))));
  $('q-back').style.visibility = i === 0 ? 'hidden' : 'visible';
}

function answer(v) {
  const i = state.index;
  state.answers[i] = v;
  save();
  $('q-scale').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v)));
  clearTimeout(advancing);
  advancing = setTimeout(() => {
    if (i + 1 < def.questions.length) {
      state.index = i + 1;
      save();
      renderQuestion();
    } else {
      $('q-bar').style.width = '100%';
      renderProfile();
      show('s-profile');
    }
  }, 220);
}

$('q-back').addEventListener('click', () => {
  clearTimeout(advancing);
  if (state.index > 0) { state.index -= 1; save(); renderQuestion(); }
});

document.addEventListener('keydown', (e) => {
  if (!$('s-quiz').classList.contains('on') || e.metaKey || e.ctrlKey || e.altKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= 5) answer(n);
  if (e.key === 'Backspace' || e.key === 'ArrowLeft') $('q-back').click();
});

// ── Profile ────────────────────────────────────────────────────────────────
function renderProfile() {
  $('prof-qs').innerHTML = PROFILE_QUESTIONS.map((pq) => `
    <div class="prof-q">
      <h3>${esc(pq.text)}</h3>
      <div class="opts" data-key="${pq.key}">${pq.options.map((o) =>
        `<button type="button" data-v="${o.value}" aria-pressed="${state.profile[pq.key] === o.value}">${esc(o.label)}</button>`).join('')}</div>
    </div>`).join('');
  $('prof-qs').querySelectorAll('.opts').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.profile[group.dataset.key] = b.dataset.v;
      save();
      group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
  });
}

$('prof-go').addEventListener('click', () => {
  state.finished = true;
  save();
  const r = scoreAssessment(def, state.answers);
  track('assessment_complete', { assessment: slug, score: r.overall, result: headlineFor(def, r) });
  showResult();
});

// ── Result ─────────────────────────────────────────────────────────────────
let unlocked = false;
let savedOnce = false;

async function showResult() {
  const user = await onAuthReady();
  if (user) return unlock(user);
  renderTeaser();
  show('s-result');
}

function resultHead(r) {
  if (def.mode === 'profile') {
    const d = def.dimensions.find((x) => x.key === r.profileType);
    return `<div class="res-top">
      <div class="eyebrow">Your result</div>
      <h1 class="display res-label">${esc(d.headline)}</h1>
      <p class="res-summary">${esc(d.summary)}</p>
    </div>`;
  }
  return `<div class="res-top">
    <div class="eyebrow">Your result</div>
    <div class="ring" style="--p:${r.overall}"><div><b>${r.overall}</b><small>OUT OF 100</small></div></div>
    <h1 class="display res-label">You are <span>${esc(r.band.label)}</span></h1>
    <p class="res-summary">${esc(r.band.summary)}</p>
  </div>`;
}

function bars(r) {
  const sorted = r.dims.slice().sort((a, b) => b.score - a.score);
  return `<div class="bars">${sorted.map((d) => {
    const cls = d.key === r.lowest && def.mode === 'score' ? 'low' : (d.key === r.highest ? 'top' : '');
    return `<div class="bar-row ${cls}"><div class="bar-head"><span>${esc(d.label)}</span><b>${d.score}</b></div><div class="bar"><i style="width:${Math.max(d.score, 3)}%"></i></div></div>`;
  }).join('')}</div>`;
}

function renderTeaser() {
  const r = scoreAssessment(def, state.answers);
  const focus = def.dimensions.find((d) => d.key === (def.mode === 'profile' ? r.profileType : r.lowest));
  const next = `/assessments/${slug}?unlock=1`;
  $('s-result').innerHTML = `
    ${resultHead(r)}
    <div class="locked">
      <div class="preview" aria-hidden="true">
        <div class="panel"><h3>Your breakdown</h3>${bars(r)}</div>
        <div class="panel spot"><h3>${def.mode === 'profile' ? 'Living it out' : 'Start here'}: ${esc(focus ? focus.label : '')}</h3><ol class="actions"><li>Your first action</li><li>Your second action</li><li>Your third action</li></ol></div>
      </div>
      <div class="unlock">
        <div class="eyebrow">Your full report is ready</div>
        <h2 class="display">Unlock it free.</h2>
        <p class="sub">Create your free One Percent account to see the rest and keep it in your member portal.</p>
        <ul>
          <li>Your score in all ${def.dimensions.length} areas</li>
          <li>${def.mode === 'profile' ? 'What your result means and its blind spot' : 'The one area to fix first, named'}</li>
          <li>Three specific actions to start this week</li>
          <li>Every other free assessment, plus your results saved in one place</li>
        </ul>
        <form class="form" id="unlock-form" novalidate>
          <label for="u-name">First and last name</label>
          <input id="u-name" autocomplete="name" required>
          <label for="u-email">Email</label>
          <input id="u-email" type="email" autocomplete="email" required>
          <label for="u-pass">Create a password (8+ characters)</label>
          <input id="u-pass" type="password" autocomplete="new-password" minlength="8" required>
          <div class="form-msg" id="u-msg" role="status" aria-live="polite"></div>
          <button class="btn btn-red btn-block" type="submit" id="u-go">Unlock my full report</button>
          <div class="or">OR</div>
          <button class="btn btn-white btn-block" type="button" id="u-google">Continue with Google</button>
        </form>
        <p class="fine">Already a member? <a href="/login?next=${encodeURIComponent(next)}">Log in to see your report</a>. Free, no card needed. By creating an account you agree to our <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</p>
      </div>
    </div>`;

  const msg = (t) => { $('u-msg').textContent = t || ''; $('u-msg').className = 'form-msg' + (t ? ' err' : ''); };
  if (!firebaseReady) msg('Accounts are unavailable right now. Check your connection and refresh.');

  $('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg('');
    const displayName = $('u-name').value.trim();
    const email = $('u-email').value.trim();
    const password = $('u-pass').value;
    if (!displayName) return msg('Please enter your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg('Please enter a valid email.');
    if (password.length < 8) return msg('Your password needs at least 8 characters.');
    $('u-go').disabled = true;
    try {
      const user = await signupEmail({ email, password, displayName });
      track('sign_up', { method: 'email', assessment: slug, fb: 'CompleteRegistration' });
      await unlock(user);
    } catch (err) {
      const code = err && err.code;
      if (code === 'auth/email-already-in-use') {
        msg('You already have an account with that email. Use "Log in" below and your report will be waiting.');
      } else if (code === 'auth/weak-password') {
        msg('Please choose a stronger password.');
      } else {
        msg((err && err.message) || 'Something went wrong. Please try again.');
      }
    } finally {
      const b = $('u-go'); if (b) b.disabled = false;
    }
  });

  $('u-google').addEventListener('click', async () => {
    msg('');
    try {
      const user = await loginGoogle();
      track('sign_up', { method: 'google', assessment: slug, fb: 'CompleteRegistration' });
      await unlock(user);
    } catch (err) {
      if (err && err.code === 'auth/popup-closed-by-user') return;
      msg((err && err.message) || 'Google sign-in did not complete.');
    }
  });
}

async function unlock(user) {
  if (unlocked) return;
  unlocked = true;
  const r = scoreAssessment(def, state.answers);
  const profile = cleanProfile(state.profile);
  renderFull(r, profile, 'saving');
  show('s-result');
  track('assessment_unlocked', { assessment: slug, fb: 'Lead' });
  // Coming back to a result that is already saved (a refresh, or returning
  // from login) shows it without writing it, and its CRM activity, again.
  if (savedOnce || state.savedFor === user.uid) {
    setSaved('Saved to your member portal');
    return;
  }
  savedOnce = true;
  try {
    const dims = {};
    r.dims.forEach((d) => { dims[d.key] = d.score; });
    await httpsCallable(functions, 'submitAssessment')({
      slug,
      score: r.overall,
      label: headlineFor(def, r),
      dims,
      highest: r.highest,
      lowest: r.lowest,
      profile,
      utm: utm()
    });
    state.savedFor = user.uid;
    save();
    setSaved('Saved to your member portal');
  } catch (e) {
    savedOnce = false;
    console.warn('[assessment] save failed', e && e.message);
    setSaved('Your report is below. We could not save it to your portal this time.');
  }
}

function setSaved(text) {
  const el = $('saved');
  if (el) el.textContent = text;
}

function renderFull(r, profile, status) {
  const isProfile = def.mode === 'profile';
  const focusKey = isProfile ? r.profileType : r.lowest;
  const focus = def.dimensions.find((d) => d.key === focusKey);
  const others = def.dimensions.filter((d) => d.key !== focusKey);
  const priority = isPriorityLead(profile);
  const related = (def.related || []).map(getAssessment).filter(Boolean);

  const auditPanel = priority && (!def.cta || def.cta.href !== '/corporate#audit')
    ? `<div class="panel cta-panel">
        <div class="eyebrow">For leaders</div>
        <h3>Your team is likely feeling this too.</h3>
        <p>Anthony offers a free 45-minute Alignment Audit for leaders, with a one-page written scorecard within 48 hours.</p>
        <a class="btn btn-red" href="/corporate#audit">Request an Alignment Audit</a>
      </div>` : '';

  const ctaPanel = def.cta
    ? `<div class="panel cta-panel">
        <div class="eyebrow">Your next step</div>
        <h3>Want help closing the gap?</h3>
        <p>${isProfile ? 'Knowing your pattern is the start. Building around it is where things change.' : 'Clarity is step one. Execution is where your score moves.'}</p>
        <a class="btn ${auditPanel ? 'btn-ghost' : 'btn-red'}" href="${esc(def.cta.href)}">${esc(def.cta.label)}</a>
      </div>` : '';

  $('s-result').innerHTML = `
    ${resultHead(r)}
    <div style="text-align:center;"><span class="saved" id="saved">${status === 'saving' ? 'Saving to your portal…' : ''}</span></div>

    <div class="panel spot">
      <div class="eyebrow">${isProfile ? 'Living it out' : 'Start here'}</div>
      <h3>${esc(focus.label)}</h3>
      <p class="muted">${esc(focus.desc)}</p>
      <ol class="actions">${focus.actions.map((a) => `<li><span>${esc(a)}</span></li>`).join('')}</ol>
    </div>

    ${def.prompt ? `<div class="panel"><div class="eyebrow">Write your why</div><p class="why-prompt">${esc(def.prompt)}</p><p class="muted" style="margin-top:10px;">Fill it in tonight. Keep it where you will see it tomorrow morning.</p></div>` : ''}

    <div class="panel">
      <h3>${isProfile ? 'Your full profile' : 'Your breakdown'}</h3>
      ${bars(r)}
    </div>

    <div class="panel">
      <h3>${isProfile ? 'The other types' : 'Every area, with actions'}</h3>
      ${others.map((d) => `<details class="dim">
        <summary><span>${esc(isProfile ? d.headline : d.label)}</span></summary>
        <p>${esc(isProfile ? d.summary : d.desc)}</p>
        <ol class="actions">${d.actions.map((a) => `<li><span>${esc(a)}</span></li>`).join('')}</ol>
      </details>`).join('')}
    </div>

    ${auditPanel}
    ${ctaPanel}

    ${related.length ? `<div class="panel"><h3>Take another</h3><div class="related">${related.map((a) =>
      `<a href="/assessments/${a.slug}"><b>${esc(a.title)}</b><span>${esc(a.hook)}</span></a>`).join('')}</div></div>` : ''}

    ${def.disclaimer ? `<p class="disclaimer">${esc(def.disclaimer)}</p>` : ''}

    <div class="res-actions">
      <a class="btn btn-red" href="/dashboard">Go to my portal</a>
      <a class="btn btn-ghost" href="/assessments">All assessments</a>
      <button class="btn btn-ghost" type="button" id="retake">Retake</button>
    </div>`;

  $('retake').addEventListener('click', () => {
    state = { answers: {}, profile: {}, index: 0, finished: false };
    save();
    unlocked = false;
    savedOnce = false;
    renderIntro();
    show('s-intro');
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────
if (!def) {
  show('s-missing');
} else {
  document.title = `${def.title} | Free Assessment | The One Percent Nation`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', `${def.hook} ${def.short}`);
  utm();
  track('assessment_view', { assessment: slug });
  renderIntro();
  const complete = scoreAssessment(def, state.answers).complete;
  if (state.finished && complete) {
    showResult();
  } else {
    show('s-intro');
  }
}
