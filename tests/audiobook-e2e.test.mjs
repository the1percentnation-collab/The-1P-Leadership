// The audiobook, end to end, on the real emulators and a real browser.
//
// A stranger hears the free chapter and sees the $9.99 button; a signed
// Stripe event for the product puts the book on the buyer's shelf and sends
// the receipt; the buyer presses play in Chromium and the shipped player
// streams real MP3s through audioPass + bookAudio, seeking past the first
// 4 MB slice; their place syncs; their private podcast feed lists both
// chapters and serves the whole file to a podcast app; resetting the feed
// kills the old link. Nothing in public/ is stubbed except the lines that
// point the SDK at the emulators and the sign-in.
//
// Needs ffmpeg (to make the chapters) and Chromium via Playwright. From the
// repo root: tests/run-e2e.sh audiobook
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const PUB = path.join(ROOT, 'public');
const SDK_DIR = path.join(ROOT, 'tests', 'node_modules', 'firebase');
const stripe = require(path.join(ROOT, 'functions', 'node_modules', 'stripe'))('sk_test_fake');
const PROJECT = 'demo-1p';
const BUCKET = `${PROJECT}.appspot.com`;
const AUTH = 'http://127.0.0.1:9099';
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const PORT = 8765;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const CAPTURE_PORT = 8766;
const WEBHOOK_SECRET = 'whsec_e2e_fake';
const BOOK = 'i-cant-audio';
const PRODUCT = 'icant-audio-product';

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Two real chapters: five minutes (past one 4 MB slice) and twenty seconds
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiobook-e2e-'));
const ch1 = path.join(dir, 'ch1.mp3');
const ch2 = path.join(dir, 'ch2.mp3');
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=300', '-b:a', '128k', '-ac', '1', ch1]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=20', '-b:a', '128k', '-ac', '1', ch2]);
const ch1Bytes = fs.readFileSync(ch1);
const ch2Bytes = fs.readFileSync(ch2);
assert(ch1Bytes.length > 4 * 1024 * 1024, 'chapter one must span more than one slice');

// ── Email capture: what the functions think is Telnyx ─────────────────────
const emails = [];
const capture = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url.endsWith('/email_messages')) {
      emails.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { id: `msg_${emails.length}` } }));
      return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => capture.listen(CAPTURE_PORT, '127.0.0.1', r));

// ── Static server for public/, with Hosting's audio rewrites ──────────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const REWRITES = { '/api/book-audio': 'bookAudio', '/api/audio-feed': 'audioFeed' };
const audioHits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, ORIGIN);
  if (REWRITES[u.pathname]) {
    if (u.pathname === '/api/book-audio') audioHits.push({ range: req.headers.range || null, track: u.searchParams.get('track') });
    const up = http.request(`${FN}/${REWRITES[u.pathname]}${u.search}`,
      { method: req.method, headers: req.headers.range ? { range: req.headers.range } : {} },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    up.end();
    return;
  }
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  let f = path.join(PUB, p);
  // cleanUrls, as Hosting does it: /books is books.html even though a
  // public/books/ folder (the preview EPUB) shares the name.
  if ((!fs.existsSync(f) || fs.statSync(f).isDirectory()) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ── Wait for the functions emulator ───────────────────────────────────────
for (let i = 0; i < 90; i++) {
  try {
    const r = await fetch(`${FN}/stripeWebhook`, { method: 'POST', body: '{}' });
    if (r.status === 400 || r.status === 503) break;
  } catch (e) { /* not yet */ }
  await sleep(1000);
}

// ── Users + seed ──────────────────────────────────────────────────────────
async function authUser(email, password, signUp = true) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:${signUp ? 'signUp' : 'signInWithPassword'}?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const j = await r.json();
  if (!j.localId) throw new Error('auth emulator failed: ' + JSON.stringify(j));
  return j;
}
const PW = 'password123';
const buyerUid = (await authUser('buyer@e2e.test', PW)).localId;
const strangerUid = (await authUser('stranger@e2e.test', PW)).localId;
const adminUid = (await authUser('admin@e2e.test', PW)).localId;
// E2E_SHOTS=/some/dir saves phone-width screenshots of each view.
const SHOTS = process.env.E2E_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }) : null);

const env = await initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { host: '127.0.0.1', port: 8080, rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') },
  storage: { host: '127.0.0.1', port: 9199, rules: fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8') }
});
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, `books/${BOOK}`), {
    title: 'I Can\'t: The Audiobook', author: 'Anthony Brown Sr.', status: 'live', format: 'audio', version: String(Date.UTC(2026, 9, 1)),
    description: 'Strategies to overcome your limiting beliefs.', sampleTrack: 0,
    tracks: [
      { title: 'Introduction', path: `books/${BOOK}/audio-01.mp3`, duration: 300, size: ch1Bytes.length },
      { title: 'Chapter One', path: `books/${BOOK}/audio-02.mp3`, duration: 20, size: ch2Bytes.length }
    ]
  });
  await setDoc(doc(db, `products/${PRODUCT}`), {
    name: 'I Can\'t Audiobook', type: 'book', status: 'live', sellable: true, price: 9.99,
    requiresShipping: false, grantsBooks: [BOOK], showOnSite: true, showInDashboard: true,
    pageUrl: `/listen?book=${BOOK}`, pageCta: 'Listen free', pageNote: 'Instant access. Plays in your browser or your podcast app.', sortOrder: 1
  });
  await setDoc(doc(db, `users/${buyerUid}`), { email: 'buyer@e2e.test', displayName: 'Jordan Buyer', role: 'user', onboardingComplete: true, ownedBookIds: [] });
  await setDoc(doc(db, `users/${strangerUid}`), { email: 'stranger@e2e.test', role: 'user', onboardingComplete: true, ownedBookIds: [] });
  await setDoc(doc(db, `users/${adminUid}`), { email: 'admin@e2e.test', role: 'admin', onboardingComplete: true });
  const st = ctx.storage(`gs://${BUCKET}`);
  await uploadBytes(ref(st, `books/${BOOK}/audio-01.mp3`), ch1Bytes, { contentType: 'audio/mpeg' });
  await uploadBytes(ref(st, `books/${BOOK}/audio-02.mp3`), ch2Bytes, { contentType: 'audio/mpeg' });
});
async function read(p) {
  let out = null;
  await env.withSecurityRulesDisabled(async (ctx) => {
    const s = await getDoc(doc(ctx.firestore(), p));
    out = s.exists() ? s.data() : null;
  });
  return out;
}
async function callable(name, data, idToken) {
  const r = await fetch(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data })
  });
  return r.json();
}

// ── The shipped page, pointed at the emulators ────────────────────────────
const firebaseJs = fs.readFileSync(path.join(PUB, 'js/firebase.js'), 'utf8')
  .replace('projectId: "the-1p-leadership"', `projectId: "${PROJECT}"`)
  .replace('storageBucket: "the-1p-leadership.firebasestorage.app"', `storageBucket: "${BUCKET}"`)
  + `
import { connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { getStorage, connectStorageEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
connectAuthEmulator(_auth, '${AUTH}', { disableWarnings: true });
connectStorageEmulator(getStorage(_app), '127.0.0.1', 9199);
connectFirestoreEmulator(_db, '127.0.0.1', 8080);
connectFunctionsEmulator(_functions, '127.0.0.1', 5001);
`;
const shippedAuth = fs.readFileSync(path.join(PUB, 'js/auth.js'), 'utf8');
if (!shippedAuth.includes('if (firebaseReady) {\n  onAuthStateChanged(auth, (u) => {')) throw new Error('auth.js shape changed; update the e2e hook');
const authJs = shippedAuth
  .replace('if (firebaseReady) {\n  onAuthStateChanged(auth, (u) => {', `if (firebaseReady) {
  const __who = JSON.parse(localStorage.getItem('__e2e_user') || 'null');
  (__who ? signInWithEmailAndPassword(auth, __who.email, __who.password) : Promise.resolve())
    .catch((e) => console.error('e2e sign-in failed', e))
    .then(() => onAuthStateChanged(auth, (u) => {`)
  .replace(/_authReadyResolve\(u\);\n  \}\);\n\}/, '_authReadyResolve(u);\n  }));\n}');

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
async function makeContext(who, device = devices['Pixel 7']) {
  const ctx = await browser.newContext(device);
  if (who) await ctx.addInitScript((w) => { localStorage.setItem('__e2e_user', JSON.stringify(w)); }, who);
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'www.gstatic.com') {
      const base = path.basename(u.pathname);
      if (/^firebase-[a-z-]+\.js$/.test(base) && fs.existsSync(path.join(SDK_DIR, base))) return route.fulfill({
        body: fs.readFileSync(path.join(SDK_DIR, base), 'utf8').replace(/firebasejs\/[\d.]+\//g, 'firebasejs/10.12.0/'),
        contentType: 'text/javascript'
      });
      return route.abort();
    }
    if (u.hostname === '127.0.0.1' && u.port === String(PORT)) {
      if (u.pathname === '/js/firebase.js') return route.fulfill({ body: firebaseJs, contentType: 'text/javascript' });
      if (u.pathname === '/js/auth.js') return route.fulfill({ body: authJs, contentType: 'text/javascript' });
      return route.continue();
    }
    if (u.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) console.log('   [console]', m.text().slice(0, 200)); });
  page.on('dialog', (d) => d.accept());
  page.on('response', (r) => { if (r.status() === 404) console.log('   [404]', r.url().slice(0, 160)); });
  return { ctx, page };
}

// ── 1. A stranger: free sample, price, nothing else ───────────────────────
await t('the sample chapter streams to anyone, a paid chapter does not', async () => {
  const s = await fetch(`${ORIGIN}/api/book-audio?book=${BOOK}&track=0`, { headers: { Range: 'bytes=0-1' } });
  assert(s.status === 206, `sample ${s.status}`);
  assert(s.headers.get('content-range') === `bytes 0-1/${ch1Bytes.length}`, s.headers.get('content-range'));
  const p = await fetch(`${ORIGIN}/api/book-audio?book=${BOOK}&track=1`, { headers: { Range: 'bytes=0-1' } });
  assert(p.status === 401, `paid chapter ${p.status}`);
});

const G = await makeContext(null);
await t('a signed-out visitor sees the sales view: price, free chapter, no player', async () => {
  await G.page.goto(`${ORIGIN}/listen?book=${BOOK}`);
  await G.page.waitForSelector('#ls-buy', { timeout: 30000 });
  const label = await G.page.textContent('#ls-buy');
  assert(/\$9\.99/.test(label), label);
  assert(await G.page.$('.ls-sample audio'), 'free chapter player');
  assert(!(await G.page.$('#ls-play')), 'no player for a stranger');
  await shot(G.page, '1-sales');
});
await t('the public /books shop lists the audiobook and links to its page', async () => {
  await G.page.goto(`${ORIGIN}/books`);
  const link = await G.page.waitForSelector(`#home-shop a[href="/listen?book=${BOOK}"]`, { timeout: 30000 })
    .catch(async (e) => {
      console.log('   [shop]', (await G.page.$eval('#home-shop', (el) => el.outerHTML).catch(() => 'no #home-shop')).slice(0, 600));
      throw e;
    });
  assert(/Listen free/.test(await link.textContent()), await link.textContent());
  assert(/Plays in your browser/.test(await G.page.textContent('#home-shop')), 'page note');
  await G.page.goto(`${ORIGIN}/listen?book=${BOOK}`);
  await G.page.waitForSelector('#ls-buy', { timeout: 30000 });
});
await t('buying while signed out goes to sign-in and comes back to buy', async () => {
  await G.page.click('#ls-buy');
  await G.page.waitForURL(/\/login(\.html)?\?next=/, { timeout: 10000 });
  const next = new URL(G.page.url()).searchParams.get('next');
  assert(next === `/listen?book=${BOOK}&buy=1`, next);
});
await G.ctx.close();

await t('a member who has not bought it cannot get a listening pass', async () => {
  const tok = (await authUser('stranger@e2e.test', PW, false)).idToken;
  const r = await callable('audioPass', { bookId: BOOK }, tok);
  assert(r.error && r.error.status === 'PERMISSION_DENIED', JSON.stringify(r));
});

await t('a member who has not bought it sees it under Also available in their Library', async () => {
  const S = await makeContext({ email: 'stranger@e2e.test', password: PW });
  await S.page.goto(`${ORIGIN}/library`);
  const card = await S.page.waitForSelector(`a.lib-avail[href="/listen?book=${BOOK}"]`, { timeout: 30000 });
  const txt = await card.textContent();
  assert(/Audiobook/.test(txt) && /\$9\.99/.test(txt) && /Listen free/.test(txt), txt);
  await S.ctx.close();
});

// ── Sales and promo codes ─────────────────────────────────────────────────
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'coupons/HALFAUDIO'), { percentOff: 50, amountOff: null, active: true, redemptions: 0, appliesTo: { kind: 'product', ids: [PRODUCT] } });
  await setDoc(doc(db, 'coupons/COURSEONLY'), { percentOff: 20, amountOff: null, active: true, redemptions: 0, appliesTo: { kind: 'course', ids: [] } });
  await setDoc(doc(db, 'coupons/ALLFREE'), { percentOff: 100, amountOff: null, active: true, redemptions: 0, appliesTo: { kind: 'product', ids: [] } });
});
const setSale = (salePrice) => env.withSecurityRulesDisabled((ctx) =>
  setDoc(doc(ctx.firestore(), `products/${PRODUCT}`), { salePrice }, { merge: true }));

await t('a promo code for the audiobook comes off the sale price while a sale runs', async () => {
  const tok = (await authUser('stranger@e2e.test', PW, false)).idToken;
  await setSale(7.99);
  const r = await callable('validateCoupon', { code: 'HALFAUDIO', kind: 'product', id: PRODUCT }, tok);
  assert(r.result && r.result.originalPrice === 7.99 && r.result.discountedPrice === 4, JSON.stringify(r));
  const wrong = await callable('validateCoupon', { code: 'COURSEONLY', kind: 'product', id: PRODUCT }, tok);
  assert(wrong.error && /doesn.t apply/.test(wrong.error.message), JSON.stringify(wrong));
  await setSale(null);
  const full = await callable('validateCoupon', { code: 'HALFAUDIO', kind: 'product', id: PRODUCT }, tok);
  assert(full.result && full.result.discountedPrice === 5, JSON.stringify(full));
});

await t('the audiobook page shows the sale price and applies a code from the link', async () => {
  await setSale(7.99);
  const P = await makeContext({ email: 'stranger@e2e.test', password: PW });
  await P.page.goto(`${ORIGIN}/listen?book=${BOOK}`);
  await P.page.waitForSelector('#ls-buy', { timeout: 30000 });
  const sale = await P.page.$eval('#ls-buy', (b) => b.innerHTML);
  assert(/<s[^>]*>\$9\.99<\/s>/.test(sale) && /\$7\.99/.test(sale), sale);
  await P.page.goto(`${ORIGIN}/listen?book=${BOOK}&promo=halfaudio`);
  await P.page.waitForFunction(() => /HALFAUDIO/.test((document.getElementById('ls-promo-msg') || {}).textContent || ''), null, { timeout: 30000 });
  const withCode = await P.page.$eval('#ls-buy', (b) => b.textContent);
  assert(/\$4\b/.test(withCode) && /\$7\.99/.test(withCode), withCode);
  // A code typed in by hand, and one that would make it free, which the page refuses up front.
  await P.page.click('#ls-promo-remove');
  await P.page.fill('#ls-promo-code', 'ALLFREE');
  await P.page.click('#ls-promo-apply');
  await P.page.waitForFunction(() => /under 100%/.test((document.getElementById('ls-promo-msg') || {}).textContent || ''), null, { timeout: 20000 });
  assert(/\$7\.99/.test(await P.page.$eval('#ls-buy', (b) => b.textContent)), 'price unchanged after a refused code');
  await P.ctx.close();
  await setSale(null);
});

// ── 2. The purchase ───────────────────────────────────────────────────────
await t('a paid checkout for the product puts the audiobook on the shelf', async () => {
  const session = {
    id: 'cs_audio_1', object: 'checkout.session', mode: 'payment', payment_status: 'paid',
    amount_total: 999, currency: 'usd', client_reference_id: buyerUid,
    customer_details: { email: 'buyer@e2e.test', name: 'Jordan Buyer' }, customer_email: 'buyer@e2e.test',
    metadata: { productId: PRODUCT, uid: buyerUid, grantsBooks: BOOK }
  };
  const event = { id: 'evt_audio_1', object: 'event', type: 'checkout.session.completed', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), livemode: false, data: { object: session } };
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const r = await fetch(`${FN}/stripeWebhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'stripe-signature': header }, body: payload });
  assert(r.status === 200, `webhook ${r.status} ${await r.text()}`);
  const u = await read(`users/${buyerUid}`);
  assert((u.ownedBookIds || []).includes(BOOK), JSON.stringify(u.ownedBookIds));
});
await t('the order is born fulfilled, so it never waits in the shipping queue', async () => {
  const o = await read('orders/cs_audio_1');
  assert(o && o.status === 'done' && o.digital === true, JSON.stringify(o));
  const p = await read(`users/${buyerUid}/purchases/cs_audio_1`);
  assert(p && p.confirmationEmail === 'sent', JSON.stringify(p));
});
await t('the receipt says press play and links straight to the player', async () => {
  // Signing up sends its own welcome email; the receipt is the one about the book.
  const mine = emails.filter((e) => JSON.stringify(e).includes('buyer@e2e.test'));
  const m = mine.find((e) => /^Press play: /.test(e.subject || ''));
  assert(m, `no receipt among ${mine.length} emails: ${mine.map((e) => e.subject).join(' | ')}`);
  assert(JSON.stringify(m).includes(`/listen?book=${BOOK}`), 'link to the player');
});
await t('buying again is refused before Stripe is ever called', async () => {
  const tok = (await authUser('buyer@e2e.test', PW, false)).idToken;
  const r = await callable('createCheckoutSession', { productId: PRODUCT }, tok);
  assert(r.error && r.error.status === 'ALREADY_EXISTS', JSON.stringify(r));
});

// ── 3. Listening ──────────────────────────────────────────────────────────
const B = await makeContext({ email: 'buyer@e2e.test', password: PW });
await t('the buyer lands on the player with every chapter', async () => {
  await B.page.goto(`${ORIGIN}/listen?book=${BOOK}&purchase=success`);
  await B.page.waitForSelector('#ls-play', { timeout: 30000 });
  assert(await B.page.$('.ls-toast'), 'purchase welcome');
  const n = await B.page.$$eval('.ls-chapters li', (l) => l.length);
  assert(n === 2, `chapters ${n}`);
});
await t('pressing play streams real audio through a listening pass', async () => {
  await B.page.waitForFunction(() => !/couldn't/.test(document.getElementById('ls-status').textContent), null, { timeout: 15000 });
  await B.page.click('#ls-play:not([disabled])');
  await B.page.waitForFunction(() => document.getElementById('ls-cur').textContent !== '0:00', null, { timeout: 20000 });
  assert(audioHits.some((h) => h.track === '0' && h.range), 'player sent Range requests');
});
await t('seeking past the first 4 MB slice keeps playing', async () => {
  await B.page.$eval('#ls-seek', (el) => { el.value = '280'; el.dispatchEvent(new Event('input')); });
  await B.page.waitForFunction(() => /^4:[4-5]\d$/.test(document.getElementById('ls-cur').textContent), null, { timeout: 20000 });
  const late = audioHits.filter((h) => h.track === '0' && h.range && Number((/bytes=(\d+)-/.exec(h.range) || [])[1]) >= 4 * 1024 * 1024);
  assert(late.length, `no request past the first slice: ${JSON.stringify(audioHits.slice(-5))}`);
});
await t('pausing saves the place, synced to Firestore', async () => {
  await B.page.click('#ls-play');
  let pos = null;
  for (let i = 0; i < 20 && !(pos && pos.time > 270); i++) { await sleep(500); pos = await read(`users/${buyerUid}/bookProgress/${BOOK}`); }
  assert(pos && pos.track === 0 && pos.time > 270, JSON.stringify(pos));
});
await t('next chapter plays the next track', async () => {
  await B.page.click('#ls-next');
  await B.page.waitForSelector('.ls-chapters li.is-current[data-i="1"]', { timeout: 10000 });
  await B.page.waitForFunction(() => document.getElementById('ls-cur').textContent !== '0:00', null, { timeout: 20000 });
});
await t('coming back resumes in the chapter they left', async () => {
  await B.page.click('#ls-play');
  await sleep(1500);
  await B.page.reload();
  await B.page.waitForSelector('#ls-play', { timeout: 30000 });
  await B.page.waitForSelector('.ls-chapters li.is-current[data-i="1"]', { timeout: 10000 });
});

// ── 4. The private podcast feed ───────────────────────────────────────────
let feedUrl = '';
await t('the portal shows one-tap podcast app links and the private feed', async () => {
  await B.page.waitForSelector('#ls-feed-url', { timeout: 20000 });
  feedUrl = await B.page.$eval('#ls-feed-url', (el) => el.value);
  assert(feedUrl.startsWith('https://the1pnation.com/api/audio-feed?'), feedUrl);
  const apple = await B.page.$eval('.ls-app', (a) => a.getAttribute('href'));
  assert(apple.startsWith('podcast://the1pnation.com/api/audio-feed?'), apple);
  await shot(B.page, '2-player');
});
const local = (u) => u.replace('https://the1pnation.com', ORIGIN);
let enclosure = '';
await t('the feed lists both chapters as episodes, in order', async () => {
  const r = await fetch(local(feedUrl));
  assert(r.status === 200, `feed ${r.status}`);
  assert(/rss\+xml/.test(r.headers.get('content-type')), r.headers.get('content-type'));
  const xml = await r.text();
  const titles = [...xml.matchAll(/<item>\s*<title>([^<]*)<\/title>/g)].map((m) => m[1]);
  assert(titles.join('|') === 'Introduction|Chapter One', titles.join('|'));
  // Chapter two: chapter one is the free sample and plays without a feed.
  enclosure = [...xml.matchAll(/<enclosure url="([^"]+)"/g)][1][1].replace(/&amp;/g, '&');
});
await t('a podcast app downloads a whole chapter in one request, past the 4 MB slice', async () => {
  const big = enclosure.replace('track=1', 'track=0');
  const r0 = await fetch(big);
  assert(r0.status === 200, `chapter one ${r0.status}`);
  assert(Buffer.from(await r0.arrayBuffer()).equals(ch1Bytes), 'chapter one bytes');
});
await t('the paid chapter downloads through the feed credential', async () => {
  const r = await fetch(enclosure);
  assert(r.status === 200, `episode ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert(bytes.equals(ch2Bytes), `got ${bytes.length} of ${ch2Bytes.length} bytes`);
});
await t('a new feed link kills the old one', async () => {
  await B.page.click('#ls-feed-reset');
  await B.page.waitForFunction((old) => { const el = document.getElementById('ls-feed-url'); return el && el.value !== old; }, feedUrl, { timeout: 20000 });
  const fresh = await B.page.$eval('#ls-feed-url', (el) => el.value);
  assert((await fetch(local(feedUrl))).status === 401, 'old feed still works');
  assert((await fetch(enclosure)).status === 401, 'old episode link still works');
  assert((await fetch(local(fresh))).status === 200, 'new feed works');
});

// ── 5. Around the site ────────────────────────────────────────────────────
await t('the library shelf opens the audiobook in the player', async () => {
  await B.page.goto(`${ORIGIN}/library`);
  await B.page.waitForSelector(`a[href="/listen?book=${BOOK}"]`, { timeout: 30000 });
  assert(!(await B.page.$('a.lib-avail')), 'an owned book is not offered again');
  const txt = await B.page.textContent('#lib-root');
  assert(/Audiobook/.test(txt), 'labelled as an audiobook');
  await shot(B.page, '3-library');
});
await t('a /read link to the audiobook goes to the player', async () => {
  await B.page.goto(`${ORIGIN}/read?book=${BOOK}`);
  await B.page.waitForURL(/\/listen\?book=/, { timeout: 20000 });
});
await B.ctx.close();

// ── 6. Admin: upload an audiobook, then sell it ───────────────────────────
// Desktop: the admin consoles are worked from a computer.
const A = await makeContext({ email: 'admin@e2e.test', password: PW }, devices['Desktop Chrome']);
await t('an admin uploads an audiobook\'s chapters from Manage Library', async () => {
  await A.page.goto(`${ORIGIN}/manage-library.html`);
  await A.page.waitForSelector('#btn-new-book:not([disabled])', { timeout: 30000 });
  await A.page.click('#btn-new-book');
  await A.page.fill('#b-title', 'Work Less Audio');
  await A.page.selectOption('#b-format', 'audio');
  assert(await A.page.isHidden('#b-epub-row'), 'EPUB picker hides for an audiobook');
  await A.page.setInputFiles('#b-audio', [
    { name: '02 - Chapter One.mp3', mimeType: 'audio/mpeg', buffer: ch2Bytes },
    { name: '01 - Introduction.mp3', mimeType: 'audio/mpeg', buffer: ch2Bytes }
  ]);
  await A.page.waitForFunction(() => /2 chapters/.test(document.getElementById('b-audio-name').textContent), null, { timeout: 20000 });
  const titles = await A.page.$$eval('#b-tracks [data-title]', (l) => l.map((i) => i.value));
  assert(titles.join('|') === 'Introduction|Chapter One', titles.join('|'));
  await shot(A.page, '4-admin-upload');
  await A.page.click('#b-save');
  await A.page.waitForSelector('#modal-bd', { state: 'detached', timeout: 60000 });
  const b = await read('books/work-less-audio');
  assert(b && b.format === 'audio' && b.tracks.length === 2, JSON.stringify(b));
  assert(b.tracks[0].path === 'books/work-less-audio/audio-01.mp3' && b.tracks[0].title === 'Introduction', JSON.stringify(b.tracks[0]));
  assert(b.tracks[0].duration >= 19 && b.tracks[0].duration <= 21, `duration ${b.tracks[0].duration}`);
  assert(b.sampleTrack === 0 && b.buyHref === '/listen?book=work-less-audio', JSON.stringify(b));
});
await t('the product editor offers the audiobook under "Unlocks in My Library"', async () => {
  await A.page.goto(`${ORIGIN}/manage-products.html`);
  await A.page.waitForSelector(`[data-edit="${PRODUCT}"]`, { timeout: 30000 });
  await A.page.click(`[data-edit="${PRODUCT}"]`);
  const sel = await A.page.$eval('#p-books', (s) => s.value);
  assert(sel === BOOK, sel);
  const opts = await A.page.$$eval('#p-books option', (l) => l.map((o) => o.textContent));
  assert(opts.some((o) => /Work Less Audio \(audiobook\)/.test(o)), opts.join('|'));
  await A.page.click('button[type="submit"]');
  await A.page.waitForSelector('#modal-bd', { state: 'detached', timeout: 20000 });
  const p = await read(`products/${PRODUCT}`);
  assert(JSON.stringify(p.grantsBooks) === JSON.stringify([BOOK]), JSON.stringify(p.grantsBooks));
});
await A.ctx.close();

await browser.close();
server.close();
capture.close();
await env.cleanup();
fs.rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} passed`);
failed.forEach((f) => console.log('FAIL', f[1], '\n   ', f[2]));
process.exit(failed.length ? 1 : 0);
