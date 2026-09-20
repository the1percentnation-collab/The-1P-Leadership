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

  const baseLabel = item.priceLabel || (base != null ? fmtMoney(base) + intervalSuffix : '');
  const label = onSale ? fmtMoney(sale) + intervalSuffix : baseLabel;

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
