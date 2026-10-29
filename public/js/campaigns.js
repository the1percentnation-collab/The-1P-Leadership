// Campaigns page — list + detail + compose (draft / send now).
// Admin + owner only.
//
// A campaign is either plain (the text as written) or branded (the One
// Percent layout from email-layout-core.js). Branded is the default. The
// preview here and the server's send use the same renderer.

import { db, functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { renderTopbar } from './topbar.js';
import { getRoleInfo } from './roles.js';
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { STAGES, listCompanyAdmins, escapeHtml, fmtDateTime } from './crm.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import { renderCampaignEmail, DEFAULT_SIGNATURE } from './email-layout-core.js';

const $ = (id) => document.getElementById(id);

const state = {
  uid: null,
  role: null,
  companyId: null,
  campaigns: [],
  view: 'list',      // 'list' | 'detail'
  detailId: null,
  detailCampaign: null,
  detailEvents: [],
  admins: []
};

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`;
}

function statusBadge(status) {
  const s = status || 'draft';
  return `<span class="camp-status-badge camp-status-${escapeHtml(s)}">${escapeHtml(s)}</span>`;
}

function pct(num, denom) {
  if (!denom) return '—';
  const p = Math.round((num / denom) * 100);
  return p + '%';
}

// The email exactly as a recipient sees it, in a sandboxed frame. Plain
// campaigns get the same escaping the server applies.
function previewDoc(c) {
  if (c.layout === 'branded') return renderCampaignEmail(c);
  const body = escapeHtml(c.bodyText || '').replace(/\n/g, '<br/>');
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#fff;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;">${body}`
    + `<hr style="margin:28px 0 14px;border:none;border-top:1px solid #ddd;"><p style="font-size:12px;color:#777;">You are receiving this because you signed up with The One Percent Nation.<br><u>Unsubscribe from these emails</u>.</p></body></html>`;
}

function paintPreview(frame, c) {
  if (frame) frame.srcdoc = previewDoc(c);
}

async function sendTest(payload) {
  const call = httpsCallable(functions, 'sendCampaignTest');
  const res = await call(Object.assign({ companyId: state.companyId }, payload));
  return (res && res.data && res.data.to) || 'your inbox';
}

// ────────────────────────────────────────────────────────────────
// List view
// ────────────────────────────────────────────────────────────────
async function loadCampaigns() {
  const body = $('campaigns-body');
  body.innerHTML = '';
  try {
    const q = query(
      collection(db, 'companies', state.companyId, 'campaigns'),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const snap = await getDocs(q);
    state.campaigns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    try {
      const snap = await getDocs(collection(db, 'companies', state.companyId, 'campaigns'));
      state.campaigns = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.campaigns.sort((a, b) => {
        const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
    } catch (e2) {
      body.innerHTML = `<tr><td colspan="7" class="camp-empty">Load error: ${escapeHtml(e2.message || '')}</td></tr>`;
      return;
    }
  }
  renderCampaignList();
}

function renderCampaignList() {
  const body = $('campaigns-body');
  if (!state.campaigns.length) {
    body.innerHTML = `<tr><td colspan="7" class="camp-empty">No campaigns yet. Click "+ New Campaign" to create one.</td></tr>`;
    return;
  }
  body.innerHTML = state.campaigns.map((c) => {
    const stats = c.stats || {};
    const delivered = stats.delivered || 0;
    const opens = stats.opens || 0;
    const clicks = stats.clicks || 0;
    const rcpt = c.recipientCount != null ? c.recipientCount : '—';
    const openRate = c.status === 'sent' ? pct(opens, delivered || (c.acceptedCount || 0)) : '—';
    const clickRate = c.status === 'sent' ? pct(clicks, delivered || (c.acceptedCount || 0)) : '—';
    return `<tr>
      <td><a href="#" class="camp-name-link" data-view="${escapeHtml(c.id)}">${escapeHtml(c.name || '(untitled)')}</a></td>
      <td style="color:var(--white-dim);">${escapeHtml(c.subject || '—')}</td>
      <td>${statusBadge(c.status)}</td>
      <td style="font-family:var(--font-mono); font-size:11px; color:var(--gray-light);">${!c.sentAt && c.sendOn ? 'Send ' + escapeHtml(c.sendOn) : fmtDateTime(c.sentAt)}</td>
      <td class="num">${rcpt}</td>
      <td class="num">${opens} <span style="color:var(--gray-mid); font-size:10px;">${openRate !== '—' ? '(' + openRate + ')' : ''}</span></td>
      <td class="num">${clicks} <span style="color:var(--gray-mid); font-size:10px;">${clickRate !== '—' ? '(' + clickRate + ')' : ''}</span></td>
    </tr>`;
  }).join('');

  body.querySelectorAll('[data-view]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openDetail(a.getAttribute('data-view'));
    });
  });
}

// ────────────────────────────────────────────────────────────────
// Detail view
// ────────────────────────────────────────────────────────────────
async function openDetail(campaignId) {
  state.detailId = campaignId;
  state.view = 'detail';
  $('panel-list').style.display = 'none';
  $('panel-detail').style.display = 'block';
  await loadDetail();
}

function closeDetail() {
  state.view = 'list';
  state.detailId = null;
  state.detailCampaign = null;
  $('panel-list').style.display = 'block';
  $('panel-detail').style.display = 'none';
  loadCampaigns();
}

async function loadDetail() {
  if (!state.detailId) return;
  try {
    const snap = await getDoc(doc(db, 'companies', state.companyId, 'campaigns', state.detailId));
    if (!snap.exists()) {
      $('camp-d-name').textContent = 'Not found';
      return;
    }
    state.detailCampaign = { id: snap.id, ...snap.data() };
  } catch (e) {
    $('camp-d-name').textContent = 'Load error: ' + (e.message || e);
    return;
  }

  // Events
  try {
    const q = query(
      collection(db, 'companies', state.companyId, 'campaigns', state.detailId, 'events'),
      orderBy('timestamp', 'desc'),
      limit(200)
    );
    const snap = await getDocs(q);
    state.detailEvents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    try {
      const snap = await getDocs(collection(db, 'companies', state.companyId, 'campaigns', state.detailId, 'events'));
      state.detailEvents = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.detailEvents.sort((a, b) => {
        const ta = a.timestamp && a.timestamp.toMillis ? a.timestamp.toMillis() : 0;
        const tb = b.timestamp && b.timestamp.toMillis ? b.timestamp.toMillis() : 0;
        return tb - ta;
      });
    } catch (e2) {
      state.detailEvents = [];
    }
  }

  renderDetail();
}

function renderDetail() {
  const c = state.detailCampaign;
  if (!c) return;
  $('camp-d-name').textContent = c.name || '(untitled)';
  const bits = [];
  if (c.fromName) bits.push('From: ' + c.fromName);
  if (c.createdAt) bits.push('Created ' + fmtDateTime(c.createdAt));
  if (c.sentAt) bits.push('Sent ' + fmtDateTime(c.sentAt));
  if (c.sendOn && !c.sentAt) bits.push('Send on ' + c.sendOn);
  const rf = c.recipientFilter || {};
  if (rf.excludeEnrolledIn) bits.push('Skips anyone already in ' + (rf.excludeEnrolledLabel || rf.excludeEnrolledIn));
  if (rf.excludeOwnersOf) bits.push('Skips anyone who already owns ' + (rf.excludeOwnersLabel || rf.excludeOwnersOf));
  $('camp-d-sub').textContent = bits.join(' · ');
  const st = $('camp-d-status');
  const s = c.status || 'draft';
  st.textContent = s;
  st.className = `camp-status-badge camp-status-${s}`;

  const stats = c.stats || {};
  const rcpt = c.recipientCount != null ? c.recipientCount : 0;
  const accepted = c.acceptedCount != null ? c.acceptedCount : 0;
  const failed = c.failedCount || 0;
  const delivered = stats.delivered || 0;
  const opens = stats.opens || 0;
  const clicks = stats.clicks || 0;

  $('camp-d-recipients').textContent = String(rcpt);
  $('camp-d-accepted').textContent = `${accepted} accepted · ${failed} failed`;
  $('camp-d-delivered').textContent = String(delivered);
  $('camp-d-delivered-rate').textContent = pct(delivered, rcpt);
  $('camp-d-opens').textContent = String(opens);
  $('camp-d-opens-rate').textContent = pct(opens, delivered || rcpt);
  $('camp-d-clicks').textContent = String(clicks);
  $('camp-d-clicks-rate').textContent = pct(clicks, delivered || rcpt);

  $('camp-d-subject').textContent = c.subject || '—';
  $('camp-d-body').textContent = c.bodyText || '(no body)';
  $('camp-d-design').textContent = c.layout === 'branded' ? 'Branded layout' : 'Plain text';
  paintPreview($('camp-d-preview'), c);

  // A saved draft can be tested and sent from here; a sent one cannot.
  const sendable = ['draft', 'ready'].includes(s);
  $('camp-d-actions').style.display = sendable ? '' : 'none';
  $('camp-d-action-msg').textContent = '';

  if (c.errorSample && c.errorSample.length) {
    $('camp-d-errors-wrap').style.display = '';
    $('camp-d-errors').textContent = c.errorSample.join('\n\n');
  } else {
    $('camp-d-errors-wrap').style.display = 'none';
  }

  const host = $('camp-d-events');
  if (!state.detailEvents.length) {
    host.innerHTML = `<div class="camp-empty">No events yet. Enable the SendGrid Event Webhook to receive delivery/open/click data.</div>`;
    return;
  }
  host.innerHTML = state.detailEvents.map((ev) => `
    <div class="camp-event-row">
      <span class="camp-event-type">${escapeHtml(ev.type || 'event')}</span>
      <span class="camp-event-email">${escapeHtml(ev.email || '—')}</span>
      <span class="camp-event-time">${fmtDateTime(ev.timestamp)}</span>
    </div>
  `).join('');
}

// ────────────────────────────────────────────────────────────────
// New campaign modal
// ────────────────────────────────────────────────────────────────
async function getAllTags() {
  try {
    const snap = await getDocs(collection(db, 'companies', state.companyId, 'contacts'));
    const tags = new Set();
    snap.docs.forEach((d) => {
      const t = d.data().tags;
      if (Array.isArray(t)) t.forEach((x) => x && tags.add(x));
    });
    return Array.from(tags).sort();
  } catch (e) { return []; }
}

async function openCampaignModal() {
  const root = $('modal-root');
  const [tags] = await Promise.all([getAllTags()]);

  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal camp-modal auth-card">
        <h1>New <span>Campaign</span></h1>
        <div class="camp-compose">
        <form id="camp-form" class="crm-form">
          <div class="crm-form-row">
            <label>Name (internal)</label>
            <input class="c-input" id="cf-name" required placeholder="e.g. Q2 product update" />
          </div>
          <div class="crm-form-row">
            <label>Subject</label>
            <input class="c-input" id="cf-subject" required placeholder="We have news for you" />
          </div>
          <div class="crm-form-row">
            <label>From name</label>
            <input class="c-input" id="cf-from-name" value="Anthony Brown Sr." />
            <div class="camp-from-hint">From: anthonybrown@the1pnation.com</div>
          </div>
          <div class="crm-form-row">
            <label>Design</label>
            <div class="camp-recipient-picker-opts">
              <label class="camp-recipient-opt camp-design-opt active"><input type="radio" name="dmode" value="branded" checked /> Branded</label>
              <label class="camp-recipient-opt camp-design-opt"><input type="radio" name="dmode" value="plain" /> Plain text</label>
            </div>
          </div>
          <div class="crm-form-row cf-branded-only">
            <label>Banner image URL (optional)</label>
            <input class="c-input" id="cf-hero" placeholder="https://the1pnation.com/assets/your-banner.jpg" />
            <div class="camp-from-hint">1200 × 628 works best. Tapping it opens your first button's link.</div>
          </div>
          <div class="crm-form-row cf-branded-only">
            <label>Preview text (optional)</label>
            <input class="c-input" id="cf-preheader" maxlength="140" placeholder="The line inboxes show after the subject" />
          </div>
          <div class="crm-form-row">
            <label>Body</label>
            <textarea class="c-textarea" id="cf-body" rows="12" required placeholder="Write your message here…"></textarea>
            <div class="camp-format-hint cf-branded-only">
              Blank line = new paragraph &nbsp;·&nbsp; <code># Heading</code> &nbsp;·&nbsp; <code>- list item</code> &nbsp;·&nbsp; <code>**bold**</code><br>
              A button on its own line: <code>[Get the Audiobook](https://the1pnation.com/icantaudio)</code>
            </div>
          </div>
          <div class="crm-form-row cf-branded-only">
            <label>Signature</label>
            <textarea class="c-textarea" id="cf-signature" rows="5"></textarea>
          </div>

          <div class="crm-form-row">
            <label>Recipients</label>
            <div class="camp-recipient-picker-opts">
              <label class="camp-recipient-opt active"><input type="radio" name="rmode" value="all_contacts" checked /> All CRM contacts</label>
              <label class="camp-recipient-opt"><input type="radio" name="rmode" value="stages" /> By stage</label>
              <label class="camp-recipient-opt"><input type="radio" name="rmode" value="tags" /> By tag</label>
              <label class="camp-recipient-opt"><input type="radio" name="rmode" value="owner" /> Assigned to admin</label>
              <label class="camp-recipient-opt"><input type="radio" name="rmode" value="all_users" /> All company members</label>
            </div>

            <div id="rd-stages" class="camp-recipient-detail" style="display:none;">
              ${STAGES.map((s) => `<label class="camp-recipient-checkbox"><input type="checkbox" data-stage="${s.id}" /> ${escapeHtml(s.label)}</label>`).join('')}
            </div>
            <div id="rd-tags" class="camp-recipient-detail" style="display:none;">
              ${tags.length
                ? tags.map((t) => `<label class="camp-recipient-checkbox"><input type="checkbox" data-tag="${escapeHtml(t)}" /> #${escapeHtml(t)}</label>`).join('')
                : '<span style="color:var(--gray-mid); font-size:12px;">No tags exist yet.</span>'}
            </div>
            <div id="rd-owner" class="camp-recipient-detail" style="display:none;">
              <select class="c-input crm-select" id="cf-owner-sel">
                ${state.admins.length
                  ? state.admins.map((a) => `<option value="${a.uid}">${escapeHtml(a.displayName || a.email || a.uid)}</option>`).join('')
                  : '<option value="">(no admins found)</option>'}
              </select>
            </div>
          </div>

          <div id="cf-err" class="auth-error" style="display:none;"></div>
          <div id="cf-msg" class="camp-action-msg"></div>

          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="cf-cancel">Cancel</button>
            <button type="button" class="btn btn-ghost" id="cf-test">Send test to me</button>
            <button type="button" class="btn btn-ghost" id="cf-draft">Save draft</button>
            <button type="submit" class="btn btn-primary" id="cf-send">Send now</button>
          </div>
        </form>
        <div class="camp-preview-col">
          <div class="camp-preview-label">Preview</div>
          <iframe id="cf-preview" class="camp-preview-frame" sandbox title="Email preview"></iframe>
        </div>
        </div>
      </div>
    </div>
  `;

  const close = () => { root.innerHTML = ''; };
  $('cf-signature').value = DEFAULT_SIGNATURE;
  $('cf-cancel').addEventListener('click', close);

  const designOpts = root.querySelectorAll('.camp-design-opt');
  const refresh = () => {
    const p = gatherPayload();
    root.querySelectorAll('.cf-branded-only').forEach((el) => { el.style.display = p.layout === 'branded' ? '' : 'none'; });
    designOpts.forEach((o) => o.classList.toggle('active', o.querySelector('input').checked));
    paintPreview($('cf-preview'), p);
  };
  let timer = null;
  const refreshSoon = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
  ['cf-subject', 'cf-body', 'cf-hero', 'cf-preheader', 'cf-signature'].forEach((id) => $(id).addEventListener('input', refreshSoon));
  root.querySelectorAll('input[name="dmode"]').forEach((r) => r.addEventListener('change', refresh));
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });

  const opts = root.querySelectorAll('.camp-recipient-opt:not(.camp-design-opt)');
  opts.forEach((opt) => {
    const radio = opt.querySelector('input[type="radio"]');
    radio.addEventListener('change', () => {
      opts.forEach((o) => o.classList.toggle('active', o === opt));
      $('rd-stages').style.display = radio.value === 'stages' ? '' : 'none';
      $('rd-tags').style.display = radio.value === 'tags' ? '' : 'none';
      $('rd-owner').style.display = radio.value === 'owner' ? '' : 'none';
    });
  });

  root.querySelectorAll('.camp-recipient-checkbox input').forEach((cb) => {
    cb.addEventListener('change', () => {
      cb.closest('.camp-recipient-checkbox').classList.toggle('checked', cb.checked);
    });
  });

  function gatherPayload() {
    const name = $('cf-name').value.trim();
    const subject = $('cf-subject').value.trim();
    const fromName = $('cf-from-name').value.trim() || 'The One Percent Nation';
    const bodyText = $('cf-body').value;
    const layout = root.querySelector('input[name="dmode"]:checked').value;
    const heroImageUrl = $('cf-hero').value.trim();
    const preheader = $('cf-preheader').value.trim();
    const signature = $('cf-signature').value;
    const mode = root.querySelector('input[name="rmode"]:checked').value;
    const filter = { mode };
    if (mode === 'stages') {
      filter.stages = Array.from(root.querySelectorAll('[data-stage]'))
        .filter((x) => x.checked).map((x) => x.getAttribute('data-stage'));
    } else if (mode === 'tags') {
      filter.tags = Array.from(root.querySelectorAll('[data-tag]'))
        .filter((x) => x.checked).map((x) => x.getAttribute('data-tag'));
    } else if (mode === 'owner') {
      filter.ownerUid = $('cf-owner-sel').value;
    }
    return { name, subject, fromName, bodyText, layout, heroImageUrl, preheader, signature, filter };
  }

  async function createDoc(status) {
    const { name, subject, fromName, bodyText, layout, heroImageUrl, preheader, signature, filter } = gatherPayload();
    if (!name || !subject || !bodyText.trim()) {
      $('cf-err').textContent = 'Name, subject, and body are required.';
      $('cf-err').style.display = 'block';
      return null;
    }
    const bodyHtml = bodyText
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');
    const payload = {
      name,
      subject,
      fromName,
      bodyHtml,
      bodyText,
      layout,
      ...(layout === 'branded' ? { heroImageUrl, preheader, signature } : {}),
      recipientFilter: filter,
      status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: state.uid,
      stats: { delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 }
    };
    const ref = await addDoc(collection(db, 'companies', state.companyId, 'campaigns'), payload);
    return ref.id;
  }

  $('cf-test').addEventListener('click', async () => {
    const p = gatherPayload();
    $('cf-err').style.display = 'none';
    if (!p.subject || !p.bodyText.trim()) {
      $('cf-err').textContent = 'Add a subject and a body first.';
      $('cf-err').style.display = 'block';
      return;
    }
    const btn = $('cf-test');
    btn.disabled = true;
    $('cf-msg').textContent = 'Sending test…';
    try {
      const to = await sendTest({ draft: p });
      $('cf-msg').textContent = `Test sent to ${to}. Check your inbox (and Promotions).`;
    } catch (err) {
      $('cf-msg').textContent = '';
      $('cf-err').textContent = 'Test failed: ' + (err.message || err);
      $('cf-err').style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  refresh();

  $('cf-draft').addEventListener('click', async () => {
    try {
      const id = await createDoc('draft');
      if (!id) return;
      close();
      await loadCampaigns();
    } catch (err) {
      $('cf-err').textContent = 'Save failed: ' + (err.message || err);
      $('cf-err').style.display = 'block';
    }
  });

  $('camp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { name, subject } = gatherPayload();
    if (!confirm(`Send "${name}" now with subject "${subject}"? This cannot be undone.`)) return;
    try {
      const id = await createDoc('ready');
      if (!id) return;
      const call = httpsCallable(functions, 'sendCampaign');
      await call({ companyId: state.companyId, campaignId: id });
      close();
      await loadCampaigns();
      openDetail(id);
    } catch (err) {
      $('cf-err').textContent = 'Send failed: ' + (err.message || err);
      $('cf-err').style.display = 'block';
    }
  });
}

// ────────────────────────────────────────────────────────────────
// Bootstrap
// ────────────────────────────────────────────────────────────────
async function resolveCompanyId(uid, info) {
  let companyId = info.companyId || null;
  if (!companyId && info.isAdmin) {
    try {
      // Multi-company aware: honors ?companyId=, remembers the last pick,
      // and never silently lands an admin of two companies in the wrong one.
      const resolved = await resolveCrmCompany(uid);
      if (resolved.companyId) companyId = resolved.companyId;
    } catch (e) {}
  }
  if (companyId) mountCrmCompanySwitcher(uid, companyId);
  return companyId;
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) {
    location.replace('/login.html?next=' + encodeURIComponent('/campaigns.html'));
    return;
  }
  const info = await getRoleInfo(true);
  state.uid = u.uid;
  state.role = info.role;
  renderTopbar({ user: u, role: info.role, currentPage: 'campaigns' });

  if (!info.isAdmin) {
    gate('Admin access required.');
    return;
  }

  const companyId = await resolveCompanyId(u.uid, info);
  if (!companyId) { gate('No company context. Ask the owner to create your company first.'); return; }
  state.companyId = companyId;

  try {
    state.admins = await listCompanyAdmins(companyId);
  } catch (e) { state.admins = []; }

  $('panel-list').style.display = 'block';
  await loadCampaigns();

  $('btn-new-campaign').addEventListener('click', openCampaignModal);
  $('camp-d-test').addEventListener('click', async () => {
    const btn = $('camp-d-test');
    btn.disabled = true;
    $('camp-d-action-msg').textContent = 'Sending test…';
    try {
      const to = await sendTest({ campaignId: state.detailId });
      $('camp-d-action-msg').textContent = `Test sent to ${to}. Check your inbox (and Promotions).`;
    } catch (err) {
      $('camp-d-action-msg').textContent = 'Test failed: ' + (err.message || err);
    } finally {
      btn.disabled = false;
    }
  });
  $('camp-d-send').addEventListener('click', async () => {
    const c = state.detailCampaign;
    if (!c) return;
    if (!confirm(`Send "${c.name || c.subject}" now with subject "${c.subject}"? This cannot be undone.`)) return;
    const btn = $('camp-d-send');
    btn.disabled = true;
    $('camp-d-action-msg').textContent = 'Sending…';
    try {
      const call = httpsCallable(functions, 'sendCampaign');
      const res = await call({ companyId: state.companyId, campaignId: state.detailId });
      const n = (res && res.data && res.data.recipientCount) || 0;
      $('camp-d-action-msg').textContent = `Sent to ${n} recipient${n === 1 ? '' : 's'}.`;
      await loadDetail();
    } catch (err) {
      $('camp-d-action-msg').textContent = 'Send failed: ' + (err.message || err);
    } finally {
      btn.disabled = false;
    }
  });
  $('camp-back-link').addEventListener('click', (e) => {
    e.preventDefault();
    closeDetail();
  });
}

main();
