// Facebook Page Messenger: the pure pieces of functions/messenger.js.
//
// A forged webhook could plant a fake buyer thread, and a wrong window rule
// either spams people Facebook says the Page may not message (which gets the
// Page restricted) or refuses sends it could make. These pin the signature
// check, which deliveries count as a buyer's message, and the 24-hour /
// 7-day Human Agent rule.
//
// Run: node tests/messenger.test.cjs
const assert = require('assert');
const crypto = require('crypto');
const m = require('../functions/messenger.js');

let passed = 0;
async function ok(name, run) {
  try { await run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 23, 12);
const sign = (body, secret) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

(async () => {
  console.log('messenger');

  await ok('a webhook delivery passes only with the app secret signature', () => {
    const raw = Buffer.from('{"object":"page"}');
    assert.strictEqual(m.signatureOk(raw, sign(raw, 's3cret'), 's3cret'), true);
    assert.strictEqual(m.signatureOk(raw, sign(raw, 'other'), 's3cret'), false);
    assert.strictEqual(m.signatureOk(Buffer.from('{"object":"page","x":1}'), sign(raw, 's3cret'), 's3cret'), false);
    assert.strictEqual(m.signatureOk(raw, 'sha1=abc', 's3cret'), false);
    assert.strictEqual(m.signatureOk(raw, '', 's3cret'), false);
    assert.strictEqual(m.signatureOk(raw, sign(raw, ''), ''), false, 'no secret configured must fail closed');
    assert.strictEqual(m.signatureOk(null, sign(raw, 's3cret'), 's3cret'), false);
  });

  await ok('only messages people send the Page count; echoes and receipts do not', () => {
    const body = {
      object: 'page',
      entry: [{
        id: 'PAGE1',
        messaging: [
          { sender: { id: 'U1' }, recipient: { id: 'PAGE1' }, timestamp: NOW, message: { mid: 'm1', text: 'I want 2 signed copies' } },
          { sender: { id: 'PAGE1' }, recipient: { id: 'U1' }, timestamp: NOW, message: { mid: 'm2', text: 'Sure!', is_echo: true } },
          { sender: { id: 'U1' }, recipient: { id: 'PAGE1' }, timestamp: NOW, read: { watermark: NOW } },
          { sender: { id: 'U2' }, recipient: { id: 'PAGE1' }, timestamp: NOW, message: { mid: 'm3', attachments: [{ type: 'image' }] } }
        ]
      }]
    };
    const got = m.inboundMessages(body);
    assert.deepStrictEqual(got.map((x) => [x.psid, x.mid, x.text, x.pageId]), [
      ['U1', 'm1', 'I want 2 signed copies', 'PAGE1'],
      ['U2', 'm3', '[image]', 'PAGE1']
    ]);
    assert.deepStrictEqual(m.inboundMessages({ object: 'instagram', entry: [] }), []);
    assert.deepStrictEqual(m.inboundMessages(null), []);
  });

  await ok('the Page may message for 24 hours after their last message, and not before they write', () => {
    assert.deepStrictEqual(m.sendPlan(NOW - 3600000, NOW), { messaging_type: 'RESPONSE' });
    assert.deepStrictEqual(m.sendPlan(NOW - DAY, NOW), { messaging_type: 'RESPONSE' });
    assert.match(m.sendPlan(NOW - DAY - 1, NOW).error, /over 24 hours/);
    assert.match(m.sendPlan(null, NOW).error, /not messaged the Page/);
  });

  await ok('with Human Agent approved, a person may reply for 7 days with the HUMAN_AGENT tag', () => {
    const ha = { humanAgent: true };
    assert.deepStrictEqual(m.sendPlan(NOW - 2 * DAY, NOW, ha), { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
    assert.deepStrictEqual(m.sendPlan(NOW - 3600000, NOW, ha), { messaging_type: 'RESPONSE' });
    assert.match(m.sendPlan(NOW - 8 * DAY, NOW, ha).error, /over 7 days/);
    assert.strictEqual(m.windowClosesAt(NOW - 2 * DAY, NOW, ha), NOW + 5 * DAY);
    assert.strictEqual(m.windowClosesAt(NOW - 2 * DAY, NOW), null);
    assert.strictEqual(m.windowClosesAt(null, NOW), null);
  });

  await ok('the Send API call carries the tag only when the plan has one, and surfaces Meta errors', async () => {
    const cfg = { base: 'https://g.test', version: 'v24.0', token: 'tok en' };
    let seen = null;
    const fake = (status, json) => async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: status < 300, status, json: async () => json }; };
    const r = await m.sendText(cfg, 'U1', 'Hi', { messaging_type: 'RESPONSE' }, fake(200, { recipient_id: 'U1', message_id: 'mid.1' }));
    assert.deepStrictEqual(r, { mid: 'mid.1', psid: 'U1' });
    assert.strictEqual(seen.url, 'https://g.test/v24.0/me/messages?access_token=tok%20en');
    assert.deepStrictEqual(seen.body, { recipient: { id: 'U1' }, messaging_type: 'RESPONSE', message: { text: 'Hi' } });
    await m.sendText(cfg, 'U1', 'Hi', { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' }, fake(200, { message_id: 'x' }));
    assert.strictEqual(seen.body.tag, 'HUMAN_AGENT');
    await assert.rejects(
      m.sendText(cfg, 'U1', 'Hi', { messaging_type: 'RESPONSE' }, fake(400, { error: { message: 'outside the allowed window', code: 10, error_subcode: 2018278 } })),
      (e) => e.message === 'outside the allowed window' && e.code === 10 && e.subcode === 2018278
    );
  });

  await ok('the order\'s buyer floats to the top of the thread picker', () => {
    const ranked = m.rankThreads([
      { psid: 'a', name: 'Someone Else', lastInboundMs: NOW },
      { psid: 'b', name: 'Joshua Smith', lastInboundMs: NOW - 1000 },
      { psid: 'c', name: 'joshua quick', lastInboundMs: NOW - 5000 }
    ], 'Joshua Quick');
    assert.deepStrictEqual(ranked.map((t) => [t.psid, t.match]), [['c', 2], ['b', 1], ['a', 0]]);
  });

  await ok('nothing is configured until both the Page token and app secret are set', () => {
    const keep = { ...process.env };
    delete process.env.META_PAGE_ACCESS_TOKEN; delete process.env.META_APP_SECRET;
    assert.deepStrictEqual(m.messengerConfig().missing, ['META_PAGE_ACCESS_TOKEN', 'META_APP_SECRET']);
    process.env.META_PAGE_ACCESS_TOKEN = 't'; process.env.META_APP_SECRET = 's'; process.env.META_HUMAN_AGENT = '1';
    const c = m.messengerConfig();
    assert.ok(c.ok && c.humanAgent && c.base === 'https://graph.facebook.com' && c.version === m.DEFAULT_GRAPH_VERSION);
    process.env = keep;
  });

  console.log(`\n${passed} passed`);
})();
