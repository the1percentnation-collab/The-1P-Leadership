// Audit Scorecards (/scorecards.html): the owner's builder for the one-page
// Alignment Scorecard every Alignment Audit promises within 48 hours.
//
// Two views on one page. The list shows audit requests from the corporate
// form that have no scorecard yet (CRM contacts tagged "Alignment Audit") and
// every scorecard with its 48-hour clock. The editor is a form on the left
// and the real document on the right, rendered by scorecard-core.js, so what
// Anthony sees while writing is exactly what prints.
//
// Owner only. auditScorecards/{id} and its logo uploads are locked to the
// owner claim in firestore.rules and storage.rules; the gate below is for
// the page, the rules are what actually protect the data.

import { app, db, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, deleteDoc, query, where, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import {
  AREAS, RATINGS, FORMATS, PROGRAMS, DELIVERY, PLAN_WINDOWS, LIMITS,
  normalizeScorecard, renderScorecard, missingForDelivery, draftFromRequest,
  dueAt, dueState
} from './scorecard-core.js';

const $ = (id) => document.getElementById(id);
const COL = 'auditScorecards';
const PAGE_W = 816;   // 8.5in at 96 CSS px per inch
const PAGE_H = 1056;  // 11in
const LOGO_MAX = 5 * 1024 * 1024;

let me = null;        // { user, companyId }
let current = null;   // { id, sc, deliveredAt }
let saveTimer = null;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const ms = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : 0));
const fmtDay = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const fmtDue = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${msg}</div></div>`;
}

const DUE_LABEL = {
  delivered: 'Delivered', unscheduled: 'No session date', open: 'On track', 'due-soon': 'Due soon', overdue: 'Overdue'
};
const DUE_ORDER = { overdue: 0, 'due-soon': 1, open: 2, unscheduled: 3, delivered: 4 };

// ─── List ────────────────────────────────────────────────────────────────

async function loadScorecards() {
  const snap = await getDocs(collection(db, COL));
  return snap.docs.map((d) => ({ id: d.id, sc: normalizeScorecard(d.data()), raw: d.data() }));
}

// Audit requests are CRM contacts tagged by submitLeadForm. The form answers
// (organization, role, format, team size) live on the lead_form activity.
async function loadRequests() {
  if (!me.companyId) return null;
  const contacts = await getDocs(query(
    collection(db, 'companies', me.companyId, 'contacts'),
    where('tags', 'array-contains', 'Alignment Audit'), limit(100)
  ));
  const rows = contacts.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, 40);
  await Promise.all(rows.map(async (r) => { r.fields = await requestFields(r.id); }));
  return rows;
}

async function requestFields(contactId) {
  try {
    const acts = await getDocs(query(
      collection(db, 'companies', me.companyId, 'contacts', contactId, 'activities'),
      where('type', '==', 'lead_form'), limit(20)
    ));
    const audit = acts.docs.map((d) => d.data())
      .filter((a) => a.meta && a.meta.formType === 'alignment-audit')
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))[0];
    return (audit && audit.meta.fields) || {};
  } catch (e) {
    return {};
  }
}

async function renderList() {
  $('view-list').style.display = 'block';
  const [cards, requests] = await Promise.all([
    loadScorecards(),
    loadRequests().catch((e) => { console.warn('[scorecards] requests', e); return undefined; })
  ]);

  const used = new Set(cards.map((c) => c.sc.contactId).filter(Boolean));
  const reqBody = $('requests-body');
  if (requests === null) {
    reqBody.innerHTML = '<tr><td colspan="6" class="sc-muted">Your account is not linked to the academy company, so audit requests cannot be listed. Start a blank scorecard instead.</td></tr>';
  } else if (requests === undefined) {
    reqBody.innerHTML = '<tr><td colspan="6" class="sc-muted">Could not load audit requests. Refresh to try again.</td></tr>';
  } else {
    const open = requests.filter((r) => !used.has(r.id));
    reqBody.innerHTML = open.length ? open.map((r) => `<tr>
        <td><div>${esc(r.name || '—')}</div><div class="sc-muted">${esc(r.email || '')}</div></td>
        <td>${esc(r.fields.organization || '—')}<div class="sc-muted">${esc(r.fields.role || '')}</div></td>
        <td>${esc(r.fields.format || '—')}</td>
        <td>${esc(r.fields.team_size || '—')}</td>
        <td>${fmtDay(ms(r.createdAt))}</td>
        <td class="sc-row-actions"><button class="btn btn-primary btn-sm" type="button" data-start="${esc(r.id)}">Start scorecard</button></td>
      </tr>`).join('')
      : '<tr><td colspan="6" class="sc-muted">No open audit requests. New ones from the corporate page show up here.</td></tr>';
    reqBody.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => {
      const r = open.find((x) => x.id === b.dataset.start);
      b.disabled = true;
      createScorecard(draftFromRequest({ contactId: r.id, name: r.name, email: r.email, fields: r.fields }))
        .catch((e) => { b.disabled = false; alert('Could not start the scorecard: ' + (e.message || e)); });
    }));
  }

  const now = Date.now();
  const rows = cards
    .map((c) => ({ ...c, state: dueState(c.sc, now), due: dueAt(c.sc.sessionDate) }))
    .sort((a, b) => (DUE_ORDER[a.state] - DUE_ORDER[b.state]) || ((a.due || Infinity) - (b.due || Infinity)));
  $('scorecards-body').innerHTML = rows.length ? rows.map((c) => `<tr>
      <td><strong>${esc(c.sc.orgName || 'Untitled')}</strong></td>
      <td>${esc(c.sc.preparedFor || '—')}</td>
      <td>${c.sc.sessionDate ? esc(new Date(c.sc.sessionDate + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) : '—'}</td>
      <td>${c.state === 'delivered' ? fmtDay(ms(c.raw.deliveredAt)) : fmtDue(c.due)}</td>
      <td><span class="sc-pill sc-pill-${c.state}">${DUE_LABEL[c.state]}</span></td>
      <td class="sc-row-actions"><a class="btn btn-ghost btn-sm" href="/scorecards.html?id=${encodeURIComponent(c.id)}">Open</a></td>
    </tr>`).join('')
    : '<tr><td colspan="6" class="sc-muted">No scorecards yet.</td></tr>';
}

async function createScorecard(sc) {
  const ref = await addDoc(collection(db, COL), {
    ...normalizeScorecard(sc),
    createdBy: me.user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  location.href = `/scorecards.html?id=${encodeURIComponent(ref.id)}`;
}

// ─── Editor ──────────────────────────────────────────────────────────────

const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
function setPath(o, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  keys.reduce((x, k) => x[k], o)[last] = v;
}

const options = (list, valueKey = 'key') => list.map((x) => `<option value="${esc(x[valueKey])}">${esc(x.label)}</option>`).join('');

// A field's character budget, shown under it, so the one-page limit is felt
// while writing rather than discovered in the preview.
function counted(el, max) {
  el.maxLength = max;
  const c = document.createElement('div');
  c.className = 'sc-count';
  el.after(c);
  const tick = () => {
    c.textContent = `${el.value.length} / ${max}`;
    c.classList.toggle('near', el.value.length > max * 0.9);
  };
  el.addEventListener('input', tick);
  tick();
}

function buildForm() {
  $('f-format').innerHTML = options(FORMATS);
  $('f-program').innerHTML = options(PROGRAMS);
  $('f-delivery').innerHTML = options(DELIVERY);
  $('f-priority').innerHTML = '<option value="">Lowest rated area (automatic)</option>' + options(AREAS);

  $('areas').innerHTML = AREAS.map((a, i) => `<div class="sc-area-card" data-area="${i}">
      <div class="sc-area-top">
        <strong>${esc(a.label)}</strong>
        <div class="sc-f" style="margin:0;"><select data-k="areas.${i}.rating" aria-label="${esc(a.label)} rating">${options(RATINGS, 'value')}</select></div>
      </div>
      <div class="sc-area-desc">${esc(a.desc)}</div>
      <div class="sc-area-text">
        <div class="sc-f"><label for="f-a${i}-finding">What we saw</label><textarea id="f-a${i}-finding" data-k="areas.${i}.finding"></textarea></div>
        <div class="sc-f" style="margin-bottom:0;"><label for="f-a${i}-solution">What to do</label><textarea id="f-a${i}-solution" data-k="areas.${i}.solution"></textarea></div>
      </div>
    </div>`).join('');

  $('plan').innerHTML = PLAN_WINDOWS.map((w) => `<div class="sc-f"><label for="f-plan-${w.key}">${esc(w.label)}</label><textarea id="f-plan-${w.key}" data-k="plan.${w.key}"></textarea></div>`).join('');

  const limitFor = (k) => {
    const leaf = k.split('.').pop();
    if (k.startsWith('plan.')) return LIMITS.plan;
    return LIMITS[leaf] || null;
  };
  document.querySelectorAll('#sc-form [data-k]').forEach((el) => {
    const max = limitFor(el.dataset.k);
    if (max && (el.tagName === 'TEXTAREA' || el.type === 'text' || el.tagName === 'INPUT') && el.type !== 'date' && el.type !== 'color') counted(el, max);
  });
}

function fillForm(sc) {
  document.querySelectorAll('#sc-form [data-k]').forEach((el) => {
    const v = getPath(sc, el.dataset.k);
    el.value = v == null ? '' : String(v);
    el.dispatchEvent(new Event('input'));
  });
  syncAreaCards(sc);
  syncLogo(sc);
}

function syncAreaCards(sc) {
  document.querySelectorAll('.sc-area-card').forEach((card) => {
    card.classList.toggle('is-skipped', sc.areas[Number(card.dataset.area)].rating < 1);
  });
}

function syncLogo(sc) {
  $('logo-thumb').hidden = !sc.logoUrl;
  if (sc.logoUrl) $('logo-thumb').src = sc.logoUrl;
  $('btn-logo-remove').hidden = !sc.logoUrl;
}

function onFieldChange(e) {
  const el = e.target.closest('[data-k]');
  if (!el || !current) return;
  const k = el.dataset.k;
  const v = /\.rating$/.test(k) ? Number(el.value) : el.value;
  setPath(current.sc, k, v);
  if (/\.rating$/.test(k)) syncAreaCards(current.sc);
  renderPreview();
  scheduleSave();
}

function renderPreview() {
  const sc = normalizeScorecard(current.sc);
  const box = $('preview');
  box.innerHTML = renderScorecard(sc);
  fitPreview();

  const missing = missingForDelivery(sc);
  $('missing').innerHTML = missing.length
    ? `Before you deliver:<ul>${missing.slice(0, 8).map((m) => `<li>${esc(m)}</li>`).join('')}${missing.length > 8 ? `<li>and ${missing.length - 8} more</li>` : ''}</ul>`
    : 'Ready to deliver.';
}

// Scale the 8.5 x 11 document to the column, and say whether it still fits
// on one page. The document grows past 11in when the writing runs long.
function fitPreview() {
  const box = $('preview');
  const page = box.querySelector('.sc-doc');
  if (!page) return;
  const scale = Math.min(1, box.clientWidth / PAGE_W);
  page.style.transform = `scale(${scale})`;
  const h = page.offsetHeight;
  box.style.height = `${Math.ceil(h * scale)}px`;
  const over = h > PAGE_H + 1;
  const fit = $('fit');
  fit.className = `sc-fit ${over ? 'over' : 'ok'}`;
  fit.textContent = over ? 'Runs past one page. Trim the longest boxes.' : 'Fits on one page';
}

function scheduleSave() {
  $('save-state').textContent = 'Unsaved changes';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 1200);
}

async function save() {
  clearTimeout(saveTimer);
  if (!current) return;
  $('save-state').textContent = 'Saving…';
  try {
    await setDoc(doc(db, COL, current.id), {
      ...normalizeScorecard(current.sc),
      updatedAt: serverTimestamp()
    }, { merge: true });
    $('save-state').textContent = 'Saved';
  } catch (e) {
    console.warn('[scorecards] save failed', e);
    $('save-state').textContent = 'Not saved. Check your connection.';
  }
}

async function uploadLogo(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { alert('Use a PNG, JPG, WebP or SVG logo.'); return; }
  if (file.size > LOGO_MAX) { alert('That logo is over 5 MB. Use a smaller file.'); return; }
  const st = getStorage(app);
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[file.type];
  const path = `${COL}/${current.id}/logo-${Date.now()}.${ext}`;
  $('save-state').textContent = 'Uploading logo…';
  try {
    const ref = storageRef(st, path);
    await uploadBytes(ref, file, { contentType: file.type });
    const url = await getDownloadURL(ref);
    const old = current.sc.logoPath;
    current.sc.logoUrl = url;
    current.sc.logoPath = path;
    syncLogo(current.sc);
    renderPreview();
    await save();
    if (old && old !== path) deleteObject(storageRef(st, old)).catch(() => {});
  } catch (e) {
    console.warn('[scorecards] logo upload failed', e);
    $('save-state').textContent = 'Logo upload failed.';
  }
}

async function removeLogo() {
  const old = current.sc.logoPath;
  current.sc.logoUrl = '';
  current.sc.logoPath = '';
  syncLogo(current.sc);
  renderPreview();
  await save();
  if (old) deleteObject(storageRef(getStorage(app), old)).catch(() => {});
}

// Print exactly the document, full size. The browser's "Save as PDF" is the
// PDF; @page in scorecards.html sets Letter with no margins.
async function printScorecard() {
  await save();
  const root = $('print-root');
  root.innerHTML = renderScorecard(normalizeScorecard(current.sc));
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const prevTitle = document.title;
  const sc = normalizeScorecard(current.sc);
  // The title becomes the PDF's default file name.
  document.title = `Alignment Scorecard - ${sc.orgName || 'Draft'}`;
  window.print();
  document.title = prevTitle;
}

async function deliver() {
  const sc = normalizeScorecard(current.sc);
  const missing = missingForDelivery(sc);
  if (missing.length) {
    alert(`Finish these before delivering:\n\n• ${missing.join('\n• ')}`);
    return;
  }
  if (!confirm(`Mark the scorecard for ${sc.orgName} as delivered? Download the PDF and send it first.`)) return;
  current.sc.status = 'delivered';
  await setDoc(doc(db, COL, current.id), {
    ...normalizeScorecard(current.sc), deliveredAt: serverTimestamp(), updatedAt: serverTimestamp()
  }, { merge: true });
  // Leave a line on the CRM contact so the pipeline shows the audit is done.
  // Best-effort: the scorecard itself is already saved.
  if (sc.contactId && me.companyId) {
    try {
      await addDoc(collection(db, 'companies', me.companyId, 'contacts', sc.contactId, 'activities'), {
        type: 'scorecard_delivered',
        description: `Alignment Scorecard delivered for ${sc.orgName}`,
        actorUid: me.user.uid,
        actorName: me.user.displayName || me.user.email || 'Owner',
        createdAt: serverTimestamp(),
        meta: { scorecardId: current.id }
      });
    } catch (e) { console.warn('[scorecards] CRM activity failed', e); }
  }
  updateDeliverButton();
  $('save-state').textContent = 'Delivered';
}

function updateDeliverButton() {
  const delivered = current.sc.status === 'delivered';
  $('btn-deliver').textContent = delivered ? 'Delivered' : 'Mark delivered';
  $('btn-deliver').disabled = delivered;
}

async function removeScorecard() {
  const sc = normalizeScorecard(current.sc);
  if (!confirm(`Delete the scorecard for ${sc.orgName || 'this client'}? This cannot be undone.`)) return;
  clearTimeout(saveTimer);
  const old = sc.logoPath;
  await deleteDoc(doc(db, COL, current.id));
  if (old) await deleteObject(storageRef(getStorage(app), old)).catch(() => {});
  current = null;
  location.href = '/scorecards.html';
}

async function openEditor(id) {
  const snap = await getDoc(doc(db, COL, id));
  if (!snap.exists()) { gate('That scorecard does not exist. <a href="/scorecards.html" style="color:var(--red);">Back to all scorecards</a>'); return; }
  current = { id, sc: normalizeScorecard(snap.data()) };
  $('view-editor').style.display = 'block';
  buildForm();
  fillForm(current.sc);
  renderPreview();
  updateDeliverButton();
  $('save-state').textContent = 'Saved';

  $('sc-form').addEventListener('input', onFieldChange);
  $('sc-form').addEventListener('change', onFieldChange);
  $('f-logo').addEventListener('change', (e) => { uploadLogo(e.target.files[0]); e.target.value = ''; });
  $('btn-logo-remove').addEventListener('click', removeLogo);
  $('btn-print').addEventListener('click', printScorecard);
  $('btn-deliver').addEventListener('click', () => deliver().catch((e) => alert('Could not mark delivered: ' + (e.message || e))));
  $('btn-delete').addEventListener('click', () => removeScorecard().catch((e) => alert('Could not delete: ' + (e.message || e))));
  new ResizeObserver(fitPreview).observe($('preview'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPreview);
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
  renderTopbar({ user: u, role: info.role, currentPage: 'scorecards' });
  if (info.role !== 'owner') {
    gate(`You are signed in as <b>${esc(u.email)}</b> but your role is <b>${esc(info.role)}</b>. Owner access required.`);
    return;
  }
  me = { user: u, companyId: info.companyId };

  $('btn-blank').addEventListener('click', () => createScorecard({}).catch((e) => alert('Could not create: ' + (e.message || e))));

  const id = new URLSearchParams(location.search).get('id');
  try {
    if (id) await openEditor(id);
    else await renderList();
  } catch (e) {
    console.warn('[scorecards] load failed', e);
    gate('Could not load scorecards. Refresh to try again.');
  }
}

main();
