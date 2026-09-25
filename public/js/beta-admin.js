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
import { loadCourses, getCourseBySlug, loadModulesMeta } from './courses-data.js';
import {
  testerProgress, paceBucket, attentionRank, bucketCounts, PACE_LABELS
} from './beta-progress.js';

const $ = (id) => document.getElementById(id);

const VIEWS = ['applicants', 'progress', 'cohort', 'feedback', 'readiness'];
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
function coursePicker(selected) {
  const chosen = (selected && selected.length) ? selected : [state.defaultSlug];
  if (!state.courses.length) {
    return '<span style="color:var(--gray-mid); font-size:12px;">No courses found.</span>';
  }
  return '<div class="camp-recipient-detail" data-course-picker>' + state.courses.map((c) => {
    const on = chosen.includes(c.slug);
    const label = c.status === 'live' ? c.title : `${c.title} (${c.status})`;
    return `<label class="camp-recipient-checkbox${on ? ' checked' : ''}">`
      + `<input type="checkbox" data-slug="${esc(c.slug)}"${on ? ' checked' : ''} /> ${esc(label)}</label>`;
  }).join('') + '</div>';
}

/** The ticked slugs inside `root`. */
function pickedCourses(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll('[data-slug]'))
    .filter((x) => x.checked)
    .map((x) => x.getAttribute('data-slug'));
}

/** Names for a list of slugs, for a sentence the operator has to act on. */
function courseNames(slugs) {
  return (slugs || []).map(courseTitle).join(', ');
}

/**
 * Warn before an approval that takes something away, then say what actually
 * happened — which is not always what was asked, because the server refuses to
 * revoke a course somebody paid for or one a kept bundle still unlocks.
 */
function confirmRemoval(email, before, slugs) {
  const removing = (before || []).filter((s) => !slugs.includes(s));
  if (!removing.length) return true;
  return confirm(
    `Remove ${courseNames(removing)} from ${email}?\n\n`
    + `They lose access immediately. Anything they paid for is kept automatically. `
    + `Re-tick and save to restore.`
  );
}

function outcomeLines(r) {
  const lines = [];
  if (r.granted && r.granted.length) lines.push(`Granted ${courseNames(r.granted)}.`);
  if (r.revoked && r.revoked.length) lines.push(`Removed ${courseNames(r.revoked)}.`);
  (r.blocked || []).forEach((b) => {
    const why = b.reason === 'paid' ? 'they paid for it separately'
      : b.reason === 'unlocked-by-kept-course' ? 'a course they still have includes it'
      : 'the beta never granted it';
    lines.push(`Kept ${courseTitle(b.slug)} — ${why}.`);
  });
  const failed = Object.keys(r.emailed || {}).filter((k) => r.emailed[k] === false);
  if (failed.length) lines.push(`Invite email failed for ${courseNames(failed)} — send those links yourself.`);
  return lines;
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
        <button class="btn btn-primary" data-act="approve">${declined ? 'Approve anyway' : 'Approve &amp; grant access'}</button>
        ${declined ? '' : '<button class="btn btn-ghost" data-act="decline">Decline</button>'}
      </div>
      <div style="margin-top:10px;">
        <div style="font-size:11px; font-family:'Space Mono',monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--gray-mid); margin-bottom:6px;">Courses</div>
        ${coursePicker(t.courseSlugs)}
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
    const t = state.rows.find((x) => x.email === email) || {};
    wireAction(btn, async () => {
      if (action === 'decline' && !confirm(`Decline ${email}?`)) {
        btn.disabled = false;
        return;
      }
      // The picker in this card decides what they get, so read it at click
      // time rather than trusting whatever the record was opened with.
      const row = btn.closest('.tester-row');
      const slugs = pickedCourses(row.querySelector('[data-course-picker]'));
      if (action === 'approve' && !slugs.length) {
        alert('Pick at least one course.');
        btn.disabled = false;
        return;
      }
      if (action === 'approve' && !confirmRemoval(email, t.courseSlugs, slugs)) {
        btn.disabled = false;
        return;
      }
      const r = await act(email, action, action === 'approve' ? { slugs } : undefined);
      if (action === 'approve') {
        // Report what happened rather than what was asked: the server refuses
        // to revoke a paid course or one a kept bundle still unlocks, and a
        // grant can land while its invite email fails. None of that shows in
        // the row, so it is said here.
        const lines = outcomeLines(r);
        if (r.pending) {
          lines.unshift(`${email} has no account yet. Access is parked and applies automatically the moment they sign up at /signup.html.`);
        }
        if (lines.length) alert(lines.join('\n'));
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
  const slugs = pickedCourses($('add-course-picker'));

  if (!name) { out.innerHTML = '<div class="auth-error">Please enter a name.</div>'; return; }
  if (!slugs.length) { out.innerHTML = '<div class="auth-error">Pick at least one course.</div>'; return; }
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
      slugs,
      approve
    });
    const d = (res && res.data) || {};
    // Adding somebody who already has a record is a no-op on their status, not
    // an error — say so rather than implying a new tester appeared.
    const lines = [d.existed
      ? `${email} was already on the list; their details were refreshed.`
      : `${name} added.`];
    let mailFailed = false;
    if (approve) {
      lines.push(d.pending
        ? 'They have no account yet, so access is parked and applies the moment they sign up.'
        : 'Access granted.');
      // `emailed` is one flag per course now, since an approval sends one
      // invite per course that is new to them.
      const failed = Object.keys(d.emailed || {}).filter((k) => d.emailed[k] === false);
      mailFailed = failed.length > 0;
      if (mailFailed) lines.push(`Invite email failed for ${courseNames(failed)} — send those links yourself.`);
    }
    out.innerHTML = `<div class="${mailFailed ? 'auth-error' : 'auth-ok'}">${esc(lines.join(' '))}</div>`;
    $('add-form').reset();
    $('add-approve').checked = false;
    $('add-course-picker').innerHTML = coursePicker([]);
    await load();
  } catch (e) {
    out.innerHTML = `<div class="auth-error">${esc(e && e.message ? e.message : e)}</div>`;
  } finally {
    btn.disabled = false;
  }
}

// ─── Progress ────────────────────────────────────────────────────────────
// Who is in, who is working, who is slipping. Built from the same
// listBetaTesters rows as the Cohort table; the judgement calls (pace, stall,
// projection) live in beta-progress.js so they are tested.

const modulesBySlug = new Map();   // slug -> [{ id, title }] once loaded
let coursesLoaded = null;
let progressFilter = 'all';

/** Module lists for every course in the cohort, loaded once per slug. */
async function ensureModules(slugs) {
  if (!coursesLoaded) coursesLoaded = loadCourses().catch(() => null);
  await coursesLoaded;
  const missing = slugs.filter((sl) => !modulesBySlug.has(sl));
  if (!missing.length) return false;
  await Promise.all(missing.map(async (sl) => {
    const course = getCourseBySlug(sl, { includeInactive: true }) || { slug: sl };
    try {
      const mods = await loadModulesMeta(course);
      modulesBySlug.set(sl, mods.map((m) => ({ id: m.id, title: m.title })));
    } catch (e) {
      modulesBySlug.set(sl, []);
    }
  }));
  return true;
}

function stars(n) {
  const k = Math.max(0, Math.min(5, Number(n) || 0));
  return `<span class="pg-stars" aria-label="${k} out of 5">${'★'.repeat(k)}${'☆'.repeat(5 - k)}</span>`;
}

function fmtIso(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function pacePill(p) {
  const cls = p.paceState === 'finished' ? 'completed'
    : p.paceState === 'on-pace' ? 'onpace'
    : p.paceState === 'no-plan' ? 'active'
    : p.paceState === 'not-started' ? 'waiting'
    : 'behind';
  let label = PACE_LABELS[p.paceState] || p.paceState;
  if (p.paceState === 'stalled' && p.idleDays != null) label = `Stalled ${p.idleDays}d`;
  if (p.paceState === 'not-started' && p.waitingDays != null) label = `Not started · ${p.waitingDays}d`;
  return `<span class="bstatus bstatus-${cls}">${esc(label)}</span>`;
}

/** One entry per tester-course pair, since pace is per course. */
function progressEntries() {
  const inCohort = state.rows.filter((r) => r.status !== 'applied' && r.status !== 'declined');
  const out = [];
  inCohort.forEach((t) => {
    t.courseSlugs.forEach((sl) => {
      const mods = modulesBySlug.get(sl) || [];
      const progress = testerProgress({
        doneIds: (t.doneIdsBySlug && t.doneIdsBySlug[sl]) || [],
        modules: mods,
        commitment: (t.commitmentBySlug && t.commitmentBySlug[sl]) || null,
        lastLessonAt: t.lastLessonAtBySlug && t.lastLessonAtBySlug[sl],
        startedAt: t.activatedAt || t.grantedAt,
        completedAt: t.completionBySlug && t.completionBySlug[sl]
      });
      out.push({ tester: t, slug: sl, progress, review: (t.reviewBySlug && t.reviewBySlug[sl]) || null });
    });
  });
  return out;
}

const TILES = [
  ['all', 'enrolled', 'Enrolled'],
  ['notStarted', 'notStarted', 'Not started'],
  ['working', 'working', 'Working'],
  ['slipping', 'slipping', 'Behind / stalled'],
  ['finished', 'finished', 'Finished'],
  ['reviewed', 'reviewed', 'Reviewed']
];

function courseBlock(e) {
  const p = e.progress;
  const t = e.tester;
  const lesson = p.paceState === 'finished'
    ? 'Finished every lesson'
    : p.currentLesson
      ? `Lesson ${p.currentLesson.number} of ${p.total}: <em>${esc(p.currentLesson.title)}</em>`
      : `${p.done} of ${p.total || '?'} lessons done`;
  const noAccount = !t.hasAccount ? ' · <span style="color:var(--red);">no account yet</span>' : '';
  const goal = p.goalDate
    ? `${fmtIso(p.goalDate)}${p.daysLeft != null && p.paceState !== 'finished' ? ` <span style="color:var(--gray-mid);">(${p.daysLeft >= 0 ? `${p.daysLeft}d left` : `${-p.daysLeft}d over`})</span>` : ''}`
    : '<span style="color:var(--gray-mid);">No goal set</span>';
  const projected = p.projectedFinish && p.paceState !== 'finished'
    ? `<div class="pg-v" style="font-size:12px; color:var(--gray-light);">On this pace: ${fmtIso(p.projectedFinish)}</div>` : '';
  const review = e.review
    ? `${stars(e.review.rating)} <span style="font-size:11px; color:var(--gray-mid);">${esc(e.review.status)}</span>`
    : (p.paceState === 'finished' ? '<span style="color:var(--gray-mid);">Asked, not yet</span>' : '<span style="color:var(--gray-mid);">—</span>');
  return `
    <div class="pg-course">
      <div>
        <div class="pg-course-name">${esc(courseTitle(e.slug))}${noAccount}</div>
        <div class="pg-bar"><div class="pg-bar-fill${p.paceState === 'finished' ? ' is-done' : ''}" style="width:${p.paceState === 'finished' ? 100 : p.pct}%"></div></div>
        <div class="pg-lesson">${p.paceState === 'finished' ? '' : `<strong>${p.pct}%</strong> · `}${lesson}</div>
      </div>
      <div>
        <div class="pg-k">Goal date</div>
        <div class="pg-v">${goal}</div>
        ${projected}
      </div>
      <div>
        <div class="pg-k">Pace · last lesson</div>
        <div class="pg-v">${pacePill(p)} <span style="font-size:12px; color:var(--gray-light);">${fmtAgo(e.tester.lastLessonAtBySlug && e.tester.lastLessonAtBySlug[e.slug])}</span></div>
        <div class="pg-k" style="margin-top:8px;">Review</div>
        <div class="pg-v">${review}</div>
      </div>
    </div>`;
}

function renderProgressView() {
  const entries = progressEntries();
  const counts = bucketCounts(entries);

  $('progress-tiles').innerHTML = TILES.map(([key, countKey, label]) => `
    <button type="button" class="pg-tile${progressFilter === key ? ' is-active' : ''}" data-filter="${key}">
      <div class="pg-tile-num">${counts[countKey] || 0}</div>
      <div class="pg-tile-label">${label}</div>
    </button>`).join('');
  $('progress-tiles').querySelectorAll('[data-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      progressFilter = progressFilter === b.dataset.filter ? 'all' : b.dataset.filter;
      renderProgressView();
    });
  });

  const keep = entries.filter((e) => progressFilter === 'all'
    || (progressFilter === 'reviewed' ? !!e.review : paceBucket(e.progress) === progressFilter));

  // Group back to one card per tester, most urgent course deciding the order.
  const byTester = new Map();
  keep.forEach((e) => {
    if (!byTester.has(e.tester.email)) byTester.set(e.tester.email, []);
    byTester.get(e.tester.email).push(e);
  });
  const groups = Array.from(byTester.values())
    .map((list) => ({ list, rank: Math.min(...list.map((e) => attentionRank(e.progress))) }))
    .sort((a, b) => a.rank - b.rank
      || (a.list[0].tester.name || a.list[0].tester.email).localeCompare(b.list[0].tester.name || b.list[0].tester.email));

  $('progress-list').innerHTML = groups.length ? groups.map(({ list, rank }) => {
    const t = list[0].tester;
    return `
      <div class="pg-row${rank <= 3 ? ' is-attention' : ''}">
        <div class="tester-top">
          <div class="tester-id">
            <div class="tester-name">${esc(t.name || t.email)}</div>
            <div class="tester-email">${esc(t.email)}</div>
          </div>
          <div class="tester-meta" style="margin-top:0;">
            ${t.phone ? `<span>${esc(t.phone)}</span>` : ''}
            <span>Last active ${fmtAgo(t.lastActiveAt)}</span>
            ${t.crmContactId ? `<a href="/contact.html?id=${encodeURIComponent(t.crmContactId)}" style="color:var(--red);">CRM record →</a>` : ''}
          </div>
        </div>
        ${list.map(courseBlock).join('')}
      </div>`;
  }).join('') : `<div class="empty-note">${entries.length ? 'Nobody matches this filter.' : 'Nobody approved yet. Approve testers on the Applicants tab.'}</div>`;

  renderPendingReviews(entries);
}

function renderPendingReviews(entries) {
  const pending = entries.filter((e) => e.review && e.review.status === 'pending');
  $('reviews-card').style.display = pending.length ? '' : 'none';
  $('reviews-pending').innerHTML = pending.map((e) => `
    <div class="rv-row" data-review="${esc(e.review.id)}">
      <div class="fb-top">
        ${stars(e.review.rating)}
        <span class="fb-who">${esc(e.tester.name || e.tester.email)}</span>
        <span style="font-size:11px; color:var(--gray-mid);">${esc(courseTitle(e.slug))} · ${fmtDate(e.review.createdAt)}</span>
      </div>
      <div class="rv-text-admin">${e.review.text ? esc(e.review.text) : '<span style="color:var(--gray-mid);">Rating only, no written review.</span>'}</div>
      <div class="tester-actions">
        <button class="btn btn-primary" data-decide="approve">Approve &amp; publish</button>
        <button class="btn btn-ghost" data-decide="reject">Keep private</button>
      </div>
    </div>`).join('');
  $('reviews-pending').querySelectorAll('[data-decide]').forEach((btn) => {
    const id = btn.closest('[data-review]').dataset.review;
    wireAction(btn, async () => {
      await httpsCallable(functions, 'moderateCourseReview')({ id, decision: btn.dataset.decide });
      await load();
    });
  });
}

function renderProgress() {
  renderProgressView();
  // Titles arrive after the first paint; percentages already use the counts.
  const slugs = Array.from(new Set(state.rows.flatMap((r) => r.courseSlugs || [])));
  ensureModules(slugs).then((changed) => { if (changed) renderProgressView(); });
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
      <td style="font-size:12px;">${courseCell(t)}</td>
      <td>${account}</td>
      <td class="num">${t.lessonsCompleted || 0}</td>
      <td class="num">${t.feedbackCount || 0}</td>
      <td>${fmtAgo(t.lastActiveAt)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-ghost" data-act="edit-courses" style="padding:2px 10px; font-size:11px;">Courses</button>
        ${t.status === 'completed' ? '' : '<button class="btn btn-ghost" data-act="complete" style="padding:2px 10px; font-size:11px;">Mark done</button>'}
      </td>
    </tr>
    <tr data-editor="${esc(t.email)}" hidden>
      <td colspan="8" style="background:rgba(255,255,255,.02);">
        <div style="font-size:11px; font-family:'Space Mono',monospace; letter-spacing:.08em; text-transform:uppercase; color:var(--gray-mid); margin-bottom:6px;">Courses for ${esc(t.name || t.email)}</div>
        ${coursePicker(t.courseSlugs)}
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn btn-primary" data-act="save-courses" style="padding:4px 12px; font-size:12px;">Save</button>
          <button class="btn btn-ghost" data-act="cancel-courses" style="padding:4px 12px; font-size:12px;">Cancel</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-act="complete"]').forEach((btn) => {
    const email = btn.closest('tr').dataset.email;
    wireAction(btn, () => act(email, 'complete'));
  });

  // Editing courses lives here, not on the Applicants tab: once somebody is
  // approved they leave Applicants, so this is the only place their course
  // list can be changed — and the only place a course can be taken back.
  body.querySelectorAll('[data-act="edit-courses"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const email = btn.closest('tr').dataset.email;
      const editor = body.querySelector(`[data-editor="${CSS.escape(email)}"]`);
      if (editor) editor.hidden = !editor.hidden;
    });
  });
  body.querySelectorAll('[data-act="cancel-courses"]').forEach((btn) => {
    btn.addEventListener('click', () => { btn.closest('[data-editor]').hidden = true; });
  });
  body.querySelectorAll('[data-act="save-courses"]').forEach((btn) => {
    const editorRow = btn.closest('[data-editor]');
    const email = editorRow.getAttribute('data-editor');
    const t = state.rows.find((x) => x.email === email) || {};
    wireAction(btn, async () => {
      const slugs = pickedCourses(editorRow.querySelector('[data-course-picker]'));
      if (!slugs.length) { alert('Pick at least one course.'); btn.disabled = false; return; }
      if (!confirmRemoval(email, t.courseSlugs, slugs)) { btn.disabled = false; return; }
      const r = await act(email, 'approve', { slugs });
      const lines = outcomeLines(r);
      if (lines.length) alert(lines.join('\n'));
    });
  });
}

/** One line per course, with the lesson count and a flag for anything not applied. */
function courseCell(t) {
  const slugs = t.courseSlugs && t.courseSlugs.length ? t.courseSlugs : [t.courseSlug];
  return slugs.map((sl) => {
    const done = (t.lessonsBySlug && t.lessonsBySlug[sl]) || 0;
    // A course on the record that never reached their account is the state
    // worth seeing: the grant is parked, or the revoke half-landed.
    const pending = t.hasAccount && t.enrolledBySlug && t.enrolledBySlug[sl] === false
      ? ' <span style="color:var(--red);">not applied</span>' : '';
    return `<div>${esc(courseTitle(sl))} <span style="color:var(--gray-mid);">· ${done}</span>${pending}</div>`;
  }).join('');
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
  const addCourse = $('add-course-picker');
  if (addCourse) {
    // Keep whatever is ticked across a refresh, so a load triggered by another
    // action does not wipe a half-filled form.
    const keep = pickedCourses(addCourse);
    addCourse.innerHTML = coursePicker(keep);
  }
  renderApplicants();
  renderProgress();
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
  // Chip state, the same wiring campaigns.js uses for its recipient picker.
  document.addEventListener('change', (e) => {
    const cb = e.target.closest('.camp-recipient-checkbox input');
    if (cb) cb.closest('.camp-recipient-checkbox').classList.toggle('checked', cb.checked);
  });
  $('btn-refresh').addEventListener('click', load);
  $('btn-refresh-progress').addEventListener('click', load);

  const wanted = new URLSearchParams(location.search).get('view');
  showView(VIEWS.includes(wanted) ? wanted : 'applicants');

  await load();
}

main();
