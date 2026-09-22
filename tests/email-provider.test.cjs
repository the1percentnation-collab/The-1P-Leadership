// The email seam: one message shape, two providers.
//
// Every email in the platform goes through sendEmail/sendEmailBatch, so the
// thing worth pinning is the mapping each adapter performs — a wrong field
// name here is mail that silently does not arrive. Both adapters run against
// stubs, so no network call and no API key are involved.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'functions', 'index.js'), 'utf8');

// Lift a function out of the shipped file by brace matching, the same way
// telnyx-send.test.cjs does, so the test exercises the deployed source rather
// than a copy that can drift from it.
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

// Stubs for the two things the adapters talk to.
const sent = { sendgrid: [], telnyx: [] };
const sgMail = {
  setApiKey() {},
  send: async (msg) => { sent.sendgrid.push(msg); return [{ headers: { 'x-message-id': 'sg_1' } }]; }
};
let telnyxReply = { data: { id: 'tx_1' } };
const telnyxCalls = [];
async function telnyx(method, p, body, opts) {
  telnyxCalls.push({ method, path: p, body, opts });
  const json = telnyxReply;
  if (opts && opts.raw) return json;
  return json && json.data !== undefined ? json.data : json;
}
const sendgridKey = { value: () => 'SG.test' };
function telnyxApiKey() { return (process.env.TELNYX_API_KEY || '').trim(); }

const mod = {};
new Function(
  'module', 'exports', 'process', 'sgMail', 'telnyx', 'sendgridKey', 'telnyxApiKey',
  [
    "const EMAIL_PROVIDERS = ['sendgrid', 'telnyx'];",
    grab('emailProvider'), grab('emailConfigured'),
    grab('emailAddrString'), grab('emailAddrOnly'), grab('emailAddrList'),
    grab('applySubstitutions'), grab('telnyxEmailBody'),
    'async ' + grab('sendEmailViaSendGrid').replace(/^async /, ''),
    'async ' + grab('sendEmailViaTelnyx').replace(/^async /, ''),
    'async ' + grab('sendEmail').replace(/^async /, ''),
    'async ' + grab('sendEmailBatch').replace(/^async /, ''),
    'module.exports = { emailProvider, emailConfigured, sendEmail, sendEmailBatch, applySubstitutions };'
  ].join('\n')
)(mod, mod.exports = {}, process, sgMail, telnyx, sendgridKey, telnyxApiKey);

const { emailProvider, emailConfigured, sendEmail, sendEmailBatch, applySubstitutions } = mod.exports;

let fails = 0;
const t = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fails++; };

const MSG = {
  to: 'tester@example.com',
  from: { email: 'anthonybrown@the1pnation.com', name: 'The One Percent Nation' },
  replyTo: 'anthonybrown@the1pnation.com',
  subject: 'Your access is open',
  text: 'plain',
  html: '<p>rich</p>',
  customArgs: { type: 'course_grant', slug: 'icant' }
};

(async () => {
  // ── Provider selection ──────────────────────────────────────────────────
  delete process.env.EMAIL_PROVIDER;
  t('defaults to sendgrid when unset', emailProvider() === 'sendgrid');
  process.env.EMAIL_PROVIDER = 'TELNYX';
  t('is case and space insensitive', emailProvider() === 'telnyx');
  process.env.EMAIL_PROVIDER = 'mailchimp';
  t('an unknown provider falls back rather than failing to send',
    emailProvider() === 'sendgrid');

  // ── SendGrid path ───────────────────────────────────────────────────────
  process.env.EMAIL_PROVIDER = 'sendgrid';
  let res = await sendEmail(MSG);
  let sg = sent.sendgrid[sent.sendgrid.length - 1];
  t('sendgrid gets the message unchanged', sg.subject === MSG.subject
    && sg.text === 'plain' && sg.html === '<p>rich</p>' && sg.replyTo === MSG.replyTo);
  t('sendgrid keeps custom args as custom args', sg.customArgs.type === 'course_grant');
  t('returns the sendgrid message id', res.provider === 'sendgrid' && res.messageId === 'sg_1');

  // ── Telnyx path ─────────────────────────────────────────────────────────
  process.env.EMAIL_PROVIDER = 'telnyx';
  process.env.TELNYX_API_KEY = 'KEY_test';
  res = await sendEmail(MSG);
  let call = telnyxCalls[telnyxCalls.length - 1];
  t('posts to /email_messages', call.method === 'POST' && call.path === '/email_messages');
  t('from carries the display name', call.body.from === 'The One Percent Nation <anthonybrown@the1pnation.com>');
  t('to is always a list', Array.isArray(call.body.to) && call.body.to[0] === 'tester@example.com');
  t('bodies use telnyx field names',
    call.body.text_body === 'plain' && call.body.html_body === '<p>rich</p>'
    && !('text' in call.body) && !('html' in call.body));
  t('reply_to drops the display name', call.body.reply_to === 'anthonybrown@the1pnation.com');
  t('custom args become metadata', call.body.metadata.type === 'course_grant'
    && call.body.metadata.slug === 'icant');
  t('the message type is also a tag', Array.isArray(call.body.tags) && call.body.tags[0] === 'course_grant');
  t('returns the telnyx message id', res.provider === 'telnyx' && res.messageId === 'tx_1');

  // Empty optional fields must not be sent as empty keys.
  await sendEmail({ to: 'a@b.com', from: 'c@d.com', subject: 'hi', text: 'x' });
  call = telnyxCalls[telnyxCalls.length - 1];
  t('omits html_body, reply_to and metadata when absent',
    !('html_body' in call.body) && !('reply_to' in call.body) && !('metadata' in call.body));
  t('a bare string from is passed through', call.body.from === 'c@d.com');

  // ── Batch: the campaign shape ───────────────────────────────────────────
  const RECIPIENTS = [
    { email: 'a@example.com', name: 'Ada', subject: 'Hi Ada',
      substitutions: { unsubscribe_url: 'https://1p/u/a' },
      headers: { 'List-Unsubscribe': '<https://1p/u/a>' },
      customArgs: { recipientEmail: 'a@example.com' } },
    { email: 'b@example.com', substitutions: { unsubscribe_url: 'https://1p/u/b' } }
  ];
  const BATCH = {
    from: { email: 'anthonybrown@the1pnation.com', name: 'The One Percent Nation' },
    replyTo: 'anthonybrown@the1pnation.com',
    subject: 'Campaign',
    text: 'body -unsubscribe_url-',
    html: '<p>body <a href="-unsubscribe_url-">out</a></p>',
    recipients: RECIPIENTS,
    substitutionWrappers: ['-', '-'],
    customArgs: { type: 'campaign', campaignId: 'c1' }
  };

  telnyxReply = { data: [{ id: 'tx_a' }, { id: 'tx_b' }], errors: [], meta: { succeeded: 2, failed: 0, total: 2 } };
  let out = await sendEmailBatch(BATCH);
  call = telnyxCalls[telnyxCalls.length - 1];
  t('batch posts to /email_messages/batch', call.path === '/email_messages/batch');
  t('batch asks for the raw envelope', call.opts && call.opts.raw === true);
  t('one message per recipient', call.body.messages.length === 2);
  t('per-recipient subject wins', call.body.messages[0].subject === 'Hi Ada'
    && call.body.messages[1].subject === 'Campaign');
  t('substitutions are rendered per recipient, since telnyx has none',
    call.body.messages[0].text_body === 'body https://1p/u/a'
    && call.body.messages[1].text_body === 'body https://1p/u/b'
    && call.body.messages[0].html_body.includes('https://1p/u/a'));
  t('per-recipient headers survive',
    call.body.messages[0].headers['List-Unsubscribe'] === '<https://1p/u/a>');
  t('shared and per-recipient metadata are merged',
    call.body.messages[0].metadata.campaignId === 'c1'
    && call.body.messages[0].metadata.recipientEmail === 'a@example.com');
  t('reports the batch counts', out.accepted === 2 && out.failed === 0);

  // Per-message failures are counted, not thrown.
  telnyxReply = {
    data: [{ id: 'tx_a' }],
    errors: [{ code: 'recipient_suppressed', index: 1, message: 'suppressed' }],
    meta: { succeeded: 1, failed: 1, total: 2 }
  };
  out = await sendEmailBatch(BATCH);
  t('a partly failed batch reports both sides',
    out.accepted === 1 && out.failed === 1 && /suppressed/.test(out.errors[0]));

  // An envelope with no meta must not read as "nothing sent".
  telnyxReply = { data: [{ id: 'tx_a' }, { id: 'tx_b' }] };
  out = await sendEmailBatch(BATCH);
  t('a bare envelope counts as fully accepted', out.accepted === 2 && out.failed === 0);

  // SendGrid keeps its native personalizations.
  process.env.EMAIL_PROVIDER = 'sendgrid';
  out = await sendEmailBatch(BATCH);
  sg = sent.sendgrid[sent.sendgrid.length - 1];
  t('sendgrid batches through personalizations', sg.personalizations.length === 2
    && sg.personalizations[0].to[0].email === 'a@example.com');
  t('sendgrid leaves substitution to the API',
    sg.text === 'body -unsubscribe_url-'
    && sg.personalizations[0].substitutions.unsubscribe_url === 'https://1p/u/a');
  t('sendgrid batch reports accepted', out.accepted === 2 && out.failed === 0);

  // A rejected send is reported, never thrown, or one bad address kills a
  // whole campaign.
  const realSend = sgMail.send;
  sgMail.send = async () => { throw new Error('550 sender rejected'); };
  out = await sendEmailBatch(BATCH);
  t('a rejected sendgrid batch is counted, not thrown',
    out.accepted === 0 && out.failed === 2 && /550/.test(out.errors[0]));
  sgMail.send = realSend;

  // ── Configuration guard ─────────────────────────────────────────────────
  process.env.EMAIL_PROVIDER = 'telnyx';
  process.env.TELNYX_API_KEY = '';
  t('telnyx without a key reports unconfigured', emailConfigured() === false);
  process.env.TELNYX_API_KEY = 'KEY_test';
  t('telnyx with a key is configured', emailConfigured() === true);
  process.env.EMAIL_PROVIDER = 'sendgrid';
  t('sendgrid with a key is configured', emailConfigured() === true);

  // Empty recipient lists never reach an API.
  const before = telnyxCalls.length;
  out = await sendEmailBatch({ ...BATCH, recipients: [] });
  t('an empty batch sends nothing', out.accepted === 0 && telnyxCalls.length === before);

  // Substitution helper edge cases.
  t('substitution leaves a body alone when there is nothing to do',
    applySubstitutions('plain', null, ['-', '-']) === 'plain');
  t('a null substitution value renders empty, not "null"',
    applySubstitutions('x -k-', { k: null }, ['-', '-']) === 'x ');

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
