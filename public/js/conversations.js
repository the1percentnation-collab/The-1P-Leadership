// Conversations — unified inbox (left) + thread (right). Admin/owner only.
//
// SMS threads open in place; email threads open on the contact card, which is
// where the composer and the full history already live. Duplicating the email
// thread UI here would mean two places to fix every time it changes, and the
// card is the better surface for it anyway.
//
// Email rows are derived from `lastEmailAt` / `emailUnreadCount` on the contact
// documents, which listContacts already loaded — asking Firestore for every
// contact's emails subcollection just to build a list would be one query per
// contact for information the parent document already carries.

import { db, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell, setCrmUnreadCount } from './crm-shell.js';
import { collection, getDocs, query, where, limit } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import { mountTemplatePicker } from './merge-fields.js';
import { dialer } from './dialer-core.js';
import {
  listConversations, listMessages, sendSms, markConversationRead,
  listContacts, escapeHtml, fmtDateTime, fmtDate, toDate
} from './crm.js';

const $ = (id) => document.getElementById(id);
const state = { uid: null, companyId: null, convs: [], contacts: {}, activeId: null, messages: [], rows: [] };

function ms(ts) {
  const d = toDate(ts);
  return d ? d.getTime() : 0;
}

/**
 * One list, both channels, newest first. An SMS thread and an email thread with
 * the same contact stay separate rows: they are different conversations and
 * merging them would imply a continuity that is not there.
 */
function buildRows() {
  const rows = [];
  state.convs.forEach((c) => {
    rows.push({
      kind: 'sms',
      id: c.id,
      contactId: c.contactId || c.id,
      name: contactName(c.contactId, c.contactPhone),
      sub: c.contactPhone || '',
      preview: (c.lastDirection === 'out' ? 'You: ' : '') + (c.lastMessageText || ''),
      at: ms(c.lastMessageAt),
      unread: Number(c.unreadCount) || 0
    });
  });
  Object.values(state.contacts).forEach((c) => {
    if (!c.lastEmailAt) return;
    rows.push({
      kind: 'email',
      id: 'em_' + c.id,
      contactId: c.id,
      name: c.name || c.email || 'Unknown',
      sub: c.email || '',
      preview: 'Email · ' + fmtDate(c.lastEmailAt),
      at: ms(c.lastEmailAt),
      unread: Number(c.emailUnreadCount) || 0
    });
  });
  rows.sort((a, b) => b.at - a.at);
  return rows;
}

function contactName(contactId, phone) {
  const c = state.contacts[contactId];
  return (c && c.name) || phone || 'Unknown';
}

function renderShellLayout() {
  $('crm-content').innerHTML = `
    <div class="sms-wrap">
      <div class="sms-list" id="sms-list"></div>
      <div class="sms-thread" id="sms-thread">
        <div class="crm-subpanel-empty" style="margin:auto;">Select a conversation.</div>
      </div>
    </div>`;
}

const CHANNEL_ICON = { sms: '\u{1F4AC}', email: '\u2709' };

function renderList() {
  const host = $('sms-list');
  state.rows = buildRows();
  if (!state.rows.length) {
    host.innerHTML = `<div class="crm-subpanel-empty" style="padding:16px;">No conversations yet. Texts and emails, sent or received, appear here.</div>`;
    return;
  }
  host.innerHTML = state.rows.map((r) => `
    <button class="sms-list-item ${r.id === state.activeId ? 'active' : ''}" data-row="${escapeHtml(r.id)}">
      <div class="sms-list-top">
        <span class="sms-chan" title="${r.kind === 'sms' ? 'Text message' : 'Email'}">${CHANNEL_ICON[r.kind]}</span>
        <span class="sms-list-name">${escapeHtml(r.name)}</span>
        ${r.unread ? `<span class="sms-unread">${r.unread}</span>` : ''}
      </div>
      <div class="sms-list-preview">${escapeHtml(r.preview.slice(0, 60))}</div>
    </button>`).join('');
  host.querySelectorAll('[data-row]').forEach((b) => b.addEventListener('click', () => {
    const row = state.rows.find((r) => r.id === b.getAttribute('data-row'));
    if (!row) return;
    // Email lives on the contact card, where the thread view and composer are.
    if (row.kind === 'email') {
      location.href = `/contact.html?id=${encodeURIComponent(row.contactId)}&compose=email`;
      return;
    }
    openThread(row.contactId);
  }));
}

async function openThread(convId) {
  state.activeId = convId;
  renderList();
  const conv = state.convs.find((c) => c.id === convId);
  const host = $('sms-thread');
  host.innerHTML = `<div class="crm-subpanel-empty" style="margin:auto;">Loading…</div>`;
  state.messages = await listMessages(state.companyId, convId);
  if (conv && conv.unreadCount) { markConversationRead(state.companyId, convId); conv.unreadCount = 0; renderList(); }

  host.innerHTML = `
    <div class="sms-thread-head">
      <a href="/contact.html?id=${encodeURIComponent(convId)}" class="sms-thread-name">${escapeHtml(contactName(convId, conv && conv.contactPhone))}</a>
      <span class="crm-mini-sub">${escapeHtml((conv && conv.contactPhone) || '')}</span>
      <span style="flex:1;"></span>
      <button class="crm-quick-btn" id="sms-call" ${state.contacts[convId] ? '' : 'disabled'} title="Call this contact">&#9742; Call</button>
    </div>
    <div class="sms-messages" id="sms-messages">
      ${state.messages.length ? state.messages.map((m) => `
        <div class="sms-bubble sms-${m.direction === 'out' ? 'out' : 'in'}">
          <div class="sms-bubble-body">${escapeHtml(m.body || '')}</div>
          <div class="sms-bubble-meta">${fmtDateTime(m.createdAt)}${m.status ? ' · ' + escapeHtml(m.status) : ''}</div>
        </div>`).join('') : '<div class="crm-subpanel-empty">No messages yet.</div>'}
    </div>
    <form class="sms-composer" id="sms-composer">
      <span id="sms-tpl"></span>
      <input class="c-input" id="sms-input" placeholder="Type a text…" autocomplete="off" />
      <button class="btn btn-primary" type="submit" id="sms-send">Send</button>
    </form>
    <div id="sms-err" class="auth-error" style="display:none;margin-top:8px;"></div>`;

  const msgs = $('sms-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;

  mountTemplatePicker({
    host: $('sms-tpl'), input: $('sms-input'), channel: 'sms',
    companyId: state.companyId,
    context: () => ({ contact: state.contacts[convId] || { phone: conv && conv.contactPhone } })
  });
  const callBtn = $('sms-call');
  if (callBtn) callBtn.addEventListener('click', async () => {
    const c = state.contacts[convId];
    if (!c) return;
    try { await dialer.callContact(c); }
    catch (err) { if (err && err.message !== 'Cancelled.') alert(err.message || err); }
  });

  $('sms-composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('sms-input');
    const text = input.value.trim();
    if (!text) return;
    const btn = $('sms-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    $('sms-err').style.display = 'none';
    try {
      await sendSms(state.companyId, convId, text);
      input.value = '';
      await refresh();
      await openThread(convId);
    } catch (err) {
      $('sms-err').textContent = err.message || String(err);
      $('sms-err').style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Send';
    }
  });
}

async function refresh() {
  state.convs = await listConversations(state.companyId);
  renderList();
}

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/conversations.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  state.uid = u.uid;

  const content = renderCrmShell({ active: 'conversations', title: 'Conversations', user: u, role: info.role });
  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
  if (!companyId && info.isAdmin) {
    try {
      // Multi-company aware: honors ?companyId=, remembers the last pick,
      // and never silently lands an admin of two companies in the wrong one.
      const resolved = await resolveCrmCompany(u.uid);
      if (resolved.companyId) companyId = resolved.companyId;
    } catch (e) {}
  }
  if (companyId) mountCrmCompanySwitcher(u.uid, companyId);
  if (!companyId) {
    content.innerHTML = `<div class="card"><div class="auth-error">You are not an admin of any company yet. Use /owner.html.</div></div>`;
    return;
  }
  state.companyId = companyId;
  content.innerHTML = `<div class="crm-section-sub">Loading conversations…</div>`;

  const contacts = await listContacts(companyId);
  contacts.forEach((c) => { state.contacts[c.id] = c; });
  setCrmUnreadCount(contacts.reduce((n, c) => n + (Number(c.emailUnreadCount) || 0), 0));
  try { await dialer.configure({ companyId, uid: u.uid }); } catch (e) {}
  renderShellLayout();
  await refresh();

  // Deep-link to a contact's thread: /conversations.html?contact=ID
  const target = new URLSearchParams(location.search).get('contact');
  if (target) openThread(target);
}

main();
