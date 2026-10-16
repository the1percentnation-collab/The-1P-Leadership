// Drive sync, end to end, against the Firestore emulator and a fake Google
// Drive: the real scripts/drive-sync.mjs runs as a child process with its
// API bases pointed at a local server. Checks the waiting state, the folder
// tree, Google-native conversion, idempotent re-runs, and in-place updates.
//
// Run from the repo root:
//   tests/node_modules/.bin/firebase emulators:exec --only firestore --project demo-1p \
//     "node tests/drive-sync-e2e.test.mjs"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const admin = require(path.join(ROOT, 'functions', 'node_modules', 'firebase-admin'));
const PROJECT = 'demo-1p';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log('✅', name); }
  catch (e) { results.push(['FAIL', name, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')]); console.log('❌', name, '—', e && e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

// ── Fake Google: token endpoint + the slice of Drive v3 the sync uses ─────
const store = new Map();   // id → { id, name, mimeType, parents, size, trashed }
const calls = [];
let seq = 0;
const fake = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    calls.push(`${req.method} ${url.pathname}`);
    if (url.pathname === '/token') {
      const p = new URLSearchParams(body.toString());
      return p.get('refresh_token') === 'refresh-ok' ? send(200, { access_token: 'access-ok', expires_in: 3600 }) : send(400, { error: 'invalid_grant' });
    }
    if (req.headers.authorization !== 'Bearer access-ok') return send(401, { error: { message: 'bad token' } });
    const link = (id) => `https://drive.google.com/fake/${id}`;
    let m;
    if (req.method === 'GET' && (m = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const f = store.get(decodeURIComponent(m[1]));
      return f ? send(200, { id: f.id, trashed: !!f.trashed, mimeType: f.mimeType }) : send(404, { error: { message: 'not found' } });
    }
    if (req.method === 'POST' && url.pathname === '/drive/v3/files') {
      const meta = JSON.parse(body.toString());
      const id = `fold${++seq}`;
      store.set(id, { id, ...meta, parents: meta.parents || ['root'] });
      return send(200, { id, webViewLink: link(id) });
    }
    if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files' && url.searchParams.get('uploadType') === 'multipart') {
      const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'])[1];
      const parts = body.toString('latin1').split(`--${boundary}`);
      const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
      const media = parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
      const id = `file${++seq}`;
      store.set(id, { id, ...meta, size: Buffer.byteLength(media, 'latin1') });
      return send(200, { id, webViewLink: link(id) });
    }
    if (req.method === 'PATCH' && (m = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/))) {
      const f = store.get(decodeURIComponent(m[1]));
      if (!f) return send(404, { error: { message: 'not found' } });
      f.size = body.length; f.updated = (f.updated || 0) + 1;
      return send(200, { id: f.id, webViewLink: link(f.id) });
    }
    send(404, { error: { message: `unhandled ${req.method} ${url.pathname}` } });
  });
});
await new Promise((r) => fake.listen(8767, '127.0.0.1', r));

// ── A scratch repo with a social/ folder ──────────────────────────────────
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-sync-'));
const put = (rel, data) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), data); };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
put('social/2026-10 Launch/Feed (1080x1350)/01 Hook.png', PNG);
put('social/2026-10 Launch/Posting Schedule.gsheet.csv', 'Post,Day\n1,Day 1\n');
put('social/.DS_Store', 'junk');

function run() {
  return new Promise((resolve) => {
    const summaryFile = path.join(repo, `summary-${Date.now()}.md`);
    execFile(process.execPath, [path.join(ROOT, 'scripts', 'drive-sync.mjs')], {
      env: {
        ...process.env,
        GCLOUD_PROJECT: PROJECT,
        GOOGLE_APPLICATION_CREDENTIALS: '',
        DRIVE_SYNC_REPO_ROOT: repo,
        DRIVE_SYNC_API_BASE: 'http://127.0.0.1:8767',
        DRIVE_SYNC_TOKEN_URL: 'http://127.0.0.1:8767/token',
        GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'csecret',
        GITHUB_STEP_SUMMARY: summaryFile
      }
    }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, out: stdout + stderr, summary: fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '' });
    });
  });
}
const files = () => [...store.values()].filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
const folders = () => [...store.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
const byName = (n) => [...store.values()].find((f) => f.name === n);

await t('without the Drive permission, the run passes and says it is waiting', async () => {
  await db.doc('companies/c1/private/googleOAuth').set({ refreshToken: 'refresh-ok', googleEmail: 'owner@x.com', scopes: 'openid email https://www.googleapis.com/auth/calendar.events' });
  const r = await run();
  assert(r.code === 0, r.out);
  assert(/Reconnect Google/.test(r.summary), r.summary);
  assert(store.size === 0, 'nothing should upload');
});

await db.doc('companies/c1/private/googleOAuth').set({ scopes: 'openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file' }, { merge: true });

await t('first run builds the folder tree and uploads every file', async () => {
  const r = await run();
  assert(r.code === 0, r.out);
  assert(folders().map((f) => f.name).sort().join('|') === ['2026-10 Launch', 'Feed (1080x1350)', 'Social Media - Ready to Post'].sort().join('|'), JSON.stringify(folders()));
  assert(files().length === 2, JSON.stringify(files()));
});

await t('the image sits in its own folder with its bytes intact', async () => {
  const img = byName('01 Hook.png');
  const feed = byName('Feed (1080x1350)');
  assert(img && feed && img.parents[0] === feed.id, JSON.stringify({ img, feed }));
  assert(img.size === PNG.length, `size ${img.size}`);
});

await t('the schedule becomes a Google Sheet named without the suffix', async () => {
  const sheet = byName('Posting Schedule');
  assert(sheet && sheet.mimeType === 'application/vnd.google-apps.spreadsheet', JSON.stringify(sheet));
  assert(sheet.parents[0] === byName('2026-10 Launch').id);
});

await t('dotfiles never upload', async () => {
  assert(!byName('.DS_Store'));
});

await t('a second run uploads nothing', async () => {
  const before = store.size;
  const r = await run();
  assert(r.code === 0, r.out);
  assert(store.size === before, `store grew to ${store.size}`);
  assert(/0 to upload/.test(r.summary), r.summary);
});

await t('a changed file is updated in place, keeping its Drive id', async () => {
  const id = byName('01 Hook.png').id;
  put('social/2026-10 Launch/Feed (1080x1350)/01 Hook.png', Buffer.concat([PNG, Buffer.from([9, 9])]));
  const r = await run();
  assert(r.code === 0, r.out);
  const img = store.get(id);
  assert(img.updated === 1 && img.size === PNG.length + 2, JSON.stringify(img));
  assert(files().length === 2, 'no duplicate created');
});

await t('a folder trashed in Drive is recreated on the next new file', async () => {
  byName('Feed (1080x1350)').trashed = true;
  put('social/2026-10 Launch/Feed (1080x1350)/02 Next.png', PNG);
  const r = await run();
  assert(r.code === 0, r.out);
  const next = byName('02 Next.png');
  const live = [...store.values()].filter((f) => f.name === 'Feed (1080x1350)' && !f.trashed);
  assert(live.length === 1 && next.parents[0] === live[0].id, JSON.stringify({ next, live }));
});

fake.close();
fs.rmSync(repo, { recursive: true, force: true });
const failed = results.filter((r) => r[0] === 'FAIL');
for (const r of failed) console.log('   ', r[1], '=>', r[2]);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
