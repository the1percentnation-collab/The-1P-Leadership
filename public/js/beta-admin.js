// Beta console: one place for the whole beta program.
//
// Applications used to land in the CRM as leads tagged "Beta Tester", access
// was granted by hand from the course builder, and feedback arrived as generic
// bug reports. Nothing joined those three, so the cohort existed only in
// Anthony's head. This page reads the betaTesters record that now backs all of
// them, through the listBetaTesters callable, which does the join server-side.
//
// Every write goes through setBetaTesterStatus — approving a tester issues the
// course grant in the same call, which is what replaces the prompt chain in
// manage-courses for beta access.

import { functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);

const VIEWS = ['applicants', 'cohort', 'feedback', 'readiness'];
const STATUS_LABELS = {
  applied: 'Applied',
  declined: 'Declined',
  granted: 'Granted',
  active: 'Active',
  completed: 'Completed'
};

let state = { rows: [], feedback: [], summary: {} };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtAgo(ms) {
  if (!ms) return 'never';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return fmtDate(ms);
}

function statusPill(status) {
  const s = STATUS_LABELS[status] ? status : 'applied';
  return `<span class="bstatus bstatus-${s}">${STATUS_LABELS[s]}</span>`;
}

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${msg}</div></div>`;
}

function showView(name) {
  VIEWS.forEach((v) => {
    const el = $(`view-${v}`);
    if (el) el.style.display = v === name ? 'block' : 'none';
  });
  document.querySelectorAll('.console-tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.view === name));
  // Deep-linkable, so a tab survives a reload and can be shared.
  const url = new URL(location.href);
  url.searchParams.set('view', name);
  history.replaceState(null, '', url);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ─── Data ────────────────────────────────────────────────────────────────

async function load() {
  $('loading').style.display = '';
  $('load-error').style.display = 'none';
  try {
    const res = await httpsCallable(functions, 'listBetaTesters')({});
    const d = (res && res.data) || {};
    state = { rows: d.rows || [], feedback: d.feedback || [], summary: d.summary || {} };
    renderAll();
  } catch (e) {
    $('load-error').style.display = '';
    $('load-error').innerHTML = `<div class="card"><div class="auth-error">Could not load the beta program: ${esc(e && e.message ? e.message : e)}</div></div>`;
  } finally {
    $('loading').style.display = 'none';
  }
}

async function act(email, action, opts) {
  const payload = { email, action, ...(opts || {}) };
  const res = await httpsCallable(functions, 'setBetaTesterStatus')(payload);
  await load();
  return (res && res.data) || {};
}

// Buttons disable themselves for the round trip so a double click can't send
// two grants, and re-enable if the call fails (a success re-renders the row).
function wireAction(el, handler) {
  el.addEventListener('click', async () => {
    el.disabled = true;
    try {
      await handler();
    } catch (e) {
      alert(`Could not do that: ${e && e.message ? e.message : e}`);
      el.disabled = false;
    }
  });
}

// ─── Applicants ──────────────────────────────────────────────────────────

function applicantCard(t, { declined }) {
  const why = t.why
    ? `<div class="tester-why">${esc(t.why)}</div>`
    : '<div class="tester-why" style="color:var(--gray-mid);">No note given.</div>';
  return `
    <div class="tester-row" data-email="${esc(t.email)}">
      <div class="tester-top">
        <div class="tester-id">
          <div class="tester-name">${esc(t.name || 'Unnamed applicant')}</div>
          <div class="tester-email">${esc(t.email)}</div>
        </div>
        ${statusPill(t.status)}
      </div>
      ${why}
      <div class="tester-meta">
        <span>Applied ${fmtDate(t.appliedAt)}</span>
        <span>${t.hasAccount ? 'Has an account' : 'No account yet'}</span>
        ${t.phone ? `<span>${esc(t.phone)}</span>` : ''}
        ${t.crmContactId ? `<a href="/contact.html?id=${encodeURIComponent(t.crmContactId)}" style="color:var(--red);">CRM record →</a>` : ''}
      </div>
      <div class="tester-actions">
        <button class="btn btn-primary" data-act="approve">${declined ? 'Approve anyway' : 'Approve &amp; grant access'}</button>
        ${declined ? '' : '<button class="btn btn-ghost" data-act="decline">Decline</button>'}
      </div>
    </div>`;
}

function renderApplicants() {
  const pending = state.rows.filter((r) => r.status === 'applied');
  const declined = state.rows.filter((r) => r.status === 'declined');

  $('applicants-list').innerHTML = pending.length
    ? pending.map((t) => applicantCard(t, { declined: false })).join('')
    : '<div class="empty-note">No applications waiting on a decision.</div>';

  $('declined-list').innerHTML = declined.length
    ? declined.map((t) => applicantCard(t, { declined: true })).join('')
    : '<div class="empty-note">Nobody declined.</div>';

  document.querySelectorAll('#view-applicants [data-act]').forEach((btn) => {
    const email = btn.closest('.tester-row').dataset.email;
    const action = btn.dataset.act;
    wireAction(btn, async () => {
      if (action === 'decline' && !confirm(`Decline ${email}?`)) {
        btn.disabled = false;
        return;
      }
      const r = await act(email, action);
      if (action === 'approve' && r.pending) {
        alert(`${email} has no account yet. Access is parked and applies automatically the moment they sign up at /signup.html.`);
      }
    });
  });
}

// ─── Cohort ──────────────────────────────────────────────────────────────

function renderCohort() {
  const filter = $('filter-cohort').value;
  const inCohort = state.rows.filter((r) => r.status !== 'applied' && r.status !== 'declined');
  const rows = filter === 'all' ? inCohort : inCohort.filter((r) => r.status === filter);
  const body = $('cohort-body');

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" style="color:var(--gray-mid);">Nobody in the cohort matches this filter.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((t) => {
    // A granted tester with no account is the one state worth flagging: the
    // grant is parked and nothing happens until they sign up.
    const account = t.hasAccount
      ? (t.enrolled ? 'Enrolled' : 'Signed up')
      : '<span style="color:var(--red);">Not signed up</span>';
    return `<tr data-email="${esc(t.email)}">
      <td>
        <div>${esc(t.name || '—')}</div>
        <div style="font-size:11px; color:var(--gray-light); font-family:'Space Mono',monospace;">${esc(t.email)}</div>
      </td>
      <td>${statusPill(t.status)}</td>
      <td>${account}</td>
      <td class="num">${t.lessonsCompleted || 0}</td>
      <td class="num">${t.feedbackCount || 0}</td>
      <td>${fmtAgo(t.lastActiveAt)}</td>
      <td>${t.status === 'completed' ? '' : '<button class="btn btn-ghost" data-act="complete" style="padding:2px 10px; font-size:11px;">Mark done</button>'}</td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-act="complete"]').forEach((btn) => {
    const email = btn.closest('tr').dataset.email;
    wireAction(btn, () => act(email, 'complete'));
  });
}

// ─── Feedback ────────────────────────────────────────────────────────────

function renderFeedback() {
  const byEmail = new Map(state.rows.map((r) => [r.email, r]));
  const list = $('feedback-list');
  if (!state.feedback.length) {
    list.innerHTML = '<div class="empty-note">No feedback from beta testers yet.</div>';
    return;
  }
  list.innerHTML = state.feedback.map((f) => {
    const who = byEmail.get(f.email);
    return `<div class="fb-row">
      <div class="fb-top">
        <span class="fb-who">${esc(who && who.name ? who.name : f.email)}</span>
        <span class="bstatus bstatus-${f.status === 'resolved' ? 'active' : 'granted'}">${esc(f.status)}</span>
        <span style="font-size:11px; color:var(--gray-mid);">${esc(f.severity)} · ${fmtDate(f.createdAt)}</span>
      </div>
      <div class="fb-body">${esc(f.description).slice(0, 400)}</div>
      ${f.pageUrl ? `<div style="font-size:11px; color:var(--gray-mid); margin-top:4px;">${esc(f.pageUrl)}</div>` : ''}
    </div>`;
  }).join('');
}

// ─── Readiness ───────────────────────────────────────────────────────────

function renderReadiness() {
  const s = state.summary || {};
  const stats = [
    ['Applied', s.total || 0, 'all time'],
    ['In cohort', s.inCohort || 0, 'approved testers'],
    ['Started the course', s.started || 0, 'at least one lesson'],
    ['Gave feedback', s.withFeedback || 0, 'at least one report']
  ];
  $('readiness-stats').innerHTML = stats.map(([label, value, sub]) => `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>`).join('');

  const cohort = s.inCohort || 0;
  const stranded = state.rows.filter((r) => r.status === 'granted' && !r.hasAccount).length;
  const silent = state.rows.filter(
    (r) => (r.status === 'active' || r.status === 'completed') && !r.feedbackCount
  ).length;
  const openFeedback = state.feedback.filter((f) => f.status !== 'resolved').length;

  const gates = [
    [cohort >= 5, `${cohort} tester${cohort === 1 ? '' : 's'} in the cohort`, 'aim for 5 or more'],
    [stranded === 0, `${stranded} granted tester${stranded === 1 ? '' : 's'} never signed up`, 'chase these, the grant is parked'],
    [(s.started || 0) >= Math.ceil(cohort / 2) && cohort > 0, `${s.started || 0} of ${cohort} started the course`, 'half the cohort is the bar'],
    [silent === 0 && cohort > 0, `${silent} active tester${silent === 1 ? '' : 's'} have said nothing`, 'ask them directly'],
    [openFeedback === 0, `${openFeedback} beta report${openFeedback === 1 ? '' : 's'} still open`, 'close these before launch']
  ];

  $('readiness-gates').innerHTML = gates.map(([pass, text, hint]) => `
    <div class="ready-line">
      <div class="ready-mark" style="color:${pass ? '#4ade80' : 'var(--red)'};">${pass ? '✓' : '•'}</div>
      <div class="ready-text">${text}</div>
      <div class="ready-num">${hint}</div>
    </div>`).join('');
}

function renderAll() {
  renderApplicants();
  renderCohort();
  renderFeedback();
  renderReadiness();
}

// ─── Boot ────────────────────────────────────────────────────────────────

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/beta-admin.html')); return; }

  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: 'owner' });
  if (info.role !== 'owner') {
    gate(`You are signed in as <b>${esc(u.email)}</b> but your role is <b>${esc(info.role)}</b>. Owner access required.`);
    return;
  }

  $('panel').style.display = 'block';

  document.querySelectorAll('.console-tab').forEach((t) =>
    t.addEventListener('click', () => showView(t.dataset.view)));
  $('filter-cohort').addEventListener('change', renderCohort);
  $('btn-refresh').addEventListener('click', load);

  const wanted = new URLSearchParams(location.search).get('view');
  showView(VIEWS.includes(wanted) ? wanted : 'applicants');

  await load();
}

main();
