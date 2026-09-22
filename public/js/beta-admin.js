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

let state = { rows: [], feedback: [], summary: {}, courses: [], defaultSlug: '' };

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
    state = {
      rows: d.rows || [],
      feedback: d.feedback || [],
      summary: d.summary || {},
      courses: d.courses || [],
      defaultSlug: d.defaultSlug || ''
    };
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

/**
 * Options for a course picker, with `selected` chosen.
 *
 * A beta can run on more than one course at once, so which course an approval
 * grants is a decision per tester, not a constant. Before this the grant
 * always fell through to the default slug and the choice was invisible.
 */
function courseOptions(selected) {
  const chosen = selected || state.defaultSlug;
  if (!state.courses.length) {
    return `<option value="">No courses found</option>`;
  }
  return state.courses.map((c) => {
    const label = c.status === 'live' ? c.title : `${c.title} (${c.status})`;
    return `<option value="${esc(c.slug)}"${c.slug === chosen ? ' selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

/** A course's title for display, falling back to the slug it was granted under. */
function courseTitle(slug) {
  const c = state.courses.find((x) => x.slug === slug);
  return c ? c.title : (slug || '—');
}

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
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--gray-light);">
          Course
          <select data-course style="background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:4px 8px; font-size:12px;">
            ${courseOptions(t.courseSlug)}
          </select>
        </label>
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
      // The picker beside this button decides what they get, so read it at
      // click time rather than trusting whatever the record was opened with.
      const picker = btn.closest('.tester-row').querySelector('[data-course]');
      const slug = picker && picker.value ? picker.value : undefined;
      const r = await act(email, action, action === 'approve' ? { slug } : undefined);
      if (action === 'approve') {
        // An approval that granted access but could not send the invite is
        // the one outcome the row cannot show, and the one that leaves a
        // tester waiting on an email that never arrives. Say it here.
        const mail = r.emailed === false
          ? ' Their invite email could not be sent, so send them the link yourself.'
          : '';
        if (r.pending) {
          alert(`${email} has no account yet. Access is parked and applies automatically the moment they sign up at /signup.html.${mail || ' Their invite email is on the way with the signup link.'}`);
        } else if (mail) {
          alert(`${email} now has access.${mail}`);
        }
      }
    });
  });
}

// ─── Add a tester by hand ────────────────────────────────────────────────
// For somebody invited directly who will never fill in the beta form. Without
// this they have no record, so granting them the course from the builder
// leaves them invisible to the Cohort tab and their feedback uncounted.

async function addTester(ev) {
  ev.preventDefault();
  const out = $('add-result');
  const btn = $('add-submit');
  const name = $('add-name').value.trim();
  const email = $('add-email').value.trim();
  const approve = $('add-approve').checked;

  if (!name) { out.innerHTML = '<div class="auth-error">Please enter a name.</div>'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    out.innerHTML = '<div class="auth-error">Please enter a valid email.</div>';
    return;
  }
  if (approve && !confirm(`Add ${email} and approve them now? This grants course access and sends their invite.`)) return;

  btn.disabled = true;
  out.innerHTML = '<div style="color:var(--gray-light); font-size:12px;">Adding…</div>';
  try {
    const res = await httpsCallable(functions, 'setBetaTesterStatus')({
      action: 'add',
      name,
      email,
      phone: $('add-phone').value.trim() || undefined,
      slug: $('add-course').value || undefined,
      approve
    });
    const d = (res && res.data) || {};
    // Adding somebody who already has a record is a no-op on their status, not
    // an error — say so rather than implying a new tester appeared.
    const lines = [d.existed
      ? `${email} was already on the list; their details were refreshed.`
      : `${name} added.`];
    if (approve) {
      lines.push(d.pending
        ? 'They have no account yet, so access is parked and applies the moment they sign up.'
        : 'Access granted.');
      if (d.emailed === false) lines.push('Their invite email could not be sent, so send them the link yourself.');
    }
    out.innerHTML = `<div class="${d.emailed === false ? 'auth-error' : 'auth-ok'}">${esc(lines.join(' '))}</div>`;
    $('add-form').reset();
    $('add-approve').checked = false;
    await load();
  } catch (e) {
    out.innerHTML = `<div class="auth-error">${esc(e && e.message ? e.message : e)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ─── Cohort ──────────────────────────────────────────────────────────────

function renderCohort() {
  const filter = $('filter-cohort').value;
  const inCohort = state.rows.filter((r) => r.status !== 'applied' && r.status !== 'declined');
  const rows = filter === 'all' ? inCohort : inCohort.filter((r) => r.status === filter);
  const body = $('cohort-body');

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" style="color:var(--gray-mid);">Nobody in the cohort matches this filter.</td></tr>';
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
      <td style="font-size:12px;">${esc(courseTitle(t.courseSlug))}</td>
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
  // Rebuilt on every load so a course added in the builder shows up here
  // without a reload, and the current selection survives the refresh.
  const addCourse = $('add-course');
  if (addCourse) {
    const keep = addCourse.value;
    addCourse.innerHTML = courseOptions(keep || state.defaultSlug);
  }
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
  // 'beta-admin' matches this page's key in the topbar's privileged menu, so
  // the menu drops Beta (where we already are) and keeps Owner reachable.
  renderTopbar({ user: u, role: info.role, currentPage: 'beta-admin' });
  if (info.role !== 'owner') {
    gate(`You are signed in as <b>${esc(u.email)}</b> but your role is <b>${esc(info.role)}</b>. Owner access required.`);
    return;
  }

  $('panel').style.display = 'block';

  document.querySelectorAll('.console-tab').forEach((t) =>
    t.addEventListener('click', () => showView(t.dataset.view)));
  $('filter-cohort').addEventListener('change', renderCohort);
  $('add-form').addEventListener('submit', addTester);
  $('btn-refresh').addEventListener('click', load);

  const wanted = new URLSearchParams(location.search).get('view');
  showView(VIEWS.includes(wanted) ? wanted : 'applicants');

  await load();
}

main();
