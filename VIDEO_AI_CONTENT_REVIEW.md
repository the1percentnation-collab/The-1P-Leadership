# 1P Studio — Video → AI Content Feature: Code Review & Integration Spec

> Handoff doc. Context + review of a draft client-side module that extracts video frames
> and asks Claude to generate TikTok content. Goal: wire it correctly into the existing
> 1P Studio (The-1P-Leadership) Firebase stack.

---

## 1. Context: the stack this must fit into

**1P Studio = The-1P-Leadership**, a Firebase web app:

- **Frontend:** static HTML + ES modules in `public/` (no framework, no bundler).
- **Backend:** Firebase Cloud Functions v2 in `functions/index.js` (~4,200 lines).
- **Frontend → backend contract:** **everything** uses Firebase `httpsCallable` (onCall).
  There is **no** Express / `/api/*` REST layer anywhere in the app.
- **AI:** `@anthropic-ai/sdk` already wired in. Model in use: `claude-opus-4-8`.
- **Other infra:** Firestore, Firebase Storage, Stripe, SendGrid (email), Twilio (SMS).

**Critical reuse point — the backend you need already exists.**
`exports.reportBug` in `functions/index.js` (~line 3852–3910) already:
1. Accepts a base64 data URL (`screenshotDataUrl`),
2. Strips the `data:image/...;base64,` prefix,
3. Sends it to `claude-opus-4-8` as an `image` content block via `client.messages.create`,
4. (Optionally) saves the image to Storage.

`analyzeVideo` is that same pattern with **3 frames instead of 1 screenshot**. Copy it.

---

## 2. The draft code under review

Client-side module (proposed):

- `extractFrameAt(video, pct)` — seeks a `<video>` to `duration * pct`, waits for the
  `seeked` event, draws the frame to a canvas, returns base64 JPEG (quality 0.75).
- `extractFramesFromVideo(videoFile)` — loads the file via `URL.createObjectURL`, pulls
  3 frames at 4% / 45% / 85%, returns `{ hookFrame, midFrame, endFrame }`.
- `generateTikTokContent(videoFile, onProgress, transcript)` — extracts frames, then
  `fetch('/api/analyze')` with `{ frames, transcript, filename }`, returns parsed JSON.

Design intent is sound: extract 3 frames **client-side** and send only those (not the whole
video) to the backend — cheap and fast. The problems are in the details below.

---

## 3. Issues, most important first

### 🔴 P1 — Backend call does not fit the stack
`fetch('/api/analyze')` targets a REST endpoint that **does not exist** in this app.

- **Fix:** replace `fetch` with `httpsCallable(functions, 'analyzeVideo')`.
- **Why it matters beyond "it won't work":** onCall enforces Firebase Auth (+ App Check)
  automatically. A public `/api/analyze` that calls Claude is an **open cost-abuse endpoint** —
  anyone who finds the URL can run up the Anthropic bill. onCall closes that hole for free.

### 🔴 P2 — The promise can hang forever
`extractFrameAt` resolves **only** on the `seeked` event. If `seeked` never fires, nothing
throws, the `try/catch` cannot catch it, and the UI is stuck on "Extracting frames..."
permanently. Two real triggers:

- **Non-finite duration:** some `.webm`/streamed files report `duration` as `Infinity` / `NaN`,
  so `duration * pct` is `NaN`, the seek is a no-op, and `seeked` never fires.
- **Codec/decoder edge cases** where the browser silently fails to seek.

**Fix:** guard against non-finite duration and race every seek against a timeout.

```js
function extractFrameAt(video, pct) {
  return new Promise((resolve) => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return resolve(null);
    const targetTime = Math.min(video.duration * pct, video.duration - 0.05);

    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      video.removeEventListener('seeked', onSeeked);
      resolve(val);
    };

    const onSeeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = video.videoWidth  || 640;
        canvas.height = video.videoHeight || 360;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
      } catch {
        finish(null);
      }
    };

    video.addEventListener('seeked', onSeeked);
    setTimeout(() => finish(null), 3000); // never hang
    video.currentTime = targetTime;
  });
}
```

### 🟠 P3 — iOS Safari returns black frames
Drawing a `<video>` to canvas **without ever calling `play()`** frequently yields black/empty
frames on iOS Safari. TikTok creators are overwhelmingly on phones, so this will hit real users.

**Mitigations:**
- Briefly `await video.play()` (muted) before seeking, then `pause()`; or
- Detect null/black frames and **fall back to transcript-only** analysis gracefully.

### 🟠 P4 — Silent low-quality fallback
If all frames come back `null` **and** `transcript === ''`, the code still calls the model with
just a filename → near-useless output. Require at least one of `{ ≥1 frame, transcript }`, or
warn the user that quality will be limited.

### 🟡 P5 — Minor
- **Payload size:** full-res frames (e.g. 1080×1920) at q0.75 → a few MB across 3 images.
  Cap the longest edge to ~768px before `drawImage` — Claude downscales vision inputs anyway,
  so this saves upload time + tokens with no quality loss.
- **No response-shape validation** on the returned JSON — validate before using.
- **Repeated-timestamp caveat:** `seeked` won't fire if you seek to a timestamp already set.
  Not a bug today (3 distinct pcts), but note it if the percentages become configurable.

---

## 4. Target architecture (how it should be wired)

```
[ browser ]
  video file → extractFramesFromVideo()  → { hookFrame, midFrame, endFrame }  (base64 JPEG)
             → httpsCallable('analyzeVideo')({ frames, transcript, filename })
                                   │
                                   ▼
[ Cloud Function: exports.analyzeVideo = onCall(...) ]   ← copy the reportBug vision pattern
   - auth check (request.auth)
   - build content blocks: image blocks for non-null frames + a text prompt
   - client.messages.create({ model: 'claude-opus-4-8', messages: [...] })
   - return structured JSON { hook, caption, hashtags, ... }
```

### Backend skeleton (`functions/index.js`)

```js
exports.analyzeVideo = onCall(
  { secrets: [anthropicKey], timeoutSeconds: 120 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { frames = {}, transcript = '', filename = '' } = request.data || {};
    const imgs = ['hookFrame', 'midFrame', 'endFrame']
      .map((k) => frames[k])
      .filter(Boolean)
      .map((b64) => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
      }));

    if (!imgs.length && !transcript.trim()) {
      throw new HttpsError('invalid-argument', 'Need at least frames or a transcript.');
    }

    const client = new Anthropic({ apiKey: anthropicKey.value() });
    const resp = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          ...imgs,
          { type: 'text', text:
            `These are frames (hook/mid/end) from a video "${filename}".\n` +
            (transcript ? `Transcript:\n${transcript}\n\n` : '') +
            `Return JSON: { "hook": "...", "caption": "...", "hashtags": ["..."] }` },
        ],
      }],
    });

    // TODO: parse resp.content[0].text as JSON, validate shape, return it.
    return { raw: resp.content?.[0]?.text || '' };
  }
);
```

### Frontend change
Replace the `fetch('/api/analyze')` block in `generateTikTokContent` with:

```js
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
// ...
onProgress('Analyzing with Claude...');
const call = httpsCallable(functions, 'analyzeVideo');
const { data } = await call({ frames, transcript, filename: videoFile.name });
onProgress('Parsing response...');
return data;
```

---

## 5. Checklist to ship

- [ ] Add `extractFrameAt` timeout + non-finite-duration guard (P2).
- [ ] Add iOS play()/black-frame fallback (P3).
- [ ] Require frames-or-transcript; warn on degraded input (P4).
- [ ] Downscale frames to ~768px longest edge (P5).
- [ ] Create `exports.analyzeVideo` onCall fn, reusing the `reportBug` vision pattern.
- [ ] Register the Anthropic API key as a secret for `analyzeVideo`.
- [ ] Swap frontend `fetch` → `httpsCallable('analyzeVideo')`.
- [ ] Parse + validate model JSON before returning.
- [ ] Deploy: `firebase deploy --only functions:analyzeVideo`.

---

## 6. Where this fits the bigger picture
This is the **AI content-creation half** of the Blotato-style feature set (generate captions/
posts from a video). It does **not** cover the **publishing half** (auto-posting to TikTok/IG/
X/etc.), which is the gated, expensive part — recommended path there is to **wrap a publishing
API** (Ayrshare / Blotato API / upload-post) or **self-host Postiz**, rather than build native
platform integrations. See the separate Blotato research report for that side.
