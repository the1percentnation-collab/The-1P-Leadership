// Giveaways — Instagram comment-and-tag giveaways.
//
// One entry for commenting on the post, a bonus entry for each friend tagged,
// then a weighted random draw. The rules and the draw run server-side in the
// giveawayAdmin callable (functions/index.js), so the numbers on this page
// are the ones the winner was drawn from, and the draw itself is recorded
// there rather than trusted to the browser.
//
// Views, all driven by ?id= so a giveaway can be bookmarked:
//   no connection  → paste an Instagram token
//   list           → every giveaway for this company
//   edit           → pick the post, set the rules
//   detail (?id=)  → sync comments, leaderboard, draw, export

import { firebaseReady, functions } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import { escapeHtml, fmtDateTime } from './crm.js';
import { toCsv, downloadCsv } from './csv.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const state = {
  companyId: null,
  content: null,
  conn: null,        // { connected, username, expiresAt }
  giveaways: [],
  current: null,     // { giveaway, entrants }
  posts: null,       // recent Instagram posts, loaded for the edit view
  editing: null,     // giveaway being edited, or {} for a new one
  filter: '',
  busy: null,
  message: null      // { kind: 'ok' | 'error', text }
};

const esc = escapeHtml;

async function api(action, payload = {}) {
  const call = httpsCallable(functions, 'giveawayAdmin');
  const res = await call({ companyId: state.companyId, action, ...payload });
  return res.data;
}

function errText(e) {
  return (e && (e.message || e.details)) || String(e);
}

function setUrl(id) {
  const u = new URL(location.href);
  if (id) u.searchParams.set('id', id); else u.searchParams.delete('id');
  history.replaceState(null, '', u);
}

function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function plural(n, word) {
  if (n === 1) return `${n} ${word}`;
  return `${n} ${word.endsWith('y') ? word.slice(0, -1) + 'ies' : word + 's'}`;
}

function messageHtml() {
  if (!state.message) return '';
  const cls = state.message.kind === 'error' ? 'auth-error' : 'gw-ok';
  return `<div class="${cls} gw-msg">${esc(state.message.text)}</div>`;
}

function flash(kind, text) {
  state.message = { kind, text };
}

// ── Connect ─────────────────────────────────────────────────────

function connectView() {
  return `
    ${messageHtml()}
    <div class="card gw-connect">
      <h2>Connect Instagram</h2>
      <p class="gw-lead">Giveaways read the comments on your own Instagram posts. That needs a
        Business or Creator account and an access token from a Meta developer app. Because the
        app only reads your own account, it does not need Meta's app review.</p>
      <ol class="gw-steps">
        <li>On Instagram, switch the account to <strong>Professional</strong> (Business or Creator) if it is not already.</li>
        <li>At <strong>developers.facebook.com</strong>, create an app and add the <strong>Instagram</strong> product
          (“API setup with Instagram login”).</li>
        <li>Under <strong>Generate access tokens</strong>, add your Instagram account and click <strong>Generate token</strong>.
          Grant the comments permission when asked.</li>
        <li>Paste the token below. It is stored server-side only and refreshed automatically so it does not expire.</li>
      </ol>
      <form id="gw-connect-form" class="crm-form">
        <div class="crm-form-row">
          <label>Instagram access token</label>
          <textarea class="c-input gw-token" id="gw-token" rows="3" autocomplete="off" spellcheck="false"
            placeholder="IGAA…" required></textarea>
        </div>
        <div><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>
          ${state.busy === 'connect' ? 'Checking…' : 'Connect'}</button></div>
      </form>
    </div>`;
}

// ── List ────────────────────────────────────────────────────────

function listView() {
  const rows = state.giveaways.map((g) => {
    const t = g.totals || {};
    const winner = (g.winners || []).find((w) => !w.alternate) || (g.winners || [])[0];
    return `<tr class="gw-row" data-open="${esc(g.id)}">
      <td>
        <div class="gw-row-main">
          ${g.thumbnailUrl ? `<img class="gw-thumb-sm" src="${esc(g.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="gw-thumb-sm gw-thumb-empty"></span>'}
          <div>
            <div class="camp-name-link">${esc(g.name)}</div>
            <div class="gw-sub">${esc((g.caption || '').slice(0, 70))}</div>
          </div>
        </div>
      </td>
      <td class="num">${t.eligibleEntrants ?? '—'}</td>
      <td class="num">${t.entries ?? '—'}</td>
      <td>${winner ? `<span class="gw-winner-chip">@${esc(winner.handle)}</span>` : '<span class="gw-sub">Not drawn</span>'}</td>
      <td class="gw-sub">${g.lastSyncedAt ? fmtDateTime(g.lastSyncedAt) : 'Never synced'}</td>
    </tr>`;
  }).join('');

  return `
    ${messageHtml()}
    <div class="camp-toolbar">
      <span class="gw-sub">Connected as <strong>@${esc(state.conn.username || 'instagram')}</strong></span>
      <button class="btn btn-ghost btn-sm" id="gw-disconnect" type="button">Disconnect</button>
      <span class="camp-toolbar-spacer"></span>
      <button class="btn btn-primary" id="gw-new" type="button">New giveaway</button>
    </div>
    <div class="card">
      ${state.giveaways.length ? `
        <div class="camp-table-wrap"><table class="data-table">
          <thead><tr><th>Giveaway</th><th>Entrants</th><th>Entries</th><th>Winner</th><th>Last synced</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
      : `<div class="camp-empty">No giveaways yet. Post the giveaway on Instagram, then click <strong>New giveaway</strong> and pick that post.</div>`}
    </div>`;
}

// ── Edit ────────────────────────────────────────────────────────

function postPicker(selectedId) {
  if (state.posts === null) return '<div class="gw-sub">Loading your recent posts…</div>';
  if (!state.posts.length) return '<div class="gw-sub">No posts found on this account.</div>';
  return `<div class="gw-posts">${state.posts.map((p) => `
    <button type="button" class="gw-post ${p.id === selectedId ? 'selected' : ''}" data-post="${esc(p.id)}">
      ${p.thumbnailUrl ? `<img src="${esc(p.thumbnailUrl)}" alt="" loading="lazy">` : '<span class="gw-thumb-empty"></span>'}
      <span class="gw-post-cap">${esc((p.caption || 'No caption').slice(0, 60))}</span>
      <span class="gw-post-meta">${p.commentsCount ?? 0} comments · ${p.timestamp ? new Date(p.timestamp).toLocaleDateString() : ''}</span>
    </button>`).join('')}</div>`;
}

function editView() {
  const g = state.editing || {};
  const r = g.rules || {};
  const selected = g.mediaId || '';
  const locked = (g.winners || []).length > 0;
  return `
    ${messageHtml()}
    <div class="card">
      <h2>${g.id ? 'Edit giveaway' : 'New giveaway'}</h2>
      <form id="gw-edit-form" class="crm-form">
        <div class="crm-form-row">
          <label>Name (internal)</label>
          <input class="c-input" id="gw-name" required maxlength="120" value="${esc(g.name || '')}" placeholder="e.g. October book giveaway">
        </div>
        <div class="crm-form-row">
          <label>Instagram post ${locked ? '<span class="gw-sub">(locked: winners already drawn)</span>' : ''}</label>
          ${locked ? `<div class="gw-sub">${esc(g.caption || g.mediaId)}</div>` : postPicker(selected)}
        </div>

        <h3 class="gw-h3">Entry rules</h3>
        <div class="gw-grid">
          <div class="crm-form-row">
            <label>Entries for commenting</label>
            <input class="c-input" type="number" min="0" max="100" id="gw-base" value="${r.baseEntries ?? 1}">
          </div>
          <div class="crm-form-row">
            <label>Bonus entries per friend tagged</label>
            <input class="c-input" type="number" min="0" max="100" id="gw-pertag" value="${r.entriesPerTag ?? 1}">
          </div>
          <div class="crm-form-row">
            <label>Max friends that count (0 = no limit)</label>
            <input class="c-input" type="number" min="0" max="100" id="gw-max" value="${r.maxTaggedFriends ?? 5}">
          </div>
        </div>
        <div class="gw-grid">
          <div class="crm-form-row">
            <label>Entries open (optional)</label>
            <input class="c-input" type="datetime-local" id="gw-start" value="${toLocalInput(r.startsAt)}">
          </div>
          <div class="crm-form-row">
            <label>Entries close (optional)</label>
            <input class="c-input" type="datetime-local" id="gw-end" value="${toLocalInput(r.endsAt)}">
          </div>
        </div>
        <label class="camp-recipient-checkbox"><input type="checkbox" id="gw-require" ${r.requireTag ? 'checked' : ''}>
          Must tag at least one friend to enter</label>
        <label class="camp-recipient-checkbox"><input type="checkbox" id="gw-replies" ${r.countReplies === false ? '' : 'checked'}>
          Count replies to other comments</label>
        <div class="crm-form-row" style="margin-top:12px">
          <label>Exclude these handles (staff, family, your other accounts)</label>
          <textarea class="c-input" id="gw-exclude" rows="2" placeholder="@teammate, @otherbrand">${esc((r.excludeHandles || []).map((h) => '@' + h).join(', '))}</textarea>
        </div>
        <p class="gw-sub">Your own account can never enter, and tagging it, yourself or an excluded handle earns nothing.
          Tagging the same friend twice counts once.</p>
        <div class="crm-modal-actions">
          <button class="btn btn-ghost" type="button" id="gw-cancel">Cancel</button>
          <button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy === 'save' ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>`;
}

// ── Detail ──────────────────────────────────────────────────────

function rulesSummary(r) {
  const bits = [`${plural(r.baseEntries, 'entry')} for commenting`];
  if (r.entriesPerTag > 0) {
    bits.push(`+${r.entriesPerTag} per friend tagged${r.maxTaggedFriends ? ` (up to ${r.maxTaggedFriends})` : ''}`);
  }
  if (r.requireTag) bits.push('a tag is required');
  if (!r.countReplies) bits.push('replies ignored');
  if (r.startsAt) bits.push(`opens ${fmtDateTime(r.startsAt)}`);
  if (r.endsAt) bits.push(`closes ${fmtDateTime(r.endsAt)}`);
  return bits.join(' · ');
}

function filteredEntrants() {
  const q = state.filter.trim().toLowerCase().replace(/^@/, '');
  const all = state.current.entrants;
  return q ? all.filter((e) => e.handle.includes(q) || (e.countedTags || []).some((t) => t.includes(q))) : all;
}

function detailView() {
  const { giveaway: g, entrants } = state.current;
  const t = g.totals || {};
  const s = g.skipped || {};
  const totalEntries = t.entries || 0;
  const rankOf = new Map(entrants.map((e, i) => [e.handle, i + 1]));
  const rows = filteredEntrants().slice(0, 500).map((e) => `
    <tr class="${e.entries === 0 ? 'gw-dim' : ''}">
      <td class="num">${rankOf.get(e.handle)}</td>
      <td><a class="camp-name-link" href="https://www.instagram.com/${encodeURIComponent(e.handle)}/" target="_blank" rel="noopener">@${esc(e.handle)}</a>
        ${e.ineligibleReason === 'no_tag' ? '<span class="gw-sub"> · no tag</span>' : ''}</td>
      <td class="num gw-hide-sm">${e.commentCount}</td>
      <td class="gw-hide-sm" title="${esc((e.countedTags || []).map((x) => '@' + x).join(' '))}">
        <span class="num">${(e.countedTags || []).length}</span>
        ${(e.tags || []).length > (e.countedTags || []).length ? `<span class="gw-sub"> of ${e.tags.length}</span>` : ''}
      </td>
      <td class="num"><strong>${e.entries}</strong></td>
      <td class="num">${totalEntries ? ((e.entries / totalEntries) * 100).toFixed(1) + '%' : '—'}</td>
    </tr>`).join('');

  const winners = g.winners || [];
  const skippedBits = [
    s.host ? `${s.host} from your account` : '',
    s.excluded ? `${s.excluded} from excluded handles` : '',
    s.outsideWindow ? `${s.outsideWindow} outside the entry window` : '',
    s.replies ? `${s.replies} replies` : ''
  ].filter(Boolean);

  return `
    ${messageHtml()}
    <div class="camp-detail-header">
      <div>
        <a class="gw-back" href="/giveaways.html" id="gw-back">← All giveaways</a>
        <div class="camp-detail-title">${esc(g.name)}</div>
        <div class="camp-detail-sub">${esc(rulesSummary(g.rules))}</div>
      </div>
      <div class="gw-actions">
        ${g.permalink ? `<a class="btn btn-ghost" href="${esc(g.permalink)}" target="_blank" rel="noopener">View post</a>` : ''}
        <button class="btn btn-ghost" id="gw-edit" type="button">Edit rules</button>
        <button class="btn btn-primary" id="gw-sync" type="button" ${state.busy ? 'disabled' : ''}>
          ${state.busy === 'sync' ? 'Reading comments…' : 'Sync comments'}</button>
      </div>
    </div>

    <div class="gw-stats">
      <div class="gw-stat"><div class="gw-stat-n">${t.countedComments ?? '—'}</div><div class="gw-stat-l">Comments counted</div></div>
      <div class="gw-stat"><div class="gw-stat-n">${t.eligibleEntrants ?? '—'}</div><div class="gw-stat-l">Entrants</div></div>
      <div class="gw-stat"><div class="gw-stat-n">${t.friendsTagged ?? '—'}</div><div class="gw-stat-l">Friends tagged</div></div>
      <div class="gw-stat"><div class="gw-stat-n">${t.entries ?? '—'}</div><div class="gw-stat-l">Total entries</div></div>
    </div>
    <div class="gw-sub gw-syncline">
      ${g.lastSyncedAt ? `Last synced ${esc(fmtDateTime(g.lastSyncedAt))}.` : 'Not synced yet. Click Sync comments to read the post.'}
      ${skippedBits.length ? ` Not counted: ${esc(skippedBits.join(', '))}.` : ''}
    </div>
    ${g.truncated ? '<div class="auth-error gw-msg">This post has more comments than one sync can read (20,000). The tally covers the first 20,000.</div>' : ''}

    <div class="card gw-draw">
      <div class="gw-draw-head">
        <h2>Winners</h2>
        <button class="btn btn-primary" id="gw-draw" type="button" ${state.busy || !g.lastSyncedAt || !t.entries ? 'disabled' : ''}>
          ${state.busy === 'draw' ? 'Drawing…' : winners.length ? 'Draw an alternate' : 'Draw winner'}</button>
      </div>
      ${winners.length ? `<ol class="gw-winners">${winners.map((w) => `
        <li>
          <a class="gw-winner-chip" href="https://www.instagram.com/${encodeURIComponent(w.handle)}/" target="_blank" rel="noopener">@${esc(w.handle)}</a>
          <span class="gw-sub">${w.alternate ? 'Alternate' : 'Winner'} · ${plural(w.entries, 'entry')} of ${w.poolEntries}
            (${((w.entries / w.poolEntries) * 100).toFixed(1)}% odds) · drawn ${esc(fmtDateTime(w.drawnAt))}</span>
        </li>`).join('')}</ol>`
      : `<div class="gw-sub">Sync once more after entries close, then draw. The draw is weighted by entries,
          run on the server, and recorded here with the odds it was drawn at.</div>`}
    </div>

    <div class="card">
      <div class="camp-toolbar">
        <input class="c-input gw-search" id="gw-search" placeholder="Search a handle" value="${esc(state.filter)}">
        <span class="camp-toolbar-spacer"></span>
        <button class="btn btn-ghost" id="gw-csv" type="button" ${entrants.length ? '' : 'disabled'}>Export CSV</button>
      </div>
      ${entrants.length ? `
        <div class="camp-table-wrap"><table class="data-table">
          <thead><tr><th>#</th><th>Entrant</th><th class="gw-hide-sm">Comments</th><th class="gw-hide-sm">Friends tagged</th><th>Entries</th><th>Odds</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${filteredEntrants().length > 500 ? '<div class="gw-sub">Showing the top 500. Export the CSV for everyone.</div>' : ''}`
      : '<div class="camp-empty">No entrants yet.</div>'}
    </div>`;
}

// ── Render + events ─────────────────────────────────────────────

function render() {
  const c = state.content;
  if (!state.conn || !state.conn.connected) c.innerHTML = connectView();
  else if (state.editing) c.innerHTML = editView();
  else if (state.current) c.innerHTML = detailView();
  else c.innerHTML = listView();
  bind();
}

function on(id, ev, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
}

async function run(key, fn) {
  state.busy = key;
  state.message = null;
  render();
  try { await fn(); }
  catch (e) { flash('error', errText(e)); }
  finally { state.busy = null; render(); }
}

function bind() {
  on('gw-connect-form', 'submit', (e) => {
    e.preventDefault();
    const token = document.getElementById('gw-token').value.trim();
    run('connect', async () => {
      state.conn = await api('connect', { token });
      await loadList();
      flash('ok', `Connected to @${state.conn.username}.`);
    });
  });

  on('gw-disconnect', 'click', () => {
    if (!confirm('Disconnect Instagram? Existing giveaways stay, but you cannot sync them until you reconnect.')) return;
    run('disconnect', async () => { state.conn = await api('disconnect'); });
  });

  on('gw-new', 'click', () => openEditor({}));

  document.querySelectorAll('[data-open]').forEach((row) => row.addEventListener('click', () => {
    openGiveaway(row.getAttribute('data-open'));
  }));

  document.querySelectorAll('[data-post]').forEach((b) => b.addEventListener('click', () => {
    const p = state.posts.find((x) => x.id === b.getAttribute('data-post'));
    if (!p) return;
    // Keep what was typed: re-rendering rebuilds the form from state.
    captureForm();
    Object.assign(state.editing, { mediaId: p.id, permalink: p.permalink, caption: p.caption, thumbnailUrl: p.thumbnailUrl });
    render();
  }));

  on('gw-cancel', 'click', () => { state.editing = null; render(); });

  on('gw-edit-form', 'submit', (e) => {
    e.preventDefault();
    captureForm();
    const g = state.editing;
    if (!g.mediaId) { flash('error', 'Pick the Instagram post this giveaway runs on.'); render(); return; }
    run('save', async () => {
      const { id } = await api('save', {
        giveawayId: g.id || null,
        name: g.name, mediaId: g.mediaId, permalink: g.permalink, caption: g.caption,
        thumbnailUrl: g.thumbnailUrl, rules: g.rules
      });
      state.editing = null;
      await openGiveaway(id, { quiet: true });
      if (!state.current.giveaway.lastSyncedAt) await doSync();
      else flash('ok', 'Saved. Sync again to apply the new rules.');
    });
  });

  on('gw-back', 'click', (e) => {
    e.preventDefault();
    state.current = null;
    state.filter = '';
    setUrl(null);
    run('list', loadList);
  });

  on('gw-edit', 'click', () => openEditor(state.current.giveaway));

  on('gw-sync', 'click', () => run('sync', doSync));

  on('gw-draw', 'click', () => {
    const again = (state.current.giveaway.winners || []).length > 0;
    const msg = again
      ? 'Draw an alternate? Everyone already drawn is excluded.'
      : 'Draw the winner now? Sync first if comments came in since the last sync. The result is recorded and cannot be undone.';
    if (!confirm(msg)) return;
    run('draw', async () => {
      const { winners } = await api('draw', { giveawayId: state.current.giveaway.id, count: 1 });
      await openGiveaway(state.current.giveaway.id, { quiet: true });
      flash('ok', `Drawn: @${winners[0].handle}.`);
    });
  });

  on('gw-search', 'input', (e) => {
    state.filter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.getElementById('gw-search');
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  });

  on('gw-csv', 'click', exportCsv);
}

function captureForm() {
  const val = (id) => (document.getElementById(id) || {}).value;
  const checked = (id) => !!(document.getElementById(id) || {}).checked;
  if (!document.getElementById('gw-name')) return;
  state.editing.name = val('gw-name');
  state.editing.rules = {
    baseEntries: Number(val('gw-base')),
    entriesPerTag: Number(val('gw-pertag')),
    maxTaggedFriends: Number(val('gw-max')),
    requireTag: checked('gw-require'),
    countReplies: checked('gw-replies'),
    startsAt: fromLocalInput(val('gw-start')),
    endsAt: fromLocalInput(val('gw-end')),
    excludeHandles: String(val('gw-exclude') || '').split(/[\s,]+/).map((h) => h.replace(/^@/, '')).filter(Boolean)
  };
}

async function openEditor(g) {
  state.editing = { ...g, rules: { ...(g.rules || {}) } };
  state.message = null;
  render();
  if (state.posts === null) {
    try { state.posts = (await api('posts')).posts || []; }
    catch (e) { state.posts = []; flash('error', errText(e)); }
    if (state.editing) render();
  }
}

async function openGiveaway(id, { quiet = false } = {}) {
  if (!quiet) { state.message = null; state.content.innerHTML = '<div class="crm-section-sub">Loading…</div>'; }
  try {
    state.current = await api('get', { giveawayId: id });
    setUrl(id);
  } catch (e) {
    state.current = null;
    setUrl(null);
    flash('error', errText(e));
    await loadList();
  }
  if (!quiet) render();
}

async function doSync() {
  const id = state.current.giveaway.id;
  const r = await api('sync', { giveawayId: id });
  await openGiveaway(id, { quiet: true });
  flash('ok', `Read ${plural(r.totals.comments, 'comment')}: ${plural(r.totals.eligibleEntrants, 'entrant')}, ${plural(r.totals.entries, 'entry')}.`);
}

async function loadList() {
  state.giveaways = (await api('list')).giveaways || [];
}

function exportCsv() {
  const { giveaway: g, entrants } = state.current;
  const total = (g.totals && g.totals.entries) || 0;
  const csv = toCsv(
    ['Rank', 'Handle', 'Comments', 'Friends counted', 'Friends tagged', 'Entries', 'Odds %', 'Tagged', 'Ignored tags', 'First comment'],
    entrants.map((e, i) => [
      i + 1, '@' + e.handle, e.commentCount, (e.countedTags || []).length, (e.tags || []).length, e.entries,
      total ? ((e.entries / total) * 100).toFixed(2) : '',
      (e.countedTags || []).map((x) => '@' + x).join(' '),
      (e.ignoredTags || []).map((x) => '@' + x).join(' '),
      e.firstCommentAt || ''
    ]));
  const slug = String(g.name || 'giveaway').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  downloadCsv(`${slug || 'giveaway'}-entrants.csv`, csv);
}

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/giveaways.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }

  const content = renderCrmShell({ active: 'giveaways', title: 'Giveaways', user: u, role: info.role });
  state.content = content;

  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
  if (!companyId) {
    try {
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
  content.innerHTML = `<div class="crm-section-sub">Loading…</div>`;

  try {
    state.conn = await api('status');
    if (state.conn.connected) {
      const id = new URLSearchParams(location.search).get('id');
      if (id) await openGiveaway(id, { quiet: true });
      if (!state.current) await loadList();
    }
  } catch (e) {
    content.innerHTML = `<div class="card"><div class="auth-error">Could not load giveaways: ${esc(errText(e))}</div></div>`;
    return;
  }
  render();
}

main();
