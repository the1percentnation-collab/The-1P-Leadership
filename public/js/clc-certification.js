// 1P Certified Life Coach — player extras for the `1p-clc` course.
//
// Adds to the shared course player (via course-renderer.js):
//   - an A.L.I.G.N. bar under each module title
//   - an "Hours Log" tab (25 approved practice hours requirement)
//   - a "Certification" tab (requirement checklist, written exam,
//     recorded-session submission)
//   - a sidebar footer with the live weekly call details
//     (join link read from courses/1p-clc/private/cohort — enrolled only)
//
// Everything that decides certification is server-side: hour approval,
// exam grading, capstone review, and issuance all run through callables.
// This file only submits and displays.

import { auth, db, functions, firebaseReady } from './firebase.js';
import {
  doc, getDoc, addDoc, collection, getDocs, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { ALIGN } from './icant-course.js';
import { escPlayer as esc } from './course-player.js';

const CLC_SLUG = '1p-clc';

// ─── A.L.I.G.N. bar ───────────────────────────────────────────────────────

const ALIGN_ORDER = ['A', 'L', 'I', 'G', 'N'];

function alignKeyFromText(text) {
  const t = String(text || '').toLowerCase();
  for (const k of ALIGN_ORDER) {
    if (t.includes(ALIGN[k].label.toLowerCase())) return k;
  }
  return null;
}

export function alignBarHtml(activeKey) {
  const cells = ALIGN_ORDER.map((k) => {
    const on = k === activeKey;
    return `
      <div title="${esc(ALIGN[k].label)}: ${esc(ALIGN[k].desc)}"
        style="flex:1;text-align:center;padding:7px 0;border-radius:6px;
          background:${on ? '#E60306' : '#111'};border:1px solid ${on ? '#E60306' : '#222'};
          color:${on ? '#fff' : '#666'};font-family:'Bebas Neue',sans-serif;
          font-size:15px;letter-spacing:1px;">
        ${k}
      </div>`;
  }).join('');
  const label = activeKey
    ? `<div style="font-size:10px;letter-spacing:2px;color:#AAAAAA;margin-top:6px;text-align:center;">
         ${esc(ALIGN[activeKey].label.toUpperCase())} · ${esc(ALIGN[activeKey].desc)}
       </div>`
    : '';
  return `
    <div style="margin:12px 0 4px;">
      <div style="display:flex;gap:6px;">${cells}</div>
      ${label}
    </div>`;
}

// ─── Hours Log tab ────────────────────────────────────────────────────────

function fmtHours(minutes) {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function statusChip(status) {
  const map = {
    submitted: ['PENDING', '#8a6d1a'],
    approved: ['APPROVED', '#1e6b2f'],
    rejected: ['REJECTED', '#7a1f1f']
  };
  const [label, color] = map[status] || [String(status || '').toUpperCase(), '#333'];
  return `<span style="font-size:10px;letter-spacing:1px;color:#fff;background:${color};
    border-radius:4px;padding:2px 7px;">${esc(label)}</span>`;
}

function hoursTabHtml() {
  return '<div id="clc-hours-tab"><p style="color:#888;font-size:13px;">Loading your hour log…</p></div>';
}

async function renderHoursTab(root) {
  const slot = root.querySelector('#clc-hours-tab');
  if (!slot) return;
  if (!firebaseReady || !auth.currentUser) {
    slot.innerHTML = '<p style="color:#888;font-size:13px;">Sign in to log your coaching hours.</p>';
    return;
  }
  const uid = auth.currentUser.uid;
  let entries = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'users', uid, 'coachingHours'), orderBy('createdAt', 'desc')));
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[clc] hours load failed', e);
  }

  const approvedMin = entries.filter((e) => e.status === 'approved')
    .reduce((s, e) => s + (Number(e.minutes) || 0), 0);
  const pendingMin = entries.filter((e) => e.status === 'submitted')
    .reduce((s, e) => s + (Number(e.minutes) || 0), 0);
  const goalMin = 25 * 60;
  const pct = Math.min(100, Math.round((approvedMin / goalMin) * 100));

  const rows = entries.map((e) => `
    <div style="display:flex;gap:12px;align-items:center;padding:12px 14px;background:#111;border:1px solid #1E1E1E;border-radius:8px;">
      <div style="flex:1;min-width:0;">
        <div style="color:#EEE;font-size:13px;">${esc(e.clientLabel || 'Practice client')}</div>
        <div style="color:#777;font-size:11px;">${esc(e.date || '')}${e.notes ? ' · ' + esc(e.notes) : ''}</div>
      </div>
      <div style="color:#CCC;font-size:13px;flex-shrink:0;">${fmtHours(Number(e.minutes) || 0)}</div>
      ${statusChip(e.status)}
    </div>`).join('');

  slot.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:6px;letter-spacing:0.5px;">PRACTICE HOUR LOG</h2>
      <p style="color:#AAAAAA;font-size:13px;margin:0;">Certification requires 25 approved practice coaching hours. Log each session here; your program admin reviews and approves them.</p>
    </div>
    <div style="background:#111;border:1px solid #222;border-radius:12px;padding:18px;margin-bottom:18px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#AAA;margin-bottom:8px;">
        <span>${fmtHours(approvedMin)} approved of 25h${pendingMin ? ` · ${fmtHours(pendingMin)} pending review` : ''}</span>
        <span>${pct}%</span>
      </div>
      <div style="height:8px;background:#0D0D0D;border-radius:4px;overflow:hidden;">
        <div style="height:100%;width:${pct}%;background:#E60306;"></div>
      </div>
    </div>
    <form id="clc-hours-form" style="background:#111;border:1px solid #222;border-radius:12px;padding:18px;margin-bottom:18px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1;font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;">LOG A SESSION</div>
      <label style="font-size:12px;color:#AAA;">Date
        <input name="date" type="date" required style="display:block;width:100%;margin-top:4px;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;box-sizing:border-box;">
      </label>
      <label style="font-size:12px;color:#AAA;">Length (minutes)
        <input name="minutes" type="number" min="15" max="600" step="5" value="60" required style="display:block;width:100%;margin-top:4px;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;box-sizing:border-box;">
      </label>
      <label style="grid-column:1/-1;font-size:12px;color:#AAA;">Client (first name or initials only)
        <input name="clientLabel" type="text" maxlength="60" required placeholder="e.g. Sarah M." style="display:block;width:100%;margin-top:4px;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;box-sizing:border-box;">
      </label>
      <label style="grid-column:1/-1;font-size:12px;color:#AAA;">Session notes (optional)
        <input name="notes" type="text" maxlength="200" placeholder="Focus of the session" style="display:block;width:100%;margin-top:4px;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;color:#fff;padding:8px 10px;font-size:13px;box-sizing:border-box;">
      </label>
      <div style="grid-column:1/-1;display:flex;align-items:center;gap:12px;">
        <button type="submit" style="background:#E60306;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13px;cursor:pointer;">Log hours</button>
        <span id="clc-hours-msg" style="font-size:12px;color:#888;"></span>
      </div>
    </form>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${rows || '<p style="color:#777;font-size:13px;">No sessions logged yet. Your first practice session goes here.</p>'}
    </div>`;

  const form = slot.querySelector('#clc-hours-form');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const msg = slot.querySelector('#clc-hours-msg');
    const fd = new FormData(form);
    try {
      msg.textContent = 'Saving…';
      await addDoc(collection(db, 'users', uid, 'coachingHours'), {
        date: String(fd.get('date') || ''),
        minutes: Number(fd.get('minutes')) || 0,
        clientLabel: String(fd.get('clientLabel') || '').trim(),
        notes: String(fd.get('notes') || '').trim(),
        courseSlug: CLC_SLUG,
        status: 'submitted',
        createdAt: serverTimestamp()
      });
      await renderHoursTab(root);
    } catch (e) {
      console.warn('[clc] hours save failed', e);
      msg.textContent = 'Could not save. Check the fields and try again.';
    }
  });
}

// ─── Certification tab ────────────────────────────────────────────────────

function certTabHtml() {
  return '<div id="clc-cert-tab"><p style="color:#888;font-size:13px;">Loading your certification status…</p></div>';
}

function checkRow(done, label, detail) {
  return `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:13px 15px;background:#111;border:1px solid #1E1E1E;border-radius:8px;">
      <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;
        font-size:12px;color:#fff;background:${done ? '#1e6b2f' : '#333'};">${done ? '✓' : ''}</span>
      <div>
        <div style="color:#EEE;font-size:13px;">${esc(label)}</div>
        ${detail ? `<div style="color:#888;font-size:12px;margin-top:2px;">${detail}</div>` : ''}
      </div>
    </div>`;
}

async function renderCertTab(root, course) {
  const slot = root.querySelector('#clc-cert-tab');
  if (!slot) return;
  if (!firebaseReady || !auth.currentUser) {
    slot.innerHTML = '<p style="color:#888;font-size:13px;">Sign in to see your certification status.</p>';
    return;
  }
  let status = null;
  try {
    const res = await httpsCallable(functions, 'getCertificationStatus')({ slug: CLC_SLUG });
    status = res.data;
  } catch (e) {
    console.warn('[clc] status load failed', e);
    slot.innerHTML = '<p style="color:#888;font-size:13px;">Could not load your certification status. Refresh to try again.</p>';
    return;
  }

  const examDetail = status.examPassed
    ? 'Passed.'
    : `${status.attemptsUsed} of ${status.attemptsAllowed} attempts used. Passing score is 80 percent.`;
  const capstoneDetail = status.capstoneApproved
    ? 'Reviewed and approved.'
    : (status.capstoneSubmitted ? 'Submitted. Awaiting review.' : 'Submit a recording link below.');
  const hoursDetail = `${status.approvedHours} of ${status.requiredHours} hours approved` +
    (status.pendingHours ? ` (${status.pendingHours}h pending review)` : '') +
    '. Log sessions in the Hours Log tab.';

  const certifiedBanner = status.certified ? `
    <div style="background:#0f2417;border:1px solid #1e6b2f;border-radius:12px;padding:18px;margin-bottom:18px;">
      <div style="font-size:10px;letter-spacing:2px;color:#4caf6d;font-weight:600;margin-bottom:6px;">CERTIFIED</div>
      <p style="color:#CFE9D6;font-size:13px;margin:0 0 10px;">
        You are a 1P Certified Life Coach. Certificate ${esc(status.certification.certNumber)}.
        Your A.L.I.G.N. Practitioner License is valid through
        ${esc(status.certification.licenseExpiresAt ? new Date(status.certification.licenseExpiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '')}.
      </p>
      <a href="/certificate.html?course=${CLC_SLUG}" style="color:#fff;background:#1e6b2f;border-radius:8px;padding:8px 14px;font-size:13px;text-decoration:none;">View your certificate →</a>
    </div>` : '';

  slot.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:6px;letter-spacing:0.5px;">YOUR CERTIFICATION</h2>
      <p style="color:#AAAAAA;font-size:13px;margin:0;">Four requirements stand between you and the credential. Every one of them is reviewed, not self-marked. That is what makes it worth holding.</p>
    </div>
    ${certifiedBanner}
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:22px;">
      ${checkRow(true, 'Complete all eight modules', 'Tracked as you mark modules complete in the course.')}
      ${checkRow(status.examPassed, 'Pass the written exam', esc(examDetail))}
      ${checkRow(status.capstoneApproved, 'Recorded coaching session reviewed against the rubric', esc(capstoneDetail))}
      ${checkRow(status.hoursMet, `Log ${status.requiredHours} approved practice coaching hours`, esc(hoursDetail))}
    </div>
    <div id="clc-exam-area" style="margin-bottom:22px;">
      ${status.examPassed ? '' : `
      <button id="clc-exam-start" style="background:#E60306;color:#fff;border:none;border-radius:8px;padding:11px 18px;font-size:13px;cursor:pointer;">
        ${status.attemptsUsed > 0 ? 'Retake the written exam →' : 'Start the written exam →'}
      </button>
      <span id="clc-exam-msg" style="font-size:12px;color:#888;margin-left:10px;"></span>`}
    </div>
    ${status.capstoneApproved ? '' : `
    <form id="clc-capstone-form" style="background:#111;border:1px solid #222;border-radius:12px;padding:18px;">
      <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:8px;">SUBMIT YOUR RECORDED SESSION</div>
      <p style="color:#AAA;font-size:12px;margin:0 0 12px;">Record one full coaching session (Zoom, Loom, or a shared drive), with your client's written permission, and paste the link here. It is scored against the published rubric in Module 8.</p>
      <input name="sessionUrl" type="url" required placeholder="https://..." style="display:block;width:100%;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;color:#fff;padding:9px 11px;font-size:13px;box-sizing:border-box;margin-bottom:10px;">
      <input name="notes" type="text" maxlength="300" placeholder="Anything your reviewer should know (optional)" style="display:block;width:100%;background:#0D0D0D;border:1px solid #2A2A2A;border-radius:8px;color:#fff;padding:9px 11px;font-size:13px;box-sizing:border-box;margin-bottom:12px;">
      <button type="submit" style="background:#E60306;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13px;cursor:pointer;">Submit for review</button>
      <span id="clc-capstone-msg" style="font-size:12px;color:#888;margin-left:10px;"></span>
    </form>`}
  `;

  const startBtn = slot.querySelector('#clc-exam-start');
  if (startBtn) {
    startBtn.addEventListener('click', () => beginExam(root, course));
  }
  const capForm = slot.querySelector('#clc-capstone-form');
  if (capForm) {
    capForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const msg = slot.querySelector('#clc-capstone-msg');
      const fd = new FormData(capForm);
      try {
        msg.textContent = 'Submitting…';
        await addDoc(collection(db, 'users', auth.currentUser.uid, 'capstone'), {
          courseSlug: CLC_SLUG,
          sessionUrl: String(fd.get('sessionUrl') || '').trim(),
          notes: String(fd.get('notes') || '').trim(),
          status: 'submitted',
          submittedAt: serverTimestamp()
        });
        await renderCertTab(root, course);
      } catch (e) {
        console.warn('[clc] capstone submit failed', e);
        msg.textContent = 'Could not submit. Check the link and try again.';
      }
    });
  }
}

async function beginExam(root, course) {
  const slot = root.querySelector('#clc-cert-tab');
  const msg = slot.querySelector('#clc-exam-msg');
  try {
    if (msg) msg.textContent = 'Preparing your exam…';
    const res = await httpsCallable(functions, 'startExam')({ slug: CLC_SLUG });
    renderExam(root, course, res.data);
  } catch (e) {
    console.warn('[clc] startExam failed', e);
    if (msg) msg.textContent = (e && e.message) || 'Could not start the exam.';
  }
}

function renderExam(root, course, exam) {
  const slot = root.querySelector('#clc-cert-tab');
  const qHtml = exam.questions.map((q, i) => `
    <div style="background:#111;border:1px solid #222;border-radius:12px;padding:16px;">
      <div style="color:#EEE;font-size:14px;margin-bottom:10px;"><b>${i + 1}.</b> ${esc(q.prompt)}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${q.choices.map((c, ci) => `
          <label style="display:flex;gap:10px;align-items:flex-start;color:#CCC;font-size:13px;cursor:pointer;">
            <input type="radio" name="q_${esc(q.id)}" value="${ci}" style="margin-top:2px;">
            <span>${esc(c)}</span>
          </label>`).join('')}
      </div>
    </div>`).join('');

  slot.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:#fff;margin-bottom:6px;letter-spacing:0.5px;">WRITTEN EXAM</h2>
      <p style="color:#AAAAAA;font-size:13px;margin:0;">${exam.questions.length} questions. Passing score is ${exam.passingScorePercent} percent. Attempt ${exam.attemptsUsed + 1} of ${exam.attemptsAllowed}. Take your time; there is no timer.</p>
    </div>
    <form id="clc-exam-form" style="display:flex;flex-direction:column;gap:12px;">
      ${qHtml}
      <div style="display:flex;align-items:center;gap:12px;margin-top:6px;">
        <button type="submit" style="background:#E60306;color:#fff;border:none;border-radius:8px;padding:12px 20px;font-size:14px;cursor:pointer;">Submit exam</button>
        <span id="clc-exam-submit-msg" style="font-size:12px;color:#888;"></span>
      </div>
    </form>`;

  slot.querySelector('#clc-exam-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const smsg = slot.querySelector('#clc-exam-submit-msg');
    const answers = {};
    let unanswered = 0;
    exam.questions.forEach((q) => {
      const sel = slot.querySelector(`input[name="q_${CSS.escape(q.id)}"]:checked`);
      if (sel) answers[q.id] = Number(sel.value);
      else unanswered += 1;
    });
    if (unanswered > 0 && !window.confirm(`${unanswered} question${unanswered === 1 ? ' is' : 's are'} unanswered and will count as wrong. Submit anyway?`)) {
      return;
    }
    try {
      smsg.textContent = 'Grading…';
      const res = await httpsCallable(functions, 'submitExam')({ attemptId: exam.attemptId, answers });
      const r = res.data;
      slot.innerHTML = `
        <div style="background:${r.passed ? '#0f2417' : '#241010'};border:1px solid ${r.passed ? '#1e6b2f' : '#6b1e1e'};border-radius:12px;padding:22px;text-align:center;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:34px;color:#fff;margin-bottom:6px;">${r.score}%</div>
          <p style="color:#CCC;font-size:14px;margin:0 0 14px;">
            ${r.passed
              ? 'You passed the written exam. One requirement down.'
              : `Not this time. You need ${r.passingScorePercent} percent. Review the modules and come back ready.`}
          </p>
          <button id="clc-exam-back" style="background:#333;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;cursor:pointer;">Back to certification →</button>
        </div>`;
      slot.querySelector('#clc-exam-back').addEventListener('click', () => renderCertTab(root, course));
    } catch (e) {
      console.warn('[clc] submitExam failed', e);
      smsg.textContent = (e && e.message) || 'Could not submit.';
    }
  });
}

// ─── Sidebar footer: live weekly call ─────────────────────────────────────

async function cohortFooterHtml(course) {
  const cohort = (course && course.cohort) || {};
  let joinUrl = null;
  try {
    if (firebaseReady && auth.currentUser) {
      const snap = await getDoc(doc(db, 'courses', CLC_SLUG, 'private', 'cohort'));
      if (snap.exists()) joinUrl = snap.data().joinUrl || null;
    }
  } catch (e) { /* not enrolled or not configured */ }
  const when = [cohort.callDay, cohort.callTime].filter(Boolean).join(' · ');
  if (!when && !joinUrl) return '';
  return `
    <div style="padding:12px;background:#111;border:1px solid #222;border-radius:10px;">
      <div style="font-size:10px;letter-spacing:2px;color:#E60306;font-weight:600;margin-bottom:6px;">LIVE WEEKLY CALL</div>
      ${when ? `<div style="color:#CCC;font-size:12px;margin-bottom:${joinUrl ? '8px' : '0'};">${esc(when)}</div>` : ''}
      ${joinUrl ? `<a href="${esc(joinUrl)}" target="_blank" rel="noopener" style="color:#fff;background:#E60306;border-radius:6px;padding:6px 12px;font-size:12px;text-decoration:none;display:inline-block;">Join the call →</a>` : ''}
    </div>`;
}

// ─── Entry point ──────────────────────────────────────────────────────────

/**
 * Extras merged into the mountCoursePlayer config by course-renderer.js when
 * the course is 1p-clc. Returns { tabs, moduleHeaderHtml, sidebarFooterHtml }.
 */
export async function clcPlayerExtras(course) {
  const footer = await cohortFooterHtml(course);
  return {
    moduleHeaderHtml: (pm) => alignBarHtml(alignKeyFromText(pm && pm.eyebrow)),
    sidebarFooterHtml: footer ? () => footer : null,
    tabs: [
      {
        id: 'clc-hours',
        label: 'Hours Log',
        html: () => hoursTabHtml(),
        bind: (root) => { renderHoursTab(root); }
      },
      {
        id: 'clc-cert',
        label: 'Certification',
        html: () => certTabHtml(),
        bind: (root) => { renderCertTab(root, course); }
      }
    ]
  };
}
