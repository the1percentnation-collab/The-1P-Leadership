// Shared CRM company resolution.
//
// Every CRM surface used to pick a company with a limit(1) query on
// adminUids, which silently lands an admin of two companies in an arbitrary
// one. With the financial services partner getting its own company, that is
// no longer hypothetical. This helper lists every company the user admins,
// remembers the last choice per browser, and lets callers render a switcher
// when there is more than one.

import { db } from './firebase.js';
import {
  collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const LS_KEY = '1p_crm_company';

function lsGet() {
  try { return localStorage.getItem(LS_KEY) || null; } catch (e) { return null; }
}

export function rememberCompany(cid) {
  try { localStorage.setItem(LS_KEY, cid); } catch (e) {}
}

/** Every company the user admins, as [{ id, name }]. */
export async function listAdminCompanies(uid) {
  try {
    const snap = await getDocs(query(
      collection(db, 'companies'), where('adminUids', 'array-contains', uid)));
    return snap.docs.map((d) => ({ id: d.id, name: d.data().name || d.id }));
  } catch (e) {
    console.warn('[company-resolver] list failed', e);
    return [];
  }
}

/**
 * Resolve the company a CRM page should open.
 * Priority: explicit choice (?companyId=), the user's own companyId, the
 * remembered pick (if still valid), then the first company they admin.
 * Returns { companyId, companies } — render a switcher when
 * companies.length > 1.
 */
export async function resolveCrmCompany(uid, { preferred = null } = {}) {
  const companies = await listAdminCompanies(uid);
  const valid = (cid) => cid && companies.some((c) => c.id === cid);
  let companyId = null;
  if (valid(preferred)) companyId = preferred;
  else if (valid(lsGet())) companyId = lsGet();
  else if (companies.length) companyId = companies[0].id;
  if (companyId) rememberCompany(companyId);
  return { companyId, companies };
}

/** Small select control for pages with more than one company. */
export function companySwitcherHtml(companies, activeId) {
  if (!companies || companies.length < 2) return '';
  const opts = companies.map((c) =>
    `<option value="${c.id}" ${c.id === activeId ? 'selected' : ''}>${String(c.name).replace(/</g, '&lt;')}</option>`
  ).join('');
  return `
    <label style="display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--gray-light);">
      Company
      <select id="crm-company-switch" style="font-size:12px;">${opts}</select>
    </label>`;
}

/** Bind the switcher: remembers the pick and reloads with ?companyId=. */
export function bindCompanySwitcher(root = document) {
  const sel = root.querySelector('#crm-company-switch');
  if (!sel) return;
  sel.addEventListener('change', () => {
    rememberCompany(sel.value);
    const url = new URL(location.href);
    url.searchParams.set('companyId', sel.value);
    location.assign(url.toString());
  });
}

/**
 * Fire-and-forget: when the user admins more than one company, injects the
 * switcher into the CRM appbar (before the user chip). Safe on pages without
 * the CRM shell — it just does nothing.
 */
export function mountCrmCompanySwitcher(uid, activeId) {
  listAdminCompanies(uid).then((companies) => {
    if (!companies || companies.length < 2) return;
    const bar = document.querySelector('.crm-appbar-spacer');
    if (!bar || document.getElementById('crm-company-switch')) return;
    const holder = document.createElement('div');
    holder.innerHTML = companySwitcherHtml(companies, activeId);
    bar.parentNode.insertBefore(holder, bar.nextSibling);
    bindCompanySwitcher(document);
  }).catch(() => {});
}
