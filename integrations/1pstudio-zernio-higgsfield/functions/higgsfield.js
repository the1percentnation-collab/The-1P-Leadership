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
