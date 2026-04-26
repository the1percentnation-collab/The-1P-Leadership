// Community feed page — composer + paginated feed + comments + likes.

import { auth, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar, teardownTopbar } from './topbar.js';
import {
  listPosts, createPost, deletePost, toggleLike, hasLiked,
  listComments, addComment, deleteComment,
  getUserProfile, touchCommunityVisit,
  listChannels, getPinnedPostForChannel, setPostPinned, CHANNEL_KEYS,
  getLeaderboard, getMyStats, levelFromPoints, levelProgress,
  subscribeToFeed, searchMembers, renderTextWithMentions,
  avatarHtml, fmtRelative, escapeHtml, linkify
} from './community.js';

const $ = (id) => document.getElementById(id);

function urlChannel() {
  const v = new URLSearchParams(location.search).get('channel');
  return v && CHANNEL_KEYS.includes(v) ? v : null;
}

const state = {
  me: null,           // { uid, displayName, avatarUrl, role, companyId }
  role: null,
  companyId: null,
  posts: [],
  lastDoc: null,
  done: false,
  loading: false,
  commentsOpen: new Set(),
  likedIds: new Set(),
  // Phase 1 — channels
  channels: [],
  activeChannel: urlChannel() || 'general',
  pinnedPost: null,
  // Phase 2 — leaderboard, points, levels
  leaderboard: [],
  authorLevels: new Map(),
  myStats: null,
  // Phase 3 — realtime feed + mentions (notifications now live in topbar.js)
  feedUnsub: null,         // teardown for the active onSnapshot listeners
  pendingPosts: [],        // new posts that arrived while user was scrolled away
  livePostIds: new Set(),  // ids currently in the live window
  mentionUids: new Set(),  // ids referenced by composer @[uid:Name] tokens
  mentionLookup: new Map() // uid → { displayName, avatarUrl }
};

// Notification deep-link handler — when a bell-popover row navigates with
// `#post-X`, smooth-scroll to that card if it's in the live window and
// briefly flash it. The bell + popover themselves live in topbar.js.
function handleHashScroll() {
  const hash = location.hash || '';
  const m = hash.match(/^#post-(.+)$/);
  if (!m) return;
  const postId = decodeURIComponent(m[1]);
  // Try a few times — the live snapshot can lag a tick on first paint.
  let tries = 0;
  function tick() {
    const card = document.getElementById(`post-${postId}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('c-post-flash');
      setTimeout(() => card.classList.remove('c-post-flash'), 1500);
      return;
    }
    if (++tries < 12) setTimeout(tick, 200);
  }
  tick();
}

function renderComposer() {
  const ch = activeChannelMeta();
  const composer = $('composer');
  const channelOpts = state.channels.map((c) => `
    <option value="${escapeHtml(c.key)}" ${c.key === state.activeChannel ? 'selected' : ''}>
      ${escapeHtml((c.emoji ? c.emoji + ' ' : '') + c.name)}
    </option>
  `).join('');
  composer.innerHTML = `
    <div class="c-composer-row">
      ${avatarHtml(state.me, 44)}
      <div style="flex:1; min-width:0;">
        <textarea id="composer-text" class="c-textarea" rows="3" placeholder="Share something with #${escapeHtml(ch.name.toLowerCase())}…"></textarea>
        <div id="composer-preview"></div>
        <div class="c-composer-actions">
          <label class="c-composer-channel" title="Post into channel">
            <span class="c-composer-channel-label">In</span>
            <select id="composer-channel" class="c-composer-channel-select">${channelOpts}</select>
          </label>
          <label class="btn btn-ghost c-file-btn">
            <span>Attach image</span>
            <input id="composer-file" type="file" accept="image/*" hidden>
          </label>
          <span id="composer-filename" class="c-filename"></span>
          <div style="flex:1"></div>
          <button class="btn btn-primary" id="btn-post">Post</button>
        </div>
        <div id="composer-err" class="c-err" style="display:none;"></div>
      </div>
    </div>
  `;
  $('composer-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    $('composer-filename').textContent = f ? f.name : '';
    const prev = $('composer-preview');
    if (f && /^image\//.test(f.type)) {
      const url = URL.createObjectURL(f);
      prev.innerHTML = `<img src="${url}" class="c-preview-img" alt="">`;
    } else {
      prev.innerHTML = '';
    }
  });
  $('btn-post').addEventListener('click', submitPost);
  attachMentionAutocomplete($('composer-text'));
}

const MENTION_TOKEN_RE_INLINE = /@\[([^\]:]+):([^\]]+)\]/g;

function collectMentionedUidsFromText(text) {
  if (!text) return [];
  const ids = new Set();
  String(text).replace(MENTION_TOKEN_RE_INLINE, (_m, uid) => { ids.add(uid); return _m; });
  return Array.from(ids);
}

// @-mention autocomplete on a textarea. Watches for `@<query>` immediately
// before the caret, debounces a server search, and lets the user pick a
// candidate. Selected mentions are inserted as `@[uid:Name]` tokens that
// renderTextWithMentions() turns into safe anchors at display time.
function attachMentionAutocomplete(textarea) {
  if (!textarea) return;
  let drop = null;
  let activeIdx = 0;
  let candidates = [];
  let queryStart = -1;
  let debounceT = null;

  function close() {
    if (drop) { drop.remove(); drop = null; }
    candidates = [];
    activeIdx = 0;
    queryStart = -1;
  }

  function ensureDropdown() {
    if (drop) return drop;
    drop = document.createElement('div');
    drop.className = 'c-mention-dropdown';
    drop.setAttribute('role', 'listbox');
    document.body.appendChild(drop);
    // Position once now; reposition on input/scroll.
    positionDropdown();
    return drop;
  }

  function positionDropdown() {
    if (!drop) return;
    const rect = textarea.getBoundingClientRect();
    drop.style.position = 'fixed';
    drop.style.top = `${rect.bottom + 4}px`;
    drop.style.left = `${rect.left}px`;
    drop.style.width = `${Math.min(320, rect.width)}px`;
  }

  function render() {
    if (!candidates.length) { close(); return; }
    ensureDropdown();
    drop.innerHTML = candidates.map((c, i) => `
      <div class="c-mention-option ${i === activeIdx ? 'is-active' : ''}" data-idx="${i}">
        ${avatarHtml({ avatarUrl: c.avatarUrl, displayName: c.displayName }, 22)}
        <span class="c-mention-option-name">${escapeHtml(c.displayName)}</span>
      </div>
    `).join('');
    drop.querySelectorAll('.c-mention-option').forEach((el) => {
      el.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        const idx = Number(el.dataset.idx);
        commit(idx);
      });
    });
  }

  function commit(idx) {
    const c = candidates[idx];
    if (!c) return close();
    const value = textarea.value;
    const before = value.slice(0, queryStart);
    const cursor = textarea.selectionStart || value.length;
    const after = value.slice(cursor);
    const token = `@[${c.uid}:${c.displayName}] `;
    const next = before + token + after;
    textarea.value = next;
    const newCursor = (before + token).length;
    textarea.setSelectionRange(newCursor, newCursor);
    state.mentionUids.add(c.uid);
    state.mentionLookup.set(c.uid, { displayName: c.displayName, avatarUrl: c.avatarUrl });
    close();
    textarea.focus();
  }

  textarea.addEventListener('input', () => {
    const val = textarea.value;
    const cursor = textarea.selectionStart || 0;
    // Find the most recent `@` before cursor on the same word.
    let i = cursor - 1;
    let foundAt = -1;
    while (i >= 0) {
      const ch = val[i];
      if (ch === '@') { foundAt = i; break; }
      if (/\s/.test(ch) || ch === '\n') break;
      i--;
    }
    if (foundAt === -1) { close(); return; }
    const q = val.slice(foundAt + 1, cursor);
    if (q.length === 0 || q.length > 30 || /[\[\]\s]/.test(q)) { close(); return; }
    queryStart = foundAt;
    if (debounceT) clearTimeout(debounceT);
    debounceT = setTimeout(async () => {
      const results = await searchMembers(q);
      candidates = results;
      activeIdx = 0;
      render();
    }, 200);
  });

  textarea.addEventListener('keydown', (e) => {
    if (!drop || !candidates.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % candidates.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + candidates.length) % candidates.length;
      render();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      commit(activeIdx);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  textarea.addEventListener('blur', () => setTimeout(close, 120));
  window.addEventListener('scroll', positionDropdown, { passive: true });
  window.addEventListener('resize', positionDropdown);
}

function activeChannelMeta() {
  return state.channels.find((c) => c.key === state.activeChannel)
    || { key: 'general', name: 'General', emoji: '💬', description: '' };
}

function renderSidebar() {
  const sidebar = $('sidebar');
  if (!sidebar) return;
  const items = state.channels.map((c) => `
    <a class="c-channel-link ${c.key === state.activeChannel ? 'is-active' : ''}"
       href="?channel=${encodeURIComponent(c.key)}"
       data-channel="${escapeHtml(c.key)}">
      <span class="c-channel-emoji">${escapeHtml(c.emoji || '#')}</span>
      <span class="c-channel-name">${escapeHtml(c.name)}</span>
    </a>
  `).join('');
  sidebar.innerHTML = `
    <div class="c-sidebar-eyebrow">Channels</div>
    <nav class="c-channel-list">${items}</nav>
  `;
  sidebar.querySelectorAll('.c-channel-link').forEach((a) => {
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      const next = a.dataset.channel;
      if (!next || next === state.activeChannel) return;
      switchChannel(next);
    });
  });
  renderChannelChips();
}

// Mobile-only horizontal channel chip strip — visible at the top of the
// feed when the sidebar is collapsed below the fold (≤820px). Same
// click handler as the sidebar so behavior stays identical.
function renderChannelChips() {
  const root = $('channel-chips');
  if (!root) return;
  root.innerHTML = state.channels.map((c) => `
    <button class="c-channel-chip ${c.key === state.activeChannel ? 'is-active' : ''}"
            data-channel="${escapeHtml(c.key)}">
      <span class="c-channel-chip-emoji">${escapeHtml(c.emoji || '#')}</span>
      <span class="c-channel-chip-name">${escapeHtml(c.name)}</span>
    </button>
  `).join('');
  root.querySelectorAll('.c-channel-chip').forEach((b) => {
    b.addEventListener('click', () => {
      const next = b.dataset.channel;
      if (!next || next === state.activeChannel) return;
      switchChannel(next);
    });
  });
  // Scroll the active chip into view so it's visible on first paint.
  const active = root.querySelector('.c-channel-chip.is-active');
  if (active && typeof active.scrollIntoView === 'function') {
    try { active.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {}
  }
}

function firstName(s) {
  if (!s) return 'there';
  const trimmed = String(s).split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = trimmed.split(/\s+/);
  return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1) : 'there';
}

// Dashboard hero — greeting strip + 4 KPI tiles. Re-renders whenever
// `state.myStats` changes (after refreshLeaderboard), so the level /
// week-points tiles update without a manual reload.
function renderDashboardHero() {
  const root = $('dashboard-hero');
  if (!root || !state.me) return;
  const name = firstName(state.me.displayName || state.me.email || '');
  const stats = state.myStats || { points: 0, postCount: 0, likesReceived: 0, weekPoints: 0 };
  const prog = levelProgress(stats.points || 0);
  const lvl = prog.level;
  const subline = prog.ceiling != null
    ? `Level ${lvl} · ${stats.points || 0} pts · ${prog.toNext} to Lv ${lvl + 1}`
    : `Level ${lvl} · ${stats.points || 0} pts · max level`;

  root.innerHTML = `
    <div class="c-hero-row">
      <div class="c-hero-greet">
        <div class="c-hero-eyebrow">Community</div>
        <h1 class="c-hero-title">Welcome back, <span class="c-hero-name">${escapeHtml(name)}</span></h1>
        <div class="c-hero-sub">${escapeHtml(subline)}</div>
        <div class="c-hero-progress" aria-hidden="true">
          <div class="c-progress-bar"><div class="c-progress-fill" style="width:${prog.pct}%"></div></div>
        </div>
      </div>
      <div class="c-hero-stats">
        <div class="c-stat-tile">
          <div class="c-stat-label">Level</div>
          <div class="c-stat-value">
            <span class="c-level-badge c-level-${Math.min(10, lvl)}">Lv ${lvl}</span>
          </div>
        </div>
        <div class="c-stat-tile">
          <div class="c-stat-label">This week</div>
          <div class="c-stat-value">${stats.weekPoints || 0}<span class="c-stat-unit">pts</span></div>
        </div>
        <div class="c-stat-tile">
          <div class="c-stat-label">Posts</div>
          <div class="c-stat-value">${stats.postCount || 0}</div>
        </div>
        <div class="c-stat-tile">
          <div class="c-stat-label">Likes</div>
          <div class="c-stat-value">${stats.likesReceived || 0}</div>
        </div>
      </div>
    </div>
  `;
}

function skeletonCardsHtml(n = 3) {
  const card = `
    <article class="c-post c-skel">
      <header class="c-post-head">
        <div class="c-skel-avatar"></div>
        <div class="c-skel-stack">
          <div class="c-skel-line c-skel-line-w-40"></div>
          <div class="c-skel-line c-skel-line-w-25"></div>
        </div>
      </header>
      <div class="c-skel-line c-skel-line-w-90"></div>
      <div class="c-skel-line c-skel-line-w-80"></div>
      <div class="c-skel-line c-skel-line-w-60"></div>
    </article>`;
  return new Array(n).fill(card).join('');
}

function channelMetaTags(ch) {
  const tags = [];
  if (ch.key === 'announcements') {
    tags.push({ label: 'Official channel', tone: 'red' });
    tags.push({ label: 'Owners & admins post', tone: 'plain' });
  } else if (ch.key === 'wins') {
    tags.push({ label: 'Earns 2× points', tone: 'red' });
  } else if (ch.key === 'questions') {
    tags.push({ label: 'Ask freely', tone: 'plain' });
  } else {
    tags.push({ label: 'Open channel', tone: 'plain' });
  }
  return tags;
}

function renderChannelHeader() {
  const root = $('channel-header');
  if (!root) return;
  const ch = activeChannelMeta();
  const pinned = state.pinnedPost;
  const tags = channelMetaTags(ch);

  const pinnedHtml = pinned ? `
    <div class="c-pinned-banner">
      <span class="c-pinned-eyebrow">📌 Pinned</span>
      <a class="c-pinned-link" href="#post-${escapeHtml(pinned.id)}">
        <span class="c-pinned-author">${escapeHtml(pinned.authorName || 'Unknown')}</span>
        <span class="c-pinned-text">${escapeHtml((pinned.text || '').slice(0, 140))}${(pinned.text || '').length > 140 ? '…' : ''}</span>
      </a>
    </div>
  ` : '';

  const tagsHtml = tags.length ? `
    <div class="c-channel-meta">
      ${tags.map((t) => `<span class="c-channel-tag c-channel-tag-${escapeHtml(t.tone)}">${escapeHtml(t.label)}</span>`).join('')}
    </div>
  ` : '';

  root.innerHTML = `
    <div class="c-channel-title">
      <span class="c-channel-title-emoji">${escapeHtml(ch.emoji || '#')}</span>
      <span class="c-channel-title-name">${escapeHtml(ch.name)}</span>
    </div>
    ${ch.description ? `<div class="c-channel-desc">${escapeHtml(ch.description)}</div>` : ''}
    ${tagsHtml}
    ${pinnedHtml}
  `;
}

function renderLeaderboard() {
  const root = $('leaderboard');
  if (!root) return;
  const rows = state.leaderboard;
  const myStats = state.myStats;
  const myStatsHtml = myStats ? (() => {
    const prog = levelProgress(myStats.points || 0);
    const ceiling = prog.ceiling != null ? prog.ceiling : prog.points;
    return `
      <div class="c-leader-self">
        <div class="c-leader-self-eyebrow">Your level</div>
        <div class="c-leader-self-row">
          <span class="c-level-badge c-level-${Math.min(10, prog.level)}">Lv ${prog.level}</span>
          <span class="c-leader-self-pts">${prog.points} pts</span>
        </div>
        <div class="c-progress-bar"><div class="c-progress-fill" style="width:${prog.pct}%"></div></div>
        <div class="c-leader-self-next">
          ${prog.ceiling != null
            ? `${prog.toNext} pts to Lv ${prog.level + 1}`
            : `Max level reached`}
        </div>
      </div>
    `;
  })() : '';

  const rowsHtml = rows.length
    ? rows.slice(0, 10).map((r, i) => `
        <a class="c-leader-row" href="/profile.html?uid=${encodeURIComponent(r.uid)}">
          <span class="c-leader-rank">${i + 1}</span>
          ${avatarHtml({ avatarUrl: r.avatarUrl, displayName: r.displayName }, 28)}
          <span class="c-leader-name">${escapeHtml(r.displayName || 'Unknown')}</span>
          <span class="c-level-badge c-level-${Math.min(10, r.level)}">Lv ${r.level}</span>
          <span class="c-leader-points">${r.statsPoints}</span>
        </a>
      `).join('')
    : `<div class="c-leader-empty">
         <div class="c-leader-empty-art" aria-hidden="true">🏁</div>
         <div class="c-leader-empty-title">Nobody's on the board</div>
         <div class="c-leader-empty-body">Post, comment, or earn a like to put yourself on the leaderboard.</div>
       </div>`;

  root.innerHTML = `
    <div class="c-leader-eyebrow">Leaderboard</div>
    ${myStatsHtml}
    <div class="c-leader-list">${rowsHtml}</div>
  `;
}

async function refreshLeaderboard() {
  // Company-scoped if the caller has a companyId; otherwise global.
  const scope = state.companyId ? 'company' : 'global';
  const [board, mine] = await Promise.all([
    getLeaderboard({ scope, limit: 50 }).catch(() => ({ rows: [] })),
    getMyStats().catch(() => null)
  ]);
  state.leaderboard = board.rows || [];
  state.myStats = mine;
  // Hydrate the author-level cache so post cards can show level pills.
  state.authorLevels = new Map();
  state.leaderboard.forEach((r) => state.authorLevels.set(r.uid, r.level));
  renderLeaderboard();
  renderDashboardHero();
  renderGroupInfoCard();
}

// ── Tabs row above the channel header. Discussion is the active page;
// Members and Profile are real navigations. Leaderboard scrolls to the
// right-rail leaderboard (or the leaderboard rail's mobile fallback,
// which is currently hidden — clicking it on mobile still works because
// we re-render the rail inline as a fallback section).
const TABS = [
  { key: 'discussion', label: 'Discussion', href: null },
  { key: 'leaderboard', label: 'Leaderboard', href: null },
  { key: 'members', label: 'Members', href: '/members.html' },
  { key: 'about', label: 'About', href: null }
];

function renderTabs() {
  const root = $('community-tabs');
  if (!root) return;
  root.innerHTML = TABS.map((t) => `
    <button class="c-tab ${t.key === 'discussion' ? 'is-active' : ''}"
            data-tab="${escapeHtml(t.key)}">
      ${escapeHtml(t.label)}
    </button>
  `).join('');
  root.querySelectorAll('.c-tab').forEach((b) => {
    b.addEventListener('click', () => onTabClick(b.dataset.tab));
  });
}

function onTabClick(key) {
  const tab = TABS.find((t) => t.key === key);
  if (!tab) return;
  if (tab.href) { location.assign(tab.href); return; }
  if (tab.key === 'leaderboard') {
    const rail = $('rightrail');
    const board = $('leaderboard');
    const target = board || rail;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (tab.key === 'about') {
    const card = $('group-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  // Discussion — already current page; scroll to top.
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Group info card on the right rail. Pulls counts from local state so
// it works without a new server callable. Members count is the size of
// the leaderboard top-50 (proxy for "engaged members"); channels count
// is just state.channels.length; pinned counts the channels whose doc
// has a pinnedPostId (we read it lazily as the user switches channels,
// so this number reflects channels visited so far — fine for v1).
const GROUP_DESCRIPTION =
  'A like-minded community committed to growth, clarity, and intentional action — supporting each other in consistent daily progress.';

function renderGroupInfoCard() {
  const root = $('group-card');
  if (!root) return;

  const memberRows = state.leaderboard.slice(0, 8);
  const memberCount = state.leaderboard.length;
  const channelCount = state.channels.length;
  const canInvite = state.role === 'owner' || state.role === 'admin';

  const avatarsHtml = memberRows.map((m) => `
    <a class="c-group-card-avatar" href="/profile.html?uid=${encodeURIComponent(m.uid)}"
       title="${escapeHtml(m.displayName || '')}">
      ${avatarHtml({ avatarUrl: m.avatarUrl, displayName: m.displayName }, 30)}
    </a>
  `).join('');

  root.innerHTML = `
    <div class="c-group-card-banner" aria-hidden="true">
      <div class="c-group-card-monogram">1P</div>
    </div>
    <div class="c-group-card-body">
      <div class="c-group-card-title">The One Percent Academy</div>
      <div class="c-group-card-meta">
        <span class="c-group-card-lock">🔒</span>
        <span>Private community</span>
      </div>
      <p class="c-group-card-desc">${escapeHtml(GROUP_DESCRIPTION)}</p>
      <div class="c-group-card-stats">
        <div class="c-group-card-stat">
          <div class="c-group-card-stat-value">${memberCount}</div>
          <div class="c-group-card-stat-label">Members</div>
        </div>
        <div class="c-group-card-stat">
          <div class="c-group-card-stat-value">${channelCount}</div>
          <div class="c-group-card-stat-label">Channels</div>
        </div>
        <div class="c-group-card-stat">
          <div class="c-group-card-stat-value">10</div>
          <div class="c-group-card-stat-label">Levels</div>
        </div>
      </div>
      ${memberRows.length ? `<div class="c-group-card-avatars">${avatarsHtml}</div>` : ''}
      ${canInvite
        ? `<a class="btn btn-primary c-group-card-cta" href="/admin.html">Invite members</a>`
        : `<button class="btn btn-ghost c-group-card-cta" id="c-group-card-share">Share community</button>`}
    </div>
  `;

  const shareBtn = $('c-group-card-share');
  if (shareBtn) shareBtn.addEventListener('click', async () => {
    const url = location.origin + '/community.html';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'The One Percent Academy', url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        shareBtn.textContent = 'Link copied ✓';
        setTimeout(() => { shareBtn.textContent = 'Share community'; }, 1800);
      }
    } catch (e) { /* user cancelled or unsupported — no-op */ }
  });
}

async function switchChannel(nextKey) {
  state.activeChannel = nextKey;
  state.posts = [];
  state.lastDoc = null;
  state.done = false;
  state.likedIds = new Set();
  state.commentsOpen = new Set();
  state.pendingPosts = [];
  // Reflect in URL without a full reload.
  try {
    const next = new URL(location.href);
    next.searchParams.set('channel', nextKey);
    history.replaceState(null, '', next.toString());
  } catch (e) {}
  renderSidebar();
  renderComposer();
  // Refresh pinned post for new channel and re-render header.
  state.pinnedPost = await getPinnedPostForChannel(nextKey).catch(() => null);
  renderChannelHeader();
  // Re-subscribe to the new channel; the snapshot listener will paint the
  // initial 20 posts when it lands.
  subscribeToActiveChannel();
  // Tear down any pending-posts toast.
  const t = document.getElementById('c-new-posts-toast');
  if (t) t.remove();
}

async function submitPost() {
  const text = $('composer-text').value.trim();
  const file = $('composer-file').files[0] || null;
  const errEl = $('composer-err');
  errEl.style.display = 'none';
  if (!text && !file) {
    errEl.textContent = 'Write something or attach an image.';
    errEl.style.display = 'block';
    return;
  }
  const btn = $('btn-post');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Posting…';
  try {
    // Scope: owner posts global (companyId=null). Admins/users post to their companyId if they have one,
    // otherwise global (individual buyers).
    const scopeCompanyId = state.role === 'owner' ? null : (state.companyId || null);
    const channelSel = $('composer-channel');
    const chosenCategory = (channelSel && channelSel.value) || state.activeChannel || 'general';
    // Mentions referenced in the textarea via the @[uid:Name] tokens.
    // We rebuild the list from the current text so deletions are honored.
    const composerText = text || '';
    const mentionedUids = collectMentionedUidsFromText(composerText);
    await createPost({
      text: composerText,
      imageFile: file,
      companyId: scopeCompanyId,
      author: state.me,
      category: chosenCategory,
      mentionedUids
    });
    $('composer-text').value = '';
    $('composer-file').value = '';
    $('composer-filename').textContent = '';
    $('composer-preview').innerHTML = '';
    state.mentionUids = new Set();
    // Stat trigger fires async — schedule a refresh so the user sees their
    // points / level update without a manual reload. Cheap (one callable).
    setTimeout(() => { refreshLeaderboard().catch(() => {}); }, 2500);
    // If the user posted into a different channel than the one they're viewing,
    // switch (which retears down + opens a new realtime listener). Otherwise
    // the active listener will pick up the new post on its own.
    if (chosenCategory !== state.activeChannel) {
      await switchChannel(chosenCategory);
      return;
    }
  } catch (e) {
    errEl.textContent = e.message || 'Failed to post';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// Open / replace the realtime listener for the active channel. Bounded to
// the latest 20 posts; older pages still use the one-shot listPosts path
// via loadMore(). New posts that arrive while the user has scrolled away
// from the top accumulate in state.pendingPosts and surface as a "X new"
// toast; live-window edits (like / comment count changes) update in place.
function subscribeToActiveChannel() {
  if (state.feedUnsub) {
    try { state.feedUnsub(); } catch (e) {}
    state.feedUnsub = null;
  }
  state.livePostIds = new Set();
  state.pendingPosts = [];

  // Skeleton cards so the user sees structure while the live snapshot lands
  // (also masks the longer delay if Firestore is still building the channel
  // composite index after a fresh deploy).
  const feed = $('feed');
  if (feed) feed.innerHTML = skeletonCardsHtml(3);
  const loadingEl = $('feed-loading');
  if (loadingEl) loadingEl.textContent = '';

  state.feedUnsub = subscribeToFeed({
    category: state.activeChannel,
    role: state.role,
    companyId: state.companyId,
    pageSize: 20
  }, ({ posts, changes }) => onFeedSnapshot(posts, changes));
}

function isUserScrolledAwayFromTop() {
  // Treat anything past the top of the feed as "scrolled away".
  const feed = $('feed');
  if (!feed) return false;
  const rect = feed.getBoundingClientRect();
  return rect.top < -60;
}

async function onFeedSnapshot(nextPosts, changes) {
  const wasFirstLoad = state.posts.length === 0;
  const visibleIds = new Set(state.posts.slice(0, 20).map((p) => p.id));

  if (wasFirstLoad) {
    state.posts = nextPosts.slice();
    state.livePostIds = new Set(nextPosts.map((p) => p.id));
    // Hydrate liked state once; later changes are surgical.
    await Promise.all(nextPosts.map(async (p) => {
      const liked = await hasLiked(p.id).catch(() => false);
      if (liked) state.likedIds.add(p.id);
    }));
    renderFeed();
    return;
  }

  // Diff-driven updates so the user's open comment composer doesn't get
  // ripped out from under them on every snapshot tick.
  const adds = [];
  const mods = [];
  const removes = [];
  for (const c of changes) {
    if (c.type === 'added' && !visibleIds.has(c.post.id)) adds.push(c.post);
    else if (c.type === 'modified') mods.push(c.post);
    else if (c.type === 'removed') removes.push(c.post);
  }

  // Removals: drop from state + DOM.
  if (removes.length) {
    const removed = new Set(removes.map((p) => p.id));
    state.posts = state.posts.filter((p) => !removed.has(p.id));
    removes.forEach((p) => {
      const card = document.getElementById(`post-${p.id}`);
      if (card) card.remove();
    });
  }

  // Modifications: in-place patch of the like / comment counters in the DOM,
  // plus update the in-memory copy so `handleLike` etc. read fresh values.
  mods.forEach((p) => {
    const idx = state.posts.findIndex((x) => x.id === p.id);
    if (idx === -1) return;
    state.posts[idx] = { ...state.posts[idx], ...p };
    const lc = document.querySelector(`[data-like-count="${p.id}"]`);
    if (lc) lc.textContent = String(p.likeCount || 0);
    const cc = document.querySelector(`[data-comment-count="${p.id}"]`);
    if (cc) cc.textContent = String(p.commentCount || 0);
  });

  // New posts: prepend if user is at the top of the feed; otherwise buffer.
  if (adds.length) {
    if (isUserScrolledAwayFromTop()) {
      const have = new Set(state.pendingPosts.map((p) => p.id));
      adds.forEach((p) => { if (!have.has(p.id)) state.pendingPosts.push(p); });
      renderNewPostsToast();
    } else {
      const have = new Set(state.posts.map((p) => p.id));
      const fresh = adds.filter((p) => !have.has(p.id));
      state.posts = [...fresh, ...state.posts];
      renderFeed();
    }
  }

  state.livePostIds = new Set(nextPosts.map((p) => p.id));
}

function renderNewPostsToast() {
  let toast = document.getElementById('c-new-posts-toast');
  if (!state.pendingPosts.length) {
    if (toast) toast.remove();
    return;
  }
  if (!toast) {
    toast = document.createElement('button');
    toast.id = 'c-new-posts-toast';
    toast.className = 'c-new-posts-toast';
    toast.addEventListener('click', () => {
      const merged = [...state.pendingPosts, ...state.posts];
      const seen = new Set();
      state.posts = merged.filter((p) => {
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      });
      state.pendingPosts = [];
      renderFeed();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast.remove();
    });
    const channelHeader = $('channel-header');
    if (channelHeader && channelHeader.parentNode) {
      channelHeader.parentNode.insertBefore(toast, channelHeader.nextSibling);
    }
  }
  const n = state.pendingPosts.length;
  toast.textContent = `${n} new ${n === 1 ? 'post' : 'posts'} ↑`;
}

// Kept for the "Load more" pagination path (older posts beyond live window).
async function loadMore(reset = false) {
  if (state.loading || state.done) return;
  state.loading = true;
  const feed = $('feed');
  if (reset) feed.innerHTML = '';
  const loadingEl = $('feed-loading');
  if (loadingEl) loadingEl.textContent = 'Loading…';
  try {
    const { posts, lastDoc, done } = await listPosts({
      pageSize: 20,
      after: state.lastDoc,
      role: state.role,
      companyId: state.companyId,
      category: state.activeChannel
    });
    // Merge into existing array, dedup by id.
    const have = new Set(state.posts.map((p) => p.id));
    const fresh = posts.filter((p) => !have.has(p.id));
    state.posts = state.posts.concat(fresh);
    state.lastDoc = lastDoc;
    state.done = done;
    await Promise.all(fresh.map(async (p) => {
      const liked = await hasLiked(p.id);
      if (liked) state.likedIds.add(p.id);
    }));
    renderFeed();
  } catch (e) {
    console.error(e);
    if (loadingEl) loadingEl.textContent = 'Could not load feed.';
  } finally {
    state.loading = false;
  }
}

function canDeletePost(post) {
  if (!state.me) return false;
  if (post.authorUid === state.me.uid) return true;
  if (state.role === 'owner') return true;
  if (state.role === 'admin' && state.companyId && post.companyId === state.companyId) return true;
  return false;
}

function canPinPost(post) {
  if (!state.me) return false;
  if (state.role === 'owner') return true;
  if (state.role === 'admin' && state.companyId && post.companyId === state.companyId) return true;
  return false;
}

function canDeleteComment(comment, post) {
  if (!state.me) return false;
  if (comment.authorUid === state.me.uid) return true;
  if (state.role === 'owner') return true;
  if (state.role === 'admin' && state.companyId && post.companyId === state.companyId) return true;
  return false;
}

function emptyChannelCopy(ch) {
  switch (ch.key) {
    case 'wins':
      return {
        title: 'No wins shared yet',
        body: 'Celebrate a small one — a habit kept, a contract signed, a hard call made. Wins compound.',
        cta: 'Share a win'
      };
    case 'questions':
      return {
        title: 'No questions yet',
        body: 'Stuck on something? Ask. Someone here has hit the same wall and made it through.',
        cta: 'Ask a question'
      };
    case 'announcements':
      return {
        title: 'Nothing to announce',
        body: 'Updates from the team will land here. Owners and admins post; everyone reads.',
        cta: 'Post an announcement'
      };
    default:
      return {
        title: `No posts in #${ch.name.toLowerCase()} yet`,
        body: 'Be the first to start the conversation. Drop a thought below.',
        cta: 'Write a post'
      };
  }
}

function focusComposer() {
  const ta = $('composer-text');
  if (!ta) return;
  ta.focus({ preventScroll: false });
  // Scroll the composer card into view in case the user is far down.
  ta.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderFeed() {
  const feed = $('feed');
  if (!state.posts.length) {
    const ch = activeChannelMeta();
    const copy = emptyChannelCopy(ch);
    feed.innerHTML = `
      <div class="c-empty c-empty-large">
        <div class="c-empty-art" aria-hidden="true">${escapeHtml(ch.emoji || '#')}</div>
        <div class="c-empty-title">${escapeHtml(copy.title)}</div>
        <p class="c-empty-body">${escapeHtml(copy.body)}</p>
        <button class="btn btn-primary c-empty-cta" id="c-empty-cta">${escapeHtml(copy.cta)}</button>
      </div>`;
    const lm = $('load-more');
    if (lm) lm.style.display = 'none';
    const feedLoading = $('feed-loading');
    if (feedLoading) feedLoading.textContent = '';
    const cta = $('c-empty-cta');
    if (cta) cta.addEventListener('click', focusComposer);
    return;
  }
  feed.innerHTML = state.posts.map((p) => postCardHtml(p)).join('');
  state.posts.forEach((p) => bindPostCard(p));
  const lm = $('load-more');
  if (lm) lm.style.display = state.done ? 'none' : 'inline-flex';
  const feedLoading = $('feed-loading');
  if (feedLoading) feedLoading.textContent = '';
}

function roleBadgeHtml(role) {
  if (role === 'owner') return `<span class="c-role-badge c-role-owner">Owner</span>`;
  if (role === 'admin') return `<span class="c-role-badge c-role-admin">Admin</span>`;
  return '';
}

// Level pill — color-shaded by level. Only renders if we have a cached level
// for the given uid (i.e. they appear in the loaded leaderboard or it's the
// current user). Authors outside the top-N render with no pill, by design.
function levelBadgeHtml(uid) {
  if (!uid) return '';
  let lvl = state.authorLevels.get(uid);
  if (!lvl && state.me && uid === state.me.uid && state.myStats) {
    lvl = state.myStats.level;
  }
  if (!lvl || lvl < 1) return '';
  return `<span class="c-level-badge c-level-${Math.min(10, lvl)}" title="Level ${lvl}">Lv ${lvl}</span>`;
}

function scopeBadgeHtml(post) {
  if (post.companyId == null) {
    return `<span class="c-scope-badge c-scope-global">Global</span>`;
  }
  return `<span class="c-scope-badge c-scope-company">Company</span>`;
}

function postCardHtml(p) {
  const liked = state.likedIds.has(p.id);
  const delBtn = canDeletePost(p)
    ? `<button class="c-post-menu-btn" data-del="${p.id}" title="Delete">✕</button>` : '';
  const pinBtn = canPinPost(p)
    ? `<button class="c-post-menu-btn c-pin-btn ${p.pinned ? 'is-pinned' : ''}" data-pin="${p.id}" title="${p.pinned ? 'Unpin from channel' : 'Pin to channel'}">${p.pinned ? '📌' : '📍'}</button>`
    : '';
  const img = p.imageUrl
    ? `<div class="c-post-image"><img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy"></div>` : '';
  const commentsBlock = state.commentsOpen.has(p.id)
    ? `<div class="c-comments" id="c-comments-${p.id}"><div class="c-comments-loading">Loading…</div></div>`
    : '';
  const pinnedTag = p.pinned ? `<span class="c-channel-pill is-pinned">📌 Pinned</span>` : '';
  const channelTag = (p.category && p.category !== state.activeChannel)
    ? `<span class="c-channel-pill">${escapeHtml('#' + p.category)}</span>`
    : '';
  return `
    <article class="c-post ${p.pinned ? 'is-pinned' : ''}" id="post-${p.id}" data-post="${p.id}">
      <header class="c-post-head">
        <a class="c-post-author" href="/profile.html?uid=${encodeURIComponent(p.authorUid)}">
          ${avatarHtml({ authorAvatar: p.authorAvatar, authorName: p.authorName }, 40)}
          <div class="c-post-who">
            <div class="c-post-name">${escapeHtml(p.authorName || 'Unknown')} ${roleBadgeHtml(p.authorRole)} ${levelBadgeHtml(p.authorUid)}</div>
            <div class="c-post-meta">${fmtRelative(p.createdAt)} · ${scopeBadgeHtml(p)} ${pinnedTag} ${channelTag}</div>
          </div>
        </a>
        <div class="c-post-menu">
          ${pinBtn}
          ${delBtn}
        </div>
      </header>
      ${p.text ? `<div class="c-post-body">${renderTextWithMentions(p.text).html}</div>` : ''}
      ${img}
      <footer class="c-post-actions">
        <button class="c-action ${liked ? 'c-liked' : ''}" data-like="${p.id}">
          <span class="c-action-icon">${liked ? '❤️' : '🤍'}</span>
          <span class="c-action-count" data-like-count="${p.id}">${p.likeCount || 0}</span>
        </button>
        <button class="c-action" data-comment="${p.id}">
          <span class="c-action-icon">💬</span>
          <span class="c-action-count" data-comment-count="${p.id}">${p.commentCount || 0}</span>
        </button>
      </footer>
      ${commentsBlock}
    </article>
  `;
}

function bindPostCard(p) {
  const card = document.querySelector(`[data-post="${p.id}"]`);
  if (!card) return;
  const likeBtn = card.querySelector(`[data-like="${p.id}"]`);
  if (likeBtn) likeBtn.addEventListener('click', () => handleLike(p));
  const commentBtn = card.querySelector(`[data-comment="${p.id}"]`);
  if (commentBtn) commentBtn.addEventListener('click', () => toggleComments(p));
  const delBtn = card.querySelector(`[data-del="${p.id}"]`);
  if (delBtn) delBtn.addEventListener('click', () => handleDelete(p));
  const pinBtn = card.querySelector(`[data-pin="${p.id}"]`);
  if (pinBtn) pinBtn.addEventListener('click', () => handlePin(p));
  if (state.commentsOpen.has(p.id)) loadCommentsInto(p);
}

async function handlePin(p) {
  const next = !p.pinned;
  const channelKey = p.category || state.activeChannel || 'general';
  try {
    await setPostPinned(p.id, next, channelKey);
    p.pinned = next;
    // Update the channel pinned-banner in place if we're viewing the same channel.
    if (channelKey === state.activeChannel) {
      state.pinnedPost = next ? p : null;
      renderChannelHeader();
    }
    renderFeed();
  } catch (e) {
    alert('Could not update pin: ' + (e.message || e));
  }
}

async function handleLike(p) {
  // Optimistic UI.
  const wasLiked = state.likedIds.has(p.id);
  const countEl = document.querySelector(`[data-like-count="${p.id}"]`);
  const btn = document.querySelector(`[data-like="${p.id}"]`);
  const icon = btn.querySelector('.c-action-icon');
  const prevCount = Number(countEl.textContent) || 0;
  if (wasLiked) {
    state.likedIds.delete(p.id);
    btn.classList.remove('c-liked');
    icon.textContent = '🤍';
    countEl.textContent = Math.max(0, prevCount - 1);
    p.likeCount = Math.max(0, prevCount - 1);
  } else {
    state.likedIds.add(p.id);
    btn.classList.add('c-liked');
    icon.textContent = '❤️';
    countEl.textContent = prevCount + 1;
    p.likeCount = prevCount + 1;
  }
  try {
    await toggleLike(p.id);
  } catch (e) {
    // Revert on error.
    if (wasLiked) {
      state.likedIds.add(p.id);
      btn.classList.add('c-liked');
      icon.textContent = '❤️';
    } else {
      state.likedIds.delete(p.id);
      btn.classList.remove('c-liked');
      icon.textContent = '🤍';
    }
    countEl.textContent = prevCount;
    p.likeCount = prevCount;
    console.warn('Like failed', e);
  }
}

async function handleDelete(p) {
  if (!confirm('Delete this post? This cannot be undone.')) return;
  try {
    await deletePost(p.id);
    state.posts = state.posts.filter((x) => x.id !== p.id);
    renderFeed();
  } catch (e) {
    alert('Could not delete: ' + (e.message || e));
  }
}

function toggleComments(p) {
  if (state.commentsOpen.has(p.id)) {
    state.commentsOpen.delete(p.id);
  } else {
    state.commentsOpen.add(p.id);
  }
  renderFeed();
}

async function loadCommentsInto(p) {
  const root = document.getElementById(`c-comments-${p.id}`);
  if (!root) return;
  const comments = await listComments(p.id);
  root.innerHTML = `
    <div class="c-comments-list">
      ${comments.length ? comments.map((c) => commentHtml(c, p)).join('') : '<div class="c-no-comments">No comments yet.</div>'}
    </div>
    <div class="c-comment-composer">
      ${avatarHtml(state.me, 30)}
      <input type="text" class="c-comment-input" id="comment-input-${p.id}" placeholder="Write a comment…">
      <button class="btn btn-ghost" data-comment-submit="${p.id}">Send</button>
    </div>
  `;
  const submit = root.querySelector(`[data-comment-submit="${p.id}"]`);
  const input = root.querySelector(`#comment-input-${p.id}`);
  attachMentionAutocomplete(input);
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    submit.disabled = true;
    try {
      const mentionedUids = collectMentionedUidsFromText(text);
      await addComment(p.id, { text, author: state.me, mentionedUids });
      // Update counter in memory + DOM.
      p.commentCount = (p.commentCount || 0) + 1;
      const cc = document.querySelector(`[data-comment-count="${p.id}"]`);
      if (cc) cc.textContent = p.commentCount;
      input.value = '';
      await loadCommentsInto(p);
    } catch (e) {
      alert('Could not comment: ' + (e.message || e));
    } finally {
      submit.disabled = false;
    }
  };
  submit.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    // Don't submit while the autocomplete is intercepting Enter.
    if (e.key === 'Enter' && !document.querySelector('.c-mention-dropdown')) send();
  });
  // Delete buttons.
  root.querySelectorAll('[data-comment-del]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Delete this comment?')) return;
      try {
        await deleteComment(p.id, b.dataset.commentDel);
        p.commentCount = Math.max(0, (p.commentCount || 1) - 1);
        const cc = document.querySelector(`[data-comment-count="${p.id}"]`);
        if (cc) cc.textContent = p.commentCount;
        await loadCommentsInto(p);
      } catch (e) {
        alert('Could not delete: ' + (e.message || e));
      }
    });
  });
}

function commentHtml(c, p) {
  const del = canDeleteComment(c, p)
    ? `<button class="c-comment-del" data-comment-del="${c.id}" title="Delete">✕</button>` : '';
  return `
    <div class="c-comment">
      ${avatarHtml({ authorAvatar: c.authorAvatar, authorName: c.authorName }, 30)}
      <div class="c-comment-body">
        <div class="c-comment-head">
          <a class="c-comment-name" href="/profile.html?uid=${encodeURIComponent(c.authorUid)}">${escapeHtml(c.authorName || 'Unknown')}</a>
          <span class="c-comment-time">${fmtRelative(c.createdAt)}</span>
          ${del}
        </div>
        <div class="c-comment-text">${renderTextWithMentions(c.text || '').html}</div>
      </div>
    </div>
  `;
}

async function main() {
  if (!firebaseReady) {
    $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">Firebase is unavailable.</div></div>`;
    return;
  }
  const u = await onAuthReady();
  if (!u) {
    location.replace('/login.html?next=' + encodeURIComponent('/community.html'));
    return;
  }

  const info = await getRoleInfo();
  state.role = info.role;
  state.companyId = info.companyId || null;

  const profile = (await getUserProfile(u.uid)) || {};
  state.me = {
    uid: u.uid,
    email: u.email,
    displayName: profile.displayName || u.displayName || u.email,
    avatarUrl: profile.avatarUrl || null,
    role: info.role,
    companyId: info.companyId || null
  };

  // Load channels (Phase 1) before rendering so the sidebar + composer have data.
  state.channels = await listChannels();
  if (!state.channels.find((c) => c.key === state.activeChannel)) {
    state.activeChannel = 'general';
  }

  // Shared topbar — paints the user-chip, owns the notification bell +
  // popover, and wires the sign-out button.
  renderTopbar({
    user: state.me,
    profile: { displayName: state.me.displayName, avatarUrl: state.me.avatarUrl },
    role: state.role,
    currentPage: 'community'
  });
  renderDashboardHero();   // paints initial state with placeholder zeroes;
                           // refreshLeaderboard() refines it once stats land.
  renderTabs();
  renderSidebar();
  renderComposer();
  renderGroupInfoCard();   // initial paint; refreshLeaderboard() repaints
                           // once the leaderboard rows arrive.

  // Pinned post for the active channel (best-effort; skipped silently if missing).
  state.pinnedPost = await getPinnedPostForChannel(state.activeChannel).catch(() => null);
  renderChannelHeader();

  // Phase 2 — kick off leaderboard hydration in parallel with the feed so it
  // doesn't block initial paint. Re-render once it lands.
  refreshLeaderboard().catch(() => {});

  // Phase 3 — replace the polling feed with a bounded realtime listener.
  subscribeToActiveChannel();

  // Notification deep-link: handle existing #post-X on initial load and any
  // hashchange that follows (e.g. clicking another notif from the bell while
  // already on the page).
  handleHashScroll();
  window.addEventListener('hashchange', handleHashScroll);

  // Touch last-visit timestamp so the "new" badge clears.
  touchCommunityVisit().catch(() => {});

  $('load-more').addEventListener('click', () => loadMore(false));

  // Tear down listeners cleanly when the user leaves the page.
  window.addEventListener('beforeunload', () => {
    if (state.feedUnsub) { try { state.feedUnsub(); } catch (e) {} }
    teardownTopbar();
  });
}

main();
