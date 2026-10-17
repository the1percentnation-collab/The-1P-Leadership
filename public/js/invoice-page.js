// Invoice (/invoice?i=<orderId>&t=<token>): what a hand-sale buyer opens
// from the link Anthony pastes into Messenger (or emails).
//
// The link's token is the only key. The page never reads Firestore: it asks
// getInvoice for the buyer's view of the order, and payInvoice for a Stripe
// Checkout when they pay by card. The webhook marks the order paid; this
// page only shows it. Printing saves the invoice as a PDF.

import { formatMoney, addressLines, labelFor, PAYMENT_METHODS } from './hand-sales-core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const date = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—');

const params = new URLSearchParams(location.search);
const id = params.get('i') || '';
const token = params.get('t') || '';
const justPaid = params.get('paid') === '1';
let inv = null;

let fbLoad = null;
function call(name, data) {
  if (!fbLoad) {
    fbLoad = Promise.all([
      import('./firebase.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js')
    ]);
  }
  return fbLoad.then(([fb, fn]) => {
    if (!fb.firebaseReady) throw new Error('Invoices are unavailable right now. Please try again shortly.');
    return fn.httpsCallable(fb.functions, name)(data).then((r) => r.data);
  });
}

function notice(html, ok) {
  $('notice').innerHTML = html ? `<div class="notice${ok ? ' ok' : ''}">${html}</div>` : '';
}

function stamp(v) {
  if (v.status === 'cancelled') return '<div class="iv-stamp void">Cancelled</div>';
  if (v.payment.status === 'paid' || v.payment.status === 'comp') return `<div class="iv-stamp paid">${v.payment.status === 'comp' ? 'No charge' : 'Paid'}</div>`;
  return '<div class="iv-stamp due">Due</div>';
}

function payHtml(v) {
  const card = (v.payOptions || []).find((o) => o.key === 'card');
  if (!card) return '';
  return `<section class="iv-section no-print" id="pay">
    <h2>Pay ${esc(formatMoney(v.total))}</h2>
    <div class="iv-pay">
      <div class="iv-card">
        <div><div class="t">Pay by card</div><div class="s">Secure checkout by Stripe. Apple Pay and Google Pay work too.</div></div>
        <button class="btn btn-red" id="btn-card" type="button">Pay ${esc(formatMoney(v.total))}</button>
      </div>
      <div class="iv-msg" id="pay-msg" role="status" aria-live="polite"></div>
    </div>
  </section>`;
}

function render() {
  const v = inv;
  const s = v.seller || {};
  const ship = addressLines(v.shipping);
  const paid = v.payment.status === 'paid' || v.payment.status === 'comp';
  document.title = `Invoice ${v.invoiceNumber} | ${s.name || 'The One Percent Nation'}`;
  $('doc').className = '';
  $('doc').innerHTML = `<div class="paper"><article class="ag-doc">
    <header class="ag-letterhead">
      <div class="ag-brand">
        <img class="ag-mark" src="/assets/favicon.jpg" alt="">
        <div class="ag-word"><span class="ag-word-1">The One Percent</span><span class="ag-word-2">Nation</span></div>
      </div>
      <div class="ag-contact">
        ${s.web ? `<div>${esc(s.web)}</div>` : ''}
        ${s.email ? `<div>${esc(s.email)}</div>` : ''}
        ${s.address ? `<div>${esc(s.address)}</div>` : ''}
      </div>
    </header>
    <div class="ag-rule" aria-hidden="true"><span></span></div>

    <div class="iv-title">
      <div>
        <h1>Invoice</h1>
        <div class="iv-meta">
          <span>Invoice no.</span><b>${esc(v.invoiceNumber)}</b>
          <span>Issued</span><b>${esc(date(v.createdAt))}</b>
          ${paid ? `<span>Paid</span><b>${esc(date(v.payment.paidAt))}${v.payment.method ? ` · ${esc(labelFor(PAYMENT_METHODS, v.payment.method))}` : ''}</b>`
            : (v.status !== 'cancelled' ? `<span>Due</span><b>${esc(date(v.dueAt))}</b>` : '')}
        </div>
      </div>
      ${stamp(v)}
    </div>

    <div class="iv-parties">
      <div>
        <div class="iv-label">Bill to</div>
        <div class="iv-party"><strong>${esc(v.buyer.name)}</strong>${v.buyer.email ? `<br>${esc(v.buyer.email)}` : ''}</div>
      </div>
      <div>
        <div class="iv-label">${v.delivery === 'hand' ? 'Delivery' : 'Ship to'}</div>
        <div class="iv-party">${v.delivery === 'hand' ? 'Hand delivered'
          : (ship.length ? ship.map(esc).join('<br>') : '<em>Address to come. Reply with where you want it shipped.</em>')}</div>
      </div>
    </div>

    <table class="iv-items">
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead>
      <tbody>${v.items.map((it) => `<tr>
        <td>${esc(it.name)}${it.note ? `<div class="sub">${esc(it.note)}</div>` : ''}</td>
        <td class="r">${esc(it.qty)}</td>
        <td class="r">${esc(formatMoney(it.unitPrice))}</td>
        <td class="r">${esc(formatMoney(it.qty * it.unitPrice))}</td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="iv-totals">
      <div><span>Subtotal</span><span>${esc(formatMoney(v.subtotal))}</span></div>
      ${v.shippingFee ? `<div><span>Shipping</span><span>${esc(formatMoney(v.shippingFee))}</span></div>` : ''}
      ${v.discount ? `<div><span>Discount</span><span>−${esc(formatMoney(v.discount))}</span></div>` : ''}
      ${v.tax ? `<div><span>Sales tax</span><span>${esc(formatMoney(v.tax))}</span></div>` : ''}
      <div class="grand"><span>${paid ? 'Total paid' : 'Total due'}</span><span>${esc(formatMoney(v.total))}</span></div>
    </div>
    ${v.giftMessage ? `<div class="iv-sign">Signing: “${esc(v.giftMessage)}”</div>` : ''}

    ${v.tracking && (v.tracking.number || v.tracking.carrier) ? `<section class="iv-section"><h2>On the way</h2>
      <div class="iv-party">${esc([v.tracking.carrier, v.tracking.number].filter(Boolean).join(' · '))}</div></section>` : ''}

    ${v.status !== 'cancelled' && !paid ? payHtml(v) : ''}

    ${s.note ? `<div class="iv-foot">${esc(s.note)}</div>` : ''}
  </article></div>`;

  $('btn-print').hidden = false;
  const canPay = v.status !== 'cancelled' && !paid && (v.payOptions || []).length;
  $('btn-jump').hidden = !canPay;
  const card = $('btn-card');
  if (card) card.addEventListener('click', payByCard);

  if (v.status === 'cancelled') notice('<strong>This invoice was cancelled.</strong> Nothing is owed on it.');
  else if (paid) notice(`<strong>Paid. Thank you!</strong> ${v.delivery === 'hand' ? 'Your order is ready for hand delivery.' : (v.status === 'shipped' || v.status === 'done' ? 'Your order is on the way.' : 'Your copy gets signed and shipped next.')}`, true);
  else if (justPaid) notice('<strong>Payment received.</strong> It can take a minute to show here; refresh shortly.', true);
  else notice('');
}

async function payByCard() {
  const btn = $('btn-card');
  const msg = $('pay-msg');
  btn.disabled = true;
  btn.textContent = 'Opening checkout…';
  msg.textContent = '';
  try {
    const res = await call('payInvoice', { id, token });
    location.href = res.url;
  } catch (e) {
    msg.textContent = (e && e.message) || 'Could not open checkout. Try again, or use one of the other options.';
    btn.disabled = false;
    btn.textContent = `Pay ${formatMoney(inv.total)}`;
  }
}

async function load(attempt = 0) {
  if (!id || !token) {
    $('doc').textContent = 'This invoice link is incomplete. Open the full link you were sent.';
    return;
  }
  try {
    inv = await call('getInvoice', { id, token });
    render();
    // Back from Stripe before the webhook landed: look again a few times.
    const paid = inv.payment.status === 'paid' || inv.payment.status === 'comp';
    if (justPaid && !paid && attempt < 5) setTimeout(() => load(attempt + 1), 2500);
  } catch (e) {
    console.warn('[invoice] load failed', e);
    $('doc').textContent = (e && e.code === 'functions/not-found')
      ? 'This invoice link is not valid. Ask for a fresh link, or contact anthonybrown@the1pnation.com.'
      : ((e && e.message) || 'The invoice could not be loaded. Refresh to try again.');
  }
}

$('btn-print').addEventListener('click', async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  window.print();
});
load();
