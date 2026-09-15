// CRM Settings — pipeline & stage editor, calling preferences, and the
// Google Calendar connection. Admin/owner only.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import {
  DEFAULT_PIPELINE_STAGES, ensureDefaultPipeline, updatePipeline,
  listOpportunities, escapeHtml,
  DEFAULT_DIALER_SETTINGS, getDialerSettings, updateDialerSettings,
  getAgentPrefs, updateAgentPrefs,
  getGoogleCalendarStatus, startGoogleCalendarConnect, disconnectGoogleCalendar,
  fmtDateTime
} from './crm.js';

const $ = (id) => document.getElementById(id);
const PROTECTED = new Set(DEFAULT_PIPELINE_STAGES.map((s) => s.id)); // referenced by contacts

const state = {
  uid: null, companyId: null, pipeline: null, stages: [], oppCountByStage: {},
  dialer: { ...DEFAULT_DIALER_SETTINGS },
  prefs: { callMode: 'softphone', mobilePhone: null },
  google: { connected: false }
};

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24) || 'stage';
}

function render() {
  const content = $('crm-content');
  const stages = state.stages.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  content.innerHTML = `
    <div class="crm-section-sub">Customize your sales pipeline. Changes apply to the Opportunities board.</div>
    <div class="card" style="max-width:760px;">
      <div class="crm-field" style="margin-bottom:18px;">
        <label>Pipeline name</label>
        <input class="c-input" id="pl-name" value="${escapeHtml(state.pipeline.name || 'Sales Pipeline')}" />
      </div>
      <label class="crm-field-label" style="display:block;margin-bottom:8px;">Stages</label>
      <div id="stage-rows">
        ${stages.map((s, i) => stageRowHtml(s, i, stages.length)).join('')}
      </div>
      <button class="btn btn-ghost" id="add-stage" style="margin-top:12px;">+ Add stage</button>
      <div class="crm-save-row" style="margin-top:20px;">
        <span id="set-status" class="crm-save-status"></span>
        <button class="btn btn-primary" id="save-pipeline">Save pipeline</button>
      </div>
    </div>
    <div class="card" style="max-width:760px;">
      <label class="crm-field-label" style="display:block;margin-bottom:8px;">Contact data</label>
      <div class="crm-import-note" style="margin-top:0;">
        Bulk-add contacts from a spreadsheet, or download the current list.
        Imports match on email, so an updated list tops up what is already here.
      </div>
      <div class="crm-save-row" style="margin-top:16px;">
        <a class="btn btn-ghost" href="/crm-import.html?companyId=${encodeURIComponent(state.companyId)}">Import contacts from CSV</a>
        <a class="btn btn-ghost" href="/crm.html">Export from Contacts</a>
      </div>
    </div>

    ${callingCardHtml()}
    ${googleCardHtml()}
  `;
  wire();
}

// ── Calling ──────────────────────────────────────────────────────────────
function callingCardHtml() {
  const d = state.dialer;
  const p = state.prefs;
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const hourOpts = (sel) => hours.map((h) =>
    `<option value="${h}" ${Number(sel) === h ? 'selected' : ''}>${h === 0 ? '12 am' : h < 12 ? h + ' am' : h === 12 ? '12 pm' : (h - 12) + ' pm'}</option>`).join('');
  return `
    <div class="card" style="max-width:760px;">
      <label class="crm-field-label" style="display:block;margin-bottom:4px;">Calling</label>
      <div class="crm-import-note" style="margin-top:0;">
        How your own calls connect. The softphone talks through this browser; cell bridge rings
        your phone first and then dials the lead, which works from anywhere and needs no microphone here.
      </div>

      <div class="crm-form-row-grid" style="margin-top:14px;">
        <div class="crm-field">
          <label>My call mode</label>
          <select class="c-input crm-select" id="set-call-mode">
            <option value="softphone" ${p.callMode !== 'bridge' ? 'selected' : ''}>Browser softphone</option>
            <option value="bridge" ${p.callMode === 'bridge' ? 'selected' : ''}>Ring my cell, then the lead</option>
          </select>
        </div>
        <div class="crm-field">
          <label>My mobile number</label>
          <input class="c-input" id="set-mobile" placeholder="+1 555 555 0100" value="${escapeHtml(p.mobilePhone || '')}" />
        </div>
      </div>

      <label class="crm-field-label" style="display:block;margin:18px 0 6px;">Company-wide</label>
      <div class="crm-form-row-grid">
        <div class="crm-field">
          <label>Call recording</label>
          <select class="c-input crm-select" id="set-recording">
            <option value="off" ${d.recordingMode === 'off' ? 'selected' : ''}>Off</option>
            <option value="announce" ${d.recordingMode === 'announce' ? 'selected' : ''}>On, with a spoken notice (recommended)</option>
            <option value="on" ${d.recordingMode === 'on' ? 'selected' : ''}>On, silent</option>
          </select>
        </div>
        <div class="crm-field">
          <label>Auto-advance after a call</label>
          <select class="c-input crm-select" id="set-advance">
            ${[0, 3, 5, 10].map((n) => `<option value="${n}" ${Number(d.autoAdvanceSec) === n ? 'selected' : ''}>${n === 0 ? 'Wait for me' : n + ' seconds'}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="crm-import-note" id="set-recording-note" style="margin-top:8px;">
        ${d.recordingMode === 'on'
          ? 'Silent recording is illegal in two-party-consent states (California, Florida, Illinois, and others). Use the spoken notice unless you have checked the rules for every state you call.'
          : 'Recordings appear on the contact timeline once the call ends.'}
      </div>

      <div class="crm-form-row-grid" style="margin-top:14px;">
        <div class="crm-field">
          <label class="crm-consent-check"><input type="checkbox" id="set-qh-on" ${d.quietHoursEnabled ? 'checked' : ''} /> Warn before dialing during quiet hours</label>
        </div>
        <div class="crm-field" style="display:flex;gap:8px;align-items:end;">
          <div style="flex:1;"><label>From</label><select class="c-input crm-select" id="set-qh-start">${hourOpts(d.quietHoursStart)}</select></div>
          <div style="flex:1;"><label>Until</label><select class="c-input crm-select" id="set-qh-end">${hourOpts(d.quietHoursEnd)}</select></div>
        </div>
      </div>

      <div class="crm-save-row" style="margin-top:18px;">
        <span id="set-call-status" class="crm-save-status"></span>
        <button class="btn btn-primary" id="save-calling">Save calling settings</button>
      </div>
    </div>`;
}

// ── Google Calendar ──────────────────────────────────────────────────────
function googleCardHtml() {
  const g = state.google;
  const flash = new URLSearchParams(location.search).get('google');
  const flashHtml = flash === 'connected'
    ? '<div class="crm-save-status ok" style="margin-bottom:10px;">Google Calendar connected.</div>'
    : (flash === 'error'
      ? `<div class="auth-error" style="margin-bottom:10px;">Google did not complete the connection: ${escapeHtml(new URLSearchParams(location.search).get('reason') || 'unknown error')}.</div>`
      : '');
  return `
    <div class="card" style="max-width:760px;">
      <label class="crm-field-label" style="display:block;margin-bottom:4px;">Google Calendar</label>
      ${flashHtml}
      ${g.connected ? `
        <div class="crm-import-note" style="margin-top:0;">
          Connected as <strong>${escapeHtml(g.googleEmail || 'your Google account')}</strong>.
          Appointments booked here create calendar events with a Meet link and invite the contact;
          changes made in Google flow back within seconds.
          ${g.lastSyncAt ? `<br>Last sync ${fmtDateTime(g.lastSyncAt)}.` : ''}
          ${g.watchExpiry ? `<br>Live updates active until ${fmtDateTime(g.watchExpiry)} (renewed automatically).` : ''}
        </div>
        <div class="crm-save-row" style="margin-top:16px;">
          <span id="set-google-status" class="crm-save-status"></span>
          <button class="btn btn-ghost" id="google-disconnect">Disconnect</button>
        </div>
      ` : `
        <div class="crm-import-note" style="margin-top:0;">
          Connect your Google account so appointments booked from a contact card land on your real
          calendar with a Meet link, and so bookings made in Google show up here. You will be asked to
          allow calendar access once.
        </div>
        <div class="crm-save-row" style="margin-top:16px;">
          <span id="set-google-status" class="crm-save-status"></span>
          <button class="btn btn-primary" id="google-connect">Connect Google Calendar</button>
        </div>
      `}
    </div>`;
}

function stageRowHtml(s, i, total) {
  const used = state.oppCountByStage[s.id] || 0;
  const locked = PROTECTED.has(s.id) || used > 0;
  const flag = s.won ? '<span class="crm-stage-badge" style="--stage-color:#56D4A8">Won</span>'
    : (s.lost ? '<span class="crm-stage-badge" style="--stage-color:#8B4A4A">Lost</span>' : '');
  return `
    <div class="crm-mini-row" data-stage-row="${escapeHtml(s.id)}">
      <input type="color" class="stage-color" data-id="${escapeHtml(s.id)}" value="${escapeHtml(s.color || '#A0A0A0')}" style="width:34px;height:34px;border:none;background:none;cursor:pointer;">
      <div class="crm-mini-main" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input class="c-input stage-label" data-id="${escapeHtml(s.id)}" value="${escapeHtml(s.label)}" style="max-width:200px;">
        <span class="crm-mini-sub">prob</span>
        <input class="c-input stage-prob" data-id="${escapeHtml(s.id)}" type="number" min="0" max="100" value="${Math.round((s.probability || 0) * 100)}" style="max-width:74px;">
        <span class="crm-mini-sub">%</span>
        ${flag}
      </div>
      <button class="task-del" data-up="${escapeHtml(s.id)}" ${i === 0 ? 'disabled' : ''} title="Move up" style="color:var(--gray-light);">↑</button>
      <button class="task-del" data-down="${escapeHtml(s.id)}" ${i === total - 1 ? 'disabled' : ''} title="Move down" style="color:var(--gray-light);">↓</button>
      <button class="task-del" data-del="${escapeHtml(s.id)}" title="${locked ? 'In use — cannot delete' : 'Delete stage'}" ${locked ? 'disabled style="opacity:.3;"' : ''}>×</button>
    </div>`;
}

function syncFromInputs() {
  document.querySelectorAll('.stage-label').forEach((el) => {
    const s = state.stages.find((x) => x.id === el.dataset.id);
    if (s) s.label = el.value;
  });
  document.querySelectorAll('.stage-color').forEach((el) => {
    const s = state.stages.find((x) => x.id === el.dataset.id);
    if (s) s.color = el.value;
  });
  document.querySelectorAll('.stage-prob').forEach((el) => {
    const s = state.stages.find((x) => x.id === el.dataset.id);
    if (s) s.probability = Math.max(0, Math.min(100, Number(el.value) || 0)) / 100;
  });
}

function wire() {
  $('add-stage').addEventListener('click', () => {
    syncFromInputs();
    const maxOrder = state.stages.reduce((m, s) => Math.max(m, s.order || 0), 0);
    const id = slug('stage') + '-' + Math.random().toString(36).slice(2, 6);
    state.stages.push({ id, label: 'New Stage', color: '#5AA8E6', order: maxOrder + 1, probability: 0.5 });
    render();
  });
  document.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => {
    syncFromInputs();
    move(b.getAttribute('data-up'), -1);
  }));
  document.querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => {
    syncFromInputs();
    move(b.getAttribute('data-down'), 1);
  }));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    const id = b.getAttribute('data-del');
    if (PROTECTED.has(id) || (state.oppCountByStage[id] || 0) > 0) return;
    if (!confirm('Delete this stage?')) return;
    syncFromInputs();
    state.stages = state.stages.filter((s) => s.id !== id);
    render();
  }));
  $('save-pipeline').addEventListener('click', save);

  $('save-calling').addEventListener('click', saveCalling);
  $('set-recording').addEventListener('change', (e) => {
    $('set-recording-note').textContent = e.target.value === 'on'
      ? 'Silent recording is illegal in two-party-consent states (California, Florida, Illinois, and others). Use the spoken notice unless you have checked the rules for every state you call.'
      : 'Recordings appear on the contact timeline once the call ends.';
  });

  const connect = $('google-connect');
  if (connect) connect.addEventListener('click', async () => {
    const st = $('set-google-status');
    connect.disabled = true;
    st.textContent = 'Opening Google…'; st.className = 'crm-save-status';
    try {
      const url = await startGoogleCalendarConnect(state.companyId);
      if (!url) throw new Error('No consent URL returned.');
      location.href = url;
    } catch (e) {
      connect.disabled = false;
      st.textContent = e.message || String(e); st.className = 'crm-save-status err';
    }
  });
  const disconnect = $('google-disconnect');
  if (disconnect) disconnect.addEventListener('click', async () => {
    if (!confirm('Disconnect Google Calendar? Existing appointments stay; they just stop syncing.')) return;
    const st = $('set-google-status');
    disconnect.disabled = true;
    try {
      await disconnectGoogleCalendar(state.companyId);
      state.google = { connected: false };
      history.replaceState(null, '', location.pathname);
      render();
    } catch (e) {
      disconnect.disabled = false;
      st.textContent = e.message || String(e); st.className = 'crm-save-status err';
    }
  });
}

async function saveCalling() {
  const st = $('set-call-status');
  try {
    await Promise.all([
      updateAgentPrefs(state.uid, {
        callMode: $('set-call-mode').value,
        mobilePhone: $('set-mobile').value
      }),
      updateDialerSettings(state.companyId, {
        recordingMode: $('set-recording').value,
        autoAdvanceSec: Number($('set-advance').value),
        quietHoursEnabled: $('set-qh-on').checked,
        quietHoursStart: Number($('set-qh-start').value),
        quietHoursEnd: Number($('set-qh-end').value)
      })
    ]);
    [state.dialer, state.prefs] = await Promise.all([
      getDialerSettings(state.companyId), getAgentPrefs(state.uid)
    ]);
    st.textContent = 'Saved'; st.className = 'crm-save-status ok';
  } catch (e) {
    st.textContent = 'Error: ' + (e.message || e); st.className = 'crm-save-status err';
  }
}

function move(id, dir) {
  const sorted = state.stages.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = sorted.findIndex((s) => s.id === id);
  const swap = idx + dir;
  if (swap < 0 || swap >= sorted.length) return;
  const o1 = sorted[idx].order, o2 = sorted[swap].order;
  sorted[idx].order = o2; sorted[swap].order = o1;
  render();
}

async function save() {
  syncFromInputs();
  // Normalize order to 0..n
  const ordered = state.stages.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  ordered.forEach((s, i) => { s.order = i; });
  const status = $('set-status');
  try {
    await updatePipeline(state.companyId, state.pipeline.id, {
      name: $('pl-name').value.trim() || 'Sales Pipeline',
      stages: ordered
    });
    status.textContent = 'Saved'; status.className = 'crm-save-status ok';
    state.stages = ordered;
  } catch (e) {
    status.textContent = 'Error: ' + (e.message || e); status.className = 'crm-save-status err';
  }
}

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/crm-settings.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  state.uid = u.uid;

  const content = renderCrmShell({ active: 'settings', title: 'CRM Settings', user: u, role: info.role });
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
  content.innerHTML = `<div class="crm-section-sub">Loading pipeline…</div>`;

  state.pipeline = await ensureDefaultPipeline(companyId);
  state.stages = (state.pipeline.stages || DEFAULT_PIPELINE_STAGES).map((s) => ({ ...s }));
  const [opps, dialer, prefs, google] = await Promise.all([
    listOpportunities(companyId, { pipelineId: state.pipeline.id }),
    getDialerSettings(companyId),
    getAgentPrefs(u.uid),
    getGoogleCalendarStatus(companyId)
  ]);
  state.oppCountByStage = {};
  opps.forEach((o) => { state.oppCountByStage[o.stageId] = (state.oppCountByStage[o.stageId] || 0) + 1; });
  state.dialer = dialer;
  state.prefs = prefs;
  state.google = google;
  render();
}

main();
