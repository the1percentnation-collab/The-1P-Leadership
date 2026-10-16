// Review and Sign (/sign?a=<id>&t=<token>): where a client reads and signs
// a Speaking Engagement Agreement.
//
// The link's token is the only key. The page never reads Firestore: it asks
// getAgreementForSigning for the snapshot that was frozen when the agreement
// was sent, renders it on letterhead, and signs through signAgreement, which
// records the signature server-side. A signed agreement opens as the
// executed copy with its certificate of completion, ready to save as a PDF.

import { renderAgreement } from './agreement-render.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const params = new URLSearchParams(location.search);
const id = params.get('a') || '';
const token = params.get('t') || '';
let state = null;

let fbLoad = null;
function call(name, data) {
  if (!fbLoad) {
    fbLoad = Promise.all([
      import('./firebase.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js')
    ]);
  }
  return fbLoad.then(([fb, fn]) => {
    if (!fb.firebaseReady) throw new Error('Signing is unavailable right now. Please try again shortly.');
    return fn.httpsCallable(fb.functions, name)(data);
  });
}

function notice(html, ok) {
  $('notice').innerHTML = html ? `<div class="notice${ok ? ' ok' : ''}">${html}</div>` : '';
}

function render() {
  const s = state;
  $('doc').className = '';
  $('doc').innerHTML = `<div class="paper">${renderAgreement(s.snapshot, { provider: s.provider, client: s.client, audit: s.audit })}</div>`;
  $('btn-print').hidden = false;
  const signing = s.status === 'sent';
  $('btn-jump').hidden = !signing;
  $('sign').hidden = !signing;
  document.title = `${signing ? 'Review and Sign' : 'Agreement'} ${s.snapshot.agreementNo} | The One Percent Nation`;

  if (signing) {
    const c = s.snapshot.client;
    notice(`<strong>${esc(s.snapshot.provider.legalName)}</strong> has signed and sent this agreement to you. Read it through, then sign at the bottom of the page.`);
    $('sign-sub').textContent = `Signing for ${c.legalName}. This link was sent to ${c.signerEmail}.`;
    $('s-terms-text').textContent = `I have read this Agreement and agree to its terms on behalf of ${c.legalName}, and I am authorized to do so.`;
    if (!$('s-name').value) $('s-name').value = c.signerName || '';
    if (!$('s-title').value) $('s-title').value = c.signerTitle || '';
    preview();
  } else if (s.status === 'signed') {
    notice(`<strong>Fully signed.</strong> This is the executed agreement. Save a copy with Download PDF; both parties also received it by email.`, true);
  } else if (s.status === 'void') {
    notice('<strong>This agreement was withdrawn</strong> and can no longer be signed. Contact The One Percent Nation at anthonybrown@the1pnation.com for a current version.');
  }
}

function preview() {
  const name = $('s-name').value.trim();
  $('s-preview').innerHTML = name ? `<span>${esc(name)}</span>` : '<em>Your signature appears here</em>';
}

async function load() {
  if (!id || !token) {
    $('doc').innerHTML = 'This signing link is incomplete. Open the full link from your email.';
    return;
  }
  try {
    const res = await call('getAgreementForSigning', { id, token });
    state = res.data;
    render();
  } catch (e) {
    console.warn('[sign] load failed', e);
    $('doc').innerHTML = esc((e && e.code === 'functions/not-found')
      ? 'This signing link is not valid. Open the latest link from your email, or contact anthonybrown@the1pnation.com.'
      : (e && e.message) || 'The agreement could not be loaded. Refresh to try again.');
  }
}

async function sign(e) {
  e.preventDefault();
  const name = $('s-name').value.trim();
  const title = $('s-title').value.trim();
  const msg = $('s-msg');
  msg.textContent = '';
  if (name.length < 2) { msg.textContent = 'Type your full name to sign.'; $('s-name').focus(); return; }
  if (!title) { msg.textContent = 'Add your title.'; $('s-title').focus(); return; }
  if (!$('s-terms').checked || !$('s-esign').checked) { msg.textContent = 'Check both boxes to sign.'; return; }

  const btn = $('s-submit');
  btn.disabled = true;
  btn.textContent = 'Signing…';
  try {
    const res = await call('signAgreement', { id, token, name, title, agreeTerms: true, agreeElectronic: true });
    state = { ...state, status: 'signed', client: res.data.client };
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    console.warn('[sign] failed', err);
    msg.textContent = (err && err.message) || 'Could not sign. Please try again.';
    btn.disabled = false;
    btn.textContent = 'Sign agreement';
  }
}

$('s-name').addEventListener('input', preview);
$('sign-form').addEventListener('submit', sign);
$('btn-print').addEventListener('click', async () => {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  window.print();
});
load();
