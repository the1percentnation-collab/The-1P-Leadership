// Hand sales: books (and anything else) Anthony sells himself, outside
// Amazon and outside the site's own checkout. A Facebook Messenger DM, a
// table at an event, a text from a friend.
//
// Pure: no imports, no DOM. The store console (manage-store.js), the invoice
// page (invoice-page.js), and the server (functions/hand-sales-core.js, a
// generated CommonJS copy) all use this one source:
//   node scripts/build-hand-sales-server.cjs
// tests/hand-sales.test.mjs fails if the copies drift.
//
// One order moves through two independent tracks:
//   payment  — unpaid → paid (or comp). Buyers pay through the invoice's
//              Stripe link only; cash or a check handed over in person is
//              marked by hand.
//   delivery — needs-address → new → shipped → done, or cancelled.
// The console's buckets read both, so an order shipped on trust still sits
// in "To collect" until the money arrives.

const CHANNELS = [
  { key: 'facebook', label: 'Facebook Messenger' },
  { key: 'instagram', label: 'Instagram DM' },
  { key: 'text', label: 'Text message' },
  { key: 'phone', label: 'Phone call' },
  { key: 'email', label: 'Email' },
  { key: 'in-person', label: 'In person' },
  { key: 'event', label: 'Event / speaking table' },
  { key: 'other', label: 'Other' }
];

// Legacy keys stay so orders recorded before invoices went Stripe-only still
// read right; the console never offers them for new payments.
const PAYMENT_METHODS = [
  { key: 'card', label: 'Card (invoice link)' },
  { key: 'cashapp', label: 'Cash App', legacy: true },
  { key: 'venmo', label: 'Venmo', legacy: true },
  { key: 'zelle', label: 'Zelle', legacy: true },
  { key: 'paypal', label: 'PayPal', legacy: true },
  { key: 'cash', label: 'Cash' },
  { key: 'check', label: 'Check' },
  { key: 'other', label: 'Other' }
];

const DELIVERY_MODES = [
  { key: 'ship', label: 'Ship it' },
  { key: 'hand', label: 'Hand deliver / pickup' }
];

// Delivery statuses shared with the Stripe-written orders in the same
// collection, so one console works both.
const ORDER_STATUSES = ['needs-address', 'new', 'shipped', 'done', 'cancelled'];

const STOCK_REASONS = [
  { key: 'received', label: 'Received from printer' },
  { key: 'adjust', label: 'Count correction' },
  { key: 'giveaway', label: 'Gave away / promo' },
  { key: 'damaged', label: 'Damaged / lost' },
  { key: 'sold', label: 'Sold (hand sale)' },
  { key: 'returned', label: 'Returned to stock' }
];

const DEFAULT_SETTINGS = {
  businessName: 'The One Percent Nation',
  fromEmail: 'anthonybrown@the1pnation.com',
  web: 'the1pnation.com',
  returnAddress: '',
  defaultShipping: 5,
  dueDays: 3,
  shipWithinDays: 2,
  reviewAfterDays: 10,
  reviewUrl: 'https://a.co/d/0fSUaomu',
  invoiceNote: 'Thank you for supporting the work. Every copy sold by hand is signed.',
  lowStockAt: 5,
  // Local hour for the morning collections email; 0 turns it off.
  digestHour: 8
};

const MAX_ITEMS = 20;
const MAX_QTY = 500;
const MAX_MONEY = 100000;

const DAY = 86400000;

const cents = (n) => Math.round(Number(n || 0) * 100);
const dollars = (c) => Math.round(c) / 100;

function str(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_MONEY) : 0;
}

function formatMoney(n) {
  const v = Number(n || 0);
  return '$' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function labelFor(list, key) {
  const hit = list.find((x) => x.key === key);
  return hit ? hit.label : (key || '');
}

function mergeSettings(saved) {
  const out = { ...DEFAULT_SETTINGS };
  if (saved && typeof saved === 'object') {
    Object.keys(DEFAULT_SETTINGS).forEach((k) => {
      if (saved[k] !== undefined && saved[k] !== null && saved[k] !== '') out[k] = saved[k];
    });
  }
  return out;
}

/** Line totals and the order total, in dollars, rounded through cents. */
function computeTotals({ items = [], shippingFee = 0, discount = 0, tax = 0 } = {}) {
  const sub = items.reduce((s, it) => s + cents(it.unitPrice) * Math.max(0, Math.floor(Number(it.qty) || 0)), 0);
  const ship = cents(shippingFee);
  const disc = Math.min(cents(discount), sub + ship);
  const tx = cents(tax);
  return {
    subtotal: dollars(sub),
    shippingFee: dollars(ship),
    discount: dollars(disc),
    tax: dollars(tx),
    total: dollars(sub + ship - disc + tx)
  };
}

/** `INV-1001` from the counter value. */
function invoiceNumber(n) {
  return 'INV-' + String(Math.max(1, Math.floor(Number(n) || 0))).padStart(4, '0');
}

function hasAddress(shipping) {
  const a = shipping && shipping.address;
  return !!(a && a.line1 && a.city && a.state && a.postal_code);
}

/** Shipping block → printable lines (name, street, city/state/zip). */
function addressLines(shipping) {
  if (!shipping) return [];
  const a = shipping.address || {};
  return [
    shipping.name,
    a.line1,
    a.line2,
    [[a.city, a.state].filter(Boolean).join(', '), a.postal_code].filter(Boolean).join(' '),
    a.country && a.country !== 'US' ? a.country : ''
  ].filter(Boolean);
}

/**
 * Validates console input into the stored order shape. Throws an Error
 * listing every problem at once so the form can show them together.
 * `products` maps productId → { name } for items picked from the catalog.
 */
function normalizeOrder(input = {}, { products = {} } = {}) {
  const errors = [];
  const buyerIn = input.buyer || {};
  const buyer = {
    name: str(buyerIn.name, 120),
    email: str(buyerIn.email, 160).toLowerCase(),
    phone: str(buyerIn.phone, 40),
    handle: str(buyerIn.handle, 160)
  };
  if (!buyer.name) errors.push('Buyer name is required.');
  if (buyer.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(buyer.email)) errors.push('Buyer email does not look right.');

  const channel = CHANNELS.some((c) => c.key === input.channel) ? input.channel : 'other';

  const rawItems = Array.isArray(input.items) ? input.items.slice(0, MAX_ITEMS) : [];
  const items = rawItems.map((it) => {
    const productId = it && it.productId ? str(it.productId, 120) : null;
    const known = productId && products[productId];
    return {
      productId: known ? productId : null,
      name: str((it && it.name) || (known && known.name), 160),
      qty: Math.min(MAX_QTY, Math.max(0, Math.floor(Number(it && it.qty) || 0))),
      unitPrice: money(it && it.unitPrice),
      note: str(it && it.note, 300)
    };
  }).filter((it) => it.name && it.qty > 0);
  if (!items.length) errors.push('Add at least one item with a quantity.');

  const delivery = input.delivery === 'hand' ? 'hand' : 'ship';
  const shipIn = input.shipping || {};
  const addrIn = shipIn.address || {};
  const shipping = delivery === 'ship' ? {
    name: str(shipIn.name || buyer.name, 120),
    address: {
      line1: str(addrIn.line1, 160),
      line2: str(addrIn.line2, 160),
      city: str(addrIn.city, 80),
      state: str(addrIn.state, 40).toUpperCase(),
      postal_code: str(addrIn.postal_code, 20),
      country: str(addrIn.country || 'US', 2).toUpperCase()
    }
  } : null;

  const totals = computeTotals({
    items,
    shippingFee: delivery === 'ship' ? money(input.shippingFee) : 0,
    discount: money(input.discount),
    tax: money(input.tax)
  });

  const payIn = input.payment || {};
  const payStatus = payIn.status === 'paid' || payIn.status === 'comp' ? payIn.status : 'unpaid';
  const payment = {
    status: totals.total === 0 && payStatus === 'unpaid' ? 'comp' : payStatus,
    method: PAYMENT_METHODS.some((m) => m.key === payIn.method) ? payIn.method : null,
    reference: str(payIn.reference, 160)
  };
  if (payment.status === 'paid' && !payment.method) errors.push('Pick how they paid.');

  if (errors.length) {
    const e = new Error(errors.join(' '));
    e.errors = errors;
    throw e;
  }

  return {
    buyer,
    channel,
    items,
    delivery,
    shipping,
    ...totals,
    amountTotal: totals.total,
    payment,
    giftMessage: str(input.giftMessage, 500),
    notes: str(input.notes, 2000)
  };
}

/** Delivery status a new or edited order should sit in. */
function deliveryStatus(order) {
  if (!order) return 'new';
  if (order.status === 'cancelled' || order.status === 'shipped' || order.status === 'done') return order.status;
  if (order.delivery === 'ship' && !hasAddress(order.shipping)) return 'needs-address';
  return 'new';
}

function isPaid(order) {
  if (!order) return false;
  if (order.kind !== 'manual') return true; // Stripe checkout orders arrive paid
  const p = order.payment || {};
  return p.status === 'paid' || p.status === 'comp';
}

/**
 * The console's piles, in the order Anthony should work them.
 *   collect   — money still owed
 *   address   — paid but no address to ship to yet
 *   ship      — paid, has an address (or hand delivery), not out the door
 *   shipped   — on its way
 *   done      — delivered
 *   cancelled
 */
const BUCKETS = [
  { key: 'collect', label: 'To collect' },
  { key: 'address', label: 'Needs address' },
  { key: 'ship', label: 'To ship' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'done', label: 'Done' },
  { key: 'cancelled', label: 'Cancelled' }
];

function orderBucket(order) {
  if (!order) return 'done';
  if (order.status === 'cancelled') return 'cancelled';
  if (!isPaid(order)) return 'collect';
  if (order.status === 'done') return 'done';
  if (order.status === 'shipped') return 'shipped';
  if (order.status === 'needs-address') return 'address';
  return 'ship';
}

/**
 * Units each catalog product loses to an order while it is live. A cancelled
 * order holds none, so cancelling returns its copies to the shelf.
 */
function stockHeld(order) {
  const out = {};
  if (!order || order.status === 'cancelled') return out;
  (order.items || []).forEach((it) => {
    if (!it.productId) return;
    out[it.productId] = (out[it.productId] || 0) + (Number(it.qty) || 0);
  });
  return out;
}

/** productId → change in on-hand stock when an order goes from `before` to `after`. */
function stockDelta(before, after) {
  const was = stockHeld(before);
  const now = stockHeld(after);
  const out = {};
  new Set([...Object.keys(was), ...Object.keys(now)]).forEach((id) => {
    const d = (was[id] || 0) - (now[id] || 0);
    if (d) out[id] = d;
  });
  return out;
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

function itemSummary(order) {
  const items = (order && order.items) || [];
  if (!items.length) return 'order';
  const first = items[0];
  const rest = items.length - 1;
  return `${first.qty > 1 ? first.qty + '× ' : ''}${first.name}${rest > 0 ? ` +${rest} more` : ''}`;
}

/**
 * The reminders an order should have open right now, keyed by kind. The
 * server reconciles this against the CRM tasks it already made: anything
 * listed and missing is created, anything open and no longer listed is
 * completed. Due dates come from `now` and the settings, so they read as
 * "two days from when this became your job".
 */
function taskPlan(order, settings = DEFAULT_SETTINGS, now = Date.now()) {
  const s = mergeSettings(settings);
  const plan = {};
  if (!order || order.status === 'cancelled') return plan;
  const who = order.buyer && order.buyer.name ? order.buyer.name : 'buyer';
  const inv = order.invoiceNumber ? ` (${order.invoiceNumber})` : '';
  const what = itemSummary(order);

  if (!isPaid(order)) {
    plan.collect = {
      title: `Collect ${formatMoney(order.amountTotal)} from ${who}${inv}`,
      dueAt: now + Number(s.dueDays) * DAY,
      priority: 'high'
    };
  }
  if (order.status === 'needs-address') {
    plan.address = {
      title: `Get a shipping address from ${who}${inv}`,
      dueAt: now + DAY,
      priority: 'high'
    };
  }
  if (isPaid(order) && order.status === 'new') {
    plan.ship = {
      title: `${order.delivery === 'hand' ? 'Deliver' : 'Ship'} ${what} to ${who}${inv}`,
      dueAt: now + Number(s.shipWithinDays) * DAY,
      priority: 'high'
    };
  }
  // The review ask is the hand sale's second dividend: a signed copy in a
  // reader's hands is the most likely Amazon review there is.
  if (order.status === 'shipped' || order.status === 'done') {
    if (!order.reviewAskedAt) {
      plan.review = {
        title: `Ask ${who} how the book is landing (and for an Amazon review)${inv}`,
        dueAt: now + Number(s.reviewAfterDays) * DAY,
        priority: 'normal'
      };
    }
  }
  return plan;
}

/** Ready-to-paste message for the channel the order came in on. */
function invoiceMessage(order, url) {
  const hi = firstName(order.buyer && order.buyer.name);
  const lines = [
    `${hi ? `Hey ${hi}` : 'Hey'}! Thank you for ordering ${itemSummary(order)}.`,
    `Here is your invoice for ${formatMoney(order.amountTotal)}: ${url}`,
    'You can pay by card right on that page.'
  ];
  if (order.delivery === 'ship' && !hasAddress(order.shipping)) {
    lines.push('Send me the address you want it shipped to and I will get it out to you.');
  } else if (order.delivery === 'ship') {
    lines.push('As soon as it is paid I will sign it and get it in the mail.');
  }
  return lines.join('\n\n');
}

// Follow-ups on an invoice that went out and was not paid. "Due" means it
// has sat quiet (no send, no reminder) for the same dueDays the collect task
// uses, so the card and Tasks agree on when to nudge.
const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis()
  : (typeof t === 'number' ? t : (t instanceof Date ? t.getTime() : null)));

function lastNudgeMs(order) {
  const last = Math.max(toMs(order && order.invoiceSentAt) || 0, toMs(order && order.remindedAt) || 0);
  return last || null;
}

function reminderDue(order, settings = DEFAULT_SETTINGS, now = Date.now()) {
  if (!order || order.kind !== 'manual' || order.status === 'cancelled' || isPaid(order)) return false;
  const last = lastNudgeMs(order);
  return last != null && now - last >= Number(mergeSettings(settings).dueDays) * DAY;
}

function reminderMessage(order, url) {
  const hi = firstName(order.buyer && order.buyer.name);
  const lines = [
    `${hi ? `Hey ${hi}` : 'Hey'}, circling back on your order of ${itemSummary(order)}.`,
    `Your invoice for ${formatMoney(order.amountTotal)} is still open here: ${url}`,
    'It takes about a minute by card.'
  ];
  if (order.delivery === 'ship' && !hasAddress(order.shipping)) {
    lines.push('Send me the address you want it shipped to as well, and I will get it signed and out to you.');
  } else if (order.delivery === 'ship') {
    lines.push('As soon as it clears I will sign it and get it in the mail.');
  }
  return lines.join('\n\n');
}

/**
 * What the morning collections email lists: invoices due a reminder (quiet
 * longest first), invoices never sent (oldest first), what is owed, and how
 * many paid orders are waiting to ship. `empty` means no email is needed.
 */
function collectionsDigest(orders, settings = DEFAULT_SETTINGS, now = Date.now()) {
  const s = mergeSettings(settings);
  const manual = (orders || []).filter((o) => o && o.kind === 'manual');
  const open = manual.filter((o) => o.status !== 'cancelled' && !isPaid(o));
  const remind = open.filter((o) => reminderDue(o, s, now))
    .sort((a, b) => lastNudgeMs(a) - lastNudgeMs(b))
    .map((o) => ({ order: o, quietDays: Math.floor((now - lastNudgeMs(o)) / DAY) }));
  const unsent = open.filter((o) => !lastNudgeMs(o))
    .sort((a, b) => (toMs(a.createdAt) || 0) - (toMs(b.createdAt) || 0))
    .map((o) => ({ order: o, ageDays: toMs(o.createdAt) ? Math.floor((now - toMs(o.createdAt)) / DAY) : 0 }));
  const owed = dollars(open.reduce((c, o) => c + cents(o.amountTotal), 0));
  const toShip = manual.filter((o) => orderBucket(o) === 'ship').length;
  return { remind, unsent, owed, owedCount: open.length, toShip, empty: !remind.length && !unsent.length };
}

// Links that put the invoice back where the buyer is talking to Anthony.
// smsLink opens his own Messages app with the text filled in (sms: works on
// iPhone, Mac and Android); dmLink opens their Messenger or Instagram thread
// from the profile saved on the order. Both return null when there is
// nothing to address.
function smsLink(phone, body) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  const to = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return `sms:${to}?&body=${encodeURIComponent(body || '')}`;
}

const FB_NOT_PROFILES = /^(messages|groups|pages|marketplace|people|share|events|watch|photo\.php|permalink\.php)$/i;

function dmLink(order) {
  const raw = String((order && order.buyer && order.buyer.handle) || '').trim();
  if (!raw) return null;
  const fbId = raw.match(/(?:facebook|fb)\.com\/profile\.php\?(?:[^#]*&)?id=(\d+)/i);
  if (fbId) return { app: 'Messenger', url: `https://www.facebook.com/messages/t/${fbId[1]}` };
  const fb = raw.match(/(?:facebook|fb|m\.me)(?:\.com)?\/([A-Za-z0-9.]+)/i);
  if (fb && !FB_NOT_PROFILES.test(fb[1])) return { app: 'Messenger', url: `https://m.me/${fb[1]}` };
  const ig = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i)
    || (order.channel === 'instagram' ? raw.match(/^@?([A-Za-z0-9._]{1,30})$/) : null);
  if (ig) return { app: 'Instagram', url: `https://ig.me/m/${ig[1]}` };
  return null;
}

function shippedMessage(order) {
  const hi = firstName(order.buyer && order.buyer.name);
  const t = order.tracking || {};
  const track = t.number ? ` Tracking${t.carrier ? ` (${t.carrier})` : ''}: ${t.number}` : '';
  return `${hi ? `Hey ${hi}` : 'Hey'}! Your ${itemSummary(order)} is signed and on the way.${track}\n\nWhen you dig in, let me know what hits hardest.`;
}

function reviewMessage(order, settings = DEFAULT_SETTINGS) {
  const s = mergeSettings(settings);
  const hi = firstName(order.buyer && order.buyer.name);
  return `${hi ? `Hey ${hi}` : 'Hey'}, checking in. How is the book landing so far?\n\nIf it is helping, a quick review on Amazon puts it in front of the next person who needs it: ${s.reviewUrl}`;
}

/**
 * Payment options to print on an invoice. Stripe card checkout is the only
 * way buyers pay, so this is the card option or nothing (Stripe not set up,
 * or a total under Stripe's minimum).
 */
function paymentOptions(_settings, _order, { cardEnabled = true } = {}) {
  return cardEnabled ? [{ key: 'card', label: 'Card', handle: '' }] : [];
}

function lowStock(onHand, settings = DEFAULT_SETTINGS, reorderAt = null) {
  const at = reorderAt != null && reorderAt !== '' ? Number(reorderAt) : Number(mergeSettings(settings).lowStockAt);
  return typeof onHand === 'number' && onHand <= at;
}

/**
 * Dashboard numbers for the Orders tab header: what is owed, what is waiting
 * to go out, and what came in this month.
 */
function summarize(orders, now = Date.now()) {
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const out = { owed: 0, owedCount: 0, toShip: 0, needsAddress: 0, monthRevenue: 0, monthUnits: 0 };
  (orders || []).forEach((o) => {
    const b = orderBucket(o);
    if (b === 'collect') { out.owed += Number(o.amountTotal || 0); out.owedCount++; }
    if (b === 'ship') out.toShip++;
    if (b === 'address') out.needsAddress++;
    const created = typeof o.createdAtMs === 'number' ? o.createdAtMs : null;
    if (created != null && created >= monthStart && o.status !== 'cancelled' && isPaid(o)) {
      out.monthRevenue += Number(o.amountTotal || 0);
      out.monthUnits += (o.items || []).reduce((n, it) => n + (Number(it.qty) || 0), 0) || 1;
    }
  });
  out.owed = Math.round(out.owed * 100) / 100;
  out.monthRevenue = Math.round(out.monthRevenue * 100) / 100;
  return out;
}

const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR'
};

/**
 * Best-effort split of an address pasted out of a DM, one line or several:
 *   "Jane Doe\n123 Main St Apt 4\nDallas, TX 75201"
 *   "123 Main St, Apt 4, Dallas, Texas 75201, USA"
 * Returns the shipping shape with whatever it could find; the form shows
 * the fields so anything it missed gets typed in.
 */
function parseAddress(text) {
  let s = String(text || '')
    .replace(/\r/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean).join(', ')
    .replace(/\s+/g, ' ')
    .replace(/,\s*,/g, ',')
    .replace(/,?\s*(USA|U\.S\.A\.|United States( of America)?|US)\.?\s*$/i, '')
    .trim();
  const out = { name: '', address: { line1: '', line2: '', city: '', state: '', postal_code: '', country: 'US' } };
  if (!s) return out;

  const zip = s.match(/[\s,](\d{5})(?:-\d{4})?\s*$/) || s.match(/^(\d{5})(?:-\d{4})?$/);
  if (zip) {
    out.address.postal_code = zip[1];
    s = s.slice(0, zip.index).replace(/[\s,]+$/, '');
  }

  const names = Object.keys(US_STATES).sort((a, b) => b.length - a.length).join('|');
  const st = s.match(new RegExp(`(?:^|[\\s,])(${names}|[A-Za-z]{2})\\.?$`, 'i'));
  if (st) {
    const raw = st[1].toLowerCase();
    const code = US_STATES[raw] || (Object.values(US_STATES).includes(raw.toUpperCase()) ? raw.toUpperCase() : '');
    if (code) {
      out.address.state = code;
      s = s.slice(0, st.index).replace(/[\s,]+$/, '');
    }
  }

  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) out.address.city = parts.pop();
  if (parts.length >= 2 && !/\d/.test(parts[0])) out.name = parts.shift();
  out.address.line1 = parts.shift() || '';
  out.address.line2 = parts.join(', ');
  return out;
}

export {
  CHANNELS, PAYMENT_METHODS, DELIVERY_MODES, ORDER_STATUSES, STOCK_REASONS, BUCKETS, DEFAULT_SETTINGS,
  formatMoney, labelFor, mergeSettings, computeTotals, invoiceNumber, hasAddress, addressLines,
  normalizeOrder, deliveryStatus, isPaid, orderBucket, stockHeld, stockDelta, firstName, itemSummary,
  taskPlan, invoiceMessage, reminderMessage, reminderDue, lastNudgeMs, collectionsDigest, smsLink, dmLink, shippedMessage, reviewMessage, paymentOptions, lowStock, summarize, parseAddress
};
