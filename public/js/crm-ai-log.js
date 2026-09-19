// AI activity — what the CRM assistant staged, what it applied, and what it
// would have done if stage writes were switched on.
//
// The assistant stages changes and never applies them itself; an admin
// approves a stored plan and a separate callable executes it with no model in
// the loop. Every one of those plans lands in companies/{cid}/aiPlans. Until
// this page existed that record was only reachable through the Firestore
// console, which meant two things went unused:
//
//   1. Shadowed stage proposals. Stage writes are deliberately disabled
//      because a stage change fires autoEnroll and sequence steps send real
//      email — so "mark these forty as lost" can mean forty breakup emails.
//      The proposals are recorded precisely so that decision can be made on
//      evidence, and evidence nobody can read is not evidence.
//
//   2. Undo. It lived only on the chat bubble in the session that applied the
//      plan, so a page refresh lost it — even though the plan document keeps
//      everything the revert needs for a full week.
//
// Read-only except for Undo. Approving belongs in the conversation that
// produced the plan, where the context is.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import {
  listAiPlans, revertAiPlan, aiPlanState, aiPlanRevertable, shadowedStageItems,
  stageMeta, escapeHtml, fmtDateTime, toDate
} from './crm.js';

const $ = (id) => document.getElementById(id);
const state = { uid: null, companyId: null, plans: [], open: null, busy: null };

const STATE_LABEL = {
  pending: 'Awaiting approval',
  applying: 'Applying',
  applied: 'Applied',
  partially_applied: 'Partly applied',
  expired: 'Expired unapproved',
  reverted: 'Reverted',
  unknown: 'Unknown'
};

function stateBadge(st) {
  return `<span class="camp-status-badge camp-status-${escapeHtml(st)}">${escapeHtml(STATE_LABEL[st] || st)}</span>`;
}

function stageLabel(id) {
  if (!id) return '—';
  const m = stageMeta(id);
  return m ? m.label : id;
}

function ago(ts) {
  const d = toDate(ts);
  if (!d) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

// ── Section A: the evidence set ─────────────────────────────────

/**
 * Every stage change the assistant proposed and was not allowed to make.
 *
 * Deliberately a flat list across all plans rather than nested inside them:
 * the question this answers is not "what did that one conversation do" but
 * "across everything it has suggested, is its judgement about stages sound
 * enough to trust with the send button".
 */
function shadowedSection() {
  const rows = shadowedStageItems(state.plans);
  const anyWarning = rows.some((r) => r.automationWarnings.length);

  if (!rows.length) {
    return `<div class="card rep-card">
      <div class="rep-head">
        <span class="rep-title">Stage changes it would have made</span>
        <span class="rep-sub">none yet</span>
      </div>
      <div class="rep-drill"><div class="crm-subpanel-empty">
        The assistant has not proposed any stage changes. When it does, they appear here —
        recorded but never applied — so you can judge whether to enable stage writes.
      </div></div>
    </div>`;
  }

  return `<div class="card rep-card ai-evidence">
    <div class="rep-head">
      <span class="rep-title">Stage changes it would have made</span>
      <span class="rep-sub">${rows.length} proposed · none applied</span>
    </div>
    <div class="ai-note">
      Stage writes are off. These were recorded so you can decide on evidence rather than hope.
      ${anyWarning ? 'Some would have triggered automated sequences — marked below.' : ''}
      To enable them, set <code>CRM_STAGE_WRITES_ENABLED</code> in <code>functions/index.js</code>.
    </div>
    ${rows.map((r) => `
      <div class="ai-evidence-row">
        <div class="ai-ev-main">
          <a class="rep-drill-name" href="/contact.html?id=${encodeURIComponent(r.contactId)}">${escapeHtml(r.contactName || r.contactId)}</a>
          <span class="ai-ev-move">${escapeHtml(stageLabel(r.from))} → <strong>${escapeHtml(stageLabel(r.to))}</strong></span>
          ${r.automationWarnings.length
            ? `<span class="ai-ev-warn" title="${escapeHtml(r.automationWarnings.map((w) => w.sequenceName).join(', '))}">would trigger ${r.automationWarnings.length} sequence${r.automationWarnings.length === 1 ? '' : 's'}</span>`
            : ''}
        </div>
        ${r.reason ? `<div class="rep-drill-meta">Its reason: ${escapeHtml(r.reason)}</div>` : ''}
        ${r.userPrompt ? `<div class="rep-drill-meta ai-ev-prompt">You asked: “${escapeHtml(r.userPrompt.slice(0, 160))}”</div>` : ''}
        <div class="rep-drill-meta">${escapeHtml(ago(r.createdAt))}</div>
      </div>`).join('')}
  </div>`;
}

// ── Section B: plan history ─────────────────────────────────────

function itemLine(i) {
  const who = escapeHtml(i.contactName || i.contactId);
  if (i.kind === 'task') {
    return `${who} — task “${escapeHtml((i.after && i.after.title) || '')}”, due in ${(i.after && i.after.dueInDays) ?? '?'}d`;
  }
  if (i.kind === 'tags') {
    const add = ((i.after && i.after.addTags) || []).map((t) => '+' + t);
    const rem = ((i.after && i.after.removeTags) || []).map((t) => '−' + t);
    return `${who} — ${escapeHtml([...add, ...rem].join('  ')) || 'no change'}`;
  }
  if (i.kind === 'stage') {
    return `${who} — ${escapeHtml(stageLabel(i.before && i.before.stage))} → ${escapeHtml(stageLabel(i.after && i.after.stage))}`
      + (i.shadowed ? ' <em>(recorded only)</em>' : '');
  }
  return who;
}

function resultLine(r) {
  const bits = [r.kind, r.status];
  if (r.reason) bits.push(r.reason);
  if (r.from && r.to) bits.push(`${r.from} → ${r.to}`);
  return escapeHtml(bits.filter(Boolean).join(' · '));
}

function planDetail(p) {
  const st = aiPlanState(p);
  const warn = p.automationWarnings || [];
  return `<div class="rep-drill">
    ${p.userPrompt ? `<div class="ai-block"><div class="ai-block-h">You asked</div><div class="ai-quote">${escapeHtml(p.userPrompt)}</div></div>` : ''}
    ${p.assistantRationale ? `<div class="ai-block"><div class="ai-block-h">Its reasoning</div><div class="rep-drill-meta">${escapeHtml(p.assistantRationale)}</div></div>` : ''}
    <div class="ai-block">
      <div class="ai-block-h">Changes (${(p.items || []).length})</div>
      <ul class="ai-items">${(p.items || []).map((i) => `<li>${itemLine(i)}</li>`).join('')}</ul>
    </div>
    ${warn.length ? `<div class="ai-block"><div class="ai-block-h">Automations this would trigger</div>
      <ul class="ai-items">${warn.map((w) => `<li>${escapeHtml(w.sequenceName)} — ${w.sendingSteps} sending step${w.sendingSteps === 1 ? '' : 's'}${w.sendsEmail ? ', email' : ''}${w.sendsSms ? ', SMS' : ''}</li>`).join('')}</ul>
      ${p.runAutomations === false ? '<div class="rep-drill-meta">Automations were suppressed for this batch.</div>' : ''}
    </div>` : ''}
    ${(p.results || []).length ? `<div class="ai-block"><div class="ai-block-h">What happened</div>
      <ul class="ai-items">${p.results.map((r) => `<li>${resultLine(r)}</li>`).join('')}</ul></div>` : ''}
    ${(p.toolTrace || []).length ? `<div class="ai-block"><div class="ai-block-h">How it chose these</div>
      <div class="rep-drill-meta">${p.toolTrace.map((t) => escapeHtml(t.name + (t.rows != null ? ` (${t.rows} rows)` : ''))).join(' → ')}</div></div>` : ''}
    <div class="ai-block rep-drill-meta">
      ${escapeHtml(p.createdByName || 'Unknown')} · ${escapeHtml(fmtDateTime(p.createdAt) || '')}
      ${p.model ? ' · ' + escapeHtml(p.model) : ''}
      ${st === 'expired' ? ' · was never approved' : ''}
    </div>
    ${aiPlanRevertable(p) ? `<div class="ai-actions">
      <button class="crm-chip ai-undo" data-undo="${escapeHtml(p.planId || p.id)}" ${state.busy === (p.planId || p.id) ? 'disabled' : ''}>
        ${state.busy === (p.planId || p.id) ? 'Undoing…' : 'Undo this'}
      </button>
      <span class="rep-drill-meta">Restores what changed. Email already delivered cannot be recalled.</span>
    </div>` : ''}
    <div class="ai-status" data-status-for="${escapeHtml(p.planId || p.id)}"></div>
  </div>`;
}

function historySection() {
  if (!state.plans.length) {
    return `<div class="card rep-card">
      <div class="rep-head"><span class="rep-title">History</span><span class="rep-sub">nothing yet</span></div>
      <div class="rep-drill"><div class="crm-subpanel-empty">
        The assistant has not staged any changes. Open the chat on any CRM page and ask it to
        create follow-up tasks, and the plan will appear here whether or not you approve it.
      </div></div>
    </div>`;
  }
  return `<div class="card rep-card">
    <div class="rep-head">
      <span class="rep-title">History</span>
      <span class="rep-sub">${state.plans.length} plan${state.plans.length === 1 ? '' : 's'}, newest first</span>
    </div>
    ${state.plans.map((p) => {
      const id = p.planId || p.id;
      const st = aiPlanState(p);
      const c = p.counts || {};
      const parts = [];
      if (c.tasks) parts.push(`${c.tasks} task${c.tasks === 1 ? '' : 's'}`);
      if (c.tagChanges) parts.push(`${c.tagChanges} tag change${c.tagChanges === 1 ? '' : 's'}`);
      if (c.stageChanges) parts.push(`${c.stageChanges} stage change${c.stageChanges === 1 ? '' : 's'}`);
      return `<button class="rep-row ai-plan-row ${state.open === id ? 'open' : ''}" data-plan="${escapeHtml(id)}">
          <span class="rep-row-label">${escapeHtml(p.assistantSummary || 'Untitled plan')}</span>
          <span class="ai-plan-meta">${escapeHtml(parts.join(' · ') || 'no items')}</span>
          ${stateBadge(st)}
          <span class="rep-row-pct">${escapeHtml(ago(p.createdAt))}</span>
        </button>`
        + (state.open === id ? planDetail(p) : '');
    }).join('')}
  </div>`;
}

// ── Render ──────────────────────────────────────────────────────

function render() {
  const shadowed = shadowedStageItems(state.plans).length;
  const applied = state.plans.filter((p) => ['applied', 'partially_applied'].includes(p.status));
  const changed = applied.reduce((n, p) => n + ((p.results || []).filter((r) => r.status === 'applied').length), 0);

  $('crm-content').innerHTML = `
    <div class="crm-section-sub">
      Everything the CRM assistant has staged, applied, or been prevented from applying.
      Nothing here can be edited — it is the record.
    </div>
    <div class="crm-widgets">
      <div class="crm-widget ${shadowed ? 'crm-widget-accent' : ''}">
        <div class="crm-widget-label">Stage changes proposed</div>
        <div class="crm-widget-value">${shadowed}</div>
        <div class="crm-widget-sub">recorded, never applied</div>
      </div>
      <div class="crm-widget">
        <div class="crm-widget-label">Plans applied</div>
        <div class="crm-widget-value">${applied.length}</div>
        <div class="crm-widget-sub">${changed} change${changed === 1 ? '' : 's'} made</div>
      </div>
      <div class="crm-widget">
        <div class="crm-widget-label">Awaiting approval</div>
        <div class="crm-widget-value">${state.plans.filter((p) => aiPlanState(p) === 'pending').length}</div>
        <div class="crm-widget-sub">approve from the chat</div>
      </div>
    </div>
    <div class="rep-wrap" style="margin-top:18px;">
      ${shadowedSection()}
      ${historySection()}
    </div>`;

  document.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', () => {
    const id = b.getAttribute('data-plan');
    state.open = state.open === id ? null : id;
    render();
  }));

  document.querySelectorAll('[data-undo]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const id = b.getAttribute('data-undo');
    if (!confirm('Undo this batch? It restores what changed, but any email or text already sent cannot be recalled.')) return;
    state.busy = id;
    render();
    try {
      const res = await revertAiPlan(state.companyId, id);
      state.busy = null;
      await reload();
      const host = document.querySelector(`[data-status-for="${CSS.escape(id)}"]`);
      if (host) {
        host.textContent = `Reverted ${res.reverted} change${res.reverted === 1 ? '' : 's'}.`
          + (res.note ? ' ' + res.note : '');
      }
    } catch (err) {
      state.busy = null;
      render();
      const host = document.querySelector(`[data-status-for="${CSS.escape(id)}"]`);
      if (host) host.textContent = 'Could not undo: ' + ((err && err.message) || err);
    }
  }));
}

async function reload() {
  state.plans = await listAiPlans(state.companyId, { max: 50 });
  render();
}

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/crm-ai-log.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  state.uid = u.uid;

  const content = renderCrmShell({ active: 'ai-log', title: 'AI Activity', user: u, role: info.role });

  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
  if (!companyId && info.isAdmin) {
    try {
      const resolved = await resolveCrmCompany(u.uid);
      if (resolved.companyId) companyId = resolved.companyId;
    } catch (e) {}
  }
  // After renderCrmShell — the switcher mounts into the appbar the shell built.
  if (companyId) mountCrmCompanySwitcher(u.uid, companyId);
  if (!companyId) {
    content.innerHTML = `<div class="card"><div class="auth-error">You are not an admin of any company yet. Use /owner.html.</div></div>`;
    return;
  }
  state.companyId = companyId;
  content.innerHTML = `<div class="crm-section-sub">Loading…</div>`;
  await reload();
}

main();
