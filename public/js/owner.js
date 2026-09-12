// Owner console: create companies, assign admins, list all companies, set seat counts.
// Requires role == 'owner' (either custom claim or users/{uid}.role == 'owner').

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady, bootstrapOwner } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import {
  collection, doc, getDoc, getDocs, query, where, setDoc, serverTimestamp, limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${msg}</div></div>`;
}

function rand(len) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function findUidByEmail(email) {
  const q = query(collection(db, 'users'), where('email', '==', email), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return snap.docs[0].id;
}

async function loadCompanies() {
  const body = $('companies-body');
  body.innerHTML = '';
  try {
    const snap = await getDocs(collection(db, 'companies'));
    if (snap.empty) {
      body.innerHTML = `<tr><td colspan="6" style="color:var(--gray-mid);">No companies yet.</td></tr>`;
      return;
    }
    body.innerHTML = snap.docs.map((d) => {
      const c = d.data();
      return `<tr>
        <td>${c.name || '—'}</td>
        <td class="num">${d.id}</td>
        <td class="num">${c.seatsUsed || 0}/${c.seatCount || 0} <button class="btn btn-ghost" data-edit-seats="${d.id}" style="padding:2px 8px; font-size:11px; margin-left:8px;">edit</button></td>
        <td class="num">${(c.adminUids || []).length}</td>
        <td>${c.tier || '—'}</td>
        <td><a class="user-chip-link" href="/admin.html?companyId=${encodeURIComponent(d.id)}">Open</a></td>
      </tr>`;
    }).join('');
    body.querySelectorAll('[data-edit-seats]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = b.dataset.editSeats;
        const snap = await getDoc(doc(db, 'companies', id));
        if (!snap.exists()) return;
        const cur = snap.data();
        const val = prompt(`New seat count for ${cur.name || id}:`, String(cur.seatCount || 0));
        if (val == null) return;
        const n = Number(val);
        if (!Number.isFinite(n) || n < 0) return alert('Invalid number.');
        await setDoc(doc(db, 'companies', id), { seatCount: n }, { merge: true });
        await loadCompanies();
      });
    });
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" style="color:var(--red);">Error: ${e.message || e}</td></tr>`;
  }
}

async function createCompany(name, adminEmail, seats, tier) {
  const adminUid = await findUidByEmail(adminEmail);
  if (!adminUid) {
    throw new Error(`No user with email ${adminEmail} exists yet. Ask them to sign up first at /signup.html, then retry.`);
  }
  const companyId = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'co') + '-' + rand(5);
  await setDoc(doc(db, 'companies', companyId), {
    name,
    adminUids: [adminUid],
    seatCount: seats,
    seatsUsed: 0,
    tier: tier || 'team',
    createdAt: serverTimestamp()
  });
  // Mark the admin user as admin + link them to this company.
  await setDoc(doc(db, 'users', adminUid), {
    role: 'admin',
    companyId
  }, { merge: true });
  return companyId;
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/owner.html')); return; }

  // Resolve the real role BEFORE painting. Hardcoding role:'owner' here meant
  // any signed-in member who opened /owner.html was shown the whole Owner
  // dropdown (CRM, Store, Courses, Products, Affiliates, Certification, Admin,
  // Owner). Every destination re-gates, so it granted nothing, but it
  // advertised the entire back office to ordinary members.
  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: 'owner' });

  if (info.role !== 'owner') {
    // Still allow the page to load so the user can run bootstrapOwner.
    $('panel').style.display = 'block';
    $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">You are signed in as <b>${u.email}</b> but your role is <b>${info.role}</b>. If this account is the owner bootstrap email, click "Run bootstrapOwner" below.</div></div>`;
  } else {
    $('panel').style.display = 'block';
  }

  $('btn-bootstrap').addEventListener('click', async () => {
    $('bootstrap-result').innerHTML = '<div style="color:var(--gray-light); font-size:12px;">Running…</div>';
    try {
      const res = await bootstrapOwner();
      $('bootstrap-result').innerHTML = `<div class="auth-ok">${res && res.ok ? 'Owner claim set. Reloading…' : 'Done.'}</div>`;
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      $('bootstrap-result').innerHTML = `<div class="auth-error">${err.message || err}</div>`;
    }
  });

  $('btn-backfill-channels').addEventListener('click', async () => {
    const out = $('backfill-result');
    out.innerHTML = '<div style="color:var(--gray-light); font-size:12px;">Running…</div>';
    try {
      const call = httpsCallable(functions, 'backfillChannelDefaults');
      const res = (await call({})).data || {};
      const names = (res.channels || []).join(', ');
      out.innerHTML = `<div class="auth-ok">Checked ${res.total || 0} channel(s); updated ${res.patched || 0}${names ? ` — ${names}` : ''}.</div>`;
    } catch (err) {
      out.innerHTML = `<div class="auth-error">${err.message || err}</div>`;
    }
  });

  $('btn-sync-members').addEventListener('click', async () => {
    const out = $('sync-members-result');
    const sendMissingWelcome = $('sync-send-welcome').checked;
    if (sendMissingWelcome && !confirm('This will email every member who has no welcome email on record. Continue?')) return;
    $('btn-sync-members').disabled = true;
    out.innerHTML = '<div style="color:var(--gray-light); font-size:12px;">Running… this can take a minute on a large member list.</div>';
    try {
      const call = httpsCallable(functions, 'syncMembersToCrm');
      const r = (await call({ sendMissingWelcome })).data || {};
      const lines = [
        `Checked ${r.total || 0} member(s): ${r.linked || 0} newly linked to CRM, ${r.alreadyLinked || 0} already linked, ${r.skipped || 0} skipped (no email / owner).`
      ];
      if (sendMissingWelcome) lines.push(`Welcome emails: ${r.welcomeSent || 0} sent, ${r.welcomeFailed || 0} failed.`);
      if (r.errors) lines.push(`${r.errors} member(s) hit an error.`);
      const fails = (r.failures || []).map((f) => `<li>${f.email || f.uid}: ${f.error}</li>`).join('');
      out.innerHTML = `<div class="${(r.errors || r.welcomeFailed) ? 'auth-error' : 'auth-ok'}">${lines.join('<br/>')}${fails ? `<ul style="margin:8px 0 0 16px; font-size:12px;">${fails}</ul>` : ''}</div>`;
    } catch (err) {
      out.innerHTML = `<div class="auth-error">${err.message || err}</div>`;
    } finally {
      $('btn-sync-members').disabled = false;
    }
  });

  if (info.role === 'owner') {
    await loadCompanies();
  }

  $('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (info.role !== 'owner') {
      $('create-result').innerHTML = '<div class="auth-error">Owner claim required.</div>';
      return;
    }
    const name = $('c-name').value.trim();
    const adminEmail = $('c-admin-email').value.trim();
    const seats = Number($('c-seats').value);
    const tier = $('c-tier').value.trim() || 'team';
    try {
      const id = await createCompany(name, adminEmail, seats, tier);
      $('create-result').innerHTML = `<div class="auth-ok">Created company <b>${name}</b> (id: ${id}).</div>`;
      $('c-name').value = '';
      $('c-admin-email').value = '';
      await loadCompanies();
    } catch (err) {
      $('create-result').innerHTML = `<div class="auth-error">${err.message || err}</div>`;
    }
  });
}

main();
