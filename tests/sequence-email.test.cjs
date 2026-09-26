// The sequence email step, against the shipped source.
//
// The bug this pins: executeSequenceStep used to test `emailUnsubscribed`
// and `unsubscribed`, two fields nothing in the codebase writes, so a lead
// who clicked Unsubscribe kept receiving automated email. Every email sender
// must go through isEmailSuppressed, carry a working opt-out, route replies
// to the contact, and leave the message in the contact's email thread.
//
// Like sms-gate.test.cjs: isEmailSuppressed is extracted and executed against
// the exact contact shapes the unsubscribe paths write; the step body is
// covered by source assertions because the repo has no Cloud Functions test
// runner.
//
// Run: node tests/sequence-email.test.cjs
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');

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
const isEmailSuppressed = new Function(grab('isEmailSuppressed') + '\nreturn isEmailSuppressed;')();

let fails = 0;
const t = (name, cond, detail) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '\n       got: ' + detail));
  if (!cond) fails++;
};
const slice = (s, from, to) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

// ── 1. The suppression predicate matches what the opt-out paths write ──
// The unsubscribe link writes emailOptOut + the Unsubscribed tag; the
// provider event writes the same. Either alone must suppress.
t('unsubscribe-link shape is suppressed',
  isEmailSuppressed({ email: 'a@x.com', emailOptOut: true, tags: ['Unsubscribed'] }));
t('emailOptOut alone is suppressed', isEmailSuppressed({ email: 'a@x.com', emailOptOut: true }));
t('Unsubscribed tag alone is suppressed', isEmailSuppressed({ email: 'a@x.com', tags: ['Unsubscribed'] }));
t('a plain lead is not suppressed', !isEmailSuppressed({ email: 'a@x.com', tags: ['Newsletter'] }));
t('the fields the old check tested do not exist as writers',
  !/emailUnsubscribed\s*:/.test(src) && !/\bunsubscribed\s*:\s*true/.test(src));

// ── 2. The sequence email step goes through the same gate ──
const step = slice(src, 'async function executeSequenceStep(', '\nasync function processDueEnrollments(');
const emailBranch = slice(step, "if (step.channel === 'email')", "if (step.channel === 'task')");
t('email step checks isEmailSuppressed', /isEmailSuppressed\(contact\)/.test(emailBranch));
t('email step no longer tests the phantom fields',
  !/contact\.emailUnsubscribed/.test(emailBranch) && !/contact\.unsubscribed/.test(emailBranch));

// ── 3. Automated mail carries a working opt-out ──
t('email step mints the per-contact unsubscribe token', /ensureUnsubToken\(/.test(emailBranch));
t('email step puts the unsubscribe link in the body', /unsubscribeUrl\(/.test(emailBranch) && /Unsubscribe/.test(emailBranch));
t('email step sends List-Unsubscribe headers',
  /'List-Unsubscribe'/.test(emailBranch) && /List-Unsubscribe=One-Click/.test(emailBranch));

// ── 4. Replies route to the contact and the message is on the thread ──
t('email step uses the per-contact reply+ address', /replyAddressFor\(companyId, contact\.id\)/.test(emailBranch));
t('email step writes the contacts/{id}/emails document', /collection\('emails'\)\.doc\(\)/.test(emailBranch));
t('email step tags the send with emailId for delivery events',
  /customArgs:\s*\{[^}]*emailId:\s*emailRef\.id/.test(emailBranch));
t('email step logs email_sent (deduped by the timeline against the thread doc)', /type:\s*'email_sent'/.test(emailBranch));
t('email step stamps lastContactedAt', /lastContactedFields\('email', 'out'\)/.test(emailBranch));

// ── 5. An opt-out is an exit from any running sequence ──
const unsub = slice(src, 'exports.unsubscribe = onRequest(', '\n/** Has this contact opted out of marketing email? */');
t('unsubscribe link stops active enrollments', /stopEnrollmentsForContact\(db, companyId, contactId/.test(unsub));
const events = slice(src, 'async function applyEmailEvent(', '\nexports.sendgridEventWebhook');
t('provider unsubscribe / spam events stop active enrollments', /stopEnrollmentsForContact\(db, companyId, d\.id/.test(events));

console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
