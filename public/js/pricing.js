// Price display — one answer for "what does this cost, and what do we show?"
//
// Lifted out of courses-data.js so products can use the identical rule. Free
// of Firebase imports so it can be tested directly.
//
// A sale is a price condition, not a lifecycle state: an item is on sale when
// it has a sale price below its price AND the sale has not ended. `saleEndsAt`
// is optional — null means open-ended — so a sale can close itself on a date
// without anyone touching the item.

export function fmtMoney(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.toDate === 'function') { const d = v.toDate(); return isNaN(d.getTime()) ? null : d.getTime(); }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** Has this item's sale ended? False when there is no end date. */
export function saleEnded(item, { now = Date.now() } = {}) {
  const ends = toMs(item && item.saleEndsAt);
  return ends != null && ends <= now;
}

/**
 * Resolves what to show (and what to charge) for a course or a product:
 *   { label, originalLabel, onSale, amount, isFree, isSubscription,
 *     intervalSuffix, saleEndsAtMs }
 * `amount` is the effective price in dollars (sale price when on sale).
 *
 * Products have no `pricing` map or `priceLabel`, and both are optional here,
 * so the same call works for either kind.
 */
export function priceInfo(item, { now = Date.now() } = {}) {
  const base = typeof item.price === 'number' ? item.price : null;
  const sale = typeof item.salePrice === 'number' && item.salePrice >= 0
    ? item.salePrice : null;
  const onSale = sale != null && base != null && sale < base && !saleEnded(item, { now });
  const amount = onSale ? sale : base;

  const isSubscription = !!(item.pricing && item.pricing.mode === 'subscription');
  const interval = isSubscription ? (item.pricing.interval || 'month') : null;
  const intervalSuffix = interval ? (interval === 'year' ? '/yr' : '/mo') : '';

  // A one-time price of zero reads "Free", not "$0". A $0 subscription keeps
  // its number so the interval still shows, but a membership on sale for $0
  // reads "Free" next to the struck-through regular price.
  const money = (n) => (n === 0 && !isSubscription ? 'Free' : fmtMoney(n) + intervalSuffix);
  const baseLabel = item.priceLabel || (base != null ? money(base) : '');
  const label = onSale ? (sale === 0 ? 'Free' : money(sale)) : baseLabel;

  return {
    label,
    originalLabel: onSale ? baseLabel : null,
    onSale,
    amount,
    isFree: amount === 0,
    isSubscription,
    intervalSuffix,
    saleEndsAtMs: toMs(item.saleEndsAt)
  };
}

/**
 * The line under the price while a membership is free to join. Anyone who
 * joins during the sale is enrolled with no subscription, so they keep it for
 * good; the regular plan is spelled out so visitors see what they
 * are getting for free. Null when the item isn't a free membership sale.
 */
export function freeJoinNote(item, { now = Date.now() } = {}) {
  const p = priceInfo(item, { now });
  if (!(p.onSale && p.isFree && p.isSubscription)) return null;
  const annual = Number(item.pricing && item.pricing.annualPrice);
  const regular = p.originalLabel + (Number.isFinite(annual) && annual > 0 ? ` or ${fmtMoney(annual)}/yr` : '');
  if (p.saleEndsAtMs == null) return `Free to join for now, and free for good once you are in. Regularly ${regular}.`;
  const by = new Date(p.saleEndsAtMs).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return `Join by ${by} and it stays free for you for good. After that it is ${regular}.`;
}
