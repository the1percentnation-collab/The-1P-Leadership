// CRM Dashboard — macro sales view and the standing reports.
//
// Everything here is computed from the company's own contacts, opportunities
// and tasks, client-side. No model, no API cost, no rate limit, and the
// numbers are exact rather than summarized: "who has gone stagnant" and "who
// needs contacting" are database questions, and paying a language model to
// phrase a count Firestore already has is the wrong trade.
//
// The CRM assistant (the chatbot in CRM mode) is for the questions this page
// cannot anticipate — "what's the story with Jane Cole" — not for these.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import {
  ensureDefaultPipeline, listOpportunities, listTasks, listContacts, listCompanyAdmins,
  contactFreshness, CONTACT_FRESHNESS, taskBucket, STAGES,
  escapeHtml, fmtMoney, fmtDate, toDate
} from './crm.js';

const $ = (id) => document.getElementById(id);
const state = {
  uid: null, companyId: null,
  contacts: [], opps: [], tasks: [], admins: [],
  // Which report row is expanded. Reports answer "how many"; the drill-down
  // answers "who", which is the question you actually act on.
  open: null
};

function startOfMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday() { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
function daysAgo(n) { return new Date(Date.now() - n * 86400000); }

function widget(label, value, sub, opts = {}) {
  return `<div class="crm-widget ${opts.accent ? 'crm-widget-accent' : ''} ${opts.soon ? 'crm-widget-soon' : ''}">
    <div class="crm-widget-label">${escapeHtml(label)}</div>
    <div class="crm-widget-value">${value}</div>
    ${sub ? `<div class="crm-widget-sub">${escapeHtml(sub)}</div>` : ''}
  </div>`;
}

function ownerName(uid) {
  if (!uid) return 'Unassigned';
  const a = state.admins.find((x) => x.uid === uid);
  return a ? (a.displayName || a.email || 'Unknown') : 'Unknown';
}

/** A bar row: label, count, proportional bar, and a click target for the who. */
function barRow(key, label, count, total, color, sub) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <button class="rep-row ${state.open === key ? 'open' : ''}" data-report-row="${escapeHtml(key)}">
      <span class="rep-row-label">${escapeHtml(label)}</span>
      <span class="rep-bar"><span class="rep-bar-fill" style="width:${pct}%;background:${color}"></span></span>
      <span class="rep-row-count">${count}</span>
      <span class="rep-row-pct">${pct}%</span>
      ${sub ? `<span class="rep-row-sub">${escapeHtml(sub)}</span>` : ''}
    </button>`;
}

/** The named contacts behind a number, capped so one band cannot fill the page. */
function drillHtml(rows, emptyText) {
  if (!rows.length) return `<div class="rep-drill"><div class="crm-subpanel-empty">${escapeHtml(emptyText)}</div></div>`;
  const shown = rows.slice(0, 25);
  return `<div class="rep-drill">
    ${shown.map((c) => {
      const f = contactFreshness(c);
      return `<a class="rep-drill-row" href="/contact.html?id=${encodeURIComponent(c.id)}">
        <span class="rep-drill-name">${escapeHtml(c.name || 'Unnamed')}</span>
        <span class="rep-drill-meta">${escapeHtml(c.companyName || '')}</span>
        <span class="crm-fresh-pill" style="--fresh-color:${f.color}">${escapeHtml(f.never ? 'Never' : f.short)}</span>
      </a>`;
    }).join('')}
    ${rows.length > shown.length ? `<div class="rep-drill-more">+ ${rows.length - shown.length} more — open Contacts and sort by Last Contacted</div>` : ''}
  </div>`;
}

function reportCard(title, subtitle, body) {
  return `<div class="card rep-card">
    <div class="rep-head">
      <span class="rep-title">${escapeHtml(title)}</span>
      <span class="rep-sub">${escapeHtml(subtitle)}</span>
    </div>
    ${body}
  </div>`;
}

// ── The reports ─────────────────────────────────────────────────

/**
 * Who has gone quiet. The report this whole change was built for: it reads
 * lastContactedAt, so a lead you merely re-tagged last week still shows as
 * untouched for however long it has actually been.
 */
function stalenessReport() {
  const buckets = {};
  ['never', ...CONTACT_FRESHNESS.map((b) => b.id)].forEach((k) => { buckets[k] = []; });
  state.contacts.forEach((c) => { buckets[contactFreshness(c).id].push(c); });

  const order = [
    { id: 'cold', label: 'Cold — over 30 days' },
    { id: 'stagnant', label: 'Stagnant — 14 to 30 days' },
    { id: 'never', label: 'Never contacted' },
    { id: 'cooling', label: 'Cooling — 7 to 14 days' },
    { id: 'warm', label: 'Warm — under 7 days' }
  ];
  const total = state.contacts.length;
  const colorOf = (id) => id === 'never' ? '#6E6E6E' : (CONTACT_FRESHNESS.find((b) => b.id === id) || {}).color;

  const needsAttention = buckets.cold.length + buckets.stagnant.length + buckets.never.length;
  const byOldest = (a, b) => (toDate(a.lastContactedAt)?.getTime() || 0) - (toDate(b.lastContactedAt)?.getTime() || 0);

  return reportCard(
    'Who needs contacting',
    `${needsAttention} of ${total} need attention`,
    order.map((o) => {
      const rows = buckets[o.id].slice().sort(byOldest);
      return barRow(`stale:${o.id}`, o.label, rows.length, total, colorOf(o.id))
        + (state.open === `stale:${o.id}` ? drillHtml(rows, 'Nobody in this band.') : '');
    }).join('')
  );
}

/** Follow-ups, by urgency, with who owns them. */
function tasksReport() {
  const open = state.tasks.filter((t) => t.status !== 'done');
  const groups = [
    { id: 'overdue', label: 'Overdue', color: '#8B4A4A' },
    { id: 'today', label: 'Due today', color: '#E8C547' },
    { id: 'upcoming', label: 'Upcoming', color: '#5AA8E6' },
    { id: 'nodate', label: 'No due date', color: '#6E6E6E' }
  ].map((g) => ({ ...g, rows: open.filter((t) => taskBucket(t) === g.id) }));

  const overdue = groups[0].rows.length;
  return reportCard(
    'Follow-ups',
    overdue ? `${overdue} overdue` : 'nothing overdue',
    groups.map((g) => {
      const body = state.open === `task:${g.id}`
        ? `<div class="rep-drill">${g.rows.length
          ? g.rows.slice(0, 25).map((t) => `<a class="rep-drill-row" href="${t.contactId ? '/contact.html?id=' + encodeURIComponent(t.contactId) : '/tasks.html'}">
              <span class="rep-drill-name">${escapeHtml(t.title)}</span>
              <span class="rep-drill-meta">${escapeHtml(t.contactName || '')} · ${escapeHtml(ownerName(t.assigneeUid))}</span>
              <span class="rep-drill-meta">${t.dueAt ? fmtDate(t.dueAt) : '—'}</span>
            </a>`).join('')
          : '<div class="crm-subpanel-empty">Nothing here.</div>'}</div>`
        : '';
      return barRow(`task:${g.id}`, g.label, g.rows.length, open.length, g.color) + body;
    }).join('')
  );
}

/** Real outreach in the last 7 and 30 days, by channel. Counts distinct
 *  contacts reached, which is what "how many did we contact" means. */
function outreachReport() {
  const windows = [7, 30];
  const rows = windows.map((w) => {
    const since = daysAgo(w);
    const touched = state.contacts.filter((c) => {
      const d = toDate(c.lastContactedAt);
      return d && d >= since;
    });
    const byChannel = {};
    touched.forEach((c) => {
      const k = c.lastContactChannel || 'other';
      byChannel[k] = (byChannel[k] || 0) + 1;
    });
    const inbound = touched.filter((c) => c.lastContactDirection === 'in').length;
    const created = state.contacts.filter((c) => {
      const d = toDate(c.createdAt);
      return d && d >= since;
    }).length;
    return { w, touched, byChannel, inbound, created };
  });

  return reportCard(
    'Outreach',
    'distinct contacts reached, not messages sent',
    `<div class="rep-grid">
      ${rows.map((r) => `
        <div class="rep-stat">
          <div class="rep-stat-value">${r.touched.length}</div>
          <div class="rep-stat-label">reached in ${r.w} days</div>
          <div class="rep-stat-sub">${Object.entries(r.byChannel).map(([k, n]) => `${escapeHtml(k)} ${n}`).join(' · ') || 'nothing yet'}</div>
          <div class="rep-stat-sub">${r.inbound} came to us · ${r.created} new leads</div>
        </div>`).join('')}
    </div>`
  );
}

/** Where the pipeline actually sits, and how much of each stage is going cold. */
function funnelReport() {
  const total = state.contacts.length;
  return reportCard(
    'Pipeline by stage',
    'and how much of each stage has gone quiet',
    STAGES.map((s) => {
      const rows = state.contacts.filter((c) => (c.stage || 'new') === s.id);
      const quiet = rows.filter((c) => ['cold', 'stagnant', 'never'].includes(contactFreshness(c).id));
      const body = state.open === `stage:${s.id}`
        ? drillHtml(quiet.slice().sort((a, b) => (toDate(a.lastContactedAt)?.getTime() || 0) - (toDate(b.lastContactedAt)?.getTime() || 0)),
            'Every contact in this stage has been contacted recently.')
        : '';
      return barRow(`stage:${s.id}`, s.label, rows.length, total, s.color,
        quiet.length ? `${quiet.length} quiet` : '') + body;
    }).join('')
  );
}

/** Who is carrying what, and whose leads are going cold. */
function ownerReport() {
  const uids = [...new Set(state.contacts.map((c) => c.ownerUid || null))];
  const rows = uids.map((uid) => {
    const mine = state.contacts.filter((c) => (c.ownerUid || null) === uid);
    const quiet = mine.filter((c) => ['cold', 'stagnant', 'never'].includes(contactFreshness(c).id));
    const openTasks = state.tasks.filter((t) => t.status !== 'done' && t.assigneeUid === uid);
    const overdue = openTasks.filter((t) => taskBucket(t) === 'overdue').length;
    const won = state.opps.filter((o) => o.status === 'won' && o.ownerUid === uid).length;
    return { uid, name: ownerName(uid), count: mine.length, quiet: quiet.length, overdue, won };
  }).sort((a, b) => b.count - a.count);

  if (rows.length <= 1 && !rows[0]) return '';
  return reportCard(
    'By owner',
    'load, and whose leads are going quiet',
    `<table class="data-table rep-table">
      <thead><tr><th>Owner</th><th>Contacts</th><th>Gone quiet</th><th>Overdue</th><th>Won</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.count}</td>
        <td class="${r.quiet ? 'rep-warn' : ''}">${r.quiet}</td>
        <td class="${r.overdue ? 'rep-warn' : ''}">${r.overdue}</td>
        <td>${r.won}</td>
      </tr>`).join('')}</tbody>
    </table>`
  );
}

/** Which sources actually produce customers, not just contacts. */
function sourceReport() {
  const sources = [...new Set(state.contacts.map((c) => c.source || 'Unknown'))];
  const rows = sources.map((src) => {
    const mine = state.contacts.filter((c) => (c.source || 'Unknown') === src);
    const customers = mine.filter((c) => c.stage === 'customer').length;
    const ids = new Set(mine.map((c) => c.id));
    const revenue = state.opps
      .filter((o) => o.status === 'won' && ids.has(o.contactId))
      .reduce((n, o) => n + Number(o.amountPaid || o.value || 0), 0);
    return {
      src, count: mine.length, customers, revenue,
      rate: mine.length ? Math.round((customers / mine.length) * 100) : 0
    };
  }).sort((a, b) => b.revenue - a.revenue || b.count - a.count);

  return reportCard(
    'Lead sources',
    'which ones turn into customers',
    `<table class="data-table rep-table">
      <thead><tr><th>Source</th><th>Leads</th><th>Customers</th><th>Rate</th><th>Revenue</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${escapeHtml(r.src)}</td>
        <td>${r.count}</td>
        <td>${r.customers}</td>
        <td>${r.rate}%</td>
        <td>${fmtMoney(r.revenue)}</td>
      </tr>`).join('')}</tbody>
    </table>`
  );
}

function renderReports() {
  const host = $('crm-reports');
  if (!host) return;
  host.innerHTML = [
    stalenessReport(),
    tasksReport(),
    outreachReport(),
    funnelReport(),
    ownerReport(),
    sourceReport()
  ].filter(Boolean).join('');

  host.querySelectorAll('[data-report-row]').forEach((b) => b.addEventListener('click', () => {
    const k = b.getAttribute('data-report-row');
    state.open = state.open === k ? null : k;
    renderReports();
  }));
}

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/crm-dashboard.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  state.uid = u.uid;

  const content = renderCrmShell({ active: 'dashboard', title: 'Dashboard', user: u, role: info.role });

  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
  if (!companyId && info.isAdmin) {
    try {
      // Multi-company aware: honors ?companyId=, remembers the last pick,
      // and never silently lands an admin of two companies in the wrong one.
      const resolved = await resolveCrmCompany(u.uid);
      if (resolved.companyId) companyId = resolved.companyId;
    } catch (e) {}
  }
  if (companyId) mountCrmCompanySwitcher(u.uid, companyId);
  if (!companyId) {
    content.innerHTML = `<div class="card"><div class="auth-error">You are not an admin of any company yet. Use /owner.html.</div></div>`;
    return;
  }
  state.companyId = companyId;
  content.innerHTML = `<div class="crm-section-sub">Crunching numbers…</div>`;

  await ensureDefaultPipeline(companyId);
  const [opps, tasks, contacts, admins] = await Promise.all([
    listOpportunities(companyId, {}), listTasks(companyId, {}),
    listContacts(companyId), listCompanyAdmins(companyId)
  ]);
  state.opps = opps; state.tasks = tasks; state.contacts = contacts; state.admins = admins;

  // Pipeline metrics
  let openValue = 0, weighted = 0, wonAll = 0, wonMonth = 0, wonCount = 0, lostCount = 0;
  const som = startOfMonth();
  opps.forEach((o) => {
    if (o.status === 'won') {
      const amt = Number(o.amountPaid || o.value || 0);
      wonAll += amt; wonCount++;
      const wd = toDate(o.wonAt);
      if (wd && wd >= som) wonMonth += amt;
    } else if (o.status === 'lost') { lostCount++; }
    else {
      openValue += Number(o.value || 0);
      weighted += Number(o.value || 0) * 0.4;
    }
  });
  const winRate = (wonCount + lostCount) > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 100) : 0;

  // Tasks
  let dueToday = 0, overdue = 0;
  tasks.forEach((t) => {
    if (t.status === 'done') return;
    const d = toDate(t.dueAt);
    if (!d) return;
    if (d < startOfToday()) overdue++;
    else if (d <= endOfToday()) dueToday++;
  });

  // The headline number is the one that changes behaviour: how many people
  // are waiting to hear from you.
  const needsContact = contacts.filter((c) => ['cold', 'stagnant', 'never'].includes(contactFreshness(c).id)).length;

  content.innerHTML = `
    <div class="crm-section-sub">Your sales at a glance — pipeline, revenue, and what needs attention today.</div>
    <div class="crm-widgets">
      ${widget('Needs contacting', String(needsContact), `of ${contacts.length} contacts`, { accent: true })}
      ${widget('Open pipeline', fmtMoney(openValue), `${opps.filter((o) => o.status === 'open').length} open deals`)}
      ${widget('Weighted forecast', fmtMoney(weighted), 'probability-adjusted')}
      ${widget('Revenue this month', fmtMoney(wonMonth), `${fmtMoney(wonAll)} all-time`)}
      ${widget('Win rate', winRate + '%', `${wonCount} won · ${lostCount} lost`)}
      ${widget('Tasks today', String(dueToday), overdue ? `${overdue} overdue` : 'nothing overdue')}
    </div>

    <div class="crm-section-sub" style="margin-top:22px;">
      Reports — click any row to see who is behind the number.
    </div>
    <div id="crm-reports" class="rep-wrap"></div>
  `;
  renderReports();
}

main();
