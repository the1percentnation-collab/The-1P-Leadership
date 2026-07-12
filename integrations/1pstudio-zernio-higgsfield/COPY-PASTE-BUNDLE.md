# 1P Studio — Zernio + Higgsfield Integration (copy-paste bundle)

Everything needed to add Zernio posting (fixes the "Videos require a Premium or
Business Plan" Ayrshare error) and Higgsfield AI-video intake to the **1PStudio**
repo (`the1percentnation-collab/1PStudio`, Firebase project `onepstudio-9a3ef`).

This one file contains THREE JavaScript files. Create each file in the 1PStudio
repo's `functions/` folder at the exact path shown above its code block, and copy
the code between the fences exactly as-is.

---

## Setup steps (do these once)

1. **Zernio account** — sign up at zernio.com, connect your social accounts
   (first 2 are free, ~$6/account/mo after; X posts add ~1¢ each), then create an
   API key in the dashboard.
2. **Higgsfield API key** — at cloud.higgsfield.ai create an API key (needs a paid
   Higgsfield plan; video generation uses credits). You get a KEY_ID and KEY_SECRET.
3. **Set the secrets** (run inside the 1PStudio repo):
   ```bash
   firebase functions:secrets:set ZERNIO_API_KEY --project onepstudio-9a3ef
   # paste your Zernio API key when prompted

   firebase functions:secrets:set HIGGSFIELD_CREDENTIALS --project onepstudio-9a3ef
   # paste KEY_ID:KEY_SECRET (one string, colon in the middle) when prompted
   ```
4. **Create the three files below** in `functions/`.
5. **Wire them in** — add this line near the bottom of `functions/index.js`:
   ```js
   Object.assign(module.exports, require('./social'));
   ```
6. **Remove the old Ayrshare code**: the Ayrshare API key/config and the
   "Videos require a Premium or Business Plan" error handling.
7. **Deploy**:
   ```bash
   npx firebase-tools deploy --only functions --project onepstudio-9a3ef
   ```

---

## FILE 1 of 3 — create as `functions/zernio.js`

```js
// Zernio (formerly Late / getlate.dev) REST client for Cloud Functions (Node 20+, global fetch).
// Base URL and endpoints per docs.zernio.com. Auth: Bearer API key from the Zernio dashboard.
//
// Replaces Ayrshare: one createPost() call fans out to every selected platform,
// and video is supported on all plans (first 2 connected accounts are free).

const BASE = 'https://zernio.com/api/v1';

async function zfetch(apiKey, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json.message || json.error || res.statusText;
    const err = new Error(`Zernio ${res.status}: ${msg}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// ---- Accounts -------------------------------------------------------------

// Returns the connected social accounts: [{ _id/accountId, platform, username, ... }]
async function listAccounts(apiKey, profileId) {
  const qs = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
  const data = await zfetch(apiKey, `/accounts${qs}`);
  return data.accounts || data.data || data;
}

// Token-health check — surfaces accounts that need reconnecting in the Zernio dashboard.
async function accountsHealth(apiKey) {
  return zfetch(apiKey, '/accounts/health');
}

// ---- Posts ----------------------------------------------------------------

// Create (and optionally schedule) a post across many platforms in one call.
//   content       - caption text
//   platforms     - [{ platform, accountId, platformSpecificData? }]
//   mediaItems    - [{ type: 'video'|'image', url, filename? }]
//   scheduledFor  - ISO 8601 timestamp (omit with publishNow: true for immediate)
//   timezone      - IANA tz for scheduledFor (e.g. 'America/New_York')
async function createPost(apiKey, { content, platforms, mediaItems, scheduledFor, timezone, publishNow }) {
  const body = { content, platforms };
  if (mediaItems && mediaItems.length) body.mediaItems = mediaItems;
  if (scheduledFor) {
    body.scheduledFor = scheduledFor;
    if (timezone) body.timezone = timezone;
  } else {
    body.publishNow = publishNow !== false;
  }
  return zfetch(apiKey, '/posts', { method: 'POST', body });
}

async function getPost(apiKey, postId) {
  return zfetch(apiKey, `/posts/${postId}`);
}

async function retryPost(apiKey, postId) {
  return zfetch(apiKey, `/posts/${postId}/retry`, { method: 'POST' });
}

async function getPostLogs(apiKey, postId) {
  return zfetch(apiKey, `/posts/${postId}/logs`);
}

// ---- Media ----------------------------------------------------------------

// Presigned upload (files up to 5 GB). Returns a durable public fileUrl to use in mediaItems.
async function uploadMedia(apiKey, buffer, filename, contentType) {
  const { uploadUrl, fileUrl } = await zfetch(apiKey, '/media/presign', {
    method: 'POST',
    body: { filename, contentType },
  });
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: buffer,
  });
  if (!put.ok) throw new Error(`Zernio media upload failed: ${put.status} ${put.statusText}`);
  return fileUrl;
}

// ---- Platform mapping -----------------------------------------------------

// Maps the Composer's platform chips to Zernio platform names.
const CHIP_TO_PLATFORM = {
  tiktok: 'tiktok',
  'instagram reels': 'instagram',
  instagram: 'instagram',
  'youtube shorts': 'youtube',
  youtube: 'youtube',
  facebook: 'facebook',
  x: 'twitter',
  twitter: 'twitter',
  linkedin: 'linkedin',
};

// Build the platforms[] array for createPost from the Composer's selection.
//   selected  - array of chip names, e.g. ['TikTok', 'Instagram Reels', 'YouTube Shorts']
//   accounts  - result of listAccounts()
//   opts      - { youtubeTitle, videoMadeWithAi, tiktokPrivacy, facebookPageId }
// Throws if a selected platform has no connected Zernio account.
function buildPlatforms(selected, accounts, opts = {}) {
  const byPlatform = {};
  for (const a of accounts) byPlatform[a.platform] = a._id || a.accountId || a.id;

  return selected.map((chip) => {
    const platform = CHIP_TO_PLATFORM[String(chip).toLowerCase()];
    if (!platform) throw new Error(`Unknown platform chip: ${chip}`);
    const accountId = byPlatform[platform];
    if (!accountId) {
      const err = new Error(`No ${platform} account connected in Zernio. Connect it at zernio.com/dashboard.`);
      err.code = 'ACCOUNT_NOT_CONNECTED';
      err.platform = platform;
      throw err;
    }

    const entry = { platform, accountId };

    // Per-platform requirements (field names per docs.zernio.com).
    if (platform === 'youtube') {
      entry.platformSpecificData = {
        title: opts.youtubeTitle || opts.title || '',
        visibility: opts.youtubeVisibility || 'public',
        ...(opts.videoMadeWithAi ? { containsSyntheticMedia: true } : {}),
      };
    } else if (platform === 'tiktok') {
      entry.platformSpecificData = {
        privacyLevel: opts.tiktokPrivacy || 'PUBLIC_TO_EVERYONE',
        allowComment: true,
        allowDuet: true,
        allowStitch: true,
        contentPreviewConfirmed: true,
        expressConsentGiven: true,
        ...(opts.videoMadeWithAi ? { videoMadeWithAi: true } : {}),
      };
    } else if (platform === 'facebook' && opts.facebookPageId) {
      entry.platformSpecificData = { pageId: opts.facebookPageId };
    }
    // Instagram: video posts default to Reels — no platformSpecificData needed.

    return entry;
  });
}

module.exports = {
  listAccounts,
  accountsHealth,
  createPost,
  getPost,
  retryPost,
  getPostLogs,
  uploadMedia,
  buildPlatforms,
  CHIP_TO_PLATFORM,
};
```

---

## FILE 2 of 3 — create as `functions/higgsfield.js`

```js
// Higgsfield Cloud API client for Cloud Functions (Node 20+, global fetch).
// Base URL, auth, and endpoints per the official SDK (github.com/higgsfield-ai/higgsfield-client).
//
// Auth: create an API key at cloud.higgsfield.ai (requires a paid Higgsfield plan).
// Credentials are "KEY_ID:KEY_SECRET" sent as `Authorization: Key <credentials>`.
//
// Flow: submit(modelPath, input[, webhookUrl]) -> { request_id } -> Higgsfield calls the
// webhook (?hf_webhook=) when done, or getStatus() can be polled as a fallback.
// Status values: queued | in_progress | completed | failed | nsfw | canceled.

const BASE = 'https://platform.higgsfield.ai';

// Model application paths. Image-to-video (DoP) and Speak are confirmed from the
// official SDK docs; check cloud.higgsfield.ai for the full current catalog —
// any path from the catalog can be passed straight to submit().
const MODELS = {
  imageToVideo: '/v1/image2video/dop', // input: { model: 'dop-turbo', prompt, input_images: [{type:'image_url', image_url}], motions? }
  speak: '/v1/speak/higgsfield',       // talking avatar / speech video
};

async function hfetch(credentials, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Key ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Higgsfield ${res.status}: ${json.detail || json.message || res.statusText}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Submit a generation job. Returns the API response (contains the request id).
// webhookUrl (optional): Higgsfield POSTs the completed job to it — no polling needed.
async function submit(credentials, modelPath, input, webhookUrl) {
  let path = modelPath.startsWith('/') ? modelPath : `/${modelPath}`;
  if (webhookUrl) path += `?hf_webhook=${encodeURIComponent(webhookUrl)}`;
  return hfetch(credentials, path, { method: 'POST', body: input });
}

// Poll a job. Response includes status and, when completed, the output media.
async function getStatus(credentials, requestId) {
  return hfetch(credentials, `/requests/${requestId}/status`);
}

async function cancel(credentials, requestId) {
  return hfetch(credentials, `/requests/${requestId}/cancel`, { method: 'POST' });
}

// Get a presigned upload URL for input images (e.g. image-to-video source frames).
async function generateUploadUrl(credentials, contentType) {
  return hfetch(credentials, '/files/generate-upload-url', {
    method: 'POST',
    body: { content_type: contentType },
  });
}

// Pull the output media URLs out of a completed status/webhook payload.
// Handles the shapes the API uses: { video: {url} } | { videos: [{url}] } | { images: [{url}] } | jobs[].results.raw.url
function extractResultUrls(payload) {
  const urls = [];
  const push = (v) => {
    if (!v) return;
    if (typeof v === 'string') urls.push(v);
    else if (v.url) urls.push(v.url);
  };
  if (payload.video) push(payload.video);
  for (const key of ['videos', 'images', 'results']) {
    if (Array.isArray(payload[key])) payload[key].forEach(push);
  }
  if (Array.isArray(payload.jobs)) {
    for (const j of payload.jobs) {
      if (j.results) push(j.results.raw || j.results);
    }
  }
  return urls;
}

const TERMINAL_STATUSES = ['completed', 'failed', 'nsfw', 'canceled'];

module.exports = { submit, getStatus, cancel, generateUploadUrl, extractResultUrls, MODELS, TERMINAL_STATUSES };
```

---

## FILE 3 of 3 — create as `functions/social.js`

```js
// 1P Studio — social publishing + Higgsfield intake Cloud Functions (v2).
//
// Drop this file into the 1PStudio repo's functions/ directory alongside
// zernio.js and higgsfield.js, then re-export from functions/index.js:
//
//   Object.assign(module.exports, require('./social'));
//
// Secrets (set once in the onepstudio Firebase project):
//   firebase functions:secrets:set ZERNIO_API_KEY          --project onepstudio-9a3ef
//   firebase functions:secrets:set HIGGSFIELD_CREDENTIALS  --project onepstudio-9a3ef   # "KEY_ID:KEY_SECRET"
//
// Firestore collections used:
//   library/{docId}   - media library items (source: 'higgsfield' | 'upload' | 'import')
//   posts/{docId}     - published/scheduled posts with Zernio status
//   config/socialAccounts - cached Zernio account list

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

const zernio = require('./zernio');
const higgsfield = require('./higgsfield');

const ZERNIO_API_KEY = defineSecret('ZERNIO_API_KEY');
const HIGGSFIELD_CREDENTIALS = defineSecret('HIGGSFIELD_CREDENTIALS');

const db = () => admin.firestore();
const bucket = () => admin.storage().bucket();

function requireAuth(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  return request.auth.uid;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

// Composer calls this on load to map platform chips -> connected Zernio accounts.
exports.getSocialAccounts = onCall({ secrets: [ZERNIO_API_KEY] }, async (request) => {
  requireAuth(request);
  const accounts = await zernio.listAccounts(ZERNIO_API_KEY.value());
  const summary = accounts.map((a) => ({
    accountId: a._id || a.accountId || a.id,
    platform: a.platform,
    username: a.username || '',
  }));
  await db().doc('config/socialAccounts').set({
    accounts: summary,
    refreshedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { accounts: summary };
});

// ---------------------------------------------------------------------------
// Publishing (replaces the Ayrshare call)
// ---------------------------------------------------------------------------

// data: { caption, youtubeTitle, platforms: ['TikTok','Instagram Reels',...],
//         mediaUrl, mediaType: 'video'|'image', scheduledFor?, timezone?,
//         videoMadeWithAi?, libraryId? }
exports.publishPost = onCall(
  { secrets: [ZERNIO_API_KEY], timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    const uid = requireAuth(request);
    const d = request.data || {};
    if (!d.mediaUrl) throw new HttpsError('invalid-argument', 'mediaUrl is required.');
    if (!Array.isArray(d.platforms) || !d.platforms.length) {
      throw new HttpsError('invalid-argument', 'Select at least one platform.');
    }

    const apiKey = ZERNIO_API_KEY.value();
    const accounts = await zernio.listAccounts(apiKey);

    let platforms;
    try {
      platforms = zernio.buildPlatforms(d.platforms, accounts, {
        youtubeTitle: d.youtubeTitle,
        videoMadeWithAi: !!d.videoMadeWithAi,
      });
    } catch (e) {
      if (e.code === 'ACCOUNT_NOT_CONNECTED') throw new HttpsError('failed-precondition', e.message);
      throw new HttpsError('invalid-argument', e.message);
    }

    // Re-host the media on Zernio so the post URL is durable and public even if
    // the source (Firebase Storage token URL, Higgsfield temp URL) later expires.
    let mediaUrl = d.mediaUrl;
    try {
      const src = await fetch(d.mediaUrl);
      if (src.ok) {
        const buf = Buffer.from(await src.arrayBuffer());
        const contentType = src.headers.get('content-type') || (d.mediaType === 'image' ? 'image/jpeg' : 'video/mp4');
        const ext = contentType.includes('image') ? 'jpg' : 'mp4';
        mediaUrl = await zernio.uploadMedia(apiKey, buf, `1pstudio-${Date.now()}.${ext}`, contentType);
      }
    } catch (e) {
      console.warn('Zernio media re-host failed, passing source URL through:', e.message);
    }

    const result = await zernio.createPost(apiKey, {
      content: d.caption || '',
      platforms,
      mediaItems: [{ type: d.mediaType === 'image' ? 'image' : 'video', url: mediaUrl }],
      scheduledFor: d.scheduledFor || undefined,
      timezone: d.timezone || undefined,
      publishNow: !d.scheduledFor,
    });

    const postDoc = await db().collection('posts').add({
      uid,
      caption: d.caption || '',
      youtubeTitle: d.youtubeTitle || '',
      platforms: d.platforms,
      mediaUrl,
      libraryId: d.libraryId || null,
      zernioPostId: result._id || result.id || result.postId || null,
      status: d.scheduledFor ? 'scheduled' : 'publishing',
      scheduledFor: d.scheduledFor || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, postId: postDoc.id, zernio: result };
  }
);

// Refresh a post's per-platform status from Zernio (Composer "refresh" button).
exports.getPostStatus = onCall({ secrets: [ZERNIO_API_KEY] }, async (request) => {
  requireAuth(request);
  const { postId } = request.data || {};
  const snap = await db().doc(`posts/${postId}`).get();
  if (!snap.exists || !snap.get('zernioPostId')) throw new HttpsError('not-found', 'Post not found.');
  const post = await zernio.getPost(ZERNIO_API_KEY.value(), snap.get('zernioPostId'));
  const status = post.status || 'unknown';
  await snap.ref.update({ status, zernioDetail: post });
  return { status, post };
});

// ---------------------------------------------------------------------------
// Higgsfield intake
// ---------------------------------------------------------------------------

// Path 1: generate from inside 1P Studio.
// data: { prompt, imageUrl?, model? } — imageUrl switches to image-to-video (DoP).
exports.generateHiggsfieldVideo = onCall(
  { secrets: [HIGGSFIELD_CREDENTIALS], timeoutSeconds: 120 },
  async (request) => {
    const uid = requireAuth(request);
    const d = request.data || {};
    if (!d.prompt && !d.imageUrl) throw new HttpsError('invalid-argument', 'A prompt or image is required.');

    const creds = HIGGSFIELD_CREDENTIALS.value();
    const modelPath = d.model || higgsfield.MODELS.imageToVideo;
    const input = d.imageUrl
      ? {
          model: 'dop-turbo',
          prompt: d.prompt || '',
          input_images: [{ type: 'image_url', image_url: d.imageUrl }],
        }
      : { prompt: d.prompt, aspect_ratio: '9:16' };

    // Webhook receiver deployed below; PROJECT_ID is set automatically at runtime.
    const projectId = process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
    const webhookUrl = `https://us-central1-${projectId}.cloudfunctions.net/higgsfieldWebhook`;

    const job = await higgsfield.submit(creds, modelPath, input, webhookUrl);
    const requestId = job.request_id || job.id;

    const doc = await db().collection('library').add({
      uid,
      source: 'higgsfield',
      status: 'generating',
      prompt: d.prompt || '',
      model: modelPath,
      higgsfieldRequestId: requestId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { ok: true, libraryId: doc.id, requestId };
  }
);

// Shared: finalize a completed Higgsfield job — download the video into
// Firebase Storage and mark the library item ready for the Composer.
async function finalizeHiggsfieldJob(docRef, payload, creds) {
  const status = payload.status || 'completed';
  if (status !== 'completed') {
    await docRef.update({ status: status === 'in_progress' || status === 'queued' ? 'generating' : 'failed', higgsfieldStatus: status });
    return;
  }
  const urls = higgsfield.extractResultUrls(payload);
  if (!urls.length) {
    await docRef.update({ status: 'failed', error: 'Completed but no output URL in payload.' });
    return;
  }
  const res = await fetch(urls[0]);
  if (!res.ok) throw new Error(`Result download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'video/mp4';
  const ext = contentType.includes('image') ? 'jpg' : 'mp4';
  const path = `library/higgsfield/${docRef.id}.${ext}`;
  const token = crypto.randomUUID();
  await bucket().file(path).save(buf, {
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
  });
  const publicUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  await docRef.update({
    status: 'ready',
    mediaUrl: publicUrl,
    storagePath: path,
    mediaType: contentType.includes('image') ? 'image' : 'video',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// Webhook receiver: Higgsfield POSTs the completed job here (?hf_webhook=).
exports.higgsfieldWebhook = onRequest({ secrets: [HIGGSFIELD_CREDENTIALS] }, async (req, res) => {
  try {
    const payload = req.body || {};
    const requestId = payload.request_id || payload.id || req.query.request_id;
    if (!requestId) return res.status(400).send('missing request id');

    const snap = await db().collection('library')
      .where('higgsfieldRequestId', '==', requestId).limit(1).get();
    if (snap.empty) return res.status(200).send('no matching job'); // ack anyway

    // Never trust the payload alone — confirm status server-to-server.
    const confirmed = await higgsfield.getStatus(HIGGSFIELD_CREDENTIALS.value(), requestId);
    await finalizeHiggsfieldJob(snap.docs[0].ref, confirmed, HIGGSFIELD_CREDENTIALS.value());
    return res.status(200).send('ok');
  } catch (e) {
    console.error('higgsfieldWebhook error:', e);
    return res.status(500).send('error');
  }
});

// Fallback poller: catches jobs whose webhook never arrived. Runs every 5 minutes.
exports.pollHiggsfieldJobs = onSchedule(
  { schedule: 'every 5 minutes', secrets: [HIGGSFIELD_CREDENTIALS] },
  async () => {
    const snap = await db().collection('library')
      .where('status', '==', 'generating').limit(20).get();
    const creds = HIGGSFIELD_CREDENTIALS.value();
    for (const doc of snap.docs) {
      try {
        const status = await higgsfield.getStatus(creds, doc.get('higgsfieldRequestId'));
        await finalizeHiggsfieldJob(doc.ref, status, creds);
      } catch (e) {
        console.error(`poll ${doc.id}:`, e.message);
      }
    }
  }
);

// Path 2: import a video created in the Higgsfield web app (or anywhere) by URL.
// data: { url, title? }
exports.importMedia = onCall({ timeoutSeconds: 300, memory: '1GiB' }, async (request) => {
  const uid = requireAuth(request);
  const { url, title } = request.data || {};
  if (!url || !/^https:\/\//.test(url)) throw new HttpsError('invalid-argument', 'A valid https URL is required.');

  const res = await fetch(url);
  if (!res.ok) throw new HttpsError('not-found', `Could not fetch media (${res.status}). Use the file's direct download URL.`);
  const contentType = res.headers.get('content-type') || 'video/mp4';
  if (!/video|image|octet-stream/.test(contentType)) {
    throw new HttpsError('invalid-argument', `URL is not a video or image (got ${contentType}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 500 * 1024 * 1024) throw new HttpsError('resource-exhausted', 'File exceeds 500 MB.');

  const doc = db().collection('library').doc();
  const ext = contentType.includes('image') ? 'jpg' : 'mp4';
  const path = `library/import/${doc.id}.${ext}`;
  const token = crypto.randomUUID();
  await bucket().file(path).save(buf, {
    metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
  });
  const publicUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket().name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;

  await doc.set({
    uid,
    source: 'import',
    status: 'ready',
    title: title || '',
    mediaUrl: publicUrl,
    storagePath: path,
    mediaType: contentType.includes('image') ? 'image' : 'video',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { ok: true, libraryId: doc.id, mediaUrl: publicUrl };
});
```

---

## Front-end wiring (Composer / Library pages)

- **Composer load**: call the `getSocialAccounts` callable; disable platform chips
  that have no connected Zernio account (show "Connect in Zernio" hint).
- **Post Now / Schedule for later**: call `publishPost` with:
  ```js
  {
    caption: "...",                       // the caption box
    youtubeTitle: "...",                  // the Title (YouTube) box
    platforms: ["TikTok", "Instagram Reels", "YouTube Shorts", "Facebook", "X", "LinkedIn"],
    mediaUrl: "https://...",              // the video's URL
    mediaType: "video",
    scheduledFor: null,                   // or ISO datetime for "Schedule for later"
    timezone: "America/New_York",
    videoMadeWithAi: true,                // AI-content disclosure for TikTok/YouTube
    libraryId: "..."                      // optional library doc id
  }
  ```
  One call mass-posts to every selected platform.
- **Library page**: add two buttons —
  - "Generate with Higgsfield" → `generateHiggsfieldVideo({ prompt, imageUrl? })`;
    the item appears as `generating` and flips to `ready` automatically.
  - "Import from URL" → `importMedia({ url })` with a Higgsfield download link.
- **Post status**: call `getPostStatus({ postId })` to refresh; failed platforms can
  be retried via Zernio.

## Verify it works

1. Connect Instagram + TikTok in Zernio (free) and set both secrets.
2. Deploy, then post a short test video to one platform — it should go live with no
   Ayrshare error.
3. Schedule a post 5 minutes out — Zernio delivers it.
4. Generate one Higgsfield clip — library item turns `ready`, then mass-post it.
