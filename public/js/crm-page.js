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
    <div class="crm-toolbar-group">
      <button type="button" class="crm-toolbar-more" id="crm-toolbar-more" aria-haspopup="true" aria-expanded="false" aria-label="More actions">
        <svg viewBox="0 0 16 4" aria-hidden="true"><circle cx="2" cy="2" r="1.6"/><circle cx="8" cy="2" r="1.6"/><circle cx="14" cy="2" r="1.6"/></svg>
      </button>
      <div class="crm-toolbar-actions" id="crm-toolbar-actions">
        <button class="btn btn-ghost" id="btn-export-csv" title="Download the contacts currently shown">Export CSV</button>
        <a class="btn btn-ghost" id="btn-import-csv" href="/crm-import.html">Import CSV</a>
      </div>
    </div>
    <button class="btn btn-primary" id="btn-new-contact">+ New Contact</button>
  </div>
  <div class="crm-filters">
    <div class="crm-seg" id="crm-owner-chips">
      <button class="crm-seg-btn active" data-owner-filter="all">All</button>
      <button class="crm-seg-btn" data-owner-filter="mine">Mine</button>
    </div>
    <div class="crm-filter" id="crm-stage-filter"></div>
    <div class="crm-filter" id="crm-tag-filter"></div>
    <button type="button" class="crm-filter-clear" id="crm-clear-filters" hidden>Clear</button>
    <span class="crm-filter-count" id="crm-filter-count"></span>
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
// Filter state <-> URL
//
// Filters used to live only in memory, so a refresh — or coming back from a
// contact page — dropped you to All / All stages / All tags. Keeping them in
// the query string fixes that and makes a filtered board shareable: a link
// can point a teammate straight at one tag inside one stage.
// ────────────────────────────────────────────────────────────────
const URL_KEYS = { owner: 'owner', stage: 'stage', tag: 'tag', search: 'q' };

function readFiltersFromUrl() {
  const p = new URLSearchParams(location.search);
  if (p.get(URL_KEYS.owner) === 'mine') state.filters.owner = 'mine';
  const stage = p.get(URL_KEYS.stage);
  if (stage && STAGE_IDS.includes(stage)) state.filters.stage = stage;
  const tag = p.get(URL_KEYS.tag);
  if (tag) state.filters.tag = tag;
  const q = (p.get(URL_KEYS.search) || '').trim();
  if (q) state.filters.search = q;
}

/**
 * Mirror the active filters into the address bar.
 *
 * replaceState rather than pushState: filtering is not navigation, and a
 * dozen chip clicks should not mean a dozen taps of the back button. Other
 * params (companyId, most importantly) are preserved.
 */
function syncFiltersToUrl() {
  const p = new URLSearchParams(location.search);
  const f = state.filters;
  const set = (k, v) => { if (v) p.set(k, v); else p.delete(k); };
  set(URL_KEYS.owner, f.owner === 'mine' ? 'mine' : null);
  set(URL_KEYS.stage, f.stage);
  set(URL_KEYS.tag, f.tag);
  set(URL_KEYS.search, f.search);
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
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

/** Past this many options, scrolling a list beats reading it — add a filter box. */
const FILTER_SEARCH_THRESHOLD = 10;

/**
 * One compact dropdown filter (stage or tag).
 *
 * The filter bar used to be three wrapping rows of chips, which grew a row
 * taller with every new tag and pushed the board down the page. A dropdown
 * keeps the bar one line high no matter how many tags a company collects,
 * and the trigger doubles as the readout of what is currently filtered.
 *
 * Long lists (tags, mostly) get a type-to-filter box so finding one among
 * fifty is a few keystrokes instead of a scroll.
 */
function renderFilterMenu(hostId, opts) {
  const host = $(hostId);
  if (!host) return;
  const { options, allLabel, value, onPick, searchPlaceholder } = opts;
  if (!options.length) { host.innerHTML = ''; return; }

  const current = options.find((o) => o.value === value) || null;
  const label = current ? current.label : allLabel;
  const dot = current && current.color
    ? `<span class="crm-dot" style="background:${current.color}"></span>`
    : '';
  const searchable = options.length > FILTER_SEARCH_THRESHOLD;

  host.innerHTML = `
    <button type="button" class="crm-filter-btn ${current ? 'active' : ''}" aria-haspopup="true" aria-expanded="false">
      ${dot}<span class="crm-filter-label">${escapeHtml(label)}</span>
      <svg class="crm-filter-caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="crm-filter-pop" hidden>
      ${searchable ? `
        <div class="crm-filter-search-wrap">
          <input type="text" class="crm-filter-search" placeholder="${escapeHtml(searchPlaceholder || 'Filter…')}" autocomplete="off" spellcheck="false" />
        </div>` : ''}
      <div class="crm-filter-opts">
        <button type="button" class="crm-filter-opt ${!current ? 'selected' : ''}" data-value="">${escapeHtml(allLabel)}</button>
        ${options.map((o) => `
          <button type="button" class="crm-filter-opt ${o.value === value ? 'selected' : ''}" data-value="${escapeHtml(o.value)}" data-search="${escapeHtml(o.label.toLowerCase())}">
            ${o.color ? `<span class="crm-dot" style="background:${o.color}"></span>` : ''}${escapeHtml(o.label)}
          </button>`).join('')}
        <div class="crm-filter-empty" hidden>No matches</div>
      </div>
    </div>
  `;

  const btn = host.querySelector('.crm-filter-btn');
  const pop = host.querySelector('.crm-filter-pop');
  const search = pop.querySelector('.crm-filter-search');
  const empty = pop.querySelector('.crm-filter-empty');

  const pick = (v) => { closeAllFilterMenus(); onPick(v || null); };

  // Clicks inside the menu must not reach the document-level close handler,
  // or typing in the search box would shut the menu it belongs to.
  pop.addEventListener('click', (e) => e.stopPropagation());

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    closeAllFilterMenus();
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) {
      alignPop(pop);
      if (search) { search.value = ''; applySearch(); search.focus(); }
    }
  });

  pop.querySelectorAll('[data-value]').forEach((b) => {
    b.addEventListener('click', () => pick(b.getAttribute('data-value')));
  });

  function applySearch() {
    if (!search) return;
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    pop.querySelectorAll('[data-search]').forEach((b) => {
      const hit = !q || b.getAttribute('data-search').includes(q);
      b.hidden = !hit;
      if (hit) shown++;
    });
    // "All tags" is the way back out of a filter, so it stays put unless the
    // user is actively searching for something narrower.
    const allOpt = pop.querySelector('[data-value=""]');
    if (allOpt) allOpt.hidden = !!q;
    if (empty) empty.hidden = shown > 0;
  }

  if (search) {
    search.addEventListener('input', applySearch);
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = Array.from(pop.querySelectorAll('[data-search]')).find((b) => !b.hidden);
        if (first) pick(first.getAttribute('data-value'));
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        closeAllFilterMenus();
        btn.focus();
      }
    });
  }
}

/**
 * Keep an open menu inside the viewport.
 *
 * The menus hang left-aligned under their trigger, which runs off the right
 * edge on a phone once the trigger sits far enough along the row. Flip to
 * right-aligned when that would happen, and back when it would not.
 */
function alignPop(pop) {
  pop.style.left = '0';
  pop.style.right = 'auto';
  const r = pop.getBoundingClientRect();
  if (r.right > window.innerWidth - 8) {
    pop.style.left = 'auto';
    pop.style.right = '0';
  }
}

function closeAllFilterMenus() {
  document.querySelectorAll('.crm-filter-pop').forEach((p) => { p.hidden = true; });
  document.querySelectorAll('.crm-filter-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

document.addEventListener('click', closeAllFilterMenus);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAllFilterMenus(); });

function renderStageChips() {
  renderFilterMenu('crm-stage-filter', {
    allLabel: 'All stages',
    value: state.filters.stage,
    options: STAGES.map((s) => ({ value: s.id, label: s.label, color: s.color })),
    onPick: (v) => {
      state.filters.stage = v;
      syncFiltersToUrl();
      renderStageChips();
      renderCurrentView();
    }
  });
  renderFilterBarState();
}

function renderTagChips() {
  const all = new Set();
  state.contacts.forEach((c) => (c.tags || []).forEach((t) => all.add(t)));
  const tags = Array.from(all).sort();
  // A tag can disappear when the last contact carrying it is filtered away or
  // retagged; drop the selection instead of leaving a filter nothing matches.
  if (state.filters.tag && !all.has(state.filters.tag)) {
    state.filters.tag = null;
    // A link can carry a tag this company no longer uses; drop it from the
    // address bar too rather than leaving a param that filters nothing.
    syncFiltersToUrl();
  }
  renderFilterMenu('crm-tag-filter', {
    allLabel: 'All tags',
    searchPlaceholder: 'Find a tag…',
    value: state.filters.tag,
    options: tags.map((t) => ({ value: t, label: '#' + t })),
    onPick: (v) => {
      state.filters.tag = v;
      syncFiltersToUrl();
      renderTagChips();
      renderCurrentView();
    }
  });
  renderFilterBarState();
}

/** Clear button + "showing N of M" readout, both driven by the active filters. */
function renderFilterBarState() {
  const f = state.filters;
  const active = f.owner !== 'all' || !!f.stage || !!f.tag || !!f.search;
  const clear = $('crm-clear-filters');
  if (clear) {
    clear.hidden = !active;
    clear.onclick = () => {
      state.filters.owner = 'all';
      state.filters.stage = null;
      state.filters.tag = null;
      state.filters.search = '';
      const search = $('crm-search');
      if (search) search.value = '';
      syncFiltersToUrl();
      renderOwnerChips();
      renderStageChips();
      renderTagChips();
      renderCurrentView();
    };
  }
  const count = $('crm-filter-count');
  if (count) {
    const total = state.contacts.length;
    const shown = filteredContacts().length;
    count.textContent = !total ? '' : (active ? `${shown} of ${total}` : `${total} contacts`);
  }
}

function renderOwnerChips() {
  const wrap = $('crm-owner-chips');
  if (!wrap) return;
  wrap.querySelectorAll('[data-owner-filter]').forEach((b) => {
    b.classList.toggle('active', state.filters.owner === b.getAttribute('data-owner-filter'));
    b.onclick = () => {
      state.filters.owner = b.getAttribute('data-owner-filter');
      syncFiltersToUrl();
      renderOwnerChips();
      renderCurrentView();
    };
  });
  renderFilterBarState();
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

  readFiltersFromUrl();
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
    syncFiltersToUrl();
    renderCurrentView();
  });

  // Reflect filters that arrived in the URL back into the controls.
  $('crm-search').value = state.filters.search;

  // Wire the narrow-screen overflow menu. Export/Import sit inline on a wide
  // toolbar and collapse behind this button on a phone, where four stacked
  // full-width bars pushed the board off the first screen.
  const moreBtn = $('crm-toolbar-more');
  const moreMenu = $('crm-toolbar-actions');
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !moreMenu.classList.contains('open');
      moreMenu.classList.toggle('open', open);
      moreBtn.setAttribute('aria-expanded', String(open));
    });
    moreMenu.addEventListener('click', () => {
      moreMenu.classList.remove('open');
      moreBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', () => {
      moreMenu.classList.remove('open');
      moreBtn.setAttribute('aria-expanded', 'false');
    });
  }

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
  // The softphone client is only built on the first real call.
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
