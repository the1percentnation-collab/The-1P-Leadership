// The SMS consent contract, asserted against the shipped source.
//
// Three properties have to hold together or the /webinar opt-in page tells a
// campaign reviewer something the code does not do:
//   1. an explicit decline (the box shown and left unticked) blocks sending in
//      both send paths, while "no decision recorded" does not;
//   2. a later submission never downgrades an earlier opt-in — revocation is
//      STOP, which has its own path;
//   3. the legacy single boolean is still honoured when the per-channel shape
//      is absent, which is the window where the page has deployed but the
//      function has not.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fn = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'public', 'webinar.html'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'public', 'js', 'webinar-register.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

let fails = 0;
const t = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fails++; };
const slice = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

// ── 1. The decline is honoured, and only the decline ──
const sendSms = slice(fn, 'exports.sendSms = onCall(', 'exports.telnyxInboundWebhook');
t('sendSms refuses smsConsent === false', /smsConsent === false/.test(sendSms));
t('sendSms still refuses smsOptedOut', /smsOptedOut === true/.test(sendSms));
t('sendSms does not require consent to be true (undefined stays sendable)',
  !/smsConsent !== true/.test(sendSms) && !/!contact\.smsConsent|!cSnap\.data\(\)\.smsConsent\b/.test(sendSms));

const seq = slice(fn, "if (step.channel === 'sms')", "if (step.channel === 'email')");
t('sequence sender refuses smsConsent === false', /smsConsent === false/.test(seq));
t('sequence sender does not require consent to be true', !/smsConsent !== true/.test(seq));

// ── 2. Opt-in is additive ──
const lead = slice(fn, 'exports.submitLeadForm = onCall(', "type: 'lead_form'");
t('submitLeadForm reads prior smsConsent before deciding', /priorSms/.test(lead));
t('a decline is written only when there is no prior true', /else if \(priorSms !== true\)/.test(lead));
t('a decline is never written when the SMS box was ticked',
  /if \(smsConsent\) \{[^}]*smsConsent = true/.test(lead));
t('the exact displayed wording is stored, with a fallback', /consentTextFor\('sms'\) \|\| fallbackText/.test(lead));
t('a consent_updated activity is written as proof', /type: 'consent_updated'/.test(lead));

// ── 3. Deploy skew: the legacy boolean still works ──
t('legacy consent boolean honoured when consents is absent',
  /hasChannels \? \(smsConsent \|\| marketingConsent\) : !!data\.consent/.test(lead));
t('legacy path still writes marketingConsent', /else if \(consent\) \{[\s\S]*?marketingConsent = true/.test(lead));

// ── The page and the bridge send what the server expects ──
t('page sends the legacy boolean AND per-channel state', /consent: c1\.checked \|\| c2\.checked/.test(page)
  && /consents: \{ sms: c1\.checked, marketing: c2\.checked \}/.test(page));
t('page sends the displayed wording read from the DOM', /consentTextFor\('c1'\)/.test(page) && /innerText/.test(page));
t('bridge forwards consents and consentText', /consents, consentText/.test(bridge));

// ── The page itself: real inputs, none required, none pre-checked, not gated ──
const c1 = page.slice(page.indexOf('id="c1"') - 60, page.indexOf('id="c1"') + 120);
t('c1 is a real checkbox input', /<input type="checkbox" id="c1"/.test(c1));
t('c1 is not required', !/required/.test(c1));
t('c1 is not pre-checked', !/\bchecked\b/.test(c1));
t('the consent block is outside #final-step',
  page.indexOf('class="consent-block"') < page.indexOf('id="final-step"'));
t('toggleConsent is gone', !/toggleConsent/.test(page));

// ── The escape hatch exists and leaves a trail ──
const rec = slice(fn, 'exports.recordSmsConsent = onCall(', 'exports.submitLeadForm');
t('recordSmsConsent requires a note', /Say how consent was given/.test(rec));
t('recordSmsConsent names the actor in the activity', /actorUid: uid, actorName/.test(rec));
t('recordSmsConsent refuses after a STOP', /smsOptedOut === true/.test(rec));
t('recordSmsConsent clears a prior decline', /smsConsentDeclinedAt: FV\.delete\(\)/.test(rec));

// ── Rules keep the client out of these fields ──
const contactRule = slice(rules, 'match /contacts/{contactId}', 'match /notes/');
t('rules deny client updates to smsConsent fields',
  /affectedKeys\(\)\s*\.hasAny\(\['smsConsent', 'smsConsentAt', 'smsConsentText', 'smsConsentDeclinedAt'\]\)/.test(contactRule));
t('rules deny client creates carrying smsConsent fields',
  /keys\(\)\s*\.hasAny\(\['smsConsent'/.test(contactRule));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
