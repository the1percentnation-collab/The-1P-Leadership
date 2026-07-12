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
