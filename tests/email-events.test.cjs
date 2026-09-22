// Telnyx email delivery events → the vocabulary the CRM already stores.
//
// This is the piece that keeps a contact card honest after the provider
// switch: without it a Telnyx send shows as "sent" forever, and an
// unsubscribe in someone's mail client never suppresses them. What is worth
// pinning is the translation and the id routing, both of which are silent
// when wrong — the webhook still answers 200 and simply writes nothing.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('not found: ' + name);
  const bodyStart = src.indexOf(') {', i) + 2;
  let d = 0, started = false;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

function grabConst(name) {
  const i = src.indexOf(`const ${name} = {`);
  if (i < 0) throw new Error('not found: ' + name);
  const end = src.indexOf('\n};', i);
  return src.slice(i, end + 3);
}

const mod = {};
new Function('module', 'exports', [
  grabConst('TELNYX_EMAIL_EVENT_MAP'),
  grab('telnyxEmailEvent'),
  'module.exports = { telnyxEmailEvent, TELNYX_EMAIL_EVENT_MAP };'
].join('\n'))(mod, mod.exports = {});
const { telnyxEmailEvent } = mod.exports;

let fails = 0;
const t = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fails++; };

const META = { companyId: 'co1', contactId: 'ct1', emailId: 'em1', type: 'contact' };

// The messaging-style envelope: data.event_type + data.payload.
const wrapped = (type, payload = {}) => ({
  data: {
    id: 'ev_1',
    event_type: type,
    occurred_at: '2026-09-22T10:00:00Z',
    payload: { email_id: 'msg_1', metadata: META, ...payload }
  }
});

// The flat email-event envelope: data.type + data.email_id.
const flat = (type, extra = {}) => ({
  data: {
    id: 'ev_2',
    record_type: 'email_event',
    type,
    email_id: 'msg_2',
    occurred_at: '2026-09-22T11:00:00Z',
    metadata: META,
    ...extra
  }
});

// ── Vocabulary ────────────────────────────────────────────────────────────
t('delivered stays delivered', telnyxEmailEvent(wrapped('email.delivered')).event === 'delivered');
t('opened becomes open', telnyxEmailEvent(wrapped('email.opened')).event === 'open');
t('clicked becomes click', telnyxEmailEvent(wrapped('email.clicked')).event === 'click');
t('bounced becomes bounce', telnyxEmailEvent(wrapped('email.bounced')).event === 'bounce');
t('complained is a spam report, which is what suppresses a contact',
  telnyxEmailEvent(wrapped('email.complained')).event === 'spamreport');
t('unsubscribed becomes unsubscribe', telnyxEmailEvent(wrapped('email.unsubscribed')).event === 'unsubscribe');
t('failed is a drop, not a bounce — it never reached a receiving server',
  telnyxEmailEvent(wrapped('email.failed')).event === 'dropped');
t('rejected is also a drop', telnyxEmailEvent(flat('rejected')).event === 'dropped');
t('queued and sending both read as processed',
  telnyxEmailEvent(flat('queued')).event === 'processed'
  && telnyxEmailEvent(flat('sending')).event === 'processed');
t('an unmapped type passes through rather than being lost',
  telnyxEmailEvent(flat('daily_limit_exceeded')).event === 'daily_limit_exceeded');
t('an empty payload reports no type, so the handler can ignore it',
  telnyxEmailEvent({}).rawType === '');

// ── Envelope handling ─────────────────────────────────────────────────────
let e = telnyxEmailEvent(wrapped('email.delivered'));
t('the prefixed event type is unwrapped', e.rawType === 'delivered');
t('wrapped: routing metadata is found', e.metadata.contactId === 'ct1' && e.metadata.emailId === 'em1');
t('wrapped: message id is read', e.messageId === 'msg_1');
t('wrapped: the event id is kept for idempotent writes', e.eventId === 'ev_1');
t('wrapped: occurred_at is carried', e.occurredAt === '2026-09-22T10:00:00Z');

e = telnyxEmailEvent(flat('delivered'));
t('flat: type is read without a prefix', e.rawType === 'delivered' && e.event === 'delivered');
t('flat: routing metadata is found', e.metadata.companyId === 'co1');
t('flat: message id is read', e.messageId === 'msg_2');

// A body that is already the event, with no data wrapper at all.
e = telnyxEmailEvent({ type: 'opened', email_id: 'msg_3', metadata: META, id: 'ev_3' });
t('an unwrapped body is still understood', e.event === 'open' && e.messageId === 'msg_3');

// ── Recipient and detail extraction ───────────────────────────────────────
t('recipient comes from `recipient`',
  telnyxEmailEvent(wrapped('email.delivered', { recipient: 'a@b.com' })).email === 'a@b.com');
t('recipient falls back to the to list',
  telnyxEmailEvent(wrapped('email.delivered', { to: [{ email: 'c@d.com' }] })).email === 'c@d.com');
t('a to list of bare strings works too',
  telnyxEmailEvent(wrapped('email.delivered', { to: ['e@f.com'] })).email === 'e@f.com');
t('a click carries its url',
  telnyxEmailEvent(wrapped('email.clicked', { url: 'https://1p/x' })).url === 'https://1p/x');
t('a bounce carries its reason',
  telnyxEmailEvent(wrapped('email.bounced', { reason: 'mailbox full' })).reason === 'mailbox full');
t('a reason given as detail is still found',
  telnyxEmailEvent(wrapped('email.failed', { detail: 'no such domain' })).reason === 'no such domain');

// Missing metadata must not throw: an event for mail sent outside the CRM
// (a test from the dashboard) has nothing to route.
e = telnyxEmailEvent({ data: { type: 'delivered', email_id: 'msg_9' } });
t('an event with no metadata is safe to handle',
  e.event === 'delivered' && e.metadata && Object.keys(e.metadata).length === 0);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
