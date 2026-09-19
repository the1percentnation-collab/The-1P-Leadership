// CRM Settings — pipeline & stage editor, calling preferences, and the
// Google Calendar connection. Admin/owner only.

import { app, db, firebaseReady } from './firebase.js';
import { getStorage, ref as storageRef, uploadBytes, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
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
  DEFAULT_EMAIL_SETTINGS, getEmailSettings, updateEmailSettings,
  listTemplates, createTemplate, updateTemplate, deleteTemplate,
  listVoicemailDrops, registerVoicemailDrop, setDefaultVoicemailDrop, deleteVoicemailDrop,
  fmtDateTime
} from './crm.js';
import { MERGE_FIELDS, renderTemplate } from './merge-fields.js';

const $ = (id) => document.getElementById(id);
const PROTECTED = new Set(DEFAULT_PIPELINE_STAGES.map((s) => s.id)); // referenced by contacts

const state = {
  uid: null, companyId: null, pipeline: null, stages: [], oppCountByStage: {},
  dialer: { ...DEFAULT_DIALER_SETTINGS },
  prefs: { callMode: 'softphone', mobilePhone: null },
  google: { connected: false },
  email: { ...DEFAULT_EMAIL_SETTINGS },
  templates: [],
  editingTemplate: null,  // null = new, else a template id
  drops: [],
  rec: { recorder: null, chunks: [], blob: null, mime: null, startedMs: 0, timerId: null }
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
    ${emailCardHtml()}
    ${googleCardHtml()}
    ${templatesCardHtml()}
    ${voicemailCardHtml()}
  `;
  wire();
}

// ── Voicemail drops ──────────────────────────────────────────────────────
function voicemailCardHtml() {
  const canRecord = typeof window.MediaRecorder !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  return `
    <div class="card" style="max-width:760px;" id="voicemail">
      <label class="crm-field-label" style="display:block;margin-bottom:4px;">Voicemail drop</label>
      <div class="crm-import-note" style="margin-top:0;">
        Record the message you leave when a call hits voicemail. On a live call, <strong>Drop VM</strong> plays it
        and hangs up so you can move to the next lead without waiting for the beep to finish.
        Keep it under 30 seconds and say your number twice.
      </div>

      <div id="vm-list" style="margin-top:14px;">
        ${state.drops.length ? state.drops.map((d) => `
          <div class="crm-mini-row">
            <div class="crm-mini-main">
              <div class="crm-mini-title">${escapeHtml(d.name || 'Voicemail')}
                ${d.isDefault ? '<span class="tpl-chip" style="color:var(--red);border-color:var(--border-red);">default</span>' : ''}
                ${d.durationSec ? `<span class="crm-mini-sub">${d.durationSec}s</span>` : ''}
              </div>
              <div class="crm-mini-sub">Added ${fmtDateTime(d.createdAt)}</div>
            </div>
            ${d.isDefault ? '' : `<button class="crm-chip" data-vm-default="${escapeHtml(d.id)}">Make default</button>`}
            <button class="task-del" data-vm-del="${escapeHtml(d.id)}" title="Delete">×</button>
          </div>`).join('') : '<div class="crm-subpanel-empty">No voicemail recorded yet.</div>'}
      </div>

      <div class="crm-form-row-grid" style="margin-top:16px;align-items:end;">
        <div class="crm-field">
          <label>Name</label>
          <input class="c-input" id="vm-name" placeholder="Default greeting" value="Default greeting" />
        </div>
        <div class="crm-field" style="display:flex;gap:8px;">
          ${canRecord ? `
            <button class="btn btn-primary" id="vm-record" type="button">&#9679; Record</button>
            <button class="btn btn-ghost" id="vm-stop" type="button" disabled>Stop</button>
          ` : '<span class="crm-mini-sub">This browser cannot record audio. Upload a file instead.</span>'}
          <label class="btn btn-ghost" style="cursor:pointer;">Upload
            <input type="file" id="vm-file" accept="audio/*" style="display:none;" />
          </label>
        </div>
      </div>
      <div id="vm-status" class="crm-mini-sub" style="margin-top:8px;"></div>
      <audio id="vm-preview" controls style="display:none;width:100%;max-width:420px;margin-top:10px;height:34px;"></audio>
      <div class="crm-save-row" style="margin-top:12px;">
        <span id="vm-save-status" class="crm-save-status"></span>
        <button class="btn btn-primary" id="vm-save" type="button" disabled>Save voicemail</button>
      </div>
    </div>`;
}

function pickRecorderMime() {
  // Twilio <Play> accepts mp3/wav/ogg/webm-opus is NOT in its list; prefer
  // formats Twilio can play directly. Most browsers offer webm/opus only,
  // which Twilio does not accept — so we transcode to WAV client-side below.
  const c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

/** Decode any recorded blob and re-encode as 16-bit PCM WAV, which Twilio plays. */
async function toWav(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  const buf = await blob.arrayBuffer();
  const audio = await ctx.decodeAudioData(buf);
  const rate = 8000; // telephony rate; keeps the file small and Twilio-native
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = audio; src.connect(off.destination); src.start();
  const mono = await off.startRendering();
  const pcm = mono.getChannelData(0);
  const out = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(out);
  const str = (o, s2) => { for (let i = 0; i < s2.length; i++) v.setUint8(o + i, s2.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  let o = 44;
  for (let i = 0; i < pcm.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
  }
  try { ctx.close(); } catch (e) {}
  return { blob: new Blob([out], { type: 'audio/wav' }), durationSec: Math.round(audio.duration) };
}

function wireVoicemail() {
  const status = $('vm-status');
  const preview = $('vm-preview');
  const saveBtn = $('vm-save');
  const rec = state.rec;

  const setReady = (blob, durationSec) => {
    rec.blob = blob; rec.durationSec = durationSec;
    preview.src = URL.createObjectURL(blob);
    preview.style.display = '';
    saveBtn.disabled = false;
    status.textContent = `${durationSec}s ready. Listen, then save.`;
  };

  const recordBtn = $('vm-record');
  const stopBtn = $('vm-stop');
  if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = pickRecorderMime();
        rec.recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        rec.chunks = [];
        rec.recorder.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
        rec.recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          clearInterval(rec.timerId);
          status.textContent = 'Processing…';
          try {
            const raw = new Blob(rec.chunks, { type: rec.recorder.mimeType || mime || 'audio/webm' });
            const { blob, durationSec } = await toWav(raw);
            setReady(blob, durationSec);
          } catch (e) {
            status.textContent = 'Could not process the recording: ' + (e.message || e);
          }
          recordBtn.disabled = false; stopBtn.disabled = true;
        };
        rec.recorder.start();
        rec.startedMs = Date.now();
        recordBtn.disabled = true; stopBtn.disabled = false;
        saveBtn.disabled = true; preview.style.display = 'none';
        rec.timerId = setInterval(() => {
          const s2 = Math.round((Date.now() - rec.startedMs) / 1000);
          status.textContent = `Recording… ${s2}s`;
          if (s2 >= 60) rec.recorder.stop();   // hard cap; nobody listens past this
        }, 500);
      } catch (e) {
        status.textContent = e && e.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser and try again.'
          : 'Could not start recording: ' + (e.message || e);
      }
    });
    stopBtn.addEventListener('click', () => { if (rec.recorder && rec.recorder.state === 'recording') rec.recorder.stop(); });
  }

  $('vm-file').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    status.textContent = 'Processing…';
    try {
      const { blob, durationSec } = await toWav(f);
      setReady(blob, durationSec);
    } catch (err) {
      status.textContent = 'Could not read that file: ' + (err.message || err);
    }
  });

  saveBtn.addEventListener('click', async () => {
    if (!rec.blob) return;
    const st = $('vm-save-status');
    saveBtn.disabled = true;
    st.textContent = 'Uploading…'; st.className = 'crm-save-status';
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const path = `companies/${state.companyId}/voicemails/${id}.wav`;
      await uploadBytes(storageRef(getStorage(app), path), rec.blob, { contentType: 'audio/wav' });
      await registerVoicemailDrop(state.companyId, {
        name: $('vm-name').value.trim() || 'Voicemail',
        storagePath: path, contentType: 'audio/wav', durationSec: rec.durationSec,
        isDefault: !state.drops.length
      });
      state.drops = await listVoicemailDrops(state.companyId);
      rec.blob = null;
      render();
      const el = $('voicemail'); if (el) el.scrollIntoView({ block: 'start' });
    } catch (e) {
      st.textContent = 'Error: ' + (e.message || e); st.className = 'crm-save-status err';
      saveBtn.disabled = false;
    }
  });

  document.querySelectorAll('[data-vm-default]').forEach((b) => b.addEventListener('click', async () => {
    await setDefaultVoicemailDrop(state.companyId, b.getAttribute('data-vm-default'));
    state.drops = await listVoicemailDrops(state.companyId);
    render();
  }));
  document.querySelectorAll('[data-vm-del]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-vm-del');
    const d = state.drops.find((x) => x.id === id);
    if (!d || !confirm(`Delete "${d.name}"?`)) return;
    try {
      await deleteVoicemailDrop(state.companyId, id);
      if (d.storagePath) { try { await deleteObject(storageRef(getStorage(app), d.storagePath)); } catch (e) {} }
      state.drops = await listVoicemailDrops(state.companyId);
      render();
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
  }));
}

// ── Message templates ────────────────────────────────────────────────────
const SAMPLE_CONTEXT = {
  contact: { name: 'Jordan Rivera', companyName: 'Rivera Consulting', phone: '+1 555 010 0199', email: 'jordan@example.com' },
  owner: { displayName: 'You' },
  companyName: 'The One Percent',
  appointment: { startAt: new Date(Date.now() + 2 * 24 * 3600 * 1000), meetLink: 'https://meet.google.com/abc-defg-hij' }
};

function previewHtml(text) {
  // Highlight tokens that would still be unresolved against a real contact.
  const rendered = renderTemplate(text, SAMPLE_CONTEXT);
  return escapeHtml(rendered).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, '<span class="merge-token">{{$1}}</span>');
}

function templatesCardHtml() {
  const t = state.templates.find((x) => x.id === state.editingTemplate) || { channel: 'sms', name: '', subject: '', body: '', category: '' };
  const editing = !!state.editingTemplate;
  return `
    <div class="card" style="max-width:760px;" id="templates">
      <label class="crm-field-label" style="display:block;margin-bottom:4px;">Message templates</label>
      <div class="crm-import-note" style="margin-top:0;">
        Saved texts and emails, one click away in every composer. Merge fields fill in from the contact
        you are messaging; anything that cannot be filled stays visible as <code>{{token}}</code> so you
        catch it before it sends.
      </div>

      <div id="tpl-list" style="margin-top:14px;">
        ${state.templates.length ? state.templates.map((x) => `
          <div class="crm-mini-row tpl-list-item">
            <div class="crm-mini-main">
              <div class="crm-mini-title">${escapeHtml(x.name)}
                <span class="tpl-chip">${x.channel === 'email' ? 'email' : 'sms'}</span>
                ${x.category ? `<span class="tpl-chip">${escapeHtml(x.category)}</span>` : ''}
                ${x.useCount ? `<span class="crm-mini-sub">used ${x.useCount}×</span>` : ''}
              </div>
              <div class="crm-mini-sub">${escapeHtml(String(x.body || '').slice(0, 160))}${String(x.body || '').length > 160 ? '…' : ''}</div>
            </div>
            <button class="crm-chip" data-tpl-edit="${escapeHtml(x.id)}">Edit</button>
            <button class="task-del" data-tpl-del="${escapeHtml(x.id)}" title="Delete">×</button>
          </div>`).join('') : '<div class="crm-subpanel-empty">No templates yet. Add your first one below.</div>'}
      </div>

      <label class="crm-field-label" style="display:block;margin:18px 0 8px;">${editing ? 'Edit template' : 'New template'}</label>
      <div class="tpl-editor-row">
        <div>
          <div class="crm-form-row-grid">
            <div class="crm-field"><label>Name</label>
              <input class="c-input" id="tpl-name" value="${escapeHtml(t.name || '')}" placeholder="First touch" /></div>
            <div class="crm-field"><label>Channel</label>
              <select class="c-input crm-select" id="tpl-channel">
                <option value="sms" ${t.channel !== 'email' ? 'selected' : ''}>Text (SMS)</option>
                <option value="email" ${t.channel === 'email' ? 'selected' : ''}>Email</option>
              </select></div>
          </div>
          <div class="crm-form-row-grid" style="margin-top:10px;">
            <div class="crm-field"><label>Category</label>
              <input class="c-input" id="tpl-category" value="${escapeHtml(t.category || '')}" placeholder="Follow-up, Booking, No answer…" /></div>
            <div class="crm-field" id="tpl-subject-wrap" style="${t.channel === 'email' ? '' : 'display:none;'}"><label>Subject</label>
              <input class="c-input" id="tpl-subject" value="${escapeHtml(t.subject || '')}" placeholder="Quick question, {{firstName}}" /></div>
          </div>
          <div class="crm-field" style="margin-top:10px;"><label>Message</label>
            <textarea class="c-textarea" id="tpl-body" rows="6" placeholder="Hi {{firstName}}, this is {{ownerFirstName}} from {{companyName}}…">${escapeHtml(t.body || '')}</textarea></div>
          <div class="tpl-fields">
            ${MERGE_FIELDS.map((f) => `<button type="button" class="crm-chip" data-merge="${f.token}" title="${escapeHtml(f.label)}">{{${f.token}}}</button>`).join('')}
          </div>
        </div>
        <div>
          <label class="crm-field-label" style="display:block;margin-bottom:6px;">Preview (sample contact)</label>
          <div class="tpl-preview" id="tpl-preview">${previewHtml(t.body || '')}</div>
          <div class="crm-mini-sub" id="tpl-count" style="margin-top:6px;"></div>
        </div>
      </div>
      <div class="crm-save-row" style="margin-top:16px;">
        <span id="tpl-status" class="crm-save-status"></span>
        ${editing ? '<button class="btn btn-ghost" id="tpl-cancel">Cancel</button>' : ''}
        <button class="btn btn-primary" id="tpl-save">${editing ? 'Save template' : 'Add template'}</button>
      </div>
    </div>`;
}

function wireTemplates() {
  const body = $('tpl-body');
  const sync = () => {
    $('tpl-preview').innerHTML = previewHtml(body.value);
    const n = renderTemplate(body.value, SAMPLE_CONTEXT).length;
    $('tpl-count').textContent = $('tpl-channel').value === 'sms'
      ? `${n} characters · ${Math.max(1, Math.ceil(n / 160))} SMS segment${n > 160 ? 's' : ''}`
      : `${n} characters`;
  };
  body.addEventListener('input', sync);
  $('tpl-channel').addEventListener('change', () => {
    $('tpl-subject-wrap').style.display = $('tpl-channel').value === 'email' ? '' : 'none';
    sync();
  });
  sync();

  document.querySelectorAll('[data-merge]').forEach((b) => b.addEventListener('click', () => {
    const token = '{{' + b.getAttribute('data-merge') + '}}';
    const start = body.selectionStart || body.value.length;
    const end = body.selectionEnd || start;
    body.value = body.value.slice(0, start) + token + body.value.slice(end);
    body.focus();
    body.setSelectionRange(start + token.length, start + token.length);
    sync();
  }));

  document.querySelectorAll('[data-tpl-edit]').forEach((b) => b.addEventListener('click', () => {
    state.editingTemplate = b.getAttribute('data-tpl-edit');
    render();
    const el = $('templates'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-tpl-del]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.getAttribute('data-tpl-del');
    const t = state.templates.find((x) => x.id === id);
    if (!t || !confirm(`Delete "${t.name}"?`)) return;
    try {
      await deleteTemplate(state.companyId, id);
      state.templates = state.templates.filter((x) => x.id !== id);
      if (state.editingTemplate === id) state.editingTemplate = null;
      render();
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
  }));
  const cancel = $('tpl-cancel');
  if (cancel) cancel.addEventListener('click', () => { state.editingTemplate = null; render(); });

  $('tpl-save').addEventListener('click', async () => {
    const st = $('tpl-status');
    const data = {
      name: $('tpl-name').value,
      channel: $('tpl-channel').value,
      subject: $('tpl-subject').value,
      body: $('tpl-body').value,
      category: $('tpl-category').value
    };
    if (!data.body.trim()) { st.textContent = 'Write the message first.'; st.className = 'crm-save-status err'; return; }
    try {
      if (state.editingTemplate) await updateTemplate(state.companyId, state.editingTemplate, data);
      else await createTemplate(state.companyId, data);
      state.templates = await listTemplates(state.companyId);
      state.editingTemplate = null;
      render();
      const s2 = $('tpl-status'); s2.textContent = 'Saved'; s2.className = 'crm-save-status ok';
    } catch (e) {
      st.textContent = 'Error: ' + (e.message || e); st.className = 'crm-save-status err';
    }
  });
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
// ── Email identity ───────────────────────────────────────────────────────
//
// What a lead sees in their inbox, and where their reply goes. Blank fields
// fall back to the CRM default (anthonybrown@the1pnation.com) rather than
// failing, so a half-filled form never silently stops email working.
function emailCardHtml() {
  const e = state.email;
  return `
    <div class="card" style="max-width:760px;">
      <label class="crm-field-label" style="display:block;margin-bottom:8px;">Email</label>
      <div class="crm-import-note" style="margin-top:0;">
        The identity on 1-on-1 emails sent from a contact card. The sending domain must be
        authenticated in SendGrid or messages land in spam — see <code>docs/email-setup.md</code>.
        Replies come back into the CRM and appear on the contact's timeline.
      </div>
      <div class="crm-field" style="margin-top:16px;">
        <label>From address</label>
        <input class="c-input" id="em-from" type="email" placeholder="anthonybrown@the1pnation.com" value="${escapeHtml(e.fromEmail || '')}" />
      </div>
      <div class="crm-field" style="margin-top:12px;">
        <label>From name</label>
        <input class="c-input" id="em-name" placeholder="Anthony Brown" value="${escapeHtml(e.fromName || '')}" />
      </div>
      <div class="crm-field" style="margin-top:12px;">
        <label>Reply-to (used only when inbound email is not configured)</label>
        <input class="c-input" id="em-replyto" type="email" placeholder="anthonybrown@the1pnation.com" value="${escapeHtml(e.replyTo || '')}" />
      </div>
      <div class="crm-field" style="margin-top:12px;">
        <label>Forward inbound replies to</label>
        <input class="c-input" id="em-forward" type="email" placeholder="anthonybrown@the1pnation.com" value="${escapeHtml(e.forwardInboundTo || '')}" />
        <div class="crm-mini-sub" style="margin-top:4px;">
          Optional. Sends a copy of every reply to a real mailbox, so the CRM is not the only place it exists.
        </div>
      </div>
      <div class="crm-field" style="margin-top:12px;">
        <label>Signature</label>
        <textarea class="c-textarea" id="em-signature" rows="3" placeholder="Anthony Brown&#10;The One Percent Nation">${escapeHtml(e.signature || '')}</textarea>
        <div class="crm-mini-sub" style="margin-top:4px;">Appended to every 1-on-1 email after a <code>--</code> separator.</div>
      </div>
      <div class="crm-save-row" style="margin-top:20px;">
        <span id="set-email-status" class="crm-save-status"></span>
        <button class="btn btn-primary" id="save-email">Save email settings</button>
      </div>
    </div>`;
}

async function saveEmail() {
  const st = $('set-email-status');
  const from = $('em-from').value.trim();
  const forward = $('em-forward').value.trim();
  const replyTo = $('em-replyto').value.trim();
  const bad = [from, forward, replyTo].find((v) => v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v));
  if (bad) {
    st.textContent = `Not a valid email address: ${bad}`; st.className = 'crm-save-status err';
    return;
  }
  try {
    await updateEmailSettings(state.companyId, {
      fromEmail: from,
      fromName: $('em-name').value.trim(),
      replyTo,
      forwardInboundTo: forward,
      signature: $('em-signature').value
    });
    state.email = await getEmailSettings(state.companyId);
    st.textContent = 'Saved'; st.className = 'crm-save-status ok';
  } catch (e) {
    st.textContent = 'Error: ' + (e.message || e); st.className = 'crm-save-status err';
  }
}

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
  $('save-email').addEventListener('click', saveEmail);
  wireTemplates();
  wireVoicemail();
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
  const [opps, dialer, prefs, google, templates, drops, email] = await Promise.all([
    listOpportunities(companyId, { pipelineId: state.pipeline.id }),
    getDialerSettings(companyId),
    getAgentPrefs(u.uid),
    getGoogleCalendarStatus(companyId),
    listTemplates(companyId),
    listVoicemailDrops(companyId),
    getEmailSettings(companyId)
  ]);
  state.email = email;
  state.templates = templates;
  state.drops = drops;
  state.oppCountByStage = {};
  opps.forEach((o) => { state.oppCountByStage[o.stageId] = (state.oppCountByStage[o.stageId] || 0) + 1; });
  state.dialer = dialer;
  state.prefs = prefs;
  state.google = google;
  render();
}

main();
