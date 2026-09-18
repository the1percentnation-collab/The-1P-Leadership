// The consent gate contract, asserted against the shipped source.
//
// authorizeCall refuses a call in three ways and reports "not configured" in a
// fourth. The client must hard-stop on the refusals and degrade to the phone's
// own dialer on the configuration case. That distinction used to be drawn by
// substring-matching the human-readable message, which meant rewording one
// string would silently turn a do-not-call refusal into a dialed call. It is
// now carried by { blocked: true } in the error details.
//
// These assertions exist so that regression cannot happen quietly again.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fnSrc = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const dialerSrc = fs.readFileSync(path.join(root, 'public', 'js', 'dialer-core.js'), 'utf8');

let fails = 0;
const t = (name, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + name); if (!cond) fails++; };

// Isolate the authorizeCall body.
const start = fnSrc.indexOf('exports.authorizeCall = onCall(');
const end = fnSrc.indexOf('exports.voiceOutboundTwiml');
const gate = fnSrc.slice(start, end);
t('authorizeCall is present and precedes voiceOutboundTwiml', start > 0 && end > start);

// Every refusal is flagged.
t('do-not-call refusal is flagged blocked',
  /blocked\('This contact is marked do not call and cannot be dialed\.'\)/.test(gate));
t('missing-phone refusal is flagged blocked',
  /blocked\('Contact has no phone number\.'\)/.test(gate));
t('contact-not-found is flagged blocked',
  /'Contact not found\.',\s*\{ blocked: true \}/.test(gate));

// The configuration case must NOT be flagged, or a project with no credentials
// would refuse outright instead of falling back to the tel: handoff.
const cfgThrow = gate.slice(gate.indexOf('Calling is not set up yet'));
const cfgStmtEnd = cfgThrow.indexOf(';');
t('the not-configured error is NOT flagged blocked',
  cfgStmtEnd > 0 && !/blocked/.test(cfgThrow.slice(0, cfgStmtEnd)));

// Enumerate the throws so a newly added refusal cannot slip in unflagged. Each
// one must be an argument error, the configuration error, or a flagged refusal;
// an unaccounted-for throw fails here and has to be classified deliberately.
const throwStatements = gate.split(/throw /).slice(1).map((chunk) => {
  const end = chunk.indexOf(';');
  return chunk.slice(0, end > 0 ? end : 120).replace(/\s+/g, ' ');
});
const classify = (st) => {
  if (/invalid-argument/.test(st)) return 'argument';
  if (/Calling is not set up yet/.test(st)) return 'config';
  if (/blocked\(|blocked: true/.test(st)) return 'refusal';
  return 'UNCLASSIFIED: ' + st;
};
const kinds = throwStatements.map(classify);
t('every throw is an argument error, the config case, or a flagged refusal',
  kinds.length === 5 && !kinds.some((k) => k.startsWith('UNCLASSIFIED')));
t('exactly one throw is the degrade-to-manual config case',
  kinds.filter((k) => k === 'config').length === 1);
t('three throws are flagged refusals',
  kinds.filter((k) => k === 'refusal').length === 3);
if (kinds.some((k) => k.startsWith('UNCLASSIFIED'))) {
  kinds.filter((k) => k.startsWith('UNCLASSIFIED')).forEach((k) => console.log('     ' + k));
}

// ── The client half ──
t('dialer-core branches on details.blocked',
  /e\.details\.blocked === true/.test(dialerSrc));
t('dialer-core no longer substring-matches the refusal message',
  !/do not call\|opted out\|no phone number/.test(dialerSrc));
t('a blocked error is marked fatal so it cannot reach placeManualCall',
  /fatal\.fatal = true/.test(dialerSrc));

// The fatal path must cancel the call row and require a disposition rather than
// silently dropping the lead.
const fatalBlock = dialerSrc.slice(dialerSrc.indexOf('if (e && e.fatal)'));
t('a fatal refusal marks the call canceled and still records a disposition',
  /status: 'canceled'/.test(fatalBlock.slice(0, 600))
  && /recordDisposition\(/.test(fatalBlock.slice(0, 600)));

// callerName was never a real setting — absent from DEFAULT_DIALER_SETTINGS and
// dropped by updateDialerSettings' whitelist, so it was always undefined.
const crmSrc = fs.readFileSync(path.join(root, 'public', 'js', 'crm.js'), 'utf8');
t('dialer-core does not read a callerName setting that cannot be set',
  !/settings\.callerName/.test(dialerSrc) || /callerName/.test(crmSrc));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
