// Community — shared data layer for the Community feed, Members directory, and Profile.
// Designed to match the existing `store.js` / `auth.js` style: CDN modular Firebase imports,
// no bundler, graceful degradation when offline.

import { app, auth, db, functions, firebaseReady } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, limit, startAfter, getDocs,
  serverTimestamp, increment, runTransaction, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

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

export async function updateOwnProfile({
  displayName, bio, avatarUrl,
  profession, company, industry, location,
  linkedinUrl, website, phone, communityGoals, pronouns
} = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const patch = { lastActiveAt: serverTimestamp() };
  if (typeof displayName === 'string') patch.displayName = displayName.trim();
  if (typeof bio === 'string') patch.bio = bio.trim();
  if (typeof avatarUrl === 'string') patch.avatarUrl = avatarUrl;
  if (typeof profession === 'string') patch.profession = profession.trim();
  if (typeof company === 'string') patch.company = company.trim();
  if (typeof industry === 'string') patch.industry = industry.trim();
  if (typeof location === 'string') patch.location = location.trim();
  if (typeof linkedinUrl === 'string') patch.linkedinUrl = linkedinUrl.trim();
  if (typeof website === 'string') patch.website = website.trim();
  if (typeof phone === 'string') patch.phone = phone.trim();
  if (typeof communityGoals === 'string') patch.communityGoals = communityGoals.trim();
  if (typeof pronouns === 'string') patch.pronouns = pronouns.trim();
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

export async function uploadEventImage(eventId, file) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const s = storage();
  if (!s) throw new Error('Storage unavailable');
  const ext = (file.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
  const safe = `${Date.now()}.${ext}`;
  const r = storageRef(s, `events/${eventId}/${safe}`);
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

export async function createPost({ text, imageFile, companyId = null, author, category = 'general', mentionedUids = [] }) {
  if (!firebaseReady) throw new Error('Firebase unavailable');
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!text || !text.trim()) throw new Error('Post text is required');
  const cat = CHANNEL_KEYS.includes(category) ? category : 'general';
  const mentions = Array.isArray(mentionedUids)
    ? Array.from(new Set(mentionedUids.filter((u) => typeof u === 'string' && u))).slice(0, 10)
    : [];

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
    mentionedUids: mentions,
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

export async function addComment(postId, { text, author, mentionedUids = [] }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  if (!text || !text.trim()) throw new Error('Comment required');
  const postRef = doc(db, 'posts', postId);
  const commentsCol = collection(db, 'posts', postId, 'comments');
  const mentions = Array.isArray(mentionedUids)
    ? Array.from(new Set(mentionedUids.filter((u) => typeof u === 'string' && u))).slice(0, 10)
    : [];
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
      mentionedUids: mentions,
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

// Slugify a channel name into a URL-/Firestore-safe key. lowercase,
// alphanumerics + dashes only, collapses repeats, trims edges, capped
// at 32 chars.
export function slugifyChannelKey(name) {
  if (!name) return '';
  // Normalize then strip combining diacritical marks (U+0300–U+036F).
  return String(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 32);
}

/**
 * createChannelDoc({ name, emoji, description, order? })
 *
 * Owner-only by Firestore rules. Returns the created channel object.
 * Throws on validation failure or rule denial. The key is auto-derived
 * from the name unless an explicit `key` is passed.
 */
export async function createChannelDoc({ key, name, emoji = '#', description = '', order = null } = {}) {
  if (!firebaseReady) throw new Error('Firebase unavailable');
  const cleanName = String(name || '').trim();
  if (cleanName.length < 2 || cleanName.length > 40) {
    throw new Error('Channel name must be 2–40 characters.');
  }
  const finalKey = (key || slugifyChannelKey(cleanName)).trim();
  if (!/^[a-z0-9-]{2,32}$/.test(finalKey)) {
    throw new Error('Channel key must be 2–32 lowercase letters, digits, or dashes.');
  }
  // Reject collision with existing docs (best-effort — rules will also enforce).
  try {
    const existing = await getDoc(doc(db, 'channels', finalKey));
    if (existing.exists()) throw new Error(`Channel "${finalKey}" already exists.`);
  } catch (e) {
    if (/already exists/i.test(e.message)) throw e;
    // Fall through on read errors — let the write path surface a real error.
  }

  // Pick an order at the end of the list if not provided.
  let nextOrder = order;
  if (nextOrder == null) {
    try {
      const snap = await getDocs(query(collection(db, 'channels'), orderBy('order', 'desc'), limit(1)));
      const top = snap.empty ? -1 : Number((snap.docs[0].data().order) || 0);
      nextOrder = top + 1;
    } catch (e) {
      nextOrder = 100;
    }
  }

  const data = {
    key: finalKey,
    name: cleanName,
    emoji: (emoji || '#').slice(0, 8),
    description: String(description || '').slice(0, 200),
    order: Number(nextOrder),
    scope: 'global',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, 'channels', finalKey), data);
  return { ...data, key: finalKey };
}

// ────────────────────────────────────────────────────────────────
// Leaderboard, points & levels (Phase 2)
//
// Levels are derived purely client-side from a points lookup table — never
// written to Firestore. The leaderboard query goes through a callable Cloud
// Function so we can project safe fields (uid/displayName/avatar/points)
// without loosening the strict `users` list rule.
// ────────────────────────────────────────────────────────────────

// Threshold[i] is the points needed to reach level (i+1). 10 levels total.
export const LEVEL_THRESHOLDS = [0, 5, 50, 150, 400, 1000, 2500, 6000, 12000, 25000];

export function levelFromPoints(points) {
  const p = Number(points) || 0;
  let lvl = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (p >= LEVEL_THRESHOLDS[i]) lvl = i + 1;
  }
  return lvl;
}

export function levelProgress(points) {
  const p = Number(points) || 0;
  const lvl = levelFromPoints(p);
  const idx = lvl - 1;
  const floor = LEVEL_THRESHOLDS[idx];
  const ceiling = LEVEL_THRESHOLDS[idx + 1];
  if (ceiling == null) {
    return { level: lvl, points: p, floor, ceiling: null, pct: 100, toNext: 0 };
  }
  const pct = Math.max(0, Math.min(100, Math.round(((p - floor) / (ceiling - floor)) * 100)));
  return { level: lvl, points: p, floor, ceiling, pct, toNext: Math.max(0, ceiling - p) };
}

export async function getLeaderboard({ scope = 'global', limit: lim = 20 } = {}) {
  if (!firebaseReady || !functions) return { rows: [] };
  try {
    const call = httpsCallable(functions, 'getLeaderboard');
    const res = await call({ scope, limit: lim });
    const rows = (res.data && res.data.rows) || [];
    // Hydrate level locally so the server doesn't need to know thresholds.
    return {
      rows: rows.map((r) => ({ ...r, level: levelFromPoints(r.statsPoints) }))
    };
  } catch (e) {
    console.warn('[community] getLeaderboard failed', e);
    return { rows: [] };
  }
}

export async function getMyStats() {
  if (!firebaseReady || !auth || !auth.currentUser) return null;
  try {
    const snap = await getDoc(doc(db, 'users', auth.currentUser.uid, 'stats', 'aggregate'));
    if (!snap.exists()) {
      return { points: 0, postCount: 0, commentCount: 0, likesReceived: 0, likesGiven: 0, level: 1 };
    }
    const data = snap.data() || {};
    return { ...data, level: levelFromPoints(data.points || 0) };
  } catch (e) {
    return null;
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
    return `<div class="c-avatar" style="${s}"><img src="${escapeHtml(src)}" alt="" loading="lazy"></div>`;
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

// ────────────────────────────────────────────────────────────────
// Phase 3 — Realtime feed, mentions, and notifications.
//
// `subscribeToFeed` opens a bounded onSnapshot listener over the latest
// 20 posts in the active channel, scoped by the caller's role/company.
// Pagination beyond the live window stays one-shot via listPosts() — the
// older pages don't update in real time, which keeps cost flat.
// ────────────────────────────────────────────────────────────────

/**
 * subscribeToFeed({ category, role, companyId }, onChange) → unsubscribe()
 *
 * onChange receives `{ posts, changes }`:
 *   posts   — current array (newest-first), capped at the live window
 *   changes — [{ type: 'added' | 'modified' | 'removed', post, oldIndex }]
 *
 * Owner / company-scoped callers internally run TWO snapshot listeners
 * (company posts + global posts) and merge in JS — same OR-emulation
 * pattern listPosts uses for one-shot fetches.
 */
export function subscribeToFeed({ category = null, role = 'user', companyId = null, pageSize = 20 } = {}, onChange) {
  if (!firebaseReady) {
    if (typeof onChange === 'function') onChange({ posts: [], changes: [] });
    return () => {};
  }

  // Map<postId → post> aggregating all live listeners. Sorted on emit.
  const merged = new Map();
  const includeLegacyAsGeneral = category === 'general';
  let live = true;

  function buildQuery(base) {
    const parts = [base];
    if (category && !includeLegacyAsGeneral) parts.push(where('category', '==', category));
    parts.push(orderBy('createdAt', 'desc'));
    parts.push(limit(pageSize));
    return query(...parts);
  }

  function emit(diffsBatch) {
    if (!live || typeof onChange !== 'function') return;
    const sorted = Array.from(merged.values()).sort((a, b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    onChange({ posts: sorted.slice(0, pageSize), changes: diffsBatch });
  }

  function handleSnap(snap, sourceTag) {
    const changes = [];
    snap.docChanges().forEach((c) => {
      const data = { id: c.doc.id, ...c.doc.data(), _snap: c.doc };
      // Legacy fallback for #general: only include posts where category is
      // missing or === 'general'. Same logic listPosts uses.
      if (includeLegacyAsGeneral && data.category && data.category !== 'general') {
        if (merged.has(data.id)) {
          merged.delete(data.id);
          changes.push({ type: 'removed', post: data, oldIndex: c.oldIndex });
        }
        return;
      }
      if (c.type === 'removed') {
        merged.delete(data.id);
        changes.push({ type: 'removed', post: data, oldIndex: c.oldIndex });
      } else {
        merged.set(data.id, data);
        changes.push({ type: c.type, post: data, oldIndex: c.oldIndex });
      }
    });
    emit(changes);
  }

  const unsubs = [];
  function watch(qry, tag) {
    const u = onSnapshot(
      qry,
      (snap) => handleSnap(snap, tag),
      (err) => console.warn('[community] subscribeToFeed listener error', tag, err)
    );
    unsubs.push(u);
  }

  if (role === 'owner') {
    watch(buildQuery(collection(db, 'posts')), 'all');
  } else if (companyId) {
    watch(buildQuery(query(collection(db, 'posts'), where('companyId', '==', companyId))), 'company');
    watch(buildQuery(query(collection(db, 'posts'), where('companyId', '==', null))), 'global');
  } else {
    watch(buildQuery(query(collection(db, 'posts'), where('companyId', '==', null))), 'global-only');
  }

  return function unsubscribe() {
    live = false;
    unsubs.forEach((u) => { try { u(); } catch (e) {} });
  };
}

// ──────────────── Mentions ────────────────

const MENTION_TOKEN_RE = /@\[([^\]:]+):([^\]]+)\]/g; // @[uid:Display Name]

/**
 * Convert text containing @[uid:Name] tokens into safe HTML with
 * `<a class="c-mention">@Name</a>` substitutions, plus extract the
 * mentioned uids in document order. Pass through linkify for URLs.
 */
export function renderTextWithMentions(text) {
  if (!text) return { html: '', mentionedUids: [] };
  const mentionedUids = [];
  // Step 1: replace tokens with placeholders so escapeHtml doesn't mangle them.
  const placeholders = [];
  const tokenized = String(text).replace(MENTION_TOKEN_RE, (_m, uid, name) => {
    mentionedUids.push(uid);
    const idx = placeholders.length;
    placeholders.push({ uid, name });
    return ` MENTION_${idx} `;
  });
  // Step 2: linkify (which itself escapes), then swap placeholders for anchors.
  let html = linkify(tokenized);
  placeholders.forEach((p, i) => {
    const safeName = escapeHtml(p.name);
    const safeUid = encodeURIComponent(p.uid);
    html = html.replace(
      ` MENTION_${i} `,
      `<a class="c-mention" href="/profile.html?uid=${safeUid}">@${safeName}</a>`
    );
  });
  return { html, mentionedUids };
}

export async function searchMembers(qStr) {
  if (!firebaseReady || !functions || !qStr || !qStr.trim()) return [];
  try {
    const call = httpsCallable(functions, 'searchMembers');
    const res = await call({ query: qStr.trim() });
    return (res.data && res.data.results) || [];
  } catch (e) {
    console.warn('[community] searchMembers failed', e);
    return [];
  }
}

// ──────────────── Notifications ────────────────

/**
 * subscribeToUnreadNotifs(uid, onChange) → unsubscribe()
 *
 * Bounded listener (where read==false, orderBy createdAt desc, limit 20).
 * Backed by the firestore.indexes.json composite index `notifications(read, createdAt)`.
 */
export function subscribeToUnreadNotifs(uid, onChange) {
  if (!firebaseReady || !uid) {
    if (typeof onChange === 'function') onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, 'users', uid, 'notifications'),
    where('read', '==', false),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  const unsub = onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (typeof onChange === 'function') onChange(rows);
  }, (err) => {
    console.warn('[community] subscribeToUnreadNotifs error', err);
    if (typeof onChange === 'function') onChange([]);
  });
  return unsub;
}

export async function markNotifRead(notifId, { read = true } = {}) {
  const user = auth.currentUser;
  if (!user || !notifId) return;
  // Bump the user-doc unreadNotifCount mirror so the bell badge updates
  // even before the listener round-trips. Server-side counts via the
  // notifications subcollection are the source of truth — this mirror is
  // best-effort. Self-write is allowed because we're not touching the
  // mirror count directly here; instead we let the listener re-derive.
  try {
    await updateDoc(
      doc(db, 'users', user.uid, 'notifications', notifId),
      { read: !!read }
    );
  } catch (e) {
    console.warn('[community] markNotifRead failed', e);
  }
}

export async function markAllNotifsRead(unreadIds) {
  const user = auth.currentUser;
  if (!user || !Array.isArray(unreadIds) || !unreadIds.length) return;
  await Promise.all(unreadIds.map((id) =>
    updateDoc(doc(db, 'users', user.uid, 'notifications', id), { read: true })
      .catch(() => {})
  ));
}

/**
 * Fetch the latest N notifications (read + unread) for the current user.
 * Used by the bell popover when the user clicks "see all".
 */
export async function listRecentNotifs({ limit: lim = 20 } = {}) {
  const user = auth.currentUser;
  if (!user || !firebaseReady) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(lim)
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[community] listRecentNotifs failed', e);
    return [];
  }
}
