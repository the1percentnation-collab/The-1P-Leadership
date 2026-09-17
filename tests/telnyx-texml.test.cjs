// The TeXML builder and the webhook callback token, extracted from
// functions/index.js so the shipped code is what gets tested.
//
// The builder matters because a malformed document drops a live call, and the
// token matters because the callbacks it guards write call records from a
// public endpoint.
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

const api = new Function('require', 'Buffer', 'process',
  [grab('xmlEscape'), grab('attrString'), grab('texmlResponse'),
   grab('telnyxApiKey'), grab('voiceCallbackToken'),
   grab('telnyxSignatureOk'), grab('telnyxVoiceWebhookOk'),
   'const TELNYX_WEBHOOK_TOLERANCE_SEC = 300;',
   'return { texmlResponse, voiceCallbackToken, telnyxVoiceWebhookOk };'].join('\n')
)(require, Buffer, process);
const { texmlResponse, voiceCallbackToken, telnyxVoiceWebhookOk } = api;

let fails = 0;
const t = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fails++; };
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';

// ── The builder ──
t('empty response is still valid TeXML',
  texmlResponse().toString() === HEAD + '<Response></Response>');

t('say(text) with no attributes',
  texmlResponse().say('Hello there').toString() === HEAD + '<Response><Say>Hello there</Say></Response>');

t('say(attrs, text) keeps camelCase attribute names',
  texmlResponse().say({ voice: 'female', language: 'en-US' }, 'Hi').toString()
    === HEAD + '<Response><Say voice="female" language="en-US">Hi</Say></Response>');

// A lead called "Bob & Sons <Realty>" must not break the document.
t('text content is XML-escaped',
  texmlResponse().say('Bob & Sons <Realty> "x"').toString()
    === HEAD + '<Response><Say>Bob &amp; Sons &lt;Realty&gt; &quot;x&quot;</Say></Response>');

// Callback URLs carry &-joined query strings, which are invalid raw in XML.
{
  const r = texmlResponse();
  r.dial({ action: 'https://x/y?a=1&b=2' }).number('+15551234567');
  t('attribute ampersands are escaped',
    r.toString() === HEAD + '<Response><Dial action="https://x/y?a=1&amp;b=2">'
      + '<Number>+15551234567</Number></Dial></Response>');
}

// Children are added after dial() returns, so serialisation must be lazy.
{
  const r = texmlResponse();
  const d = r.dial({ callerId: '+14055550123', answerOnBridge: true });
  d.sip('sip:user1@sip.telnyx.com');
  d.sip('sip:user2@sip.telnyx.com');
  t('children added after dial() land inside <Dial>',
    r.toString() === HEAD + '<Response><Dial callerId="+14055550123" answerOnBridge="true">'
      + '<Sip>sip:user1@sip.telnyx.com</Sip><Sip>sip:user2@sip.telnyx.com</Sip></Dial></Response>');
}

{
  const r = texmlResponse(); r.dial({ timeout: 20 });
  t('childless <Dial> serialises as an empty element',
    r.toString() === HEAD + '<Response><Dial timeout="20"/></Response>');
}

// Empty, null and undefined attributes are dropped rather than emitted blank,
// so an unset caller ID cannot become callerId="".
{
  const r = texmlResponse();
  r.dial({ callerId: '', record: null, answerOnBridge: undefined, timeout: 20 });
  t('empty, null and undefined attributes are omitted',
    r.toString() === HEAD + '<Response><Dial timeout="20"/></Response>');
}

t('ordering is preserved across mixed elements', (() => {
  const r = texmlResponse();
  r.say('One');
  r.dial({ callerId: '+1' }).number('+2');
  r.say('Two');
  r.record({ maxLength: 120, playBeep: true });
  r.hangup();
  return r.toString() === HEAD + '<Response><Say>One</Say>'
    + '<Dial callerId="+1"><Number>+2</Number></Dial>'
    + '<Say>Two</Say><Record maxLength="120" playBeep="true"/><Hangup/></Response>';
})());

t('play + hangup is the voicemail drop document', (() => {
  const r = texmlResponse();
  r.play('https://fn/voicemailAudio?cid=c&id=d&token=t');
  r.hangup();
  return r.toString() === HEAD + '<Response>'
    + '<Play>https://fn/voicemailAudio?cid=c&amp;id=d&amp;token=t</Play><Hangup/></Response>';
})());

// ── The callback token ──
process.env.TELNYX_API_KEY = 'KEY_one';
const tok = voiceCallbackToken('co1', 'call1');
t('token is a 32 char hex digest', /^[0-9a-f]{32}$/.test(tok));
t('token is stable for the same inputs', voiceCallbackToken('co1', 'call1') === tok);
t('token differs per call', voiceCallbackToken('co1', 'call2') !== tok);
t('token differs per company', voiceCallbackToken('co2', 'call1') !== tok);
process.env.TELNYX_API_KEY = 'KEY_two';
t('token is keyed on the API key', voiceCallbackToken('co1', 'call1') !== tok);
process.env.TELNYX_API_KEY = '';
t('no API key yields no token', voiceCallbackToken('co1', 'call1') === '');

// ── The webhook gate ──
process.env.TELNYX_API_KEY = 'KEY_one';
process.env.TELNYX_PUBLIC_KEY = '';  // force the token path
const mkReq = (query) => ({ query, get: () => '', rawBody: undefined });

t('a correct token is accepted',
  telnyxVoiceWebhookOk(mkReq({ companyId: 'co1', callId: 'call1', token: tok })) === true);
t('a wrong token is rejected',
  telnyxVoiceWebhookOk(mkReq({ companyId: 'co1', callId: 'call1', token: 'f'.repeat(32) })) === false);
t('a token for another call is rejected',
  telnyxVoiceWebhookOk(mkReq({ companyId: 'co1', callId: 'call2', token: tok })) === false);
t('a token for another company is rejected',
  telnyxVoiceWebhookOk(mkReq({ companyId: 'co2', callId: 'call1', token: tok })) === false);
t('no token at all is rejected',
  telnyxVoiceWebhookOk(mkReq({ companyId: 'co1', callId: 'call1' })) === false);
t('a short token is rejected rather than throwing',
  telnyxVoiceWebhookOk(mkReq({ companyId: 'co1', callId: 'call1', token: 'abc' })) === false);
process.env.TELNYX_API_KEY = '';
t('with no API key every token is rejected',
  telnyxVoiceWebhookOk(mkReq({ companyId: 'co1', callId: 'call1', token: tok })) === false);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
