// Public coach directory — reads coachDirectory where active == true.
// Listing is a license benefit: entries are created server-side at
// certification issuance and hidden automatically when a license lapses.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady, currentUser } from './auth.js';
import { renderTopbarEarly } from './topbar.js';
import {
  collection, query, where, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function coachCardHtml(c) {
  const avatar = c.photoUrl
    ? `<img src="${escapeHtml(c.photoUrl)}" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;">`
    : `<div style="width:64px;height:64px;border-radius:50%;background:#1E1E1E;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',sans-serif;font-size:24px;color:var(--red,#E60306);">${escapeHtml(initials(c.name))}</div>`;
  const specialties = Array.isArray(c.specialties) && c.specialties.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:8px;">
        ${c.specialties.slice(0, 4).map((sp) => `<span style="font-size:11px;color:var(--gray-light);border:1px solid #2A2A2A;border-radius:20px;padding:2px 9px;">${escapeHtml(sp)}</span>`).join('')}
      </div>` : '';
  return `
    <div class="card" style="text-align:center; padding:22px 18px;">
      <div style="display:flex;justify-content:center;margin-bottom:12px;">${avatar}</div>
      <div style="font-weight:600; font-size:16px;">${escapeHtml(c.name || 'Certified Coach')}</div>
      <div style="font-size:12px; color:var(--red,#E60306); letter-spacing:1px; margin:3px 0 4px;">1P CERTIFIED LIFE COACH</div>
      ${c.location ? `<div style="font-size:12px; color:var(--gray-mid);">${escapeHtml(c.location)}</div>` : ''}
      ${c.bio ? `<p style="font-size:13px; color:var(--gray-light); margin:10px 0 0; line-height:1.5;">${escapeHtml(String(c.bio).slice(0, 200))}</p>` : ''}
      ${specialties}
      ${c.bookingUrl ? `<a class="btn btn-primary" href="${escapeHtml(c.bookingUrl)}" target="_blank" rel="noopener" style="margin-top:14px; display:inline-block; font-size:13px;">Book a conversation →</a>` : ''}
    </div>`;
}

async function main() {
  let user = null;
  try { if (firebaseReady) user = await onAuthReady(); } catch (e) {}
  renderTopbarEarly({ user: currentUser(), currentPage: null, links: [] });

  const grid = document.getElementById('coaches-grid');
  if (!firebaseReady) {
    grid.innerHTML = '<p style="color:var(--gray-mid);">The directory is unavailable right now. Please try again soon.</p>';
    return;
  }
  try {
    const snap = await getDocs(query(collection(db, 'coachDirectory'), where('active', '==', true)));
    if (snap.empty) {
      grid.innerHTML = '<p style="color:var(--gray-mid); grid-column:1/-1; text-align:center;">The founding cohort is in training now. Certified coaches appear here as they earn the credential.</p>';
      return;
    }
    // `active` is flipped server-side on renewal; the expiry mirror catches
    // lapsed licenses between webhook events so a lapsed coach never shows.
    const now = Date.now();
    const coaches = snap.docs.map((d) => d.data())
      .filter((c) => !(c.licenseExpiresAt && c.licenseExpiresAt.toMillis && c.licenseExpiresAt.toMillis() < now))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    if (!coaches.length) {
      grid.innerHTML = '<p style="color:var(--gray-mid); grid-column:1/-1; text-align:center;">The founding cohort is in training now. Certified coaches appear here as they earn the credential.</p>';
      return;
    }
    grid.innerHTML = coaches.map(coachCardHtml).join('');
  } catch (e) {
    console.warn('[coaches] load failed', e);
    grid.innerHTML = '<p style="color:var(--gray-mid);">Could not load the directory. Please try again.</p>';
  }
}

main();
