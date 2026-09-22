// The catalog contract — one shape for a course and a product.
//
// Courses and products were published through two models that disagreed
// about everything: what "visible" meant, where a sale price lived, whether
// a launch date existed. Every surface that showed both had to know both.
// This normalises either into one CatalogItem, and every surface reads that.
//
// Pure: no Firebase imports, so it can be tested directly. catalog.js is the
// thin loader that fetches the raw docs and hands them here.
//
// Field semantics, shared by both collections (see the plan's contract):
//   status            lifecycle, normalised to live | coming-soon | preorder | hidden
//   showOnSite        main-site channel, default-true opt-out
//   showInDashboard   member-store channel, default-true opt-out
//   launchDate        when a coming-soon / pre-order item opens
//   salePrice         on sale while < price and saleEndsAt has not passed
//   sellable          false = only reachable inside a bundle; never listed alone

import { priceInfo } from './pricing.js';
import { launchDateMs, hasLaunched } from './launch-date.js';

const PRODUCT_STATUS = {
  planned: 'hidden',
  archived: 'hidden',
  interest: 'coming-soon',
  preorder: 'preorder',
  live: 'live'
};

// A course marked 'bundle' is a buyable offer, so it reads as live with the
// bundle flag set; 'inactive' is the one state that hides a course everywhere.
//
// 'beta' is live content with no public face: the people testing it are
// enrolled, and everyone else must not see it exist. It normalizes to
// 'hidden' so every catalog surface (homepage, store, dashboard listings)
// drops it, exactly like 'inactive'. What separates the two is the member
// library, which reads enrollments rather than the catalog: an inactive
// course closes for its own students, a beta course stays open for them.
const COURSE_STATUS = {
  live: 'live',
  'coming-soon': 'coming-soon',
  beta: 'hidden',
  inactive: 'hidden',
  bundle: 'live'
};

const TYPE_LABELS = {
  course: 'Course',
  book: 'Book',
  physical: 'Merch',
  service: 'Service',
  other: 'Product'
};

function str(v) { return v == null ? '' : String(v); }

function base(kind, raw, { now }) {
  const p = priceInfo(raw, { now });
  return {
    kind,
    raw,
    price: typeof raw.price === 'number' ? raw.price : null,
    salePrice: typeof raw.salePrice === 'number' ? raw.salePrice : null,
    onSale: p.onSale,
    label: p.label,
    originalLabel: p.originalLabel,
    isFree: p.isFree,
    saleEndsAtMs: p.saleEndsAtMs,
    launchDateMs: launchDateMs(raw),
    showOnSite: raw.showOnSite !== false,
    showInDashboard: raw.showInDashboard !== false,
    sellable: raw.sellable !== false,
    sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : 999
  };
}

export function normalizeCourse(c, { now = Date.now() } = {}) {
  if (!c || !c.slug) return null;
  const isBundle = c.kind === 'bundle' || c.status === 'bundle' || !!c.bundleHref;
  return {
    ...base('course', c, { now }),
    id: c.slug,
    slug: c.slug,
    title: str(c.title || c.slug),
    summary: str(c.short || c.subtitle || ''),
    category: str(c.category || 'Course'),
    // The builder writes `coverImage`; a few older records carry `image`.
    imageUrl: c.coverImage || c.image || c.imageUrl || null,
    videoUrl: null,
    posterUrl: null,
    status: COURSE_STATUS[c.status] || 'coming-soon',
    isBundle,
    bundleHref: c.bundleHref || null,
    externalUrl: null,
    inventory: null,
    soldOut: false,
    interestCount: 0
  };
}

export function normalizeProduct(p, { now = Date.now() } = {}) {
  if (!p || !p.id) return null;
  const inventory = typeof p.inventory === 'number' ? p.inventory : null;
  return {
    ...base('product', p, { now }),
    id: p.id,
    slug: p.slug || p.id,
    title: str(p.name || 'Untitled product'),
    summary: str(p.summary || ''),
    category: TYPE_LABELS[p.type] || TYPE_LABELS.other,
    productType: p.type || 'other',
    imageUrl: p.imageUrl || null,
    videoUrl: p.videoUrl || null,
    posterUrl: p.posterUrl || null,
    status: PRODUCT_STATUS[p.status] || 'hidden',
    isBundle: false,
    bundleHref: null,
    externalUrl: p.externalUrl || null,
    inventory,
    soldOut: inventory != null && inventory <= 0,
    interestCount: Number(p.interestCount || 0)
  };
}

/** Is this item on sale right now? A synonym for the normalised flag. */
export function isOnSale(item, { now = Date.now() } = {}) {
  if (!item) return false;
  return priceInfo(item.raw || item, { now }).onSale;
}

/**
 * Should this item appear on a channel?
 *
 * Hidden never shows anywhere. `sellable: false` marks a course sold only
 * inside a bundle — it must not be listed on its own on either channel; the
 * bundle is. Each channel then has its own switch.
 */
export function visibleOn(item, channel) {
  if (!item || item.status === 'hidden' || item.sellable === false) return false;
  if (channel === 'site') return item.showOnSite !== false;
  if (channel === 'dashboard') return item.showInDashboard !== false;
  return false;
}

/**
 * Where a card should send the visitor.
 *
 * Products have no page of their own, so a product without an off-site link
 * goes to its anchor on the public products page. A course goes to its sales
 * page on the marketing site and to the member library in the dashboard —
 * the library handles both "open my course" and "buy this" for a member.
 */
export function hrefFor(item, channel, { enrolled = false } = {}) {
  if (!item) return '/';
  if (item.kind === 'product') {
    if (item.externalUrl) return item.externalUrl;
    return `/upcoming.html#p-${encodeURIComponent(item.id)}`;
  }
  const slug = encodeURIComponent(item.slug);
  if (item.isBundle && item.bundleHref && item.status === 'live') return item.bundleHref;
  if (channel === 'dashboard' && (enrolled || item.status === 'live')) return `/courses.html?course=${slug}`;
  return `/course.html?course=${slug}`;
}

/** Does the href leave the site? Decides target="_blank". */
export function isExternal(href) {
  return /^https?:\/\//i.test(String(href || ''));
}

/**
 * The action a card offers, as data: { kind, label }.
 *   open     — a course the member holds
 *   buy      — live and purchasable on-site (Stripe)
 *   external — live with an off-site link
 *   notify   — not open yet; join the waitlist
 *   view     — live but not purchasable here (e.g. a course from the site)
 */
export function ctaFor(item, { enrolled = false } = {}) {
  if (!item) return { kind: 'view', label: 'View' };
  if (item.kind === 'course' && enrolled) return { kind: 'open', label: 'Open course' };
  if (item.status === 'coming-soon') return { kind: 'notify', label: 'Notify me' };
  if (item.kind === 'product') {
    if (item.externalUrl) return { kind: 'external', label: item.status === 'preorder' ? 'Pre-order' : 'Get it' };
    if (item.soldOut) return { kind: 'soldout', label: 'Sold out' };
    if (item.sellable && item.price > 0) return { kind: 'buy', label: item.status === 'preorder' ? 'Pre-order' : 'Buy now' };
    return { kind: 'notify', label: 'Notify me' };
  }
  return { kind: 'view', label: item.isFree ? 'Enroll free' : 'Enroll now' };
}

/**
 * The next item to open on a channel: the soonest launch date that has not
 * arrived, among items announced on that channel. Coming-soon and pre-order
 * both count — a pre-order's date is its ship date.
 */
export function nextLaunch(items, { channel = 'site', now = Date.now() } = {}) {
  const c = (items || [])
    .filter((i) => i && (i.status === 'coming-soon' || i.status === 'preorder') && visibleOn(i, channel))
    .filter((i) => i.launchDateMs != null && !hasLaunched(i.launchDateMs, { now }))
    .sort((a, b) => a.launchDateMs - b.launchDateMs);
  return c[0] ? { item: c[0], ms: c[0].launchDateMs } : null;
}

/** The store's filter tabs. `all` keeps everything visible on the channel. */
export function filterByTab(items, tab) {
  const list = items || [];
  if (tab === 'live') return list.filter((i) => i.status === 'live' || i.status === 'preorder');
  if (tab === 'coming-soon') return list.filter((i) => i.status === 'coming-soon');
  if (tab === 'on-sale') return list.filter((i) => i.onSale);
  return list;
}

/** Stable display order: live before coming soon, then the owner's sortOrder. */
export function sortForDisplay(items) {
  const rank = { live: 0, preorder: 1, 'coming-soon': 2, hidden: 3 };
  return (items || []).slice().sort((a, b) =>
    (rank[a.status] - rank[b.status])
    || (a.sortOrder - b.sortOrder)
    || a.title.localeCompare(b.title));
}
