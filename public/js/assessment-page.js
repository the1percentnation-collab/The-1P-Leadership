// /assessments/<slug> — runs one free assessment.
//
// The funnel: take it with no account → see the headline result → create a
// free portal account to unlock the full report → the result is saved to the
// portal and the CRM (submitAssessment). Answers live in localStorage until
// then, so a visitor who goes off to log in comes back to their result rather
// than a blank quiz.
import { getAssessment } from './assessments-data.js';
import {
  SCALE, PROFILE_QUESTIONS, LEVELS, scoreAssessment, headlineFor, buildReport, bandFor, suggestEmail,
  readingOf, levelLabelFor, toneFor, howToRead,
  isPriorityLead, cleanProfile
} from './assessment-core.js';
import { onAuthReady, signOut } from './auth.js';
import { db, functions, firebaseReady } from './firebase.js';
import { markVisited } from './assessment-prompt-core.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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
// Keyed to the question count as well as the slug: answers are stored by
// position, so when an assessment is trimmed or extended, progress saved
// against the old set is dropped instead of being read against new questions.
const STORE = '1p-assess:' + slug + (def ? ':' + def.questions.length : '');
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
  // A labeled 5-point agreement scale, laid out as one row of circles from
  // disagree to agree. Same validated Likert scale; faster to tap than a
  // list, and every point keeps its label for screen readers and the hint.
  const chosen = state.answers[i];
  $('q-scale').innerHTML = `
    <div class="likert-row">
      <span class="likert-end">Disagree</span>
      <div class="likert-dots">${SCALE.map((s) =>
        `<button type="button" class="dot d${s.value}" data-v="${s.value}" aria-label="${esc(s.label)}" aria-pressed="${chosen === s.value}"></button>`).join('')}</div>
      <span class="likert-end">Agree</span>
    </div>
    <div class="likert-hint" id="q-hint">${chosen ? esc(SCALE[chosen - 1].label) : 'Tap the circle that fits'}</div>`;
  const hint = $('q-hint');
  $('q-scale').querySelectorAll('.dot').forEach((b) => {
    const label = SCALE[Number(b.dataset.v) - 1].label;
    b.addEventListener('mouseenter', () => { hint.textContent = label; });
    b.addEventListener('mouseleave', () => { const c = state.answers[state.index]; hint.textContent = c ? SCALE[c - 1].label : 'Tap the circle that fits'; });
    b.addEventListener('click', () => answer(Number(b.dataset.v)));
  });
  const qt = $('q-text');
  qt.classList.remove('q-in'); void qt.offsetWidth; qt.classList.add('q-in');
  $('q-back').style.visibility = i === 0 ? 'hidden' : 'visible';
  $('q-restart').style.visibility = Object.keys(state.answers).length ? 'visible' : 'hidden';
}

function answer(v) {
  const i = state.index;
  state.answers[i] = v;
  save();
  $('q-scale').querySelectorAll('.dot').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.v) === v)));
  if ($('q-hint')) $('q-hint').textContent = SCALE[v - 1].label;
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

$('q-restart').addEventListener('click', () => {
  if (!Object.keys(state.answers).length) return;
  if (!window.confirm('Start over? Your answers so far will be cleared.')) return;
  clearTimeout(advancing);
  state = Object.assign({ answers: {}, profile: {}, index: 0, finished: false }, state.contact ? { contact: state.contact } : {});
  save();
  renderQuestion();
});

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
      <div class="opts${pq.options.length <= 4 ? ' opts-short' : ''}" data-key="${pq.key}">${pq.options.map((o) =>
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
// The signed-in member a result is being saved to, shown on the report so a
// shared computer never quietly saves to someone else's account.
let member = null;

async function showResult() {
  const user = await onAuthReady();
  if (user) return unlock(user);
  if (state.claimed) return showClaimed();
  renderTeaser();
  show('s-result');
}

// How to read a score, shown once beside the breakdown.
function legend() {
  const ranges = ['0 to 49', '50 to 74', '75 to 100'];
  return `<p class="how-read">${esc(howToRead(def))}</p>
  <div class="legend">${LEVELS.map((l, i) =>
    `<span class="lv t-${toneFor(def, l.key)}">${esc(levelLabelFor(def, l.key))} <small>${ranges[i]}</small></span>`).join('')}</div>`;
}

// What the top area is called on a card and in the lists.
function focusTag(rep) {
  if (readingOf(def) === 'lower-better') return 'Shows up most';
  return def.mode === 'profile' ? 'Your type' : 'Focus here';
}

function resultHead(r, rep) {
  if (def.mode === 'profile') {
    return `<div class="res-top">
      <div class="eyebrow">Your result</div>
      <h1 class="display res-label">${esc(rep.headline)}</h1>
      <p class="res-line">${esc(rep.oneLine)}</p>
      <p class="res-summary">${esc(rep.summary)}</p>
      ${blendBar(rep)}
    </div>`;
  }
  return `<div class="res-top">
    <div class="eyebrow">Your result</div>
    <div class="ring" style="--p:${r.overall}"><div><b>${r.overall}</b><small>OUT OF 100</small></div></div>
    <h1 class="display res-label">You are <span>${esc(r.band.label)}</span></h1>
    <p class="res-line">${esc(rep.oneLine)}</p>
    <p class="res-summary">${esc(r.band.summary)}</p>
    ${scaleBar(r, rep)}
  </div>`;
}

// Where the overall score lands across the three bands, with the distance
// to the next one. Turns "38" into a position on a path.
function scaleBar(r, rep) {
  if (def.mode !== 'score') return '';
  const bands = def.bands.slice().sort((a, b) => a.min - b.min);
  const segs = bands.map((b, i) => {
    const end = i + 1 < bands.length ? bands[i + 1].min : 101;
    const here = r.band && b.label === r.band.label;
    return `<div class="seg seg-${i}${here ? ' here' : ''}" style="flex:${end - b.min}"><span>${esc(b.label)}</span><small>${b.min} to ${Math.min(end - 1, 100)}</small></div>`;
  }).join('');
  const where = rep.next
    ? `You scored <b>${r.overall}</b>, in <b>${esc(r.band.label)}</b>. <b>${rep.next.pointsAway} more point${rep.next.pointsAway === 1 ? '' : 's'}</b> moves you to <b>${esc(rep.next.band.label)}</b>.`
    : `You scored <b>${r.overall}</b>, in the top band: <b>${esc(r.band.label)}</b>. Your work now is protecting it and lifting your lowest area.`;
  return `<div class="scale-wrap">
    <div class="scale-track">${segs}<i class="marker" style="left:${Math.min(Math.max(r.overall, 1), 99)}%"><em>${r.overall}</em></i></div>
    <p class="scale-note">${where}</p>
  </div>`;
}

// Profile mode: the whole blend, not just the winner.
function blendBar(rep) {
  // A blend of patterns you want less of reads as a share of a problem, so
  // only types and styles show one.
  if (!rep.blend || readingOf(def) === 'lower-better') return '';
  return `<div class="blend">
    <div class="blend-track">${rep.blend.map((b, i) => `<i class="b${i}" style="flex:${Math.max(b.pct, 1)}" title="${esc(b.label)} ${b.pct}%"></i>`).join('')}</div>
    <ul class="blend-key">${rep.blend.map((b, i) => `<li><i class="b${i}"></i><span>${esc(b.label)}</span><b>${b.pct}%</b></li>`).join('')}</ul>
  </div>`;
}

// One card per area: the score, its level, and what the area measures.
// Shown before signup, so the free view already says something real.
function areaCards(rep) {
  const isProfile = def.mode === 'profile';
  return `<div class="cards">${rep.areas.map((a) => {
    const mark = rep.focus && a.key === rep.focus.key ? focusTag(rep)
      : (!isProfile && rep.strength && a.key === rep.strength.key ? 'Your strength' : '');
    return `<div class="acard tone-${a.tone}">
      <div class="acard-top"><span class="acard-name">${esc(a.label)}</span>${mark ? `<em class="tag">${mark}</em>` : ''}</div>
      <div class="acard-score"><b>${a.score}</b><small>/100</small><span class="lv t-${a.tone}">${esc(a.levelLabel)}</span></div>
      <div class="bar"><i style="width:${Math.max(a.score, 3)}%"></i></div>
      <p>${esc(a.desc)}</p>
    </div>`;
  }).join('')}</div>`;
}

// The statements behind one area's score, in the person's own answers.
function driversBlock(a) {
  const d = a.drivers;
  if (!d || (!d.lifts.length && !d.drags.length)) return '';
  const row = (x, kind) => `<li class="${kind}"><span class="dv-icon">${kind === 'up' ? '+' : '−'}</span><span>“${esc(x.text)}”<small>You answered: ${esc(x.answer)}</small></span></li>`;
  return `<div class="area-row"><span class="area-k">What drove this score</span><ul class="drivers">
    ${d.lifts.map((x) => row(x, 'up')).join('')}${d.drags.map((x) => row(x, 'down')).join('')}
  </ul></div>`;
}

function renderTeaser() {
  const r = scoreAssessment(def, state.answers);
  const rep = buildReport(def, r, state.answers);
  const next = `/assessments/${slug}?unlock=1`;
  $('s-result').innerHTML = `
    ${resultHead(r, rep)}
    <section class="panel">
      <div class="step plain">Your scores by area</div>
      ${legend()}
      ${areaCards(rep)}
    </section>
    <div class="locked">
      <div class="preview" aria-hidden="true">
        <div class="panel spot"><h3>${readingOf(def) === 'lower-better' ? 'Your strongest pattern' : (def.mode === 'profile' ? 'Your type in depth' : 'Your focus area')}: ${esc(rep.focus ? rep.focus.label : '')}</h3>
          <p>What your score means, the exact statements that pulled it down, and why it matters.</p>
          <ol class="actions"><li>Your first action</li><li>Your second action</li><li>Your third action</li></ol></div>
        <div class="panel"><h3>Your 30-day plan</h3><p>Week 1. Week 2. Week 3. Week 4.</p></div>
      </div>
      <div class="unlock">
        <div class="eyebrow">Your full report is ready</div>
        <h2 class="display">Unlock it free.</h2>
        <p class="sub">Enter your name and email. Your full report opens right here, and we save it to a free portal account for you.</p>
        <ul>
          <li>What each of your ${def.dimensions.length} scores means for you, and the exact answers behind it</li>
          <li>${def.mode === 'profile' ? 'Your type in depth: its strengths, its blind spot and your runner-up' : 'Your strongest area, and the one to focus on first'}</li>
          <li>A week-by-week 30-day plan with specific actions</li>
          <li>Reflection questions, and a report you can print or save</li>
          <li>Every other free assessment, with your results saved in one place</li>
        </ul>
        <form class="form" id="unlock-form" novalidate>
          <label for="u-name">First and last name</label>
          <input id="u-name" autocomplete="name" required>
          <label for="u-email">Email</label>
          <input id="u-email" type="email" autocomplete="email" required>
          <div class="form-msg" id="u-msg" role="status" aria-live="polite"></div>
          <button class="btn btn-red btn-block" type="submit" id="u-go">Unlock my full report</button>
        </form>
        <p class="fine">No password needed now. We will create your free One Percent portal account, save this report to your profile, and email you a link to set your password. Already a member? <a href="/login?next=${encodeURIComponent(next)}">Log in instead</a>. By continuing you agree to our <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</p>
      </div>
    </div>`;

  const msg = (t) => { $('u-msg').textContent = t || ''; $('u-msg').className = 'form-msg' + (t ? ' err' : ''); };
  if (state.contact) {
    $('u-name').value = state.contact.name || '';
    $('u-email').value = state.contact.email || '';
  }
  if (!firebaseReady) msg('Accounts are unavailable right now. Check your connection and refresh.');

  let checkedEmail = null;
  $('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    msg('');
    const name = $('u-name').value.trim();
    const email = $('u-email').value.trim();
    if (!name) return msg('Please enter your name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg('Please enter a valid email.');
    // A mistyped domain would become a second account they can never use.
    // Ask once; submitting the same address again goes through as typed.
    const fix = suggestEmail(email);
    if (fix && checkedEmail !== email) {
      checkedEmail = email;
      $('u-msg').className = 'form-msg err';
      $('u-msg').innerHTML = `Did you mean <button type="button" class="text-btn" id="u-fix" style="color:inherit;text-decoration:underline;padding:0;">${esc(fix)}</button>? Tap it to fix, or press the button again to keep what you typed.`;
      $('u-fix').addEventListener('click', () => { $('u-email').value = fix; checkedEmail = fix; msg(''); });
      return;
    }
    $('u-go').disabled = true;
    $('u-go').textContent = 'Opening your report…';
    const out = await claim(name, email);
    if (out.error === 'invalid') {
      msg(out.message);
      const b = $('u-go'); if (b) { b.disabled = false; b.textContent = 'Unlock my full report'; }
      return;
    }
    track('sign_up', { method: 'assessment_email', assessment: slug, fb: 'CompleteRegistration' });
    // They gave their details in good faith, so a server problem never
    // holds the report back. The save is retried on their next visit.
    state.claimed = out.error ? { email, status: 'pending', name } : { email, name, status: out.status, emailed: !!out.emailed };
    save();
    showClaimed.retried = true; // just tried twice; the next visit retries
    showClaimed();
  });
}

// Sends name, email and result to claimAssessment, retrying once on a
// server hiccup. Returns the server's answer, or { error: 'invalid' |
// 'server', message }.
async function claim(name, email) {
  const r = scoreAssessment(def, state.answers);
  const call = () => httpsCallable(functions, 'claimAssessment')(Object.assign({ name, email }, payloadFor(r)));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await call();
      return (res && res.data) || {};
    } catch (err) {
      const code = String((err && err.code) || '').replace('functions/', '');
      if (code === 'invalid-argument') return { error: 'invalid', message: err.message || 'Please check your name and email.' };
      if (code === 'resource-exhausted') return { error: 'invalid', message: 'Too many tries from this connection. Please wait a few minutes and try again.' };
      console.warn('[assessment] claim failed', code, err && err.message);
      if (attempt === 0) await new Promise((res) => setTimeout(res, 1200));
    }
  }
  return { error: 'server' };
}

// The status line under a report unlocked by name and email.
function claimedNote(c) {
  if (c.status === 'pending') return 'Your report is below. We could not finish setting up your portal account just now, and will try again the next time you open this page.';
  if (c.status === 'existing') return `You already have a portal account with ${c.email}. Log in to see this saved in your profile.`;
  return c.emailed
    ? `Your portal account is ready. Check ${c.email} for a link to set your password.`
    : 'Your portal account is ready. Use "Forgot password" on the login page with your email to set your password.';
}

function showClaimed() {
  unlocked = true;
  if (state.claimed && state.claimed.status === 'pending' && !showClaimed.retried) {
    showClaimed.retried = true;
    claim(state.claimed.name || '', state.claimed.email).then((out) => {
      if (out.error) return;
      state.claimed = { email: state.claimed.email, status: out.status, emailed: !!out.emailed };
      save();
      setSaved(claimedNote(state.claimed));
    });
  }
  const r = scoreAssessment(def, state.answers);
  renderFull(r, cleanProfile(state.profile), claimedNote(state.claimed), state.answers);
  show('s-result');
  track('assessment_unlocked', { assessment: slug, fb: 'Lead' });
}

// What the server needs to save a result, from either unlock path.
function payloadFor(r) {
  const dims = {};
  r.dims.forEach((d) => { dims[d.key] = d.score; });
  return {
    slug,
    mode: def.mode,
    score: r.overall,
    label: headlineFor(def, r),
    oneLine: buildReport(def, r).oneLine,
    dims,
    highest: r.highest,
    lowest: r.lowest,
    profile: cleanProfile(state.profile),
    answers: def.questions.map((_, i) => Number(state.answers[i]) || 0),
    utm: utm()
  };
}

async function unlock(user) {
  member = user;
  if (unlocked) return;
  unlocked = true;
  const r = scoreAssessment(def, state.answers);
  const profile = cleanProfile(state.profile);
  renderFull(r, profile, 'saving', state.answers);
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
    await httpsCallable(functions, 'submitAssessment')(payloadFor(r));
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

// One area in full: what the score means at this level, why it matters,
// what to do, and a question to sit with.
function areaDetail(a, { open = false, showActions = true } = {}) {
  return `<div class="area">
    <div class="area-row"><span class="area-k">What your score means</span><p>${esc(a.meaning)}</p></div>
    ${driversBlock(a)}
    <div class="area-row"><span class="area-k">Why it matters</span><p>${esc(a.why)}</p></div>
    ${showActions ? `<div class="area-row"><span class="area-k">What to do</span><ol class="actions">${a.actions.map((x) => `<li><span>${esc(x)}</span></li>`).join('')}</ol></div>` : ''}
    <div class="area-row"><span class="area-k">Reflect</span><p class="reflect">${esc(a.reflect)}</p></div>
  </div>`;
}

function renderFull(r, profile, status, answers) {
  const isProfile = def.mode === 'profile';
  const rep = buildReport(def, r, answers);
  const priority = isPriorityLead(profile);
  const related = (def.related || []).map(getAssessment).filter(Boolean);
  const f = rep.focus;
  // Numbered by a CSS counter in reading order.
  const step = (t) => `<div class="step">${esc(t)}</div>`;

  const auditPanel = priority && (!def.cta || def.cta.href !== '/corporate#audit')
    ? `<div class="panel cta-panel">
        <div class="eyebrow">For leaders</div>
        <h3>Your team is likely feeling this too.</h3>
        <p>Anthony offers a free 45-minute Alignment Audit on Zoom, with your whole team or with you one-on-one, and a one-page written scorecard within 48 hours.</p>
        <a class="btn btn-red" href="/corporate#audit">Request an Alignment Audit</a>
      </div>` : '';

  const ctaPanel = def.cta
    ? `<div class="panel cta-panel">
        <div class="eyebrow">Your next step</div>
        <h3>Want help closing the gap?</h3>
        <p>${isProfile ? 'Knowing your pattern is the start. Building around it is where things change.' : 'Clarity is step one. Execution is where your score moves.'}</p>
        <a class="btn ${auditPanel ? 'btn-ghost' : 'btn-red'}" href="${esc(def.cta.href)}">${esc(def.cta.label)}</a>
      </div>` : '';

  const strengthPanel = isProfile
    ? (rep.secondary && !rep.clear ? `<section class="panel">
        ${step(readingOf(def) === 'lower-better' ? 'Also showing up' : 'Your runner-up')}
        <h3>${esc(rep.secondary.headline || rep.secondary.label)}</h3>
        <p class="muted">${esc(rep.secondary.summary || rep.secondary.desc)}</p>
        <p class="note">${readingOf(def) === 'lower-better' ? 'Patterns often travel together. This one tends to show up when the first one is quiet.' : 'Most people are a blend. Your runner-up explains the moments when you do not act like your main type.'}</p>
      </section>` : '')
    : (rep.strength && f && rep.strength.key !== f.key ? `<section class="panel strong">
        ${step('Your strength')}
        <h3>${esc(rep.strength.label)} <span class="lv t-${rep.strength.tone}">${esc(rep.strength.levelLabel)} · ${rep.strength.score}</span></h3>
        <p>${esc(rep.strength.meaning)}</p>
        <div class="area-row"><span class="area-k">Use it</span><p>${esc(rep.strength.leverage)}</p></div>
      </section>` : '');

  $('s-result').innerHTML = `
    ${resultHead(r, rep)}
    ${member ? `<div class="whoami no-print">Signed in as <b>${esc(member.email || member.displayName || 'a member')}</b>. Not you? <button type="button" class="text-btn" id="not-me">Sign out</button></div>` : ''}
    <div class="res-tools">
      <span class="saved" id="saved">${status === 'saving' ? 'Saving to your portal…' : esc(status || '')}</span>
      <span class="res-tool-btns">
        <button class="text-btn" type="button" id="retake-top">↻ Retake the assessment</button>
        <button class="text-btn" type="button" id="print">Print or save as PDF</button>
      </span>
    </div>

    <section class="panel">
      ${step('Your scores by area')}
      ${legend()}
      ${areaCards(rep)}
    </section>

    <section class="panel spot">
      ${step(rep.clear ? 'The one to watch' : (readingOf(def) === 'lower-better' ? 'Your strongest pattern' : (isProfile ? 'Your type in depth' : 'Your focus area')))}
      <h3>${esc(isProfile && !rep.clear ? (f.headline || f.label) : f.label)} <span class="lv t-${f.tone}">${esc(f.levelLabel)} · ${f.score}</span></h3>
      <p class="muted">${esc(f.desc)}</p>
      ${areaDetail(f)}
    </section>

    ${strengthPanel}

    ${def.prompt ? `<section class="panel"><div class="eyebrow">Write your why</div><p class="why-prompt">${esc(def.prompt)}</p><p class="muted" style="margin-top:10px;">Fill it in tonight. Keep it where you will see it tomorrow morning.</p></section>` : ''}

    <section class="panel">
      ${step('Your 30-day plan')}
      <p class="muted">One action a week. Small enough to do, specific enough to matter.</p>
      <ol class="plan">${rep.plan.map((p) => `<li><div class="wk">Week ${p.week}<small>${esc(p.area)}</small></div><p>${esc(p.action)}</p></li>`).join('')}
        <li class="retake"><div class="wk">Day 30</div><p>Retake this assessment and compare. Progress you can measure is progress you keep.</p></li>
      </ol>
    </section>

    <section class="panel">
      ${step(readingOf(def) === 'lower-better' ? 'Every pattern, explained' : (isProfile ? 'Every type, explained' : 'Every area, explained'))}
      <p class="how-read">${esc(howToRead(def))} Tap any one for the details.</p>
      ${rep.areas.map((a) => `<details class="dim">
        <summary><span>${esc(a.label)}${rep.focus && a.key === rep.focus.key ? ` <em class="tag">${focusTag(rep)}</em>` : ''}</span><span><span class="lv t-${a.tone}">${esc(a.levelLabel)}</span> <b>${a.score}</b></span></summary>
        ${isProfile && a.summary ? `<p class="muted">${esc(a.summary)}</p>` : ''}
        ${areaDetail(a)}
      </details>`).join('')}
    </section>

    ${auditPanel}
    ${ctaPanel}

    ${related.length ? `<section class="panel no-print"><h3>Take another</h3><div class="related">${related.map((a) =>
      `<a href="/assessments/${a.slug}"><b>${esc(a.title)}</b><span>${esc(a.hook)}</span></a>`).join('')}</div></section>` : ''}

    ${def.disclaimer ? `<p class="disclaimer">${esc(def.disclaimer)}</p>` : ''}

    <div class="res-actions no-print">
      <a class="btn btn-red" href="/dashboard">Go to my portal</a>
      <a class="btn btn-ghost" href="/assessments">All assessments</a>
      <button class="btn btn-ghost" type="button" id="retake">↻ Retake the assessment</button>
    </div>`;

  $('print').addEventListener('click', () => { track('assessment_print', { assessment: slug }); window.print(); });
  if ($('not-me')) $('not-me').addEventListener('click', async () => {
    try { await signOut(); } catch (e) { /* signed out locally either way */ }
    // Their answers stay, so the person at the keyboard can claim this
    // result with their own name and email.
    state.savedFor = null;
    state.claimed = null;
    state.contact = null;
    save();
    location.reload();
  });
  $('retake').addEventListener('click', retake);
  $('retake-top').addEventListener('click', retake);
}

// Back to statement one with a clean slate. The name and email they already
// gave are kept to prefill the unlock form, so a retake never asks twice.
function retake() {
  const c = state.claimed;
  state = { answers: {}, profile: {}, index: 0, finished: false };
  if (c && c.email) state.contact = { name: c.name || '', email: c.email };
  save();
  unlocked = false;
  savedOnce = false;
  showClaimed.retried = false;
  track('assessment_retake', { assessment: slug });
  renderQuestion();
  show('s-quiz');
}

// Printing opens every area so the PDF has the whole report.
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('#s-result details').forEach((d) => { d.dataset.wasOpen = d.open ? '1' : ''; d.open = true; });
});
window.addEventListener('afterprint', () => {
  document.querySelectorAll('#s-result details').forEach((d) => { d.open = d.dataset.wasOpen === '1'; });
});

// A result saved from another device or an earlier visit, rebuilt from the
// stored per-area scores so the member can read it again anywhere.
function resultFromSaved(saved) {
  const dims = def.dimensions.map((d) => ({
    key: d.key, label: d.label, score: Number((saved.dims || {})[d.key]) || 0, answered: 1
  }));
  const order = def.dimensions.map((d) => d.key);
  const desc = dims.slice().sort((a, b) => b.score - a.score || order.indexOf(a.key) - order.indexOf(b.key));
  const asc = dims.slice().sort((a, b) => a.score - b.score || order.indexOf(a.key) - order.indexOf(b.key));
  const overall = Number(saved.score) || 0;
  return {
    overall,
    dims,
    highest: desc[0].key,
    lowest: asc[0].key,
    band: def.mode === 'profile' ? null : bandFor(def, overall),
    profileType: def.mode === 'profile' ? desc[0].key : null,
    complete: true
  };
}

async function showSavedResult(user) {
  if (!firebaseReady) return false;
  member = user;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid, 'assessments', slug));
    if (!snap.exists() || !snap.data().dims) return false;
    const saved = snap.data();
    const when = saved.completedAt && saved.completedAt.toDate
      ? saved.completedAt.toDate().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
      : null;
    // Answers saved against a different version of the questions would quote
    // the wrong statements, so they are only used when the set still matches.
    const answers = Array.isArray(saved.answers) && saved.answers.length === def.questions.length
      ? Object.assign({}, saved.answers) : null;
    renderFull(resultFromSaved(saved), saved.profile || {}, when ? `Your result from ${when}` : 'Your saved result', answers);
    show('s-result');
    return true;
  } catch (e) {
    console.warn('[assessment] could not load saved result', e && e.message);
    return false;
  }
}

// ── Boot ───────────────────────────────────────────────────────────────────
if (!def) {
  show('s-missing');
} else {
  document.title = `${def.title} | Free Assessment | The One Percent Nation`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', `${def.hook} ${def.short}`);
  utm();
  markVisited();
  track('assessment_view', { assessment: slug });
  renderIntro();
  const complete = scoreAssessment(def, state.answers).complete;
  if (state.finished && complete) {
    showResult();
  } else {
    show('s-intro');
    // Nothing in progress here: a signed-in member who took it before sees
    // their saved result instead of a blank start.
    if (!Object.keys(state.answers).length) {
      onAuthReady().then((user) => { if (user) showSavedResult(user); });
    }
  }
}
