// Exercise telnyxSignatureOk against a real Ed25519 keypair by extracting it
// from functions/index.js, so the shipped code is what gets tested.
const fs = require('fs');
const crypto = require('crypto');

const src = fs.readFileSync(require('path').join(__dirname, '..', 'functions', 'index.js'), 'utf8');
const start = src.indexOf('const TELNYX_WEBHOOK_TOLERANCE_SEC');
const end = src.indexOf('/** The number leads see when we call them. */');
const code = src.slice(start, end);

const sandbox = { require, console, Buffer, Number, Math, process, module: {}, exports: {} };
const fn = new Function('require', 'console', 'Buffer', 'Number', 'Math', 'process',
  code + '\nreturn telnyxSignatureOk;');
const telnyxSignatureOk = fn(require, console, Buffer, Number, Math, process);

// Real keypair. The public half goes in the env var the same way Telnyx's does.
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const rawPub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12); // strip DER prefix
process.env.TELNYX_PUBLIC_KEY = rawPub.toString('base64');

const { publicKey: otherPub, privateKey: otherPriv } = crypto.generateKeyPairSync('ed25519');

// Telnyx sends pretty-printed JSON, so a parse+re-stringify demonstrably loses bytes.
const body = JSON.stringify({ data: { event_type: 'message.received', payload: { text: 'hi' } } }, null, 2);
const rawBody = Buffer.from(body, 'utf8');

function sign(ts, raw, key = privateKey) {
  return crypto.sign(null, Buffer.concat([Buffer.from(`${ts}|`, 'utf8'), raw]), key).toString('base64');
}
function mkReq(headers, raw) {
  return { get: (h) => headers[h.toLowerCase()], rawBody: raw };
}

const nowMs = 1_760_000_000_000;
const nowSec = Math.floor(nowMs / 1000);
let fails = 0;
const t = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fails++; };

// The happy path.
t('valid signature passes', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody), 'telnyx-timestamp': String(nowSec) }, rawBody),
  { now: nowMs }) === true);

// Tampering must fail.
const tampered = Buffer.from(body.replace('hi', 'hacked'), 'utf8');
t('tampered body fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody), 'telnyx-timestamp': String(nowSec) }, tampered),
  { now: nowMs }) === false);

t('signature from the wrong key fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody, otherPriv), 'telnyx-timestamp': String(nowSec) }, rawBody),
  { now: nowMs }) === false);

t('timestamp swapped after signing fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody), 'telnyx-timestamp': String(nowSec - 1) }, rawBody),
  { now: nowMs }) === false);

// Replay protection.
t('stale timestamp (10 min old) fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec - 600, rawBody), 'telnyx-timestamp': String(nowSec - 600) }, rawBody),
  { now: nowMs }) === false);
t('future timestamp (10 min ahead) fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec + 600, rawBody), 'telnyx-timestamp': String(nowSec + 600) }, rawBody),
  { now: nowMs }) === false);
t('just inside tolerance passes', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec - 299, rawBody), 'telnyx-timestamp': String(nowSec - 299) }, rawBody),
  { now: nowMs }) === true);

// Fail-closed cases.
t('missing signature header fails', telnyxSignatureOk(
  mkReq({ 'telnyx-timestamp': String(nowSec) }, rawBody), { now: nowMs }) === false);
t('missing timestamp header fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody) }, rawBody), { now: nowMs }) === false);
t('missing rawBody fails closed', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody), 'telnyx-timestamp': String(nowSec) }, undefined),
  { now: nowMs }) === false);
t('non-numeric timestamp fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody), 'telnyx-timestamp': 'abc' }, rawBody),
  { now: nowMs }) === false);
t('garbage signature fails', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': 'bm90LWEtc2lnbmF0dXJl', 'telnyx-timestamp': String(nowSec) }, rawBody),
  { now: nowMs }) === false);

// The re-serialisation trap this code exists to avoid.
const reserialised = Buffer.from(JSON.stringify(JSON.parse(body)), 'utf8');
const differs = !reserialised.equals(rawBody);
t('re-serialised JSON differs from raw bytes (why rawBody is required)', differs);
if (differs) {
  t('re-serialised body fails verification', telnyxSignatureOk(
    mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody), 'telnyx-timestamp': String(nowSec) }, reserialised),
    { now: nowMs }) === false);
}

// No public key configured at all.
const saved = process.env.TELNYX_PUBLIC_KEY;
process.env.TELNYX_PUBLIC_KEY = '';
t('no public key configured fails closed', telnyxSignatureOk(
  mkReq({ 'telnyx-signature-ed25519': sign(nowSec, rawBody), 'telnyx-timestamp': String(nowSec) }, rawBody),
  { now: nowMs }) === false);
process.env.TELNYX_PUBLIC_KEY = saved;

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
