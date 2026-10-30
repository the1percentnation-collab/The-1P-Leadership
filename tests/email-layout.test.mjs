// The branded campaign layout (public/js/email-layout-core.js) and the
// I Can't audiobook draft that uses it (scripts/seed-audiobook-campaign.js).
//
// Pinned here:
// 1. The renderer: escaping, the five body conventions, the opt-out footer,
//    and the email-client rules (no `background` shorthand, colours set as
//    bgcolor too).
// 2. The server copy is the browser module, so preview and send cannot drift.
// 3. The wiring: sendCampaign renders branded campaigns at send time,
//    sendCampaignTest is admin-only and rate limited, buildRecipients skips
//    owners of a book, and the campaigns page can test and send a draft.
// 4. The audiobook copy: brand rules, the link, and its audience.
//
// Run: node tests/email-layout.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { createRequire } from 'node:module';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const L = await import(path.join(root, 'public/js/email-layout-core.js'));
const { CAMPAIGN, FILTER, BOOK_ID } = require(path.join(root, 'scripts/seed-audiobook-campaign.js'));
const fnSrc = read('functions/index.js');
const pageSrc = read('public/js/campaigns.js');
const pageHtml = read('public/campaigns.html');

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}
const block = (src, start) => {
  const a = src.indexOf(start);
  assert.ok(a >= 0, 'could not find ' + start);
  const b = src.indexOf('\n);\n', a);
  return src.slice(a, b);
};

console.log('renderer');
ok('the server copy is generated from the browser module', () => {
  const browser = read('public/js/email-layout-core.js');
  const server = read('functions/email-layout-core.js');
  const body = browser.slice(0, browser.lastIndexOf('\nexport {') + 1);
  assert.ok(server.includes(body), 'functions/email-layout-core.js is stale: run node scripts/build-email-layout-server.cjs');
});
ok('nothing typed into a campaign becomes markup', () => {
  const html = L.renderCampaignEmail({ bodyText: '<script>alert(1)</script>\n\n<img src=x onerror=y>', signature: '<b>me</b>' });
  assert.ok(!/<script|<img src=x|<b>me/.test(html));
  assert.ok(html.includes('&lt;script&gt;'));
});
ok('a button line becomes a red button; other links stay links', () => {
  const html = L.renderCampaignEmail({ bodyText: '[Get it](https://the1pnation.com/x?a=1&b=2)\n\nRead [this](https://the1pnation.com/y) now.' });
  assert.match(html, /bgcolor="#e60306"[^>]*><a href="https:\/\/the1pnation\.com\/x\?a=1&amp;b=2"[^>]*>Get it<\/a>/);
  // Red with black text, as Anthony asked.
  assert.match(html, /<a href="https:\/\/the1pnation\.com\/x\?a=1&amp;b=2"[^>]*color:#000000;[^>]*>Get it<\/a>/);
  assert.match(html, /Read <a href="https:\/\/the1pnation\.com\/y"[^>]*>this<\/a> now\./);
});
ok('a javascript: link is dropped, not rendered', () => {
  const html = L.renderCampaignEmail({ bodyText: '[Click](javascript:alert(1))\n\n[x](javascript:y) inline' });
  assert.ok(!/href="javascript/i.test(html));
  assert.ok(!/javascript:alert/.test(html), 'an unsafe button line should fall back to escaped text, not a link');
});
ok('headings, lists and bold', () => {
  const blocks = L.parseBody('# Title\n\n- one\n- two\nafter\n\n**bold** text');
  assert.deepStrictEqual(blocks.map((b) => b.type), ['h', 'list', 'p', 'p']);
  assert.deepStrictEqual(blocks[1].items, ['one', 'two']);
  assert.match(L.renderCampaignEmail({ bodyText: '**bold** text' }), /<strong>bold<\/strong> text/);
});
ok('the banner links to the first button unless told otherwise', () => {
  const html = L.renderCampaignEmail({ bodyText: '[Go](https://the1pnation.com/go)', heroImageUrl: 'https://the1pnation.com/a.jpg' });
  assert.match(html, /<a href="https:\/\/the1pnation\.com\/go"[^>]*><img src="https:\/\/the1pnation\.com\/a\.jpg"/);
  // The signature headshot is always there; the banner must not be.
  const unsafe = L.renderCampaignEmail({ heroImageUrl: 'javascript:x' });
  assert.ok(!/javascript:/i.test(unsafe), 'an unsafe banner URL reached the email');
  assert.strictEqual((unsafe.match(/<img /g) || []).length, 1, 'only the headshot should render');
});
ok('every message ends in exactly one opt-out link, filled per recipient', () => {
  const html = L.renderCampaignEmail({ bodyText: 'hi' });
  assert.strictEqual(html.split(L.UNSUBSCRIBE_PLACEHOLDER).length - 1, 1);
  assert.ok(L.campaignPlainText({ bodyText: 'hi' }).endsWith('Unsubscribe: ' + L.UNSUBSCRIBE_PLACEHOLDER));
  assert.ok(L.renderCampaignEmail({ bodyText: 'hi', unsubscribeUrl: 'mailto:a@b.c' }).includes('href="mailto:a@b.c"'));
});
ok('colours survive Gmail: no background shorthand, every fill also a bgcolor', () => {
  const html = L.renderCampaignEmail({ bodyText: '# h\n\n- a\n\n[b](https://x.y/z)', heroImageUrl: 'https://x.y/a.jpg' });
  assert.ok(!/[;"]background:/.test(html), 'uses the background shorthand Gmail strips');
  // <body> is the one fill without a bgcolor attribute; the table under it has one.
  const fills = (html.match(/background-color:#[0-9a-f]{6}/gi) || []).length;
  const attrs = (html.match(/bgcolor="#[0-9a-f]{6}"/gi) || []).length;
  assert.strictEqual(fills - 1, attrs, 'a fill has no bgcolor fallback');
});
ok('the default signature carries the Alignment Audit link; empty means none', () => {
  assert.match(L.renderCampaignEmail({ bodyText: 'x' }), /book-a-call[^>]*>Book a Free Alignment Audit/);
  assert.match(L.renderCampaignEmail({ bodyText: 'x' }), /<img src="https:\/\/the1pnation\.com\/assets\/email\/anthony-brown-headshot\.jpg"/);
  assert.ok(!L.renderCampaignEmail({ bodyText: 'x', signature: '' }).includes('Alignment Audit'));
});
ok('plain text: buttons and links spell out their URL, markup is stripped', () => {
  const t = L.campaignPlainText({ bodyText: '# Head\n\n**b** [l](https://a.b/c)\n\n[Go](https://a.b/go)', signature: '' });
  assert.ok(t.startsWith('Head\n\nb l: https://a.b/c\n\nGo: https://a.b/go'), t);
});

ok('the 1-on-1 signature block carries the headshot and the booking button', () => {
  const html = L.signatureBlockHtml();
  assert.match(html, /<img src="https:\/\/the1pnation\.com\/assets\/email\/anthony-brown-headshot\.jpg"/);
  assert.match(html, />Anthony Brown Sr\.</);
  assert.match(html, /Book a Free Alignment Audit/);
  assert.ok(!/[;"]background:/.test(html));
  assert.strictEqual(L.signatureBlockHtml(''), '');
  assert.ok(!L.signatureBlockHtml('<b>x</b>').includes('<b>'));
  assert.ok(fs.existsSync(path.join(root, 'public/assets/email/anthony-brown-headshot.jpg')), 'headshot file is missing');
});
ok('the 1-on-1 plain-text signature spells out its links', () => {
  const t = L.signaturePlainText();
  assert.ok(t.startsWith('Anthony Brown Sr.\nFounder, The One Percent Nation'), t);
  assert.match(t, /Book a Free Alignment Audit: https:\/\//);
});

console.log('wiring');
ok('sendContactEmail signs every 1-on-1 email with the photo signature', () => {
  const a = fnSrc.indexOf('exports.sendContactEmail = onCall(');
  const b = fnSrc.slice(a, fnSrc.indexOf('\n);\n', a));
  assert.match(b, /const signature = identity\.signature\.trim\(\) \|\| emailLayout\.DEFAULT_SIGNATURE/);
  assert.match(b, /emailLayout\.signatureBlockHtml\(signature\)/);
  assert.match(b, /emailLayout\.signaturePlainText\(signature\)/);
});
ok('CRM settings and the contact composer preview the signature with the same renderer', () => {
  const settings = read('public/js/crm-settings.js');
  const contact = read('public/js/contact-page.js');
  for (const src of [settings, contact]) assert.match(src, /import \{ signatureBlockHtml, DEFAULT_SIGNATURE \} from '\.\/email-layout-core\.js'/);
  assert.match(settings, /id="em-sig-preview"[^>]*\bsandbox\b/);
  assert.match(contact, /id="cp-em-sig"[^>]*\bsandbox\b/);
  assert.match(contact, /em-sig-chip/);
});
ok('sendCampaign renders branded campaigns from text at send time', () => {
  const b = block(fnSrc, 'exports.sendCampaign = onCall(');
  assert.match(b, /campaign\.layout === 'branded'/);
  assert.match(b, /emailLayout\.renderCampaignEmail\(campaignLayoutOptions\(campaign\)\)/);
  assert.match(b, /const htmlPersonalized = branded \? brandedHtml :/);
  assert.match(b, /const textPersonalized = branded \? brandedText :/);
});
ok('sendCampaignTest is admin-only, rate limited, and mails only the caller', () => {
  const b = block(fnSrc, 'exports.sendCampaignTest = onCall(');
  const guard = b.indexOf('assertCompanyAdmin(db, companyId, request)');
  assert.ok(guard > 0 && guard < b.indexOf('sendEmail('), 'admin check must come before the send');
  assert.match(b, /rateLimitCaller\(db, request, \{ action: 'sendCampaignTest'/);
  assert.match(b, /const to = normalizeEmail\(request\.auth\.token && request\.auth\.token\.email\)/);
  assert.match(b, /subject: testSubject/);
  assert.match(b, /'\[TEST\] '/);
  assert.ok(!/campaignRef|\.update\(/.test(b), 'a test must not touch the campaign');
});
ok('buildRecipients skips owners of a book and members of a course', () => {
  const i = fnSrc.indexOf('async function buildRecipients(');
  const b = fnSrc.slice(i, fnSrc.indexOf('\n}\n', i));
  assert.match(b, /addSkips\('enrolledCourseSlugs', filter && filter\.excludeEnrolledIn\)/);
  assert.match(b, /addSkips\('ownedBookIds', filter && filter\.excludeOwnersOf\)/);
});
ok('the campaigns page previews with the same renderer and can test and send a draft', () => {
  assert.match(pageSrc, /import \{ renderCampaignEmail, DEFAULT_SIGNATURE \} from '\.\/email-layout-core\.js'/);
  assert.match(pageSrc, /httpsCallable\(functions, 'sendCampaignTest'\)/);
  for (const id of ['camp-d-test', 'camp-d-send', 'camp-d-preview', 'camp-d-actions']) {
    assert.ok(pageHtml.includes(`id="${id}"`), `campaigns.html is missing #${id}`);
  }
  assert.match(pageHtml, /<iframe id="camp-d-preview"[^>]*\bsandbox\b/);
  assert.match(pageSrc, /<iframe id="cf-preview"[^>]*\bsandbox\b/);
  assert.match(pageSrc, /Skips anyone who already owns/);
});

console.log('audiobook draft');
ok('branded, with the banner, the link and a subject that fits', () => {
  assert.strictEqual(CAMPAIGN.id, 'icant-audiobook-launch');
  assert.ok(CAMPAIGN.subject.length <= 60);
  assert.match(CAMPAIGN.heroImageUrl, /^https:\/\/the1pnation\.com\/assets\/i-cant-audio-share\.jpg$/);
  assert.ok(fs.existsSync(path.join(root, 'public/assets/i-cant-audio-share.jpg')), 'banner file is missing');
  assert.match(CAMPAIGN.body, /\[Get the Audiobook\]\(https:\/\/the1pnation\.com\/icantaudio\?utm_source=email/);
  assert.match(read('scripts/seed-audiobook-campaign.js'), /layout: 'branded'/);
});
ok('brand rules: no dashes, no hype, no narration claim, no {{firstName}} in the body', () => {
  const all = CAMPAIGN.subject + CAMPAIGN.preheader + CAMPAIGN.body;
  assert.ok(!/[—–]/.test(all), 'has an em or en dash');
  assert.ok(!/\b(hurry|act now|don't miss|last chance|limited time|!!)/i.test(all), 'reads as hype');
  assert.ok(!/my (own )?voice|narrated by me|I read/i.test(all), 'claims Anthony narrates it');
  assert.ok(!/\{\{/.test(CAMPAIGN.body));
  assert.match(CAMPAIGN.body, /\$9\.99/);
});
ok('goes to everyone except people who already own it', () => {
  assert.strictEqual(FILTER.mode, 'all_contacts');
  assert.strictEqual(FILTER.excludeOwnersOf, BOOK_ID);
  assert.strictEqual(JSON.parse(read('scripts/audiobooks/i-cant.json')).bookId, BOOK_ID);
});

console.log(`\n${passed} passed`);
