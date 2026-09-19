// CRM main page — Kanban + List views, filters, + New Contact modal.
// Admin/owner only. Relies on crm.js for data + shape.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell, setCrmUnreadCount } from './crm-shell.js';
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import {
  STAGES, STAGE_IDS, SOURCES, stageMeta,
  listContacts, createContact, changeStage, listCompanyAdmins,
  callBlockReason, contactFreshness,
  escapeHtml, fmtDate, toDate
} from './crm.js';
import { dialer, onDialerEvent } from './dialer-core.js';
import { toCsv, downloadCsv } from './csv.js';

const $ = (id) => document.getElementById(id);

// Markup injected into the shell's #crm-content (was static in crm.html).
const PANEL_HTML = `
  <div class="crm-toolbar">
    <div class="crm-tabs">
      <button class="crm-tab active" data-tab="kanban">Kanban</button>
      <button class="crm-tab" data-tab="list">List</button>
    </div>
    <div class="crm-toolbar-spacer"></div>
    <input id="crm-search" class="c-input crm-search" placeholder="Search name or email…" />
    <button class="btn btn-ghost" id="btn-export-csv" title="Download the contacts currently shown">Export CSV</button>
    <a class="btn btn-ghost" id="btn-import-csv" href="/crm-import.html">Import CSV</a>
    <button class="btn btn-primary" id="btn-new-contact">+ New Contact</button>
  </div>
  <div class="crm-filters">
    <div class="crm-chip-row" id="crm-owner-chips">
      <button class="crm-chip active" data-owner-filter="all">All</button>
      <button class="crm-chip" data-owner-filter="mine">Mine</button>
    </div>
    <div class="crm-chip-row" id="crm-stage-chips"></div>
    <div class="crm-chip-row" id="crm-tag-chips"></div>
  </div>
  <div id="view-kanban" class="crm-view"></div>
  <div id="view-list" class="crm-view" style="display:none;"></div>
`;

let contentEl = null;

const state = {
  role: null,
  companyId: null,
  uid: null,
  tab: 'kanban',
  contacts: [],
  admins: [],            // [{uid, displayName, email}]
  filters: {
    owner: 'all',        // 'all' | 'mine'
    stage: null,         // null | stage id
    tag: null,           // null | string
    search: ''
  },
  sort: { key: 'lastActivityAt', dir: 'desc' }
};

function gate(msg) {
  if (contentEl) contentEl.innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`;
}

// ────────────────────────────────────────────────────────────────
// Filter helpers
// ────────────────────────────────────────────────────────────────
function filteredContacts() {
  let rows = state.contacts.slice();
  const f = state.filters;
  if (f.owner === 'mine' && state.uid) {
    rows = rows.filter((c) => c.ownerUid === state.uid);
  }
  if (f.stage) rows = rows.filter((c) => c.stage === f.stage);
  if (f.tag) rows = rows.filter((c) => Array.isArray(c.tags) && c.tags.includes(f.tag));
  if (f.search) {
    const q = f.search.toLowerCase();
    rows = rows.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const email = (c.email || '').toLowerCase();
      const companyName = (c.companyName || '').toLowerCase();
      return name.includes(q) || email.includes(q) || companyName.includes(q);
    });
  }
  return rows;
}

/**
 * Download the contacts currently in view as CSV.
 *
 * Exports the filtered set rather than everything, so what lands in the file
 * matches what the user is looking at. The column order is the same one the
 * importer reads, which makes an export a valid input for a re-import — the
 * practical way to bulk-edit a list in a spreadsheet and push it back.
 */
function exportVisibleContacts() {
  const rows = filteredContacts();
  if (!rows.length) return;
  const stageLabel = (id) => (stageMeta(id) || {}).label || id || '';
  const iso = (ts) => {
    const d = toDate(ts);
    return d ? d.toISOString().slice(0, 10) : '';
  };
  const ownerName = (uid) => {
    if (!uid) return '';
    const a = state.admins.find((x) => x.uid === uid);
    return a ? (a.displayName || a.email || '') : '';
  };
  const csv = toCsv(
    ['Name', 'Email', 'Phone', 'Company', 'Tags', 'Stage', 'Source', 'Owner', 'Created', 'Last activity', 'Last contacted'],
    rows.map((c) => [
      c.name || '',
      c.email || '',
      c.phone || '',
      c.companyName || '',
      Array.isArray(c.tags) ? c.tags.join('; ') : '',
      stageLabel(c.stage),
      c.source || '',
      ownerName(c.ownerUid),
      iso(c.createdAt),
      iso(c.lastActivityAt),
      iso(c.lastContactedAt)
    ])
  );
  const stamp = new Date().toISOString().slice(0, 10);
  downloadCsv(`contacts-${stamp}.csv`, csv);
}

function renderStageChips() {
  const el = $('crm-stage-chips');
  if (!el) return;
  el.innerHTML = [
    `<button class="crm-chip ${!state.filters.stage ? 'active' : ''}" data-stage-filter="">All stages</button>`,
    ...STAGES.map((s) => `
      <button class="crm-chip ${state.filters.stage === s.id ? 'active' : ''}" data-stage-filter="${s.id}">
        <span class="crm-dot" style="background:${s.color}"></span>${escapeHtml(s.label)}
      </button>`)
  ].join('');
  el.querySelectorAll('[data-stage-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.getAttribute('data-stage-filter');
      state.filters.stage = v || null;
      renderStageChips();
      renderCurrentView();
    });
  });
}

function renderTagChips() {
  const el = $('crm-tag-chips');
  if (!el) return;
  const allTags = new Set();
  state.contacts.forEach((c) => (c.tags || []).forEach((t) => allTags.add(t)));
  if (!allTags.size) { el.innerHTML = ''; return; }
  const tags = Array.from(allTags).sort();
  el.innerHTML = [
    `<button class="crm-chip ${!state.filters.tag ? 'active' : ''}" data-tag-filter="">All tags</button>`,
    ...tags.map((t) => `<button class="crm-chip ${state.filters.tag === t ? 'active' : ''}" data-tag-filter="${escapeHtml(t)}">#${escapeHtml(t)}</button>`)
  ].join('');
  el.querySelectorAll('[data-tag-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      const v = b.getAttribute('data-tag-filter');
      state.filters.tag = v || null;
      renderTagChips();
      renderCurrentView();
    });
  });
}

function renderOwnerChips() {
  const wrap = $('crm-owner-chips');
  if (!wrap) return;
  wrap.querySelectorAll('[data-owner-filter]').forEach((b) => {
    b.classList.toggle('active', state.filters.owner === b.getAttribute('data-owner-filter'));
    b.onclick = () => {
      state.filters.owner = b.getAttribute('data-owner-filter');
      renderOwnerChips();
      renderCurrentView();
    };
  });
}

// ────────────────────────────────────────────────────────────────
// Kanban view
// ────────────────────────────────────────────────────────────────
function contactCardHtml(c) {
  const meta = stageMeta(c.stage);
  const tags = (c.tags || []).slice(0, 2);
  const moreTags = Math.max(0, (c.tags || []).length - tags.length);
  const subparts = [];
  if (c.companyName) subparts.push(escapeHtml(c.companyName));
  const owner = state.admins.find((a) => a.uid === c.ownerUid);
  if (owner) subparts.push(escapeHtml(owner.displayName || owner.email || 'Owner'));
  return `
    <div class="crm-card" draggable="true" data-contact-id="${c.id}" data-stage="${c.stage}">
      <a class="crm-card-main" href="/contact.html?id=${encodeURIComponent(c.id)}">
        <div class="crm-card-head">
          <span class="crm-dot" style="background:${meta.color}"></span>
          <span class="crm-card-name">${escapeHtml(c.name || 'Unnamed')}</span>
        </div>
        ${subparts.length ? `<div class="crm-card-sub">${subparts.join(' · ')}</div>` : ''}
        ${tags.length ? `<div class="crm-card-tags">${tags.map((t) => `<span class="crm-tag">#${escapeHtml(t)}</span>`).join('')}${moreTags ? `<span class="crm-tag crm-tag-more">+${moreTags}</span>` : ''}</div>` : ''}
        <div class="crm-card-foot">${freshnessPillHtml(c)}${unreadBadgeHtml(c)}</div>
      </a>
      <div class="crm-card-actions">${quickActionsHtml(c)}</div>
    </div>
  `;
}

/**
 * Call / Text buttons shared by the kanban card and the list row. Each is
 * disabled with the reason in its tooltip rather than hidden, so a missing
 * phone number or an opt-out is visible instead of mysterious.
 */
function quickActionsHtml(c) {
  const callBlock = callBlockReason(c);
  const smsBlock = !c.phone
    ? 'No phone number'
    : (c.smsOptedOut === true ? 'Opted out of SMS' : null);
  return `
    <button class="crm-quick-btn" draggable="false" data-quick-call="${c.id}"
            ${callBlock ? 'disabled' : ''} title="${escapeHtml(callBlock || 'Call ' + (c.name || 'contact'))}">&#9742; Call</button>
    <button class="crm-quick-btn" draggable="false" data-quick-text="${c.id}"
            ${smsBlock ? 'disabled' : ''} title="${escapeHtml(smsBlock || 'Text ' + (c.name || 'contact'))}">&#128172; Text</button>`;
}

/**
 * Wire the quick actions inside `host`. Calls happen in place via the docked
 * call bar; texting hands off to the Conversations thread for that contact,
 * which is already a real two-way inbox.
 */
function wireQuickActions(host) {
  host.querySelectorAll('[data-quick-call]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const c = state.contacts.find((x) => x.id === b.getAttribute('data-quick-call'));
      if (!c) return;
      try {
        await dialer.callContact(c);
      } catch (err) {
        const msg = err && err.message;
        if (msg && msg !== 'Cancelled.') alert(msg);
        return;
      }
      await refreshContacts();
    });
  });
  host.querySelectorAll('[data-quick-text]').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = b.getAttribute('data-quick-text');
      location.href = '/contact.html?id=' + encodeURIComponent(id) + '&compose=sms';
    });
  });
}

function renderKanban() {
  const host = $('view-kanban');
  const rows = filteredContacts();
  const byStage = {};
  STAGE_IDS.forEach((s) => { byStage[s] = []; });
  rows.forEach((c) => {
    const s = STAGE_IDS.includes(c.stage) ? c.stage : 'new';
    byStage[s].push(c);
  });
  host.innerHTML = `
    <div class="crm-kanban">
      ${STAGES.map((s) => `
        <div class="crm-col" data-col-stage="${s.id}">
          <div class="crm-col-head">
            <span class="crm-dot" style="background:${s.color}"></span>
            <span class="crm-col-title">${escapeHtml(s.label)}</span>
            <span class="crm-col-count">${byStage[s.id].length}</span>
          </div>
          <div class="crm-col-body" data-drop-stage="${s.id}">
            ${byStage[s.id].map(contactCardHtml).join('') || '<div class="crm-col-empty">—</div>'}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  wireQuickActions(host);

  // Drag & drop — HTML5 native.
  host.querySelectorAll('.crm-card').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        contactId: el.dataset.contactId,
        fromStage: el.dataset.stage
      }));
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
  });
  host.querySelectorAll('[data-drop-stage]').forEach((col) => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('crm-col-over');
    });
    col.addEventListener('dragleave', () => col.classList.remove('crm-col-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('crm-col-over');
      let payload = null;
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}'); } catch (_) {}
      if (!payload || !payload.contactId) return;
      const toStage = col.getAttribute('data-drop-stage');
      if (toStage === payload.fromStage) return;
      // Optimistic update
      const c = state.contacts.find((x) => x.id === payload.contactId);
      if (c) c.stage = toStage;
      renderKanban();
      try {
        await changeStage(state.companyId, payload.contactId, payload.fromStage, toStage);
        // Refresh to pick up new lastActivityAt timestamp.
        state.contacts = await listContacts(state.companyId);
        renderKanban();
      } catch (err) {
        alert('Could not move: ' + (err.message || err));
        await refreshContacts();
      }
    });
  });
}

// ────────────────────────────────────────────────────────────────
// List view
// ────────────────────────────────────────────────────────────────
function ownerLabel(uid) {
  const a = state.admins.find((x) => x.uid === uid);
  if (!a) return '—';
  return a.displayName || a.email || uid.slice(0, 6);
}

/**
 * How long since anyone actually reached this lead. Deliberately separate from
 * the Last Activity column beside it: that one moves when the record is
 * edited, this one only when someone made contact.
 */
function freshnessPillHtml(c) {
  const f = contactFreshness(c);
  return `<span class="crm-fresh-pill crm-fresh-${f.id}" style="--fresh-color:${f.color}" title="${escapeHtml(f.never ? 'Nobody has contacted this lead yet' : f.detail)}">${escapeHtml(f.never ? 'Never' : f.short)}</span>`;
}

/** Unread inbound email waiting on this contact's card. */
function unreadBadgeHtml(c) {
  const n = Number(c.emailUnreadCount) || 0;
  if (n <= 0) return '';
  return `<span class="sms-unread crm-list-unread" title="${n} unread ${n === 1 ? 'reply' : 'replies'}">${n}</span>`;
}

function renderList() {
  const host = $('view-list');
  const rows = filteredContacts().slice();
  const { key, dir } = state.sort;
  const mult = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    let va, vb;
    if (key === 'lastActivityAt') {
      va = a.lastActivityAt && a.lastActivityAt.toMillis ? a.lastActivityAt.toMillis() : 0;
      vb = b.lastActivityAt && b.lastActivityAt.toMillis ? b.lastActivityAt.toMillis() : 0;
    } else if (key === 'lastContactedAt') {
      // Never-contacted sorts as the oldest possible, so descending puts the
      // freshest first and ascending surfaces the people nobody has called.
      va = toDate(a.lastContactedAt) ? toDate(a.lastContactedAt).getTime() : 0;
      vb = toDate(b.lastContactedAt) ? toDate(b.lastContactedAt).getTime() : 0;
    } else if (key === 'owner') {
      va = ownerLabel(a.ownerUid).toLowerCase();
      vb = ownerLabel(b.ownerUid).toLowerCase();
    } else {
      va = (a[key] || '').toString().toLowerCase();
      vb = (b[key] || '').toString().toLowerCase();
    }
    if (va < vb) return -1 * mult;
    if (va > vb) return 1 * mult;
    return 0;
  });

  const hdr = (k, label) => {
    const active = state.sort.key === k;
    const arrow = active ? (state.sort.dir === 'asc' ? '↑' : '↓') : '';
    return `<th class="crm-th ${active ? 'active' : ''}" data-sort="${k}">${escapeHtml(label)} <span class="crm-sort-arrow">${arrow}</span></th>`;
  };
  host.innerHTML = `
    <div class="card crm-list-card">
      <table class="data-table crm-list-table">
        <thead>
          <tr>
            ${hdr('name', 'Name')}
            ${hdr('email', 'Email')}
            ${hdr('phone', 'Phone')}
            ${hdr('companyName', 'Company')}
            ${hdr('stage', 'Stage')}
            ${hdr('owner', 'Owner')}
            <th>Tags</th>
            ${hdr('lastContactedAt', 'Last Contacted')}
            ${hdr('lastActivityAt', 'Last Activity')}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.length ? rows.map((c) => {
            const meta = stageMeta(c.stage);
            const tags = (c.tags || []).slice(0, 3);
            return `
              <tr class="crm-list-row" data-contact-id="${c.id}">
                <td>
                  <a href="/contact.html?id=${encodeURIComponent(c.id)}" class="crm-list-name">${escapeHtml(c.name || 'Unnamed')}</a>
                  ${unreadBadgeHtml(c)}
                </td>
                <td>${escapeHtml(c.email || '—')}</td>
                <td>${escapeHtml(c.phone || '—')}</td>
                <td>${escapeHtml(c.companyName || '—')}</td>
                <td><span class="crm-stage-badge" style="--stage-color:${meta.color}">${escapeHtml(meta.label)}</span></td>
                <td>${escapeHtml(ownerLabel(c.ownerUid))}</td>
                <td>${tags.map((t) => `<span class="crm-tag">#${escapeHtml(t)}</span>`).join('') || '—'}</td>
                <td>${freshnessPillHtml(c)}</td>
                <td>${fmtDate(c.lastActivityAt)}</td>
                <td><div class="crm-row-actions">${quickActionsHtml(c)}</div></td>
              </tr>
            `;
          }).join('') : `<tr><td colspan="10" style="color:var(--gray-mid);">No contacts yet.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  host.querySelectorAll('.crm-th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-sort');
      if (state.sort.key === k) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.key = k;
        // Recency columns read newest-first by default; everything else A-Z.
        state.sort.dir = (k === 'lastActivityAt' || k === 'lastContactedAt') ? 'desc' : 'asc';
      }
      renderList();
    });
  });
  wireQuickActions(host);

  host.querySelectorAll('.crm-list-row').forEach((tr) => {
    tr.addEventListener('click', (e) => {
      // Let link clicks, and the row's own Call/Text buttons, handle themselves.
      if (e.target.tagName === 'A') return;
      if (e.target.closest('.crm-row-actions')) return;
      const id = tr.dataset.contactId;
      location.href = '/contact.html?id=' + encodeURIComponent(id);
    });
  });
}

function renderCurrentView() {
  renderTagChips();
  if (state.tab === 'kanban') {
    $('view-kanban').style.display = '';
    $('view-list').style.display = 'none';
    renderKanban();
  } else {
    $('view-kanban').style.display = 'none';
    $('view-list').style.display = '';
    renderList();
  }
}

// ────────────────────────────────────────────────────────────────
// New Contact modal
// ────────────────────────────────────────────────────────────────
function openNewContactModal() {
  const root = $('modal-root');
  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>New <span>Contact</span></h1>
        <form id="new-contact-form" class="crm-form">
          <div class="crm-form-row">
            <label>Name *</label>
            <input class="c-input" id="nc-name" required placeholder="Jane Doe" />
          </div>
          <div class="crm-form-row">
            <label>Email</label>
            <input class="c-input" id="nc-email" type="email" placeholder="jane@acme.com" />
          </div>
          <div class="crm-form-row">
            <label>Phone</label>
            <input class="c-input" id="nc-phone" placeholder="+1 555…" />
          </div>
          <div class="crm-form-row">
            <label>Company</label>
            <input class="c-input" id="nc-company" placeholder="Acme Inc." />
          </div>
          <div class="crm-form-row-grid">
            <div class="crm-form-row">
              <label>Stage</label>
              <select class="c-input crm-select" id="nc-stage">
                ${STAGES.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('')}
              </select>
            </div>
            <div class="crm-form-row">
              <label>Source</label>
              <select class="c-input crm-select" id="nc-source">
                ${SOURCES.map((s) => `<option value="${s}">${escapeHtml(s)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="crm-form-row">
            <label>Owner</label>
            <select class="c-input crm-select" id="nc-owner"></select>
          </div>
          <div class="crm-form-row">
            <label>Tags (comma-separated)</label>
            <input class="c-input" id="nc-tags" placeholder="vip, warm, Q2" />
          </div>
          <div id="nc-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="nc-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Create contact</button>
          </div>
        </form>
      </div>
    </div>
  `;
  const ownerSel = $('nc-owner');
  const opts = [
    `<option value="${state.uid}">Me</option>`,
    ...state.admins.filter((a) => a.uid !== state.uid).map((a) =>
      `<option value="${a.uid}">${escapeHtml(a.displayName || a.email || a.uid)}</option>`)
  ];
  ownerSel.innerHTML = opts.join('');

  const close = () => { root.innerHTML = ''; };
  $('nc-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => {
    if (e.target.id === 'modal-bd') close();
  });

  $('new-contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('nc-err');
    errEl.style.display = 'none';
    try {
      const tags = ($('nc-tags').value || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      await createContact(state.companyId, {
        name: $('nc-name').value,
        email: $('nc-email').value || null,
        phone: $('nc-phone').value || null,
        companyName: $('nc-company').value || null,
        stage: $('nc-stage').value,
        source: $('nc-source').value,
        ownerUid: $('nc-owner').value,
        tags
      });
      close();
      await refreshContacts();
    } catch (err) {
      errEl.textContent = err.message || String(err);
      errEl.style.display = '';
    }
  });
}

// ────────────────────────────────────────────────────────────────
// Bootstrap
// ────────────────────────────────────────────────────────────────
async function refreshContacts() {
  state.contacts = await listContacts(state.companyId);
  setCrmUnreadCount(state.contacts.reduce((n, c) => n + (Number(c.emailUnreadCount) || 0), 0));
  renderStageChips();
  renderTagChips();
  renderCurrentView();
}

async function resolveCompanyId(uid, info) {
  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
  if (!companyId && info.isAdmin) {
    try {
      // Multi-company aware: honors ?companyId=, remembers the last pick,
      // and never silently lands an admin of two companies in the wrong one.
      const resolved = await resolveCrmCompany(uid);
      if (resolved.companyId) companyId = resolved.companyId;
    } catch (e) {}
  }
  if (companyId) mountCrmCompanySwitcher(uid, companyId);
  return companyId;
}

async function main() {
  if (!firebaseReady) {
    const root = document.getElementById('crm-root');
    if (root) root.innerHTML = '<div class="card"><div class="auth-error">Firebase is unavailable.</div></div>';
    return;
  }
  const u = await onAuthReady();
  if (!u) {
    location.replace('/login.html?next=' + encodeURIComponent('/crm.html'));
    return;
  }
  const info = await getRoleInfo(true);
  state.uid = u.uid;
  state.role = info.role;

  if (!info.isAdmin) {
    // Bootstrap guard — CRM is admin/owner only.
    location.replace('/index.html');
    return;
  }

  contentEl = renderCrmShell({ active: 'contacts', title: 'Contacts', user: u, role: info.role });

  const companyId = await resolveCompanyId(u.uid, info);
  if (!companyId) {
    gate('You are not an admin of any company yet. Ask the owner to create your company or use /owner.html.');
    return;
  }
  state.companyId = companyId;

  contentEl.innerHTML = PANEL_HTML;

  // Wire tabs
  document.querySelectorAll('.crm-tab[data-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.crm-tab[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      state.tab = b.getAttribute('data-tab');
      renderCurrentView();
    });
  });

  // Wire search
  $('crm-search').addEventListener('input', (e) => {
    state.filters.search = (e.target.value || '').trim();
    renderCurrentView();
  });

  // Wire new contact
  $('btn-new-contact').addEventListener('click', openNewContactModal);

  // Export what the user is actually looking at, filters and all — an export
  // that ignores the filters is a different list from the one on screen.
  $('btn-export-csv').addEventListener('click', exportVisibleContacts);

  // Carry the company through to the import page. An admin of two companies
  // who switched here would otherwise land on the import resolving to their
  // default company and load the list into the wrong CRM.
  const imp = $('btn-import-csv');
  if (imp && state.companyId) {
    imp.href = '/crm-import.html?companyId=' + encodeURIComponent(state.companyId);
  }

  // Load data
  try {
    state.admins = await listCompanyAdmins(companyId);
  } catch (e) { state.admins = []; }

  // The softphone is shared with the contact page and the dialer queue; the
  // Twilio Device is only built on the first real call.
  try {
    await dialer.configure({ companyId, uid: u.uid });
  } catch (e) { console.warn('[crm] dialer configure failed', e); }
  // A logged call bumps lastActivityAt, which reorders both views.
  onDialerEvent('disposition', () => { refreshContacts().catch(() => {}); });

  renderOwnerChips();
  renderStageChips();

  await refreshContacts();
}

main();
