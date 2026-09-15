// Merge fields + the shared template picker. One implementation, mounted on
// every composer (contact page SMS, conversations thread, dialer side panel,
// email modal) so a template behaves identically wherever it is used.
//
//   import { mountTemplatePicker, renderTemplate } from './merge-fields.js';
//   mountTemplatePicker({
//     host: buttonContainerEl, input: textareaEl, channel: 'sms',
//     companyId, context: () => ({ contact, owner, companyName }),
//     onInsert: (tpl, rendered) => {}   // optional; email uses it for subject
//   });
//
// Unresolved tokens are left visibly in place rather than blanked. A text
// that says "Hi {{firstName}}" is an obvious mistake to fix before sending;
// a text that says "Hi ," is a sent mistake.

import { listTemplates, bumpTemplateUse, getCompanyName, escapeHtml } from './crm.js';

export const MERGE_FIELDS = [
  { token: 'firstName',       label: 'First name',       get: (c) => firstName(c.contact) },
  { token: 'lastName',        label: 'Last name',        get: (c) => lastName(c.contact) },
  { token: 'fullName',        label: 'Full name',        get: (c) => (c.contact && c.contact.name) || '' },
  { token: 'company',         label: "Lead's company",   get: (c) => (c.contact && c.contact.companyName) || '' },
  { token: 'phone',           label: "Lead's phone",     get: (c) => (c.contact && c.contact.phone) || '' },
  { token: 'email',           label: "Lead's email",     get: (c) => (c.contact && c.contact.email) || '' },
  { token: 'ownerFirstName',  label: 'Your first name',  get: (c) => firstName(c.owner, 'displayName') },
  { token: 'ownerName',       label: 'Your full name',   get: (c) => (c.owner && (c.owner.displayName || c.owner.email)) || '' },
  { token: 'companyName',     label: 'Your company',     get: (c) => c.companyName || '' },
  { token: 'appointmentTime', label: 'Appointment time', get: (c) => apptTime(c.appointment) },
  { token: 'meetLink',        label: 'Meet link',        get: (c) => (c.appointment && c.appointment.meetLink) || '' },
  { token: 'today',           label: "Today's date",     get: () => new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) }
];

function firstName(obj, key = 'name') {
  const n = (obj && obj[key]) || '';
  return String(n).trim().split(/\s+/)[0] || '';
}
function lastName(obj) {
  const parts = String((obj && obj.name) || '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}
function apptTime(a) {
  if (!a || !a.startAt) return '';
  const d = a.startAt.toDate ? a.startAt.toDate() : new Date(a.startAt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * Replace {{token}} occurrences. Tokens with no value stay as-is (see the
 * note at the top). Whitespace inside the braces is tolerated.
 */
export function renderTemplate(text, ctx = {}) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, token) => {
    const f = MERGE_FIELDS.find((m) => m.token === token);
    if (!f) return whole;
    const v = f.get(ctx);
    return v ? String(v) : whole;
  });
}

/** True when the rendered text still carries an unresolved {{token}}. */
export function hasUnresolved(text) {
  return /\{\{\s*[a-zA-Z0-9_]+\s*\}\}/.test(String(text || ''));
}

// ────────────────────────────────────────────────────────────────
// Picker
// ────────────────────────────────────────────────────────────────

let openPicker = null;
function closeOpenPicker() {
  if (openPicker) { openPicker.remove(); openPicker = null; }
}
document.addEventListener('click', (e) => {
  if (openPicker && !openPicker.contains(e.target) && !e.target.closest('.tpl-trigger')) closeOpenPicker();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOpenPicker(); });

/**
 * Insert `text` at the caret of an input/textarea, replacing any selection,
 * and fire an input event so any listener (char counters etc.) updates.
 */
function insertAtCaret(input, text) {
  const start = input.selectionStart != null ? input.selectionStart : input.value.length;
  const end = input.selectionEnd != null ? input.selectionEnd : input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  input.value = before + text + after;
  const pos = before.length + text.length;
  try { input.setSelectionRange(pos, pos); } catch (e) {}
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

/**
 * Mount a "Templates" trigger into `host` that inserts rendered templates
 * into `input`. `context()` is called at insert time so it always sees the
 * current contact. Returns a small controller with refresh().
 */
export function mountTemplatePicker({ host, input, channel = 'sms', companyId, context, onInsert, replace = false } = {}) {
  if (!host || !input || !companyId) return null;

  let templates = null;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'crm-chip tpl-trigger';
  trigger.textContent = 'Templates';
  trigger.title = 'Insert a saved message';
  host.appendChild(trigger);

  async function load(force) {
    if (templates && !force) return templates;
    templates = await listTemplates(companyId, { channel });
    return templates;
  }

  async function buildContext() {
    const base = (typeof context === 'function' ? context() : context) || {};
    if (!base.companyName) base.companyName = await getCompanyName(companyId);
    return base;
  }

  async function open() {
    closeOpenPicker();
    const list = await load(false);
    const ctx = await buildContext();

    const pop = document.createElement('div');
    pop.className = 'tpl-picker';
    pop.innerHTML = `
      <div class="tpl-picker-head">
        <input class="c-input tpl-search" placeholder="Search templates…" autocomplete="off" />
      </div>
      <div class="tpl-picker-list"></div>
      <div class="tpl-picker-foot">
        <a href="/crm-settings.html?companyId=${encodeURIComponent(companyId)}#templates">Manage templates</a>
        <span class="tpl-fields-hint" title="${MERGE_FIELDS.map((f) => '{{' + f.token + '}} — ' + f.label).join('\n')}">merge fields</span>
      </div>`;

    const listEl = pop.querySelector('.tpl-picker-list');
    const renderList = (q) => {
      const needle = (q || '').trim().toLowerCase();
      const rows = list.filter((t) => !needle
        || String(t.name || '').toLowerCase().includes(needle)
        || String(t.body || '').toLowerCase().includes(needle)
        || String(t.category || '').toLowerCase().includes(needle));
      if (!rows.length) {
        listEl.innerHTML = `<div class="tpl-picker-empty">${list.length ? 'No matches.' : 'No templates yet. Add some in CRM Settings.'}</div>`;
        return;
      }
      listEl.innerHTML = rows.map((t) => {
        const preview = renderTemplate(t.body, ctx);
        return `
          <button type="button" class="tpl-picker-item" data-tpl="${escapeHtml(t.id)}">
            <div class="tpl-picker-name">${escapeHtml(t.name)}${t.category ? `<span class="tpl-chip">${escapeHtml(t.category)}</span>` : ''}</div>
            <div class="tpl-picker-preview">${escapeHtml(preview.slice(0, 140))}${preview.length > 140 ? '…' : ''}</div>
          </button>`;
      }).join('');
      listEl.querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
        const t = list.find((x) => x.id === b.getAttribute('data-tpl'));
        if (!t) return;
        const rendered = renderTemplate(t.body, ctx);
        if (replace || !input.value.trim()) {
          input.value = rendered;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        } else {
          insertAtCaret(input, rendered);
        }
        if (typeof onInsert === 'function') {
          onInsert(t, { body: rendered, subject: renderTemplate(t.subject || '', ctx) });
        }
        bumpTemplateUse(companyId, t.id);
        closeOpenPicker();
      }));
    };
    renderList('');
    pop.querySelector('.tpl-search').addEventListener('input', (e) => renderList(e.target.value));

    // Anchor below the trigger, clamped to the viewport.
    document.body.appendChild(pop);
    openPicker = pop;
    const r = trigger.getBoundingClientRect();
    const w = Math.min(380, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
    const belowSpace = window.innerHeight - r.bottom;
    if (belowSpace > 320) pop.style.top = (r.bottom + 6 + window.scrollY) + 'px';
    else pop.style.top = Math.max(12, r.top - 6 - Math.min(360, pop.offsetHeight)) + window.scrollY + 'px';
    pop.querySelector('.tpl-search').focus();
  }

  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (openPicker) closeOpenPicker(); else open();
  });

  return { refresh: () => load(true), trigger };
}
