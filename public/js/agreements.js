// Speaking Agreements (/agreements.html): the owner's builder for the
// Speaking Engagement Agreement every booking is signed under.
//
// The list shows speaking requests from the CRM that have no agreement yet
// and every agreement with its status. The editor is the booking's details
// on the left and the real document, on letterhead, on the right.
//
// A draft is written straight to agreements/{id} (owner-only in
// firestore.rules). Sending, voiding, and the client's signature go through
// Cloud Functions, because once an agreement is sent nothing about it may
// change from a browser. The terms themselves live in agreement-terms.js.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, deleteDoc, query, where, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  FORMATS, normalizeAgreement, computeFees, fmtMoney, fmtDate, missingForSend, buildSnapshot
} from './agreement-terms.js';
import { renderAgreement } from './agreement-render.js';

const $ = (id) => document.getElementById(id);
const COL = 'agreements';
const STATUS_LABEL = { draft: 'Draft', sent: 'Awaiting signature', signed: 'Signed', void: 'Void' };

let me = null;
let current = null;   // { id, data, raw }
let saveTimer = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const ms = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : 0));
const fmtDay = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const pill = (s) => `<span class="ag-pill ag-pill-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${msg}</div></div>`;
}

function newAgreementNo() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 9000 + 1000;
  return `SA-${new Date().getFullYear()}-${n}`;
}

// ─── List ────────────────────────────────────────────────────────────────

async function loadRequests() {
  if (!me.companyId) return null;
  const contacts = await getDocs(query(
    collection(db, 'companies', me.companyId, 'contacts'),
    where('tags', 'array-contains', 'Speaking Request'), limit(100)
  ));
  const rows = contacts.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 40);
  await Promise.all(rows.map(async (r) => {
    try {
      const acts = await getDocs(query(
        collection(db, 'companies', me.companyId, 'contacts', r.id, 'activities'),
        where('type', '==', 'lead_form'), limit(20)
      ));
      const hit = acts.docs.map((d) => d.data())
        .filter((a) => a.meta && a.meta.formType === 'speaking')
        .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0];
      r.fields = (hit && hit.meta.fields) || {};
    } catch (e) { r.fields = {}; }
  }));
  return rows;
}

function formatKeyFromText(t) {
  const s = String(t || '');
  if (/headline/i.test(s)) return 'headline-keynote';
  if (/workshop|breakout/i.test(s)) return 'workshop';
  if (/retreat/i.test(s)) return 'retreat-2';
  return 'keynote';
}

function draftFromRequest(r) {
  const f = r.fields || {};
  return {
    contactId: r.id,
    client: {
      legalName: f.organization || f.company || '',
      signerName: r.name || '',
      signerTitle: f.role || '',
      signerEmail: r.email || ''
    },
    event: {
      name: f.event || '',
      location: /virtual/i.test(f.location || '') ? '' : (f.location || ''),
      virtual: /virtual/i.test(f.location || ''),
      audience: f.audience ? `About ${f.audience} people` : '',
      format: formatKeyFromText(f.format)
    },
    specialTerms: f.event_date ? `Requested date: ${f.event_date}.` : ''
  };
}

async function renderList() {
  $('view-list').style.display = 'block';
  const [snap, requests] = await Promise.all([
    getDocs(collection(db, COL)),
    loadRequests().catch((e) => { console.warn('[agreements] requests', e); return undefined; })
  ]);
  const items = snap.docs.map((d) => ({ id: d.id, raw: d.data(), a: normalizeAgreement(d.data()) }));
  const used = new Set(items.map((x) => x.a.contactId).filter(Boolean));

  const body = $('requests-body');
  if (requests === null) {
    body.innerHTML = '<tr><td colspan="6" class="ag-muted">Your account is not linked to the academy company, so requests cannot be listed. Start a blank agreement instead.</td></tr>';
  } else if (requests === undefined) {
    body.innerHTML = '<tr><td colspan="6" class="ag-muted">Could not load speaking requests. Refresh to try again.</td></tr>';
  } else {
    const open = requests.filter((r) => !used.has(r.id));
    body.innerHTML = open.length ? open.map((r) => `<tr>
        <td><div>${esc(r.name || '—')}</div><div class="ag-muted">${esc(r.email || '')}</div></td>
        <td>${esc(r.fields.organization || '—')}</td>
        <td>${esc(r.fields.event || '—')}<div class="ag-muted">${esc(r.fields.event_date || '')}</div></td>
        <td>${esc(r.fields.format || '—')}</td>
        <td>${fmtDay(ms(r.createdAt))}</td>
        <td class="ag-row-actions"><button class="btn btn-primary btn-sm" type="button" data-start="${esc(r.id)}">Start agreement</button></td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="ag-muted">No open speaking requests.</td></tr>';
    body.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
      b.disabled = true;
      createAgreement(draftFromRequest(open.find((x) => x.id === b.dataset.start)))
        .catch((e) => { b.disabled = false; alert('Could not start the agreement: ' + (e.message || e)); });
    }));
  }

  const order = { sent: 0, draft: 1, signed: 2, void: 3 };
  items.sort((x, y) => (order[x.raw.status] - order[y.raw.status]) || (ms(y.raw.updatedAt) - ms(x.raw.updatedAt)));
  $('agreements-body').innerHTML = items.length ? items.map((x) => `<tr>
      <td><strong>${esc(x.a.agreementNo || '—')}</strong></td>
      <td>${esc(x.a.client.legalName || 'Untitled')}<div class="ag-muted">${esc(x.a.event.name)}</div></td>
      <td>${esc(fmtDate(x.a.event.date) || '—')}</td>
      <td>${esc(fmtMoney(computeFees(x.a).total))}</td>
      <td>${pill(x.raw.status)}</td>
      <td class="ag-row-actions"><a class="btn btn-ghost btn-sm" href="/agreements.html?id=${encodeURIComponent(x.id)}">Open</a></td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="ag-muted">No agreements yet.</td></tr>';
}

async function createAgreement(seed) {
  const a = normalizeAgreement(seed);
  a.agreementNo = newAgreementNo();
  const ref = await addDoc(collection(db, COL), {
    ...a, status: 'draft', createdBy: me.user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
  });
  location.href = `/agreements.html?id=${encodeURIComponent(ref.id)}`;
}

// ─── Editor ──────────────────────────────────────────────────────────────

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setPath(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  keys.reduce((x, k) => (x[k] = x[k] || {}), o)[last] = v;
}

function fillForm() {
  $('f-format').innerHTML = FORMATS.map((f) => `<option value="${esc(f.key)}">${esc(f.label)} (from ${esc(fmtMoney(f.fee))})</option>`).join('');
  document.querySelectorAll('#ag-form [data-k]').forEach((el) => {
    const v = getPath(current.data, el.dataset.k);
    if (el.type === 'checkbox') el.checked = v === true;
    else el.value = v == null ? '' : String(v);
  });
}

function onFieldChange(e) {
  const el = e.target.closest('[data-k]');
  if (!el || !current || current.raw.status !== 'draft') return;
  const k = el.dataset.k;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'number') v = el.value === '' ? '' : Number(el.value);
  else v = el.value;

  // Switching format resets the fee to that format's rate, unless the fee
  // had been changed from the old format's rate by hand.
  if (k === 'event.format') {
    const prev = FORMATS.find((f) => f.key === current.data.event.format);
    const next = FORMATS.find((f) => f.key === v);
    if (prev && next && Number(current.data.fees.session) === prev.fee) {
      current.data.fees.session = next.fee;
      $('f-fee').value = next.fee;
    }
  }
  setPath(current.data, k, v);
  renderPreview();
  scheduleSave();
}

function renderTotals() {
  const fees = computeFees(current.data);
  $('totals').innerHTML = `${fees.lines.map((l) => `<div>${esc(l.label)}: ${esc(fmtMoney(l.amount))}</div>`).join('')}
    <div><strong>Total ${esc(fmtMoney(fees.total))}</strong> · deposit ${esc(fmtMoney(fees.deposit))} · balance ${esc(fmtMoney(fees.balance))}</div>`;
}

function docHtml() {
  const r = current.raw;
  if (r.status === 'draft') return renderAgreement(buildSnapshot(current.data), { draft: true });
  const sig = r.signature;
  return renderAgreement(r.snapshot, {
    provider: r.provider ? { name: r.provider.name, title: r.provider.title, signedAt: ms(r.provider.signedAt) } : null,
    client: sig ? { name: sig.name, title: sig.title, email: sig.email, signedAt: ms(sig.signedAt), ip: sig.ip } : null,
    audit: { sentAt: ms(r.sentAt), viewedAt: ms(r.viewedAt), hash: r.hash }
  });
}

function renderPreview() {
  $('preview').innerHTML = docHtml();
  if (current.raw.status === 'draft') {
    renderTotals();
    const missing = missingForSend(current.data);
    $('missing').innerHTML = missing.length
      ? `Before you send:<ul>${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>`
      : 'Ready to send.';
    $('btn-send').disabled = missing.length > 0;
  }
}

function renderChrome() {
  const r = current.raw;
  const s = r.status;
  $('status-pill').innerHTML = pill(s);
  $('ag-fields').disabled = s !== 'draft';
  $('btn-send').hidden = s !== 'draft';
  $('btn-delete').hidden = !(s === 'draft' || s === 'void');
  $('btn-void').hidden = s !== 'sent';
  $('btn-resend').hidden = s !== 'sent';
  const lock = $('locked');
  if (s === 'draft') { lock.hidden = true; return; }
  lock.hidden = false;
  const link = r.token ? `${location.origin}/sign?a=${encodeURIComponent(current.id)}&t=${encodeURIComponent(r.token)}` : '';
  const what = {
    sent: `Sent ${fmtDay(ms(r.sentAt))} to ${esc(r.snapshot.client.signerEmail)}. ${r.viewedAt ? `Opened ${fmtDay(ms(r.viewedAt))}.` : 'Not opened yet.'} The terms are locked; void it to make changes.`,
    signed: `Signed ${fmtDay(ms(r.signedAt))} by ${esc(r.signature.name)}, ${esc(r.signature.title)}. This is the executed agreement.`,
    void: 'Voided. The signing link no longer works.'
  }[s];
  lock.innerHTML = `${what}${link && s !== 'void' ? `<div class="ag-link"><input readonly value="${esc(link)}" id="ag-link-input"><button class="btn btn-ghost btn-sm" type="button" id="btn-copy">Copy link</button></div>` : ''}`;
  const copy = $('btn-copy');
  if (copy) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(link); copy.textContent = 'Copied'; }
    catch (e) { $('ag-link-input').select(); }
  });
  $('missing').innerHTML = '';
  $('save-state').textContent = '';
}

function scheduleSave() {
  $('save-state').textContent = 'Unsaved changes';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 1000);
}

async function save() {
  clearTimeout(saveTimer);
  if (!current || current.raw.status !== 'draft') return;
  $('save-state').textContent = 'Saving…';
  try {
    await setDoc(doc(db, COL, current.id), {
      ...normalizeAgreement(current.data), status: 'draft', updatedAt: serverTimestamp()
    }, { merge: true });
    $('save-state').textContent = 'Saved';
  } catch (e) {
    console.warn('[agreements] save failed', e);
    $('save-state').textContent = 'Not saved. Check your connection.';
  }
}

async function reload() {
  const snap = await getDoc(doc(db, COL, current.id));
  current.raw = snap.data();
  current.data = normalizeAgreement(current.raw);
  renderChrome();
  renderPreview();
}

async function send() {
  await save();
  const a = normalizeAgreement(current.data);
  if (!confirm(`Send agreement ${a.agreementNo} to ${a.client.signerName} at ${a.client.signerEmail}? Your signature is applied when it is sent, and the terms lock.`)) return;
  const btn = $('btn-send');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await httpsCallable(functions, 'sendAgreement')({ id: current.id });
    await reload();
    if (!res.data.emailed) alert('Sent, but the email could not be delivered. Copy the signing link and send it yourself.');
  } catch (e) {
    alert(e.message || 'Could not send the agreement.');
  } finally {
    btn.textContent = 'Send for signature';
    btn.disabled = false;
  }
}

async function resend() {
  try {
    const res = await httpsCallable(functions, 'sendAgreement')({ id: current.id, resend: true });
    alert(res.data.emailed ? 'Signing link emailed again.' : 'Email could not be delivered. Copy the link and send it yourself.');
  } catch (e) { alert(e.message || 'Could not resend.'); }
}

async function voidIt() {
  if (!confirm('Void this agreement? The signing link stops working. You can then start a new one.')) return;
  try { await httpsCallable(functions, 'voidAgreement')({ id: current.id }); await reload(); }
  catch (e) { alert(e.message || 'Could not void.'); }
}

async function remove() {
  if (!confirm('Delete this agreement? This cannot be undone.')) return;
  clearTimeout(saveTimer);
  try { await deleteDoc(doc(db, COL, current.id)); location.href = '/agreements.html'; }
  catch (e) { alert(e.message || 'Could not delete.'); }
}

async function printIt() {
  await save();
  $('print-root').innerHTML = docHtml();
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const prev = document.title;
  const a = current.raw.snapshot || buildSnapshot(current.data);
  document.title = `Speaking Engagement Agreement ${a.agreementNo || ''} - ${a.client.legalName || 'Draft'}`;
  window.print();
  document.title = prev;
}

async function openEditor(id) {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) { gate('That agreement does not exist. <a href="/agreements.html" style="color:var(--red);">Back to all agreements</a>'); return; }
  current = { id, raw: snap.data(), data: normalizeAgreement(snap.data()) };
  $('view-editor').style.display = 'block';
  fillForm();
  renderChrome();
  renderPreview();
  if (current.raw.status === 'draft') $('save-state').textContent = 'Saved';

  $('ag-form').addEventListener('input', onFieldChange);
  $('ag-form').addEventListener('change', onFieldChange);
  $('btn-send').addEventListener('click', send);
  $('btn-resend').addEventListener('click', resend);
  $('btn-void').addEventListener('click', voidIt);
  $('btn-delete').addEventListener('click', remove);
  $('btn-print').addEventListener('click', printIt);
  window.addEventListener('beforeunload', (e) => {
    if ($('save-state').textContent === 'Unsaved changes') { save(); e.preventDefault(); }
  });
}

// ─── Boot ────────────────────────────────────────────────────────────────

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search)); return; }
  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: 'agreements' });
  if (info.role !== 'owner') {
    gate(`You are signed in as <b>${esc(u.email)}</b> but your role is <b>${esc(info.role)}</b>. Owner access required.`);
    return;
  }
  me = { user: u, companyId: info.companyId };
  $('btn-blank').addEventListener('click', () => createAgreement({}).catch((e) => alert('Could not create: ' + (e.message || e))));
  const id = new URLSearchParams(location.search).get('id');
  try {
    if (id) await openEditor(id);
    else await renderList();
  } catch (e) {
    console.warn('[agreements] load failed', e);
    gate('Could not load agreements. Refresh to try again.');
  }
}

main();
