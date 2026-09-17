// Extract the Telnyx send helpers from the shipped file and exercise them
// against a stubbed API, so the request shape and error surfacing are checked
// without a network call.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'functions', 'index.js'), 'utf8');
function grab(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('not found: ' + name);
  // Start the brace count at the body, so a destructured parameter list does
  // not close the count early.
  const bodyStart = src.indexOf(') {', i) + 2;
  let d = 0, started = false;
  for (let j = bodyStart; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true; }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const mod = {};
new Function('module', 'exports', 'fetch', 'process',
  ['const TELNYX_API = "https://api.telnyx.com/v2";',
   grab('telnyxApiKey'), grab('telnyxFromNumber'), grab('telnyxSmsConfig'),
   'async ' + grab('telnyx').replace(/^async /, ''), 'async ' + grab('sendTelnyxSms').replace(/^async /, ''),
   'module.exports = { telnyxSmsConfig, sendTelnyxSms };'].join('\n')
)(mod, mod.exports = {}, (...a) => globalThis.fetch(...a), process);
const { telnyxSmsConfig, sendTelnyxSms } = mod.exports;

let fails = 0;
const t = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fails++; };

// Unconfigured is reported, not thrown blindly.
process.env.TELNYX_API_KEY = ''; process.env.TELNYX_FROM_NUMBER = '';
let cfg = telnyxSmsConfig();
t('unconfigured reports both missing vars',
  cfg.ok === false && cfg.missing.join(',') === 'TELNYX_API_KEY,TELNYX_FROM_NUMBER');

process.env.TELNYX_API_KEY = 'KEY_test';
process.env.TELNYX_FROM_NUMBER = '+14055550123';
process.env.TELNYX_MESSAGING_PROFILE_ID = '';
cfg = telnyxSmsConfig();
t('configured without a profile is ok', cfg.ok === true && cfg.profileId === '');

let seen = null;
globalThis.fetch = async (url, opts) => {
  seen = { url, opts, body: JSON.parse(opts.body) };
  return { ok: true, status: 200, text: async () => JSON.stringify({
    data: { id: 'msg_abc', to: [{ phone_number: '+14055559999', status: 'queued' }] } }) };
};

(async () => {
  const r = await sendTelnyxSms({ to: '+14055559999', body: 'hello' });
  t('posts to /v2/messages', seen.url === 'https://api.telnyx.com/v2/messages');
  t('uses the bearer token', seen.opts.headers.Authorization === 'Bearer KEY_test');
  t('sends from/to/text', seen.body.from === '+14055550123'
    && seen.body.to === '+14055559999' && seen.body.text === 'hello');
  t('omits messaging_profile_id when unset', !('messaging_profile_id' in seen.body));
  t('returns a Twilio-shaped result', r.sid === 'msg_abc' && r.status === 'queued' && r.from === '+14055550123');

  // With a profile configured it must be included.
  process.env.TELNYX_MESSAGING_PROFILE_ID = 'prof_1';
  await sendTelnyxSms({ to: '+14055559999', body: 'x' });
  t('includes messaging_profile_id when set', seen.body.messaging_profile_id === 'prof_1');

  // Segment cap.
  await sendTelnyxSms({ to: '+14055559999', body: 'a'.repeat(2000) });
  t('truncates the body at 1600 chars', seen.body.text.length === 1600);

  // Telnyx error detail must reach the caller.
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => JSON.stringify({
    errors: [{ detail: 'Number not on account' }] }) });
  let msg = '';
  try { await sendTelnyxSms({ to: '+1', body: 'x' }); } catch (e) { msg = e.message; }
  t('surfaces the API error detail', /422/.test(msg) && /Number not on account/.test(msg));

  // Unconfigured send refuses before any HTTP.
  process.env.TELNYX_API_KEY = '';
  let refused = '';
  try { await sendTelnyxSms({ to: '+1', body: 'x' }); } catch (e) { refused = e.message; }
  t('refuses to send when unconfigured', /not configured/.test(refused) && /TELNYX_API_KEY/.test(refused));

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();
