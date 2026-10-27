// Exercise the inbound-email parsers against the real shipped code, extracted
// from functions/index.js so a change there cannot quietly break routing.
//
// Run: node tests/inbound-email.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('function parseMultipartFields');
const end = src.indexOf('exports.inboundEmailWebhook');
assert.ok(start > 0 && end > start, 'could not locate the inbound email parsers');
const code = src.slice(start, end);

const fn = new Function('Buffer', 'String', 'Number', 'JSON',
  code + '\nreturn { parseMultipartFields, parseAddress, parseReplyRouting, stripQuotedReply };');
const { parseMultipartFields, parseAddress, parseReplyRouting, stripQuotedReply } =
  fn(Buffer, String, Number, JSON);

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// ── parseMultipartFields ────────────────────────────────────────────────────
const BOUNDARY = 'xYzBoundary123';
function multipart(fields, attachments = []) {
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  for (const a of attachments) {
    chunks.push(Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${a.name}"; filename="${a.filename}"\r\n`
      + `Content-Type: application/octet-stream\r\n\r\n${a.body}\r\n`, 'utf8'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}
const CT = `multipart/form-data; boundary=${BOUNDARY}`;

console.log('parseMultipartFields');
ok('reads every text field', () => {
  const f = parseMultipartFields(multipart({
    to: 'reply+cid1.contact9@reply.the1pnation.com',
    from: 'Jane Lead <jane@example.com>',
    subject: 'Re: Following up',
    text: 'Sounds good.'
  }), CT);
  assert.strictEqual(f.to, 'reply+cid1.contact9@reply.the1pnation.com');
  assert.strictEqual(f.subject, 'Re: Following up');
  assert.strictEqual(f.text, 'Sounds good.');
});

ok('keeps a body that contains blank lines intact', () => {
  const body = 'Line one\r\n\r\nLine three';
  const f = parseMultipartFields(multipart({ text: body }), CT);
  assert.strictEqual(f.text, body);
});

ok('skips attachment parts', () => {
  const f = parseMultipartFields(
    multipart({ text: 'see attached' }, [{ name: 'attachment1', filename: 'deck.pdf', body: 'PDFBYTES' }]), CT);
  assert.strictEqual(f.text, 'see attached');
  assert.strictEqual(f.attachment1, undefined);
});

ok('handles a quoted boundary in the content type', () => {
  const f = parseMultipartFields(multipart({ subject: 'Hi' }), `multipart/form-data; boundary="${BOUNDARY}"`);
  assert.strictEqual(f.subject, 'Hi');
});

ok('returns nothing rather than throwing on junk', () => {
  assert.deepStrictEqual(parseMultipartFields(null, CT), {});
  assert.deepStrictEqual(parseMultipartFields(Buffer.from('nope'), 'text/plain'), {});
});

// ── parseAddress ────────────────────────────────────────────────────────────
console.log('parseAddress');
ok('splits a display name from the address', () => {
  assert.deepStrictEqual(parseAddress('Jane Lead <Jane@Example.com>'), { name: 'Jane Lead', email: 'jane@example.com' });
});
ok('accepts a bare address', () => {
  assert.deepStrictEqual(parseAddress('jane@example.com'), { name: null, email: 'jane@example.com' });
});
ok('strips quotes around a display name', () => {
  assert.strictEqual(parseAddress('"Brown, Anthony" <a@b.com>').name, 'Brown, Anthony');
});
ok('rejects a non-address', () => {
  assert.strictEqual(parseAddress('not an address').email, null);
});

// ── parseReplyRouting ───────────────────────────────────────────────────────
console.log('parseReplyRouting');
ok('extracts companyId and contactId', () => {
  assert.deepStrictEqual(
    parseReplyRouting(['reply+comp1.cont2@reply.the1pnation.com']),
    { companyId: 'comp1', contactId: 'cont2' });
});
ok('finds the routing address when it is not first', () => {
  assert.deepStrictEqual(
    parseReplyRouting(['Someone <other@x.com>', ' reply+comp1.cont2@reply.the1pnation.com ']),
    { companyId: 'comp1', contactId: 'cont2' });
});
ok('returns null when no routing address is present', () => {
  assert.strictEqual(parseReplyRouting(['anthonybrown@the1pnation.com']), null);
});

// ── stripQuotedReply ────────────────────────────────────────────────────────
console.log('stripQuotedReply');
ok('cuts the Gmail quote marker', () => {
  const s = stripQuotedReply('Yes, Tuesday works.\n\nOn Mon, Sep 15, 2026 at 9:02 AM Anthony Brown <a@b.com> wrote:\n> original\n');
  assert.strictEqual(s, 'Yes, Tuesday works.');
});
ok('cuts the Outlook original-message marker', () => {
  assert.strictEqual(stripQuotedReply('Sounds good.\n-----Original Message-----\nFrom: Anthony'), 'Sounds good.');
});
ok('leaves an unquoted message whole', () => {
  const body = 'Hi Anthony,\n\nCan we move to Thursday?\n\nJane';
  assert.strictEqual(stripQuotedReply(body), body);
});
ok('never returns empty when the marker is the whole message', () => {
  const only = '\nOn Mon, Sep 15, 2026 at 9:02 AM Anthony Brown <a@b.com> wrote:\n> original\n';
  assert.ok(stripQuotedReply(only).length > 0);
});

// ── telnyxInboundEmail (Telnyx email.received → recordInboundEmail) ────────
const tStart = src.indexOf('function telnyxInboundEmail');
const tEnd = src.indexOf('exports.telnyxEmailEventWebhook');
assert.ok(tStart > 0 && tEnd > tStart, 'could not locate telnyxInboundEmail');
const { telnyxInboundEmail } = new Function('parseAddress', 'String', 'Object', 'Array', 'RegExp',
  src.slice(tStart, tEnd) + '\nreturn { telnyxInboundEmail };')(parseAddress, String, Object, Array, RegExp);

console.log('telnyxInboundEmail');

ok('reads the Telnyx v2 envelope with string addresses', () => {
  const m = telnyxInboundEmail({ data: { event_type: 'email.received', id: 'evt_1', payload: {
    id: 'msg_1', from: 'Jo Lead <Jo@Lead.com>', to: ['reply@reply.the1pnation.com'],
    subject: 'Re: Your call', text: 'Sounds good', html: '<p>Sounds good</p>',
    headers: { 'Message-ID': '<a@lead.com>', 'In-Reply-To': '<b@the1pnation.com>' } } } });
  assert.deepStrictEqual(m.from, { name: 'Jo Lead', email: 'jo@lead.com' });
  assert.strictEqual(m.subject, 'Re: Your call');
  assert.strictEqual(m.text, 'Sounds good');
  assert.strictEqual(m.html, '<p>Sounds good</p>');
  assert.deepStrictEqual(m.recipients, ['reply@reply.the1pnation.com']);
  assert.strictEqual(m.messageId, '<a@lead.com>');
  assert.strictEqual(m.inReplyTo, '<b@the1pnation.com>');
  assert.strictEqual(m.dedupeId, 'msg_1');
});

ok('reads object addresses, *_body fields and a nested email object', () => {
  const m = telnyxInboundEmail({ data: { id: 'evt_2', payload: { email: {
    from: { email: 'sam@x.com', name: 'Sam' }, to: [{ address: 'reply@reply.the1pnation.com' }],
    cc: [{ email: 'boss@x.com', name: 'Boss' }], subject: 'Hi',
    text_body: 'plain', html_body: '<b>rich</b>', message_id: '<m@x.com>' } } } });
  assert.deepStrictEqual(m.from, { name: 'Sam', email: 'sam@x.com' });
  assert.deepStrictEqual(m.recipients, ['reply@reply.the1pnation.com', 'Boss <boss@x.com>']);
  assert.strictEqual(m.text, 'plain');
  assert.strictEqual(m.html, '<b>rich</b>');
  assert.strictEqual(m.messageId, '<m@x.com>');
  assert.strictEqual(m.dedupeId, '<m@x.com>', 'falls back to the message id when there is no Telnyx id');
});

ok('reads headers as a [{name, value}] list or a raw blob', () => {
  const a = telnyxInboundEmail({ data: { payload: { from: 'a@x.com', headers: [
    { name: 'In-Reply-To', value: '<orig@the1pnation.com>' }] } } });
  assert.strictEqual(a.inReplyTo, '<orig@the1pnation.com>');
  const b = telnyxInboundEmail({ data: { payload: { from: 'a@x.com',
    headers: 'Received: x\r\nMessage-ID: <blob@x.com>\r\nIn-Reply-To: <o@the1pnation.com>\r\n' } } });
  assert.strictEqual(b.messageId, '<blob@x.com>');
  assert.strictEqual(b.inReplyTo, '<o@the1pnation.com>');
});

ok('a payload with no body still yields a sender and the field names', () => {
  const m = telnyxInboundEmail({ data: { payload: { id: 'm3', from: 'a@x.com', subject: 'Hi', attachments: [] } } });
  assert.strictEqual(m.text, null);
  assert.strictEqual(m.html, null);
  assert.strictEqual(m.from.email, 'a@x.com');
  assert.ok(m.fieldNames.includes('attachments'));
});

ok('a missing or junk sender gives no email, so nothing is recorded', () => {
  assert.strictEqual(telnyxInboundEmail({ data: { payload: { subject: 'x' } } }).from.email, null);
  assert.strictEqual(telnyxInboundEmail({}).from.email, null);
});

console.log(`\n${passed} assertions passed.`);
