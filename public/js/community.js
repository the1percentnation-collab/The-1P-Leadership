// Community — shared data layer for the Community feed, Members directory, and Profile.
// Designed to match the existing `store.js` / `auth.js` style: CDN modular Firebase imports,
// no bundler, graceful degradation when offline.

import { app, auth, db, firebaseReady } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, limit, startAfter, getDocs,
  serverTimestamp, increment, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ────────────────────────────────────────────────────────────────
// Storage (lazy, so pages that don't need uploads don't pay the cost)
// ────────────────────────────────────────────────────────────────
let _storage = null;
function storage() {
  if (!_storage && firebaseReady) _storage = getStorage(app);
  return _storage;
}

// ────────────────────────────────────────────────────────────────
// User identity helpers — centralizes "who am I, who is this author"
// ────────────────────────────────────────────────────────────────
export async function getUserProfile(uid) {
  if (!firebaseReady || !uid) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return { uid, ...snap.data() };
  } catch (e) {
    console.warn('[community] getUserProfile failed', e);
    return null;
  }
}

export async function updateOwnProfile({ displayName, bio, avatarUrl }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const patch = { lastActiveAt: serverTimestamp() };
  if (typeof displayName === 'string') patch.displayName = displayName.trim();
  if (typeof bio === 'string') patch.bio = bio.trim();
  if (typeof avatarUrl === 'string') patch.avatarUrl = avatarUrl;
  await setDoc(doc(db, 'users', user.uid), patch, { merge: true });
  return patch;
}

export async function uploadAvatar(file) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const s = storage();
  if (!s) throw new Error('Storage unavailable');
  const ext = (file.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
  const safe = `${Date.now()}.${ext}`;
  const r = storageRef(s, `avatars/${user.uid}/${safe}`);
  await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
  return await getDownloadURL(r);
}

export async function uploadPostImage(postId, file) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const s = storage();
  if (!s) throw new Error('Storage unavailable');
  const ext = (file.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
  const safe = `${Date.now()}.${ext}`;
  const r = storageRef(s, `posts/${postId}/${safe}`);
  await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
  return await getDownloadURL(r);
}

// ────────────────────────────────────────────────────────────────
// Posts
// ────────────────────────────────────────────────────────────────

// Scope rule: individual users see companyId==null only; company users see their
// company + null; owner sees all. We implement this client-side with two queries
// and merge — Firestore doesn't allow OR across different fields cleanly in v1.
//
// `category` (Phase 1 channels) is optional. When passed, the feed is filtered
// to posts where category == <value>. Legacy posts without a category field
// are treated as 'general' client-side: when category === 'general' we run a
// SECOND pass without the where('category') clause and merge, dropping any
// post that has a non-general category set. This keeps the rollout zero-write.
export async function listPosts({ pageSize = 20, after = null, role = 'user', companyId = null, category = null } = {}) {
  if (!firebaseReady) return { posts: [], lastDoc: null, done: true };
  const results = [];
  let lastDoc = null;
  const includeLegacyAsGeneral = category === 'general';

  function applyCategoryClause(parts) {
    if (category) parts.push(where('category', '==', category));
    return parts;
  }

  async function runQ(base) {
    const parts = applyCategoryClause([base]);
    parts.push(orderBy('createdAt', 'desc'));
    if (after) parts.push(startAfter(after));
    parts.push(limit(pageSize));
    const q = query(...parts);
    const snap = await getDocs(q);
    snap.forEach((d) => {
      results.push({ id: d.id, ...d.data(), _snap: d });
    });
    if (!snap.empty) lastDoc = snap.docs[snap.docs.length - 1];
  }

  // Second-pass fetch for legacy posts (no `category` field) — only when the
  // active channel is 'general'. We can't directly query "missing field", so
  // we re-fetch without the where clause and filter client-side, dedup by id.
  async function runLegacyMerge(base, into) {
    const parts = [base, orderBy('createdAt', 'desc')];
    if (after) parts.push(startAfter(after));
    parts.push(limit(pageSize));
    const snap = await getDocs(query(...parts));
    const seen = new Set(into.map((p) => p.id));
    snap.forEach((d) => {
      if (seen.has(d.id)) return;
      const data = d.data();
      // Treat missing category as 'general'. Anything else is excluded.
      if (data.category && data.category !== 'general') return;
      into.push({ id: d.id, ...data, _snap: d });
    });
  }

  try {
    if (role === 'owner') {
      // Owner: all posts.
      await runQ(collection(db, 'posts'));
      if (includeLegacyAsGeneral) await runLegacyMerge(collection(db, 'posts'), results);
    } else if (companyId) {
      // Company user: company posts + global.
      await runQ(query(collection(db, 'posts'), where('companyId', '==', companyId)));
      if (includeLegacyAsGeneral) {
        await runLegacyMerge(query(collection(db, 'posts'), where('companyId', '==', companyId)), results);
      }
      // Second fetch for global posts.
      const globalResults = [];
      const gqBase = [collection(db, 'posts'), where('companyId', '==', null)];
      if (category) gqBase.push(where('category', '==', category));
      gqBase.push(orderBy('createdAt', 'desc'));
      if (after) gqBase.push(startAfter(after));
      gqBase.push(limit(pageSize));
      try {
        const gsnap = await getDocs(query(...gqBase));
        gsnap.forEach((d) => globalResults.push({ id: d.id, ...d.data(), _snap: d }));
        if (includeLegacyAsGeneral) {
          await runLegacyMerge(query(collection(db, 'posts'), where('companyId', '==', null)), globalResults);
        }
      } catch (e) { /* missing index tolerated for v1 */ }
      // Merge + resort.
      const merged = [...results, ...globalResults];
      merged.sort((a, b) => {
        const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
      return { posts: merged.slice(0, pageSize), lastDoc, done: merged.length < pageSize };
    } else {
      // Individual buyer: only global posts.
      await runQ(query(collection(db, 'posts'), where('companyId', '==', null)));
      if (includeLegacyAsGeneral) {
        await runLegacyMerge(query(collection(db, 'posts'), where('companyId', '==', null)), results);
      }
    }
  } catch (e) {
    console.warn('[community] listPosts failed', e);
    return { posts: [], lastDoc: null, done: true, error: e };
  }

  // Re-sort owner/individual paths after potential legacy merge.
  results.sort((a, b) => {
    const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });

  return { posts: results.slice(0, pageSize), lastDoc, done: results.length < pageSize };
}

export async function getLatestPostTimestamp({ role = 'user', companyId = null } = {}) {
  if (!firebaseReady) return null;
  try {
    let q;
    if (role === 'owner') {
      q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(1));
    } else if (companyId) {
      // Check the newer of (company, global). Keep it cheap: one for company + one for global.
      const c = await getDocs(query(collection(db, 'posts'), where('companyId', '==', companyId), orderBy('createdAt', 'desc'), limit(1)));
      const g = await getDocs(query(collection(db, 'posts'), where('companyId', '==', null), orderBy('createdAt', 'desc'), limit(1)));
      const cT = c.empty ? 0 : (c.docs[0].data().createdAt && c.docs[0].data().createdAt.toMillis ? c.docs[0].data().createdAt.toMillis() : 0);
      const gT = g.empty ? 0 : (g.docs[0].data().createdAt && g.docs[0].data().createdAt.toMillis ? g.docs[0].data().createdAt.toMillis() : 0);
      return Math.max(cT, gT) || null;
    } else {
      q = query(collection(db, 'posts'), where('companyId', '==', null), orderBy('createdAt', 'desc'), limit(1));
    }
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const t = snap.docs[0].data().createdAt;
    return t && t.toMillis ? t.toMillis() : null;
  } catch (e) {
    return null;
  }
}

export const CHANNEL_KEYS = ['general', 'wins', 'questions', 'announcements'];

export async function createPost({ text, imageFile, companyId = null, author, category = 'general' }) {
  if (!firebaseReady) throw new Error('Firebase unavailable');
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!text || !text.trim()) throw new Error('Post text is required');
  const cat = CHANNEL_KEYS.includes(category) ? category : 'general';

  // Create post doc first (we need postId for the storage path).
  const docRef = await addDoc(collection(db, 'posts'), {
    authorUid: user.uid,
    authorName: author.displayName || user.displayName || user.email || 'Unknown',
    authorAvatar: author.avatarUrl || null,
    authorRole: author.role || 'user',
    text: text.trim(),
    imageUrl: null,
    likeCount: 0,
    commentCount: 0,
    companyId: companyId || null,
    category: cat,
    pinned: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  let imageUrl = null;
  if (imageFile) {
    try {
      imageUrl = await uploadPostImage(docRef.id, imageFile);
      await updateDoc(docRef, { imageUrl });
    } catch (e) {
      console.warn('[community] image upload failed (post kept without image)', e);
    }
  }
  return docRef.id;
}

export async function deletePost(postId) {
  if (!firebaseReady) throw new Error('Firebase unavailable');
  await deleteDoc(doc(db, 'posts', postId));
}

// Like toggle using a transaction: writes/removes likes/{uid} + ±1 likeCount.
export async function toggleLike(postId) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const postRef = doc(db, 'posts', postId);
  const likeRef = doc(db, 'posts', postId, 'likes', user.uid);
  return await runTransaction(db, async (tx) => {
    const likeSnap = await tx.get(likeRef);
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists()) throw new Error('Post not found');
    if (likeSnap.exists()) {
      tx.delete(likeRef);
      tx.update(postRef, { likeCount: increment(-1) });
      return { liked: false };
    } else {
      tx.set(likeRef, { createdAt: serverTimestamp() });
      tx.update(postRef, { likeCount: increment(1) });
      return { liked: true };
    }
  });
}

export async function hasLiked(postId) {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const snap = await getDoc(doc(db, 'posts', postId, 'likes', user.uid));
    return snap.exists();
  } catch (e) { return false; }
}

// ────────────────────────────────────────────────────────────────
// Comments (flat — one level only)
// ────────────────────────────────────────────────────────────────
export async function listComments(postId) {
  if (!firebaseReady) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'posts', postId, 'comments'),
      orderBy('createdAt', 'asc')
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[community] listComments failed', e);
    return [];
  }
}

export async function addComment(postId, { text, author }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!text || !text.trim()) throw new Error('Comment required');
  const postRef = doc(db, 'posts', postId);
  const commentsCol = collection(db, 'posts', postId, 'comments');
  // Two-step: create comment, then increment counter. We do them in a transaction
  // so the counter stays honest even under concurrent adds.
  return await runTransaction(db, async (tx) => {
    const postSnap = await tx.get(postRef);
    if (!postSnap.exists()) throw new Error('Post not found');
    const newCommentRef = doc(commentsCol); // auto-id
    tx.set(newCommentRef, {
      authorUid: user.uid,
      authorName: author.displayName || user.displayName || user.email || 'Unknown',
      authorAvatar: author.avatarUrl || null,
      text: text.trim(),
      createdAt: serverTimestamp()
    });
    tx.update(postRef, { commentCount: increment(1) });
    return newCommentRef.id;
  });
}

export async function deleteComment(postId, commentId) {
  const postRef = doc(db, 'posts', postId);
  const commentRef = doc(db, 'posts', postId, 'comments', commentId);
  return await runTransaction(db, async (tx) => {
    const cSnap = await tx.get(commentRef);
    if (!cSnap.exists()) return;
    tx.delete(commentRef);
    tx.update(postRef, { commentCount: increment(-1) });
  });
}

// ────────────────────────────────────────────────────────────────
// Channels (Phase 1) — categories that organize the feed.
// Channel docs live at `channels/{key}` and carry display metadata
// + an optional `pinnedPostId`. The four core channel keys are seeded
// by the owner; the client falls back to a hardcoded default list so
// the page renders even before the docs exist.
// ────────────────────────────────────────────────────────────────

const DEFAULT_CHANNELS = [
  { key: 'general',       name: 'General',       emoji: '💬', order: 0, description: 'Open conversation. Anything goes.' },
  { key: 'wins',          name: 'Wins',          emoji: '🏆', order: 1, description: 'Share what\'s working. Celebrate progress.' },
  { key: 'questions',     name: 'Questions',     emoji: '❓', order: 2, description: 'Ask the community. Help each other out.' },
  { key: 'announcements', name: 'Announcements', emoji: '📣', order: 3, description: 'Important updates from the team.' }
];

export async function listChannels() {
  if (!firebaseReady) return DEFAULT_CHANNELS.slice();
  try {
    const snap = await getDocs(query(collection(db, 'channels'), orderBy('order', 'asc')));
    if (snap.empty) return DEFAULT_CHANNELS.slice();
    const remote = snap.docs.map((d) => ({ key: d.id, ...d.data() }));
    // Merge: remote overrides defaults; missing defaults are appended so the
    // sidebar always shows the four core channels even if seeding is partial.
    const byKey = new Map(remote.map((c) => [c.key, c]));
    DEFAULT_CHANNELS.forEach((d) => { if (!byKey.has(d.key)) byKey.set(d.key, d); });
    return Array.from(byKey.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
  } catch (e) {
    console.warn('[community] listChannels failed, using defaults', e);
    return DEFAULT_CHANNELS.slice();
  }
}

export async function getPinnedPostForChannel(channelKey) {
  if (!firebaseReady || !channelKey) return null;
  try {
    const cSnap = await getDoc(doc(db, 'channels', channelKey));
    const pid = cSnap.exists() ? cSnap.data().pinnedPostId : null;
    if (!pid) return null;
    const pSnap = await getDoc(doc(db, 'posts', pid));
    if (!pSnap.exists()) return null;
    return { id: pSnap.id, ...pSnap.data() };
  } catch (e) {
    return null;
  }
}

// Owner / company-admin pin toggle — updates the post's `pinned` flag and
// mirrors the post id onto the channel doc so the sidebar can show one
// pinned post per channel without a query.
export async function setPostPinned(postId, pinned, channelKey) {
  if (!firebaseReady) throw new Error('Firebase unavailable');
  await updateDoc(doc(db, 'posts', postId), { pinned: !!pinned });
  if (channelKey) {
    try {
      await setDoc(doc(db, 'channels', channelKey), {
        pinnedPostId: pinned ? postId : null,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (e) {
      // Channel doc write is owner-only per rules. If the caller is an admin,
      // the post-level pin still succeeds; the channel-level mirror will be
      // out-of-sync until an owner reconciles. Acceptable for v1.
      console.warn('[community] channel pin mirror failed', e);
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Members directory
// ────────────────────────────────────────────────────────────────
export async function listMembers({ role, companyId }) {
  if (!firebaseReady) return [];
  try {
    if (role === 'owner') {
      // Owner can list all users (rules allow list for owner).
      const snap = await getDocs(collection(db, 'users'));
      return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    }
    if (companyId) {
      // Members subcollection is readable by other company members per existing rules.
      const snap = await getDocs(collection(db, 'companies', companyId, 'members'));
      return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    }
    // Individual buyer — no roster, just themselves.
    const u = auth.currentUser;
    if (!u) return [];
    const self = await getUserProfile(u.uid);
    return self ? [self] : [];
  } catch (e) {
    console.warn('[community] listMembers failed', e);
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// "New since last visit" badge helpers
// ────────────────────────────────────────────────────────────────
export async function touchCommunityVisit() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await setDoc(doc(db, 'users', user.uid), {
      lastCommunityVisitAt: serverTimestamp()
    }, { merge: true });
  } catch (e) { /* best-effort */ }
}

export async function hasNewPostsSinceVisit({ role, companyId }) {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const uSnap = await getDoc(doc(db, 'users', user.uid));
    const lastVisit = uSnap.exists() && uSnap.data().lastCommunityVisitAt && uSnap.data().lastCommunityVisitAt.toMillis
      ? uSnap.data().lastCommunityVisitAt.toMillis()
      : 0;
    const latest = await getLatestPostTimestamp({ role, companyId });
    if (!latest) return false;
    return latest > lastVisit;
  } catch (e) {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────
export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const letters = parts.slice(0, 2).map((p) => p[0] || '').join('');
  return letters.toUpperCase() || '?';
}

export function avatarHtml(profile, size = 40) {
  const name = profile && (profile.displayName || profile.authorName) || '';
  const src = profile && (profile.avatarUrl || profile.authorAvatar);
  const s = `width:${size}px; height:${size}px; font-size:${Math.round(size * 0.38)}px;`;
  if (src) {
    return `<div class="c-avatar" style="${s}"><img src="${src}" alt="" loading="lazy"></div>`;
  }
  return `<div class="c-avatar c-avatar-initials" style="${s}">${initials(name)}</div>`;
}

export function fmtRelative(ts) {
  if (!ts) return 'just now';
  const ms = ts.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : Number(ts));
  if (!ms) return 'just now';
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  try { return new Date(ms).toLocaleDateString(); } catch (e) { return `${d}d ago`; }
}

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function linkify(text) {
  const esc = escapeHtml(text);
  return esc.replace(/(https?:\/\/[^\s<]+)/g, (m) =>
    `<a href="${m}" target="_blank" rel="noopener" class="c-link">${m}</a>`
  );
}
