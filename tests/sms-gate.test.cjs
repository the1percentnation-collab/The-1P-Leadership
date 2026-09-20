// The outbound SMS gate, against the shipped source.
//
// What this is: smsSendBlockReason is extracted from functions/index.js and
// fed the exact contact shape each public form produces, then the source is
// checked to confirm both send paths go through it and the forms send what
// the server expects. What this is not: an end-to-end invocation of the
// callables — the repo has no Cloud Functions test runner (no
// firebase-functions-test, no firebase-admin under tests/), so the callable
// bodies are covered by source assertions rather than executed.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const rd = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

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
const smsSendBlockReason = new Function(grab('smsSendBlockReason') + '\nreturn smsSendBlockReason;')();

let fails = 0;
const t = (name, cond, detail) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '\n       got: ' + detail));
  if (!cond) fails++;
};
const slice = (s, from, to) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

// ── 1. A contact created through /contact-us is refused ──
// submitLeadForm with formType 'contact' and consent:false writes no consent
// field at all; upsertCrmContact never touches consent. This is that shape.
const viaContactUs = {
  name: 'Callback Lead', email: 'lead@example.com', phone: '+14055550100',
  source: 'Contact Form', stage: 'new', tags: ['Contact Form'], createdBy: 'system'
};
const r1 = smsSendBlockReason(viaContactUs);
t('contact-us contact (no consent field) is refused', r1 !== null, String(r1));
t('…with the no-consent-on-record reason', /No SMS consent is on record/.test(r1 || ''), String(r1));
const contactLead = rd('public/js/contact-lead.js');
t('contact-us handler no longer asserts consent: true', /consent: false/.test(contactLead) && !/consent: true/.test(contactLead));
t('contact-us handler sends no per-channel consent', !/consents/.test(contactLead));

// ── 2. A contact created through /financial-services with box 1 ticked is allowed ──
// registerServiceInterest → recordFormConsent with consents.sms === true
// writes smsConsent: true and the displayed wording. This is that shape.
const smsLabelText = 'By checking this box, you agree to receive text messages from The One Percent Nation related to your inquiry, bookings, or program updates. Message frequency may vary. Message and data rates may apply. Reply HELP for assistance or STOP to opt out. Consent is not a condition of purchase.';
const viaFinancial = {
  name: 'Bookkeeping Lead', email: 'books@example.com', phone: '+14055550101',
  source: 'Financial Services', stage: 'new', tags: ['Bookkeeping', 'Opt-In: Calls/SMS/Email'],
  smsConsent: true, smsConsentAt: new Date(), smsConsentText: smsLabelText
};
const r2 = smsSendBlockReason(viaFinancial);
t('financial-services contact with SMS box ticked is allowed', r2 === null, String(r2));
const fsJs = rd('public/js/financial-services.js');
t('financial-services bookkeeping form sends consents + consentText',
  /consents: \{ sms: \$\('bk-sms'\)\.checked, marketing: \$\('bk-mkt'\)\.checked \}/.test(fsJs) && /consentText: \{ sms: consentTextFor\('bk-sms'\)/.test(fsJs));
t('financial-services waitlist form (no SMS box) does NOT send consents',
  !/consents:[\s\S]*?service: \$\('wl-service'\)/.test(fsJs.slice(fsJs.indexOf("formId: 'wl-form'"))));
const rsi = slice(src, 'exports.registerServiceInterest = onCall(', "type: 'service_interest'");
t('registerServiceInterest records consent through the shared helper', /recordFormConsent\(db, ref/.test(rsi) && /parseFormConsent\(data\)/.test(rsi));
const corpJs = rd('public/js/corporate.js');
t('corporate form sends consents + consentText',
  /consents: \{ sms: \$\('a-sms'\)\.checked, marketing: \$\('a-mkt'\)\.checked \}/.test(corpJs) && /consentTextFor\('a-sms'\)/.test(corpJs));

// ── 3. The gate's other edges ──
t('explicit decline is refused', /declined SMS consent/.test(smsSendBlockReason({ ...viaFinancial, smsConsent: false }) || ''));
t('opted-out is refused even with consent on record', /opted out/.test(smsSendBlockReason({ ...viaFinancial, smsOptedOut: true }) || ''));
t('a missing contact is refused', smsSendBlockReason(null) !== null);
t('consent recorded manually (recordSmsConsent shape) is allowed',
  smsSendBlockReason({ phone: '+1', smsConsent: true, smsConsentText: 'Consent recorded by Anthony: asked on call' }) === null);
t('an inbound texter (webhook shape) is allowed',
  smsSendBlockReason({ phone: '+1', source: 'SMS', smsConsent: true, smsConsentText: 'Texted us first from +14055550102' }) === null);

// ── 4. Both send paths use the one gate ──
const sendSms = slice(src, 'exports.sendSms = onCall(', 'exports.telnyxInboundWebhook');
t('sendSms calls smsSendBlockReason', /smsSendBlockReason\(cSnap\.data\(\)\)/.test(sendSms));
t('sendSms has no inline consent check of its own', !/smsConsent ===|smsConsent !==|smsOptedOut ===/.test(sendSms));
const seq = slice(src, "if (step.channel === 'sms')", "if (step.channel === 'email')");
t('sequence sender calls smsSendBlockReason', /smsSendBlockReason\(contact\)/.test(seq));
t('sequence sender has no inline consent check of its own', !/smsConsent ===|smsConsent !==|smsOptedOut ===/.test(seq));
t('the gate itself requires smsConsent === true', /smsConsent !== true/.test(grab('smsSendBlockReason')));

// ── 5. The inbound webhook records consent to reply, never on a STOP ──
const inbound = slice(src, 'exports.telnyxInboundWebhook = onRequest(', 'exports.telnyxStatusWebhook');
t('inbound webhook records smsConsent for a first-time texter', /Texted us first from/.test(inbound) && /smsConsent: true/.test(inbound));
t('inbound webhook does not record consent on a STOP keyword', /!STOP_WORDS\.includes\(kw\) && contactDoc\.data\(\)\.smsConsent !== true/.test(inbound));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
