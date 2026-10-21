// /plan-build — the plan wizard.
//
//   ?a=<slug>          build goals from that assessment's result
//   ?source=planner    save the Goal Planner's 90-day plan as a goal
//
// Four steps: pick your focus (up to two areas, weakest or your own type
// first, with one recommended), choose your actions, make them yours (your
// words, your dates), and commit (start date, check-in day, reminders). The
// rules live in plan-core.js; the server applies the same ones.
//
// The result comes from the member's portal when they are signed in, or
// from this browser's saved answers when they unlocked their report with a
// name and email and have not set a password yet. Those visitors save
// through claimPlan; anyone else is asked to log in, and their choices wait
// here in localStorage until they come back.
import { getAssessment } from './assessments-data.js';
import { scoreAssessment, buildReport, resultFromSaved, isPriorityLead, cleanProfile } from './assessment-core.js';
import {
  MAX_ACTIVE, MAX_AREAS_PER_BUILD, MAX_TASKS, TITLE_MAX, TEXT_MAX, NOTE_MAX, REVIEW_DAYS, PLANNER_REVIEW_DAYS,
  TEAM_ASSESSMENTS, DAY_NAMES, todayIso, plusDays, dayDiff, isIsoDay, fmtDay, wizardAreas, goalsFromPicks, goalFromPlanner, oneLine
} from './plan-core.js';
import { onAuthReady } from './auth.js';
import { db, functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { pushAvailable, enablePush } from './push.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const track = (name, params) => {
  try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) { /* analytics never breaks the page */ }
};

const params = new URLSearchParams(location.search);
const source = params.get('source') === 'planner' ? 'planner' : 'assessment';
const slug = source === 'assessment' ? (params.get('a') || '') : null;
const def = slug ? getAssessment(slug) : null;
const timezone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch (e) { return 'America/New_York'; } })();
const today = todayIso();
const here = location.pathname + location.search;

// ── Draft: survives a trip to the login page ───────────────────────────────
const DRAFT_KEY = '1p-plan-draft:' + (source === 'planner' ? 'planner' : slug);
const DRAFT_DAYS = 14;
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || !d.savedOn || dayDiff(d.savedOn, today) > DRAFT_DAYS) return null;
    return d;
  } catch (e) { return null; }
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.assign({}, state, { savedOn: today }))); } catch (e) { /* private mode */ }
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
}

let state = {
  step: null,
  sel: [],             // area keys, in the order picked
  tasks: {},           // areaKey (or 'planner') → [{ text, due, on, custom }]
  titles: {},          // areaKey → goal title
  notes: {},           // areaKey → first reflection
  start: today,
  checkinDay: 0,
  reminders: { email: true, inapp: true, push: false },
  pauseIds: [],
  finishIds: [],
  asLater: false,
  freshStart: false
};

// Filled in at boot.
const ctx = {
  user: null,
  result: null,
  rep: null,
  wizard: null,
  profile: null,
  previous: null,
  claimed: null,
  goals: [],
  planner: null
};

// ── Steps ──────────────────────────────────────────────────────────────────
const STEP_LABELS = { focus: 'Pick your focus', actions: 'Choose actions', yours: 'Make it yours', commit: 'Commit' };
function stepList() {
  return source === 'planner' ? ['yours', 'commit'] : ['focus', 'actions', 'yours', 'commit'];
}
function renderSteps() {
  const el = $('pl-steps');
  const list = stepList();
  const at = list.indexOf(state.step);
  if (at < 0) { el.innerHTML = ''; return; }
  el.innerHTML = list.map((k, i) => `<span class="${i < at ? 'done' : i === at ? 'on' : ''}"><b>${i + 1}</b>${esc(STEP_LABELS[k])}</span>`).join('');
}
function go(step) {
  state.step = step;
  saveDraft();
  render();
  track('plan_build_step', { step, assessment: slug || 'planner' });
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function render() {
  renderSteps();
  const body = $('w-body');
  body.classList.add('on');
  ({ existing: renderExisting, focus: renderFocus, actions: renderActions, yours: renderYours, commit: renderCommit }[state.step] || renderFocus)();
}

function screen(html) { $('w-body').innerHTML = html; }

// ── The make-room rule ─────────────────────────────────────────────────────
// Three active goals at most. When the new ones would pass that, the member
// chooses which current goal moves to Later or is marked done, or adds the
// new ones to Later instead.
function activeGoals() {
  return ctx.goals.filter((g) => g.status === 'active' && !state.finishIds.includes(g.id));
}
function newCount() { return source === 'planner' ? 1 : state.sel.length; }
function roomNeeded() {
  if (!ctx.user || state.asLater) return 0;
  const staying = activeGoals().filter((g) => !state.pauseIds.includes(g.id)).length;
  return Math.max(0, staying + newCount() - MAX_ACTIVE);
}
function roomPanel() {
  if (!ctx.user) return '';
  const active = activeGoals();
  const over = active.length + newCount() - MAX_ACTIVE;
  if (over <= 0 && !state.pauseIds.length && !state.asLater) return '';
  const left = roomNeeded();
  return `<section class="panel pl-room" id="room">
    <div class="eyebrow">Make room</div>
    <h3>You can work on ${MAX_ACTIVE} goals at once.</h3>
    <p class="muted">You have ${active.length} active. Choose what happens to one of them, or add ${newCount() === 1 ? 'this goal' : 'these goals'} to Later for now. Small, steady progress beats a long list.</p>
    <ul class="pl-room-list">${active.map((g) => `<li>
      <span>${esc(g.title)}${g.focus ? ' <em class="tag">Focus</em>' : ''}</span>
      <select data-room="${esc(g.id)}" aria-label="What happens to ${esc(g.title)}">
        <option value="keep"${!state.pauseIds.includes(g.id) && !state.finishIds.includes(g.id) ? ' selected' : ''}>Keep active</option>
        <option value="later"${state.pauseIds.includes(g.id) ? ' selected' : ''}>Move to Later</option>
        <option value="done"${state.finishIds.includes(g.id) ? ' selected' : ''}>Mark done</option>
      </select></li>`).join('')}</ul>
    <label class="pl-check"><input type="checkbox" id="as-later"${state.asLater ? ' checked' : ''}> Add the new ${newCount() === 1 ? 'goal' : 'goals'} to Later instead</label>
    <p class="pl-room-note ${left ? 'warn' : 'ok'}">${left ? `Free up ${left} more spot${left === 1 ? '' : 's'} to continue.` : 'You have room.'}</p>
  </section>`;
}
function wireRoom(after) {
  document.querySelectorAll('[data-room]').forEach((sel) => sel.addEventListener('change', () => {
    const id = sel.dataset.room;
    state.pauseIds = state.pauseIds.filter((x) => x !== id);
    state.finishIds = state.finishIds.filter((x) => x !== id);
    if (sel.value === 'later') state.pauseIds.push(id);
    if (sel.value === 'done') state.finishIds.push(id);
    saveDraft();
    after();
  }));
  const later = $('as-later');
  if (later) later.addEventListener('change', () => { state.asLater = later.checked; saveDraft(); after(); });
}

// ── Step 0: a plan from this assessment already exists ─────────────────────
function existingFromSlug() {
  return ctx.goals.filter((g) => g.slug === slug && g.status !== 'done');
}

function sinceList() {
  if (!ctx.previous || !ctx.previous.dims) return '';
  const rows = def.dimensions.map((d) => {
    const before = ctx.previous.dims[d.key];
    const now = (ctx.result.dims.find((x) => x.key === d.key) || {}).score;
    if (typeof before !== 'number' || typeof now !== 'number') return '';
    const delta = now - before;
    const good = ctx.wizard.reading === 'lower-better' ? delta < 0 : delta > 0;
    const cls = delta === 0 || ctx.wizard.reading === 'profile' ? 'flat' : (good ? 'up' : 'down');
    return `<li class="${cls}"><span>${esc(d.label)}</span><b>${before} → ${now}</b><em>${delta > 0 ? '+' : ''}${delta}</em></li>`;
  }).join('');
  return rows ? `<section class="panel"><div class="eyebrow">Last result → this result</div><ul class="since-list">${rows}</ul></section>` : '';
}

function renderExisting() {
  const existing = existingFromSlug();
  screen(`
    <div class="eyebrow">${esc(def.title)}</div>
    <h1 class="display pl-h1">You already have a plan from this.</h1>
    <p class="muted pl-lead">Your scores in My Plan update every time you retake. Choose how to use this result.</p>
    ${sinceList()}
    <section class="panel">
      <div class="eyebrow">Your goals from this assessment</div>
      <ul class="pl-mini">${existing.map((g) => `<li><b>${esc(g.title)}</b><span>${esc(g.areaLabel || '')}${typeof g.baseline === 'number' ? ` · started at ${g.baseline}` : ''}${typeof g.latest === 'number' && g.latest !== g.baseline ? `, now ${g.latest}` : ''} · ${g.status === 'later' ? 'Later' : 'Active'}</span></li>`).join('')}</ul>
    </section>
    <div class="pl-choices">
      <a class="pl-choice" href="/plan"><b>Keep going</b><span>Stay with the goals you have. Your new scores are already on them.</span></a>
      <button class="pl-choice" type="button" id="ex-add"><b>Add another area</b><span>Keep your current goals and pick a new area from this result.</span></button>
      <button class="pl-choice" type="button" id="ex-fresh"><b>Start fresh</b><span>Mark your current goals from this assessment done and build a new plan from today.</span></button>
    </div>`);
  $('ex-add').addEventListener('click', () => { state.freshStart = false; state.finishIds = []; go('focus'); });
  $('ex-fresh').addEventListener('click', () => {
    state.freshStart = true;
    state.finishIds = existing.map((g) => g.id);
    go('focus');
  });
}

// ── Step 1: pick your focus ────────────────────────────────────────────────
function ensureTasks(key) {
  if (state.tasks[key]) return;
  const area = ctx.wizard.areas.find((a) => a.key === key);
  state.tasks[key] = area.actions.map((text) => ({ text, due: null, on: true, custom: false }));
}

function renderFocus() {
  const w = ctx.wizard;
  const lead = w.reading === 'score'
    ? 'Your areas, weakest first. That is usually where focus pays off most.'
    : (w.reading === 'lower-better' ? 'The beliefs in your answers, strongest hold first.' : 'Your types, closest match first. No type is better than another.');
  screen(`
    <div class="eyebrow">Step 1 of 4 · ${esc(def.title)}</div>
    <h1 class="display pl-h1">Pick your focus.</h1>
    <p class="muted pl-lead">${esc(lead)} Pick up to ${MAX_AREAS_PER_BUILD}. We marked where we would start.</p>
    <div class="pl-areas" role="group" aria-label="Areas to work on">
      ${w.areas.map((a) => {
        const on = state.sel.includes(a.key);
        return `<button type="button" class="pl-area${on ? ' on' : ''}" data-area="${esc(a.key)}" role="checkbox" aria-checked="${on}">
          <span class="pl-area-top">
            <span class="pl-area-name">${esc(a.label)}</span>
            ${a.recommended ? '<em class="tag rec">Recommended</em>' : ''}
            <span class="pl-tick" aria-hidden="true"></span>
          </span>
          <span class="pl-area-goal">${esc(a.goal)}</span>
          <span class="pl-area-score"><b>${a.score}</b><small>/100</small><span class="lv t-${esc(a.tone)}">${esc(a.levelLabel)}</span></span>
          <span class="pl-area-why">${esc(a.why || a.desc)}</span>
        </button>`;
      }).join('')}
    </div>
    <p class="form-msg" id="f-msg" role="status" aria-live="polite"></p>
    ${def.disclaimer ? `<p class="disclaimer">${esc(def.disclaimer)}</p>` : ''}
    ${roomPanel()}
    <div class="pl-nav">
      <button class="btn btn-red" type="button" id="f-next"${state.sel.length && !roomNeeded() ? '' : ' disabled'}>Continue</button>
      <button class="btn btn-ghost" type="button" id="f-quick">Use the recommended plan</button>
    </div>
    <p class="muted pl-fine">The recommended plan is your ${w.reading === 'score' ? 'focus area' : 'top match'} and its three actions, a week apart. You can change anything later.</p>`);

  document.querySelectorAll('[data-area]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.area;
    const msg = $('f-msg');
    if (state.sel.includes(key)) {
      state.sel = state.sel.filter((k) => k !== key);
    } else if (state.sel.length >= MAX_AREAS_PER_BUILD) {
      msg.textContent = `Pick up to ${MAX_AREAS_PER_BUILD}. Unselect one first.`;
      msg.className = 'form-msg err';
      return;
    } else {
      state.sel.push(key);
    }
    saveDraft();
    renderFocus();
  }));
  wireRoom(renderFocus);
  $('f-next').addEventListener('click', () => {
    state.sel.forEach(ensureTasks);
    go('actions');
  });
  $('f-quick').addEventListener('click', () => {
    const key = w.recommendedKey;
    state.sel = [key];
    delete state.tasks[key];
    ensureTasks(key);
    fillDueDates();
    track('plan_build_quick', { assessment: slug });
    go('commit');
  });
}

// ── Step 2: choose your actions ────────────────────────────────────────────
function renderActions() {
  const areas = state.sel.map((k) => ctx.wizard.areas.find((a) => a.key === k)).filter(Boolean);
  const ready = areas.every((a) => (state.tasks[a.key] || []).some((t) => t.on));
  screen(`
    <div class="eyebrow">Step 2 of 4</div>
    <h1 class="display pl-h1">Choose your actions.</h1>
    <p class="muted pl-lead">Each action becomes a task in your plan. Take one, two or all three.</p>
    ${areas.map((a) => `<section class="panel">
      <div class="eyebrow">${esc(a.label)}</div>
      <h3>${esc(a.goal)}</h3>
      <div class="pl-acts">${(state.tasks[a.key] || []).filter((t) => !t.custom).map((t, i) => `
        <button type="button" class="pl-act${t.on ? ' on' : ''}" data-act="${esc(a.key)}:${i}" role="checkbox" aria-checked="${t.on}">
          <span class="pl-tick" aria-hidden="true"></span><span>${esc(t.text)}</span>
        </button>`).join('')}</div>
    </section>`).join('')}
    <div class="pl-nav">
      <button class="btn btn-red" type="button" id="a-next"${ready ? '' : ' disabled'}>Continue</button>
      <button class="btn btn-ghost" type="button" id="a-back">Back</button>
    </div>
    ${ready ? '' : '<p class="muted pl-fine">Choose at least one action for each area.</p>'}`);
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const [key, i] = b.dataset.act.split(':');
    const list = state.tasks[key].filter((t) => !t.custom);
    list[Number(i)].on = !list[Number(i)].on;
    saveDraft();
    renderActions();
  }));
  $('a-back').addEventListener('click', () => go('focus'));
  $('a-next').addEventListener('click', () => { fillDueDates(); go('yours'); });
}

// One task a week from the start date, for any task without a date yet.
function fillDueDates() {
  Object.keys(state.tasks).forEach((key) => {
    let n = 0;
    state.tasks[key].forEach((t) => {
      if (!t.on) return;
      if (!isIsoDay(t.due)) t.due = plusDays(state.start, 7 * (n + 1) - 1);
      n++;
    });
  });
}

// ── Step 3: make it yours ──────────────────────────────────────────────────
function blockKeys() { return source === 'planner' ? ['planner'] : state.sel.slice(); }

function renderYours() {
  const isPlanner = source === 'planner';
  const blocks = blockKeys().map((key) => {
    const area = isPlanner ? null : ctx.wizard.areas.find((a) => a.key === key);
    const title = state.titles[key] != null ? state.titles[key] : (isPlanner ? oneLine(ctx.planner.win, TITLE_MAX) : area.goal);
    const tasks = state.tasks[key].map((t, i) => ({ t, i })).filter((x) => x.t.on);
    const room = MAX_TASKS - tasks.length;
    return `<section class="panel pl-yours" data-block="${esc(key)}">
      <div class="eyebrow">${isPlanner ? 'Your 90-day goal' : esc(area.label)}</div>
      <label class="pl-label" for="title-${esc(key)}">Your goal, in your words</label>
      <input class="pl-input pl-title-in" id="title-${esc(key)}" data-title="${esc(key)}" maxlength="${TITLE_MAX}" value="${esc(title)}">
      <div class="pl-label">Your tasks</div>
      <ol class="pl-tasks">${tasks.map(({ t, i }) => `<li>
        <textarea class="pl-input" rows="2" maxlength="${TEXT_MAX}" data-text="${esc(key)}:${i}" aria-label="Task ${i + 1}">${esc(t.text)}</textarea>
        <div class="pl-task-row">
          <label>Due <input type="date" class="pl-input pl-date" data-due="${esc(key)}:${i}" value="${esc(t.due || '')}" min="${esc(today)}"></label>
          <button type="button" class="text-btn" data-drop="${esc(key)}:${i}">Remove</button>
        </div>
      </li>`).join('')}</ol>
      ${room > 0 ? `<div class="pl-add">
        <input class="pl-input" id="add-${esc(key)}" maxlength="${TEXT_MAX}" placeholder="Add your own task">
        <button type="button" class="btn btn-ghost" data-add="${esc(key)}">Add</button>
      </div>` : `<p class="muted pl-fine">A goal holds up to ${MAX_TASKS} tasks.</p>`}
      ${area && area.reflect ? `<div class="pl-reflect">
        <div class="pl-label">Sit with this</div>
        <p class="reflect">${esc(area.reflect)}</p>
        <textarea class="pl-input" rows="3" maxlength="${NOTE_MAX}" data-note="${esc(key)}" placeholder="Optional. Your answer saves to your private journal.">${esc(state.notes[key] || '')}</textarea>
      </div>` : ''}
    </section>`;
  }).join('');
  const ok = blockKeys().every((k) => state.tasks[k].some((t) => t.on && oneLine(t.text, TEXT_MAX).length >= 2));
  screen(`
    <div class="eyebrow">Step ${isPlanner ? '1 of 2' : '3 of 4'}</div>
    <h1 class="display pl-h1">Make it yours.</h1>
    <p class="muted pl-lead">Reword anything so it sounds like you. Change the dates to fit your weeks. Add what is missing. A plan you wrote is a plan you will run.</p>
    ${blocks}
    <p class="form-msg" id="y-msg" role="status" aria-live="polite"></p>
    <div class="pl-nav">
      <button class="btn btn-red" type="button" id="y-next"${ok ? '' : ' disabled'}>Continue</button>
      ${isPlanner ? '<a class="btn btn-ghost" href="/goal-planning">Back to the planner</a>' : '<button class="btn btn-ghost" type="button" id="y-back">Back</button>'}
    </div>`);

  const keyIdx = (v) => { const [k, i] = v.split(':'); return [k, Number(i)]; };
  document.querySelectorAll('[data-title]').forEach((el) => el.addEventListener('input', () => { state.titles[el.dataset.title] = el.value; saveDraft(); }));
  document.querySelectorAll('[data-text]').forEach((el) => el.addEventListener('input', () => {
    const [k, i] = keyIdx(el.dataset.text);
    state.tasks[k][i].text = el.value;
    saveDraft();
    const next = $('y-next');
    if (next) next.disabled = !blockKeys().every((bk) => state.tasks[bk].some((t) => t.on && oneLine(t.text, TEXT_MAX).length >= 2));
  }));
  document.querySelectorAll('[data-due]').forEach((el) => el.addEventListener('change', () => {
    const [k, i] = keyIdx(el.dataset.due);
    state.tasks[k][i].due = isIsoDay(el.value) ? el.value : null;
    saveDraft();
  }));
  document.querySelectorAll('[data-drop]').forEach((el) => el.addEventListener('click', () => {
    const [k, i] = keyIdx(el.dataset.drop);
    const t = state.tasks[k][i];
    if (state.tasks[k].filter((x) => x.on).length <= 1) {
      $('y-msg').textContent = 'A goal needs at least one task.';
      $('y-msg').className = 'form-msg err';
      return;
    }
    if (t.custom) state.tasks[k].splice(i, 1); else t.on = false;
    saveDraft();
    renderYours();
  }));
  document.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.add;
    const input = $('add-' + k);
    const text = oneLine(input.value, TEXT_MAX);
    if (text.length < 2) { input.focus(); return; }
    const n = state.tasks[k].filter((t) => t.on).length;
    state.tasks[k].push({ text, due: plusDays(state.start, 7 * (n + 1) - 1), on: true, custom: true });
    saveDraft();
    renderYours();
    const again = $('add-' + k);
    if (again) again.focus();
  }));
  document.querySelectorAll('[data-add]').forEach((el) => {
    const input = $('add-' + el.dataset.add);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.click(); } });
  });
  document.querySelectorAll('[data-note]').forEach((el) => el.addEventListener('input', () => { state.notes[el.dataset.note] = el.value; saveDraft(); }));
  if ($('y-back')) $('y-back').addEventListener('click', () => go('actions'));
  $('y-next').addEventListener('click', () => go('commit'));
}

// ── Step 4: commit ─────────────────────────────────────────────────────────
function goalsToSave() {
  const reminders = Object.assign({}, state.reminders);
  if (source === 'planner') {
    const g = goalFromPlanner(ctx.planner, { start: state.start, reminders, timezone });
    g.title = oneLine(state.titles.planner != null ? state.titles.planner : g.title, TITLE_MAX) || g.title;
    g.tasks = state.tasks.planner.filter((t) => t.on).map((t) => ({ text: oneLine(t.text, TEXT_MAX), due: t.due }));
    g.checkinDay = state.checkinDay;
    return [g];
  }
  const picks = state.sel.map((k) => ({
    areaKey: k,
    title: state.titles[k],
    tasks: state.tasks[k].filter((t) => t.on).map((t) => ({ text: t.text, due: t.due }))
  }));
  return goalsFromPicks({ def, wizard: ctx.wizard, picks, start: state.start, checkinDay: state.checkinDay, reminders, timezone });
}

function journalToSave() {
  if (source === 'planner') return [];
  return state.sel.map((k) => {
    const area = ctx.wizard.areas.find((a) => a.key === k);
    const text = String(state.notes[k] || '').trim();
    return text ? { areaKey: k, prompt: area ? area.reflect : '', text } : null;
  }).filter(Boolean);
}

function canSave() { return !!ctx.user || !!(ctx.claimed && ctx.claimed.email); }

function renderCommit() {
  const isPlanner = source === 'planner';
  const goals = goalsToSave();
  const span = isPlanner ? PLANNER_REVIEW_DAYS : REVIEW_DAYS;
  const review = plusDays(state.start, span);
  const team = !isPlanner && TEAM_ASSESSMENTS.includes(slug) && isPriorityLead(ctx.profile);
  const money = !isPlanner && def.category === 'money';
  const blocked = roomNeeded() > 0;
  screen(`
    <div class="eyebrow">Step ${isPlanner ? '2 of 2' : '4 of 4'}</div>
    <h1 class="display pl-h1">Commit.</h1>
    <p class="muted pl-lead">Pick when you start and when you check in. One honest check-in a week keeps a plan alive.</p>

    <section class="panel">
      <label class="pl-label" for="c-start">Start date</label>
      <input type="date" class="pl-input pl-date" id="c-start" value="${esc(state.start)}" min="${esc(today)}" max="${esc(plusDays(today, 60))}">
      <div class="pl-label" style="margin-top:20px;">Weekly check-in day</div>
      <div class="pl-days" role="radiogroup" aria-label="Check-in day">${DAY_NAMES.map((d, i) =>
        `<button type="button" class="chip" role="radio" aria-pressed="${state.checkinDay === i}" aria-checked="${state.checkinDay === i}" data-day="${i}">${d.slice(0, 3)}</button>`).join('')}</div>
      <div class="pl-label" style="margin-top:20px;">Remind me by</div>
      <label class="pl-check"><input type="checkbox" id="r-email"${state.reminders.email ? ' checked' : ''}> Email</label>
      <label class="pl-check"><input type="checkbox" id="r-inapp"${state.reminders.inapp ? ' checked' : ''}> A notice in my portal</label>
      <label class="pl-check" id="r-push-wrap" hidden><input type="checkbox" id="r-push"${state.reminders.push ? ' checked' : ''}> A push notification on this device</label>
    </section>

    <section class="panel">
      <div class="eyebrow">What you are committing to</div>
      <ul class="pl-mini">${goals.map((g) => `<li><b>${esc(g.title)}</b><span>${g.tasks.length} task${g.tasks.length === 1 ? '' : 's'}${g.tasks[0] && g.tasks[0].due ? ` · first one due ${esc(fmtDay(g.tasks[0].due))}` : ''}${typeof g.target === 'number' ? ` · aiming for ${g.target} from ${g.baseline}` : ''}</span></li>`).join('')}</ul>
      <p class="muted">Check-ins every ${esc(DAY_NAMES[state.checkinDay])}. Your ${isPlanner ? 'day-90' : 'day-30'} review is ${esc(fmtDay(review))}${isPlanner ? '' : ', with a retake to see what moved'}.</p>
    </section>

    ${team ? `<section class="panel cta-panel">
      <div class="eyebrow">For leaders</div>
      <h3>Run this with your whole team.</h3>
      <p>Your team is living these scores too. In a free 45-minute Alignment Audit, Anthony works through them with your whole team, or with you one-on-one, and sends a one-page written scorecard within 48 hours.</p>
      <a class="btn btn-ghost" href="/corporate#audit" id="c-audit">Request an Alignment Audit</a>
    </section>` : ''}

    ${money ? `<section class="panel">
      <div class="eyebrow">Your money goals</div>
      <p class="muted">These are habits you run yourself. For advice about your own situation, talk to a licensed professional.</p>
      <a class="btn btn-ghost" href="/financial-services">Talk to Aligned Wealth</a>
      ${def.disclaimer ? `<p class="disclaimer">${esc(def.disclaimer)}</p>` : ''}
    </section>` : ''}

    ${roomPanel()}

    <p class="form-msg" id="c-msg" role="status" aria-live="polite"></p>
    <div class="pl-nav">
      ${canSave()
        ? `<button class="btn btn-red" type="button" id="c-save"${blocked ? ' disabled' : ''}>Save my plan</button>`
        : `<a class="btn btn-red" href="/login?next=${encodeURIComponent(here)}" id="c-login">Log in to save my plan</a>`}
      <button class="btn btn-ghost" type="button" id="c-back">Back</button>
    </div>
    ${canSave() ? '' : '<p class="muted pl-fine">Your choices are kept on this device while you log in. No account yet? <a href="/signup?next=' + encodeURIComponent(here) + '">Create one free</a>.</p>'}`);

  $('c-start').addEventListener('change', () => {
    const v = $('c-start').value;
    if (!isIsoDay(v) || v < today) return;
    // Every date moves with the start, so the weekly rhythm holds.
    const shift = dayDiff(state.start, v);
    Object.values(state.tasks).forEach((list) => list.forEach((t) => { if (isIsoDay(t.due)) t.due = plusDays(t.due, shift); }));
    state.start = v;
    saveDraft();
    renderCommit();
  });
  document.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    state.checkinDay = Number(b.dataset.day);
    saveDraft();
    renderCommit();
  }));
  $('r-email').addEventListener('change', () => { state.reminders.email = $('r-email').checked; saveDraft(); });
  $('r-inapp').addEventListener('change', () => { state.reminders.inapp = $('r-inapp').checked; saveDraft(); });
  $('r-push').addEventListener('change', () => { state.reminders.push = $('r-push').checked; saveDraft(); });
  if (ctx.user) pushAvailable().then((okPush) => { if (okPush && $('r-push-wrap')) $('r-push-wrap').hidden = false; }).catch(() => {});
  if ($('c-audit')) $('c-audit').addEventListener('click', () => track('plan_build_audit', { assessment: slug }));
  wireRoom(renderCommit);
  $('c-back').addEventListener('click', () => go('yours'));
  if ($('c-login')) $('c-login').addEventListener('click', () => { saveDraft(); track('plan_build_login', { assessment: slug || 'planner' }); });
  if ($('c-save')) $('c-save').addEventListener('click', save);
}

async function save() {
  const btn = $('c-save');
  const msg = $('c-msg');
  const fail = (t) => { msg.textContent = t; msg.className = 'form-msg err'; btn.disabled = false; btn.textContent = 'Save my plan'; };
  btn.disabled = true;
  btn.textContent = 'Saving your plan…';
  msg.textContent = '';
  const goals = goalsToSave();
  const journal = journalToSave();
  try {
    if (ctx.user) {
      if (state.reminders.push) {
        try { await enablePush(ctx.user.uid); } catch (e) { state.reminders.push = false; goals.forEach((g) => { g.reminders.push = false; }); }
      }
      const res = await httpsCallable(functions, 'managePlan')({
        op: 'create', goals, journal, timezone,
        pauseIds: state.pauseIds, finishIds: state.finishIds, asLater: state.asLater
      });
      track('plan_saved', { assessment: slug || 'planner', goals: goals.length });
      clearDraft();
      const first = res && res.data && res.data.ids && res.data.ids[0];
      location.href = '/plan?new=1' + (first ? `#goal-${encodeURIComponent(first)}` : '');
      return;
    }
    const res = await httpsCallable(functions, 'claimPlan')({ email: ctx.claimed.email, goals, journal, timezone });
    const status = res && res.data && res.data.status;
    if (status === 'saved') {
      track('plan_saved', { assessment: slug || 'planner', goals: goals.length, via: 'claim' });
      clearDraft();
      renderClaimed();
      return;
    }
    // An account that has been used: it needs a real login.
    saveDraft();
    location.href = `/login?next=${encodeURIComponent(here)}`;
  } catch (err) {
    const code = String((err && err.code) || '').replace('functions/', '');
    if (code === 'failed-precondition' && err.details && err.details.reason === 'limit') {
      await loadGoals();
      fail(err.message);
      renderCommit();
      return;
    }
    if (code === 'resource-exhausted') return fail('Too many tries from this connection. Wait a few minutes and try again.');
    console.warn('[plan-build] save failed', code, err && err.message);
    fail(code === 'invalid-argument' && err.message ? err.message : 'We could not save your plan just now. Your choices are kept here. Try again in a moment.');
  }
}

function renderClaimed() {
  $('pl-steps').innerHTML = '';
  screen(`
    <div class="eyebrow">Plan saved</div>
    <h1 class="display pl-h1">Your plan is in your portal.</h1>
    <p class="muted pl-lead">Check ${esc(ctx.claimed.email)} for the link to set your password. Then open My Plan to check off tasks and do your first weekly check-in.</p>
    <div class="pl-nav">
      <a class="btn btn-red" href="/login?next=${encodeURIComponent('/plan')}">Log in to My Plan</a>
      <a class="btn btn-ghost" href="/assessments">Take another assessment</a>
    </div>`);
}

// ── Boot ───────────────────────────────────────────────────────────────────
function message(eyebrow, title, body, cta) {
  $('pl-steps').innerHTML = '';
  $('w-body').classList.add('on');
  screen(`<div class="eyebrow">${esc(eyebrow)}</div><h1 class="display pl-h1">${esc(title)}</h1><p class="muted pl-lead">${esc(body)}</p>
    <div class="pl-nav">${cta}</div>`);
}

async function loadGoals() {
  if (!ctx.user || !firebaseReady) { ctx.goals = []; return; }
  try {
    const snap = await getDocs(collection(db, 'users', ctx.user.uid, 'goals'));
    ctx.goals = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  } catch (e) {
    console.warn('[plan-build] goals unavailable', e && e.message);
    ctx.goals = [];
  }
}

async function loadResult() {
  const key = '1p-assess:' + slug + ':' + def.questions.length;
  let local = null;
  try { local = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { local = null; }
  if (local && local.claimed && local.claimed.email) ctx.claimed = local.claimed;

  if (ctx.user && firebaseReady) {
    try {
      const snap = await getDoc(doc(db, 'users', ctx.user.uid, 'assessments', slug));
      if (snap.exists() && snap.data().dims) {
        const saved = snap.data();
        ctx.result = resultFromSaved(def, saved);
        ctx.profile = cleanProfile(saved.profile);
        ctx.previous = saved.previous || null;
        return true;
      }
    } catch (e) { console.warn('[plan-build] saved result unavailable', e && e.message); }
  }
  if (local && local.finished) {
    const r = scoreAssessment(def, local.answers);
    if (r.complete) {
      ctx.result = r;
      ctx.profile = cleanProfile(local.profile);
      return true;
    }
  }
  return false;
}

async function boot() {
  if (source === 'assessment' && !def) {
    return message('My Plan', 'Pick an assessment first.', 'Your plan is built from an assessment result. Every one is free and takes about five minutes.',
      '<a class="btn btn-red" href="/assessments">See all assessments</a><a class="btn btn-ghost" href="/plan">My Plan</a>');
  }
  ctx.user = firebaseReady ? await onAuthReady() : null;

  if (source === 'planner') {
    try { ctx.planner = JSON.parse(localStorage.getItem('1p-planner-result') || 'null'); } catch (e) { ctx.planner = null; }
    if (!ctx.planner || !Array.isArray(ctx.planner.okrs)) {
      return message('Goal Planner', 'Build your 90-day plan first.', 'The Goal Planner turns your income target and schedule into a 90-day plan. Then save it here.',
        '<a class="btn btn-red" href="/goal-planning">Open the Goal Planner</a>');
    }
    if (!ctx.user) {
      return message('Goal Planner', 'Log in to save your plan.', 'Your 90-day plan is ready. Log in or create your free account to keep it in My Plan with tasks and a weekly check-in.',
        `<a class="btn btn-red" href="/login?next=${encodeURIComponent(here)}">Log in</a><a class="btn btn-ghost" href="/signup?next=${encodeURIComponent(here)}">Create a free account</a>`);
    }
    await loadGoals();
    const draft = loadDraft();
    if (draft) state = Object.assign(state, draft);
    if (!state.tasks.planner) {
      const g = goalFromPlanner(ctx.planner, { start: state.start, reminders: state.reminders, timezone });
      state.tasks.planner = g.tasks.map((t) => ({ text: t.text, due: t.due, on: true, custom: false }));
      state.checkinDay = g.checkinDay;
    }
    if (!state.step || !['yours', 'commit'].includes(state.step)) state.step = 'yours';
    return render();
  }

  const found = await loadResult();
  if (!found) {
    return message(def.title, 'Take the assessment first.', 'Your plan is built from your result. It takes about five minutes, and then you pick your goals right here.',
      `<a class="btn btn-red" href="/assessments/${encodeURIComponent(slug)}">Take ${esc(def.title)}</a>`);
  }
  ctx.rep = buildReport(def, ctx.result);
  ctx.wizard = wizardAreas(def, ctx.rep);
  await loadGoals();

  const draft = loadDraft();
  if (draft && draft.sel && draft.sel.every((k) => ctx.wizard.areas.some((a) => a.key === k))) {
    state = Object.assign(state, draft);
    // Goals deleted or moved since the draft was saved drop out of it.
    const ids = new Set(ctx.goals.map((g) => g.id));
    state.pauseIds = state.pauseIds.filter((id) => ids.has(id));
    state.finishIds = state.finishIds.filter((id) => ids.has(id));
  } else {
    state.sel = [ctx.wizard.recommendedKey].filter(Boolean);
  }
  if (state.start < today) {
    const shift = dayDiff(state.start, today);
    Object.values(state.tasks).forEach((list) => list.forEach((t) => { if (isIsoDay(t.due)) t.due = plusDays(t.due, shift); }));
    state.start = today;
  }
  if (!state.step) state.step = existingFromSlug().length ? 'existing' : 'focus';
  render();
}

boot().catch((e) => {
  console.error('[plan-build] failed to start', e);
  message('My Plan', 'Something went wrong.', 'Refresh the page to try again. Your choices are kept on this device.',
    '<button class="btn btn-red" type="button" onclick="location.reload()">Refresh</button>');
});
