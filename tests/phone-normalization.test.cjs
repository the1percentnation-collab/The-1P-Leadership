// Phone numbers are stored in E.164 on every write path, because the inbound
// SMS and voice webhooks match contacts with an exact comparison against
// normalizePhone(From). A contact saved as "(405) 555-0123" who texted in
// used to become a second contact.
//
// Three checks: the server and client normalizers agree on the shapes leads
// actually type; every server intake reads phone through normalizePhone;
// and the client data layer normalizes on create and update.
//
// Run: node tests/phone-normalization.test.cjs
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8');
const crm = fs.readFileSync(path.join(root, 'public', 'js', 'crm.js'), 'utf8');
const phoneMod = fs.readFileSync(path.join(root, 'public', 'js', 'phone.js'), 'utf8');

function grab(source, name) {
  const i = source.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('not found: ' + name);
  const bodyStart = source.indexOf(') {', i) + 2;
  let d = 0, started = false;
  for (let j = bodyStart; j < source.length; j++) {
    if (source[j] === '{') { d++; started = true; }
    else if (source[j] === '}') { d--; if (started && d === 0) return source.slice(i, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
const serverNormalize = new Function(grab(src, 'normalizePhone') + '\nreturn normalizePhone;')();
const clientNormalize = new Function(grab(phoneMod, 'normalizePhone') + '\nreturn normalizePhone;')();

let fails = 0;
const t = (name, cond, detail) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : '\n       got: ' + detail));
  if (!cond) fails++;
};

// ── 1. The two normalizers agree ──
const cases = [
  ['(405) 555-0123', '+14055550123'],
  ['405.555.0123', '+14055550123'],
  ['405-555-0123', '+14055550123'],
  ['4055550123', '+14055550123'],
  ['1 405 555 0123', '+14055550123'],
  ['+1 (405) 555-0123', '+14055550123'],
  ['+44 20 7946 0958', '+442079460958'],
  ['  ', null],
  ['', null],
  [null, null],
  ['ext', null]
];
for (const [input, want] of cases) {
  const s = serverNormalize(input);
  const c = clientNormalize(input);
  t(`server: ${JSON.stringify(input)} → ${JSON.stringify(want)}`, s === want, JSON.stringify(s));
  t(`client: ${JSON.stringify(input)} → ${JSON.stringify(want)}`, c === want, JSON.stringify(c));
}

// ── 2. Every server intake normalizes ──
// A raw `data.phone` read that does not pass through normalizePhone is the
// bug coming back. This is the whole list; a new intake path must be added
// to the normalizer, not to this exclusion list.
const rawReads = src.split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => /data\.phone\b/.test(line) && !/normalizePhone\(/.test(line));
t('no server intake reads data.phone without normalizePhone',
  rawReads.length === 0, rawReads.map((r) => `${r.n}: ${r.line.trim()}`).join('\n            '));

const upsert = grab(src, 'upsertCrmContact');
t('upsertCrmContact normalizes before matching', /phone = normalizePhone\(phone\)/.test(upsert));
t('upsertCrmContact claims a phone-only contact when a form brings the email',
  /where\('phone', '==', phone\)/.test(upsert) && /!d\.data\(\)\.email/.test(upsert));

const importFn = src.slice(src.indexOf('exports.importContacts = onCall('), src.indexOf('exports.deleteUser = onCall('));
t('importContacts normalizes the phone column', /phone: normalizePhone\(/.test(importFn));

// ── 3. The client data layer normalizes ──
t('crm.js imports the shared normalizer', /import \{ normalizePhone \} from '\.\/phone\.js'/.test(crm));
const create = crm.slice(crm.indexOf('export async function createContact('), crm.indexOf('export async function updateContact('));
t('createContact stores normalizePhone(data.phone)', /phone: normalizePhone\(data\.phone\)/.test(create));
const update = crm.slice(crm.indexOf('export async function updateContact('), crm.indexOf('export async function changeStage('));
t('updateContact normalizes an edited phone', /clean\.phone = normalizePhone\(clean\.phone\)/.test(update));

console.log(fails ? `\n${fails} failing` : '\nall passing');
process.exit(fails ? 1 : 0);
