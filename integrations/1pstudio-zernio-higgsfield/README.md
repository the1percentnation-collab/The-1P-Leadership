# 1P Studio — Zernio + Higgsfield integration package

Drop-in backend for the **1PStudio** repo (`the1percentnation-collab/1PStudio`, the
`onepstudio-9a3ef` Firebase project). It replaces Ayrshare with **Zernio**
(fixes the "Videos require a Premium or Business Plan" error) and adds two ways to
bring **Higgsfield** AI videos into the library for mass posting.

These files live here temporarily because the 1PStudio repo could not be attached to
the session that produced them. Copy `functions/*.js` into 1PStudio's `functions/`
directory — they are self-contained (no new npm dependencies; Node 20 `fetch`).

## What's in here

| File | Purpose |
|---|---|
| `functions/zernio.js` | Zernio REST client: list accounts, create/schedule posts, retry, logs, media upload, platform chip mapping with per-platform requirements (YouTube title, TikTok consent fields, etc.) |
| `functions/higgsfield.js` | Higgsfield Cloud API client: submit generation jobs (image-to-video DoP, Speak, any catalog model), webhook + status polling, result URL extraction |
| `functions/social.js` | Cloud Functions: `getSocialAccounts`, `publishPost`, `getPostStatus`, `generateHiggsfieldVideo`, `higgsfieldWebhook`, `pollHiggsfieldJobs`, `importMedia` |

## Setup (one time)

1. **Zernio account** — zernio.com → connect your social accounts (first 2 free,
   ~$6/account/mo after; X posts add ~1¢ passthrough) → Dashboard → create API key.
2. **Higgsfield API key** — cloud.higgsfield.ai → API keys (requires a paid
   Higgsfield plan; generation consumes credits). Format used here: `KEY_ID:KEY_SECRET`.
3. **Secrets** (in the 1PStudio repo):
   ```bash
   firebase functions:secrets:set ZERNIO_API_KEY         --project onepstudio-9a3ef
   firebase functions:secrets:set HIGGSFIELD_CREDENTIALS --project onepstudio-9a3ef
   ```
4. **Wire in**: copy the three js files into `functions/`, then in `functions/index.js`:
   ```js
   Object.assign(module.exports, require('./social'));
   ```
5. Remove the old Ayrshare key/config and the hardcoded
   "Videos require a Premium or Business Plan" error handling.
6. Deploy: `npx firebase-tools deploy --only functions --project onepstudio-9a3ef`

## Front-end changes (Composer / Library)

- **On Composer load** call `getSocialAccounts`; disable chips for platforms with no
  connected Zernio account ("Connect in Zernio" hint).
- **Post Now / Schedule for later** → call `publishPost` with:
  ```js
  { caption, youtubeTitle, platforms: ['TikTok','Instagram Reels','YouTube Shorts','Facebook','X','LinkedIn'],
    mediaUrl, mediaType: 'video', scheduledFor: isoStringOrNull, timezone: 'America/New_York',
    videoMadeWithAi: true, libraryId }
  ```
  One call mass-posts to every selected platform. Show per-platform results; a failed
  platform can be retried via Zernio's retry endpoint (`zernio.retryPost`).
- **Library page**: add "Generate with Higgsfield" (calls `generateHiggsfieldVideo`
  with a prompt and optional source image) and "Import from URL" (calls `importMedia`
  with a Higgsfield download link). Both create `library` docs; items flip from
  `generating` → `ready` (webhook, with a 5-minute poller as fallback) and then feed
  the Composer with `mediaUrl`.

## Flow

```
Higgsfield (generate or import) ──► Firebase Storage + library doc (status: ready)
        Composer: pick video ──► AI caption/title ──► select platform chips
        publishPost ──► Zernio /v1/posts (one call, all platforms, or scheduledFor)
        posts doc stores zernioPostId ──► getPostStatus refreshes per-platform state
```

## Verification checklist

1. Connect Instagram + TikTok in Zernio (free tier) and set the secrets.
2. Deploy; in Composer post a short test video to one platform → confirm it goes live
   and the Ayrshare error is gone.
3. Schedule a post 5 minutes out → confirm Zernio delivers it.
4. Generate one Higgsfield clip (uses credits) → confirm the library item turns
   `ready` and can be mass-posted.
5. Import one Higgsfield web-app download by URL → same check.

## API references used (verified July 2026)

- Zernio: base `https://zernio.com/api/v1`, Bearer auth; `POST /posts`
  (`content`, `platforms[{platform,accountId,platformSpecificData}]`,
  `mediaItems[{type,url}]`, `scheduledFor`/`publishNow`, `timezone`),
  `GET /accounts`, `POST /media/presign` → `{uploadUrl, fileUrl}` (5 GB max video).
  Platform specifics: YouTube `title`/`visibility`/`containsSyntheticMedia`;
  TikTok `privacyLevel`, `allowComment/Duet/Stitch`, `contentPreviewConfirmed`,
  `expressConsentGiven`, `videoMadeWithAi`; Facebook `pageId`; X `threadItems`.
- Higgsfield: base `https://platform.higgsfield.ai`, `Authorization: Key ID:SECRET`;
  submit `POST /<model-path>?hf_webhook=<url>` (e.g. `/v1/image2video/dop`),
  status `GET /requests/{id}/status` (`queued|in_progress|completed|failed|nsfw|canceled`).
