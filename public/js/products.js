// Products data layer — generic pre-order / interest items (top-level
// `products` collection). Public reads visible products; admins manage them.
// Interest/early-access signups + launch notify go through Cloud Functions.

import { app, auth, db, functions, firebaseReady } from './firebase.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc,
  collection, query, where, orderBy, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// Lazy storage (only pages that upload pay the cost).
let _storage = null;
function storage() {
  if (!_storage && firebaseReady) _storage = getStorage(app);
  return _storage;
}

// Upload a product image to Storage and return its public download URL.
export async function uploadProductImage(file) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const s = storage();
  if (!s) throw new Error('Storage unavailable');
  const ext = (file.name.match(/\.(\w+)$/) || [, 'jpg'])[1].toLowerCase();
  const safe = `${Date.now()}.${ext}`;
  const r = storageRef(s, `product-images/${user.uid}/${safe}`);
  await uploadBytes(r, file, { contentType: file.type || 'image/jpeg' });
  return await getDownloadURL(r);
}

export const PRODUCT_TYPES = ['course', 'book', 'physical', 'service', 'other'];
export const PRODUCT_STATUSES = ['planned', 'interest', 'preorder', 'live', 'archived'];
export const VISIBLE_STATUSES = ['interest', 'preorder', 'live'];

// What the admin sees. The stored values stay as they are — the read rule in
// firestore.rules, VISIBLE_STATUSES, the owner digest and affiliate.js all
// match on them — so only the words change. 'interest' has always meant
// "announced, not yet buyable", which is what everyone else calls coming soon.
export const STATUS_LABELS = {
  planned: 'Draft',
  interest: 'Coming soon',
  preorder: 'Pre-order',
  live: 'Live',
  archived: 'Archived'
};

// A date field arrives from a <input type="date"> as "YYYY-MM-DD" (local, no
// zone), from Firestore as a Timestamp, or from code as a Date. Only a Date
// or null is ever stored, at local midnight — see launch-date.js for why a
// date-only string must never be parsed with new Date(str).
function toStoredDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}

function toUrlOrNull(v) {
  const s = (v == null ? '' : String(v)).trim();
  return s || null;
}

function productsCol() { return collection(db, 'products'); }
function productRef(id) { return doc(db, 'products', id); }

// Public: products visitors may see (interest/preorder/live).
export async function listVisibleProducts() {
  if (!firebaseReady) return [];
  try {
    const snap = await getDocs(query(productsCol(), where('status', 'in', VISIBLE_STATUSES)));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    return rows;
  } catch (e) { console.warn('[products] listVisible failed', e); return []; }
}

// Admin: every product.
export async function listAllProducts() {
  if (!firebaseReady) return [];
  try {
    const snap = await getDocs(productsCol());
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    return rows;
  } catch (e) { console.warn('[products] listAll failed', e); return []; }
}

export async function getProduct(id) {
  if (!firebaseReady || !id) return null;
  const snap = await getDoc(productRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createProduct(data = {}) {
  const payload = {
    name: (data.name || '').trim() || 'Untitled product',
    slug: (data.slug || '').trim() || null,
    type: PRODUCT_TYPES.includes(data.type) ? data.type : 'other',
    status: PRODUCT_STATUSES.includes(data.status) ? data.status : 'planned',
    summary: data.summary || null,
    description: data.description || null,
    imageUrl: data.imageUrl || null,
    price: data.price === '' || data.price == null ? null : Number(data.price),
    sellable: data.sellable === true,
    requiresShipping: data.requiresShipping != null ? !!data.requiresShipping : data.type === 'physical',
    inventory: data.inventory === '' || data.inventory == null ? null : Number(data.inventory),
    preorderMode: ['interest', 'deposit', 'prepay'].includes(data.preorderMode) ? data.preorderMode : 'interest',
    depositAmount: data.depositAmount ? Number(data.depositAmount) : null,
    sortOrder: Number(data.sortOrder) || 0,
    // The publishing contract, shared with courses/{slug}. Channels are
    // default-true opt-outs so an existing product needs no backfill; the
    // rest are null until set. `launchAt` used to sit here, written as null
    // and never read by anything — `launchDate` replaces it, same name as
    // the course field so launch-date.js reads both.
    showOnSite: data.showOnSite !== false,
    showInDashboard: data.showInDashboard !== false,
    launchDate: toStoredDate(data.launchDate),
    salePrice: data.salePrice === '' || data.salePrice == null ? null : Number(data.salePrice),
    saleEndsAt: toStoredDate(data.saleEndsAt),
    externalUrl: toUrlOrNull(data.externalUrl),
    videoUrl: toUrlOrNull(data.videoUrl),
    posterUrl: toUrlOrNull(data.posterUrl),
    interestCount: 0,
    preorderCount: 0,
    depositTotal: 0,
    launchNotifiedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = await addDoc(productsCol(), payload);
  return { id: ref.id, ...payload };
}

export async function updateProduct(id, patch = {}) {
  const allowed = ['name', 'slug', 'type', 'status', 'summary', 'description', 'imageUrl',
    'price', 'sellable', 'requiresShipping', 'inventory',
    'preorderMode', 'depositAmount', 'sortOrder',
    'showOnSite', 'showInDashboard', 'launchDate', 'salePrice', 'saleEndsAt',
    'externalUrl', 'videoUrl', 'posterUrl'];
  const clean = {};
  allowed.forEach((k) => {
    if (patch[k] === undefined) return;
    if (k === 'price' || k === 'depositAmount' || k === 'inventory' || k === 'salePrice') {
      clean[k] = patch[k] === '' || patch[k] == null ? null : Number(patch[k]);
    } else if (k === 'sellable' || k === 'requiresShipping' || k === 'showOnSite' || k === 'showInDashboard') {
      clean[k] = !!patch[k];
    } else if (k === 'launchDate' || k === 'saleEndsAt') {
      clean[k] = toStoredDate(patch[k]);
    } else if (k === 'externalUrl' || k === 'videoUrl' || k === 'posterUrl') {
      clean[k] = toUrlOrNull(patch[k]);
    } else if (k === 'sortOrder') {
      clean[k] = Number(patch[k]) || 0;
    } else {
      clean[k] = patch[k];
    }
  });
  clean.updatedAt = serverTimestamp();
  await updateDoc(productRef(id), clean);
}

export async function deleteProduct(id) { await deleteDoc(productRef(id)); }

// Admin: read a product's interest list.
export async function listInterests(productId) {
  if (!firebaseReady || !productId) return [];
  try {
    const snap = await getDocs(collection(db, 'products', productId, 'interests'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('[products] listInterests failed', e); return []; }
}

// Public callables.
export async function registerInterest(productId, { name, email, phone, consent }) {
  const call = httpsCallable(functions, 'registerProductInterest');
  const res = await call({ productId, name, email, phone, consent });
  return res.data || { ok: true };
}
export async function joinEarlyAccess({ name, email, consent }) {
  const call = httpsCallable(functions, 'joinEarlyAccess');
  const res = await call({ name, email, consent });
  return res.data || { ok: true };
}
export async function notifyLaunch(productId) {
  const call = httpsCallable(functions, 'notifyProductInterest');
  const res = await call({ productId });
  return res.data || { ok: true };
}

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function fmtMoney(n) {
  const v = Number(n);
  if (!isFinite(v) || !v) return null;
  try { return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }); }
  catch (e) { return '$' + Math.round(v); }
}
