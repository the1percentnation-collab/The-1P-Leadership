// Sequences — multi-step follow-up cadences. Build the steps, pick what
// enrolls a contact automatically, and watch who is in flight. Steps are
// sent by the automation tick (runAutomationTick), never from the browser,
// so a closed laptop does not pause anyone's follow-up.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import {
  STAGES, CALL_DISPOSITIONS, SEQUENCE_TRIGGERS,
  listSequences, createSequence, updateSequence, deleteSequence,
  listEnrollments, stopEnrollment, enrollContact, runAutomationNow,
  listTemplates, listContacts, listSmartLists, ensureDefaultSmartLists, applySmartList, listCalls,
  escapeHtml, fmtDateTime
} from './crm.js';

const $ = (id) => document.getElementById(id);
const state = {
  uid: null, companyId: null,
  sequences: [], templates: [], contacts: [], smartLists: [],
  enrollments: [],
  editing: null,      // sequence id being edited, or 'new'
  draft: null         // { name, active, trigger, steps, stopOnReply }
};

function blankDraft() {
  return {
    name: '', active: true, stopOnReply: true,
    trigger: { type: 'manual', value: null },
    steps: [{ channel: 'sms', delayHours: 0, templateId: null, subject: '', body: '' }]
  };
}

// ────────────────────────────────────────────────────────────────
function layoutHtml() {
  return `
    <div class="crm-section-sub" style="margin-top:0;">
      Follow-up cadences that run on their own. A reply, an inbound call, a booked appointment,
      an SMS opt-out or a do-not-call flag stops a contact's sequence immediately.
    </div>
    <div class="seq-wrap">
      <div>
        <div class="crm-toolbar" style="margin-bottom:12px;">
          <button class="btn btn-primary" id="seq-new">+ New sequence</button>
          <span class="crm-toolbar-spacer"></span>
          <button class="btn btn-ghost" id="seq-run-now" title="Send any steps that are due right now">Run due steps now</button>
        </div>
        <div id="seq-list"></div>
      </div>
      <div id="seq-editor"></div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="crm-page-head"><h2 class="crm-field-label" style="margin:0;">Active enrollments</h2></div>
      <div id="seq-enrollments"></div>
    </div>`;
}

function triggerLabel(seq) {
  const t = SEQUENCE_TRIGGERS.find((x) => x.id === (seq.trigger && seq.trigger.type)) || SEQUENCE_TRIGGERS[0];
  const v = seq.trigger && seq.trigger.value;
  if (t.id === 'stage_change') { const st = STAGES.find((s) => s.id === v); return `Enters ${st ? st.label : (v || 'any stage')}`; }
  if (t.id === 'disposition') { const d = CALL_DISPOSITIONS.find((x) => x.id === v); return `Call: ${d ? d.label : (v || 'any outcome')}`; }
  if (t.id === 'tag_added') return `Tag #${v || 'any'}`;
  return 'Manual';
}

function renderList() {
  const host = $('seq-list');
  const counts = {};
  state.enrollments.forEach((e) => { if (e.status === 'active') counts[e.sequenceId] = (counts[e.sequenceId] || 0) + 1; });
  if (!state.sequences.length) {
    host.innerHTML = `<div class="card"><div class="crm-subpanel-empty">No sequences yet. Start with a 3-step "no answer" cadence: text now, text in 2 days, task in 5 days.</div></div>`;
    return;
  }
  host.innerHTML = state.sequences.map((s) => `
    <div class="card seq-item ${state.editing === s.id ? 'active' : ''}" data-seq="${escapeHtml(s.id)}">
      <div class="seq-item-head">
        <div>
          <div class="crm-mini-title">${escapeHtml(s.name)} ${s.active === false ? '<span class="tpl-chip">paused</span>' : ''}</div>
          <div class="crm-mini-sub">${escapeHtml(triggerLabel(s))} · ${(s.steps || []).length} step${(s.steps || []).length === 1 ? '' : 's'} · ${counts[s.id] || 0} active</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="crm-chip" data-seq-enroll="${escapeHtml(s.id)}">Enroll…</button>
          <button class="crm-chip" data-seq-edit="${escapeHtml(s.id)}">Edit</button>
        </div>
      </div>
      <div class="seq-steps-mini">
        ${(s.steps || []).map((st, i) => `<span class="seq-step-pill">${i + 1}. ${st.channel}${st.delayHours ? ' +' + fmtDelay(st.delayHours) : ''}</span>`).join('')}
      </div>
    </div>`).join('');
  host.querySelectorAll('[data-seq-edit]').forEach((b) => b.addEventListener('click', () => openEditor(b.getAttribute('data-seq-edit'))));
  host.querySelectorAll('[data-seq-enroll]').forEach((b) => b.addEventListener('click', () => openEnrollModal(b.getAttribute('data-seq-enroll'))));
}

function fmtDelay(h) {
  h = Number(h) || 0;
  if (h % 24 === 0 && h >= 24) return `${h / 24}d`;
  return `${h}h`;
}

function openEditor(id) {
  state.editing = id;
  if (id === 'new') state.draft = blankDraft();
  else {
    const s = state.sequences.find((x) => x.id === id);
    if (!s) return;
    state.draft = {
      name: s.name || '', active: s.active !== false, stopOnReply: s.stopOnReply !== false,
      trigger: { type: (s.trigger && s.trigger.type) || 'manual', value: (s.trigger && s.trigger.value) || null },
      steps: (s.steps || []).map((st) => ({ ...st }))
    };
  }
  renderList();
  renderEditor();
}

function triggerValueHtml(d) {
  const t = d.trigger.type;
  if (t === 'stage_change') return `<select class="c-input crm-select" id="seq-trigger-value"><option value="">Any stage</option>${STAGES.map((s) => `<option value="${s.id}" ${d.trigger.value === s.id ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}</select>`;
  if (t === 'disposition') return `<select class="c-input crm-select" id="seq-trigger-value"><option value="">Any outcome</option>${CALL_DISPOSITIONS.map((x) => `<option value="${x.id}" ${d.trigger.value === x.id ? 'selected' : ''}>${escapeHtml(x.label)}</option>`).join('')}</select>`;
  if (t === 'tag_added') return `<input class="c-input" id="seq-trigger-value" placeholder="tag name (without #)" value="${escapeHtml(d.trigger.value || '')}" />`;
  return '';
}

function stepHtml(st, i, total) {
  const tplOpts = state.templates.filter((t) => t.channel === (st.channel === 'email' ? 'email' : 'sms'));
  return `
    <div class="seq-step" data-step="${i}">
      <div class="seq-step-head">
        <span class="seq-step-num">${i + 1}</span>
        <select class="c-input crm-select seq-step-channel" data-i="${i}" style="max-width:130px;">
          <option value="sms" ${st.channel === 'sms' ? 'selected' : ''}>Text</option>
          <option value="email" ${st.channel === 'email' ? 'selected' : ''}>Email</option>
          <option value="task" ${st.channel === 'task' ? 'selected' : ''}>Task for me</option>
        </select>
        <span class="crm-mini-sub">after</span>
        <input class="c-input seq-step-delay" data-i="${i}" type="number" min="0" step="1" value="${Number(st.delayHours) || 0}" style="max-width:80px;" />
        <span class="crm-mini-sub">hours${i === 0 ? ' from enrollment' : ' from the previous step'}</span>
        <span style="flex:1;"></span>
        <button class="task-del" data-step-up="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button class="task-del" data-step-down="${i}" ${i === total - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button class="task-del" data-step-del="${i}" title="Remove step">×</button>
      </div>
      ${st.channel !== 'task' ? `
        <select class="c-input crm-select seq-step-template" data-i="${i}" style="margin-top:8px;">
          <option value="">Write it here…</option>
          ${tplOpts.map((t) => `<option value="${t.id}" ${st.templateId === t.id ? 'selected' : ''}>Template: ${escapeHtml(t.name)}</option>`).join('')}
        </select>` : ''}
      ${st.channel === 'email' && !st.templateId ? `<input class="c-input seq-step-subject" data-i="${i}" placeholder="Subject" value="${escapeHtml(st.subject || '')}" style="margin-top:8px;" />` : ''}
      ${!st.templateId ? `<textarea class="c-textarea seq-step-body" data-i="${i}" rows="3" placeholder="${st.channel === 'task' ? 'Task title, e.g. Call {{firstName}} back' : 'Hi {{firstName}}, this is {{ownerFirstName}}…'}" style="margin-top:8px;">${escapeHtml(st.body || '')}</textarea>` : ''}
    </div>`;
}

function renderEditor() {
  const host = $('seq-editor');
  const d = state.draft;
  if (!state.editing || !d) {
    host.innerHTML = `<div class="card"><div class="crm-subpanel-empty">Pick a sequence to edit, or create a new one.</div></div>`;
    return;
  }
  const isNew = state.editing === 'new';
  host.innerHTML = `
    <div class="card">
      <div class="crm-form-row-grid">
        <div class="crm-field"><label>Name</label><input class="c-input" id="seq-name" value="${escapeHtml(d.name)}" placeholder="No answer follow-up" /></div>
        <div class="crm-field"><label>Starts when</label>
          <select class="c-input crm-select" id="seq-trigger">
            ${SEQUENCE_TRIGGERS.map((t) => `<option value="${t.id}" ${d.trigger.type === t.id ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
          </select></div>
      </div>
      <div class="crm-field" id="seq-trigger-value-wrap" style="margin-top:10px;${d.trigger.type === 'manual' ? 'display:none;' : ''}">
        <label>Which one</label>${triggerValueHtml(d)}
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:12px;">
        <label class="crm-consent-check"><input type="checkbox" id="seq-active" ${d.active ? 'checked' : ''} /> Active</label>
        <label class="crm-consent-check"><input type="checkbox" id="seq-stop" ${d.stopOnReply ? 'checked' : ''} /> Stop when the contact replies or calls</label>
      </div>

      <label class="crm-field-label" style="display:block;margin:18px 0 8px;">Steps</label>
      <div id="seq-steps">${d.steps.map((st, i) => stepHtml(st, i, d.steps.length)).join('')}</div>
      <button class="btn btn-ghost" id="seq-add-step" style="margin-top:10px;">+ Add step</button>

      <div class="crm-save-row" style="margin-top:18px;">
        <span id="seq-status" class="crm-save-status"></span>
        ${isNew ? '' : '<button class="btn btn-ghost" id="seq-delete" style="margin-right:auto;">Delete</button>'}
        <button class="btn btn-ghost" id="seq-cancel">Cancel</button>
        <button class="btn btn-primary" id="seq-save">${isNew ? 'Create sequence' : 'Save sequence'}</button>
      </div>
    </div>`;
  wireEditor();
}

function syncDraft() {
  const d = state.draft;
  d.name = $('seq-name').value;
  d.trigger.type = $('seq-trigger').value;
  const tv = $('seq-trigger-value');
  d.trigger.value = tv ? (tv.value || null) : null;
  d.active = $('seq-active').checked;
  d.stopOnReply = $('seq-stop').checked;
  document.querySelectorAll('.seq-step-channel').forEach((el) => { d.steps[el.dataset.i].channel = el.value; });
  document.querySelectorAll('.seq-step-delay').forEach((el) => { d.steps[el.dataset.i].delayHours = Number(el.value) || 0; });
  document.querySelectorAll('.seq-step-template').forEach((el) => { d.steps[el.dataset.i].templateId = el.value || null; });
  document.querySelectorAll('.seq-step-subject').forEach((el) => { d.steps[el.dataset.i].subject = el.value; });
  document.querySelectorAll('.seq-step-body').forEach((el) => { d.steps[el.dataset.i].body = el.value; });
}

function wireEditor() {
  const d = state.draft;
  $('seq-trigger').addEventListener('change', () => { syncDraft(); d.trigger.value = null; renderEditor(); });
  $('seq-add-step').addEventListener('click', () => {
    syncDraft();
    d.steps.push({ channel: 'sms', delayHours: 48, templateId: null, subject: '', body: '' });
    renderEditor();
  });
  document.querySelectorAll('.seq-step-channel, .seq-step-template').forEach((el) =>
    el.addEventListener('change', () => { syncDraft(); renderEditor(); }));
  document.querySelectorAll('[data-step-del]').forEach((b) => b.addEventListener('click', () => {
    syncDraft(); d.steps.splice(Number(b.dataset.stepDel), 1); renderEditor();
  }));
  document.querySelectorAll('[data-step-up]').forEach((b) => b.addEventListener('click', () => {
    syncDraft(); const i = Number(b.dataset.stepUp); [d.steps[i - 1], d.steps[i]] = [d.steps[i], d.steps[i - 1]]; renderEditor();
  }));
  document.querySelectorAll('[data-step-down]').forEach((b) => b.addEventListener('click', () => {
    syncDraft(); const i = Number(b.dataset.stepDown); [d.steps[i + 1], d.steps[i]] = [d.steps[i], d.steps[i + 1]]; renderEditor();
  }));
  $('seq-cancel').addEventListener('click', () => { state.editing = null; state.draft = null; renderList(); renderEditor(); });
  const del = $('seq-delete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Delete this sequence? Active enrollments in it will stop.')) return;
    try {
      await deleteSequence(state.companyId, state.editing);
      state.editing = null; state.draft = null;
      await reload();
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
  });
  $('seq-save').addEventListener('click', async () => {
    syncDraft();
    const st = $('seq-status');
    if (!d.name.trim()) { st.textContent = 'Give it a name.'; st.className = 'crm-save-status err'; return; }
    if (!d.steps.length) { st.textContent = 'Add at least one step.'; st.className = 'crm-save-status err'; return; }
    const empty = d.steps.findIndex((s) => !s.templateId && !(s.body || '').trim());
    if (empty !== -1) { st.textContent = `Step ${empty + 1} has no message.`; st.className = 'crm-save-status err'; return; }
    try {
      if (state.editing === 'new') {
        const created = await createSequence(state.companyId, d);
        state.editing = created.id;
      } else {
        await updateSequence(state.companyId, state.editing, d);
      }
      await reload();
      openEditor(state.editing);
      const s2 = $('seq-status'); if (s2) { s2.textContent = 'Saved'; s2.className = 'crm-save-status ok'; }
    } catch (e) {
      st.textContent = 'Error: ' + (e.message || e); st.className = 'crm-save-status err';
    }
  });
}

function renderEnrollments() {
  const host = $('seq-enrollments');
  const active = state.enrollments.filter((e) => e.status === 'active');
  if (!active.length) { host.innerHTML = `<div class="crm-subpanel-empty">Nobody is in a sequence right now.</div>`; return; }
  host.innerHTML = active.slice(0, 100).map((e) => {
    const seq = state.sequences.find((s) => s.id === e.sequenceId);
    const total = seq ? (seq.steps || []).length : '?';
    return `
      <div class="crm-mini-row">
        <div class="crm-mini-main">
          <div class="crm-mini-title"><a href="/contact.html?id=${encodeURIComponent(e.contactId)}" style="color:inherit;text-decoration:none;">${escapeHtml(e.contactName || e.contactId)}</a>
            <span class="crm-mini-sub">${escapeHtml(e.sequenceName || (seq && seq.name) || '')}</span></div>
          <div class="crm-mini-sub">Step ${(Number(e.currentStep) || 0) + 1} of ${total} · next ${fmtDateTime(e.nextRunAt)}${e.lastOutcome ? ' · last: ' + escapeHtml(e.lastOutcome) : ''}</div>
        </div>
        <button class="crm-chip" data-stop="${escapeHtml(e.id)}" data-contact="${escapeHtml(e.contactId)}" data-seqname="${escapeHtml(e.sequenceName || '')}">Stop</button>
      </div>`;
  }).join('');
  host.querySelectorAll('[data-stop]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await stopEnrollment(state.companyId, b.dataset.stop, { reason: 'manual', contactId: b.dataset.contact, sequenceName: b.dataset.seqname });
      await reload();
    } catch (e) { alert('Could not stop: ' + (e.message || e)); }
  }));
}

// ── Enroll modal: pick a smart list or individual contacts ──────────────
async function openEnrollModal(sequenceId) {
  const seq = state.sequences.find((s) => s.id === sequenceId);
  if (!seq) return;
  const root = $('modal-root');
  const calls = await listCalls(state.companyId, { max: 500 });
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>Enroll in <span>${escapeHtml(seq.name)}</span></h1>
        <div class="crm-form">
          <div class="crm-form-row"><label>Smart list</label>
            <select class="c-input crm-select" id="en-list">
              <option value="">— pick a list —</option>
              ${state.smartLists.map((l) => `<option value="${l.id}">${escapeHtml(l.name)} (${applySmartList(l, state.contacts, { calls }).length})</option>`).join('')}
            </select></div>
          <div class="crm-form-row"><label>Or one contact</label>
            <select class="c-input crm-select" id="en-contact">
              <option value="">— pick a contact —</option>
              ${state.contacts.map((c) => `<option value="${c.id}">${escapeHtml(c.name || 'Unnamed')}${c.phone ? '' : ' (no phone)'}</option>`).join('')}
            </select></div>
          <div id="en-err" class="auth-error" style="display:none;"></div>
          <div id="en-note" class="crm-mini-sub"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="en-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="en-go">Enroll</button>
          </div>
        </div>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ''; };
  $('en-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  $('en-go').addEventListener('click', async () => {
    const listId = $('en-list').value;
    const contactId = $('en-contact').value;
    const btn = $('en-go'); btn.disabled = true;
    const err = $('en-err'); err.style.display = 'none';
    try {
      let targets = [];
      if (listId) targets = applySmartList(state.smartLists.find((l) => l.id === listId), state.contacts, { calls });
      else if (contactId) targets = state.contacts.filter((c) => c.id === contactId);
      if (!targets.length) throw new Error('Pick a list or a contact.');
      if (targets.length > 1 && !confirm(`Enroll ${targets.length} contacts in "${seq.name}"?`)) { btn.disabled = false; return; }
      let ok = 0, skipped = 0;
      for (const c of targets) {
        try { await enrollContact(state.companyId, sequenceId, c, { source: listId ? 'smart list' : 'manual' }); ok++; }
        catch (e) { skipped++; }
      }
      $('en-note').textContent = `${ok} enrolled${skipped ? `, ${skipped} skipped (already enrolled)` : ''}.`;
      await reload();
      setTimeout(close, 900);
    } catch (e) {
      err.textContent = e.message || String(e); err.style.display = '';
      btn.disabled = false;
    }
  });
}

async function reload() {
  [state.sequences, state.enrollments] = await Promise.all([
    listSequences(state.companyId), listEnrollments(state.companyId)
  ]);
  renderList();
  renderEnrollments();
}

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/sequences.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  state.uid = u.uid;

  const content = renderCrmShell({ active: 'sequences', title: 'Sequences', user: u, role: info.role });
  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
  if (!companyId) {
    try { const r = await resolveCrmCompany(u.uid); if (r.companyId) companyId = r.companyId; } catch (e) {}
  }
  if (companyId) mountCrmCompanySwitcher(u.uid, companyId);
  if (!companyId) {
    content.innerHTML = `<div class="card"><div class="auth-error">You are not an admin of any company yet. Use /owner.html.</div></div>`;
    return;
  }
  state.companyId = companyId;
  content.innerHTML = `<div class="crm-section-sub">Loading sequences…</div>`;

  [state.templates, state.contacts, state.smartLists] = await Promise.all([
    listTemplates(companyId), listContacts(companyId), ensureDefaultSmartLists(companyId)
  ]);
  content.innerHTML = layoutHtml();
  await reload();
  renderEditor();

  $('seq-new').addEventListener('click', () => openEditor('new'));
  $('seq-run-now').addEventListener('click', async () => {
    const b = $('seq-run-now'); b.disabled = true; b.textContent = 'Running…';
    const r = await runAutomationNow(companyId);
    b.disabled = false; b.textContent = 'Run due steps now';
    alert(r && r.sequences ? `Processed ${r.sequences.processed || 0} due step${r.sequences.processed === 1 ? '' : 's'}.` : 'Could not reach the automation service.');
    await reload();
  });
}

main();
