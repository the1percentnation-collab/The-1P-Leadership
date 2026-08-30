// Affiliate dashboard — for salespeople. Looks up the affiliate record
// matching the signed-in account's email (set by the owner/admin in
// /manage-affiliates.html) and shows their link, stats, and commissions.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import {
  collection, doc, getDoc, addDoc, query, where, getDocs, limit, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${msg}</div></div>`;
}

function money(n) {
  const v = typeof n === 'number' ? n : 0;
  return '$' + v.toFixed(2);
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/affiliate.html')); return; }

  try {
    const info = await getRoleInfo();
    renderTopbar({ user: u, role: info.role, currentPage: null });
  } catch (e) {}

  // Find this user's affiliate record: uid link first (coach records are
  // created server-side with the uid set), then the legacy email match.
  let aff = null;
  try {
    const byUid = await getDocs(query(collection(db, 'affiliates'), where('uid', '==', u.uid), limit(1)));
    if (!byUid.empty) aff = { code: byUid.docs[0].id, ...byUid.docs[0].data() };
  } catch (e) {
    console.warn('[affiliate] uid lookup failed', e);
  }
  if (!aff) {
    try {
      const q = query(collection(db, 'affiliates'), where('email', '==', (u.email || '').toLowerCase()), limit(1));
      const snap = await getDocs(q);
      if (!snap.empty) aff = { code: snap.docs[0].id, ...snap.docs[0].data() };
    } catch (e) {
      console.warn('[affiliate] lookup failed', e);
    }
  }

  if (!aff) {
    gate(`No affiliate account is linked to <b>${escapeHtml(u.email || '')}</b>. If you were invited to the affiliate program, make sure you signed in with the same email — or contact the program owner.`);
    return;
  }
  if (aff.active === false) {
    gate('Your affiliate account is currently disabled. Contact the program owner.');
    return;
  }

  $('panel').style.display = 'block';
  $('aff-hello').textContent = `Welcome, ${aff.name || u.email}`;
  const productPct = aff.rates && typeof aff.rates.clientProductPercent === 'number'
    ? aff.rates.clientProductPercent : null;
  $('aff-pct').textContent = productPct != null
    ? `${aff.commissionPercent != null ? aff.commissionPercent : 20}% on referrals and ${productPct}% on client products`
    : `${aff.commissionPercent != null ? aff.commissionPercent : 20}%`;

  // Coach extras: license standing, CE log, and product share links.
  if (aff.type === 'coach' || aff.uid === u.uid) {
    renderLicenseCard(u).catch((e) => console.warn('[affiliate] license card failed', e));
    renderCeCard(u).catch((e) => console.warn('[affiliate] CE card failed', e));
    renderProductsCard(aff).catch((e) => console.warn('[affiliate] products card failed', e));
  }

  const link = `${location.origin}/courses.html?ref=${encodeURIComponent(aff.code)}`;
  $('aff-link').value = link;
  $('btn-copy-link').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link);
      $('btn-copy-link').textContent = 'Copied ✓';
      setTimeout(() => { $('btn-copy-link').textContent = 'Copy'; }, 1500);
    } catch (e) { prompt('Copy this link:', link); }
  });

  const pending = Math.max(0, (aff.totalCommission || 0) - (aff.totalPaid || 0));
  $('stats-body').innerHTML = `<tr>
    <td class="num">${aff.clicks || 0}</td>
    <td class="num">${aff.saleCount || 0}</td>
    <td class="num">${money(aff.totalSales)}</td>
    <td class="num">${money(aff.totalCommission)}</td>
    <td class="num">${money(aff.totalPaid)}</td>
    <td class="num"><b>${money(pending)}</b></td>
  </tr>`;

  const salesBody = $('sales-body');
  try {
    const snap = await getDocs(collection(db, 'affiliates', aff.code, 'referrals'));
    if (snap.empty) {
      salesBody.innerHTML = `<tr><td colspan="5" style="color:var(--gray-mid);">No sales yet — share your link to get started.</td></tr>`;
      return;
    }
    const rows = snap.docs
      .map((d) => d.data())
      .sort((a, b) => {
        const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
    salesBody.innerHTML = rows.map((r) => `<tr>
      <td>${r.createdAt && r.createdAt.toDate ? r.createdAt.toDate().toLocaleDateString() : '—'}</td>
      <td>${escapeHtml(r.courseSlug || '—')}</td>
      <td class="num">${money(r.saleAmount)}</td>
      <td class="num"><b>${money(r.commission)}</b></td>
      <td>${r.status === 'paid' ? '<span class="auth-ok" style="font-size:12px;">Paid</span>' : '<span style="color:var(--gray-light); font-size:12px;">Pending</span>'}</td>
    </tr>`).join('');
  } catch (e) {
    salesBody.innerHTML = `<tr><td colspan="5" style="color:var(--red);">${escapeHtml(e.message || String(e))}</td></tr>`;
  }
}

async function renderLicenseCard(u) {
  const certSnap = await getDoc(doc(db, 'certifications', `${u.uid}_1p-clc`));
  if (!certSnap.exists()) return;
  const cert = certSnap.data();
  const card = $('license-card');
  const body = $('license-body');
  card.style.display = 'block';
  const expiry = cert.licenseExpiresAt && cert.licenseExpiresAt.toDate
    ? cert.licenseExpiresAt.toDate() : null;
  const expired = expiry ? expiry.getTime() < Date.now() : false;
  const expiryLabel = expiry
    ? expiry.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'unknown';
  body.innerHTML = `
    <p style="font-size:13px; color:var(--gray-light); margin-bottom:10px;">
      1P Certified Life Coach · Certificate <code>${escapeHtml(cert.certNumber || '')}</code><br>
      License ${expired ? '<b style="color:var(--red);">expired</b>' : 'valid through'} <b>${escapeHtml(expiryLabel)}</b>.
      ${expired ? 'Renew to restore your directory listing and product licensing.' : 'Renewal opens once your hours and CE for this license year are approved.'}
    </p>
    <button class="btn btn-primary" id="btn-renew" type="button">Renew for $597 / year</button>
    <span id="renew-msg" style="font-size:12px; color:var(--gray-mid); margin-left:10px;"></span>`;
  $('btn-renew').addEventListener('click', async () => {
    const msg = $('renew-msg');
    msg.textContent = 'Checking your renewal requirements…';
    try {
      const res = await httpsCallable(functions, 'createRenewalCheckout')({ slug: '1p-clc' });
      if (res.data && res.data.url) location.assign(res.data.url);
    } catch (e) {
      msg.textContent = (e && e.message) || 'Renewal could not be started.';
    }
  });
}

async function renderCeCard(u) {
  const certSnap = await getDoc(doc(db, 'certifications', `${u.uid}_1p-clc`));
  if (!certSnap.exists()) return;
  const card = $('ce-card');
  card.style.display = 'block';
  const list = $('ce-list');

  async function refresh() {
    try {
      const snap = await getDocs(query(
        collection(db, 'users', u.uid, 'ceCredits'), orderBy('createdAt', 'desc')));
      if (snap.empty) {
        list.innerHTML = '<p style="font-size:12px;color:var(--gray-mid);">No CE logged yet this year.</p>';
        return;
      }
      list.innerHTML = snap.docs.map((d) => {
        const e = d.data();
        const chip = e.status === 'approved'
          ? '<span class="auth-ok" style="font-size:11px;">Approved</span>'
          : (e.status === 'rejected'
            ? '<span style="color:var(--red);font-size:11px;">Rejected</span>'
            : '<span style="color:var(--gray-light);font-size:11px;">Pending</span>');
        return `<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray-dark,#222);font-size:13px;">
          <span style="flex:1;">${escapeHtml(e.title || '')}</span>
          <span class="num">${Number(e.credits) || 0} cr</span>
          ${chip}
        </div>`;
      }).join('');
    } catch (e) {
      list.innerHTML = '';
    }
  }

  $('ce-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await addDoc(collection(db, 'users', u.uid, 'ceCredits'), {
        title: $('ce-title').value.trim(),
        credits: Number($('ce-credits').value) || 1,
        status: 'submitted',
        createdAt: serverTimestamp()
      });
      $('ce-title').value = '';
      await refresh();
    } catch (e) {
      alert('Could not submit: ' + ((e && e.message) || 'unknown error'));
    }
  });
  await refresh();
}

async function renderProductsCard(aff) {
  let snap;
  try {
    snap = await getDocs(query(collection(db, 'products'), where('status', '==', 'live')));
  } catch (e) { return; }
  const sellable = snap.docs.filter((d) => d.data().sellable === true);
  if (!sellable.length) return;
  const card = $('products-card');
  card.style.display = 'block';
  $('products-list').innerHTML = sellable.map((d) => {
    const pr = d.data();
    const link = `${location.origin}/upcoming.html?ref=${encodeURIComponent(aff.code)}`;
    return `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--gray-dark,#222);font-size:13px;">
      <span style="flex:1;"><b>${escapeHtml(pr.name || d.id)}</b>${pr.price ? ` · $${pr.price}` : ''}</span>
      <button class="btn btn-ghost" data-plink="${escapeHtml(link)}" style="padding:2px 8px;font-size:11px;">Copy your link</button>
    </div>`;
  }).join('');
  $('products-list').querySelectorAll('[data-plink]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.plink);
        b.textContent = 'Copied ✓';
        setTimeout(() => { b.textContent = 'Copy your link'; }, 1500);
      } catch (e) { prompt('Copy this link:', b.dataset.plink); }
    }));
}

main();
