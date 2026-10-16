// Drive sync runner: uploads everything under social/ to the owner's Google
// Drive. Run by .github/workflows/drive-sync.yml on every push to main that
// touches social/, and on demand from the Actions tab.
//
// How it reaches Drive: the owner's Google connection in CRM Settings (the
// same one Google Calendar uses) stores a refresh token under
// companies/{cid}/private/googleOAuth. Once that connection includes the
// drive.file permission, this script mints an access token from it and
// uploads as the owner, into folders it creates. drive.file only reaches
// files this app created, nothing else in the owner's Drive.
//
// What it remembers: driveSyncFiles/{key} (path, md5, Drive file id) and
// driveSyncFolders/{key} (folder path, Drive folder id), server-only. A file
// is updated in place when its bytes change, so its Drive link never moves.
// Files deleted from the repo are left in Drive on purpose.
//
// Env: GOOGLE_APPLICATION_CREDENTIALS (Firebase service account),
// GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, optional
// DRIVE_SYNC_COMPANY_ID, optional DRIVE_SYNC_DRY_RUN=1.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  ROOT_DIR, DRIVE_ROOT_NAME, FOLDER_MIME, driveTarget, planSync, keyFor, hasDriveScope, isIgnored
} from './drive-sync-core.mjs';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
// Where social/ is read from. Tests point this at a scratch copy.
const ROOT = process.env.DRIVE_SYNC_REPO_ROOT ? path.resolve(process.env.DRIVE_SYNC_REPO_ROOT) : REPO;
const admin = require(path.join(REPO, 'functions', 'node_modules', 'firebase-admin'));
const DRY = process.env.DRIVE_SYNC_DRY_RUN === '1';
// The bases are overridable only so tests/drive-sync-e2e can point them at a fake Drive.
const GOOGLE = (process.env.DRIVE_SYNC_API_BASE || 'https://www.googleapis.com').replace(/\/$/, '');
const API = `${GOOGLE}/drive/v3`;
const UPLOAD = `${GOOGLE}/upload/drive/v3`;
const TOKEN_URL = process.env.DRIVE_SYNC_TOKEN_URL || 'https://oauth2.googleapis.com/token';

const summary = [];
const note = (line) => { console.log(line); summary.push(line); };
function writeSummary() {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
}

function listLocal() {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      if (isIgnored(rel)) continue;
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push({ path: rel, md5: crypto.createHash('md5').update(fs.readFileSync(abs)).digest('hex') });
    }
  };
  walk(path.join(ROOT, ROOT_DIR));
  return out;
}

/** The company whose Google connection allows Drive uploads. */
async function findConnection(db) {
  const wanted = (process.env.DRIVE_SYNC_COMPANY_ID || '').trim();
  const ids = wanted ? [wanted] : (await db.collection('companies').listDocuments()).map((d) => d.id);
  let connectedWithoutDrive = null;
  for (const cid of ids) {
    const snap = await db.collection('companies').doc(cid).collection('private').doc('googleOAuth').get();
    const d = snap.exists ? snap.data() : null;
    if (!d || !d.refreshToken) continue;
    if (hasDriveScope(d.scopes)) return { companyId: cid, refreshToken: d.refreshToken, email: d.googleEmail || null };
    connectedWithoutDrive = connectedWithoutDrive || { companyId: cid, email: d.googleEmail || null };
  }
  return { missing: true, connectedWithoutDrive };
}

async function accessToken(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString()
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google refused the stored connection (${j.error || res.status}). Reconnect Google in CRM Settings.`);
  return j.access_token;
}

let TOKEN = null;
async function drive(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  if (!res.ok) {
    const msg = (body && body.error && body.error.message) || text || String(res.status);
    const err = new Error(`Drive ${res.status}: ${msg}`);
    err.status = res.status;
    err.reason = body && body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason;
    throw err;
  }
  return body;
}

async function aliveFolder(id) {
  if (!id) return false;
  try {
    const f = await drive(`${API}/files/${encodeURIComponent(id)}?fields=id,trashed,mimeType`);
    return f && !f.trashed && f.mimeType === FOLDER_MIME;
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

function multipart(meta, mime, bytes) {
  const boundary = 'onepercent' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  return { body: Buffer.concat([head, bytes, tail]), type: `multipart/related; boundary=${boundary}` };
}

async function main() {
  const local = listLocal();
  if (!local.length) { note(`Nothing under ${ROOT_DIR}/ to sync.`); writeSummary(); return; }

  admin.initializeApp(process.env.GOOGLE_APPLICATION_CREDENTIALS
    ? { credential: admin.credential.applicationDefault(), projectId: 'the-1p-leadership' }
    : { projectId: process.env.GCLOUD_PROJECT || 'the-1p-leadership' });
  const db = admin.firestore();

  const conn = await findConnection(db);
  if (conn.missing) {
    note('## Drive sync is waiting on one click');
    note(conn.connectedWithoutDrive
      ? `Google is connected (${conn.connectedWithoutDrive.email || 'owner account'}) without Drive permission. Open CRM Settings → Google, click **Reconnect Google**, and approve. Then re-run this workflow.`
      : 'No Google connection found. Open CRM Settings → Google, click **Connect Google**, and approve. Then re-run this workflow.');
    note(`${local.length} file(s) are ready and will upload on the next run.`);
    writeSummary();
    return;
  }
  TOKEN = await accessToken(conn.refreshToken);

  const files = db.collection('driveSyncFiles');
  const folders = db.collection('driveSyncFolders');
  const manifest = {};
  (await files.get()).forEach((d) => { const v = d.data(); if (v && v.path) manifest[v.path] = v; });
  const plan = planSync(local, manifest);
  const todo = plan.filter((p) => p.action !== 'skip');
  note(`## Drive sync → ${conn.email || 'owner'}`);
  note(`${todo.length} to upload, ${plan.length - todo.length} already current.`);
  if (DRY) { todo.forEach((p) => note(`- would ${p.action}: ${p.path}`)); writeSummary(); return; }

  const folderCache = new Map();
  async function ensureFolder(names) {
    const key = names.join('/');
    if (folderCache.has(key)) return folderCache.get(key);
    const parentId = names.length > 1 ? await ensureFolder(names.slice(0, -1)) : null;
    const ref = folders.doc(keyFor(key));
    const known = (await ref.get()).data();
    let id = known && known.folderId;
    if (!(await aliveFolder(id))) {
      const meta = { name: names[names.length - 1], mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) };
      const created = await drive(`${API}/files?fields=id,webViewLink`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta)
      });
      id = created.id;
      await ref.set({ path: key, folderId: id, link: created.webViewLink || null, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    folderCache.set(key, id);
    return id;
  }

  await ensureFolder([DRIVE_ROOT_NAME]);
  let failed = 0;
  for (const p of todo) {
    const t = driveTarget(p.path);
    const bytes = fs.readFileSync(path.join(ROOT, p.path));
    const md5 = local.find((f) => f.path === p.path).md5;
    try {
      const parent = await ensureFolder([DRIVE_ROOT_NAME, ...t.folders]);
      let out = null;
      if (p.action === 'update') {
        try {
          out = await drive(`${UPLOAD}/files/${encodeURIComponent(p.fileId)}?uploadType=media&fields=id,webViewLink`, {
            method: 'PATCH', headers: { 'Content-Type': t.uploadMime }, body: bytes
          });
        } catch (e) {
          if (e.status !== 404) throw e;
        }
      }
      if (!out) {
        const mp = multipart({ name: t.name, parents: [parent], ...(t.googleMime ? { mimeType: t.googleMime } : {}) }, t.uploadMime, bytes);
        out = await drive(`${UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, {
          method: 'POST', headers: { 'Content-Type': mp.type }, body: mp.body
        });
      }
      await files.doc(keyFor(p.path)).set({
        path: p.path, md5, fileId: out.id, link: out.webViewLink || null, syncedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      note(`- ${p.action === 'update' ? 'updated' : 'uploaded'}: [${t.folders.concat(t.name).join(' / ')}](${out.webViewLink || ''})`);
    } catch (e) {
      failed++;
      note(`- FAILED: ${p.path}: ${e.message}`);
      if (e.reason === 'accessNotConfigured' || /has not been used in project|is disabled/i.test(e.message)) {
        note('The Google Drive API is turned off for this Google Cloud project. Open the link in the error above, click Enable, then re-run this workflow.');
        break;
      }
    }
  }
  const rootLink = (await folders.doc(keyFor(DRIVE_ROOT_NAME)).get()).data();
  if (rootLink && rootLink.link) note(`\nDrive folder: ${rootLink.link}`);
  writeSummary();
  if (failed) process.exit(1);
}

main().catch((e) => { note(`Drive sync failed: ${e.message}`); writeSummary(); process.exit(1); });
