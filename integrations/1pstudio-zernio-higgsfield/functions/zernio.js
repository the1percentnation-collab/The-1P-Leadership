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
