// /plan — My Plan in the member portal.
//
// The member's goals (users/{uid}/goals), each with tasks to check off, a
// weekly check-in and a review at day 30 (day 90 for a Goal Planner plan),
// plus their private journal, the goals members have shared with them as a
// coach, and team totals for company admins. Reads come straight from
// Firestore; every change goes through the managePlan callable, which
// applies the same rules as plan-core.js.
import { onAuthReady, currentUser } from './auth.js';
import { ensureOnboarded } from './onboarding-guard.js';
import { renderTopbar, renderTopbarEarly } from './topbar.js';
import { renderShell } from './academy-shell.js';
import { getRoleInfo } from './roles.js';
import { db, functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  collection, getDocs, query, where, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAssessment } from './assessments-data.js';
import { listAdminCompanies } from './company-resolver.js';
import {
  MAX_ACTIVE, MAX_TASKS, TITLE_MAX, TEXT_MAX, NOTE_MAX, DAY_NAMES, TEAM_MIN,
  todayIso, fmtDay, progressOf, nextTask, checkinDue, reviewDue, isStalled, orderGoals, activeCount,
  scoreChange, icsForGoals
} from './plan-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const track = (name, params) => {
  try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) { /* analytics never breaks the page */ }
};
const timezone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; } catch (e) { return 'America/New_York'; } })();
const today = todayIso();
const isNew = new URLSearchParams(location.search).get('new') === '1';

const S = {
  uid: null,
  goals: [],
  journal: [],
  results: [],          // assessments the member has taken: [{ slug, title, score, label }]
  coach: null,          // { coach, clients } from getCoachClients
  companies: [],        // companies the member admins
  team: null,           // getTeamPlanSummary result
  open: {},             // goalId → 'checkin' | 'review' | 'edit:<taskId>'
  msg: {},              // goalId → { text, err }
  busy: false
};

function call(name, data) {
  return httpsCallable(functions, name)(Object.assign({ timezone }, data || {})).then((r) => r.data || {});
}

/** Runs one managePlan change and folds the returned goal into the page. */
async function planOp(goalId, op, data, { quiet = false } = {}) {
  S.msg[goalId] = null;
  try {
    const out = await call('managePlan', Object.assign({ op, goalId }, data || {}));
    if (out.goal) {
      const i = S.goals.findIndex((g) => g.id === goalId);
      if (i >= 0) S.goals[i] = out.goal;
    }
    // Focus moves between goals on the server when one leaves active.
    if (['setStatus', 'review', 'delete', 'setFocus'].includes(op)) await loadGoals();
    if (out.points && !quiet) S.msg[goalId] = { text: `Nice work. +${out.points} points.` };
    return out;
  } catch (err) {
    S.msg[goalId] = { text: (err && err.message) || 'That did not save. Try again.', err: true };
    return null;
  } finally {
    render();
  }
}

// ── Data ───────────────────────────────────────────────────────────────────

async function loadGoals() {
  const snap = await getDocs(collection(db, 'users', S.uid, 'goals'));
  S.goals = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}

async function loadJournal() {
  try {
    const snap = await getDocs(query(collection(db, 'users', S.uid, 'journal'), orderBy('createdAt', 'desc'), limit(60)));
    S.journal = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
  } catch (e) { S.journal = []; }
}

async function loadResults() {
  try {
    const snap = await getDocs(collection(db, 'users', S.uid, 'assessments'));
    S.results = snap.docs.map((d) => Object.assign({ slug: d.id }, d.data())).filter((r) => getAssessment(r.slug));
  } catch (e) { S.results = []; }
}

async function loadCoach() {
  try { S.coach = await call('getCoachClients'); } catch (e) { S.coach = null; }
}

async function loadCompanies() {
  try { S.companies = await listAdminCompanies(S.uid); } catch (e) { S.companies = []; }
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function dueLabel(t) {
  if (!t.due) return '';
  if (t.done) return fmtDay(t.due);
  if (t.due < today) return `Past due · ${fmtDay(t.due)}`;
  if (t.due === today) return 'Due today';
  return fmtDay(t.due);
}

function scoreRow(g) {
  if (typeof g.baseline !== 'number') return '';
  const ch = scoreChange(g);
  const latest = typeof g.latest === 'number' ? g.latest : g.baseline;
  const moved = ch && ch.delta !== 0;
  const cls = !ch || ch.delta === 0 || g.reading === 'profile' ? '' : (ch.better ? 'up' : 'down');
  const target = typeof g.target === 'number'
    ? `<span class="goal">${ch && ch.reached ? 'Target reached' : `Aiming for ${g.target}`}${g.reading === 'lower-better' ? ' (lower is better)' : ''}</span>` : '';
  return `<div class="mp-score">
    <span class="mp-sub">${esc(g.areaLabel || 'Score')}</span>
    <span class="n">${g.baseline}</span>
    ${moved ? `<span class="arrow">→</span><span class="n">${latest}</span><span class="delta ${cls}">${ch.delta > 0 ? '+' : ''}${ch.delta}</span>` : '<span class="mp-sub">at the start</span>'}
    ${target}
  </div>`;
}

function taskRow(g, t) {
  const editing = S.open[g.id] === `edit:${t.id}`;
  const due = dueLabel(t);
  const dueCls = !t.done && t.due && t.due < today ? 'late' : (!t.done && t.due === today ? 'today' : '');
  return `<li class="mp-task${t.done ? ' done' : ''}">
    <input type="checkbox" data-op="toggle" data-goal="${esc(g.id)}" data-task="${esc(t.id)}"${t.done ? ' checked' : ''} aria-label="Mark done: ${esc(t.text)}"${g.status === 'done' ? ' disabled' : ''}>
    <span class="txt">${esc(t.text)}</span>
    <span class="due ${dueCls}">${esc(due)}${g.status !== 'done' ? ` <button class="mp-link" type="button" data-op="edit-task" data-goal="${esc(g.id)}" data-task="${esc(t.id)}">Edit</button>` : ''}</span>
    ${editing ? `<div class="mp-task-edit">
      <textarea class="pl-input" rows="2" maxlength="${TEXT_MAX}" id="et-${esc(g.id)}-${esc(t.id)}">${esc(t.text)}</textarea>
      <div class="row">
        <input type="date" class="pl-input pl-date" id="ed-${esc(g.id)}-${esc(t.id)}" value="${esc(t.due || '')}">
        <button class="mp-btn sm red" type="button" data-op="save-task" data-goal="${esc(g.id)}" data-task="${esc(t.id)}">Save</button>
        <button class="mp-btn sm" type="button" data-op="cancel" data-goal="${esc(g.id)}">Cancel</button>
        <button class="mp-link" type="button" data-op="delete-task" data-goal="${esc(g.id)}" data-task="${esc(t.id)}">Remove task</button>
      </div>
    </div>` : ''}
  </li>`;
}

function checkinBlock(g) {
  const due = checkinDue(g, today);
  const open = S.open[g.id] === 'checkin';
  const recent = (g.checkins || []).slice(-3).reverse();
  if (!open && !due) {
    return recent.length ? `<details class="no-print" style="margin-top:12px;"><summary class="mp-sub" style="cursor:pointer;">Recent check-ins (${(g.checkins || []).length})</summary>
      <ul class="mp-checkins">${recent.map(checkinItem).join('')}</ul></details>` : '';
  }
  const lastNext = recent[0] && recent[0].next;
  return `<div class="mp-due-card">
    <h4>${due ? 'Your weekly check-in is open' : 'Weekly check-in'}</h4>
    <p>Two minutes. Honest beats impressive.${lastNext ? ` Last week you said next was: "${esc(lastNext)}"` : ''}</p>
    ${open ? `<div class="mp-form">
      <label for="ci-did-${esc(g.id)}">What did you do this week?</label>
      <textarea class="pl-input" rows="2" maxlength="${NOTE_MAX}" id="ci-did-${esc(g.id)}"></textarea>
      <label for="ci-blocked-${esc(g.id)}">What got in the way?</label>
      <textarea class="pl-input" rows="2" maxlength="${NOTE_MAX}" id="ci-blocked-${esc(g.id)}"></textarea>
      <label for="ci-next-${esc(g.id)}">What is your next step?</label>
      <textarea class="pl-input" rows="2" maxlength="${NOTE_MAX}" id="ci-next-${esc(g.id)}"></textarea>
      <div><button class="mp-btn red" type="button" data-op="save-checkin" data-goal="${esc(g.id)}">Save check-in</button>
      <button class="mp-btn" type="button" data-op="cancel" data-goal="${esc(g.id)}">Not now</button></div>
    </div>` : `<div style="margin-top:10px;"><button class="mp-btn red sm" type="button" data-op="open-checkin" data-goal="${esc(g.id)}">Check in</button></div>`}
    ${recent.length ? `<ul class="mp-checkins">${recent.map(checkinItem).join('')}</ul>` : ''}
  </div>`;
}

function checkinItem(c) {
  const parts = [c.did && `Did: ${c.did}`, c.blocked && `In the way: ${c.blocked}`, c.next && `Next: ${c.next}`].filter(Boolean);
  return `<li><b>${esc(fmtDay(c.date))}</b>${parts.map(esc).join('<br>')}</li>`;
}

function reviewBlock(g) {
  if (!reviewDue(g, today)) return '';
  const open = S.open[g.id] === 'review';
  const def = g.slug ? getAssessment(g.slug) : null;
  const ch = scoreChange(g);
  const retaken = g.latestAt && g.startDate && (typeof g.latestAt === 'number' ? g.latestAt : (g.latestAt.toMillis ? g.latestAt.toMillis() : 0)) > Date.parse(g.startDate + 'T00:00:00');
  return `<div class="mp-due-card">
    <h4>${g.source === 'planner' ? 'Day 90' : 'Day 30'}: time to review</h4>
    ${def ? (retaken && ch
      ? `<p>Since you started, ${esc(g.areaLabel)} went from ${ch.from} to ${ch.to}. ${ch.delta === 0 ? 'Holding steady is still data.' : (ch.better ? 'That is progress you can measure.' : 'That is honest data. Look at what got in the way.')}</p>`
      : `<p>Retake ${esc(def.title)} first, so this review compares real numbers. It takes about five minutes.</p>
         <div style="margin-top:10px;"><a class="mp-btn sm red" href="/assessments/${encodeURIComponent(g.slug)}?retake=1">Retake ${esc(def.title)}</a></div>`)
      : '<p>Look back at what moved, then choose what is next.</p>'}
    ${open ? `<div class="mp-form">
      <label for="rv-easier-${esc(g.id)}">What got easier?</label>
      <textarea class="pl-input" rows="3" maxlength="${NOTE_MAX}" id="rv-easier-${esc(g.id)}"></textarea>
      <div class="mp-decisions" role="radiogroup" aria-label="What is next">
        <label><input type="radio" name="rv-${esc(g.id)}" value="finish" checked> <span><b>Finish this goal.</b> It moves to Done.</span></label>
        <label><input type="radio" name="rv-${esc(g.id)}" value="continue"> <span><b>Keep going ${g.source === 'planner' ? '90' : '30'} more days.</b> ${typeof g.latest === 'number' ? 'The next round measures from where you are now.' : ''}</span></label>
        ${def ? `<label><input type="radio" name="rv-${esc(g.id)}" value="next"> <span><b>Finish and pick the next area.</b> Build your next goal from ${esc(def.title)}.</span></label>` : ''}
      </div>
      <div><button class="mp-btn red" type="button" data-op="save-review" data-goal="${esc(g.id)}">Save review</button>
      <button class="mp-btn" type="button" data-op="cancel" data-goal="${esc(g.id)}">Not now</button></div>
    </div>` : `<div style="margin-top:10px;"><button class="mp-btn sm${def && !retaken ? '' : ' red'}" type="button" data-op="open-review" data-goal="${esc(g.id)}">${def && !retaken ? 'Review without a retake' : 'Start my review'}</button></div>`}
  </div>`;
}

function goalCard(g) {
  const p = progressOf(g);
  const msg = S.msg[g.id];
  const tags = [
    g.focus ? '<span class="mp-tag red">Focus</span>' : '',
    g.status === 'later' ? '<span class="mp-tag">Later</span>' : '',
    g.status === 'done' ? '<span class="mp-tag blue">Done</span>' : '',
    g.areaLabel ? `<span class="mp-tag">${esc(g.areaLabel)}</span>` : '',
    g.assessmentTitle ? `<span class="mp-tag">${esc(g.assessmentTitle)}</span>` : '',
    g.source === 'planner' ? '<span class="mp-tag">90-day plan</span>' : '',
    g.coachName ? `<span class="mp-tag blue">Shared with ${esc(g.coachName)}</span>` : '',
    g.status === 'active' && isStalled(g, today) ? '<span class="mp-tag">Quiet for 2 weeks</span>' : ''
  ].join('');
  const compact = g.status !== 'active';
  const nt = nextTask(g);
  return `<article class="mp-goal ${g.status}${g.focus ? ' focus' : ''}" id="goal-${esc(g.id)}">
    <div class="mp-tags">${tags}</div>
    <div class="mp-goal-top"><h3>${esc(g.title)}</h3></div>
    ${compact ? `<p class="mp-sub" style="margin-top:6px;">${p.done} of ${p.total} tasks done${g.status === 'done' && g.doneDate ? ` · finished ${esc(fmtDay(g.doneDate))}` : ''}${g.status === 'later' && nt ? ` · next: ${esc(nt.text.slice(0, 80))}` : ''}</p>` : `
    ${scoreRow(g)}
    <div class="mp-progress"><i style="width:${p.pct}%"></i></div>
    <p class="mp-sub">${p.done} of ${p.total} tasks done · check-ins on ${esc(DAY_NAMES[g.checkinDay] || 'Sunday')} · review ${esc(fmtDay(g.reviewDate))}</p>
    ${reviewBlock(g)}
    <ul class="mp-tasks">${(g.tasks || []).map((t) => taskRow(g, t)).join('')}</ul>
    ${(g.tasks || []).length < MAX_TASKS ? `<div class="mp-add no-print">
      <input class="pl-input" id="add-${esc(g.id)}" maxlength="${TEXT_MAX}" placeholder="Add a task">
      <input type="date" class="pl-input pl-date" id="add-due-${esc(g.id)}" aria-label="Due date">
      <button class="mp-btn sm" type="button" data-op="add-task" data-goal="${esc(g.id)}">Add</button>
    </div>` : ''}
    ${checkinBlock(g)}`}
    ${msg ? `<p class="mp-msg${msg.err ? ' err' : ''}" role="status">${esc(msg.text)}</p>` : ''}
    <div class="mp-actions no-print">
      ${g.status === 'active' ? `
        ${!checkinDue(g, today) && S.open[g.id] !== 'checkin' ? `<button class="mp-btn sm" type="button" data-op="open-checkin" data-goal="${esc(g.id)}">Check in</button>` : ''}
        ${!g.focus ? `<button class="mp-btn sm" type="button" data-op="focus" data-goal="${esc(g.id)}">Make this my focus</button>` : ''}
        <button class="mp-btn sm" type="button" data-op="status" data-status="later" data-goal="${esc(g.id)}">Move to Later</button>
        <button class="mp-btn sm" type="button" data-op="status" data-status="done" data-goal="${esc(g.id)}">Mark done</button>
        <button class="mp-btn sm" type="button" data-op="share" data-goal="${esc(g.id)}">${g.coachUid ? 'Sharing' : 'Share with a coach'}</button>
        <button class="mp-btn sm" type="button" data-op="settings" data-goal="${esc(g.id)}">Settings</button>` : `
        <button class="mp-btn sm" type="button" data-op="status" data-status="active" data-goal="${esc(g.id)}"${activeCount(S.goals) >= MAX_ACTIVE ? ' disabled title="You have 3 active goals"' : ''}>${g.status === 'done' ? 'Work on it again' : 'Make active'}</button>`}
      <button class="mp-link" type="button" data-op="delete" data-goal="${esc(g.id)}">Delete</button>
    </div>
  </article>`;
}

// ── Sections ───────────────────────────────────────────────────────────────

function heroHtml() {
  const n = activeCount(S.goals);
  return `<div class="mp-hero">
    <div>
      <div class="mp-eyebrow">My Plan</div>
      <h1>One percent better, on purpose.</h1>
      <p>Your goals, the tasks that move them, and one honest check-in a week.</p>
      <div class="mp-meter" aria-label="${n} of ${MAX_ACTIVE} active goals">${Array.from({ length: MAX_ACTIVE }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}<span>${n} of ${MAX_ACTIVE} active</span></div>
    </div>
    <div class="mp-tools">
      ${S.goals.some((g) => g.status === 'active') ? '<button class="mp-btn" type="button" data-op="ics">Add to my calendar</button><button class="mp-btn" type="button" data-op="print">Print</button>' : ''}
      <a class="mp-btn red" href="#build">Add a goal</a>
    </div>
  </div>`;
}

function buildHtml() {
  const activeSlugs = new Set(S.goals.filter((g) => g.status !== 'done' && g.slug).map((g) => g.slug));
  const fresh = S.results.filter((r) => !activeSlugs.has(r.slug));
  const custom = S.open.__custom;
  return `<section class="mp-section" id="build">
    <h2>Add a goal</h2>
    ${fresh.length ? `<p class="mp-sub">From your results</p><div class="mp-grid">${fresh.map((r) => {
      const def = getAssessment(r.slug);
      return `<a class="mp-card" href="/plan-build?a=${encodeURIComponent(r.slug)}"><b>${esc(def.title)}</b><span>${esc(r.label || '')}${typeof r.score === 'number' && def.mode !== 'profile' ? ` · ${r.score}/100` : ''}</span><span style="color:var(--red);">Build a goal →</span></a>`;
    }).join('')}</div>` : ''}
    <div class="mp-grid">
      <a class="mp-card" href="/assessments"><b>Take an assessment</b><span>17 free, five minutes each. Your goals come from your own results.</span></a>
      <a class="mp-card" href="/goal-planning"><b>Goal Planner</b><span>Turn an income target and your schedule into a 90-day plan.</span></a>
      <button class="mp-card" type="button" data-op="open-custom" style="text-align:left;cursor:pointer;font:inherit;"><b>Write your own</b><span>A goal in your words, with up to ${MAX_TASKS} tasks.</span></button>
    </div>
    ${custom ? `<div class="mp-panel" style="margin-top:14px;">
      <label class="pl-label" for="cu-title">Your goal</label>
      <input class="pl-input" id="cu-title" maxlength="${TITLE_MAX}" placeholder="For example: Finish the proposal and send it to three buyers">
      <label class="pl-label" for="cu-tasks">Tasks, one per line</label>
      <textarea class="pl-input" id="cu-tasks" rows="4" placeholder="Outline the proposal by Friday&#10;Ask Dana for feedback&#10;Send it to three buyers"></textarea>
      <p class="mp-sub" style="margin-top:8px;">Tasks land a week apart starting today. Change any date after.</p>
      <p class="mp-msg" id="cu-msg" role="status"></p>
      <div style="display:flex;gap:8px;margin-top:8px;"><button class="mp-btn red" type="button" data-op="save-custom">Save goal</button><button class="mp-btn" type="button" data-op="close-custom">Cancel</button></div>
    </div>` : ''}
  </section>`;
}

function journalHtml() {
  return `<section class="mp-section" id="journal">
    <h2>Journal <small>Private to you</small></h2>
    <div class="mp-panel no-print" style="margin-bottom:12px;">
      <textarea class="pl-input" id="jn-text" rows="3" maxlength="${NOTE_MAX}" placeholder="What are you noticing? What got easier? What is still hard?"></textarea>
      <div style="margin-top:8px;"><button class="mp-btn sm" type="button" data-op="journal">Save entry</button></div>
    </div>
    ${S.journal.length ? `<ul class="mp-journal">${S.journal.map((j) => `<li>
      ${j.prompt ? `<div class="q">${esc(j.prompt)}</div>` : ''}
      <div class="t">${esc(j.text)}</div>
      <div class="meta"><span>${esc(fmtDay(j.date))}${j.goalTitle ? ` · ${esc(j.goalTitle)}` : ''}</span><button class="mp-link no-print" type="button" data-op="delete-journal" data-entry="${esc(j.id)}">Delete</button></div>
    </li>`).join('')}</ul>` : '<p class="mp-sub">Reflections from your plan land here. Coaches and teams never see them.</p>'}
  </section>`;
}

function coachingHtml() {
  if (!S.coach || !S.coach.coach) return '';
  const clients = S.coach.clients || [];
  return `<section class="mp-section" id="coaching">
    <h2>People you coach <small>${clients.length}</small></h2>
    ${clients.length ? clients.map((c) => `<div class="mp-client">
      <h4>${esc(c.name)}</h4>
      ${c.goals.map((g) => {
        const ch = scoreChange(g);
        const last = (g.checkins || []).slice(-1)[0];
        return `<div style="padding:10px 0;border-top:1px solid var(--border);">
          <b>${esc(g.title)}</b> <span class="mp-tag">${esc(g.status)}</span>
          <p class="mp-sub">${g.done} of ${g.total} tasks${ch ? ` · ${esc(g.areaLabel || 'Score')} ${ch.from} → ${ch.to}` : ''}${g.reviewDate ? ` · review ${esc(fmtDay(g.reviewDate))}` : ''}${g.lastActivityDate ? ` · last active ${esc(fmtDay(g.lastActivityDate))}` : ''}</p>
          ${g.nextTask ? `<p class="mp-sub">Next: ${esc(g.nextTask.text)}</p>` : ''}
          ${last ? `<ul class="mp-checkins"><li><b>${esc(fmtDay(last.date))}</b>${[last.did && `Did: ${last.did}`, last.blocked && `In the way: ${last.blocked}`, last.next && `Next: ${last.next}`].filter(Boolean).map(esc).join('<br>')}</li></ul>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('') : '<p class="mp-sub">When a member shares a goal with you from their plan, it shows up here with their tasks and check-ins.</p>'}
  </section>`;
}

function teamHtml() {
  if (!S.companies.length) return '';
  const t = S.team;
  let body = `<p class="mp-sub">Totals only. No one's individual goals or scores are shown, and nothing appears until at least ${TEAM_MIN} people are counted.</p>`;
  if (t && t.hidden) body += `<p class="mp-sub" style="margin-top:10px;">${t.members} member${t.members === 1 ? '' : 's'} so far. Team totals appear at ${TEAM_MIN}.</p>`;
  else if (t) {
    body += `<div class="mp-stats">
      <div class="mp-stat"><b>${t.members}</b><span>members</span></div>
      <div class="mp-stat"><b>${t.members ? Math.round((t.withPlan / t.members) * 100) : 0}%</b><span>have an active plan</span></div>
      <div class="mp-stat"><b>${t.activeGoals}</b><span>active goals</span></div>
      <div class="mp-stat"><b>${t.tasksTotal ? Math.round((t.tasksDone / t.tasksTotal) * 100) : 0}%</b><span>of tasks done</span></div>
      <div class="mp-stat"><b>${t.checkinsLast30}</b><span>check-ins in 30 days</span></div>
    </div>
    ${(t.assessments || []).map((a) => {
      const def = getAssessment(a.slug);
      if (!def) return '';
      return `<div style="margin-top:16px;"><b>${esc(def.title)}</b> <span class="mp-sub">${a.n} taken${def.mode !== 'profile' ? ` · team average ${a.avg}` : ''}</span>
        <ul class="mp-bars">${def.dimensions.map((d) => typeof a.dims[d.key] === 'number'
          ? `<li><span>${esc(d.label)}</span><span class="bar"><i style="width:${Math.max(a.dims[d.key], 2)}%"></i></span><b>${a.dims[d.key]}</b></li>` : '').join('')}</ul></div>`;
    }).join('')}`;
  }
  return `<section class="mp-section no-print" id="team">
    <h2>Your team</h2>
    <div class="mp-panel">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        ${S.companies.length > 1 ? `<select class="pl-input" id="team-co" style="width:auto;">${S.companies.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>` : `<b>${esc(S.companies[0].name)}</b>`}
        <button class="mp-btn sm" type="button" data-op="team">${t ? 'Refresh' : 'Show team totals'}</button>
      </div>
      ${body}
      <p class="mp-sub" style="margin-top:14px;">Want to work through these numbers together? <a href="/corporate#audit" style="color:var(--white);text-decoration:underline;">Request an Alignment Audit</a>.</p>
    </div>
  </section>`;
}

function render() {
  const root = $('mp');
  const ordered = orderGoals(S.goals);
  const active = ordered.filter((g) => g.status === 'active');
  const later = ordered.filter((g) => g.status === 'later');
  const done = ordered.filter((g) => g.status === 'done');
  const firstCheckin = active.find((g) => g.focus) || active[0];
  root.innerHTML = `
    ${heroHtml()}
    ${isNew && firstCheckin ? `<div class="mp-banner"><b>Your plan is saved.</b><p>Your first check-in is ${esc(DAY_NAMES[firstCheckin.checkinDay])}. Start with the first task below, and check it off when it is done.</p></div>` : ''}
    ${active.length ? active.map(goalCard).join('') : `<div class="mp-empty">
      <h2>${S.goals.length ? 'No active goals right now.' : 'Your plan starts with your results.'}</h2>
      <p>${S.goals.length ? 'Pick one back up from Later, or add a new goal.' : 'Take a free assessment, then choose the goals that matter. They live here with tasks, a weekly check-in and a retake at day 30.'}</p>
      <a class="mp-btn red" href="${S.results.length ? '#build' : '/assessments'}">${S.results.length ? 'Build my plan' : 'Take an assessment'}</a>
    </div>`}
    ${later.length ? `<section class="mp-section"><details class="mp-more"${active.length ? '' : ' open'}><summary>Later <span class="mp-sub">${later.length}</span></summary><div style="margin-top:12px;">${later.map(goalCard).join('')}</div></details></section>` : ''}
    ${done.length ? `<section class="mp-section"><details class="mp-more"><summary>Done <span class="mp-sub">${done.length}</span></summary><div style="margin-top:12px;">${done.map(goalCard).join('')}</div></details></section>` : ''}
    ${buildHtml()}
    ${journalHtml()}
    ${coachingHtml()}
    ${teamHtml()}`;
}

// ── Modals ─────────────────────────────────────────────────────────────────

function modal(html) {
  closeModal();
  const el = document.createElement('div');
  el.className = 'mp-modal';
  el.id = 'mp-modal';
  el.innerHTML = `<div class="mp-modal-box" role="dialog" aria-modal="true">${html}</div>`;
  el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  document.body.appendChild(el);
  const first = el.querySelector('input, select, textarea, button');
  if (first) first.focus();
  return el;
}
function closeModal() { const m = $('mp-modal'); if (m) m.remove(); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

async function openShare(g) {
  const box = modal(`<h3>Share with a coach</h3>
    <p class="mp-sub">Your coach sees this goal's tasks, score and check-ins, so your sessions start from where you really are. Your journal stays private.</p>
    <div id="sh-list"><p class="mp-sub" style="margin-top:12px;">Loading coaches…</p></div>
    <p class="mp-msg" id="sh-msg" role="status"></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      <button class="mp-btn red" type="button" id="sh-save">Share</button>
      ${g.coachUid ? '<button class="mp-btn" type="button" id="sh-stop">Stop sharing</button>' : ''}
      <button class="mp-btn" type="button" id="sh-cancel">Cancel</button>
    </div>`);
  box.querySelector('#sh-cancel').addEventListener('click', closeModal);
  let coaches = [];
  try {
    const snap = await getDocs(query(collection(db, 'coachDirectory'), where('active', '==', true)));
    coaches = snap.docs.map((d) => Object.assign({ uid: d.id }, d.data())).filter((c) => c.uid !== S.uid)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  } catch (e) { coaches = []; }
  const list = box.querySelector('#sh-list');
  list.innerHTML = coaches.length
    ? `<ul class="mp-coaches">${coaches.map((c) => `<li><label><input type="radio" name="sh-coach" value="${esc(c.uid)}"${g.coachUid === c.uid ? ' checked' : ''}> <span><b>${esc(c.name || 'Certified Coach')}</b>${c.location ? ` <span class="mp-sub">${esc(c.location)}</span>` : ''}</span></label></li>`).join('')}</ul>
       <p class="mp-sub">Find out more about each coach in the <a href="/coaches" target="_blank" rel="noopener" style="color:var(--white);">coach directory</a>.</p>`
    : '<p class="mp-sub" style="margin-top:12px;">No certified coaches are listed right now. Check the <a href="/coaches" style="color:var(--white);">coach directory</a> later.</p>';
  box.querySelector('#sh-save').addEventListener('click', async () => {
    const pick = box.querySelector('input[name="sh-coach"]:checked');
    if (!pick) { box.querySelector('#sh-msg').textContent = 'Choose a coach first.'; return; }
    await planOp(g.id, 'share', { coachUid: pick.value });
    track('plan_share', { goal: g.slug || g.source });
    closeModal();
  });
  const stop = box.querySelector('#sh-stop');
  if (stop) stop.addEventListener('click', async () => { await planOp(g.id, 'share', { coachUid: null }); closeModal(); });
}

function openSettings(g) {
  const r = g.reminders || {};
  const box = modal(`<h3>Goal settings</h3>
    <label class="pl-label" for="st-title">Goal</label>
    <input class="pl-input" id="st-title" maxlength="${TITLE_MAX}" value="${esc(g.title)}">
    ${g.reading && g.reading !== 'profile' ? `<label class="pl-label" for="st-target">Target score at review${g.reading === 'lower-better' ? ' (lower is better)' : ''}</label>
    <input class="pl-input" id="st-target" type="number" min="0" max="100" value="${typeof g.target === 'number' ? g.target : ''}" style="width:120px;">` : ''}
    <label class="pl-label" for="st-day">Weekly check-in day</label>
    <select class="pl-input" id="st-day" style="width:auto;">${DAY_NAMES.map((d, i) => `<option value="${i}"${g.checkinDay === i ? ' selected' : ''}>${d}</option>`).join('')}</select>
    <div class="pl-label">Remind me by</div>
    <label class="pl-check"><input type="checkbox" id="st-email"${r.email !== false ? ' checked' : ''}> Email</label>
    <label class="pl-check"><input type="checkbox" id="st-inapp"${r.inapp !== false ? ' checked' : ''}> A notice in my portal</label>
    <label class="pl-check"><input type="checkbox" id="st-push"${r.push === true ? ' checked' : ''}> Push notification</label>
    <p class="mp-msg" id="st-msg" role="status"></p>
    <div style="display:flex;gap:8px;margin-top:10px;"><button class="mp-btn red" type="button" id="st-save">Save</button><button class="mp-btn" type="button" id="st-cancel">Cancel</button></div>`);
  box.querySelector('#st-cancel').addEventListener('click', closeModal);
  box.querySelector('#st-save').addEventListener('click', async () => {
    const data = {
      title: box.querySelector('#st-title').value,
      checkinDay: Number(box.querySelector('#st-day').value),
      reminders: { email: box.querySelector('#st-email').checked, inapp: box.querySelector('#st-inapp').checked, push: box.querySelector('#st-push').checked }
    };
    const tg = box.querySelector('#st-target');
    if (tg) data.target = tg.value === '' ? null : Number(tg.value);
    if (data.reminders.push) {
      try { const { enablePush } = await import('./push.js'); await enablePush(S.uid); } catch (e) { data.reminders.push = false; }
    }
    const out = await planOp(g.id, 'editGoal', data, { quiet: true });
    if (out) closeModal();
    else box.querySelector('#st-msg').textContent = (S.msg[g.id] && S.msg[g.id].text) || 'That did not save.';
  });
}

function downloadIcs() {
  const ics = icsForGoals(S.goals);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-plan.ics';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  track('plan_calendar_export', { goals: activeCount(S.goals) });
}

// ── Events ─────────────────────────────────────────────────────────────────

const val = (id) => { const el = $(id); return el ? el.value : ''; };

async function onClick(e) {
  const btn = e.target.closest('[data-op]');
  if (!btn || btn.disabled) return;
  const op = btn.dataset.op;
  const id = btn.dataset.goal;
  const g = id ? S.goals.find((x) => x.id === id) : null;

  if (op === 'toggle') return; // handled on change
  if (op === 'print') { window.print(); return; }
  if (op === 'ics') { downloadIcs(); return; }
  if (op === 'cancel') { delete S.open[id]; render(); return; }
  if (op === 'open-checkin') { S.open[id] = 'checkin'; render(); const f = $(`ci-did-${id}`); if (f) f.focus(); return; }
  if (op === 'open-review') { S.open[id] = 'review'; render(); return; }
  if (op === 'edit-task') { S.open[id] = `edit:${btn.dataset.task}`; render(); return; }
  if (op === 'open-custom') { S.open.__custom = true; render(); const f = $('cu-title'); if (f) f.focus(); return; }
  if (op === 'close-custom') { delete S.open.__custom; render(); return; }
  if (op === 'share' && g) return openShare(g);
  if (op === 'settings' && g) return openSettings(g);

  btn.disabled = true;
  if (op === 'save-task') {
    await planOp(id, 'editTask', { taskId: btn.dataset.task, text: val(`et-${id}-${btn.dataset.task}`), due: val(`ed-${id}-${btn.dataset.task}`) || null });
    if (!S.msg[id]) { delete S.open[id]; render(); }
  } else if (op === 'delete-task') {
    await planOp(id, 'deleteTask', { taskId: btn.dataset.task });
    if (!S.msg[id]) { delete S.open[id]; render(); }
  } else if (op === 'add-task') {
    const text = val(`add-${id}`).trim();
    if (text.length < 2) { btn.disabled = false; const f = $(`add-${id}`); if (f) f.focus(); return; }
    await planOp(id, 'addTask', { text, due: val(`add-due-${id}`) || null });
  } else if (op === 'save-checkin') {
    const out = await planOp(id, 'checkin', { did: val(`ci-did-${id}`), blocked: val(`ci-blocked-${id}`), next: val(`ci-next-${id}`) });
    if (out) { delete S.open[id]; track('plan_checkin', { goal: g && (g.slug || g.source) }); render(); }
  } else if (op === 'save-review') {
    const pick = document.querySelector(`input[name="rv-${CSS.escape(id)}"]:checked`);
    const decision = pick ? pick.value : 'finish';
    const slug = g && g.slug;
    const out = await planOp(id, 'review', { decision, easier: val(`rv-easier-${id}`) });
    if (out) {
      delete S.open[id];
      track('plan_review', { goal: slug || (g && g.source), decision });
      if (decision === 'next' && slug) { location.href = `/plan-build?a=${encodeURIComponent(slug)}`; return; }
      await loadJournal();
      render();
    }
  } else if (op === 'focus') {
    await planOp(id, 'setFocus');
  } else if (op === 'status') {
    await planOp(id, 'setStatus', { status: btn.dataset.status });
  } else if (op === 'delete') {
    if (confirm(`Delete "${g ? g.title : 'this goal'}"? Its tasks and check-ins go with it. Your journal entries stay.`)) {
      await planOp(id, 'delete');
    }
  } else if (op === 'journal') {
    const text = val('jn-text').trim();
    if (text) {
      try { await call('managePlan', { op: 'journal', text }); await loadJournal(); } catch (err) { alert(err.message || 'That did not save.'); }
      render();
    }
  } else if (op === 'delete-journal') {
    if (confirm('Delete this journal entry?')) {
      try { await call('managePlan', { op: 'deleteJournal', entryId: btn.dataset.entry }); } catch (err) { /* reload shows the truth */ }
      await loadJournal();
      render();
    }
  } else if (op === 'save-custom') {
    const title = val('cu-title').trim();
    const lines = val('cu-tasks').split('\n').map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, MAX_TASKS);
    const msg = $('cu-msg');
    if (title.length < 3 || !lines.length) {
      msg.textContent = 'Name your goal and add at least one task.';
      msg.className = 'mp-msg err';
      btn.disabled = false;
      return;
    }
    const tasks = lines.map((text, i) => {
      const d = new Date(); d.setDate(d.getDate() + 7 * (i + 1) - 1);
      return { text, due: todayIso(d) };
    });
    try {
      await call('managePlan', { op: 'create', goals: [{ source: 'custom', title, tasks, startDate: today, checkinDay: new Date().getDay() }] });
      delete S.open.__custom;
      track('plan_saved', { source: 'custom' });
      await loadGoals();
      render();
    } catch (err) {
      msg.textContent = err.message || 'That did not save.';
      msg.className = 'mp-msg err';
      btn.disabled = false;
    }
  } else if (op === 'team') {
    const sel = $('team-co');
    const companyId = sel ? sel.value : S.companies[0].id;
    try { S.team = await call('getTeamPlanSummary', { companyId }); } catch (err) { S.team = null; alert(err.message || 'Team totals are unavailable right now.'); }
    render();
  }
  btn.disabled = false;
}

async function onChange(e) {
  const box = e.target.closest('[data-op="toggle"]');
  if (!box) return;
  const id = box.dataset.goal;
  const g = S.goals.find((x) => x.id === id);
  const t = g && (g.tasks || []).find((x) => x.id === box.dataset.task);
  if (!t) return;
  // Optimistic: the box stays checked while the save runs.
  t.done = box.checked;
  t.doneDate = box.checked ? today : null;
  render();
  await planOp(id, 'toggleTask', { taskId: t.id, done: t.done }, { quiet: true });
  if (box.checked) track('plan_task_done', { goal: g.slug || g.source });
}

// ── Boot ───────────────────────────────────────────────────────────────────

async function main() {
  if (!firebaseReady) { $('mp').innerHTML = '<p class="mp-sub">My Plan is unavailable right now. Check your connection and refresh.</p>'; return; }
  const user = await onAuthReady();
  if (!user) { location.replace('/login?next=' + encodeURIComponent('/plan' + location.hash)); return; }
  if (!(await ensureOnboarded(user))) return;
  S.uid = user.uid;
  renderShell({ current: 'plan' });
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });

  await Promise.all([loadGoals(), loadJournal(), loadResults(), loadCoach(), loadCompanies()]);
  render();
  const root = $('mp');
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);

  // Arriving from a reminder or the dashboard lands on that goal with the
  // due card open.
  const m = /^#goal-([A-Za-z0-9_-]+)$/.exec(location.hash);
  if (m) {
    const g = S.goals.find((x) => x.id === m[1]);
    if (g && reviewDue(g, today)) S.open[g.id] = 'review';
    else if (g && checkinDue(g, today)) S.open[g.id] = 'checkin';
    render();
    const el = document.getElementById(`goal-${m[1]}`);
    if (el) el.scrollIntoView({ block: 'start' });
  } else if (location.hash === '#coaching' || location.hash === '#journal' || location.hash === '#build') {
    const el = document.querySelector(location.hash);
    if (el) el.scrollIntoView({ block: 'start' });
  }

  let roleInfo = null;
  try { roleInfo = await getRoleInfo(); } catch (e) { /* member default */ }
  renderShell({ current: 'plan', role: roleInfo ? roleInfo.role : null });
  renderTopbar({ user: currentUser(), role: roleInfo ? roleInfo.role : null, currentPage: null, links: [], withSignOut: false });
}

main().catch((e) => {
  console.error('[plan] failed to load', e);
  $('mp').innerHTML = '<p class="mp-sub">We could not load your plan. Refresh to try again.</p>';
});

