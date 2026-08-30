// Certification review console — admin/owner only.
//
// Works the three queues behind the 1P Certified Life Coach credential:
//   1. practice hour approvals (reviewCoachingHours)
//   2. recorded-session rubric reviews (reviewCapstone)
//   3. status lookups + issuance (getCertificationStatus / issueCertification)
// All decisions run through callables; nothing here writes Firestore directly.

import { functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
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

const RUBRIC = [
  { key: 'presence', label: 'Presence & Listening' },
  { key: 'questions', label: 'Question Quality' },
  { key: 'structure', label: 'Session Structure' },
  { key: 'nonAdvising', label: 'Non-Advising' }
];

let _queue = { hours: [], capstones: [] };

async function refreshQueue() {
  try {
    const res = await httpsCallable(functions, 'listCertificationQueue')({});
    _queue = res.data || { hours: [], capstones: [] };
  } catch (e) {
    console.warn('[cert-admin] queue load failed', e);
    _queue = { hours: [], capstones: [] };
  }
  renderHours();
  renderCapstones();
}

function renderHours() {
  const body = $('hours-body');
  if (!_queue.hours.length) {
    body.innerHTML = '<tr><td colspan="6" style="color:var(--gray-mid);">Nothing waiting. Every submitted session has been reviewed.</td></tr>';
    return;
  }
  body.innerHTML = _queue.hours.map((h, i) => `
    <tr>
      <td><b>${escapeHtml(h.userName)}</b><br><span style="font-size:11px;color:var(--gray-mid);">${escapeHtml(h.uid)}</span></td>
      <td>${escapeHtml(h.date || '')}</td>
      <td>${escapeHtml(h.clientLabel || '')}</td>
      <td class="num">${Math.round(((Number(h.minutes) || 0) / 60) * 10) / 10}h</td>
      <td style="font-size:12px;color:var(--gray-light);">${escapeHtml(h.notes || '')}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-primary" data-hour-approve="${i}" style="padding:3px 10px;font-size:11px;">Approve</button>
        <button class="btn btn-ghost" data-hour-reject="${i}" style="padding:3px 10px;font-size:11px;">Reject</button>
      </td>
    </tr>`).join('');

  body.querySelectorAll('[data-hour-approve]').forEach((b) =>
    b.addEventListener('click', () => decideHours(Number(b.dataset.hourApprove), 'approved')));
  body.querySelectorAll('[data-hour-reject]').forEach((b) =>
    b.addEventListener('click', () => decideHours(Number(b.dataset.hourReject), 'rejected')));
}

async function decideHours(i, decision) {
  const h = _queue.hours[i];
  if (!h) return;
  let note = '';
  if (decision === 'rejected') {
    note = prompt('Why is this entry rejected? The member sees this note.') || '';
    if (!note) return;
  }
  try {
    await httpsCallable(functions, 'reviewCoachingHours')({
      uid: h.uid, entryId: h.entryId, decision, note
    });
    await refreshQueue();
  } catch (e) {
    alert('Review failed: ' + ((e && e.message) || 'unknown error'));
  }
}

function renderCapstones() {
  const body = $('capstones-body');
  if (!_queue.capstones.length) {
    body.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;">Nothing waiting. Every submitted recording has been reviewed.</p>';
    return;
  }
  body.innerHTML = _queue.capstones.map((c, i) => `
    <div class="card" style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        <div>
          <b>${escapeHtml(c.userName)}</b>
          <span style="font-size:11px;color:var(--gray-mid);"> · ${escapeHtml(c.uid)}</span><br>
          <a href="${escapeHtml(c.sessionUrl || '#')}" target="_blank" rel="noopener" style="font-size:13px;">Open the recording ↗</a>
          ${c.notes ? `<div style="font-size:12px;color:var(--gray-light);margin-top:4px;">${escapeHtml(c.notes)}</div>` : ''}
        </div>
        <div style="font-size:11px;color:var(--gray-mid);">${escapeHtml(c.submittedAt || '')}</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:10px;">
        ${RUBRIC.map((r) => `
          <label style="font-size:12px;color:var(--gray-light);">${escapeHtml(r.label)} (0-5)
            <input type="number" min="0" max="5" value="3" data-cap="${i}" data-crit="${r.key}"
              style="display:block;width:100%;margin-top:4px;">
          </label>`).join('')}
      </div>
      <label style="font-size:12px;color:var(--gray-light);display:block;margin-bottom:10px;">Feedback to the member
        <textarea data-cap-feedback="${i}" rows="2" style="display:block;width:100%;margin-top:4px;"></textarea>
      </label>
      <button class="btn btn-primary" data-cap-approve="${i}" style="font-size:12px;">Approve</button>
      <button class="btn btn-ghost" data-cap-revise="${i}" style="font-size:12px;">Return for another take</button>
    </div>`).join('');

  body.querySelectorAll('[data-cap-approve]').forEach((b) =>
    b.addEventListener('click', () => decideCapstone(Number(b.dataset.capApprove), 'approved')));
  body.querySelectorAll('[data-cap-revise]').forEach((b) =>
    b.addEventListener('click', () => decideCapstone(Number(b.dataset.capRevise), 'revise')));
}

async function decideCapstone(i, decision) {
  const c = _queue.capstones[i];
  if (!c) return;
  const scores = {};
  document.querySelectorAll(`[data-cap="${i}"]`).forEach((inp) => {
    scores[inp.dataset.crit] = Number(inp.value);
  });
  const fb = document.querySelector(`[data-cap-feedback="${i}"]`);
  const feedback = fb ? fb.value.trim() : '';
  if (decision === 'revise' && !feedback) {
    alert('Give the member feedback before returning a recording.');
    return;
  }
  try {
    await httpsCallable(functions, 'reviewCapstone')({
      uid: c.uid, docId: c.docId, decision, scores, feedback
    });
    await refreshQueue();
  } catch (e) {
    alert('Review failed: ' + ((e && e.message) || 'unknown error'));
  }
}

function reqRow(met, label, detail) {
  return `
    <div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--gray-dark,#222);">
      <span style="color:${met ? 'var(--green,#2e7d32)' : 'var(--gray-mid)'};font-size:15px;">${met ? '✓' : '○'}</span>
      <span style="font-size:13px;">${escapeHtml(label)}</span>
      <span style="flex:1;"></span>
      <span style="font-size:12px;color:var(--gray-mid);">${escapeHtml(detail)}</span>
    </div>`;
}

async function lookupStatus(ev) {
  ev.preventDefault();
  const uid = $('lookup-uid').value.trim();
  const slot = $('status-result');
  if (!uid) return;
  slot.innerHTML = '<p style="color:var(--gray-mid);font-size:13px;">Loading…</p>';
  try {
    const res = await httpsCallable(functions, 'getCertificationStatus')({ uid, slug: '1p-clc' });
    const s = res.data;
    slot.innerHTML = `
      ${reqRow(true, 'Enrolled + module completion', 'Verified at issuance')}
      ${reqRow(s.examPassed, 'Written exam passed', `${s.attemptsUsed}/${s.attemptsAllowed} attempts used`)}
      ${reqRow(s.capstoneApproved, 'Recorded session approved', s.capstoneSubmitted && !s.capstoneApproved ? 'Submitted, in queue above' : '')}
      ${reqRow(s.hoursMet, `${s.requiredHours} approved practice hours`, `${s.approvedHours}h approved, ${s.pendingHours}h pending`)}
      <div style="margin-top:14px;">
        ${s.certified
          ? `<span class="auth-ok">Certified — ${escapeHtml(s.certification.certNumber)}, license valid through ${escapeHtml((s.certification.licenseExpiresAt || '').slice(0, 10))}</span>`
          : `<button class="btn btn-primary" id="issue-btn">Issue 1P Certified Life Coach</button>
             <span id="issue-msg" style="font-size:12px;color:var(--gray-mid);margin-left:10px;"></span>`}
      </div>`;
    const btn = $('issue-btn');
    if (btn) {
      btn.addEventListener('click', async () => {
        const msg = $('issue-msg');
        msg.textContent = 'Issuing…';
        try {
          const r = await httpsCallable(functions, 'issueCertification')({ uid, slug: '1p-clc' });
          msg.textContent = `Issued: ${r.data.certNumber}`;
          $('lookup-form').requestSubmit();
        } catch (e) {
          msg.textContent = (e && e.message) || 'Issuance failed.';
        }
      });
    }
  } catch (e) {
    slot.innerHTML = `<div class="auth-error">${escapeHtml((e && e.message) || 'Lookup failed.')}</div>`;
  }
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/certification-admin.html')); return; }

  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: null });
  if (!info.isAdmin) {
    gate(`You are signed in as <b>${escapeHtml(u.email || '')}</b> but this page requires an admin or owner account.`);
    return;
  }
  $('panel').style.display = 'block';
  $('lookup-form').addEventListener('submit', lookupStatus);
  await refreshQueue();
}

main();
