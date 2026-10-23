// Facebook Page Messenger: the pieces of the integration that do not touch
// Firestore, so they can be tested without an emulator.
//
// How it fits together (functions/index.js has the wiring):
//   - Meta calls metaMessengerWebhook for every message someone sends the
//     Page. That is the only way to learn their PSID (page-scoped id), and a
//     Page can only message a PSID, never a profile URL.
//   - Each sender becomes a messengerThreads/{psid} doc. Anthony links a
//     thread to a hand-sale order from the store console once; after that
//     invoices and reminders go out through the Send API.
//   - Meta's rule: a Page may message someone freely for 24 hours after their
//     last message to it. With the Human Agent permission approved, a person
//     (not automation) may reply for 7 days with the HUMAN_AGENT tag. Past
//     that the Page cannot reach them, and the console falls back to copying
//     the message for Anthony's own Messenger.
//
// Environment (functions/.env, written by the deploy workflow):
//   META_PAGE_ACCESS_TOKEN  long-lived Page token with pages_messaging
//   META_APP_SECRET         signs webhook deliveries (X-Hub-Signature-256)
//   META_VERIFY_TOKEN       any string; Meta echoes it when the webhook is added
//   META_HUMAN_AGENT        "1" once the Human Agent permission is approved
//   META_GRAPH_BASE         override for tests (default graph.facebook.com)
//   META_GRAPH_VERSION      Graph API version (default below)
const crypto = require('crypto');

const DAY = 86400000;
const DEFAULT_GRAPH_VERSION = 'v24.0';

function env(name) {
  return (process.env[name] || '').trim();
}

/** Which pieces are configured, and what is missing if not. */
function messengerConfig() {
  const token = env('META_PAGE_ACCESS_TOKEN');
  const appSecret = env('META_APP_SECRET');
  const missing = [];
  if (!token) missing.push('META_PAGE_ACCESS_TOKEN');
  if (!appSecret) missing.push('META_APP_SECRET');
  return {
    token,
    appSecret,
    verifyToken: env('META_VERIFY_TOKEN'),
    humanAgent: env('META_HUMAN_AGENT') === '1',
    base: (env('META_GRAPH_BASE') || 'https://graph.facebook.com').replace(/\/+$/, ''),
    version: env('META_GRAPH_VERSION') || DEFAULT_GRAPH_VERSION,
    missing,
    ok: missing.length === 0
  };
}

/**
 * Meta signs each delivery with HMAC-SHA256 of the raw body under the app
 * secret: `X-Hub-Signature-256: sha256=<hex>`. Fails closed on anything
 * missing or malformed.
 */
function signatureOk(rawBody, header, appSecret) {
  if (!rawBody || !header || !appSecret) return false;
  const m = String(header).match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const want = crypto.createHmac('sha256', appSecret).update(rawBody).digest();
  const got = Buffer.from(m[1], 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * The messages people sent the Page, out of one webhook delivery. Echoes (the
 * Page's own sends), reads, deliveries and reactions are dropped. A message
 * with only attachments still counts: it reopens the 24-hour window.
 */
function inboundMessages(body) {
  if (!body || body.object !== 'page' || !Array.isArray(body.entry)) return [];
  const out = [];
  for (const entry of body.entry) {
    for (const ev of entry.messaging || []) {
      const msg = ev && ev.message;
      if (!msg || msg.is_echo || !ev.sender || !ev.sender.id) continue;
      const attachments = Array.isArray(msg.attachments) ? msg.attachments.map((a) => a && a.type).filter(Boolean) : [];
      out.push({
        pageId: String((ev.recipient && ev.recipient.id) || entry.id || ''),
        psid: String(ev.sender.id),
        mid: String(msg.mid || `in_${ev.sender.id}_${ev.timestamp || Date.now()}`),
        text: String(msg.text || (attachments.length ? `[${attachments.join(', ')}]` : '')).slice(0, 4000),
        at: Number(ev.timestamp) || Date.now()
      });
    }
  }
  return out;
}

/**
 * How (or whether) the Page may message someone whose last message to it was
 * at `lastInboundMs`. Returns the Send API fields, or { error } saying why not.
 */
function sendPlan(lastInboundMs, now = Date.now(), { humanAgent = false } = {}) {
  if (!lastInboundMs) {
    return { error: 'They have not messaged the Page yet, so Facebook will not let the Page message them.' };
  }
  const age = now - lastInboundMs;
  if (age <= DAY) return { messaging_type: 'RESPONSE' };
  if (humanAgent && age <= 7 * DAY) return { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' };
  return {
    error: humanAgent
      ? 'Their last message to the Page was over 7 days ago, past what Facebook allows. Copy the message and send it from your own Messenger.'
      : 'Their last message to the Page was over 24 hours ago, so Facebook will not let the Page message them. Copy the message and send it from your own Messenger.'
  };
}

/** Open window, as the console shows it: when it closes, or null if closed. */
function windowClosesAt(lastInboundMs, now = Date.now(), { humanAgent = false } = {}) {
  if (!lastInboundMs) return null;
  const closes = lastInboundMs + (humanAgent ? 7 : 1) * DAY;
  return closes > now ? closes : null;
}

/**
 * POST /me/messages. Throws with Meta's own error message, plus `code` and
 * `subcode` so callers can tell a closed window from a bad token.
 */
async function sendText(cfg, psid, text, plan, fetchImpl = fetch) {
  const body = {
    recipient: { id: psid },
    messaging_type: plan.messaging_type,
    message: { text: String(text).slice(0, 2000) }
  };
  if (plan.tag) body.tag = plan.tag;
  const res = await fetchImpl(`${cfg.base}/${cfg.version}/me/messages?access_token=${encodeURIComponent(cfg.token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON error page */ }
  if (!res.ok || !json || json.error) {
    const err = (json && json.error) || {};
    const e = new Error(err.message || `Messenger send failed (HTTP ${res.status})`);
    e.code = err.code;
    e.subcode = err.error_subcode;
    throw e;
  }
  return { mid: json.message_id || null, psid: json.recipient_id || psid };
}

/** Best effort: the sender's name, when the token is allowed to read it. */
async function fetchProfile(cfg, psid, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${cfg.base}/${cfg.version}/${encodeURIComponent(psid)}?fields=first_name,last_name,name&access_token=${encodeURIComponent(cfg.token)}`);
    if (!res.ok) return null;
    const j = await res.json();
    const name = j.name || [j.first_name, j.last_name].filter(Boolean).join(' ');
    return name ? { name: String(name).slice(0, 120) } : null;
  } catch (e) {
    return null;
  }
}

/**
 * Threads most likely to be this order's buyer, best first: exact name
 * matches, then first-name matches, then the rest by recency.
 */
function rankThreads(threads, buyerName) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const want = norm(buyerName);
  const first = want.split(' ')[0];
  const score = (t) => {
    const n = norm(t.name);
    if (want && n === want) return 2;
    if (first && n.split(' ')[0] === first) return 1;
    return 0;
  };
  return [...(threads || [])]
    .map((t) => ({ ...t, match: score(t) }))
    .sort((a, b) => (b.match - a.match) || ((b.lastInboundMs || 0) - (a.lastInboundMs || 0)));
}

module.exports = {
  DAY, DEFAULT_GRAPH_VERSION,
  messengerConfig, signatureOk, inboundMessages, sendPlan, windowClosesAt, sendText, fetchProfile, rankThreads
};
