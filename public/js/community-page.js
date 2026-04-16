// Community feed page — composer + paginated feed + comments + likes.

import { auth, firebaseReady } from './firebase.js';
import { onAuthReady, signOut } from './auth.js';
import { getRoleInfo } from './roles.js';
import {
  listPosts, createPost, deletePost, toggleLike, hasLiked,
  listComments, addComment, deleteComment,
  getUserProfile, touchCommunityVisit,
  avatarHtml, fmtRelative, escapeHtml, linkify
} from './community.js';

const $ = (id) => document.getElementById(id);

const state = {
  me: null,           // { uid, displayName, avatarUrl, role, companyId }
  role: null,
  companyId: null,
  posts: [],
  lastDoc: null,
  done: false,
  loading: false,
  commentsOpen: new Set(),
  likedIds: new Set()
};

function renderChip() {
  const chip = $('user-chip');
  if (!chip || !state.me) return;
  const adminLink = state.role === 'admin' || state.role === 'owner'
    ? `<a class="user-chip-link" href="/admin.html">Admin</a>` : '';
  const crmLink = state.role === 'admin' || state.role === 'owner'
    ? `<a class="user-chip-link" href="/crm.html">CRM</a>` : '';
  const ownerLink = state.role === 'owner'
    ? `<a class="user-chip-link" href="/owner.html">Owner</a>` : '';
  chip.innerHTML = `
    <a class="user-chip-link" href="/index.html">Dashboard</a>
    <a class="user-chip-link" href="/members.html">Members</a>
    <a class="user-chip-link" href="/profile.html">Profile</a>
    ${crmLink}${adminLink}${ownerLink}
    <span class="c-avatar-link">${avatarHtml(state.me, 28)}</span>
    <span class="user-chip-email">${escapeHtml(state.me.displayName || state.me.email || '')}</span>
    <button class="btn btn-ghost" id="btn-signout">Sign out</button>
  `;
  $('btn-signout').addEventListener('click', async () => {
    try { await signOut(); } catch (e) {}
    location.replace('/login.html');
  });
}

function renderComposer() {
  const who = state.role === 'owner'
    ? 'global feed'
    : (state.companyId ? 'your company feed' : 'the feed');
  const composer = $('composer');
  composer.innerHTML = `
    <div class="c-composer-row">
      ${avatarHtml(state.me, 44)}
      <div style="flex:1; min-width:0;">
        <textarea id="composer-text" class="c-textarea" rows="3" placeholder="Share something with ${who}…"></textarea>
        <div id="composer-preview"></div>
        <div class="c-composer-actions">
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
    await createPost({
      text: text || '',
      imageFile: file,
      companyId: scopeCompanyId,
      author: state.me
    });
    $('composer-text').value = '';
    $('composer-file').value = '';
    $('composer-filename').textContent = '';
    $('composer-preview').innerHTML = '';
    // Reset feed and reload from top.
    state.posts = [];
    state.lastDoc = null;
    state.done = false;
    await loadMore(true);
  } catch (e) {
    errEl.textContent = e.message || 'Failed to post';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

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
      companyId: state.companyId
    });
    state.posts = state.posts.concat(posts);
    state.lastDoc = lastDoc;
    state.done = done;
    // Preload like state for visible posts.
    await Promise.all(posts.map(async (p) => {
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

function canDeleteComment(comment, post) {
  if (!state.me) return false;
  if (comment.authorUid === state.me.uid) return true;
  if (state.role === 'owner') return true;
  if (state.role === 'admin' && state.companyId && post.companyId === state.companyId) return true;
  return false;
}

function renderFeed() {
  const feed = $('feed');
  if (!state.posts.length) {
    const ownerEmpty = state.role === 'owner'
      ? `<div class="c-empty">
          <div class="c-empty-title">No posts yet</div>
          <p>Post your first update to the community. Your team is watching.</p>
        </div>`
      : `<div class="c-empty">
          <div class="c-empty-title">The feed is quiet</div>
          <p>Be the first to share something.</p>
        </div>`;
    feed.innerHTML = ownerEmpty;
    const lm = $('load-more');
    if (lm) lm.style.display = 'none';
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
  const img = p.imageUrl
    ? `<div class="c-post-image"><img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy"></div>` : '';
  const commentsBlock = state.commentsOpen.has(p.id)
    ? `<div class="c-comments" id="c-comments-${p.id}"><div class="c-comments-loading">Loading…</div></div>`
    : '';
  return `
    <article class="c-post" data-post="${p.id}">
      <header class="c-post-head">
        <a class="c-post-author" href="/profile.html?uid=${encodeURIComponent(p.authorUid)}">
          ${avatarHtml({ authorAvatar: p.authorAvatar, authorName: p.authorName }, 40)}
          <div class="c-post-who">
            <div class="c-post-name">${escapeHtml(p.authorName || 'Unknown')} ${roleBadgeHtml(p.authorRole)}</div>
            <div class="c-post-meta">${fmtRelative(p.createdAt)} · ${scopeBadgeHtml(p)}</div>
          </div>
        </a>
        ${delBtn}
      </header>
      ${p.text ? `<div class="c-post-body">${linkify(p.text)}</div>` : ''}
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
  if (state.commentsOpen.has(p.id)) loadCommentsInto(p);
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
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    submit.disabled = true;
    try {
      await addComment(p.id, { text, author: state.me });
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
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
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
        <div class="c-comment-text">${linkify(c.text || '')}</div>
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

  renderChip();
  renderComposer();
  await loadMore(true);

  // Touch last-visit timestamp so the "new" badge clears.
  touchCommunityVisit().catch(() => {});

  $('load-more').addEventListener('click', () => loadMore(false));
}

main();
