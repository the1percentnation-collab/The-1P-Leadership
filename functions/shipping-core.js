// Shipping and new-order alerts for anything that goes in the mail (the
// I Can't paperback, sold on its own or in the print bundle). No Firebase,
// no I/O, so tests/shipping.test.cjs can pin every rule without an emulator.
//
// Shipping is one flat US rate, added by Stripe Checkout as its own line so
// the buyer sees it before paying. A product or course record can set
// `shippingCents` to charge something else (0 ships free).

// $5.99 covers USPS Ground Advantage for one paperback anywhere in the US,
// plus the mailer.
const FLAT_SHIPPING_CENTS = 599;

const SHIPPING_LABEL = 'Standard shipping (USPS)';

/** Cents to charge for shipping this product or course record. */
function shippingCentsFor(record) {
  const v = record && record.shippingCents;
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
  return FLAT_SHIPPING_CENTS;
}

/**
 * The Checkout Session fields for an order that ships: a US address, and the
 * shipping charge. Stripe only takes `shipping_options` in payment mode, so a
 * subscription that ships collects the address and adds shipping as a
 * one-time line item on the first invoice instead (see shippingLineItem).
 */
function checkoutShippingFields(record, mode) {
  const fields = { shipping_address_collection: { allowed_countries: ['US'] } };
  if (mode !== 'payment') return fields;
  fields.shipping_options = [{
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: shippingCentsFor(record), currency: 'usd' },
      display_name: SHIPPING_LABEL,
      delivery_estimate: {
        minimum: { unit: 'business_day', value: 3 },
        maximum: { unit: 'business_day', value: 7 }
      }
    }
  }];
  return fields;
}

/** One-time shipping line for a subscription checkout that ships, or null. */
function shippingLineItem(record) {
  const cents = shippingCentsFor(record);
  if (cents <= 0) return null;
  return {
    quantity: 1,
    price_data: { currency: 'usd', unit_amount: cents, product_data: { name: SHIPPING_LABEL } }
  };
}

/** Shipping the buyer paid on a completed Checkout Session, in cents. */
function shippingPaidCents(session) {
  const td = session && session.total_details;
  return (td && Number(td.amount_shipping)) || 0;
}

/**
 * What the item itself sold for, in dollars: the total less shipping and tax.
 * Commissions are paid on this, never on postage.
 */
function merchandiseDollars(session) {
  const total = Number(session && session.amount_total) || 0;
  const tax = Number(session && session.total_details && session.total_details.amount_tax) || 0;
  return Math.max(0, total - shippingPaidCents(session) - tax) / 100;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(cents) {
  return `$${(Math.round(Number(cents) || 0) / 100).toFixed(2)}`;
}

/** Address lines from Stripe's `{ name, address }` shipping shape. */
function addressLines(shipping) {
  if (!shipping) return [];
  const a = shipping.address || {};
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  return [shipping.name, a.line1, a.line2, cityLine, a.country && a.country !== 'US' ? a.country : null]
    .map((x) => (x == null ? '' : String(x).trim()))
    .filter(Boolean);
}

/**
 * The email that tells the owner an order came in.
 *
 * order: { itemName, buyerName, buyerEmail, totalCents, shippingCents,
 *          shipping: { name, address } | null, needsShipping, couponCode,
 *          consoleUrl }
 * returns { subject, text, html }
 */
function orderAlertContent(order) {
  const o = order || {};
  const item = o.itemName || 'Store order';
  const who = o.buyerName || o.buyerEmail || 'a buyer';
  const lines = addressLines(o.shipping);
  const total = money(o.totalCents);
  const ship = money(o.shippingCents);

  let todo;
  if (!o.needsShipping) todo = 'Digital order. Delivered automatically, nothing to ship.';
  else if (lines.length) todo = 'Ready to ship. Mark it sent in the store console once it is in the mail.';
  else todo = 'Needs a shipping address. Stripe did not collect one, so reach out to the buyer.';

  const subject = `New order: ${item} (${total}) from ${who}`;

  const text = [
    `New order: ${item}`,
    '',
    `Buyer: ${o.buyerName || '-'}`,
    `Email: ${o.buyerEmail || '-'}`,
    `Paid: ${total}${o.needsShipping ? ` (includes ${ship} shipping)` : ''}`,
    o.couponCode ? `Promo code: ${o.couponCode}` : null,
    o.needsShipping ? '' : null,
    o.needsShipping ? 'Ship to:' : null,
    ...(o.needsShipping ? (lines.length ? lines : ['(no address collected)']) : []),
    '',
    todo,
    o.consoleUrl ? `\n${o.consoleUrl}` : null
  ].filter((x) => x !== null).join('\n');

  const row = (k, v) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">${esc(k)}</td><td style="padding:4px 0;">${v}</td></tr>`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:0 auto;">
      <h2 style="color:#CC1B1B;margin-bottom:4px;">New order: ${esc(item)}</h2>
      <p style="margin:0 0 16px;color:#666;font-size:13px;">${esc(todo)}</p>
      <table style="font-size:14px;border-collapse:collapse;">
        ${row('Buyer', `<strong>${esc(o.buyerName || '-')}</strong>`)}
        ${row('Email', esc(o.buyerEmail || '-'))}
        ${row('Paid', `<strong>${esc(total)}</strong>${o.needsShipping ? ` <span style="color:#666;">(includes ${esc(ship)} shipping)</span>` : ''}`)}
        ${o.couponCode ? row('Promo code', esc(o.couponCode)) : ''}
        ${o.needsShipping ? row('Ship to', lines.length ? lines.map(esc).join('<br>') : '<em>No address collected</em>') : ''}
      </table>
      ${o.consoleUrl ? `<p style="margin-top:20px;"><a href="${esc(o.consoleUrl)}" style="display:inline-block;background:#CC1B1B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:600;">Open the store console</a></p>` : ''}
    </div>`;

  return { subject, text, html };
}

module.exports = {
  FLAT_SHIPPING_CENTS,
  SHIPPING_LABEL,
  shippingCentsFor,
  checkoutShippingFields,
  shippingLineItem,
  shippingPaidCents,
  merchandiseDollars,
  addressLines,
  orderAlertContent
};
