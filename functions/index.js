// Cloud Functions v2 — callable endpoints + Firestore triggers + HTTP webhook.
// Includes email: transactional sends (invite, welcome, course access), 1-on-1
// contact emails, campaign broadcast, and delivery-event tracking. Outbound
// goes through one provider seam (sendEmail/sendEmailBatch) with SendGrid and
// Telnyx behind it; inbound replies still arrive via SendGrid Inbound Parse.
//
// Deploy: `npx firebase-tools deploy --only functions --project the-1p-leadership`

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const _adminModule = require('firebase-admin');
// Under the Functions emulator (firebase-tools 14 stubs firebase-admin),
// `admin.firestore` comes back as a bound copy of the namespace function
// that has lost its statics, so `admin.firestore.FieldValue` is undefined
// and every write in this file fails. Production is untouched: the statics
// are present there and this is a pass-through. Restoring them from the
// modular entry point lets the emulator tests run the shipped code.
const _firestoreStatics = require('firebase-admin/firestore');
const admin = new Proxy(_adminModule, {
  get(target, key) {
    const v = target[key];
    if (key === 'firestore' && typeof v === 'function' && !v.FieldValue) {
      return Object.assign(v, {
        FieldValue: _firestoreStatics.FieldValue,
        FieldPath: _firestoreStatics.FieldPath,
        Timestamp: _firestoreStatics.Timestamp,
        GeoPoint: _firestoreStatics.GeoPoint,
        Filter: _firestoreStatics.Filter,
        AggregateField: _firestoreStatics.AggregateField
      });
    }
    return v;
  }
});
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

// The bootstrap owner's IDENTITY, not an inbox. This address decides who may
// claim the owner role (bootstrapOwner), who is given `role: 'owner'` on first
// sign-in, and which account cannot be deleted. It matches the Firebase auth
// account and changing it is an account migration, not a config change: point
// it at an address that cannot sign in and ownership goes with it.
const OWNER_EMAIL = 'the1percentnation@gmail.com';

// Where the platform's own notifications land: bug reports and new-lead
// alerts. Separate from OWNER_EMAIL on purpose, so the inbox can move to the
// business domain without touching who owns the account.
const NOTIFY_EMAIL = 'anthonybrown@the1pnation.com';

// The address every member-facing email comes from.
//
// This is a the1pnation.com alias on purpose. Sending as @gmail.com through
// any provider fails DMARC by design — Google publishes a strict policy for
// its own domain and a third party cannot DKIM-sign mail as gmail.com — which
// is the most reliable way to land in spam. An authenticated sending domain
// is what makes a course invite arrive.
//
// The domain must be authenticated at whichever provider EMAIL_PROVIDER
// names, or every send is unsigned at best and rejected at worst. See
// docs/email-setup.md.
const FROM_EMAIL = 'anthonybrown@the1pnation.com';
const FROM_NAME_DEFAULT = 'The One Percent Nation';
const REPLY_TO = 'anthonybrown@the1pnation.com';

// CRM 1-on-1 email identity. Same mailbox as the transactional identity above,
// different display name: brand mail is from The One Percent Nation, a lead
// emailed from their contact card is from Anthony. It stays a separate
// constant because a company can override it in CRM → Settings → Email, which
// transactional mail never does.
//
// The domain here must be authenticated at the active provider or every send
// is unsigned and lands in spam. See docs/email-setup.md.
const CRM_FROM_EMAIL = 'anthonybrown@the1pnation.com';
const CRM_FROM_NAME = 'Anthony Brown';

/**
 * The subdomain whose MX points at SendGrid Inbound Parse. Outbound CRM email
 * carries Reply-To: reply+<companyId>.<contactId>@<this domain>, which is what
 * makes an inbound reply land on the right contact card with no guessing.
 *
 * It MUST be a subdomain, never the1pnation.com itself — repointing the root
 * MX would take the real mailbox offline.
 */
function inboundEmailDomain() {
  return (process.env.INBOUND_EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, '');
}

/** The per-contact Reply-To, or null when inbound parse is not configured. */
function replyAddressFor(companyId, contactId) {
  const domain = inboundEmailDomain();
  if (!domain || !companyId || !contactId) return null;
  return `reply+${companyId}.${contactId}@${domain}`;
}

/** companies/{cid}.email — the sending identity, with sane fallbacks. */
async function getCompanyEmailIdentity(db, companyId) {
  let cfg = {};
  try {
    const snap = await db.collection('companies').doc(companyId).get();
    if (snap.exists) cfg = (snap.data() && snap.data().email) || {};
  } catch (e) { console.warn('[emailIdentity]', e && e.message); }
  return {
    fromEmail: (cfg.fromEmail || CRM_FROM_EMAIL).trim(),
    fromName: (cfg.fromName || CRM_FROM_NAME).trim(),
    replyTo: (cfg.replyTo || cfg.fromEmail || CRM_FROM_EMAIL).trim(),
    signature: (cfg.signature || '').toString(),
    // A copy of every inbound reply, so the CRM does not become the only
    // place a lead's answer exists.
    forwardInboundTo: (cfg.forwardInboundTo || '').trim() || null
  };
}
// The custom domain, not the raw Firebase one. This lands in outbound email —
// company invites, notification deep links — where the .web.app host reads as a
// different, untrustworthy site next to the One Percent Nation branding around
// it. Both hosts serve the same app, so either works; only one looks right.
// (Member referral links don't rely on this: the client builds those from
// location.origin so they always carry whatever domain the member is on.)
const APP_BASE_URL = 'https://the1pnation.com';

// Member referral scoring. Deliberately modest against the level curve in the
// Phase 2 block (level 5 = 400 points): at 10 points a referral is worth two
// posts, so the leaderboard keeps measuring participation rather than contact
// list size. Raise with care — this number is what decides whether the
// community's top ranks are earned by showing up or by mass-inviting.
const REFERRAL_POINTS = 10;

// Secret: SendGrid API key. Webhook verification key is optional and read
// lazily at runtime via the Secret Manager client — this avoids requiring
// SENDGRID_WEBHOOK_KEY to exist at deploy time.
//
// NOTE: `defineSecret` is different — it is resolved by the CLI at DEPLOY time,
// so every functions deploy calls secretmanager.googleapis.com. That API needs
// billing enabled, which makes an active Blaze plan a hard prerequisite for
// deploying at all, not just for running v2 functions. When billing lapsed in
// June 2026 this was the exact failure: `403 ... requires billing to be
// enabled` on SENDGRID_API_KEY, aborting the deploy. It used to take the
// Firestore rules deploy down with it until the workflow was split — see
// .github/workflows/firebase-deploy-backend.yml.
const sendgridKey = defineSecret('SENDGRID_API_KEY');

// Anthropic API key, for the course advisor chatbot, bug-report analysis and
// the AI course-builder tools. Declared here and bound on each function that
// calls the model, which is what injects it at runtime. The value lives in
// Secret Manager under this exact name; the deploy fails if it does not exist,
// so create it before merging a change that references it.
const anthropicKey = defineSecret('ANTHROPIC_API_KEY');

// Stripe. These MUST be declared with defineSecret and listed in each
// function's `secrets:` option, or they are simply not present at runtime.
// functions/.env is git-ignored, so the GitHub Actions deploy (which is the
// only thing that deploys this project) would never carry a .env file — a
// key set that way survives exactly until the next merge to main.
// Set them once with:
//   firebase functions:secrets:set STRIPE_SECRET_KEY
//   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_SECRETS = [stripeSecretKey, stripeWebhookSecret];

// Anthropic API key. A secret bound on a function (see `anthropicKey` above)
// is exposed to it as an environment variable of the same name, so this reader
// works unchanged. It used to say the value could be set as a "runtime
// environment variable" in the console instead: on v2 functions that setting
// is per Cloud Run service and is overwritten by every deploy, so the key kept
// vanishing. Secret Manager is the only path that survives a deploy.
const ANTHROPIC_API_KEY = () => (process.env.ANTHROPIC_API_KEY || '').trim();

// Telephony credentials are read from process.env (like Stripe), NOT via
// defineSecret — so deploys succeed before the values exist. Until they are set
// (functions/.env, written by CI from repository secrets), sendSms returns "not
// configured" and the webhooks reject unsigned traffic. See the Telnyx block
// further down for the full list and docs/telnyx-setup.md for where each value
// comes from.
//
// The TWILIO_* values below belong to the pre-Telnyx code kept as a revert
// path. Nothing in the live path reads them.
//
// These stay on process.env rather than defineSecret because a defineSecret
// value read from a function that
// does not declare it in `secrets:` comes back empty — the trap that broke
// ANTHROPIC_API_KEY in 277162f.
let _twilioClient = null;
function getTwilio() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) return null;
  if (!_twilioClient) _twilioClient = require('twilio')(sid, token);
  return _twilioClient;
}


// ────────────────────────────────────────────────────────────────
// Telnyx — SMS and voice provider.
//
// Replaces Twilio. Deliberately no SDK: sending is one POST to
// api.telnyx.com/v2/messages, and Node 20 has global fetch, so an extra
// dependency would only add supply-chain surface for no gain.
//
// Configuration is plain process.env, matching the Stripe/Twilio convention in
// this file — the deploy workflow writes functions/.env from repository
// secrets. Until the values exist, every entry point reports "not set up yet"
// rather than throwing, so a deploy always succeeds.
//
// Provide: TELNYX_API_KEY, TELNYX_PUBLIC_KEY, TELNYX_FROM_NUMBER, and
// optionally TELNYX_MESSAGING_PROFILE_ID.
// ────────────────────────────────────────────────────────────────

// Overridable only so the emulator tests can capture outbound email locally;
// production never sets it.
const TELNYX_API = (process.env.TELNYX_API_BASE || '').trim() || 'https://api.telnyx.com/v2';

function telnyxApiKey() {
  return (process.env.TELNYX_API_KEY || '').trim();
}

/** The number we text from. */
function telnyxFromNumber() {
  return (process.env.TELNYX_FROM_NUMBER || '').trim();
}

/** Which messaging pieces are configured, and what is missing if not. */
function telnyxSmsConfig() {
  const apiKey = telnyxApiKey();
  const from = telnyxFromNumber();
  const profileId = (process.env.TELNYX_MESSAGING_PROFILE_ID || '').trim();
  const missing = [];
  if (!apiKey) missing.push('TELNYX_API_KEY');
  if (!from) missing.push('TELNYX_FROM_NUMBER');
  return { apiKey, from, profileId, missing, ok: missing.length === 0 };
}

/**
 * Thin Telnyx REST caller. Throws with the API's own error detail, which is
 * far more useful than a generic 4xx when a number is not on the account or a
 * messaging profile is wrong.
 */
async function telnyx(method, path, body, { raw = false } = {}) {
  const apiKey = telnyxApiKey();
  if (!apiKey) throw new Error('TELNYX_API_KEY is not set');
  const res = await fetch(`${TELNYX_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = json && Array.isArray(json.errors) && json.errors.length
      ? json.errors.map((e) => e.detail || e.title).filter(Boolean).join('; ')
      : (text || `HTTP ${res.status}`);
    const err = new Error(`Telnyx ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  // Most endpoints wrap their payload in `data`. Batch sending does not: its
  // envelope carries `data`, `errors` and `meta` side by side, and unwrapping
  // would throw away exactly the part that says what failed.
  if (raw) return json;
  return json && json.data !== undefined ? json.data : json;
}

/**
 * Send one SMS through Telnyx.
 *
 * Returns the Twilio-shaped `{ sid, status, from }` the callers already write
 * to Firestore, so conversation and message documents keep the exact shape
 * they had under Twilio and the whole frontend needs no change. Telnyx's
 * message id goes in the same `twilioSid` field, which is the indexed key the
 * status webhook looks messages up by.
 */
async function sendTelnyxSms({ to, body }) {
  const cfg = telnyxSmsConfig();
  if (!cfg.ok) throw new Error('Telnyx SMS is not configured: missing ' + cfg.missing.join(', '));
  const payload = { from: cfg.from, to, text: String(body).slice(0, 1600) };
  if (cfg.profileId) payload.messaging_profile_id = cfg.profileId;
  const data = await telnyx('POST', '/messages', payload);
  const sid = (data && data.id) || ('tx_' + Date.now());
  // Telnyx reports per-recipient delivery state; the message-level status
  // arrives later on the status webhook.
  const recipient = data && Array.isArray(data.to) ? data.to[0] : null;
  const status = (recipient && recipient.status) || 'queued';
  return { sid, status, from: cfg.from };
}

// ────────────────────────────────────────────────────────────────
// Email — one seam, two providers.
//
// Every email in this file goes through sendEmail() or sendEmailBatch(). The
// provider behind them is chosen by EMAIL_PROVIDER at call time, so moving
// from SendGrid to Telnyx is an environment change, not a code change, and
// rolling back is the same switch in the other direction.
//
//   EMAIL_PROVIDER=sendgrid   (default) — @sendgrid/mail, SENDGRID_API_KEY
//   EMAIL_PROVIDER=telnyx               — REST, TELNYX_API_KEY
//
// The message shape is the SendGrid one the call sites already wrote, because
// changing 20-odd call sites and the wire format in the same step would make
// a delivery failure impossible to attribute. Each adapter maps that shape to
// its own API:
//
//   to, from {email,name}, replyTo, subject, text, html, headers, customArgs
//
// customArgs is metadata that comes back on delivery/open/click events and is
// what puts a send on the right CRM contact timeline. SendGrid calls it
// custom args; Telnyx calls it metadata. Same job, one name here.
// ────────────────────────────────────────────────────────────────

const EMAIL_PROVIDERS = ['sendgrid', 'telnyx'];

function emailProvider() {
  const p = (process.env.EMAIL_PROVIDER || 'sendgrid').trim().toLowerCase();
  return EMAIL_PROVIDERS.includes(p) ? p : 'sendgrid';
}

/**
 * Is the active provider configured? Callers that must not throw when email
 * has never been set up (the automation tick, lead notifications) check this
 * and skip, exactly as they checked for a SendGrid key before.
 */
function emailConfigured() {
  const provider = emailProvider();
  if (provider === 'telnyx') return !!telnyxApiKey();
  try { return !!sendgridKey.value(); } catch (e) { return false; }
}

/** "Name <addr>" when there is a name, otherwise the bare address. */
function emailAddrString(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  const email = String(a.email || '').trim();
  const name = String(a.name || '').trim();
  return name ? `${name} <${email}>` : email;
}

function emailAddrOnly(a) {
  if (!a) return '';
  if (typeof a === 'string') {
    const m = a.match(/<([^>]+)>/);
    return (m ? m[1] : a).trim();
  }
  return String(a.email || '').trim();
}

function emailAddrList(v) {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map(emailAddrString).filter(Boolean);
}

/**
 * Apply a personalization's substitutions to a rendered body.
 *
 * SendGrid does this server-side from `substitutions` + `substitutionWrappers`.
 * Telnyx has no equivalent, so the same replacement happens here before the
 * message goes out. Keys arrive unwrapped and the wrappers are applied, which
 * matches how the campaign sender already builds its placeholders.
 */
function applySubstitutions(body, subs, wrappers) {
  if (!body || !subs) return body;
  const [open, close] = wrappers && wrappers.length === 2 ? wrappers : ['-', '-'];
  let out = String(body);
  for (const [k, v] of Object.entries(subs)) {
    out = out.split(`${open}${k}${close}`).join(v == null ? '' : String(v));
  }
  return out;
}

// ── SendGrid adapter ─────────────────────────────────────────────────────
// Exactly what the call sites did before the seam existed, moved behind it.

async function sendEmailViaSendGrid(msg) {
  const key = sendgridKey.value();
  if (!key) throw new Error('SENDGRID_API_KEY is not set');
  sgMail.setApiKey(key);
  const [resp] = await sgMail.send(msg);
  return {
    provider: 'sendgrid',
    messageId: (resp && resp.headers && resp.headers['x-message-id']) || null
  };
}

// ── Telnyx adapter ───────────────────────────────────────────────────────
// POST /v2/email_messages. Field names differ from SendGrid in three places
// worth naming: bodies are text_body/html_body, custom args are metadata, and
// reply_to keeps only the address (Telnyx drops a display name on it).

function telnyxEmailBody(msg) {
  const body = {
    from: emailAddrString(msg.from),
    to: emailAddrList(msg.to),
    subject: msg.subject || ''
  };
  if (msg.text) body.text_body = msg.text;
  if (msg.html) body.html_body = msg.html;
  if (msg.replyTo) body.reply_to = emailAddrOnly(msg.replyTo);
  if (msg.cc) body.cc = emailAddrList(msg.cc);
  if (msg.bcc) body.bcc = emailAddrList(msg.bcc);
  if (msg.headers && Object.keys(msg.headers).length) body.headers = msg.headers;
  if (msg.customArgs && Object.keys(msg.customArgs).length) {
    body.metadata = msg.customArgs;
    // `type` is how every send in this file labels itself. As a tag it also
    // reaches the Email Detail Records, which is where per-kind delivery
    // rates are read.
    if (msg.customArgs.type) body.tags = [String(msg.customArgs.type)];
  }
  return body;
}

async function sendEmailViaTelnyx(msg) {
  const data = await telnyx('POST', '/email_messages', telnyxEmailBody(msg));
  return { provider: 'telnyx', messageId: (data && data.id) || null };
}

/**
 * Send one email.
 *
 * Returns { provider, messageId }. messageId is what the CRM and the user doc
 * store to tie later delivery events back to the send, so it is returned
 * uniformly even though the two APIs report it in different places.
 */
async function sendEmail(msg) {
  return emailProvider() === 'telnyx'
    ? sendEmailViaTelnyx(msg)
    : sendEmailViaSendGrid(msg);
}

/**
 * Send the same email to many people, one message each.
 *
 * `recipients` is [{ email, name?, subject?, headers?, customArgs?,
 * substitutions? }]. Nobody sees anybody else's address either way: SendGrid
 * splits a personalization per recipient, Telnyx sends a batch of individual
 * messages. Both cap at 1000 per call, which is the chunk size the callers
 * already use.
 *
 * Returns { accepted, failed, errors } rather than throwing, because a
 * campaign that fails for 3 of 900 people has not failed.
 */
async function sendEmailBatch({
  from, replyTo, subject, text, html, recipients, customArgs,
  substitutionWrappers = ['-', '-']
}) {
  const list = (recipients || []).filter((r) => r && r.email);
  if (!list.length) return { accepted: 0, failed: 0, errors: [] };

  if (emailProvider() === 'telnyx') {
    // Telnyx has no server-side substitution, so each message is rendered
    // here and sent as its own item in the batch.
    const messages = list.map((r) => telnyxEmailBody({
      to: r.name ? { email: r.email, name: r.name } : r.email,
      from,
      replyTo,
      subject: applySubstitutions(r.subject || subject, r.substitutions, substitutionWrappers),
      text: applySubstitutions(text, r.substitutions, substitutionWrappers),
      html: applySubstitutions(html, r.substitutions, substitutionWrappers),
      headers: r.headers,
      customArgs: Object.assign({}, customArgs, r.customArgs)
    }));
    const res = await telnyx('POST', '/email_messages/batch', { messages }, { raw: true });
    const meta = (res && res.meta) || {};
    const errors = ((res && res.errors) || []).slice(0, 5)
      .map((e) => `${e.code}: ${e.message}`);
    // An envelope without meta means the API accepted the whole batch and
    // said nothing more; treat that as all accepted rather than silently
    // reporting zero.
    const succeeded = typeof meta.succeeded === 'number' ? meta.succeeded : list.length;
    const failed = typeof meta.failed === 'number' ? meta.failed : 0;
    return { accepted: succeeded, failed, errors };
  }

  const personalizations = list.map((r) => {
    const p = { to: [{ email: r.email, name: r.name || undefined }] };
    if (r.subject) p.subject = r.subject;
    if (r.substitutions) p.substitutions = r.substitutions;
    if (r.headers) p.headers = r.headers;
    if (r.customArgs) p.customArgs = r.customArgs;
    return p;
  });

  try {
    await sendEmailViaSendGrid({
      from, replyTo, subject, text, html, personalizations, customArgs,
      substitutionWrappers
    });
    return { accepted: list.length, failed: 0, errors: [] };
  } catch (err) {
    // SendGrid rejects or accepts a personalization set as a whole.
    return {
      accepted: 0,
      failed: list.length,
      errors: [String((err && err.message) || err).slice(0, 300)]
    };
  }
}

/**
 * Verify a Telnyx webhook.
 *
 * Telnyx signs with Ed25519 public-key signatures, not an HMAC like Twilio.
 * Two headers arrive: `telnyx-signature-ed25519` (base64, 64 bytes) and
 * `telnyx-timestamp` (unix seconds). The signed message is
 * `${timestamp}|${rawBody}`.
 *
 * Two things here are easy to get wrong and both are security-relevant:
 *
 *   1. The signature covers the EXACT bytes Telnyx sent. Firebase parses JSON
 *      bodies, and re-serialising the parsed object will not round-trip (key
 *      order, unicode escaping, whitespace), so verification must use
 *      req.rawBody. If rawBody is unavailable we fail closed.
 *   2. A valid signature alone does not prevent replay of a captured request,
 *      so the timestamp must be inside a tolerance window.
 */
const TELNYX_WEBHOOK_TOLERANCE_SEC = 300;

function telnyxSignatureOk(req, { toleranceSec = TELNYX_WEBHOOK_TOLERANCE_SEC, now = Date.now() } = {}) {
  const publicKeyB64 = (process.env.TELNYX_PUBLIC_KEY || '').trim();
  if (!publicKeyB64) return false;

  const signatureB64 = req.get ? (req.get('telnyx-signature-ed25519') || '') : '';
  const timestamp = req.get ? (req.get('telnyx-timestamp') || '') : '';
  if (!signatureB64 || !timestamp) return false;

  // Reject anything outside the replay window, including a timestamp far in
  // the future (a clock-skew attack looks the same as a stale replay).
  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return false;
  if (Math.abs(now / 1000 - tsSec) > toleranceSec) return false;

  // rawBody is what Firebase preserves for exactly this purpose. Without it we
  // cannot verify honestly, so refuse rather than guessing at a re-serialisation.
  const raw = req.rawBody;
  if (!raw || !Buffer.isBuffer(raw)) return false;

  try {
    const crypto = require('crypto');
    const signature = Buffer.from(signatureB64, 'base64');
    if (signature.length !== 64) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([
        // DER prefix for a raw 32-byte Ed25519 public key.
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKeyB64, 'base64')
      ]),
      format: 'der',
      type: 'spki'
    });
    const signed = Buffer.concat([Buffer.from(`${timestamp}|`, 'utf8'), raw]);
    return crypto.verify(null, signed, key, signature);
  } catch (e) {
    console.warn('[telnyx] signature check threw', e && e.message);
    return false;
  }
}

/**
 * Telnyx voice configuration.
 *
 * TELNYX_SIP_CONNECTION_ID is a *Credentials* SIP connection (Mission Control
 * → Voice → SIP Connections). WebRTC credentials hang off that connection, and
 * its outbound voice profile is what actually authorises PSTN calls.
 *
 * That profile is a security control, not just billing: a browser holding a
 * WebRTC credential can dial anywhere the profile permits, so the profile must
 * carry destination restrictions and a daily spend limit. See
 * docs/telnyx-setup.md.
 */
function telnyxVoiceConfig() {
  const apiKey = telnyxApiKey();
  const connectionId = (process.env.TELNYX_SIP_CONNECTION_ID || '').trim();
  const callerId = (process.env.TELNYX_CALLER_ID || process.env.TELNYX_FROM_NUMBER || '').trim();
  const texmlAppId = (process.env.TELNYX_TEXML_APP_ID || '').trim();
  const missing = [];
  if (!apiKey) missing.push('TELNYX_API_KEY');
  if (!connectionId) missing.push('TELNYX_SIP_CONNECTION_ID');
  if (!callerId) missing.push('TELNYX_CALLER_ID or TELNYX_FROM_NUMBER');
  return { apiKey, connectionId, callerId, texmlAppId, missing, ok: missing.length === 0 };
}

/**
 * One Telnyx telephony credential per agent, created on first use and reused
 * after that.
 *
 * Per-agent rather than one shared credential so a single rep can be revoked,
 * and so an inbound TeXML <Dial><Sip> can address one rep's browser. The
 * credential id and SIP username live in companies/{cid}/private/telnyxAgents,
 * which no client can read (firestore.rules denies the whole private path).
 */
async function ensureAgentCredential(db, companyId, uid) {
  const cfg = telnyxVoiceConfig();
  const ref = db.collection('companies').doc(companyId).collection('private').doc('telnyxAgents');
  const snap = await ref.get();
  const agents = (snap.exists && snap.data().agents) || {};
  const existing = agents[uid];
  if (existing && existing.credentialId) return existing;

  const cred = await telnyx('POST', '/telephony_credentials', {
    connection_id: cfg.connectionId,
    name: `crm-agent-${uid}`
  });
  const record = {
    credentialId: cred.id,
    sipUsername: cred.sip_username || null,
    createdAt: new Date().toISOString()
  };
  await ref.set({ agents: { [uid]: record } }, { merge: true });
  return record;
}

/** The number leads see when we call them. */
function voiceCallerId() {
  return (process.env.TWILIO_CALLER_ID || process.env.TWILIO_FROM_NUMBER || '').trim();
}

/**
 * Which voice pieces are configured. Every voice endpoint checks this and
 * returns a readable "not set up yet" rather than a 500, so the CRM can ship
 * the buttons before the Twilio project exists.
 */
function voiceConfig() {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const apiKeySid = (process.env.TWILIO_API_KEY_SID || '').trim();
  const apiKeySecret = (process.env.TWILIO_API_KEY_SECRET || '').trim();
  const twimlAppSid = (process.env.TWILIO_TWIML_APP_SID || '').trim();
  const callerId = voiceCallerId();
  const missing = [];
  if (!accountSid) missing.push('TWILIO_ACCOUNT_SID');
  if (!apiKeySid) missing.push('TWILIO_API_KEY_SID');
  if (!apiKeySecret) missing.push('TWILIO_API_KEY_SECRET');
  if (!twimlAppSid) missing.push('TWILIO_TWIML_APP_SID');
  if (!callerId) missing.push('TWILIO_CALLER_ID or TWILIO_FROM_NUMBER');
  return { accountSid, apiKeySid, apiKeySecret, twimlAppSid, callerId, missing, ok: missing.length === 0 };
}

/**
 * Reject anything not signed by Twilio. Shared by every voice webhook; the
 * SMS webhooks predate this and inline the same check.
 *
 * The signed URL must match byte-for-byte what Twilio called, query string
 * included — hence originalUrl rather than path.
 */
function twilioSignatureOk(req) {
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!token) return false;
  try {
    const twilioLib = require('twilio');
    const signature = req.get('X-Twilio-Signature') || '';
    const url = `https://${req.get('host')}${req.originalUrl}`;
    return twilioLib.validateRequest(token, signature, url, req.body || {});
  } catch (e) {
    console.warn('[twilio] signature check threw', e && e.message);
    return false;
  }
}

/** The absolute https base for this function's own region/project. */
function fnBaseUrl(req) {
  return `https://${req.get('host')}`;
}

/**
 * The same base for code paths that have no incoming request to read the
 * host from (callables that hand Twilio a URL to call back). Cloud Functions
 * sets GCLOUD_PROJECT at runtime; FUNCTIONS_BASE_URL overrides it for a
 * custom domain or an emulator run.
 */
function functionsBaseUrl() {
  const override = (process.env.FUNCTIONS_BASE_URL || '').trim();
  if (override) return override.replace(/\/+$/, '');
  const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'the-1p-leadership';
  return `https://us-central1-${project}.cloudfunctions.net`;
}

/**
 * A Voice SDK client identity is `agent_<uid>`. Parsing it back out of the
 * TwiML request's From field is how we verify that the browser asking us to
 * dial is actually an admin of the company it named — device.connect params
 * come from the client, so they are a request, not a fact.
 */
function uidFromClientIdentity(from) {
  const m = /^client:agent_(.+)$/.exec(String(from || ''));
  return m ? m[1] : null;
}

function voiceIdentityFor(uid) {
  return 'agent_' + uid;
}

/** Is `uid` an admin (or the owner) of this company? Rules-free equivalent
 *  of assertCompanyAdmin, for webhook paths that have no request.auth. */
async function uidAdminsCompany(db, companyId, uid) {
  if (!companyId || !uid) return false;
  try {
    const snap = await db.collection('companies').doc(companyId).get();
    if (!snap.exists) return false;
    const adminUids = (snap.data() && snap.data().adminUids) || [];
    if (adminUids.includes(uid)) return true;
    const userSnap = await db.collection('users').doc(uid).get();
    return userSnap.exists && userSnap.data().role === 'owner';
  } catch (e) { return false; }
}

// Best-effort E.164 normalization (defaults to US +1 for 10-digit numbers).
function normalizePhone(p) {
  if (!p) return null;
  let s = String(p).trim().replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s[0] !== '+') {
    const digits = s.replace(/\D/g, '');
    s = digits.length === 10 ? '+1' + digits : '+' + digits;
  }
  return s;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function textToHtml(text) {
  if (!text) return '';
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\n/g, '<br/>');
}

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * Real outreach only — this is the field `lastActivityAt` fails to be.
 *
 * `lastActivityAt` moves on every tag edit, stage change, field save, CSV import
 * and even an unsubscribe click, so a lead nobody has spoken to in six weeks can
 * read as freshly touched. `lastContactedAt` moves only when a human actually
 * reached the lead or the lead reached us: email, SMS, a connected call, or a
 * manually logged call/meeting/email.
 *
 * Deliberately NOT called from: CSV import, member sync, event registration,
 * unsubscribe handling, or Stripe deal-won. Those change the record, not the
 * relationship.
 *
 * Returns the fields to merge rather than writing, so a caller that is already
 * building a `set(..., {merge:true})` payload does one write instead of two.
 */
function lastContactedFields(channel, direction) {
  return {
    lastContactedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastContactChannel: channel,        // 'email' | 'sms' | 'call' | 'meeting'
    lastContactDirection: direction     // 'out' | 'in'
  };
}

/** Fire-and-forget variant for call sites that are not already writing. */
async function touchLastContacted(contactRef, { channel, direction }) {
  try {
    await contactRef.set(lastContactedFields(channel, direction), { merge: true });
  } catch (e) {
    console.warn('[lastContacted]', e && e.message);
  }
}

async function assertCompanyAdmin(db, companyId, request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const companySnap = await db.collection('companies').doc(companyId).get();
  if (!companySnap.exists) throw new HttpsError('not-found', 'Company not found.');
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  const adminUids = (companySnap.data() && companySnap.data().adminUids) || [];
  if (!isOwnerClaim && !adminUids.includes(uid)) {
    throw new HttpsError('permission-denied', 'Not an admin of this company.');
  }
  return { uid, isOwner: !!isOwnerClaim, company: companySnap.data() };
}

// ────────────────────────────────────────────────────────────────
// Rate limiting
// ────────────────────────────────────────────────────────────────
// Firestore-backed fixed-window limiter. Each caller (uid, or client IP for
// unauthenticated endpoints) gets a counter document per action, bucketed into
// a time window. When the count exceeds `max` inside `windowSec`, the call is
// rejected with resource-exhausted. This bounds abuse of expensive endpoints
// (AI calls, email/SMS sends, checkout, invite creation) without any external
// dependency. Counters are best-effort: if the transaction itself errors we
// fail OPEN (allow the call) so a Firestore hiccup never hard-locks the app.
//
// Note: this is a per-instance-agnostic, durable limiter — it counts across all
// function instances because the state lives in Firestore, not memory.
function clientIp(request) {
  // onCall exposes the raw request on request.rawRequest (Express req).
  const raw = request && request.rawRequest;
  if (!raw) return 'unknown';
  const fwd = (raw.headers && (raw.headers['x-forwarded-for'] || raw.headers['X-Forwarded-For'])) || '';
  if (fwd) return String(fwd).split(',')[0].trim();
  return (raw.ip || (raw.connection && raw.connection.remoteAddress) || 'unknown');
}

/**
 * enforceRateLimit(db, { action, key, max, windowSec })
 *  - action: logical bucket name, e.g. 'courseAdvisorChat'
 *  - key:    stable caller id (uid or ip). Combined with action + window.
 *  - max:    max allowed calls within the window
 *  - windowSec: window length in seconds
 * Throws HttpsError('resource-exhausted', ...) when the limit is exceeded.
 */
async function enforceRateLimit(db, { action, key, max, windowSec }) {
  if (!action || !key) return; // nothing to key on — allow.
  // Bucket boundary: current time floored to the window. Using seconds keeps the
  // doc id short and rotates buckets automatically (old buckets are simply
  // never read again; a scheduled cleanup can prune them later if desired).
  const nowSec = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSec / windowSec);
  const safeKey = String(key).replace(/[^A-Za-z0-9_.@:-]/g, '_').slice(0, 200);
  const docId = `${action}__${safeKey}__${bucket}`;
  const ref = db.collection('rateLimits').doc(docId);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = snap.exists ? Number(snap.data().count || 0) : 0;
      if (count >= max) {
        throw new HttpsError('resource-exhausted',
          'Too many requests. Please slow down and try again in a minute.');
      }
      tx.set(ref, {
        count: count + 1,
        action,
        key: safeKey,
        // Expiry hint so a TTL policy (rateLimits.expiresAt) can auto-prune.
        expiresAt: admin.firestore.Timestamp.fromMillis((bucket + 2) * windowSec * 1000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch (e) {
    // Re-throw our own limit error; swallow infrastructure errors (fail open).
    if (e instanceof HttpsError) throw e;
    console.warn('[rateLimit] counter write failed (failing open):', e && e.message);
  }
}

// Convenience: rate-limit by uid when signed in, else by client IP. Returns the
// key used (handy for logging). Call at the top of a handler, after you know
// whether auth is required.
async function rateLimitCaller(db, request, { action, max, windowSec }) {
  const uid = request.auth && request.auth.uid;
  const key = uid ? `uid:${uid}` : `ip:${clientIp(request)}`;
  await enforceRateLimit(db, { action, key, max, windowSec });
  return key;
}

/**
 * acceptInvite({ code })
 */
exports.acceptInvite = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const code = (request.data && request.data.code || '').toString().trim();
  if (!code) throw new HttpsError('invalid-argument', 'Missing invite code.');

  const db = admin.firestore();

  const snap = await db.collectionGroup('invites')
    .where('code', '==', code)
    .limit(1)
    .get();

  if (snap.empty) throw new HttpsError('not-found', 'Invite code not found.');
  const inviteRef = snap.docs[0].ref;
  const invite = snap.docs[0].data();
  if (invite.status && invite.status !== 'pending') {
    throw new HttpsError('failed-precondition', `Invite is ${invite.status}.`);
  }

  const companyId = invite.companyId || inviteRef.parent.parent.id;
  const companyRef = db.collection('companies').doc(companyId);
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const [companySnap, userSnap, inviteSnap] = await Promise.all([
      tx.get(companyRef),
      tx.get(userRef),
      tx.get(inviteRef)
    ]);
    if (!companySnap.exists) throw new HttpsError('not-found', 'Company not found.');
    if (!inviteSnap.exists) throw new HttpsError('not-found', 'Invite not found.');
    const c = companySnap.data();
    const i = inviteSnap.data();

    if (i.status && i.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Invite is ${i.status}.`);
    }
    const seatCount = Number(c.seatCount || 0);
    const seatsUsed = Number(c.seatsUsed || 0);
    if (seatsUsed >= seatCount) {
      throw new HttpsError('resource-exhausted', 'No seats remaining.');
    }

    tx.update(inviteRef, {
      status: 'accepted',
      acceptedByUid: uid,
      acceptedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(companyRef, {
      seatsUsed: seatsUsed + 1
    });

    const email = (request.auth.token && request.auth.token.email) || null;
    const displayName = (request.auth.token && request.auth.token.name) || null;
    const userPatch = {
      companyId,
      role: userSnap.exists && userSnap.data().role === 'owner' ? 'owner' : 'user',
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (!userSnap.exists) {
      userPatch.email = email;
      userPatch.displayName = displayName;
      userPatch.tier = 'team';
      userPatch.createdAt = admin.firestore.FieldValue.serverTimestamp();
      tx.set(userRef, userPatch);
    } else {
      tx.set(userRef, userPatch, { merge: true });
    }

    const memberRef = companyRef.collection('members').doc(uid);
    tx.set(memberRef, {
      uid,
      email: email || (userSnap.exists ? userSnap.data().email : null),
      displayName: displayName || (userSnap.exists ? userSnap.data().displayName : null),
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return { ok: true, companyId };
});

/**
 * deleteContact({ companyId, contactId })
 */
exports.deleteContact = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const companyId = (request.data && request.data.companyId || '').toString().trim();
  const contactId = (request.data && request.data.contactId || '').toString().trim();
  if (!companyId || !contactId) {
    throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
  }

  const db = admin.firestore();
  await assertCompanyAdmin(db, companyId, request);
  const companyRef = db.collection('companies').doc(companyId);

  const contactRef = companyRef.collection('contacts').doc(contactId);
  const contactSnap = await contactRef.get();
  if (!contactSnap.exists) {
    return { ok: true, deleted: 0, note: 'Contact already gone.' };
  }

  async function deleteCollection(colRef) {
    let deleted = 0;
    while (true) {
      const snap = await colRef.limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 400) break;
    }
    return deleted;
  }

  const notesDeleted = await deleteCollection(contactRef.collection('notes'));
  const actsDeleted = await deleteCollection(contactRef.collection('activities'));
  await contactRef.delete();

  return { ok: true, deleted: notesDeleted + actsDeleted + 1 };
});

/**
 * importContacts({ companyId, rows, duplicateMode, importTag })
 *
 * Bulk-creates CRM contacts from a parsed CSV. The client parses and maps
 * columns, then sends rows here in chunks — this endpoint owns validation,
 * de-duplication and the writes, so a hand-built payload cannot bypass them.
 *
 * Email is required per row and is the dedupe key. A contact list without
 * addresses cannot be mailed, matched to a member, or merged on the next
 * import, so a row without one is reported back as an error rather than
 * written as an orphan.
 *
 * duplicateMode decides what happens when the email already exists:
 *   'update' (default) — merge the non-empty incoming fields, union the tags
 *   'skip'             — leave the existing contact untouched
 * Creating a second contact with the same email is deliberately not offered:
 * duplicates are the thing an import most often breaks, and every other
 * surface (lead forms, member sync) already upserts on email.
 *
 * Chunked by the caller: MAX_ROWS per call keeps each invocation inside the
 * function timeout and the batch limits, and lets the UI show real progress.
 */
const IMPORT_MAX_ROWS = 250;
const IMPORT_STAGES = ['new', 'contacted', 'qualified', 'negotiating', 'customer', 'lost'];

exports.importContacts = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const companyId = (data.companyId || '').toString().trim();
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');

  const rows = Array.isArray(data.rows) ? data.rows : null;
  if (!rows || !rows.length) throw new HttpsError('invalid-argument', 'No rows to import.');
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new HttpsError('invalid-argument', `Send at most ${IMPORT_MAX_ROWS} rows per call.`);
  }

  const duplicateMode = data.duplicateMode === 'skip' ? 'skip' : 'update';
  const importTag = (data.importTag || '').toString().trim().slice(0, 40) || null;

  const db = admin.firestore();
  await assertCompanyAdmin(db, companyId, request);
  // 40 calls / 10 min = 10k contacts, well past any real list, while still
  // bounding what a compromised admin session can shovel in.
  await rateLimitCaller(db, request, { action: 'importContacts', max: 40, windowSec: 600 });

  const FV = admin.firestore.FieldValue;
  const colRef = db.collection('companies').doc(companyId).collection('contacts');

  // ── Normalize + validate, and collapse duplicates inside this chunk ──
  const errors = [];
  const byEmail = new Map();   // email → normalized row (last one wins)
  rows.forEach((raw, i) => {
    const r = raw && typeof raw === 'object' ? raw : {};
    // rowNum is the caller's line number in the original file, so an error
    // points the user at the row they can actually go and fix.
    const rowNum = Number(r.rowNum) || (i + 1);
    const email = (r.email || '').toString().trim().toLowerCase().slice(0, 160);
    if (!email) { errors.push({ rowNum, email: '', message: 'No email address' }); return; }
    if (!EMAIL_RE.test(email)) { errors.push({ rowNum, email, message: 'Invalid email address' }); return; }

    const tags = Array.isArray(r.tags)
      ? r.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 20)
      : [];
    if (importTag) tags.push(importTag);

    // The address exactly as the file spelled it, for the case-sensitive
    // lookup below. Only the normalized form is ever written.
    const emailRaw = (r.email || '').toString().trim().slice(0, 160);

    byEmail.set(email, {
      rowNum,
      email,
      emailRaw,
      name: (r.name || '').toString().trim().slice(0, 120),
      phone: (r.phone || '').toString().trim().slice(0, 40),
      companyName: (r.companyName || '').toString().trim().slice(0, 120),
      source: (r.source || '').toString().trim().slice(0, 40) || 'Import',
      stage: IMPORT_STAGES.includes(r.stage) ? r.stage : 'new',
      tags: Array.from(new Set(tags))
    });
  });

  const items = Array.from(byEmail.values());
  if (!items.length) return { ok: true, created: 0, updated: 0, skipped: 0, errors };

  // ── Look up existing contacts by email (10 per 'in' query) ──
  //
  // Firestore equality is case-sensitive and contacts typed into the CRM
  // modal are stored as the admin typed them, so a lowercased lookup alone
  // would miss "Jane@Example.com" and create a second record for her. Each
  // row is therefore looked up under both its normalized form and the exact
  // string the file carried, and matches are keyed by the normalized email.
  const lookups = [];
  const seenLookup = new Set();
  items.forEach((it) => {
    [it.email, it.emailRaw].forEach((v) => {
      if (v && !seenLookup.has(v)) { seenLookup.add(v); lookups.push(v); }
    });
  });

  const existing = new Map();  // normalized email → doc ref
  for (let i = 0; i < lookups.length; i += 10) {
    const slice = lookups.slice(i, i + 10);
    try {
      const snap = await colRef.where('email', 'in', slice).get();
      snap.docs.forEach((d) => {
        const e = (d.data() && d.data().email || '').toLowerCase();
        if (e && !existing.has(e)) existing.set(e, d.ref);
      });
    } catch (e) {
      // A failed lookup must not turn into silent duplicates, so the whole
      // chunk stops here and the caller can retry it.
      throw new HttpsError('internal', 'Could not check for existing contacts. Nothing was imported from this batch.');
    }
  }

  // ── Write ──
  let created = 0, updated = 0, skipped = 0;
  let batch = db.batch();
  let ops = 0;
  const commit = async () => {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  };

  for (const it of items) {
    const ref = existing.get(it.email);

    if (ref && duplicateMode === 'skip') { skipped++; continue; }

    if (ref) {
      // Merge: only overwrite a field the file actually carries a value for,
      // so a sparse export cannot blank out data already in the CRM.
      const patch = { updatedAt: FV.serverTimestamp(), lastActivityAt: FV.serverTimestamp() };
      if (it.name) patch.name = it.name;
      if (it.phone) patch.phone = it.phone;
      if (it.companyName) patch.companyName = it.companyName;
      if (it.tags.length) patch.tags = FV.arrayUnion(...it.tags);
      batch.set(ref, patch, { merge: true });
      batch.set(ref.collection('activities').doc(), {
        type: 'import',
        description: `Updated by CSV import${importTag ? ` (${importTag})` : ''}`,
        actorUid: uid, actorName: 'CSV import',
        createdAt: FV.serverTimestamp()
      });
      ops += 2;
      updated++;
    } else {
      const newRef = colRef.doc();
      batch.set(newRef, {
        name: it.name || it.email,
        email: it.email,
        phone: it.phone || null,
        companyName: it.companyName || null,
        address: null,
        source: it.source,
        stage: it.stage,
        tags: it.tags,
        ownerUid: null,
        memberUid: null,
        createdAt: FV.serverTimestamp(),
        updatedAt: FV.serverTimestamp(),
        createdBy: uid,
        lastActivityAt: FV.serverTimestamp()
      });
      batch.set(newRef.collection('activities').doc(), {
        type: 'import',
        description: `Imported from CSV${importTag ? ` (${importTag})` : ''}`,
        actorUid: uid, actorName: 'CSV import',
        createdAt: FV.serverTimestamp()
      });
      ops += 2;
      created++;
    }

    // Firestore caps a batch at 500 writes; commit well short of it.
    if (ops >= 400) await commit();
  }
  await commit();

  return { ok: true, created, updated, skipped, errors };
});

/**
 * deleteUser({ uid })
 *
 * Fully removes a user from the platform — Firestore user doc + subcollections
 * (progress, capstone, enrollments) + Firebase Auth account + company roster
 * entry. Decrements the company's seatsUsed and strips the user from adminUids.
 *
 * Permission: caller must be the bootstrap owner (custom claim role=owner), or
 * an admin of the target user's company (uid in companies/{cid}.adminUids).
 *
 * Refuses to delete self or the bootstrap owner account.
 */
exports.deleteUser = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const targetUid = (request.data && request.data.uid || '').toString().trim();
  if (!targetUid) throw new HttpsError('invalid-argument', 'Target uid is required.');

  if (callerUid === targetUid) {
    throw new HttpsError('failed-precondition', 'Cannot delete your own account here.');
  }

  const db = admin.firestore();
  const targetUserRef = db.collection('users').doc(targetUid);
  const targetUserSnap = await targetUserRef.get();

  // If the user doc is already gone, still try to clean up Auth as a best-effort.
  if (!targetUserSnap.exists) {
    const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
    if (!isOwnerClaim) {
      throw new HttpsError('permission-denied', 'User not found and caller is not owner.');
    }
    try { await admin.auth().deleteUser(targetUid); } catch (e) {}
    return { ok: true, deleted: 0, note: 'User doc already gone.' };
  }

  const targetData = targetUserSnap.data() || {};
  const targetCompanyId = targetData.companyId || null;
  const targetEmail = (targetData.email || '').toLowerCase();

  if (targetEmail === OWNER_EMAIL.toLowerCase()) {
    throw new HttpsError('failed-precondition', 'Cannot delete the bootstrap owner account.');
  }

  // Permission: owner OR admin of the target's company.
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  let isCompanyAdmin = false;
  if (!isOwnerClaim && targetCompanyId) {
    const compSnap = await db.collection('companies').doc(targetCompanyId).get();
    if (compSnap.exists) {
      const adminUids = (compSnap.data() && compSnap.data().adminUids) || [];
      isCompanyAdmin = adminUids.includes(callerUid);
    }
  }
  if (!isOwnerClaim && !isCompanyAdmin) {
    throw new HttpsError('permission-denied', 'You do not have permission to delete this user.');
  }

  async function deleteCollection(colRef) {
    let deleted = 0;
    while (true) {
      const snap = await colRef.limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 400) break;
    }
    return deleted;
  }

  // Same list as the self-service deletion path, for the same reason: a
  // subcollection left behind survives the parent document and is orphaned
  // under a uid that no longer exists. This used to clear only progress,
  // capstone and a nonexistent 'enrollments'.
  let subDeleted = 0;
  for (const name of USER_SUBCOLLECTIONS) {
    try { subDeleted += await deleteCollection(targetUserRef.collection(name)); }
    catch (e) { /* best-effort */ }
  }

  // Remove from company roster + decrement seat + strip from adminUids.
  if (targetCompanyId) {
    const companyRef = db.collection('companies').doc(targetCompanyId);
    const memberRef = companyRef.collection('members').doc(targetUid);
    try { await memberRef.delete(); } catch (e) { /* best-effort */ }
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(companyRef);
        if (!s.exists) return;
        const c = s.data() || {};
        const newUsed = Math.max(0, (c.seatsUsed || 0) - 1);
        const adminUids = (c.adminUids || []).filter((u) => u !== targetUid);
        tx.update(companyRef, { seatsUsed: newUsed, adminUids });
      });
    } catch (e) { /* best-effort */ }
  }

  await targetUserRef.delete();

  try {
    await admin.auth().deleteUser(targetUid);
  } catch (e) {
    if (e && e.code !== 'auth/user-not-found') {
      console.warn('[deleteUser] auth.deleteUser failed:', e.message);
    }
  }

  return {
    ok: true,
    deleted: subDeleted + 1
  };
});

/**
 * revokeSeat({ companyId, uid }) — remove a member from a company.
 *
 * One transaction does all three things that have to move together: the
 * roster document goes, the company's seatsUsed comes down, and the member's
 * own companyId is cleared.
 *
 * This replaces a client-side path in js/admin.js that could do only the
 * first two, and did them from a stale in-memory copy of seatsUsed rather
 * than a transaction, so the seat count drifted whenever two admins acted at
 * once. It also could not touch users/{uid}.companyId at all (rules restrict
 * that document to self and owner), so a revoked member kept passing the
 * "same company" read rules and could still see the company roster and
 * company-scoped posts. Only the Admin SDK can clear that field, which is why
 * this lives here.
 */
exports.revokeSeat = onCall(async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const companyId = (data.companyId || '').toString().trim();
  const targetUid = (data.uid || '').toString().trim();
  if (!companyId || !targetUid) {
    throw new HttpsError('invalid-argument', 'companyId and uid are required.');
  }
  const { uid: callerUid } = await assertCompanyAdmin(db, companyId, request);
  if (callerUid === targetUid) {
    throw new HttpsError('failed-precondition', 'You cannot revoke your own seat here.');
  }

  const companyRef = db.collection('companies').doc(companyId);
  const memberRef = companyRef.collection('members').doc(targetUid);
  const userRef = db.collection('users').doc(targetUid);

  await db.runTransaction(async (tx) => {
    const [companySnap, memberSnap, userSnap] = await Promise.all([
      tx.get(companyRef), tx.get(memberRef), tx.get(userRef)
    ]);
    if (!companySnap.exists) throw new HttpsError('not-found', 'Company not found.');
    const c = companySnap.data() || {};

    // Only free a seat if this member actually held one, so a double-click or
    // a stale roster never drives seatsUsed below the truth.
    const heldSeat = memberSnap.exists;
    if (heldSeat) tx.delete(memberRef);

    const patch = {
      seatsUsed: Math.max(0, (c.seatsUsed || 0) - (heldSeat ? 1 : 0)),
      // A revoked member is no longer an admin of the company either.
      adminUids: (c.adminUids || []).filter((u) => u !== targetUid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    tx.update(companyRef, patch);

    if (userSnap.exists && (userSnap.data() || {}).companyId === companyId) {
      tx.update(userRef, {
        companyId: null,
        // Company admins are a company concept; without one, the role is plain member.
        ...((userSnap.data() || {}).role === 'admin' ? { role: 'user' } : {})
      });
    }
  });

  return { ok: true };
});

/**
 * Every subcollection under users/{uid}.
 *
 * One list, used by both deleteMyAccount (right to delete) and
 * requestDataExport (right to know), because the two must not drift apart.
 *
 * Deleting a Firestore document does NOT delete its subcollections, so a name
 * missing here is data that survives an account deletion, orphaned under a
 * uid that no longer exists. The previous inline list named 'enrollments',
 * which is not a subcollection at all (course access lives in the user doc's
 * enrolledCourseSlugs array), and omitted the five written by the
 * certification flow: practiceRecordings, coachingHours, ceCredits,
 * examAttempts and certificates.
 *
 * Keep in step with the match blocks under users/{uid} in firestore.rules.
 */
const USER_SUBCOLLECTIONS = [
  'progress',
  'capstone',
  'practiceRecordings',
  'coachingHours',
  'ceCredits',
  'examAttempts',
  'certificates',
  'stats',
  'notifications',
  'registrations',
  'courseInterests',
  'purchases'
];

/**
 * deleteMyAccount() — self-service account + data deletion (CCPA/CPRA "right to
 * delete", and the equivalent right under the other state privacy laws).
 * The signed-in user erases their OWN account: user doc, all private
 * subcollections, company roster entry + seat, and the Firebase Auth user.
 *
 * The bootstrap owner cannot self-delete here (that would orphan the platform).
 */
exports.deleteMyAccount = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const data = userSnap.exists ? (userSnap.data() || {}) : {};
  const email = (data.email || (request.auth.token && request.auth.token.email) || '').toLowerCase();

  if (email && email === OWNER_EMAIL.toLowerCase()) {
    throw new HttpsError('failed-precondition',
      'The owner account cannot be self-deleted. Contact support to transfer ownership first.');
  }

  // Wipe every per-user subcollection that holds their data.
  async function deleteCollection(colRef) {
    let deleted = 0;
    while (true) {
      const snap = await colRef.limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 400) break;
    }
    return deleted;
  }
  for (const name of USER_SUBCOLLECTIONS) {
    try { await deleteCollection(userRef.collection(name)); } catch (e) { /* best-effort */ }
  }

  // Remove from company roster, free the seat, strip any admin grant.
  const companyId = data.companyId || null;
  if (companyId) {
    const companyRef = db.collection('companies').doc(companyId);
    try { await companyRef.collection('members').doc(uid).delete(); } catch (e) { /* best-effort */ }
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(companyRef);
        if (!s.exists) return;
        const c = s.data() || {};
        const newUsed = Math.max(0, (c.seatsUsed || 0) - 1);
        const adminUids = (c.adminUids || []).filter((u) => u !== uid);
        tx.update(companyRef, { seatsUsed: newUsed, adminUids });
      });
    } catch (e) { /* best-effort */ }
  }

  try { await userRef.delete(); } catch (e) { /* best-effort */ }
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    if (e && e.code !== 'auth/user-not-found') {
      console.warn('[deleteMyAccount] auth.deleteUser failed:', e.message);
    }
  }

  return { ok: true };
});

/**
 * requestDataExport() — self-service data access/portability (CCPA/CPRA "right
 * to know", GDPR-style portability). Returns the signed-in user's own profile
 * doc plus their private subcollections as a plain JSON object the client can
 * download. No PII of anyone else is included.
 */
exports.requestDataExport = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  await rateLimitCaller(admin.firestore(), request,
    { action: 'requestDataExport', max: 5, windowSec: 3600 });

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'No account data found.');

  // Firestore Timestamps -> ISO strings so the JSON is portable/readable.
  function serialize(obj) {
    if (obj == null) return obj;
    if (obj && typeof obj.toDate === 'function') return obj.toDate().toISOString();
    if (Array.isArray(obj)) return obj.map(serialize);
    if (typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = serialize(v);
      return out;
    }
    return obj;
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    uid,
    profile: serialize(userSnap.data()),
    collections: {}
  };

  for (const name of USER_SUBCOLLECTIONS) {
    try {
      const snap = await userRef.collection(name).get();
      if (!snap.empty) {
        exportData.collections[name] = snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }));
      }
    } catch (e) { /* best-effort */ }
  }

  return { ok: true, data: exportData };
});

/**
 * bootstrapOwner()
 */
exports.bootstrapOwner = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const email = (request.auth.token && request.auth.token.email || '').toLowerCase();
  if (email !== OWNER_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the bootstrap owner email can claim ownership.');
  }
  await admin.auth().setCustomUserClaims(uid, { role: 'owner' });
  await admin.firestore().collection('users').doc(uid).set({
    email,
    role: 'owner',
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true, note: 'Sign out and back in (or refresh token) for the claim to take effect.' };
});

// ────────────────────────────────────────────────────────────────
// Email: invite on create
// ────────────────────────────────────────────────────────────────

/**
 * onInviteCreated — Firestore trigger on companies/{companyId}/invites/{inviteId}.
 * Sends an invite email and records emailStatus on the invite doc.
 */
exports.onInviteCreated = onDocumentCreated(
  { document: 'companies/{companyId}/invites/{inviteId}', secrets: [sendgridKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const invite = snap.data();
    const companyId = event.params.companyId;

    if (!invite || !invite.email) {
      try { await snap.ref.update({ emailStatus: 'skipped', emailError: 'No recipient email' }); } catch (e) {}
      return;
    }

    try {
      let companyName = 'the team';
      try {
        const cSnap = await admin.firestore().collection('companies').doc(companyId).get();
        if (cSnap.exists) companyName = cSnap.data().name || companyName;
      } catch (e) {}

      const code = invite.code || snap.id;
      const link = `${APP_BASE_URL}/invite.html?code=${encodeURIComponent(code)}`;

      const subject = `You're invited to join ${companyName} on 1P Leadership`;
      const textBody =
        `You've been invited to join ${companyName} on The 1P Leadership dashboard.\n\n` +
        `Click the link below to accept your invite and get started:\n${link}\n\n` +
        `If the link doesn't work, paste it into your browser.\n\n— The One Percent Nation`;

      const htmlBody = `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:0 auto;">
          <h2 style="color:#CC1B1B;margin-bottom:8px;">Welcome to 1P Leadership</h2>
          <p>You've been invited to join <strong>${companyName}</strong> on The 1P Leadership dashboard.</p>
          <p><a href="${link}" style="display:inline-block;background:#CC1B1B;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:600;">Accept invite</a></p>
          <p style="color:#666;font-size:12px;">Or paste this link into your browser:<br/><a href="${link}">${link}</a></p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
          <p style="color:#999;font-size:11px;">The One Percent Nation</p>
        </div>`;

      const { messageId } = await sendEmail({
        to: invite.email,
        from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
        replyTo: REPLY_TO,
        subject,
        text: textBody,
        html: htmlBody,
        customArgs: {
          type: 'invite',
          companyId,
          inviteId: snap.id
        }
      });

      await snap.ref.update({
        emailStatus: 'sent',
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailMessageId: messageId
      });
    } catch (err) {
      console.error('[onInviteCreated] send failed:', err && err.message);
      try {
        await snap.ref.update({
          emailStatus: 'failed',
          emailError: String((err && err.message) || err).slice(0, 500)
        });
      } catch (e2) {}
    }
  }
);

// ────────────────────────────────────────────────────────────────
// Email: welcome on user create
// ────────────────────────────────────────────────────────────────

exports.onUserCreated = onDocumentCreated(
  { document: 'users/{uid}', secrets: [sendgridKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const user = snap.data();
    if (!user || !user.email) return;

    // Access granted before the account existed (beta testers, comps).
    try {
      const n = await applyPendingGrants(admin.firestore(), event.params.uid, user.email);
      if (n) console.log(`[onUserCreated] applied ${n} pending grant(s) for ${user.email}`);
    } catch (e) {
      console.error('[onUserCreated] pending grants failed:', e && e.message);
    }

    // A beta tester who signed up after being approved. No-ops for everyone else.
    try {
      await markBetaActivated(admin.firestore(), user.email, event.params.uid);
    } catch (e) {
      console.error('[onUserCreated] beta activation failed:', e && e.message);
    }

    const db = admin.firestore();
    const uid = event.params.uid;

    // 1) Mirror the new member into the academy CRM. Never blocks the email.
    let crm = null;
    try {
      crm = await syncMemberToCrm(db, uid, user, {
        source: 'Member Signup',
        activity: {
          type: 'member_signup',
          description: 'Created a member-portal account'
            + (user.companyId ? ' via company invite' : ''),
          meta: { companyId: user.companyId || null, tier: user.tier || null }
        }
      });
      if (crm) console.log(`[onUserCreated] CRM contact ${crm.contactId} for ${user.email}`);
    } catch (e) {
      console.error('[onUserCreated] CRM sync failed:', e && e.message);
    }

    // 2) Welcome email (once; outcome recorded on the user doc).
    const sent = await sendWelcomeEmail(db, uid, user, { crm });
    console.log(`[onUserCreated] welcome email ${sent.status} for ${user.email}`);
  }
);

// ────────────────────────────────────────────────────────────────
// sendContactEmail — callable
// ────────────────────────────────────────────────────────────────

exports.sendContactEmail = onCall(
  { secrets: [sendgridKey] },
  async (request) => {
    const db = admin.firestore();
    const data = request.data || {};
    const companyId = (data.companyId || '').toString().trim();
    const contactId = (data.contactId || '').toString().trim();
    const subject = (data.subject || '').toString().trim();
    const bodyHtml = (data.bodyHtml || '').toString();
    const bodyText = (data.bodyText || '').toString();
    // Set when the send is a reply from the thread view, so the outbound
    // message joins the same thread instead of starting a new one.
    const threadKeyIn = (data.threadKey || '').toString().trim();
    const inReplyTo = (data.inReplyTo || '').toString().trim();

    if (!companyId || !contactId) throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
    if (!subject) throw new HttpsError('invalid-argument', 'Subject is required.');
    if (!bodyHtml && !bodyText) throw new HttpsError('invalid-argument', 'Body is required.');

    const { uid } = await assertCompanyAdmin(db, companyId, request);

    // Throttle single-contact sends: 60 per admin per 10 minutes.
    await rateLimitCaller(db, request, { action: 'sendContactEmail', max: 60, windowSec: 600 });

    const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(contactId);
    const contactSnap = await contactRef.get();
    if (!contactSnap.exists) throw new HttpsError('not-found', 'Contact not found.');
    const contact = contactSnap.data();
    if (!contact.email) throw new HttpsError('failed-precondition', 'Contact has no email address.');
    // Honors the same opt-out the campaign sender and the unsubscribe link
    // write. A 1-on-1 email to someone who unsubscribed is still a CAN-SPAM
    // problem, and it used to be the one path that ignored the flag.
    if (isEmailSuppressed(contact)) {
      throw new HttpsError('failed-precondition',
        'This contact has unsubscribed from email and cannot be emailed.');
    }

    const identity = await getCompanyEmailIdentity(db, companyId);

    let finalText = bodyText || htmlToText(bodyHtml);
    let finalHtml = bodyHtml || textToHtml(bodyText);
    if (identity.signature) {
      finalText = `${finalText}\n\n--\n${identity.signature}`;
      finalHtml = `${finalHtml}<br/><br/>--<br/>${textToHtml(identity.signature)}`;
    }

    // The thread this message belongs to. A brand-new send opens a thread
    // named after the email doc that starts it.
    const emailRef = contactRef.collection('emails').doc();
    const threadKey = threadKeyIn || emailRef.id;

    // Reply-To is the per-contact parse address when inbound is configured,
    // so the lead's reply comes back addressed to this exact contact. Without
    // it we fall back to the human mailbox and inbound matching is by sender
    // address alone.
    const replyAddress = replyAddressFor(companyId, contactId);

    let messageId = null;
    try {
      const headers = {};
      if (inReplyTo) {
        headers['In-Reply-To'] = inReplyTo;
        headers['References'] = inReplyTo;
      }
      const sent = await sendEmail({
        to: contact.email,
        from: { email: identity.fromEmail, name: identity.fromName },
        replyTo: replyAddress || identity.replyTo,
        subject,
        text: finalText,
        html: finalHtml,
        headers: Object.keys(headers).length ? headers : undefined,
        customArgs: {
          type: 'contact',
          companyId,
          contactId,
          emailId: emailRef.id
        }
      });
      messageId = sent.messageId;
    } catch (err) {
      console.error('[sendContactEmail] failed:', err && err.message);
      throw new HttpsError('internal', 'The email provider rejected the send: ' + ((err && err.message) || 'unknown'));
    }

    // Actor name lookup
    let actorName = (request.auth.token && request.auth.token.name) || null;
    if (!actorName) {
      try {
        const uSnap = await db.collection('users').doc(uid).get();
        if (uSnap.exists) actorName = uSnap.data().displayName || uSnap.data().email || null;
      } catch (e) {}
    }
    if (!actorName) actorName = (request.auth.token && request.auth.token.email) || 'Unknown';

    const bodyPreview = finalText.length > 200 ? finalText.slice(0, 200) + '…' : finalText;
    const desc = subject.length > 80 ? subject.slice(0, 80) + '…' : subject;

    const FV = admin.firestore.FieldValue;
    try {
      // The message itself. The timeline reads this collection, so the full
      // body lives here rather than being truncated into an activity row.
      await emailRef.set({
        direction: 'out',
        threadKey,
        subject,
        bodyText: finalText,
        bodyHtml: finalHtml,
        snippet: bodyPreview,
        fromEmail: identity.fromEmail,
        fromName: identity.fromName,
        toEmail: contact.email,
        replyTo: replyAddress || identity.replyTo,
        messageId,
        inReplyTo: inReplyTo || null,
        status: 'sent',
        read: true,
        sentByUid: uid,
        sentByName: actorName,
        createdAt: FV.serverTimestamp()
      });
      await contactRef.collection('activities').add({
        type: 'email_sent',
        description: desc,
        actorUid: uid,
        actorName,
        createdAt: FV.serverTimestamp(),
        meta: { subject, bodyPreview, messageId, emailId: emailRef.id, threadKey }
      });
      await contactRef.update({
        lastActivityAt: FV.serverTimestamp(),
        lastEmailAt: FV.serverTimestamp(),
        ...lastContactedFields('email', 'out'),
        updatedAt: FV.serverTimestamp()
      });
    } catch (e) {
      console.warn('[sendContactEmail] activity log failed:', e && e.message);
    }

    return { ok: true, messageId, emailId: emailRef.id, threadKey };
  }
);

// ────────────────────────────────────────────────────────────────
// markContactEmailsRead — callable
//
// Inbound email arrives unread so the contact card and the CRM list can badge
// it. Opening the card clears the badge. The unread flags live on documents
// the client cannot write (emails are Admin-SDK-only, so a forged "read" can't
// erase the record), hence a callable rather than a direct write.
// ────────────────────────────────────────────────────────────────
exports.markContactEmailsRead = onCall(async (request) => {
  const db = admin.firestore();
  const companyId = ((request.data || {}).companyId || '').toString().trim();
  const contactId = ((request.data || {}).contactId || '').toString().trim();
  if (!companyId || !contactId) throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
  await assertCompanyAdmin(db, companyId, request);

  const contactRef = db.collection('companies').doc(companyId).collection('contacts').doc(contactId);
  const unread = await contactRef.collection('emails').where('read', '==', false).limit(200).get();
  if (unread.empty) {
    await contactRef.set({ emailUnreadCount: 0 }, { merge: true });
    return { ok: true, cleared: 0 };
  }
  const batch = db.batch();
  unread.docs.forEach((d) => batch.set(d.ref, { read: true }, { merge: true }));
  batch.set(contactRef, { emailUnreadCount: 0 }, { merge: true });
  await batch.commit();
  return { ok: true, cleared: unread.size };
});


// ════════════════════════════════════════════════════════════════
// Inbound email — SendGrid Inbound Parse → the contact's card.
//
// The other half of two-way email. Outbound sets
// Reply-To: reply+<companyId>.<contactId>@<INBOUND_EMAIL_DOMAIN>, SendGrid
// receives the lead's reply on that subdomain's MX and POSTs it here, and the
// message lands on the contact record it came from — no address guessing, and
// it still works when the lead writes from a different address than the one
// on file.
//
// Setup (docs/email-setup.md): authenticate the1pnation.com in SendGrid, add
// an MX record for reply.the1pnation.com → mx.sendgrid.net (priority 10), and
// point an Inbound Parse host at
//   <functions base>/inboundEmailWebhook?key=<INBOUND_EMAIL_TOKEN>
// ════════════════════════════════════════════════════════════════

/**
 * Minimal multipart/form-data reader for the fields Inbound Parse sends.
 *
 * Deliberately dependency-free: adding busboy to pull four text fields out of
 * one webhook would put a parser in the deploy path of every other function in
 * this file. Attachment parts (anything with a filename) are skipped — the
 * CRM stores the message text, not the files.
 */
function parseMultipartFields(rawBody, contentType) {
  const out = {};
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundary = m && (m[1] || m[2]);
  if (!boundary || !rawBody) return out;

  const delim = Buffer.from('--' + boundary.trim());
  const parts = [];
  let idx = rawBody.indexOf(delim);
  while (idx !== -1) {
    const next = rawBody.indexOf(delim, idx + delim.length);
    if (next === -1) break;
    parts.push(rawBody.slice(idx + delim.length, next));
    idx = next;
  }

  for (const part of parts) {
    const sep = part.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    const head = part.slice(0, sep).toString('utf8');
    // Trailing CRLF belongs to the delimiter, not the value.
    let body = part.slice(sep + 4);
    if (body.slice(-2).toString() === '\r\n') body = body.slice(0, -2);
    const nameMatch = /name="([^"]*)"/i.exec(head);
    if (!nameMatch) continue;
    if (/filename="/i.test(head)) continue; // attachment
    out[nameMatch[1]] = body.toString('utf8');
  }
  return out;
}

/** "Anthony Brown <a@b.com>" → { name, email }. */
function parseAddress(raw) {
  const s = String(raw || '').trim();
  const angled = /<([^>]+)>/.exec(s);
  const email = (angled ? angled[1] : s).trim().toLowerCase();
  let name = angled ? s.slice(0, angled.index).trim() : '';
  name = name.replace(/^["']|["']$/g, '').trim();
  return { name: name || null, email: /.+@.+\..+/.test(email) ? email : null };
}

/**
 * reply+<companyId>.<contactId>@domain → { companyId, contactId }.
 * Scans every recipient because the parse address is often on Cc, or the
 * lead's client reordered To.
 */
function parseReplyRouting(recipients) {
  for (const raw of recipients) {
    const { email } = parseAddress(raw);
    if (!email) continue;
    const m = /^reply\+([^.@]+)\.([^.@]+)@/.exec(email);
    if (m) return { companyId: m[1], contactId: m[2] };
  }
  return null;
}

/**
 * Trim the quoted history off a reply so the timeline shows what the lead
 * actually wrote. Conservative on purpose: it only cuts at the well-known
 * client markers, and a message that has none is stored whole.
 */
function stripQuotedReply(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const markers = [
    /\n>?\s*On .{5,120} wrote:\s*\n/,        // Gmail / Apple Mail
    /\n-{2,}\s*Original Message\s*-{2,}/i,   // Outlook (plain)
    /\n_{10,}\n/,                            // Outlook (HTML → text)
    /\nFrom:\s.+\nSent:\s.+\n/,              // Outlook headers block
    /\nSent from my i(Phone|Pad)\n/i
  ];
  let cut = s.length;
  for (const re of markers) {
    const m = re.exec(s);
    if (m && m.index < cut) cut = m.index;
  }
  const trimmed = s.slice(0, cut).trim();
  return trimmed || s.trim();
}

exports.inboundEmailWebhook = onRequest(
  { cors: false, invoker: 'public', secrets: [sendgridKey] },
  async (req, res) => {
    // Fail closed. Inbound Parse does not sign its posts, so the shared token
    // in the URL is the only thing standing between this endpoint and anyone
    // forging a lead's reply into the CRM. Unconfigured means off, not open.
    const token = (process.env.INBOUND_EMAIL_TOKEN || '').trim();
    const supplied = String((req.query && req.query.key) || '').trim();
    if (!token) {
      console.warn('[inboundEmail] INBOUND_EMAIL_TOKEN not set — rejecting. See docs/email-setup.md');
      res.status(403).send('inbound email not configured');
      return;
    }
    const a = Buffer.from(supplied, 'utf8');
    const b = Buffer.from(token, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(403).send('forbidden');
      return;
    }
    if (req.method !== 'POST') { res.status(405).send('method not allowed'); return; }

    const db = admin.firestore();
    const FV = admin.firestore.FieldValue;

    try {
      const ct = req.get('content-type') || '';
      const fields = ct.includes('multipart/form-data')
        ? parseMultipartFields(req.rawBody ? Buffer.from(req.rawBody) : null, ct)
        : (req.body || {});

      const from = parseAddress(fields.from);
      const subject = String(fields.subject || '(no subject)').slice(0, 300);
      const textRaw = String(fields.text || '') || htmlToText(String(fields.html || ''));
      const bodyText = stripQuotedReply(textRaw).slice(0, 20000);
      if (!from.email) { res.status(200).send('ok'); return; }

      // Every address the message was addressed to, so the reply+ routing
      // token is found wherever the lead's client put it.
      const recipients = [];
      if (fields.to) recipients.push(...String(fields.to).split(','));
      if (fields.cc) recipients.push(...String(fields.cc).split(','));
      try {
        const env = JSON.parse(fields.envelope || '{}');
        if (Array.isArray(env.to)) recipients.push(...env.to);
      } catch (e) {}

      // In-Reply-To / Message-ID out of the raw header blob, for threading.
      const headerBlob = String(fields.headers || '');
      const midMatch = /^Message-ID:\s*(<[^>]+>)/im.exec(headerBlob);
      const irtMatch = /^In-Reply-To:\s*(<[^>]+>)/im.exec(headerBlob);
      const messageId = midMatch ? midMatch[1] : null;
      const inReplyTo = irtMatch ? irtMatch[1] : null;

      // 1) Routing token wins: it names the contact outright.
      let companyId = null;
      let contactRef = null;
      const routed = parseReplyRouting(recipients);
      if (routed) {
        const ref = db.collection('companies').doc(routed.companyId)
          .collection('contacts').doc(routed.contactId);
        const snap = await ref.get();
        if (snap.exists) { companyId = routed.companyId; contactRef = ref; }
      }

      // 2) Otherwise match the sender against the contacts of the academy
      // company — a lead who emails in cold, or replies from their phone's
      // other address, still reaches a card.
      if (!contactRef) {
        companyId = await resolveAcademyCompanyId(db);
        if (!companyId) { res.status(200).send('ok'); return; }
        const contactsRef = db.collection('companies').doc(companyId).collection('contacts');
        const q = await contactsRef.where('email', '==', from.email).limit(1).get();
        if (!q.empty) {
          contactRef = q.docs[0].ref;
        } else {
          const created = await contactsRef.add({
            name: from.name || from.email, email: from.email, phone: null, companyName: null,
            source: 'Email', stage: 'new', tags: [], ownerUid: null,
            createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
            createdBy: 'inbound-email', lastActivityAt: FV.serverTimestamp()
          });
          contactRef = created;
          await contactRef.collection('activities').add({
            type: 'contact_created', description: 'Created from an inbound email.',
            actorUid: 'inbound-email', actorName: from.email, createdAt: FV.serverTimestamp()
          });
        }
      }

      // Thread it onto the most recent outbound message to this contact when
      // the lead is replying to something we sent; otherwise it opens its own.
      const emailRef = contactRef.collection('emails').doc();
      let threadKey = emailRef.id;
      try {
        const recent = await contactRef.collection('emails')
          .orderBy('createdAt', 'desc').limit(1).get();
        if (!recent.empty) {
          const prev = recent.docs[0].data();
          const sameSubject = String(prev.subject || '').replace(/^(re|fwd):\s*/i, '').trim().toLowerCase()
            === subject.replace(/^(re|fwd):\s*/i, '').trim().toLowerCase();
          if (prev.threadKey && (sameSubject || (inReplyTo && prev.messageId && inReplyTo.includes(prev.messageId)))) {
            threadKey = prev.threadKey;
          }
        }
      } catch (e) { /* an unthreaded message is still a delivered message */ }

      await emailRef.set({
        direction: 'in',
        threadKey,
        subject,
        bodyText,
        // Stored for the record but never injected into the page: the
        // timeline renders bodyText escaped, so untrusted remote HTML has no
        // path to the DOM.
        bodyHtml: String(fields.html || '').slice(0, 100000) || null,
        snippet: bodyText.slice(0, 200),
        fromEmail: from.email,
        fromName: from.name,
        toEmail: (parseAddress(recipients[0]) || {}).email || null,
        messageId,
        inReplyTo,
        spamScore: fields.spam_score ? Number(fields.spam_score) : null,
        spf: fields.SPF || null,
        dkim: fields.dkim || null,
        status: 'received',
        read: false,
        createdAt: FV.serverTimestamp()
      });

      await contactRef.collection('activities').add({
        type: 'email_received',
        description: subject,
        actorUid: 'inbound-email',
        actorName: from.name || from.email,
        createdAt: FV.serverTimestamp(),
        meta: { subject, bodyPreview: bodyText.slice(0, 200), emailId: emailRef.id, threadKey }
      });

      await contactRef.set({
        lastActivityAt: FV.serverTimestamp(),
        lastEmailAt: FV.serverTimestamp(),
        ...lastContactedFields('email', 'in'),
        emailUnreadCount: FV.increment(1)
      }, { merge: true });

      // A reply is the lead engaging. Same rule as an inbound text: no
      // automated cadence should keep firing over a live conversation.
      try { await stopEnrollmentsForContact(db, companyId, contactRef.id, 'replied by email'); } catch (e) {}

      // Optional courtesy copy, so the CRM is not the only place the reply
      // exists and the mailbox owner still sees it on their phone.
      try {
        const identity = await getCompanyEmailIdentity(db, companyId);
        if (identity.forwardInboundTo) {
          await sendEmail({
            to: identity.forwardInboundTo,
            from: { email: identity.fromEmail, name: identity.fromName },
            replyTo: from.email,
            subject: `[CRM] ${subject}`,
            text: `From: ${from.name ? from.name + ' ' : ''}<${from.email}>\n`
              + `Contact: ${APP_BASE_URL}/contact.html?id=${contactRef.id}&compose=email\n\n${bodyText}`
          });
        }
      } catch (e) { console.warn('[inboundEmail] forward failed:', e && e.message); }
    } catch (e) {
      // Never 5xx: the parse webhook retries hard, and a retry storm on a bug
      // would replay the same message onto the card dozens of times.
      console.error('[inboundEmail]', e && e.message);
    }

    res.status(200).send('ok');
  }
);

// ────────────────────────────────────────────────────────────────
// Email unsubscribe (CAN-SPAM)
// ────────────────────────────────────────────────────────────────
//
// Every bulk email must carry a working one-click opt-out, and a contact who
// uses it must never be mailed again. Before this, /unsubscribe.html called a
// function that did not exist, campaign emails carried no opt-out link at all,
// and a SendGrid unsubscribe event only incremented a counter — the contact
// stayed on the list and was mailed again by the next campaign.
//
// The link carries a per-contact random token stored on the contact document,
// rather than an HMAC over a shared secret. It is equally unguessable, needs no
// new secret to be configured before it works, and can be rotated per contact.

/** Mint (once) and return a contact's unsubscribe token. */
async function ensureUnsubToken(contactRef, existing) {
  if (existing && typeof existing === 'string' && existing.length >= 24) return existing;
  const token = crypto.randomBytes(24).toString('hex');
  await contactRef.set({ unsubToken: token }, { merge: true });
  return token;
}

function unsubscribeUrl(companyId, contactId, token) {
  const q = new URLSearchParams({ c: companyId, id: contactId, t: token });
  return `${APP_BASE_URL}/unsubscribe.html?${q.toString()}`;
}

/**
 * unsubscribe — public HTTP endpoint behind /unsubscribe.html.
 *
 * Verifies the per-contact token, then suppresses the contact. Deliberately
 * never reveals whether a given contact or company exists: a bad token and a
 * missing contact both return the same `{ ok: false }`.
 */
exports.unsubscribe = onRequest({ cors: true }, async (req, res) => {
  const db = admin.firestore();
  const companyId = String(req.query.c || '').trim();
  const contactId = String(req.query.id || '').trim();
  const token = String(req.query.t || '').trim();

  const deny = () => res.status(200).json({ ok: false });
  if (!companyId || !contactId || !token) return deny();

  try {
    const ref = db.collection('companies').doc(companyId)
      .collection('contacts').doc(contactId);
    const snap = await ref.get();
    if (!snap.exists) return deny();

    const stored = (snap.data() || {}).unsubToken;
    // Constant-time compare so the endpoint cannot be used as an oracle.
    if (!stored || stored.length !== token.length
        || !crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(token))) {
      return deny();
    }

    const FV = admin.firestore.FieldValue;
    await ref.set({
      emailOptOut: true,
      emailOptOutAt: FV.serverTimestamp(),
      emailOptOutSource: 'unsubscribe-link',
      marketingConsent: false,
      tags: FV.arrayUnion('Unsubscribed'),
      updatedAt: FV.serverTimestamp(),
      lastActivityAt: FV.serverTimestamp()
    }, { merge: true });

    try {
      await ref.collection('activities').add({
        type: 'email_event',
        description: 'Unsubscribed from marketing email',
        actorUid: 'system',
        actorName: 'Unsubscribe link',
        createdAt: FV.serverTimestamp(),
        meta: { eventType: 'unsubscribe' }
      });
    } catch (e) { /* best-effort */ }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[unsubscribe] failed:', err && err.message);
    return res.status(200).json({ ok: false });
  }
});

/** Has this contact opted out of marketing email? */
function isEmailSuppressed(c) {
  return !!(c && (c.emailOptOut === true
    || (Array.isArray(c.tags) && c.tags.includes('Unsubscribed'))));
}

// ────────────────────────────────────────────────────────────────
// sendCampaign — callable
// ────────────────────────────────────────────────────────────────

async function buildRecipients(db, companyId, filter) {
  const mode = (filter && filter.mode) || 'all_contacts';
  const seen = new Set();
  const recipients = []; // { email, name?, firstName?, contactId?, unsubToken? }

  function push(email, name, contactId, unsubToken) {
    if (!email) return;
    const e = String(email).trim().toLowerCase();
    if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || seen.has(e)) return;
    seen.add(e);
    const firstName = name ? String(name).split(' ')[0] : '';
    recipients.push({
      email: e,
      name: name || '',
      firstName,
      contactId: contactId || null,
      unsubToken: unsubToken || null
    });
  }

  if (mode === 'all_users') {
    // Members of the company.
    const snap = await db.collection('companies').doc(companyId).collection('members').get();
    snap.docs.forEach((d) => {
      const m = d.data();
      push(m.email, m.displayName);
    });
    return recipients;
  }

  // Contact-based modes.
  const colRef = db.collection('companies').doc(companyId).collection('contacts');
  let rows = [];

  if (mode === 'stages' && Array.isArray(filter.stages) && filter.stages.length) {
    // Firestore `in` supports up to 10 values. Chunk.
    const chunks = [];
    for (let i = 0; i < filter.stages.length; i += 10) chunks.push(filter.stages.slice(i, i + 10));
    for (const chunk of chunks) {
      const snap = await colRef.where('stage', 'in', chunk).get();
      snap.docs.forEach((d) => rows.push({ id: d.id, ref: d.ref, data: d.data() }));
    }
  } else if (mode === 'tags' && Array.isArray(filter.tags) && filter.tags.length) {
    const chunks = [];
    for (let i = 0; i < filter.tags.length; i += 10) chunks.push(filter.tags.slice(i, i + 10));
    for (const chunk of chunks) {
      const snap = await colRef.where('tags', 'array-contains-any', chunk).get();
      snap.docs.forEach((d) => rows.push({ id: d.id, ref: d.ref, data: d.data() }));
    }
  } else if (mode === 'owner' && filter.ownerUid) {
    const snap = await colRef.where('ownerUid', '==', filter.ownerUid).get();
    snap.docs.forEach((d) => rows.push({ id: d.id, ref: d.ref, data: d.data() }));
  } else {
    // all_contacts
    const snap = await colRef.get();
    snap.docs.forEach((d) => rows.push({ id: d.id, ref: d.ref, data: d.data() }));
  }

  // Drop anyone who has opted out, then mint an unsubscribe token for the
  // rest so the send can put a working opt-out link in the message. Without
  // this filter a contact who unsubscribed was mailed again by the very next
  // campaign.
  for (const row of rows) {
    const c = row.data || {};
    if (isEmailSuppressed(c)) continue;
    let token = null;
    try { token = await ensureUnsubToken(row.ref, c.unsubToken); }
    catch (e) { /* a contact with no token still gets the generic footer */ }
    push(c.email, c.name, row.id, token);
  }
  return recipients;
}

exports.sendCampaign = onCall(
  { secrets: [sendgridKey], timeoutSeconds: 540 },
  async (request) => {
    const db = admin.firestore();
    const data = request.data || {};
    const companyId = (data.companyId || '').toString().trim();
    const campaignId = (data.campaignId || '').toString().trim();
    if (!companyId || !campaignId) throw new HttpsError('invalid-argument', 'companyId and campaignId are required.');

    await assertCompanyAdmin(db, companyId, request);

    // Throttle broadcast sends: 10 campaign dispatches per admin per hour.
    await rateLimitCaller(db, request, { action: 'sendCampaign', max: 10, windowSec: 3600 });

    const campaignRef = db.collection('companies').doc(companyId).collection('campaigns').doc(campaignId);
    const campaignSnap = await campaignRef.get();
    if (!campaignSnap.exists) throw new HttpsError('not-found', 'Campaign not found.');
    const campaign = campaignSnap.data();
    const status = campaign.status || 'draft';
    if (!['draft', 'ready'].includes(status)) {
      throw new HttpsError('failed-precondition', `Cannot send a campaign with status "${status}".`);
    }

    const subject = (campaign.subject || '').toString().trim();
    if (!subject) throw new HttpsError('invalid-argument', 'Campaign has no subject.');
    const bodyText = campaign.bodyText || '';
    const bodyHtml = campaign.bodyHtml || textToHtml(bodyText);
    const finalText = bodyText || htmlToText(bodyHtml);
    const fromName = campaign.fromName || FROM_NAME_DEFAULT;

    await campaignRef.update({
      status: 'sending',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    let recipients = [];
    try {
      recipients = await buildRecipients(db, companyId, campaign.recipientFilter || { mode: 'all_contacts' });
    } catch (err) {
      await campaignRef.update({
        status: 'failed',
        errorSample: [String((err && err.message) || err).slice(0, 300)],
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      throw new HttpsError('internal', 'Could not build recipient list: ' + ((err && err.message) || 'unknown'));
    }

    if (!recipients.length) {
      await campaignRef.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        recipientCount: 0,
        acceptedCount: 0,
        failedCount: 0,
        errorSample: [],
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return { ok: true, recipientCount: 0, acceptedCount: 0, failedCount: 0 };
    }

    let accepted = 0;
    let failed = 0;
    const errorSample = [];

    // Chunk into batches of 1000.
    const BATCH_SIZE = 1000;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      const perRecipient = chunk.map((r) => {
        const personalizedSubject = subject.replace(/\{\{\s*firstName\s*\}\}/g, r.firstName || '');
        // Per-recipient opt-out. A contact row carries a token; a company
        // member (all_users mode) has no contact doc, so they fall back to the
        // mailto opt-out, which is an equally valid CAN-SPAM mechanism.
        const link = (r.contactId && r.unsubToken)
          ? unsubscribeUrl(companyId, r.contactId, r.unsubToken)
          : `mailto:${REPLY_TO}?subject=Unsubscribe`;
        return {
          email: r.email,
          name: r.name || undefined,
          subject: personalizedSubject,
          // The key is unwrapped: the wrappers below turn it into
          // -unsubscribe_url-, matching the placeholder in the body.
          substitutions: { unsubscribe_url: link },
          headers: {
            // One-click opt-out for mail clients that surface it.
            'List-Unsubscribe': `<${link}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
          },
          customArgs: {
            type: 'campaign',
            companyId,
            campaignId,
            recipientEmail: r.email
          }
        };
      });

      // Required footer. Bulk mail must carry a working opt-out and a postal
      // identity; the campaign body alone carried neither.
      const htmlPersonalized = `${bodyHtml}
<hr style="margin:28px 0 14px;border:none;border-top:1px solid #ddd;">
<p style="font-size:12px;color:#777;line-height:1.6;">
  You are receiving this because you signed up with The One Percent Nation.<br>
  <a href="-unsubscribe_url-" style="color:#777;">Unsubscribe from these emails</a>.
</p>`;
      const textPersonalized = `${finalText}

—
You are receiving this because you signed up with The One Percent Nation.
Unsubscribe: -unsubscribe_url-`;

      const res = await sendEmailBatch({
        from: { email: FROM_EMAIL, name: fromName },
        replyTo: REPLY_TO,
        subject, // fallback; each recipient carries its own
        text: textPersonalized,
        html: htmlPersonalized,
        recipients: perRecipient,
        substitutionWrappers: ['-', '-'],
        customArgs: {
          type: 'campaign',
          companyId,
          campaignId
        }
      });
      accepted += res.accepted;
      failed += res.failed;
      for (const e of res.errors) {
        if (errorSample.length < 5) errorSample.push(e);
        console.error('[sendCampaign] batch send failed:', e);
      }
    }

    await campaignRef.update({
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      recipientCount: recipients.length,
      acceptedCount: accepted,
      failedCount: failed,
      errorSample,
      stats: {
        delivered: admin.firestore.FieldValue.increment(0),
        opens: admin.firestore.FieldValue.increment(0),
        clicks: admin.firestore.FieldValue.increment(0),
        bounces: admin.firestore.FieldValue.increment(0),
        unsubs: admin.firestore.FieldValue.increment(0)
      }
    });

    // Initialize stats if they don't exist.
    try {
      const latest = (await campaignRef.get()).data() || {};
      if (!latest.stats || typeof latest.stats !== 'object' || Object.keys(latest.stats).length === 0) {
        await campaignRef.update({
          stats: { delivered: 0, opens: 0, clicks: 0, bounces: 0, unsubs: 0 }
        });
      }
    } catch (e) {}

    return { ok: true, recipientCount: recipients.length, acceptedCount: accepted, failedCount: failed };
  }
);

// ────────────────────────────────────────────────────────────────
// shareEventToContacts — callable. Emails a community event to CRM
// contacts (or company members) using the same recipient-filter modes
// as sendCampaign. Reads the event from the top-level events/ collection.
// ────────────────────────────────────────────────────────────────

function eventEmail(event, baseUrl, customMessage) {
  const title = (event.title || 'Event').toString();
  const toDate = (t) => (t && typeof t.toDate === 'function') ? t.toDate() : (t ? new Date(t) : null);
  const start = toDate(event.startsAt);
  const end = toDate(event.endsAt);
  let when = 'Date to be announced';
  if (start && !isNaN(start.getTime())) {
    const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
    when = start.toLocaleString('en-US', opts);
    if (end && !isNaN(end.getTime())) {
      const sameDay = end.toDateString() === start.toDateString();
      when += ' – ' + (sameDay
        ? end.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        : end.toLocaleString('en-US', opts));
    }
  }
  const esc = (s) => textToHtml(s);
  const link = event.link || `${baseUrl}/events`;
  const ctaLabel = event.link ? 'Join the event' : 'View event details';

  const textParts = [];
  if (customMessage) textParts.push(customMessage, '');
  textParts.push(`You're invited: ${title}`, '', when);
  if (event.location) textParts.push(`Location: ${event.location}`);
  if (event.hostName) textParts.push(`Hosted by ${event.hostName}`);
  if (event.description) textParts.push('', event.description);
  textParts.push('', `${ctaLabel}: ${link}`);
  const text = textParts.join('\n');

  const img = event.imageUrl
    ? `<img src="${event.imageUrl}" alt="" style="width:100%;max-width:560px;border-radius:10px;display:block;margin:0 0 20px;" />`
    : '';
  const customHtml = customMessage ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">${esc(customMessage)}</p>` : '';
  const descHtml = event.description ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#444;">${esc(event.description)}</p>` : '';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;padding:8px;">
      <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#cc1b1b;margin:0 0 6px;">You're invited</p>
      ${customHtml}
      ${img}
      <h1 style="font-size:22px;margin:0 0 12px;color:#111;">${esc(title)}</h1>
      <p style="margin:0 0 6px;font-size:15px;color:#222;">🗓️ ${esc(when)}</p>
      ${event.location ? `<p style="margin:0 0 6px;font-size:15px;color:#222;">📍 ${esc(event.location)}</p>` : ''}
      ${event.hostName ? `<p style="margin:0 0 6px;font-size:14px;color:#666;">Hosted by ${esc(event.hostName)}</p>` : ''}
      ${descHtml}
      <p style="margin:24px 0 0;">
        <a href="${link}" style="background:#cc1b1b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block;">${ctaLabel} →</a>
      </p>
    </div>
  `;
  return { subject: `You're invited: ${title}`, text, html };
}

exports.shareEventToContacts = onCall(
  { secrets: [sendgridKey], timeoutSeconds: 540 },
  async (request) => {
    const db = admin.firestore();
    const data = request.data || {};
    const companyId = (data.companyId || '').toString().trim();
    const eventId = (data.eventId || '').toString().trim();
    const customMessage = (data.message || '').toString().slice(0, 1000);
    const recipientFilter = data.recipientFilter || { mode: 'all_contacts' };
    if (!companyId || !eventId) throw new HttpsError('invalid-argument', 'companyId and eventId are required.');

    await assertCompanyAdmin(db, companyId, request);

    const eventSnap = await db.collection('events').doc(eventId).get();
    if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
    const event = eventSnap.data();

    let recipients = [];
    try {
      recipients = await buildRecipients(db, companyId, recipientFilter);
    } catch (err) {
      throw new HttpsError('internal', 'Could not build recipient list: ' + ((err && err.message) || 'unknown'));
    }
    if (!recipients.length) return { ok: true, recipientCount: 0, acceptedCount: 0, failedCount: 0 };

    const { subject, text, html } = eventEmail(event, APP_BASE_URL, customMessage);

    let accepted = 0;
    let failed = 0;
    const errorSample = [];
    const BATCH_SIZE = 1000;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      const res = await sendEmailBatch({
        from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
        replyTo: REPLY_TO,
        subject,
        text,
        html,
        recipients: chunk.map((r) => ({
          email: r.email,
          name: r.name || undefined,
          customArgs: { type: 'event', companyId, eventId, recipientEmail: r.email }
        })),
        customArgs: { type: 'event', companyId, eventId }
      });
      accepted += res.accepted;
      failed += res.failed;
      for (const e of res.errors) {
        if (errorSample.length < 5) errorSample.push(e);
        console.error('[shareEventToContacts] batch send failed:', e);
      }
    }

    return { ok: true, recipientCount: recipients.length, acceptedCount: accepted, failedCount: failed, errorSample };
  }
);

// ────────────────────────────────────────────────────────────────
// registerForEvent — callable (public, unauthenticated allowed). Records an
// event registration, upserts a CRM contact (source: Event), mirrors to the
// member's account when signed in, and bumps the event's registrationCount.
// ────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function resolveEventCompanyId(db, event) {
  if (event.companyId) return event.companyId;
  const ownerUid = event.createdByUid || event.hostUid || null;
  if (ownerUid) {
    try {
      const uSnap = await db.collection('users').doc(ownerUid).get();
      if (uSnap.exists && uSnap.data().companyId) return uSnap.data().companyId;
    } catch (e) {}
    try {
      const snap = await db.collection('companies').where('adminUids', 'array-contains', ownerUid).limit(1).get();
      if (!snap.empty) return snap.docs[0].id;
    } catch (e) {}
  }
  return null;
}

async function upsertEventContact(db, companyId, event, name, email, ownerUid, extra) {
  const colRef = db.collection('companies').doc(companyId).collection('contacts');
  const tag = (event.title || '').toString().slice(0, 40);
  const phone = (extra && extra.phone) || null;
  const address = (extra && extra.address) || null;
  let contactRef = null;
  try {
    const snap = await colRef.where('email', '==', email).limit(1).get();
    if (!snap.empty) contactRef = snap.docs[0].ref;
  } catch (e) {}

  if (contactRef) {
    const patch = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (phone) patch.phone = phone;
    if (address) patch.address = address;
    if (tag) patch.tags = admin.firestore.FieldValue.arrayUnion(tag);
    await contactRef.set(patch, { merge: true });
  } else {
    contactRef = await colRef.add({
      name: name || 'Unnamed contact',
      email,
      phone: phone,
      address: address,
      companyName: null,
      source: 'Event',
      stage: 'new',
      tags: tag ? [tag] : [],
      ownerUid: ownerUid || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'system',
      lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }

  try {
    const notes = (extra && extra.notes) || null;
    await contactRef.collection('activities').add({
      type: 'event_registration',
      description: `Registered for "${(event.title || 'event').toString().slice(0, 80)}"` + (notes ? ` — Note: ${notes.slice(0, 200)}` : ''),
      actorUid: 'system',
      actorName: 'Event registration',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      meta: { eventId: event.id || null, eventTitle: event.title || null, phone: phone || null, address: address || null, notes: notes || null }
    });
  } catch (e) {}
}

exports.registerForEvent = onCall(async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const eventId = (data.eventId || '').toString().trim();
  const name = (data.name || '').toString().trim().slice(0, 120);
  const email = (data.email || '').toString().trim().toLowerCase().slice(0, 200);
  const phone = (data.phone || '').toString().trim().slice(0, 40);
  const address = (data.address || '').toString().trim().slice(0, 240);
  const notes = (data.notes || '').toString().trim().slice(0, 800);

  if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
  if (!name) throw new HttpsError('invalid-argument', 'Please enter your name.');
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email.');

  const uid = (request.auth && request.auth.uid) || null;

  const eventRef = db.collection('events').doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError('not-found', 'Event not found.');
  const event = { id: eventId, ...eventSnap.data() };

  // Dedup key: uid for members, hashed email for the public.
  const regId = uid || ('e_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 24));
  const regRef = eventRef.collection('registrations').doc(regId);
  const existing = await regRef.get();
  const alreadyRegistered = existing.exists;

  await regRef.set({
    name,
    email,
    phone: phone || null,
    address: address || null,
    notes: notes || null,
    uid: uid || null,
    source: uid ? 'member' : 'public',
    registeredAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  if (!alreadyRegistered) {
    try { await eventRef.set({ registrationCount: admin.firestore.FieldValue.increment(1) }, { merge: true }); } catch (e) {}
  }

  // Upsert into the CRM (best-effort — registration still succeeds if no company).
  try {
    const companyId = await resolveEventCompanyId(db, event);
    if (companyId) {
      await upsertEventContact(db, companyId, event, name, email, event.createdByUid || event.hostUid || null, { phone, address, notes });
    }
  } catch (e) {
    console.warn('[registerForEvent] CRM upsert failed:', e && e.message);
  }

  // Gated join link: the real Zoom URL lives in events/{id}/private/join
  // (admin-only by rules). Registering is what earns it — it's returned from
  // this call and, for members, stamped onto their registrations mirror so
  // the events page and dashboard can show a Join button later.
  let joinUrl = null;
  try {
    const joinSnap = await eventRef.collection('private').doc('join').get();
    if (joinSnap.exists) joinUrl = joinSnap.data().joinUrl || null;
  } catch (e) {}

  // Mirror to the member's account so they see it as "Registered".
  if (uid) {
    try {
      await db.collection('users').doc(uid).collection('registrations').doc(eventId).set({
        eventId,
        title: event.title || null,
        startsAt: event.startsAt || null,
        ...(joinUrl ? { joinUrl } : {}),
        registeredAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) {}
  }

  let registrationCount = null;
  try { registrationCount = (await eventRef.get()).data().registrationCount || null; } catch (e) {}

  return { ok: true, alreadyRegistered, registrationCount, joinUrl };
});

// ────────────────────────────────────────────────────────────────
// Course interest + member onboarding → CRM
//
// Both callables upsert the caller into the academy's CRM (the owner's
// company) so admins/owners can see who signed up and what they want.
// They run with the Admin SDK, so they bypass Firestore rules — members
// never get direct write access to the contacts collection.
// ────────────────────────────────────────────────────────────────

// Resolve the academy's company (the owner's). Cached per cold start.
let _academyCompanyIdCache = null;
async function resolveAcademyCompanyId(db) {
  if (_academyCompanyIdCache) return _academyCompanyIdCache;
  // 1) Find the owner user, prefer their companyId.
  try {
    const snap = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
    if (!snap.empty) {
      const owner = snap.docs[0];
      const cid = owner.data().companyId;
      if (cid) { _academyCompanyIdCache = cid; return cid; }
      // 2) Else a company the owner administers.
      const cSnap = await db.collection('companies').where('adminUids', 'array-contains', owner.id).limit(1).get();
      if (!cSnap.empty) { _academyCompanyIdCache = cSnap.docs[0].id; return cSnap.docs[0].id; }
    }
  } catch (e) { console.warn('[resolveAcademyCompanyId]', e && e.message); }
  // 3) Fallback: the first company that exists. Deliberately NOT cached:
  // every new member is routed through this resolver, and pinning a partner
  // company here for the life of the instance would send signups into the
  // wrong CRM until the next cold start, even after the owner's company is
  // linked.
  try {
    const any = await db.collection('companies').limit(1).get();
    if (!any.empty) {
      console.warn(`[resolveAcademyCompanyId] owner has no company; falling back to ${any.docs[0].id}`);
      return any.docs[0].id;
    }
  } catch (e) {}
  return null;
}

// Source-based lead routing. config/leadRouting maps a lead source key to a
// company id (e.g. { "financial-services": "<partner company id>" }) so
// partner verticals get their leads in their own CRM tenant. Anything
// unmapped falls through to the academy company.
async function resolveCompanyForSource(db, sourceKey) {
  if (sourceKey) {
    try {
      const snap = await db.collection('config').doc('leadRouting').get();
      const cid = snap.exists ? snap.data()[sourceKey] : null;
      if (cid) {
        const company = await db.collection('companies').doc(cid).get();
        if (company.exists) return cid;
      }
    } catch (e) { console.warn('[resolveCompanyForSource]', e && e.message); }
  }
  return resolveAcademyCompanyId(db);
}

// Find-or-create a contact by email, merge fields, and return its ref.
//
// `contactId` is an optional hint (users/{uid}.crmContactId) that skips the
// email lookup when the member is already linked to a contact. `memberUid`
// links the contact back to the member-portal account so the CRM can tell a
// signed-up member from a plain lead. Neither `source` nor `stage` is
// overwritten on an existing contact: a lead who came in from a form and
// later creates an account keeps its original attribution.
async function upsertCrmContact(db, companyId, { name, email, phone, address, companyName, source, tags, contactId, memberUid }) {
  const colRef = db.collection('companies').doc(companyId).collection('contacts');
  const FV = admin.firestore.FieldValue;
  let ref = null;
  if (contactId) {
    try {
      const hinted = await colRef.doc(String(contactId)).get();
      if (hinted.exists) ref = hinted.ref;
    } catch (e) {}
  }
  if (!ref) {
    try {
      const snap = await colRef.where('email', '==', email).limit(1).get();
      if (!snap.empty) ref = snap.docs[0].ref;
    } catch (e) {}
  }

  if (ref) {
    const patch = { updatedAt: FV.serverTimestamp(), lastActivityAt: FV.serverTimestamp() };
    if (name) patch.name = name;
    if (phone) patch.phone = phone;
    if (address) patch.address = address;
    if (companyName) patch.companyName = companyName;
    if (memberUid) patch.memberUid = memberUid;
    if (tags && tags.length) patch.tags = FV.arrayUnion(...tags);
    await ref.set(patch, { merge: true });
  } else {
    ref = await colRef.add({
      name: name || 'Member',
      email,
      phone: phone || null,
      address: address || null,
      companyName: companyName || null,
      source: source || 'Member',
      stage: 'new',
      tags: tags || [],
      ownerUid: null,
      memberUid: memberUid || null,
      createdAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp(),
      createdBy: 'system',
      lastActivityAt: FV.serverTimestamp()
    });
  }
  return ref;
}

// ────────────────────────────────────────────────────────────────
// New member pipeline: users/{uid} created → CRM contact + welcome email
// ────────────────────────────────────────────────────────────────
// Every account that lands in users/{uid} (email signup, Google sign-in, or
// an invite) is mirrored into the academy CRM immediately and sent the
// welcome email. Both steps are idempotent and record their outcome on the
// user doc (crmContactId / crmCompanyId, welcomeEmailStatus) so a step that
// failed at signup can be retried from submitOnboarding or from the owner's
// "Sync members to CRM" tool without creating a duplicate contact or sending
// the welcome twice. The user-doc fields they write are frozen in
// firestore.rules so a member cannot point crmContactId at someone else's
// contact.

async function syncMemberToCrm(db, uid, user, { source, activity } = {}) {
  const email = normalizeEmail(user && user.email);
  if (!EMAIL_RE.test(email)) return null;
  // The owner is the CRM, not a contact in it.
  if (email === OWNER_EMAIL) return null;
  const companyId = await resolveAcademyCompanyId(db);
  if (!companyId) {
    console.warn(`[syncMemberToCrm] no academy company yet; skipping ${email}`);
    return null;
  }
  const FV = admin.firestore.FieldValue;
  const ref = await upsertCrmContact(db, companyId, {
    name: user.displayName || null,
    email,
    phone: user.phone || null,
    address: user.address || null,
    companyName: user.company || null,
    source: source || 'Member Signup',
    tags: ['Member'],
    contactId: user.crmCompanyId === companyId ? user.crmContactId : null,
    memberUid: uid
  });
  if (activity) {
    await ref.collection('activities').add({
      type: activity.type || 'member_signup',
      description: activity.description || 'Created a member-portal account',
      actorUid: 'system',
      actorName: activity.actorName || 'Member portal',
      createdAt: FV.serverTimestamp(),
      meta: Object.assign({ uid }, activity.meta || {})
    });
  }
  await db.collection('users').doc(uid).set({
    crmCompanyId: companyId,
    crmContactId: ref.id,
    crmSyncedAt: FV.serverTimestamp()
  }, { merge: true });
  return { companyId, contactId: ref.id, ref };
}

function welcomeEmailContent({ firstName, companyName }) {
  const name = firstName || 'there';
  // Names and company names are member/admin supplied: escape before they
  // land in the HTML part.
  const nameHtml = textToHtml(name);
  const companyHtml = textToHtml(companyName);
  const openingHtml = companyName
    ? `You're now part of <strong>${companyHtml}</strong> inside The One Percent Academy.`
    : `Your One Percent Academy account is ready.`;
  const openingText = companyName
    ? `You're now part of ${companyName} inside The One Percent Academy.`
    : `Your One Percent Academy account is ready.`;
  const onboardingUrl = `${APP_BASE_URL}/onboarding.html`;
  const communityUrl = `${APP_BASE_URL}/community.html`;
  const coursesUrl = `${APP_BASE_URL}/courses.html`;

  const subject = firstName
    ? `Welcome to The One Percent Academy, ${firstName}`
    : 'Welcome to The One Percent Academy';
  const text =
    `Hi ${name},\n\n` +
    `${openingText}\n\n` +
    `Success without alignment is the tension we work on here. Every tool inside the Academy is built to help you get clear on what you're building and why, and then move on it one intentional step at a time.\n\n` +
    `Your first step takes two minutes: finish your profile so we know who you are and what you're working toward.\n${onboardingUrl}\n\n` +
    `Then choose where you start:\n` +
    `Community: ${communityUrl}\n` +
    `Courses: ${coursesUrl}\n\n` +
    `Become one percent better every day. It starts with one clear step.\n\n` +
    `Anthony Brown Sr.\n` +
    `Founder, The One Percent Nation\n` +
    `Redefining Success. Realigning Purpose. Releasing Potential.`;

  const btn = (href, label, bg) =>
    `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;margin:0 8px 8px 0;">${label}</a>`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;line-height:1.55;">
      <h2 style="color:#000;margin:0 0 12px;font-size:22px;">Welcome, ${nameHtml}.</h2>
      <p style="margin:0 0 14px;">${openingHtml}</p>
      <p style="margin:0 0 14px;">Success without alignment is the tension we work on here. Every tool inside the Academy is built to help you get clear on what you're building and why, and then move on it one intentional step at a time.</p>
      <p style="margin:0 0 10px;"><strong>Your first step takes two minutes.</strong> Finish your profile so we know who you are and what you're working toward.</p>
      <p style="margin:0 0 22px;">${btn(onboardingUrl, 'Complete your profile', '#e60306')}</p>
      <p style="margin:0 0 10px;">Then choose where you start:</p>
      <p style="margin:0 0 22px;">${btn(communityUrl, 'Community', '#000')}${btn(coursesUrl, 'Courses', '#000')}</p>
      <p style="margin:0 0 20px;">Become one percent better every day. It starts with one clear step.</p>
      <p style="margin:0;">Anthony Brown Sr.<br/>Founder, The One Percent Nation</p>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;"/>
      <p style="color:#888;font-size:11px;margin:0;">Redefining Success. Realigning Purpose. Releasing Potential.</p>
    </div>`;

  return { subject, text, html };
}

// Sends the welcome email exactly once per member. Claims the send in a
// transaction (welcomeEmailStatus: 'sending') so a trigger and a callable
// racing on the same user cannot both send; a claim older than 10 minutes is
// treated as abandoned (function crashed mid-send) and may be retried.
// Records the outcome on users/{uid} and, when the member is linked to a CRM
// contact, on that contact's activity timeline. Never throws.
async function sendWelcomeEmail(db, uid, user, { crm } = {}) {
  const email = normalizeEmail(user && user.email);
  if (!EMAIL_RE.test(email)) return { status: 'skipped', reason: 'no-email' };
  const userRef = db.collection('users').doc(uid);
  const FV = admin.firestore.FieldValue;

  let claimed = false;
  try {
    claimed = await db.runTransaction(async (tx) => {
      const s = await tx.get(userRef);
      const d = s.exists ? (s.data() || {}) : {};
      if (d.welcomeEmailStatus === 'sent') return false;
      if (d.welcomeEmailStatus === 'sending') {
        const at = d.welcomeEmailAttemptedAt && typeof d.welcomeEmailAttemptedAt.toMillis === 'function'
          ? d.welcomeEmailAttemptedAt.toMillis() : 0;
        if (Date.now() - at < 10 * 60 * 1000) return false;
      }
      tx.set(userRef, {
        welcomeEmailStatus: 'sending',
        welcomeEmailAttemptedAt: FV.serverTimestamp()
      }, { merge: true });
      return true;
    });
  } catch (e) {
    console.error('[sendWelcomeEmail] claim failed:', e && e.message);
    return { status: 'failed', error: e && e.message };
  }
  if (!claimed) return { status: 'skipped', reason: 'already-sent' };

  try {
    let companyName = null;
    if (user.companyId) {
      try {
        const cSnap = await db.collection('companies').doc(user.companyId).get();
        if (cSnap.exists) companyName = cSnap.data().name || null;
      } catch (e) {}
    }
    const firstName = (user.displayName || '').trim().split(/\s+/)[0] || '';
    const { subject, text, html } = welcomeEmailContent({ firstName, companyName });

    // companyId + contactId (without campaignId) route delivery, open and
    // click events onto the CRM contact's timeline via the provider webhook.
    const customArgs = { type: 'welcome', uid };
    if (crm && crm.companyId && crm.contactId) {
      customArgs.companyId = crm.companyId;
      customArgs.contactId = crm.contactId;
    }

    const { messageId } = await sendEmail({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
      replyTo: REPLY_TO,
      subject,
      text,
      html,
      customArgs
    });

    await userRef.set({
      welcomeEmailStatus: 'sent',
      welcomeEmailSentAt: FV.serverTimestamp(),
      welcomeEmailMessageId: messageId,
      welcomeEmailError: FV.delete()
    }, { merge: true });

    if (crm && crm.ref) {
      try {
        await crm.ref.collection('activities').add({
          type: 'email_sent',
          description: `Welcome email sent: "${subject}"`,
          actorUid: 'system',
          actorName: 'Member portal',
          createdAt: FV.serverTimestamp(),
          meta: { uid, messageId, subject }
        });
      } catch (e) {}
    }
    return { status: 'sent', messageId };
  } catch (err) {
    const message = String((err && err.message) || err).slice(0, 500);
    console.error('[sendWelcomeEmail] send failed:', message);
    try {
      await userRef.set({ welcomeEmailStatus: 'failed', welcomeEmailError: message }, { merge: true });
    } catch (e2) {}
    return { status: 'failed', error: message };
  }
}

// registerCourseInterest({ slug, title }) — member taps "Notify me when live".
exports.registerCourseInterest = onCall(async (request) => {
  const db = admin.firestore();
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const slug = (data.slug || '').toString().trim().slice(0, 80);
  const title = (data.title || '').toString().trim().slice(0, 120) || slug;
  if (!slug) throw new HttpsError('invalid-argument', 'A course slug is required.');

  const userSnap = await db.collection('users').doc(uid).get();
  const u = userSnap.exists ? userSnap.data() : {};
  const email = (u.email || (request.auth.token && request.auth.token.email) || '').toString().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpsError('failed-precondition', 'Your account has no valid email.');

  const FV = admin.firestore.FieldValue;

  // Mirror to the member's own account (dedupes the button + lets them see it).
  await db.collection('users').doc(uid).collection('courseInterests').doc(slug).set({
    slug, title, createdAt: FV.serverTimestamp()
  }, { merge: true });

  // Upsert into the CRM (best-effort).
  try {
    const companyId = await resolveAcademyCompanyId(db);
    if (companyId) {
      const ref = await upsertCrmContact(db, companyId, {
        name: u.displayName || null,
        email,
        phone: u.phone || null,
        address: u.address || null,
        companyName: u.company || null,
        source: 'Course Interest',
        tags: [`Waitlist: ${title}`.slice(0, 40)]
      });
      await ref.collection('activities').add({
        type: 'course_interest',
        description: `Joined the waitlist for "${title}"`,
        actorUid: 'system',
        actorName: 'Course waitlist',
        createdAt: FV.serverTimestamp(),
        meta: { courseSlug: slug, courseTitle: title }
      });
    }
  } catch (e) {
    console.warn('[registerCourseInterest] CRM upsert failed:', e && e.message);
  }

  return { ok: true, slug };
});

// submitOnboarding({ displayName, phone, address, company, industry, location, goals })
// Required after member-portal signup. Updates the user profile and upserts
// the member into the CRM with everything they entered. Also the safety net
// for the signup pipeline: if onUserCreated failed to link the CRM contact
// or send the welcome email, both are retried here.
exports.submitOnboarding = onCall({ secrets: [sendgridKey] }, async (request) => {
  const db = admin.firestore();
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const s = (v, n) => (v || '').toString().trim().slice(0, n);
  const displayName = s(data.displayName, 120);
  const phone = s(data.phone, 40);
  const address = s(data.address, 240);
  const company = s(data.company, 120);
  const industry = s(data.industry, 80);
  const location = s(data.location, 120);
  const goals = s(data.goals, 1000);
  const marketingConsent = data.marketingConsent === true;
  const consentText = s(data.consentText, 1000);

  if (!displayName) throw new HttpsError('invalid-argument', 'Please enter your name.');
  if (!phone) throw new HttpsError('invalid-argument', 'Please enter a phone number.');

  const FV = admin.firestore.FieldValue;
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const u = userSnap.exists ? userSnap.data() : {};
  const email = (u.email || (request.auth.token && request.auth.token.email) || '').toString().toLowerCase();

  // 1) Update the member's profile doc + flip the onboarding gate.
  // Record the marketing/communications consent as a durable proof-of-opt-in:
  // the boolean, the timestamp, and the exact wording the member agreed to.
  const profilePatch = {
    displayName: displayName || u.displayName || null,
    phone, address, company, industry, location,
    communityGoals: goals,
    marketingConsent,
    onboardingComplete: true,
    onboardingAt: FV.serverTimestamp(),
    lastActiveAt: FV.serverTimestamp()
  };
  if (marketingConsent) {
    profilePatch.marketingConsentAt = FV.serverTimestamp();
    if (consentText) profilePatch.marketingConsentText = consentText;
  }
  await userRef.set(profilePatch, { merge: true });

  // 1b) First completion activates any referral that brought this member in.
  // Points land here rather than at signup so a referrer is paid for members
  // who actually show up, not for addresses that were typed into a form.
  // Never allowed to block onboarding.
  if (u.onboardingComplete !== true) {
    try {
      await creditReferralOnActivation(db, uid, u);
    } catch (e) {
      console.warn('[submitOnboarding] referral credit skipped:', e && e.message);
    }
  }

  // 2) Upsert into the CRM (best-effort).
  let crm = null;
  try {
    const companyId = await resolveAcademyCompanyId(db);
    if (companyId && EMAIL_RE.test(email)) {
      const ref = await upsertCrmContact(db, companyId, {
        name: displayName,
        email,
        phone,
        address,
        companyName: company,
        source: 'Member Signup',
        tags: [
          'Member',
          industry ? `Industry: ${industry}`.slice(0, 40) : null,
          marketingConsent ? 'Opt-In: Calls/SMS/Email' : null
        ].filter(Boolean),
        // Reuse the contact onUserCreated linked so a lead-form contact and
        // a member never split into two records.
        contactId: u.crmCompanyId === companyId ? u.crmContactId : null,
        memberUid: uid
      });
      crm = { companyId, contactId: ref.id, ref };
      await userRef.set({
        crmCompanyId: companyId,
        crmContactId: ref.id,
        crmSyncedAt: FV.serverTimestamp()
      }, { merge: true });
      // Persist consent flags on the contact for filtering/segmenting.
      await ref.set({
        marketingConsent,
        marketingConsentAt: marketingConsent ? FV.serverTimestamp() : null,
        marketingConsentText: marketingConsent ? (consentText || null) : null
      }, { merge: true });
      await ref.collection('activities').add({
        type: 'member_onboarding',
        description: 'Completed member-portal onboarding'
          + (goals ? ` — Goals: ${goals.slice(0, 200)}` : ''),
        actorUid: 'system',
        actorName: 'Member onboarding',
        createdAt: FV.serverTimestamp(),
        meta: { phone, address, company, industry, location, goals }
      });
      // Separate, explicit consent record (proof of opt-in / opt-out).
      await ref.collection('activities').add({
        type: 'consent_updated',
        description: marketingConsent
          ? 'Opted IN to calls, SMS, and email communications'
          : 'Did NOT opt in to calls, SMS, or email communications',
        actorUid: 'system',
        actorName: 'Consent capture',
        createdAt: FV.serverTimestamp(),
        meta: { marketingConsent, consentText: consentText || null, channel: 'onboarding' }
      });
    }
  } catch (e) {
    console.warn('[submitOnboarding] CRM upsert failed:', e && e.message);
  }

  // 3) Welcome email safety net. No-ops when onUserCreated already sent it.
  if (u.welcomeEmailStatus !== 'sent') {
    const sent = await sendWelcomeEmail(db, uid, { ...u, email, displayName: profilePatch.displayName }, { crm });
    if (sent.status !== 'skipped') console.log(`[submitOnboarding] welcome email ${sent.status} for ${email}`);
  }

  return { ok: true };
});

// syncMembersToCrm({ sendMissingWelcome, force }) — owner only.
//
// Backfill for members who signed up before the pipeline above existed, or
// whose signup ran while the CRM had no company yet. Walks every users/{uid}
// doc, links each one to a CRM contact (find-or-create by email), and
// optionally sends the welcome email to anyone who never received one.
// Idempotent: already-linked members are skipped unless `force` is set, and
// the welcome send is guarded by the same once-only claim as signup.
exports.syncMembersToCrm = onCall({ secrets: [sendgridKey], timeoutSeconds: 540 }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  if (!isOwnerClaim) throw new HttpsError('permission-denied', 'Owner only.');

  const data = request.data || {};
  const sendMissingWelcome = data.sendMissingWelcome === true;
  const force = data.force === true;

  const db = admin.firestore();
  const companyId = await resolveAcademyCompanyId(db);
  if (!companyId) {
    throw new HttpsError('failed-precondition',
      'No company exists yet. Create the academy company in the owner console first.');
  }

  const counts = { total: 0, linked: 0, alreadyLinked: 0, skipped: 0, welcomeSent: 0, welcomeFailed: 0, errors: 0 };
  const failures = [];

  const PAGE = 300;
  let last = null;
  for (;;) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    if (page.empty) break;

    for (const d of page.docs) {
      counts.total += 1;
      const user = d.data() || {};
      const email = normalizeEmail(user.email);
      if (!EMAIL_RE.test(email) || email === OWNER_EMAIL) { counts.skipped += 1; continue; }

      let crm = null;
      try {
        if (user.crmContactId && user.crmCompanyId === companyId && !force) {
          counts.alreadyLinked += 1;
          crm = {
            companyId,
            contactId: user.crmContactId,
            ref: db.collection('companies').doc(companyId).collection('contacts').doc(user.crmContactId)
          };
        } else {
          crm = await syncMemberToCrm(db, d.id, user, {
            source: 'Member Signup',
            activity: user.crmContactId ? null : {
              type: 'member_signup',
              description: 'Linked existing member-portal account to this contact',
              actorName: 'CRM sync'
            }
          });
          if (crm) counts.linked += 1; else counts.skipped += 1;
        }
      } catch (e) {
        counts.errors += 1;
        if (failures.length < 25) failures.push({ uid: d.id, email, error: String(e && e.message).slice(0, 160) });
        continue;
      }

      if (sendMissingWelcome && user.welcomeEmailStatus !== 'sent') {
        const sent = await sendWelcomeEmail(db, d.id, user, { crm });
        if (sent.status === 'sent') counts.welcomeSent += 1;
        else if (sent.status === 'failed') {
          counts.welcomeFailed += 1;
          if (failures.length < 25) failures.push({ uid: d.id, email, error: sent.error || 'welcome send failed' });
        }
      }
    }

    last = page.docs[page.docs.length - 1];
    if (page.size < PAGE) break;
  }

  console.log('[syncMembersToCrm]', JSON.stringify(counts));
  return { ok: true, companyId, ...counts, failures };
});


// ────────────────────────────────────────────────────────────────
// sendgridEventWebhook — HTTP function (public)
// ────────────────────────────────────────────────────────────────

function verifySignature(publicKeyPem, payloadRaw, signature, timestamp) {
  if (!publicKeyPem || !signature || !timestamp) return false;
  try {
    const timestampedPayload = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      payloadRaw
    ]);
    const verifier = crypto.createVerify('sha256');
    verifier.update(timestampedPayload);
    verifier.end();
    const decodedSig = Buffer.from(signature, 'base64');
    return verifier.verify(publicKeyPem, decodedSig);
  } catch (e) {
    console.warn('[webhook] signature verify error:', e && e.message);
    return false;
  }
}

// ── Delivery events, whichever provider reported them ────────────────────
//
// SendGrid and Telnyx both report what happened to a sent email, in different
// words and different envelopes. Each webhook normalises its payload into the
// shape below and hands it here, so the CRM has one code path writing
// timelines, campaign counters and opt-outs no matter who sent the mail.
//
// The normalised event:
//   { event, companyId, campaignId, contactId, emailId, email, timestamp,
//     url, reason, messageId, eventId }
//
// `event` uses the SendGrid vocabulary — delivered, open, click, bounce,
// dropped, spamreport, unsubscribe — because that is what is already written
// to Firestore and read by the CRM. Telnyx's names are translated on the way
// in rather than forking the storage format, which would leave a contact
// card showing "opened" for one provider and "clicked" for the other.
async function applyEmailEvent(db, ev, bump, { source }) {
  const type = ev.event || 'unknown';
  const { companyId, campaignId, contactId, email } = ev;
  const timestamp = ev.timestamp || new Date();
  const eventId = ev.eventId
    || `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  if (companyId && campaignId) {
    const evRef = db.collection('companies').doc(companyId)
      .collection('campaigns').doc(campaignId)
      .collection('events').doc(eventId);
    await evRef.set({
      type,
      email: email || null,
      timestamp,
      url: ev.url || null,
      reason: ev.reason || null,
      source,
      raw: {
        messageId: ev.messageId || null,
        useragent: ev.useragent || null,
        ip: ev.ip || null
      }
    }, { merge: true });

    // Aggregate counters.
    if (type === 'delivered') bump(`${companyId}/${campaignId}`, 'stats.delivered');
    else if (type === 'open') bump(`${companyId}/${campaignId}`, 'stats.opens');
    else if (type === 'click') bump(`${companyId}/${campaignId}`, 'stats.clicks');
    else if (type === 'bounce' || type === 'dropped') bump(`${companyId}/${campaignId}`, 'stats.bounces');
    else if (type === 'unsubscribe' || type === 'group_unsubscribe' || type === 'spamreport') bump(`${companyId}/${campaignId}`, 'stats.unsubs');
  }

  // Suppress the contact on an opt-out or complaint.
  //
  // Without this, someone who unsubscribed in their mail client — or reported
  // the message as spam — stays on the list and is mailed again by the next
  // campaign. Matched by email as well as id, because a provider's own
  // unsubscribe UI does not carry our contactId.
  if (companyId && email
      && (type === 'unsubscribe' || type === 'group_unsubscribe' || type === 'spamreport')) {
    try {
      const FV = admin.firestore.FieldValue;
      const contactsCol = db.collection('companies').doc(companyId).collection('contacts');
      const match = contactId
        ? [await contactsCol.doc(contactId).get()].filter((d) => d.exists)
        : (await contactsCol.where('email', '==', String(email).toLowerCase()).limit(5).get()).docs;
      for (const d of match) {
        await d.ref.set({
          emailOptOut: true,
          emailOptOutAt: FV.serverTimestamp(),
          emailOptOutSource: type,
          marketingConsent: false,
          tags: FV.arrayUnion('Unsubscribed'),
          updatedAt: FV.serverTimestamp()
        }, { merge: true });
      }
    } catch (e) {
      console.warn('[emailEvent] opt-out suppression failed:', e && e.message);
    }
  }

  // 1-on-1 contact email events → append activity.
  if (companyId && contactId && !campaignId) {
    try {
      const contactRef = db.collection('companies').doc(companyId)
        .collection('contacts').doc(contactId);
      await contactRef.collection('activities').add({
        type: 'email_event',
        description: `Email ${type}${email ? ' · ' + email : ''}`,
        actorUid: 'system',
        actorName: source,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: {
          eventType: type,
          email: email || null,
          url: ev.url || null,
          reason: ev.reason || null,
          messageId: ev.messageId || null
        }
      });

      // Delivery state on the message itself, so the thread on the contact
      // card shows "delivered" or "bounced" rather than leaving every sent
      // email reading "sent" forever. emailId rides along as custom args
      // (SendGrid) or metadata (Telnyx), set by sendContactEmail.
      if (ev.emailId) {
        const STATUS_RANK = { sent: 0, processed: 1, delivered: 2, open: 3, click: 4 };
        const patch = {
          lastEventType: type,
          lastEventAt: admin.firestore.FieldValue.serverTimestamp()
        };
        if (type === 'bounce' || type === 'dropped' || type === 'spamreport') {
          patch.status = type === 'spamreport' ? 'spam' : type;
          patch.failureReason = ev.reason || null;
        } else if (STATUS_RANK[type] !== undefined) {
          // Never walk the status backwards: events arrive out of order, and
          // a late "processed" would erase "opened".
          patch.status = type === 'open' ? 'opened' : (type === 'click' ? 'clicked' : type);
          patch.statusRank = STATUS_RANK[type];
        }
        const emRef = contactRef.collection('emails').doc(String(ev.emailId));
        const emSnap = await emRef.get();
        if (emSnap.exists) {
          const prevRank = emSnap.data().statusRank;
          if (patch.statusRank !== undefined && prevRank !== undefined && prevRank >= patch.statusRank) {
            delete patch.status; delete patch.statusRank;
          }
          await emRef.set(patch, { merge: true });
        }
      }
    } catch (e) {
      console.warn('[emailEvent] contact activity write failed:', e && e.message);
    }
  }
}

/** Apply the campaign counters one webhook call accumulated. */
async function flushCampaignCounters(db, campaignIncrements) {
  for (const [key, fields] of campaignIncrements.entries()) {
    const [companyId, campaignId] = key.split('/');
    const campRef = db.collection('companies').doc(companyId).collection('campaigns').doc(campaignId);
    const updates = {};
    Object.keys(fields).forEach((f) => {
      updates[f] = admin.firestore.FieldValue.increment(fields[f]);
    });
    try {
      await campRef.set(updates, { merge: true });
    } catch (e) {
      console.warn('[emailEvent] campaign counter update failed:', e && e.message);
    }
  }
}

function newCounterBag() {
  const campaignIncrements = new Map();
  const bump = (cid, field) => {
    if (!cid) return;
    const m = campaignIncrements.get(cid) || {};
    m[field] = (m[field] || 0) + 1;
    campaignIncrements.set(cid, m);
  };
  return { campaignIncrements, bump };
}

exports.sendgridEventWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    try {
      if (req.method !== 'POST') {
        res.status(200).send('ok');
        return;
      }

      // Get raw body for signature verification. Firebase Functions v2 provides req.rawBody.
      const rawBody = req.rawBody ? Buffer.from(req.rawBody) : Buffer.from(JSON.stringify(req.body || []));

      // Webhook signing is optional. Read from env if set; otherwise accept unsigned.
      const webhookKey = (process.env.SENDGRID_WEBHOOK_KEY || '').trim();

      if (webhookKey && webhookKey.trim()) {
        const signature = req.get('X-Twilio-Email-Event-Webhook-Signature');
        const timestamp = req.get('X-Twilio-Email-Event-Webhook-Timestamp');
        const ok = verifySignature(webhookKey, rawBody, signature, timestamp);
        if (!ok) {
          console.warn('[webhook] signature invalid — ignoring payload');
          res.status(200).send('ok');
          return;
        }
      } else {
        console.warn('[webhook] SENDGRID_WEBHOOK_KEY not set — accepting without signature verification');
      }

      const events = Array.isArray(req.body) ? req.body : [];
      const db = admin.firestore();
      const { campaignIncrements, bump } = newCounterBag();

      for (const ev of events) {
        try {
          await applyEmailEvent(db, {
            event: ev.event || 'unknown',
            companyId: ev.companyId,
            campaignId: ev.campaignId,
            contactId: ev.contactId,
            emailId: ev.emailId,
            email: ev.email || null,
            timestamp: ev.timestamp ? new Date(ev.timestamp * 1000) : new Date(),
            url: ev.url || null,
            reason: ev.reason || ev.response || null,
            messageId: ev.sg_message_id || null,
            useragent: ev.useragent || null,
            ip: ev.ip || null,
            eventId: ev.sg_event_id || null
          }, bump, { source: 'SendGrid' });
        } catch (perEvErr) {
          console.warn('[webhook] event error:', perEvErr && perEvErr.message);
        }
      }

      await flushCampaignCounters(db, campaignIncrements);

      res.status(200).send('ok');
    } catch (err) {
      console.error('[webhook] fatal:', err && err.message);
      res.status(200).send('ok'); // Always 200 to prevent SendGrid from retrying.
    }
  }
);

// ── Telnyx email events ──────────────────────────────────────────────────
//
// The other half of EMAIL_PROVIDER=telnyx. Without this, mail sent through
// Telnyx shows on a contact card as sent and never moves: no delivered, no
// open, no bounce, and an unsubscribe in a mail client never suppresses the
// contact. The routing ids (companyId, contactId, campaignId, emailId) ride
// out as metadata on every send and come back on every event.
//
// Telnyx's event vocabulary is its own, so it is translated into the names
// already stored. Two translations are worth naming: `complained` is a spam
// report, and `failed`/`rejected` are a drop rather than a bounce — the mail
// never reached a receiving server to bounce off.
const TELNYX_EMAIL_EVENT_MAP = {
  delivered: 'delivered',
  opened: 'open',
  clicked: 'click',
  bounced: 'bounce',
  complained: 'spamreport',
  unsubscribed: 'unsubscribe',
  failed: 'dropped',
  rejected: 'dropped',
  deferred: 'deferred',
  sent: 'processed',
  sending: 'processed',
  queued: 'processed'
};

/**
 * Normalise one Telnyx email event.
 *
 * Accepts both envelopes Telnyx uses: the messaging-style
 * `{ data: { event_type, payload } }` wrapper and a flat email event
 * `{ data: { type, email_id, metadata } }`. Reading both costs a few lines
 * and means a webhook that arrives in the other shape is processed rather
 * than silently dropped.
 */
function telnyxEmailEvent(body) {
  const data = (body && body.data) || body || {};
  const payload = data.payload || {};
  const inner = payload.email || payload.message || {};

  // `email.delivered` and `delivered` both appear; keep the last segment.
  const rawType = String(data.event_type || data.type || payload.type || '')
    .split('.').pop().toLowerCase();

  const metadata = data.metadata || payload.metadata || inner.metadata || {};
  const toList = Array.isArray(payload.to) ? payload.to
    : (Array.isArray(inner.to) ? inner.to : []);
  const firstTo = toList[0];

  return {
    rawType,
    event: TELNYX_EMAIL_EVENT_MAP[rawType] || rawType || 'unknown',
    eventId: data.id || payload.id || null,
    messageId: data.email_id || payload.email_id || inner.id || null,
    email: payload.recipient || payload.email
      || (firstTo && (firstTo.email || firstTo)) || null,
    occurredAt: data.occurred_at || payload.occurred_at || null,
    url: payload.url || payload.link || null,
    reason: payload.reason || payload.detail || payload.description || null,
    metadata
  };
}

exports.telnyxEmailEventWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    // Fail closed, exactly like the SMS webhooks: an unsigned request is not
    // a Telnyx request, and an event that suppresses a contact is not
    // something to accept on trust.
    if (!telnyxSignatureOk(req)) { res.status(403).send('invalid signature'); return; }

    try {
      const e = telnyxEmailEvent(req.body);
      if (!e.rawType) { res.status(200).send('ignored'); return; }

      const md = e.metadata || {};
      const db = admin.firestore();
      const { campaignIncrements, bump } = newCounterBag();

      await applyEmailEvent(db, {
        event: e.event,
        companyId: md.companyId || null,
        campaignId: md.campaignId || null,
        contactId: md.contactId || null,
        emailId: md.emailId || null,
        email: e.email,
        timestamp: e.occurredAt ? new Date(e.occurredAt) : new Date(),
        url: e.url,
        reason: e.reason,
        messageId: e.messageId,
        eventId: e.eventId
      }, bump, { source: 'Telnyx' });

      await flushCampaignCounters(db, campaignIncrements);
      res.status(200).send('ok');
    } catch (err) {
      // 200 on anything we cannot act on, so Telnyx does not retry a payload
      // we will never understand.
      console.error('[telnyxEmailEvent] fatal:', err && err.message);
      res.status(200).send('ok');
    }
  }
);

// ────────────────────────────────────────────────────────────────
// Phase 2 — Community leaderboard, points & levels.
//
// Three Firestore triggers (post create, comment create, like write) maintain
// a per-user stats subcollection at users/{uid}/stats/aggregate, plus mirror
// fields `statsPoints` / `statsWeekPoints` on the parent user doc so the
// leaderboard query can `orderBy('statsPoints')` without a collectionGroup.
//
// Points formula:
//   - post created      +5 points (+10 if category=='wins')
//   - comment created   +1 point
//   - like received     +2 points to the post author
//   - like given        0 points (vanity stat)
//
// Levels are computed client-side from `points` — never written to Firestore.
//
// Weekly reset is "lazy": each trigger compares the stat doc's
// `weekStartedAt` to the current Monday-00:00-UTC. If older, weekPoints
// resets to the current delta; otherwise it increments. No Pub/Sub needed.
// ────────────────────────────────────────────────────────────────

const POINTS = {
  POST: 5,
  POST_WIN: 10,
  COMMENT: 1,
  LIKE_RECEIVED: 2
};

// How much per-day history to keep. The dashboard chart shows seven days;
// the extra week absorbs timezone skew and gives room to widen the chart
// later without another migration.
const DAILY_WINDOW_DAYS = 14;

function currentWeekStartUTC() {
  // Monday 00:00:00.000 UTC of the current week.
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun..6=Sat
  const offsetToMonday = (day + 6) % 7; // Mon=0, Tue=1, .., Sun=6
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - offsetToMonday,
    0, 0, 0, 0
  ));
  return monday;
}

/**
 * Apply a points delta to a user's stat aggregate doc + mirror fields on the
 * parent user doc, with lazy week-roll. Also bumps the named counter (e.g.
 * 'postCount', 'commentCount', 'likesReceived') by `counterDelta`.
 *
 * Single transaction for read-then-write atomicity. Cheap (1 read + 2 writes).
 */
async function applyPointsDelta(db, uid, pointsDelta, counters) {
  if (!uid) return;
  const userRef = db.collection('users').doc(uid);
  const statRef = userRef.collection('stats').doc('aggregate');
  const weekStart = currentWeekStartUTC();

  await db.runTransaction(async (tx) => {
    const [statSnap, userSnap] = await Promise.all([tx.get(statRef), tx.get(userRef)]);
    const stat = statSnap.exists ? statSnap.data() : {};
    const prevWeekStart = stat.weekStartedAt && stat.weekStartedAt.toMillis
      ? new Date(stat.weekStartedAt.toMillis())
      : null;
    const sameWeek = prevWeekStart && prevWeekStart.getTime() >= weekStart.getTime();

    const nextPoints = Math.max(0, (stat.points || 0) + pointsDelta);
    const nextWeekPoints = sameWeek
      ? Math.max(0, (stat.weekPoints || 0) + pointsDelta)
      : Math.max(0, pointsDelta);

    const statPatch = {
      points: nextPoints,
      weekPoints: nextWeekPoints,
      weekStartedAt: admin.firestore.Timestamp.fromDate(weekStart),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (counters) {
      Object.keys(counters).forEach((k) => {
        statPatch[k] = Math.max(0, (stat[k] || 0) + counters[k]);
      });
    }

    // Per-day totals, so the dashboard can draw an actual trend instead of a
    // single week number. Kept as a map on this same doc rather than a
    // subcollection: the transaction already holds the doc, so it costs no
    // extra read and no extra write.
    //
    // Pruned to DAILY_WINDOW_DAYS on every write so the map cannot grow
    // without bound. Keys are YYYY-MM-DD in UTC — the same convention
    // touchDailyStreak uses — which also means they sort lexicographically,
    // so the cutoff is a plain string comparison.
    //
    // merge: true deep-merges maps, so a pruned key has to be explicitly
    // deleted; leaving it out would simply preserve the old value.
    const daily = Object.assign({}, stat.dailyPoints || {});
    const today = utcDayKey();
    daily[today] = Math.max(0, Number(daily[today] || 0) + pointsDelta);
    const cutoff = utcDayKey(new Date(Date.now() - DAILY_WINDOW_DAYS * 24 * 60 * 60 * 1000));
    Object.keys(daily).forEach((k) => {
      if (k < cutoff) daily[k] = admin.firestore.FieldValue.delete();
    });
    statPatch.dailyPoints = daily;

    tx.set(statRef, statPatch, { merge: true });

    // Mirror onto user doc so the leaderboard query can orderBy without a
    // collectionGroup on the subcollection. Only write if the user doc exists
    // (otherwise we'd create a doc lacking auth-bound fields like email).
    if (userSnap.exists) {
      tx.set(userRef, {
        statsPoints: nextPoints,
        statsWeekPoints: nextWeekPoints
      }, { merge: true });
    }
  });
}

// Trigger handlers (onPostCreated / onCommentCreated / onLikeWritten) are
// defined further down in the Phase 3 block; they handle BOTH the points
// updates and the notification fan-out so the trigger boundary stays simple.

/**
 * getLeaderboard({ scope='global'|'company', limit=20 }) — callable.
 *
 * Returns the top N users by all-time `statsPoints`. Server-side because the
 * `users` collection has `allow list: if isOwner()` — going through Admin SDK
 * lets us project ONLY the safe fields (uid, displayName, avatarUrl,
 * statsPoints, statsWeekPoints, level) without leaking emails / companyIds.
 *
 * scope='company' restricts to caller's companyId. Owner sees global.
 */
exports.getLeaderboard = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const scope = data.scope === 'company' ? 'company' : 'global';
  const lim = Math.max(1, Math.min(50, Number(data.limit) || 20));

  const db = admin.firestore();

  // Resolve caller context for company scoping.
  let callerCompanyId = null;
  try {
    const meSnap = await db.collection('users').doc(callerUid).get();
    if (meSnap.exists) callerCompanyId = meSnap.data().companyId || null;
  } catch (e) { /* best-effort */ }

  let q;
  if (scope === 'company' && callerCompanyId) {
    q = db.collection('users')
      .where('companyId', '==', callerCompanyId)
      .orderBy('statsPoints', 'desc')
      .limit(lim);
  } else {
    q = db.collection('users')
      .orderBy('statsPoints', 'desc')
      .limit(lim);
  }

  let snap;
  try {
    snap = await q.get();
  } catch (err) {
    console.error('[getLeaderboard] query failed:', err && err.message);
    throw new HttpsError('internal', 'Could not load leaderboard.');
  }

  const rows = snap.docs.map((d) => {
    const u = d.data() || {};
    return {
      uid: d.id,
      displayName: u.displayName || u.email || 'Unknown',
      avatarUrl: u.avatarUrl || null,
      statsPoints: Number(u.statsPoints || 0),
      statsWeekPoints: Number(u.statsWeekPoints || 0)
    };
  }).filter((r) => r.statsPoints > 0); // Hide users who never engaged.

  return { ok: true, scope, rows };
});

// ────────────────────────────────────────────────────────────────
// Daily streak
//
// The points engine above rewards what you post. A streak rewards that you
// showed up at all, which is the behaviour the dashboard is trying to build.
// It rides on the same stats/aggregate doc (server-write-only by rules) and
// deliberately awards NO points: mixing "showed up" into the leaderboard
// would make it a measure of attendance rather than contribution.
// ────────────────────────────────────────────────────────────────

// YYYY-MM-DD in UTC. Same timezone convention as currentWeekStartUTC() above,
// so a member's streak day and their points week roll on the same clock.
function utcDayKey(date) {
  const d = date || new Date();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function previousUtcDayKey(dayKey) {
  const [y, m, d] = String(dayKey).split('-').map(Number);
  return utcDayKey(new Date(Date.UTC(y, m - 1, d - 1)));
}

/**
 * touchDailyStreak() — callable. Records that the caller showed up today and
 * returns their streak. Idempotent within a UTC day, so the dashboard can
 * call it on every load without inflating anything.
 *
 * Returns { currentStreak, longestStreak, lastActiveDay }.
 */
exports.touchDailyStreak = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const db = admin.firestore();
  // Grants parked for this address are normally claimed at signup, but a
  // grant can be parked after the account already exists (the email lookup
  // missed it). Every dashboard load calls this, so claim them here too:
  // one doc read when there is nothing waiting. Auth holds one account per
  // address, so this is the same claim signup makes.
  const authEmail = request.auth.token && request.auth.token.email;
  if (authEmail) {
    try {
      const n = await applyPendingGrants(db, uid, authEmail);
      if (n) {
        console.log(`[touchDailyStreak] claimed ${n} parked grant(s) for ${authEmail}`);
        await markBetaActivated(db, authEmail, uid);
      }
    } catch (e) {
      console.warn('[touchDailyStreak] pending grants failed:', e && e.message);
    }
  }
  const userRef = db.collection('users').doc(uid);
  const statRef = userRef.collection('stats').doc('aggregate');
  const today = utcDayKey();

  return await db.runTransaction(async (tx) => {
    const [statSnap, userSnap] = await Promise.all([tx.get(statRef), tx.get(userRef)]);
    const stat = statSnap.exists ? statSnap.data() : {};
    const last = stat.lastActiveDay || null;

    // Already counted today — read-only path, no write at all.
    if (last === today) {
      return {
        ok: true,
        currentStreak: Number(stat.currentStreak || 1),
        longestStreak: Number(stat.longestStreak || stat.currentStreak || 1),
        lastActiveDay: today,
        incremented: false
      };
    }

    // Consecutive if the last visit was literally yesterday; any longer gap
    // starts over. A brand-new member lands on day one either way.
    const current = last && last === previousUtcDayKey(today)
      ? Number(stat.currentStreak || 0) + 1
      : 1;
    const longest = Math.max(Number(stat.longestStreak || 0), current);

    tx.set(statRef, {
      lastActiveDay: today,
      currentStreak: current,
      longestStreak: longest,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Mirror onto the user doc, same reasoning as applyPointsDelta: callers
    // that already hold the user doc shouldn't need a second read. Guarded on
    // existence so we never create a user doc missing its auth-bound fields.
    if (userSnap.exists) {
      tx.set(userRef, {
        currentStreak: current,
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    return {
      ok: true,
      currentStreak: current,
      longestStreak: longest,
      lastActiveDay: today,
      incremented: true
    };
  });
});

// ────────────────────────────────────────────────────────────────
// Owner pulse — the admin strip at the top of the dashboard.
//
// Every number here is a count the client cannot compute for itself: `users`
// is owner-list-only, `orders` and event registrations are admin-only, and
// "posts nobody answered" needs a scan. Aggregate .count() queries keep it to
// a handful of reads, and a short in-process cache keeps a refresh-happy
// owner from paying for them twice a minute.
// ────────────────────────────────────────────────────────────────

const PULSE_TTL_MS = 5 * 60 * 1000;
let _pulseCache = null; // { at, payload }

exports.getOwnerPulse = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admins only.');
  }

  if (_pulseCache && (Date.now() - _pulseCache.at) < PULSE_TTL_MS) {
    return { ..._pulseCache.payload, cached: true };
  }

  const now = new Date();
  const cutoff = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const nowTs = admin.firestore.Timestamp.fromDate(now);

  // Each read is independent and individually non-fatal: a pulse strip with
  // one dash in it still beats no strip.
  const safe = (p, fallback) => p.then((v) => v).catch((e) => {
    console.warn('[getOwnerPulse] partial failure:', e && e.message);
    return fallback;
  });

  const [
    newMembers,
    recentPosts,
    nextEvents,
    recentOrders,
    openProducts
  ] = await Promise.all([
    safe(db.collection('users').where('createdAt', '>=', cutoff).count().get().then((s) => s.data().count), null),
    safe(db.collection('posts').where('createdAt', '>=', cutoff).limit(200).get().then((s) => s.docs.map((d) => d.data())), []),
    safe(db.collection('events').where('startsAt', '>=', nowTs).orderBy('startsAt', 'asc').limit(1).get().then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))), []),
    safe(db.collection('orders').where('createdAt', '>=', cutoff).limit(200).get().then((s) => s.docs.map((d) => d.data())), []),
    safe(db.collection('products').where('status', 'in', ['interest', 'preorder']).limit(50).get().then((s) => s.docs.map((d) => d.data())), [])
  ]);

  const unanswered = recentPosts.filter((p) => !Number(p.commentCount || 0)).length;
  const grossCents = recentOrders.reduce((sum, o) => sum + Number(o.amountTotal || 0), 0);
  const nextEvent = nextEvents[0] || null;

  const payload = {
    ok: true,
    windowDays: 7,
    newMembers,
    posts: recentPosts.length,
    unansweredPosts: unanswered,
    orders: recentOrders.length,
    // amountTotal is Stripe cents; the client formats it.
    grossCents,
    interestSignups: openProducts.reduce((n, p) => n + Number(p.interestCount || 0), 0),
    preorders: openProducts.reduce((n, p) => n + Number(p.preorderCount || 0), 0),
    nextEvent: nextEvent ? {
      id: nextEvent.id,
      title: nextEvent.title || 'Untitled event',
      startsAtMs: nextEvent.startsAt && nextEvent.startsAt.toMillis ? nextEvent.startsAt.toMillis() : null,
      registrationCount: Number(nextEvent.registrationCount || 0)
    } : null
  };

  _pulseCache = { at: Date.now(), payload };
  return payload;
});

/**
 * recomputeUserStats({ uid }) — owner-only callable. Repair / backfill path.
 *
 * Paginates the target user's posts + likes-received and rewrites the stat
 * aggregate from scratch. Comments aren't easily countable across all parent
 * posts without a collectionGroup query, so commentCount is reset to 0 — the
 * trigger will re-accumulate going forward. Acceptable for v1.
 */
exports.recomputeUserStats = onCall(async (request) => {
  const isOwnerClaim = request.auth && request.auth.token && request.auth.token.role === 'owner';
  if (!isOwnerClaim) throw new HttpsError('permission-denied', 'Owner only.');

  const uid = (request.data && request.data.uid || '').toString().trim();
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const statRef = userRef.collection('stats').doc('aggregate');

  // Posts authored by this user — drives postCount + base post points.
  let postCount = 0;
  let winsCount = 0;
  let likesReceived = 0;
  const authoredPostIds = [];
  try {
    const postsSnap = await db.collection('posts').where('authorUid', '==', uid).get();
    postsSnap.forEach((d) => {
      const p = d.data() || {};
      postCount += 1;
      if (p.category === 'wins') winsCount += 1;
      likesReceived += Number(p.likeCount || 0);
      authoredPostIds.push(d.id);
    });
  } catch (err) {
    console.error('[recomputeUserStats] posts query failed:', err && err.message);
    throw new HttpsError('internal', 'Could not read posts.');
  }

  const points =
    (postCount - winsCount) * POINTS.POST +
    winsCount * POINTS.POST_WIN +
    likesReceived * POINTS.LIKE_RECEIVED;

  const weekStart = currentWeekStartUTC();

  await db.runTransaction(async (tx) => {
    tx.set(statRef, {
      points,
      postCount,
      commentCount: 0,
      likesReceived,
      likesGiven: 0,
      weekPoints: 0,
      weekStartedAt: admin.firestore.Timestamp.fromDate(weekStart),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    tx.set(userRef, {
      statsPoints: points,
      statsWeekPoints: 0
    }, { merge: true });
  });

  return { ok: true, uid, points, postCount, winsCount, likesReceived };
});

// ────────────────────────────────────────────────────────────────
// Phase 3 — Notifications (mention / like / comment) + FCM push
// + member search.
//
// Triggers fan out one Firestore notification doc per recipient. Doc IDs
// are deterministic so re-firing (e.g. unlike → like) collapses into a
// single row instead of spamming the inbox. unreadNotifCount on the user
// doc mirrors the count of unread notifs, used to badge the bell icon
// without an extra query.
// ────────────────────────────────────────────────────────────────

const NOTIF_TRUNCATE = 140;

function clampPreview(text) {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > NOTIF_TRUNCATE ? t.slice(0, NOTIF_TRUNCATE) + '…' : t;
}

/**
 * Send a multicast FCM push to a user's registered tokens. Best-effort:
 * never throws. Prunes tokens that come back as not-registered.
 */
async function pushToUser(db, uid, payload) {
  if (!uid || !payload) return { sent: 0, failed: 0 };
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return { sent: 0, failed: 0 };
    const data = userSnap.data() || {};
    const prefs = data.notifPrefs || {};
    if (prefs.push === false) return { sent: 0, failed: 0 };
    const tokens = Array.isArray(data.fcmTokens) ? data.fcmTokens.filter((t) => typeof t === 'string' && t) : [];
    if (!tokens.length) return { sent: 0, failed: 0 };

    const messaging = admin.messaging();
    const message = {
      tokens,
      notification: {
        title: payload.title || '1P Leadership',
        body: payload.body || ''
      },
      data: payload.data || {},
      webpush: {
        fcmOptions: { link: (payload.data && payload.data.url) || `${APP_BASE_URL}/community.html` }
      }
    };
    const resp = await messaging.sendEachForMulticast(message);
    const stale = [];
    (resp.responses || []).forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/invalid-argument'
      ) stale.push(tokens[i]);
    });
    if (stale.length) {
      try {
        await db.collection('users').doc(uid).set({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...stale)
        }, { merge: true });
      } catch (e) { /* ignore */ }
    }
    return { sent: resp.successCount || 0, failed: resp.failureCount || 0 };
  } catch (err) {
    console.error('[pushToUser] failed:', err && err.message);
    return { sent: 0, failed: 0 };
  }
}

/**
 * Write a notification with a deterministic ID. If it already exists
 * AND was unread, this is a no-op (avoids double-counting on re-fire).
 * If it was read or didn't exist, sets to unread and bumps the parent
 * user doc's unreadNotifCount. Returns true iff this was a new unread.
 *
 * Uses a transaction so the count + doc stay consistent.
 */
async function notifyUser(db, recipientUid, notif, { typePrefKey } = {}) {
  if (!recipientUid || !notif || !notif.id) return false;
  const userRef = db.collection('users').doc(recipientUid);
  const notifRef = userRef.collection('notifications').doc(notif.id);

  const result = await db.runTransaction(async (tx) => {
    const [notifSnap, userSnap] = await Promise.all([tx.get(notifRef), tx.get(userRef)]);

    // Respect per-user opt-out (notifPrefs.mentions / .likes / .comments).
    if (typePrefKey && userSnap.exists) {
      const prefs = (userSnap.data() && userSnap.data().notifPrefs) || {};
      if (prefs[typePrefKey] === false) return { newUnread: false, skipped: true };
    }

    const wasUnread = notifSnap.exists && notifSnap.data().read === false;
    const willBeUnread = true;

    const patch = {
      type: notif.type,
      fromUid: notif.fromUid || null,
      fromName: notif.fromName || '',
      fromAvatar: notif.fromAvatar || null,
      // Announcements carry their own headline; community notifications leave
      // it null and build their line from fromName.
      title: notif.title || null,
      postId: notif.postId || null,
      commentId: notif.commentId || null,
      // `category` is the channel key across the whole app — post notifications
      // use it to deep-link, and channel-access notifications reuse it so the
      // bell can offer Approve/Deny against the right channel.
      category: notif.category || null,
      channelName: notif.channelName || null,
      answerCount: typeof notif.answerCount === 'number' ? notif.answerCount : null,
      preview: notif.preview || '',
      // Where the bell row should go, for notifications that aren't about a
      // post or channel (course work reminders, announcements). Site-relative.
      link: notif.link || null,
      // Cover art for notifications that open as a popup (course_granted).
      image: notif.image || null,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    tx.set(notifRef, patch, { merge: true });

    if (!wasUnread && willBeUnread && userSnap.exists) {
      tx.set(userRef, {
        unreadNotifCount: admin.firestore.FieldValue.increment(1)
      }, { merge: true });
      return { newUnread: true, skipped: false };
    }
    return { newUnread: false, skipped: false };
  });

  return result.newUnread;
}

/**
 * Fan out @mention notifications to a set of recipients. Filters out the
 * actor (no self-notify) and dedupes. Caller passes the surrounding post
 * info so we don't re-read it. Optionally pushes FCM after the Firestore
 * write so badge counts are accurate even if push fails.
 */
async function fanOutMentions(db, mentionedUids, ctx) {
  if (!Array.isArray(mentionedUids) || !mentionedUids.length) return;
  const seen = new Set();
  for (const uid of mentionedUids) {
    if (!uid || uid === ctx.fromUid || seen.has(uid)) continue;
    seen.add(uid);
    const notifId = ctx.commentId
      ? `mention_comment_${ctx.commentId}_${ctx.fromUid}`
      : `mention_post_${ctx.postId}_${ctx.fromUid}`;
    const wasNew = await notifyUser(db, uid, {
      id: notifId,
      type: 'mention',
      fromUid: ctx.fromUid,
      fromName: ctx.fromName,
      fromAvatar: ctx.fromAvatar,
      postId: ctx.postId,
      commentId: ctx.commentId || null,
      category: ctx.category || null,
      preview: clampPreview(ctx.preview)
    }, { typePrefKey: 'mentions' });
    if (wasNew) {
      pushToUser(db, uid, {
        title: `${ctx.fromName || 'Someone'} mentioned you`,
        body: clampPreview(ctx.preview),
        data: {
          url: `${APP_BASE_URL}/community.html?post=${encodeURIComponent(ctx.postId)}`,
          type: 'mention',
          postId: ctx.postId
        }
      }).catch(() => {});
    }
  }
}

// ── Announcements → the bell ────────────────────────────────────────
// Publishing an announcement (manage-announcements.html) fans one
// notification out to every member it targets, so a portal update rings the
// bell instead of waiting to be discovered on the dashboard spotlight.
//
// Two paths reach the same fan-out, and both are safe to race:
//   - onAnnouncementWritten fires the moment an announcement is created or
//     edited into a live state (active, publish time reached).
//   - the automation tick sweeps for scheduled announcements whose publish
//     time arrived with no edit to trigger on.
// A transaction claims `notifiedAt` on the announcement before anything is
// sent, so the fan-out runs once ever; the deterministic notification id
// (`ann_{announcementId}`) collapses any retry that slips through.

function announcementMillis(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

// Mirrors the dashboard's visibility window (announcements.js isVisibleTo):
// active, published, not expired.
function announcementIsLive(a, nowMs) {
  if (!a || a.active === false) return false;
  const pub = announcementMillis(a.publishAt);
  if (pub && pub > nowMs) return false;
  const exp = announcementMillis(a.expiresAt);
  if (exp && exp <= nowMs) return false;
  return true;
}

// How long after going live an announcement may still ring the bell. The
// sweep rides a tick that GitHub delivers every couple of hours at best, so
// this has to outlast a slow clock — but it also keeps announcements that
// were already live before this fan-out shipped (they carry no notifiedAt)
// from buzzing every member about old news on the first tick after deploy,
// and keeps an edit to a months-old announcement from re-announcing it.
const ANNOUNCEMENT_NOTIFY_WINDOW_MS = 72 * 3600 * 1000;

function announcementShouldNotify(a, nowMs) {
  if (!a || a.notifiedAt || !announcementIsLive(a, nowMs)) return false;
  // Went live at its publish time, or at creation when it had none. With
  // neither there is no way to tell old from new, so stay quiet.
  const liveAt = announcementMillis(a.publishAt) || announcementMillis(a.createdAt);
  return !!liveAt && nowMs - liveAt <= ANNOUNCEMENT_NOTIFY_WINDOW_MS;
}

// Which members an announcement targets. `members` rows carry
// { uid, role, companyId, enrolledCourseSlugs }; the audience semantics
// match the dashboard exactly, so the bell never rings for someone the
// spotlight would hide it from.
function announcementTargets(a, members) {
  const audience = a && a.audience;
  return (members || []).filter((m) => {
    if (!m || !m.uid) return false;
    const slugs = Array.isArray(m.enrolledCourseSlugs) ? m.enrolledCourseSlugs : [];
    switch (audience) {
      case 'enrolled':
        return a.courseSlug ? slugs.includes(a.courseSlug) : slugs.length > 0;
      case 'company':
        return !!a.companyId && m.companyId === a.companyId;
      case 'admin':
        return m.role === 'owner' || m.role === 'admin';
      default:
        return true;
    }
  }).map((m) => m.uid);
}

async function fanOutAnnouncement(db, announcementId, a) {
  const ref = db.collection('announcements').doc(announcementId);

  // Claim before sending: whichever caller wins the transaction fans out,
  // the other sees notifiedAt and walks away.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data().notifiedAt) return false;
    tx.set(ref, { notifiedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
  if (!claimed) return { notified: 0, claimed: false };

  // Full member scan, same as syncMembersToCrm: the membership is small and
  // the audiences ('enrolled' without a slug, role checks) don't reduce to a
  // single Firestore query anyway.
  const usersSnap = await db.collection('users').get();
  const members = usersSnap.docs.map((d) => {
    const u = d.data() || {};
    return {
      uid: d.id,
      role: u.role || 'user',
      companyId: u.companyId || null,
      enrolledCourseSlugs: Array.isArray(u.enrolledCourseSlugs) ? u.enrolledCourseSlugs : []
    };
  });

  const title = String(a.title || 'New update').slice(0, 200);
  // The bell only follows site-relative links; an external CTA still opens
  // from the push, while the bell row falls back to the dashboard.
  const cta = String(a.ctaHref || '').trim();
  const link = cta.startsWith('/') && !cta.startsWith('//') ? cta : '/dashboard';
  const pushUrl = /^https?:\/\//.test(cta) ? cta : `${APP_BASE_URL}${link}`;
  const preview = clampPreview(a.body || '');

  let notified = 0;
  for (const uid of announcementTargets(a, members)) {
    try {
      const wasNew = await notifyUser(db, uid, {
        id: `ann_${announcementId}`,
        type: 'announcement',
        fromName: 'The One Percent',
        title,
        link,
        preview
      }, { typePrefKey: 'announcements' });
      if (wasNew) {
        notified += 1;
        pushToUser(db, uid, {
          title,
          body: preview || 'Open the portal to see what\'s new.',
          data: { url: pushUrl, type: 'announcement', announcementId }
        }).catch(() => {});
      }
    } catch (err) {
      console.error(`[announcement] notify ${uid} failed:`, err && err.message);
    }
  }
  console.log(`[announcement] ${announcementId} → ${notified} member(s)`);
  return { notified, claimed: true };
}

exports.onAnnouncementWritten = onDocumentWritten(
  { document: 'announcements/{announcementId}' },
  async (event) => {
    const after = event.data && event.data.after;
    if (!after || !after.exists) return;
    const a = after.data() || {};
    // Our own notifiedAt claim re-fires this trigger; the field is the guard.
    if (!announcementShouldNotify(a, Date.now())) return;
    try {
      await fanOutAnnouncement(admin.firestore(), event.params.announcementId, a);
    } catch (err) {
      console.error('[onAnnouncementWritten] fan-out failed:', err && err.message);
    }
  }
);

// The tick's sweep: scheduled announcements whose publish time has arrived
// get no document write to trigger on, so the clock picks them up.
async function fanOutDueAnnouncements(db, { dryRun = false } = {}) {
  const snap = await db.collection('announcements').where('active', '==', true).get();
  const now = Date.now();
  const due = snap.docs.filter((d) => announcementShouldNotify(d.data() || {}, now));
  if (dryRun) return { wouldNotify: due.map((d) => d.id) };
  let sent = 0;
  for (const d of due) {
    const r = await fanOutAnnouncement(db, d.id, d.data() || {});
    if (r.claimed) sent += 1;
  }
  return { announcements: sent };
}

// Replace the Phase 2 onPostCreated to also fan out mention notifs, and
// piggyback the activity timestamp on the user doc.
//
// Each of the three community triggers is registered TWICE: once on the flat
// `posts` collection (public channels) and once on `channels/{channelKey}/posts`
// (private channels). Firestore triggers match a literal path, so without the
// second registration a private-channel post would silently earn no points and
// send no notifications. `channelKey` is null for the public path and is used to
// resolve the parent post document.
function postRefFor(db, channelKey, postId) {
  return channelKey
    ? db.collection('channels').doc(channelKey).collection('posts').doc(postId)
    : db.collection('posts').doc(postId);
}

async function handlePostCreated(event, channelKey) {
    const snap = event.data;
    if (!snap) return;
    const post = snap.data() || {};
    const author = post.authorUid;
    if (!author) return;

    const isWin = post.category === 'wins';
    const delta = isWin ? POINTS.POST_WIN : POINTS.POST;
    const db = admin.firestore();
    try {
      await applyPointsDelta(db, author, delta, { postCount: 1 });
    } catch (err) {
      console.error('[onPostCreated] points apply failed:', err && err.message);
    }

    // Mention fan-out.
    try {
      await fanOutMentions(db, post.mentionedUids || [], {
        fromUid: author,
        fromName: post.authorName || '',
        fromAvatar: post.authorAvatar || null,
        postId: snap.id,
        commentId: null,
        category: post.category || null,
        preview: post.text || ''
      });
    } catch (err) {
      console.error('[onPostCreated] mention fan-out failed:', err && err.message);
    }
}

exports.onPostCreated = onDocumentCreated(
  { document: 'posts/{postId}' },
  (event) => handlePostCreated(event, null)
);
exports.onPrivatePostCreated = onDocumentCreated(
  { document: 'channels/{channelKey}/posts/{postId}' },
  (event) => handlePostCreated(event, event.params.channelKey)
);

// Replace the Phase 2 onCommentCreated to also fan out comment + mention notifs.
async function handleCommentCreated(event, channelKey) {
    const snap = event.data;
    if (!snap) return;
    const comment = snap.data() || {};
    const commenter = comment.authorUid;
    const postId = event.params.postId;
    const commentId = event.params.commentId;
    if (!commenter || !postId) return;

    const db = admin.firestore();
    try {
      await applyPointsDelta(db, commenter, POINTS.COMMENT, { commentCount: 1 });
    } catch (err) {
      console.error('[onCommentCreated] points apply failed:', err && err.message);
    }

    // Notify the post author (skip if commenter == author).
    let postData = null;
    try {
      const postSnap = await postRefFor(db, channelKey, postId).get();
      if (postSnap.exists) postData = postSnap.data();
    } catch (e) { /* tolerated */ }

    if (postData && postData.authorUid && postData.authorUid !== commenter) {
      try {
        const wasNew = await notifyUser(db, postData.authorUid, {
          id: `comment_${commentId}`,
          type: 'comment',
          fromUid: commenter,
          fromName: comment.authorName || '',
          fromAvatar: comment.authorAvatar || null,
          postId,
          commentId,
          category: postData.category || null,
          preview: clampPreview(comment.text || '')
        }, { typePrefKey: 'comments' });
        if (wasNew) {
          pushToUser(db, postData.authorUid, {
            title: `${comment.authorName || 'Someone'} commented on your post`,
            body: clampPreview(comment.text || ''),
            data: {
              url: `${APP_BASE_URL}/community.html?post=${encodeURIComponent(postId)}`,
              type: 'comment',
              postId
            }
          }).catch(() => {});
        }
      } catch (err) {
        console.error('[onCommentCreated] author notify failed:', err && err.message);
      }
    }

    // Mention fan-out for @mentions in the comment body.
    try {
      await fanOutMentions(db, comment.mentionedUids || [], {
        fromUid: commenter,
        fromName: comment.authorName || '',
        fromAvatar: comment.authorAvatar || null,
        postId,
        commentId,
        category: postData ? (postData.category || null) : null,
        preview: comment.text || ''
      });
    } catch (err) {
      console.error('[onCommentCreated] mention fan-out failed:', err && err.message);
    }
}

exports.onCommentCreated = onDocumentCreated(
  { document: 'posts/{postId}/comments/{commentId}' },
  (event) => handleCommentCreated(event, null)
);
exports.onPrivateCommentCreated = onDocumentCreated(
  { document: 'channels/{channelKey}/posts/{postId}/comments/{commentId}' },
  (event) => handleCommentCreated(event, event.params.channelKey)
);

// Replace the Phase 2 onLikeWritten to also write a like notif on like-add.
// (Like-remove leaves the existing notif in place — typical social UX.)
async function handleLikeWritten(event, channelKey) {
    const beforeExists = event.data && event.data.before && event.data.before.exists;
    const afterExists = event.data && event.data.after && event.data.after.exists;
    if (beforeExists === afterExists) return;

    const liker = event.params.uid;
    const postId = event.params.postId;
    if (!liker || !postId) return;

    const isLikeAdded = !beforeExists && afterExists;
    const sign = isLikeAdded ? 1 : -1;

    const db = admin.firestore();
    let post = null;
    try {
      const postSnap = await postRefFor(db, channelKey, postId).get();
      if (postSnap.exists) post = { id: postSnap.id, ...postSnap.data() };
    } catch (err) {
      console.warn('[onLikeWritten] post fetch failed:', err && err.message);
    }

    try {
      await applyPointsDelta(db, liker, 0, { likesGiven: sign });
    } catch (err) {
      console.error('[onLikeWritten] liker stat update failed:', err && err.message);
    }

    if (post && post.authorUid && post.authorUid !== liker) {
      try {
        await applyPointsDelta(
          db,
          post.authorUid,
          sign * POINTS.LIKE_RECEIVED,
          { likesReceived: sign }
        );
      } catch (err) {
        console.error('[onLikeWritten] author stat update failed:', err && err.message);
      }

      // Only write a notif on like-add. We need the liker's display info; pull
      // it from the like-doc's parent author lookup if present, else fall back
      // to a fetch on the liker's user doc.
      if (isLikeAdded) {
        let likerName = '';
        let likerAvatar = null;
        try {
          const likerSnap = await db.collection('users').doc(liker).get();
          if (likerSnap.exists) {
            const u = likerSnap.data() || {};
            likerName = u.displayName || u.email || '';
            likerAvatar = u.avatarUrl || null;
          }
        } catch (e) { /* tolerated */ }

        try {
          const wasNew = await notifyUser(db, post.authorUid, {
            id: `like_${postId}_${liker}`,
            type: 'like',
            fromUid: liker,
            fromName: likerName,
            fromAvatar: likerAvatar,
            postId,
            commentId: null,
            category: post.category || null,
            preview: clampPreview(post.text || '')
          }, { typePrefKey: 'likes' });
          if (wasNew) {
            pushToUser(db, post.authorUid, {
              title: `${likerName || 'Someone'} liked your post`,
              body: clampPreview(post.text || ''),
              data: {
                url: `${APP_BASE_URL}/community.html?post=${encodeURIComponent(postId)}`,
                type: 'like',
                postId
              }
            }).catch(() => {});
          }
        } catch (err) {
          console.error('[onLikeWritten] author notify failed:', err && err.message);
        }
      }
    }
}

exports.onLikeWritten = onDocumentWritten(
  { document: 'posts/{postId}/likes/{uid}' },
  (event) => handleLikeWritten(event, null)
);
exports.onPrivateLikeWritten = onDocumentWritten(
  { document: 'channels/{channelKey}/posts/{postId}/likes/{uid}' },
  (event) => handleLikeWritten(event, event.params.channelKey)
);

/**
 * searchMembers({ query }) — autocomplete for @mention picking.
 *
 * Server-side because the `users` collection has `allow list: if isOwner()`.
 * We project safe fields only (uid, displayName, avatarUrl) and scope the
 * candidate set to the caller's visibility:
 *   - owner → all users
 *   - team user / admin → company members + owner
 *   - individual buyer → owner only (closest thing to a "global" they share with)
 *
 * Returns up to 10 matches sorted by displayName asc.
 */
exports.searchMembers = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const q = (data.query || '').toString().trim().toLowerCase();
  if (!q) return { ok: true, results: [] };

  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  const db = admin.firestore();

  let callerCompanyId = null;
  if (!isOwnerClaim) {
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      if (meSnap.exists) callerCompanyId = meSnap.data().companyId || null;
    } catch (e) { /* best-effort */ }
  }

  // Collect a candidate pool, then filter by prefix match in JS. Prefix-only
  // matching ('alex' matches 'Alex Chen', 'alexandra'; not 'sandra alex').
  const pool = new Map(); // uid → { uid, displayName, avatarUrl }
  function add(uid, doc) {
    if (!uid || pool.has(uid)) return;
    const u = doc || {};
    pool.set(uid, {
      uid,
      displayName: u.displayName || u.email || 'Unknown',
      avatarUrl: u.avatarUrl || null
    });
  }

  try {
    if (isOwnerClaim) {
      const snap = await db.collection('users').limit(500).get();
      snap.docs.forEach((d) => add(d.id, d.data()));
    } else if (callerCompanyId) {
      const memSnap = await db.collection('companies').doc(callerCompanyId).collection('members').limit(500).get();
      memSnap.docs.forEach((d) => add(d.id, d.data()));
      // Also include owner so users can @mention support.
      const ownerSnap = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
      ownerSnap.docs.forEach((d) => add(d.id, d.data()));
    } else {
      // Individual buyer — only owner is visible to them via @mention.
      const ownerSnap = await db.collection('users').where('email', '==', OWNER_EMAIL).limit(1).get();
      ownerSnap.docs.forEach((d) => add(d.id, d.data()));
    }
  } catch (err) {
    console.error('[searchMembers] candidate pool fetch failed:', err && err.message);
    return { ok: false, results: [] };
  }

  const results = Array.from(pool.values())
    .filter((u) => (u.displayName || '').toLowerCase().includes(q))
    .sort((a, b) => {
      // Prefix matches first, then alphabetical.
      const ap = (a.displayName || '').toLowerCase().startsWith(q) ? 0 : 1;
      const bp = (b.displayName || '').toLowerCase().startsWith(q) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return (a.displayName || '').localeCompare(b.displayName || '');
    })
    .slice(0, 10);

  return { ok: true, results };
});

// ────────────────────────────────────────────────────────────────
// Community invite tokens.
//
// Owner / admin generates a shareable invite link; recipient signs up
// via /signup.html?invite=<token>; the signup flow calls
// acceptCommunityInvite to record the use. Server-only collection so
// tokens never leak via client list operations.
// ────────────────────────────────────────────────────────────────

const COMMUNITY_INVITE_DEFAULT_USES = 100;
const COMMUNITY_INVITE_DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function makeInviteToken() {
  // 12 URL-safe characters via base64url of 9 random bytes.
  return crypto.randomBytes(9).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * createCommunityInvite({ usesAllowed?, ttlMs? }) — owner / admin only.
 * Returns { token, url, expiresAt }.
 */
exports.createCommunityInvite = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';

  const db = admin.firestore();

  // Owner is always allowed; otherwise the caller must be a company admin.
  if (!isOwnerClaim) {
    let isAnyCompanyAdmin = false;
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      const cid = meSnap.exists ? (meSnap.data().companyId || null) : null;
      if (cid) {
        const compSnap = await db.collection('companies').doc(cid).get();
        const adminUids = compSnap.exists ? (compSnap.data().adminUids || []) : [];
        isAnyCompanyAdmin = adminUids.includes(callerUid);
      }
    } catch (e) { /* best-effort */ }
    if (!isAnyCompanyAdmin) {
      throw new HttpsError('permission-denied', 'Only owners and admins can create invites.');
    }
  }

  // Throttle invite creation: 30 per caller per hour.
  await rateLimitCaller(db, request, { action: 'createCommunityInvite', max: 30, windowSec: 3600 });

  const data = request.data || {};
  const usesAllowed = Math.max(1, Math.min(1000, Number(data.usesAllowed) || COMMUNITY_INVITE_DEFAULT_USES));
  const ttlMs = Math.max(60 * 60 * 1000, Math.min(365 * 24 * 60 * 60 * 1000, Number(data.ttlMs) || COMMUNITY_INVITE_DEFAULT_TTL_MS));
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + ttlMs);

  // Look up creator's display name for analytics.
  let createdByName = (request.auth.token && request.auth.token.name) || null;
  if (!createdByName) {
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      if (meSnap.exists) createdByName = meSnap.data().displayName || meSnap.data().email || null;
    } catch (e) { /* tolerated */ }
  }

  // Generate a token and ensure no collision (extremely unlikely; one retry).
  let token = makeInviteToken();
  for (let i = 0; i < 3; i++) {
    const probe = await db.collection('communityInvites').doc(token).get();
    if (!probe.exists) break;
    token = makeInviteToken();
  }

  await db.collection('communityInvites').doc(token).set({
    token,
    kind: 'admin',
    createdByUid: callerUid,
    createdByName: createdByName || 'Unknown',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    usesAllowed,
    usesUsed: 0,
    usedBy: []
  });

  const url = `${APP_BASE_URL}/signup.html?invite=${encodeURIComponent(token)}`;
  return { ok: true, token, url, expiresAt: expiresAt.toMillis(), usesAllowed };
});

/**
 * acceptCommunityInvite({ token }) — any authenticated user.
 *
 * Validates the token (exists, not expired, has uses remaining) and
 * records this user's acceptance. Idempotent: a user accepting twice is
 * a no-op (their uid is added to usedBy at most once). Returns
 * { ok, alreadyAccepted? } so the client can decide whether to celebrate.
 */
exports.acceptCommunityInvite = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const token = (request.data && request.data.token || '').toString().trim();
  if (!token) throw new HttpsError('invalid-argument', 'Token is required.');

  const db = admin.firestore();
  const ref = db.collection('communityInvites').doc(token);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Invite not found.');
    }
    const inv = snap.data() || {};

    const now = Date.now();
    const exp = inv.expiresAt && inv.expiresAt.toMillis ? inv.expiresAt.toMillis() : 0;
    if (exp && exp < now) {
      throw new HttpsError('failed-precondition', 'Invite has expired.');
    }
    const used = Number(inv.usesUsed || 0);
    const allowed = Number(inv.usesAllowed || COMMUNITY_INVITE_DEFAULT_USES);
    if (used >= allowed) {
      throw new HttpsError('resource-exhausted', 'Invite has no uses remaining.');
    }
    // A member's own link must not credit themselves.
    if (inv.createdByUid && inv.createdByUid === uid) {
      throw new HttpsError('failed-precondition', 'You can\'t join with your own invite link.');
    }
    const usedBy = Array.isArray(inv.usedBy) ? inv.usedBy : [];
    if (usedBy.includes(uid)) {
      return { alreadyAccepted: true, inviterUid: inv.createdByUid || null };
    }
    tx.update(ref, {
      usesUsed: used + 1,
      usedBy: admin.firestore.FieldValue.arrayUnion(uid),
      lastAcceptedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { alreadyAccepted: false, inviterUid: inv.createdByUid || null };
  });

  // Stamp the accepting user's doc with referral info. `invitedByUid` is
  // denormalized so the activation credit in submitOnboarding doesn't need a
  // second lookup. Best-effort — the token alone is enough to recover from.
  try {
    await db.collection('users').doc(uid).set({
      invitedByToken: token,
      invitedByUid: result.inviterUid || null,
      invitedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) { /* tolerated */ }

  // inviterUid stays server-side — the accepting user has no business knowing
  // which account owns the link they followed.
  const { inviterUid, ...clientResult } = result;
  return { ok: true, ...clientResult };
});

// ────────────────────────────────────────────────────────────────
// Member referral codes.
//
// Every member gets ONE stable invite token, minted on first request and
// recorded at users/{uid}.referralToken so the same link comes back forever —
// a fresh token per click would scatter one member's referrals across several
// codes and break their score. The token is an ordinary communityInvites doc
// tagged kind:'member', so /signup.html?invite=<token> and
// acceptCommunityInvite work on it unchanged.
//
// Scoring is deliberately split from joining: the inviter earns
// REFERRAL_POINTS when a referred member *activates* (finishes onboarding),
// not when the account is created. Crediting at signup would pay out for
// throwaway addresses, which is exactly how referral leaderboards get gamed.
// ────────────────────────────────────────────────────────────────

const MEMBER_INVITE_USES = 500;
const MEMBER_INVITE_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000; // effectively no expiry

/**
 * getMyReferralCode() — any authenticated member.
 * Returns { token, url, joined, activated, pointsEarned, pointsPerReferral },
 * minting the caller's stable token on first call.
 */
exports.getMyReferralCode = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const invites = db.collection('communityInvites');

  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('failed-precondition', 'Finish creating your account first.');
  }
  const u = userSnap.data() || {};

  let token = (u.referralToken || '').toString().trim() || null;
  let inviteSnap = token ? await invites.doc(token).get() : null;

  if (!inviteSnap || !inviteSnap.exists) {
    // Minting is the only expensive path, so it's the only one throttled —
    // repeat panel loads on an existing code stay free.
    await rateLimitCaller(db, request, { action: 'getMyReferralCode', max: 10, windowSec: 3600 });

    let candidate = makeInviteToken();
    for (let i = 0; i < 3; i++) {
      const probe = await invites.doc(candidate).get();
      if (!probe.exists) break;
      candidate = makeInviteToken();
    }

    // Claim the token on the user doc transactionally so two concurrent calls
    // can't hand the same member two different codes.
    token = await db.runTransaction(async (tx) => {
      const s = await tx.get(userRef);
      const existing = s.exists ? ((s.data().referralToken || '').toString().trim() || null) : null;
      if (existing) return existing;
      tx.set(userRef, { referralToken: candidate }, { merge: true });
      return candidate;
    });

    inviteSnap = await invites.doc(token).get();
    if (!inviteSnap.exists) {
      await invites.doc(token).set({
        token,
        kind: 'member',
        createdByUid: uid,
        createdByName: u.displayName || u.email || 'Member',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + MEMBER_INVITE_TTL_MS),
        usesAllowed: MEMBER_INVITE_USES,
        usesUsed: 0,
        usedBy: [],
        activatedCount: 0,
        activatedBy: []
      });
      inviteSnap = await invites.doc(token).get();
    }
  }

  const inv = inviteSnap.data() || {};
  const activated = Number(inv.activatedCount || 0);
  return {
    ok: true,
    token,
    url: `${APP_BASE_URL}/signup.html?invite=${encodeURIComponent(token)}`,
    joined: Number(inv.usesUsed || 0),
    activated,
    pointsEarned: activated * REFERRAL_POINTS,
    pointsPerReferral: REFERRAL_POINTS
  };
});

/**
 * Credit the referrer once a member they invited finishes onboarding.
 *
 * Idempotent twice over — guarded by users/{uid}.referralCredited and by the
 * invite doc's activatedBy array — so replaying it awards nothing. Returns the
 * credited uid, or null when there was nothing to credit.
 */
async function creditReferralOnActivation(db, uid, userData) {
  const u = userData || {};
  if (u.referralCredited === true) return null;
  const token = (u.invitedByToken || '').toString().trim();
  if (!token) return null;

  const inviteRef = db.collection('communityInvites').doc(token);
  const userRef = db.collection('users').doc(uid);
  const FV = admin.firestore.FieldValue;

  const inviterUid = await db.runTransaction(async (tx) => {
    const [invSnap, meSnap] = await Promise.all([tx.get(inviteRef), tx.get(userRef)]);
    if (!invSnap.exists) return null;
    if (meSnap.exists && meSnap.data().referralCredited === true) return null;

    const inv = invSnap.data() || {};
    const owner = inv.createdByUid || null;
    if (!owner || owner === uid) return null; // no self-referral
    const already = Array.isArray(inv.activatedBy) ? inv.activatedBy : [];
    if (already.includes(uid)) return null;

    tx.set(inviteRef, {
      activatedCount: FV.increment(1),
      activatedBy: FV.arrayUnion(uid),
      lastActivatedAt: FV.serverTimestamp()
    }, { merge: true });
    tx.set(userRef, {
      referralCredited: true,
      referralCreditedAt: FV.serverTimestamp()
    }, { merge: true });
    return owner;
  });

  if (!inviterUid) return null;
  await applyPointsDelta(db, inviterUid, REFERRAL_POINTS, { referralCount: 1 });
  return inviterUid;
}

// ════════════════════════════════════════════════════════════════
// Private channels — membership and access requests.
//
// A channel has two independent flags:
//   listed     — appears in everyone's sidebar
//   visibility — 'private' means only memberUids (plus staff) read its posts
//
// Private-channel posts live at channels/{key}/posts/** so the rules can gate a
// whole query on the path. Membership itself is written ONLY from here: the
// channels/{key} doc is owner-only writable in rules, and the Admin SDK bypasses
// that, which is what allows admins — not just the owner — to approve requests.
// ════════════════════════════════════════════════════════════════

/** Every owner/admin uid, for fan-out of request notifications. */
async function staffUids(db) {
  const out = new Set();
  try {
    const snap = await db.collection('users').where('role', 'in', ['owner', 'admin']).get();
    snap.forEach((d) => out.add(d.id));
  } catch (e) {
    console.warn('[channels] staffUids lookup failed', e && e.message);
  }
  return Array.from(out);
}

/**
 * backfillChannelDefaults() — owner only, safe to re-run.
 *
 * Writes `visibility: 'public'` and `listed: true` onto every channel doc that
 * is missing them. This MUST run before the tightened channels/{key} list rule
 * is relied upon: that rule matches `listed == true`, and Firestore's equality
 * operators skip documents where the field is ABSENT — so without the backfill
 * every pre-existing channel would drop out of the sidebar for non-staff.
 */
exports.backfillChannelDefaults = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  if (!isOwnerClaim) throw new HttpsError('permission-denied', 'Owner only.');

  const db = admin.firestore();
  const snap = await db.collection('channels').get();
  const batch = db.batch();
  let patched = 0;
  const touched = [];

  snap.forEach((d) => {
    const c = d.data() || {};
    const patch = {};
    if (typeof c.visibility !== 'string') patch.visibility = 'public';
    if (typeof c.listed !== 'boolean') patch.listed = true;
    if (!Array.isArray(c.memberUids)) patch.memberUids = [];
    if (Object.keys(patch).length) {
      batch.set(d.ref, patch, { merge: true });
      patched += 1;
      touched.push(d.id);
    }
  });

  if (patched) await batch.commit();
  return { ok: true, total: snap.size, patched, channels: touched };
});

/**
 * requestChannelAccess({ channelKey }) — any authenticated member.
 *
 * Records a pending request and notifies staff. No-ops when the caller is
 * already a member or already has a pending request, so a double tap is free.
 */
exports.requestChannelAccess = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const channelKey = String((request.data && request.data.channelKey) || '').trim();
  if (!channelKey) throw new HttpsError('invalid-argument', 'channelKey is required.');

  const db = admin.firestore();
  await rateLimitCaller(db, request, { action: 'requestChannelAccess', max: 10, windowSec: 3600 });

  const chanRef = db.collection('channels').doc(channelKey);
  const chanSnap = await chanRef.get();
  if (!chanSnap.exists) throw new HttpsError('not-found', 'Channel not found.');
  const chan = chanSnap.data() || {};
  if (chan.visibility !== 'private') {
    throw new HttpsError('failed-precondition', 'That channel is already open to everyone.');
  }
  const members = Array.isArray(chan.memberUids) ? chan.memberUids : [];
  if (members.includes(uid)) return { ok: true, alreadyMember: true };

  const reqRef = chanRef.collection('requests').doc(uid);
  const existing = await reqRef.get();
  if (existing.exists && (existing.data() || {}).status === 'pending') {
    return { ok: true, alreadyPending: true };
  }

  let displayName = (request.auth.token && request.auth.token.name) || null;
  let avatarUrl = null;
  try {
    const meSnap = await db.collection('users').doc(uid).get();
    if (meSnap.exists) {
      const me = meSnap.data() || {};
      displayName = me.displayName || displayName || me.email || 'Member';
      avatarUrl = me.avatarUrl || null;
    }
  } catch (e) { /* tolerated — the request matters more than the label */ }

  // Application answers, when the channel asks for them. The client owns the
  // question list (see CHANNEL_ACCESS_FORMS in public/js/community.js) and sends
  // the question text alongside each answer, so a later rewording doesn't
  // relabel what someone already submitted. This end only enforces bounds —
  // count and length — so a crafted payload can't bloat the doc. The content is
  // shown to staff and escaped on render; it grants nothing.
  const rawAnswers = Array.isArray(request.data && request.data.answers)
    ? request.data.answers
    : [];
  const answers = rawAnswers
    .slice(0, 12)
    .map((a) => ({
      question: String((a && a.question) || '').trim().slice(0, 200),
      answer: String((a && a.answer) || '').trim().slice(0, 2000)
    }))
    .filter((a) => a.question && a.answer);

  await reqRef.set({
    uid,
    displayName: displayName || 'Member',
    avatarUrl,
    status: 'pending',
    channelKey,
    answers,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  // Fan out to staff through the same inbox the topbar bell already renders.
  const recipients = await staffUids(db);
  await Promise.all(recipients.filter((r) => r !== uid).map((r) => notifyUser(db, r, {
    id: `chanreq_${channelKey}_${uid}`,
    type: 'channel_request',
    fromUid: uid,
    fromName: displayName || 'Member',
    fromAvatar: avatarUrl,
    category: channelKey,
    channelName: chan.name || channelKey,
    answerCount: answers.length,
    preview: answers.length
      ? `wants access to ${chan.name || channelKey} — ${answers.length} answer${answers.length === 1 ? '' : 's'} to review`
      : `wants access to ${chan.name || channelKey}`
  }).catch(() => null)));

  return { ok: true, pending: true };
});

/**
 * decideChannelAccess({ channelKey, uid, approve }) — owner/admin only.
 * Approving adds the uid to memberUids; either way the requester is notified.
 */
exports.decideChannelAccess = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const channelKey = String((request.data && request.data.channelKey) || '').trim();
  const targetUid = String((request.data && request.data.uid) || '').trim();
  const approve = request.data && request.data.approve === true;
  if (!channelKey || !targetUid) {
    throw new HttpsError('invalid-argument', 'channelKey and uid are required.');
  }

  const chanRef = db.collection('channels').doc(channelKey);
  const chanSnap = await chanRef.get();
  if (!chanSnap.exists) throw new HttpsError('not-found', 'Channel not found.');
  const chan = chanSnap.data() || {};
  const deciderUid = request.auth.uid;
  const FV = admin.firestore.FieldValue;

  if (approve) {
    await chanRef.set({
      memberUids: FV.arrayUnion(targetUid),
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
  }
  await chanRef.collection('requests').doc(targetUid).set({
    status: approve ? 'approved' : 'denied',
    decidedAt: FV.serverTimestamp(),
    decidedBy: deciderUid
  }, { merge: true });

  await notifyUser(db, targetUid, {
    id: `chandec_${channelKey}_${targetUid}_${approve ? 'a' : 'd'}`,
    type: approve ? 'channel_access_granted' : 'channel_access_denied',
    fromUid: deciderUid,
    fromName: (request.auth.token && request.auth.token.name) || 'The team',
    fromAvatar: null,
    category: channelKey,
    channelName: chan.name || channelKey,
    preview: approve
      ? `You now have access to ${chan.name || channelKey}`
      : `Your request for ${chan.name || channelKey} was not approved`
  }).catch(() => null);

  return { ok: true, approved: approve };
});

/**
 * removeChannelMember({ channelKey, uid }) — owner/admin only.
 *
 * Revokes access going forward. It does NOT retract anything the member already
 * read, and their existing posts stay in the channel.
 */
exports.removeChannelMember = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const channelKey = String((request.data && request.data.channelKey) || '').trim();
  const targetUid = String((request.data && request.data.uid) || '').trim();
  if (!channelKey || !targetUid) {
    throw new HttpsError('invalid-argument', 'channelKey and uid are required.');
  }
  const FV = admin.firestore.FieldValue;
  const chanRef = db.collection('channels').doc(channelKey);
  await chanRef.set({
    memberUids: FV.arrayRemove(targetUid),
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
  // Clear any decided request so they can ask again later.
  try { await chanRef.collection('requests').doc(targetUid).delete(); } catch (e) { /* tolerated */ }
  return { ok: true };
});

// ────────────────────────────────────────────────────────────────
// Search (Stage 2 — topbar search overlay).
//
// Server-side substring match on the latest N posts visible to the
// caller. Bounded by a hard limit so an unbounded query can't drain
// reads. Pairs with the existing searchMembers callable on the
// frontend (called in parallel) to populate the topbar overlay.
// ────────────────────────────────────────────────────────────────

const SEARCH_POSTS_POOL = 200;       // recent posts inspected per call
const SEARCH_POSTS_RESULTS = 10;     // results returned

exports.searchPosts = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const data = request.data || {};
  const q = (data.query || '').toString().trim().toLowerCase();
  if (!q) return { ok: true, results: [] };
  if (q.length < 2) return { ok: true, results: [] };

  const isOwnerClaim = request.auth.token && request.auth.token.role === 'owner';
  const db = admin.firestore();

  let callerCompanyId = null;
  if (!isOwnerClaim) {
    try {
      const meSnap = await db.collection('users').doc(callerUid).get();
      if (meSnap.exists) callerCompanyId = meSnap.data().companyId || null;
    } catch (e) { /* tolerated */ }
  }

  const pool = [];
  const seen = new Set();
  function add(d) {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    pool.push({ id: d.id, ...d.data() });
  }

  try {
    if (isOwnerClaim) {
      const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get();
      snap.docs.forEach(add);
    } else if (callerCompanyId) {
      const [companySnap, globalSnap] = await Promise.all([
        db.collection('posts').where('companyId', '==', callerCompanyId).orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get(),
        db.collection('posts').where('companyId', '==', null).orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get()
      ]);
      companySnap.docs.forEach(add);
      globalSnap.docs.forEach(add);
    } else {
      const snap = await db.collection('posts').where('companyId', '==', null).orderBy('createdAt', 'desc').limit(SEARCH_POSTS_POOL).get();
      snap.docs.forEach(add);
    }
  } catch (err) {
    console.error('[searchPosts] pool fetch failed:', err && err.message);
    return { ok: false, results: [] };
  }

  const results = pool
    .filter((p) => {
      const text = (p.text || '').toLowerCase();
      const author = (p.authorName || '').toLowerCase();
      return text.includes(q) || author.includes(q);
    })
    .sort((a, b) => {
      // Title-text matches first, then author matches; within each group,
      // recency (descending createdAt).
      const at = (a.text || '').toLowerCase().includes(q) ? 0 : 1;
      const bt = (b.text || '').toLowerCase().includes(q) ? 0 : 1;
      if (at !== bt) return at - bt;
      const am = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const bm = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return bm - am;
    })
    .slice(0, SEARCH_POSTS_RESULTS)
    .map((p) => ({
      id: p.id,
      text: (p.text || '').slice(0, 200),
      authorName: p.authorName || 'Unknown',
      authorUid: p.authorUid || null,
      authorAvatar: p.authorAvatar || null,
      category: p.category || 'general',
      createdAt: p.createdAt && p.createdAt.toMillis ? p.createdAt.toMillis() : null,
      likeCount: p.likeCount || 0,
      commentCount: p.commentCount || 0
    }));

  return { ok: true, results };
});





// ────────────────────────────────────────────────────────────────
// Course commerce — enrollment + Stripe checkout.
//
// Stripe keys come from Secret Manager, declared as stripeSecretKey /
// stripeWebhookSecret above and injected into process.env for the functions
// that list STRIPE_SECRETS in their `secrets:` option:
//   STRIPE_SECRET_KEY      — sk_live_... / sk_test_...
//   STRIPE_WEBHOOK_SECRET  — whsec_... (from the webhook endpoint config)
// Do NOT use functions/.env for these: it is git-ignored, so the CI deploy
// would drop them on the next merge. Until they're set, paid checkout returns
// a clear "not configured" error while free enrollment keeps working.
// ────────────────────────────────────────────────────────────────

let _stripeClient = null;
function getStripe() {
  const key = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!key) return null;
  if (!_stripeClient) {
    // Lazy require so deploys work before the dependency/key are exercised.
    _stripeClient = require('stripe')(key);
  }
  return _stripeClient;
}

async function isAdminCaller(db, request) {
  const uid = request.auth && request.auth.uid;
  if (!uid) return false;
  if (request.auth.token && request.auth.token.role === 'owner') return true;
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists && snap.data().role === 'admin';
}

function effectivePriceDollars(course) {
  const base = typeof course.price === 'number' ? course.price : null;
  const sale = typeof course.salePrice === 'number' && course.salePrice >= 0 ? course.salePrice : null;
  if (sale != null && base != null && sale < base) return sale;
  return base;
}

// resolveCoupon — validate a coupons/{CODE} doc against one item and return
// the discounted price. Firestore is the single source of truth: no Stripe
// coupon objects are involved, so deactivating or expiring a code here takes
// effect immediately. Throws HttpsError with a buyer-facing message on any
// failure so callers can surface it directly.
//
// Scoping: `appliesTo` is null (legacy — valid for every course), or
// { kind: 'course'|'product', ids: [] } where an empty ids list means every
// item of that kind.
async function resolveCoupon(db, rawCode, { kind, id, priceDollars }) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;
  const snap = await db.collection('coupons').doc(code).get();
  if (!snap.exists) throw new HttpsError('not-found', 'That promo code isn\'t recognized.');
  const c = snap.data();
  if (c.active === false) {
    throw new HttpsError('failed-precondition', 'That promo code is no longer active.');
  }
  const expires = c.expiresAt && c.expiresAt.toDate ? c.expiresAt.toDate().getTime()
    : (c.expiresAt ? new Date(c.expiresAt).getTime() : null);
  if (expires && Date.now() > expires) {
    throw new HttpsError('failed-precondition', 'That promo code has expired.');
  }
  if (c.maxRedemptions && Number(c.redemptions || 0) >= Number(c.maxRedemptions)) {
    throw new HttpsError('resource-exhausted', 'That promo code has reached its limit.');
  }
  const scope = c.appliesTo || null;
  if (scope) {
    const kindOk = scope.kind === kind;
    const idOk = !Array.isArray(scope.ids) || scope.ids.length === 0 || scope.ids.includes(id);
    if (!kindOk || !idOk) {
      throw new HttpsError('failed-precondition', 'That promo code doesn\'t apply to this item.');
    }
  } else if (kind !== 'course') {
    // Legacy unscoped coupons predate products and were sold against courses.
    throw new HttpsError('failed-precondition', 'That promo code doesn\'t apply to this item.');
  }
  const pct = typeof c.percentOff === 'number' ? c.percentOff : null;
  const amt = typeof c.amountOff === 'number' ? c.amountOff : null;
  let discounted;
  if (pct != null) discounted = priceDollars * (1 - pct / 100);
  else if (amt != null) discounted = priceDollars - amt;
  else throw new HttpsError('failed-precondition', 'That promo code isn\'t set up correctly.');
  discounted = Math.max(0, Math.round(discounted * 100) / 100);
  return { code, percentOff: pct, amountOff: amt, discountedDollars: discounted, isFree: discounted <= 0 };
}

// countCouponRedemption — bump the usage counter. Callers are responsible for
// idempotency (the webhook dedupes on stripeEvents/{eventId}; the free-comp
// path runs once per enrollment because a second call hits already-exists).
function countCouponRedemption(db, code) {
  return db.collection('coupons').doc(code).set({
    redemptions: admin.firestore.FieldValue.increment(1),
    lastRedeemedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

// The legacy 1P-CLC player (store.js) saved progress under bare module ids
// ('0'…'6'); every Firestore-authored course namespaces its docs as
// `{slug}__m{id}` (course-renderer.js). Only the bare ids prove pre-enrollment
// CLC history — a namespaced doc is some other course's progress, and counting
// it here once handed the paid Leader Coach course to anyone who finished one
// lesson of anything (an icant beta tester, for instance).
function isLegacyClcProgressId(id) {
  return !String(id).includes('__');
}

// enrollFree — server-side enrollment for free (or legacy) courses. All
// client enrollment goes through here; firestore rules freeze
// enrolledCourseSlugs on self-writes.
/**
 * saveCourseCommitment — the course commitment questionnaire (/commit.html).
 * Validates and stores users/{uid}/courseCommitments/{slug}; the member must
 * hold the course. Saving again (editing the plan) re-arms the one-time
 * deadline check-in, so a reset deadline gets its own.
 */
exports.saveCourseCommitment = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const data = request.data || {};
  const slug = String(data.slug || '').trim();
  if (!slug || slug.length > 120 || slug.includes('/')) throw new HttpsError('invalid-argument', 'slug is required.');

  const timezone = String(data.timezone || 'America/New_York').slice(0, 64);
  const clock = commitmentLocalClock(new Date(), timezone);
  if (!clock) throw new HttpsError('invalid-argument', 'Unrecognized timezone.');

  const v = validateCommitmentInput(data, clock.date);
  if (v.error) throw new HttpsError('invalid-argument', v.error);

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const slugs = (userSnap.exists && userSnap.data().enrolledCourseSlugs) || [];
  if (!Array.isArray(slugs) || !slugs.includes(slug)) {
    throw new HttpsError('permission-denied', 'Enroll in this course first.');
  }

  const FV = admin.firestore.FieldValue;
  const ref = userRef.collection('courseCommitments').doc(slug);
  const prev = await ref.get();
  await ref.set({
    ...v.value,
    timezone,
    courseTitle: String(data.courseTitle || '').slice(0, 160),
    startDate: clock.date,
    active: true,
    deadlineNoticeSent: false,
    updatedAt: FV.serverTimestamp(),
    ...(prev.exists ? {} : { createdAt: FV.serverTimestamp() })
  }, { merge: true });

  return { ok: true };
});

exports.enrollFree = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const slug = String((request.data && request.data.slug) || '').trim();
  if (!slug) throw new HttpsError('invalid-argument', 'slug is required.');

  const db = admin.firestore();
  const courseSnap = await db.collection('courses').doc(slug).get();
  const course = courseSnap.exists ? courseSnap.data() : null;

  // Legacy migration: users with pre-enrollment 1P-CLC progress keep access
  // even though the course is paid. Server-verifies that legacy progress
  // exists — namespaced docs from other courses don't count.
  const legacy = !!(request.data && request.data.legacy) && slug === '1p-clc-leader';
  if (legacy) {
    const prog = await db.collection('users').doc(uid).collection('progress').get();
    const hasLegacy = prog.docs.some((d) => isLegacyClcProgressId(d.id));
    if (!hasLegacy) throw new HttpsError('failed-precondition', 'No prior progress found.');
  } else {
    if (!course) throw new HttpsError('not-found', 'Unknown course.');
    if (course.status !== 'live') {
      throw new HttpsError('failed-precondition', 'This course isn\'t available to join yet.');
    }
    // Free means an explicit price of zero. A missing price used to count as
    // free, which let anyone self-enroll in a paid course whose Firestore
    // record happened not to carry one (the price lived only in the code
    // registry, which the server never reads). Bundle-only courses are never
    // self-enrollable either; their access comes from buying the bundle or
    // from an admin grant.
    if (courseFulfillment(slug, course).sellable === false) {
      throw new HttpsError('failed-precondition', 'This course is included in a bundle and can\'t be joined on its own.');
    }
    const price = effectivePriceDollars(course);
    if (price !== 0) {
      throw new HttpsError('failed-precondition', 'This course requires checkout to enroll.');
    }
  }

  await db.collection('users').doc(uid).set({
    ...(await resolveEnrollmentFields(db, slug, course)),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, slug };
});

// ── Admin grants ────────────────────────────────────────────────────
// Course access without a purchase: beta testers, scholarships, comps that
// should not ship a book. Client writes to enrolledCourseSlugs are frozen by
// the rules, so this is the only non-checkout way in.
//
// If the person has no account yet (most beta applicants), the grant is
// parked in pendingGrants/{emailLower} and applied by onUserCreated the
// moment they sign up, so Anthony can grant from a lead record without
// waiting for them to register first.

function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }

async function findUserByEmail(db, email) {
  const lower = normalizeEmail(email);
  if (!lower) return null;
  let snap = await db.collection('users').where('email', '==', lower).limit(1).get();
  if (snap.empty && lower !== String(email).trim()) {
    snap = await db.collection('users').where('email', '==', String(email).trim()).limit(1).get();
  }
  if (!snap.empty) return snap.docs[0];
  // The profile field can miss an account that exists: stored with capitals
  // (callers pass the lowercased address) or never written at all. Auth
  // matches regardless of case, and a miss here is what parks a grant in
  // pendingGrants for a signup that already happened.
  try {
    const authUser = await admin.auth().getUserByEmail(lower);
    const doc = await db.collection('users').doc(authUser.uid).get();
    if (doc.exists) return doc;
  } catch (e) {
    if (!(e && e.code === 'auth/user-not-found')) {
      console.warn('[findUserByEmail] auth lookup failed for', lower, e && e.message);
    }
  }
  return null;
}

// Enrolls uid in slug (plus whatever the slug unlocks) and records why.
async function applyGrant(db, uid, slug, course, { note, grantedBy }) {
  await db.collection('users').doc(uid).set({
    ...(await resolveEnrollmentFields(db, slug, course)),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await db.collection('users').doc(uid).collection('purchases').doc(`grant-${slug}-${Date.now()}`).set({
    courseSlug: slug,
    amount: 0,
    mode: 'grant',
    note: note || null,
    grantedBy: grantedBy || null,
    status: 'granted',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  // The in-app welcome: the bell row, and the popup the topbar opens the next
  // time they load any page. One id per course, so a re-grant re-raises the
  // same notification instead of stacking a second one. Best-effort: the
  // grant has already landed and must not fail over a notification.
  try {
    const title = (course && course.title) || slug;
    // Comps run through here too, so the beta line is only for real testers.
    const userSnap = await db.collection('users').doc(uid).get();
    const email = normalizeEmail(userSnap.exists ? userSnap.data().email : '');
    const isBeta = !!email && (await db.collection('betaTesters').doc(email).get()).exists;
    await notifyUser(db, uid, {
      id: `course-granted-${slug}`,
      type: 'course_granted',
      title,
      preview: isBeta
        ? "You've been added to this course as a beta tester. It's in your library now, and your feedback shapes the final version."
        : "You've been added to this course. It's in your library now and ready when you are.",
      image: (course && (course.coverImage || course.image)) || null,
      link: `/courses.html?course=${encodeURIComponent(slug)}`
    });
  } catch (e) {
    console.warn('[applyGrant] welcome notification failed for', uid, slug, e && e.message);
  }
}

// ── The invite email that makes a grant real ─────────────────────────────
//
// A grant used to be silent: the enrollment landed and the member was never
// told. Every beta round then ran on a hand-written email per tester, which
// is the step that does not scale. This is that email, sent by the grant.
//
// Two versions, one template. A member who already has an account gets the
// direct link to the course. Someone who does not gets the signup link and
// the one instruction that matters: use this exact address, or the access
// waiting for it will not find them.
function grantEmailContent({ firstName, courseTitle, slug, note, hasAccount }) {
  const name = firstName || 'there';
  const nameHtml = textToHtml(name);
  const titleHtml = textToHtml(courseTitle);
  const noteHtml = textToHtml(note);
  const courseUrl = `${APP_BASE_URL}/courses.html?course=${encodeURIComponent(slug)}`;
  const signupUrl = `${APP_BASE_URL}/signup.html`;

  const subject = `Your access to ${courseTitle} is open`;

  const askText = note
    ? `Where to start: ${note}\n\n`
    : '';
  const askHtml = note
    ? `<p style="margin:0 0 14px;"><strong>Where to start:</strong> ${noteHtml}</p>`
    : '';

  const stepText = hasAccount
    ? `Sign in and open it here:\n${courseUrl}\n\n`
    : `Two steps. Create your account using this email address, then open the course.\n`
      + `1. Create your account: ${signupUrl}\n`
      + `2. Open the course: ${courseUrl}\n\n`
      + `Use this exact email address when you sign up. Your access is attached to it and applies the moment the account exists.\n\n`;

  const stepHtml = hasAccount
    ? `<p style="margin:0 0 22px;"><a href="${courseUrl}" style="display:inline-block;background:#e60306;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;">Open the course</a></p>`
    : `<p style="margin:0 0 10px;">Two steps. Create your account using this email address, then open the course.</p>`
      + `<p style="margin:0 0 14px;"><a href="${signupUrl}" style="display:inline-block;background:#e60306;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;">Create your account</a></p>`
      + `<p style="margin:0 0 22px;font-size:13px;color:#555;">Use this exact email address when you sign up. Your access is attached to it and applies the moment the account exists. Then open the course here: <a href="${courseUrl}" style="color:#155eef;">${courseUrl}</a></p>`;

  const text =
    `Hi ${name},\n\n` +
    `You have access to ${courseTitle}. No payment, nothing to redeem.\n\n` +
    askText +
    stepText +
    `Tell us what lands and what does not. Honest notes are worth more to us than polite ones.\n\n` +
    `Anthony Brown Sr.\n` +
    `Founder, The One Percent Nation\n` +
    `Redefining Success. Realigning Purpose. Releasing Potential.`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;line-height:1.55;">
      <h2 style="color:#000;margin:0 0 12px;font-size:22px;">You're in, ${nameHtml}.</h2>
      <p style="margin:0 0 14px;">You have access to <strong>${titleHtml}</strong>. No payment, nothing to redeem.</p>
      ${askHtml}
      ${stepHtml}
      <p style="margin:0 0 20px;">Tell us what lands and what does not. Honest notes are worth more to us than polite ones.</p>
      <p style="margin:0;">Anthony Brown Sr.<br/>Founder, The One Percent Nation</p>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;"/>
      <p style="color:#888;font-size:11px;margin:0;">Redefining Success. Realigning Purpose. Releasing Potential.</p>
    </div>`;

  return { subject, text, html };
}

// Sends the invite for one grant. Never throws: a grant that landed must not
// be reported as failed because SendGrid was unhappy, so the caller gets a
// boolean and the admin is told to send the link by hand.
// The calling function must declare `secrets: [sendgridKey]`.
async function sendGrantEmail(db, { email, uid, slug, course, note, hasAccount }) {
  const to = normalizeEmail(email);
  if (!EMAIL_RE.test(to)) return false;
  const courseTitle = (course && (course.title || course.short)) || slug;

  let firstName = '';
  let crmArgs = {};
  if (uid) {
    try {
      const uSnap = await db.collection('users').doc(uid).get();
      const u = uSnap.exists ? (uSnap.data() || {}) : {};
      firstName = String(u.displayName || '').trim().split(/\s+/)[0] || '';
      // Routes delivery, open and click events onto the CRM timeline, the
      // same way the welcome email does.
      if (u.crmCompanyId && u.crmContactId) {
        crmArgs = { companyId: u.crmCompanyId, contactId: u.crmContactId };
      }
    } catch (e) { /* name is a nicety, not a blocker */ }
  }

  const { subject, text, html } = grantEmailContent({
    firstName, courseTitle, slug, note, hasAccount
  });

  try {
    await sendEmail({
      to,
      from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
      replyTo: REPLY_TO,
      subject,
      text,
      html,
      customArgs: Object.assign({ type: 'course_grant', slug }, crmArgs)
    });
    return true;
  } catch (err) {
    console.error('[sendGrantEmail] send failed:', String((err && err.message) || err).slice(0, 300));
    return false;
  }
}


// ── Purchase confirmation ────────────────────────────────────────────────
// Stripe sends the receipt; this is the email that tells the buyer where
// their things are: the course, the book in their library, and (print
// bundle) that the paperback is on its way. Same voice as the grant email.
function purchaseEmailContent({ firstName, courseTitle, courseSlug, books, shipsBook, shipping }) {
  const name = firstName || 'there';
  const nameHtml = textToHtml(name);
  const titleHtml = textToHtml(courseTitle);
  const courseUrl = `${APP_BASE_URL}/courses.html?course=${encodeURIComponent(courseSlug)}`;
  const libraryUrl = `${APP_BASE_URL}/library`;
  const list = (books || []).filter((b) => b && b.title);
  const bookNames = list.map((b) => b.title);
  const bookLine = bookNames.length === 1 ? bookNames[0]
    : bookNames.length ? bookNames.slice(0, -1).join(', ') + ' and ' + bookNames[bookNames.length - 1] : '';
  const addr = shipping && shipping.address ? shipping.address : null;
  const place = addr ? [addr.city, addr.state].filter(Boolean).join(', ') : '';

  const subject = `You're in: ${courseTitle}`;

  const bookText = bookLine
    ? `Your book, ${bookLine}, is in your library now. It reads like a Kindle on your phone, tablet or laptop, and every module of the course opens it at that chapter:\n${libraryUrl}\n\n`
    : '';
  const bookHtml = bookLine
    ? `<p style="margin:0 0 6px;"><strong>Your book is in your library.</strong> ${textToHtml(bookLine)} reads like a Kindle on your phone, tablet or laptop, and every module of the course opens it at that chapter.</p>`
      + `<p style="margin:0 0 22px;"><a href="${libraryUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;">Open my library</a></p>`
    : '';
  const shipText = shipsBook
    ? (place
      ? `Your paperback ships to ${place}. We will email you when it is on its way.\n\n`
      : `Your paperback is on its way. We did not get a shipping address from checkout; reply to this email with one and we will send it out.\n\n`)
    : '';
  const shipHtml = shipsBook
    ? `<p style="margin:0 0 22px;">${place
      ? `<strong>Your paperback ships to ${textToHtml(place)}.</strong> We will email you when it is on its way.`
      : `<strong>Your paperback is on its way.</strong> We did not get a shipping address from checkout; reply to this email with one and we will send it out.`}</p>`
    : '';

  const text =
    `Hi ${name},\n\n` +
    `You're in. ${courseTitle} is open for you now. Read the chapter, then do its module; your answers are saved as you go.\n` +
    `${courseUrl}\n\n` +
    bookText +
    shipText +
    `Where you start does not get the final say on where you end up. Get to Chapter 1.\n\n` +
    `Anthony Brown Sr.\n` +
    `Founder, The One Percent Nation\n` +
    `Redefining Success. Realigning Purpose. Releasing Potential.`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;line-height:1.55;">
      <h2 style="color:#000;margin:0 0 12px;font-size:22px;">You're in, ${nameHtml}.</h2>
      <p style="margin:0 0 14px;"><strong>${titleHtml}</strong> is open for you now. Read the chapter, then do its module; your answers are saved as you go.</p>
      <p style="margin:0 0 22px;"><a href="${courseUrl}" style="display:inline-block;background:#e60306;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;">Open the course</a></p>
      ${bookHtml}
      ${shipHtml}
      <p style="margin:0 0 20px;">Where you start does not get the final say on where you end up. Get to Chapter 1.</p>
      <p style="margin:0;">Anthony Brown Sr.<br/>Founder, The One Percent Nation</p>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;"/>
      <p style="color:#888;font-size:11px;margin:0;">Redefining Success. Realigning Purpose. Releasing Potential.</p>
    </div>`;

  return { subject, text, html };
}

// Never throws: the purchase landed whether or not the email did. Returns
// true when sent. The calling function must declare `secrets: [sendgridKey]`.
async function sendPurchaseEmail(db, { email, uid, courseSlug, landingSlug, grantsBooks, shipsBook, shipping }) {
  const to = normalizeEmail(email);
  if (!EMAIL_RE.test(to)) return false;
  try {
    const [courseSnap, uSnap, bookSnaps] = await Promise.all([
      db.collection('courses').doc(courseSlug).get(),
      uid ? db.collection('users').doc(uid).get() : Promise.resolve(null),
      Promise.all((grantsBooks || []).map((id) => db.collection('books').doc(id).get()))
    ]);
    const course = courseSnap.exists ? courseSnap.data() : {};
    const u = uSnap && uSnap.exists ? (uSnap.data() || {}) : {};
    const firstName = String(u.displayName || '').trim().split(/\s+/)[0] || '';
    const crmArgs = (u.crmCompanyId && u.crmContactId)
      ? { companyId: u.crmCompanyId, contactId: u.crmContactId } : {};
    const books = bookSnaps.filter((b) => b.exists).map((b) => ({ id: b.id, title: b.data().title || b.id }));

    const { subject, text, html } = purchaseEmailContent({
      firstName,
      courseTitle: course.title || course.short || courseSlug,
      courseSlug: landingSlug || courseSlug,
      books, shipsBook, shipping
    });
    await sendEmail({
      to,
      from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
      replyTo: REPLY_TO,
      subject, text, html,
      customArgs: Object.assign({ type: 'course_purchase', slug: courseSlug }, crmArgs)
    });
    return true;
  } catch (err) {
    console.error('[sendPurchaseEmail] send failed:', String((err && err.message) || err).slice(0, 300));
    return false;
  }
}

// `secrets` is required, not optional: this sends the invite email through
// sendGrantEmail, which reads sendgridKey.value().
exports.grantCourseAccess = onCall({ secrets: [sendgridKey] }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admins only.');

  const email = normalizeEmail(request.data && request.data.email);
  const slug = String((request.data && request.data.slug) || '').trim();
  const note = String((request.data && request.data.note) || '').trim().slice(0, 200) || null;
  // Default on: a grant nobody is told about is the problem this replaces.
  const notify = !(request.data && request.data.notify === false);
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email.');
  if (!slug) throw new HttpsError('invalid-argument', 'slug is required.');

  const courseSnap = await db.collection('courses').doc(slug).get();
  if (!courseSnap.exists) throw new HttpsError('not-found', 'Unknown course.');
  const course = courseSnap.data();
  const grantedBy = (request.auth.token && request.auth.token.email) || uid;

  const userDoc = await findUserByEmail(db, email);
  if (userDoc) {
    await applyGrant(db, userDoc.id, slug, course, { note, grantedBy });
    // Keeps the beta console truthful when a grant is issued from the course
    // builder instead of the console. No-ops for anyone who isn't a tester.
    await markBetaGranted(db, email, { slug, grantedBy, note, applied: true });
    await markBetaActivated(db, email, userDoc.id);
    // The grant is the deliverable; the email is best-effort on top of it.
    const emailed = notify
      ? await sendGrantEmail(db, {
          email, uid: userDoc.id, slug, course, note, hasAccount: true
        })
      : null;
    return { ok: true, applied: true, email, emailed };
  }

  await db.collection('pendingGrants').doc(email).set({
    email,
    slugs: admin.firestore.FieldValue.arrayUnion(slug),
    notes: admin.firestore.FieldValue.arrayUnion(`${slug}: ${note || 'granted'}`),
    grantedBy,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await markBetaGranted(db, email, { slug, grantedBy, note, applied: false });

  // Nobody to sign in yet, so the invite carries the signup link instead.
  const emailed = notify
    ? await sendGrantEmail(db, { email, uid: null, slug, course, note, hasAccount: false })
    : null;
  return { ok: true, applied: false, pending: true, email, emailed };
});

// Called from onUserCreated: apply anything parked for this email.
//
// No email is sent from here on purpose. The invite already went out when the
// grant was parked, carrying both steps (create the account, then open the
// course) and the direct course link, and onUserCreated sends the welcome
// email a moment later. A third message would say nothing the tester does not
// already have. It also means a grant made silently stays silent all the way
// through signup, which is what the admin asked for when they chose that.
async function applyPendingGrants(db, uid, email) {
  const lower = normalizeEmail(email);
  if (!lower) return 0;
  const ref = db.collection('pendingGrants').doc(lower);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const pg = snap.data();
  const slugs = Array.isArray(pg.slugs) ? pg.slugs : [];
  for (const slug of slugs) {
    const cSnap = await db.collection('courses').doc(slug).get();
    await applyGrant(db, uid, slug, cSnap.exists ? cSnap.data() : null,
      { note: 'applied from pending grant at signup', grantedBy: pg.grantedBy || null });
  }
  await ref.delete();
  return slugs.length;
}

// ── Beta program ────────────────────────────────────────────────────
// The beta was spread across three systems that never spoke to each other:
// applications landed in the CRM as leads tagged "Beta Tester", access was
// granted by hand through grantCourseAccess, and feedback arrived as generic
// bug reports. Nothing recorded whether an applicant had been approved,
// whether they ever signed up, or whether they had said anything back, so the
// cohort could only be reconstructed from memory.
//
// betaTesters/{emailLower} is that missing record. It is written only by the
// Admin SDK — the application hook below, the grant path, signup, and the
// feedback hook — and read by the beta console through listBetaTesters.
//
// Status ladder, in order:
//   applied   — submitted the form, no decision yet
//   declined  — turned down; kept so they aren't re-invited by accident
//   granted   — approved and course access issued (or parked in pendingGrants)
//   active    — has a portal account, so the grant is really in their hands
//   completed — finished the beta
// The ladder only moves forward: a later signal never demotes someone who has
// already progressed, so a stray feedback write can't knock a completed tester
// back to active.

const BETA_DEFAULT_SLUG = 'icant';
const BETA_STATUS_RANK = { applied: 0, declined: 1, granted: 2, active: 3, completed: 4 };

function betaTesterRef(db, email) {
  const lower = normalizeEmail(email);
  return lower ? db.collection('betaTesters').doc(lower) : null;
}

/**
 * The courses a tester is testing.
 *
 * Records written before the beta went multi-course carry a scalar
 * `courseSlug`. Nothing migrates them, so this is the only place in the
 * codebase that knows both shapes exist; everything else asks for a list.
 */
function testerSlugs(t) {
  if (!t) return [];
  if (Array.isArray(t.courseSlugs) && t.courseSlugs.length) {
    return t.courseSlugs.map(String).filter(Boolean);
  }
  return t.courseSlug ? [String(t.courseSlug)] : [];
}

/** A caller's requested course list, deduped and trimmed, or `fallback`. */
function normalizeSlugList(input, fallback) {
  const raw = Array.isArray(input) ? input : (input ? [input] : []);
  const out = [];
  raw.forEach((v) => {
    const slug = String(v || '').trim();
    if (slug && !out.includes(slug)) out.push(slug);
  });
  return out.length ? out : (fallback || []).slice();
}

/**
 * Which of `removing` may actually be taken away — pure, no Firestore.
 *
 * Enrollment is one shared array on the user: a course somebody bought sits
 * beside one the beta granted, and nothing in that array tells them apart. So a
 * beta decision is only ever allowed to undo a beta grant, and three things
 * block a removal:
 *
 *   1. the beta never granted it — it is not the beta's to take;
 *   2. they paid for it (or comped it with a coupon), so the grant is no longer
 *      the reason they have access;
 *   3. a course they are keeping unlocks it anyway, which makes removing it
 *      incoherent — the bundle would re-imply it on the next write.
 *
 * Rule 3 is also what makes unticking a bundle behave: the bundle goes, and the
 * course it unlocked goes with it only if nothing else holds that course up.
 *
 * A block is not an error. Each one comes back with a reason so the console can
 * say plainly why a course stayed.
 *
 * @param betaGranted   slugs the beta granted (from the tester record)
 * @param keeping       slugs the operator is keeping
 * @param removing      slugs the operator unticked
 * @param paidSlugs     slugs with a non-grant purchase receipt
 * @param enrollsAlsoBy map of slug -> slugs that slug unlocks
 */
function revocableSlugs({ betaGranted, keeping, removing, paidSlugs, enrollsAlsoBy }) {
  const granted = new Set((betaGranted || []).map(String));
  const paid = new Set((paidSlugs || []).map(String));
  const kept = (keeping || []).map(String);
  const also = enrollsAlsoBy || {};

  // Everything the kept courses unlock. Computed once, from the kept set only,
  // so a slug being removed cannot prop itself up through its own fan-out.
  const impliedByKept = new Set();
  kept.forEach((slug) => {
    (also[slug] || []).forEach((k) => impliedByKept.add(String(k)));
  });

  const revoke = [];
  const blocked = [];
  (removing || []).map(String).forEach((slug) => {
    if (!granted.has(slug)) {
      blocked.push({ slug, reason: 'not-beta-granted' });
    } else if (paid.has(slug)) {
      blocked.push({ slug, reason: 'paid' });
    } else if (impliedByKept.has(slug)) {
      blocked.push({ slug, reason: 'unlocked-by-kept-course' });
    } else {
      revoke.push(slug);
    }
  });
  return { revoke, blocked };
}

/**
 * Move a tester to `status`, but never backwards along the ladder.
 * `extra` is merged regardless, so timestamps still land on a no-op move.
 */
async function advanceBetaStatus(db, email, status, extra) {
  const ref = betaTesterRef(db, email);
  if (!ref) return false;
  const snap = await ref.get();
  if (!snap.exists) return false;
  const current = snap.data().status || 'applied';
  const next = (BETA_STATUS_RANK[status] || 0) > (BETA_STATUS_RANK[current] || 0) ? status : current;
  await ref.set({
    ...(extra || {}),
    status: next,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return true;
}

/**
 * Opens or refreshes a tester record.
 *
 * Two callers, one shape: the beta form (`source: 'form'`) and an owner adding
 * somebody by hand from the console (`source: 'manual'`). Everything
 * downstream — the ladder, the console, the feedback count — reads the same
 * record either way and never needs to know which door they came through.
 */
async function recordBetaApplication(db, { name, email, phone, fields, crmContactId },
                                     { source = 'form', addedBy = null, courseSlugs = null } = {}) {
  const ref = betaTesterRef(db, email);
  if (!ref) return;
  const FV = admin.firestore.FieldValue;
  const f = fields || {};
  const snap = await ref.get();
  // Re-applying is not a reset: someone already in the cohort keeps their
  // status and dates, and only their contact details are refreshed. The same
  // holds for a manual add of somebody who already applied.
  await ref.set({
    email: normalizeEmail(email),
    name: name || (snap.exists ? snap.data().name : '') || '',
    phone: phone || null,
    courseName: f.course || null,
    why: f.why || null,
    crmContactId: crmContactId || (snap.exists ? snap.data().crmContactId : null) || null,
    ...(snap.exists ? {} : {
      status: 'applied',
      // `courseSlug` stays written as the first of the list: records predating
      // multi-course carry the scalar, and testerSlugs() reads either shape.
      courseSlugs: normalizeSlugList(courseSlugs, [BETA_DEFAULT_SLUG]),
      courseSlug: normalizeSlugList(courseSlugs, [BETA_DEFAULT_SLUG])[0],
      cohort: null,
      feedbackCount: 0,
      betaGrantedSlugs: [],
      source,
      addedBy,
      appliedAt: FV.serverTimestamp()
    }),
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
}

/**
 * grantCourseAccess hook: an existing tester moves to `granted`.
 *
 * `betaGrantedSlugs` is what makes a later revoke safe — it records the courses
 * the beta itself handed over, so unticking can never reach a course the person
 * bought. It only ever grows here; removals are written by the approve branch.
 */
async function markBetaGranted(db, email, { slug, slugs, grantedBy, note, applied }) {
  const list = normalizeSlugList(slugs || slug, [BETA_DEFAULT_SLUG]);
  return advanceBetaStatus(db, email, 'granted', {
    courseSlugs: admin.firestore.FieldValue.arrayUnion(...list),
    courseSlug: list[0],
    betaGrantedSlugs: admin.firestore.FieldValue.arrayUnion(...list),
    grantedBy: grantedBy || null,
    grantNote: note || null,
    grantPending: !applied,
    grantedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/** onUserCreated hook: the tester now has an account. */
async function markBetaActivated(db, email, uid) {
  return advanceBetaStatus(db, email, 'active', {
    uid: uid || null,
    activatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/** reportBug hook: feedback from a tester counts toward their beta record. */
async function noteBetaFeedback(db, email) {
  const ref = betaTesterRef(db, email);
  if (!ref) return false;
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.set({
    feedbackCount: admin.firestore.FieldValue.increment(1),
    lastFeedbackAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return true;
}

/**
 * Completed modules per course, read the way course-renderer writes them
 * (`{slug}__m{id}`).
 *
 * One read of the progress subcollection covers every course, so a tester
 * testing three courses costs what testing one used to. Besides the count it
 * returns which module ids are done and when the latest one landed, which is
 * what the Progress tab needs to say where somebody is and whether they have
 * gone quiet.
 */
async function progressDetailBySlug(db, uid, slugs) {
  const counts = {};
  const doneIds = {};
  const lastAt = {};
  (slugs || []).forEach((s) => { counts[s] = 0; doneIds[s] = []; lastAt[s] = null; });
  if (!uid || !(slugs || []).length) return { counts, doneIds, lastAt };
  try {
    const snap = await db.collection('users').doc(uid).collection('progress').get();
    snap.docs.forEach((d) => {
      const p = d.data();
      if (p.completed !== true) return;
      const slug = slugs.find((s) => d.id.startsWith(`${s}__m`));
      if (!slug) return;
      counts[slug] += 1;
      const raw = d.id.slice(`${slug}__m`.length);
      doneIds[slug].push(/^\d+$/.test(raw) ? Number(raw) : raw);
      const at = p.completedAt && typeof p.completedAt.toMillis === 'function' ? p.completedAt.toMillis() : null;
      if (at && (!lastAt[slug] || at > lastAt[slug])) lastAt[slug] = at;
    });
  } catch (e) {
    console.warn('[beta] progress read failed for', uid, e && e.message);
  }
  return { counts, doneIds, lastAt };
}

/** Completed module counts per course; see progressDetailBySlug. */
async function countProgressBySlug(db, uid, slugs) {
  return (await progressDetailBySlug(db, uid, slugs)).counts;
}

/**
 * The public rating for a course from its approved reviews — pure.
 * `ratingAvg` is rounded to one decimal, which is all the landing page shows.
 */
function ratingSummary(ratings) {
  const valid = (ratings || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
  if (!valid.length) return { ratingAvg: null, ratingCount: 0 };
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return { ratingAvg: Math.round(avg * 10) / 10, ratingCount: valid.length };
}

function tsMillis(v) {
  return v && typeof v.toMillis === 'function' ? v.toMillis() : null;
}

// listBetaTesters — everything the beta console renders, joined server-side.
//
// The join (tester → user account → progress → feedback) needs reads across
// users/{uid}/progress and bugReports that no client role should hold in bulk,
// and doing it in the browser would be a request per tester. One callable
// keeps both problems out of the front end.
/**
 * What a beta course picker offers.
 *
 * A beta runs on content that has no public face yet, so `beta` and
 * `coming-soon` belong here as much as live ones. Only `inactive` is excluded:
 * granting access to a course closed for its own students helps nobody.
 */
async function betaCourseOptions(db) {
  const snap = await db.collection('courses').get();
  return snap.docs
    .filter((d) => (d.data().status || 'live') !== 'inactive')
    .map((d) => ({
      slug: d.id,
      title: d.data().title || d.id,
      status: d.data().status || 'live'
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// listBetaCourses — the course picker's options, on their own.
//
// The CRM contact card needs the same list, and pulling it from
// listBetaTesters would hand a company admin the whole cohort (every
// applicant's name, note and progress) to render one row of checkboxes.
//
// Given an email it also returns that one tester's courses, so the card can
// show what is already saved instead of an empty picker every time.
exports.listBetaCourses = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admins only.');
  let tester = null;
  const email = normalizeEmail((request.data || {}).email);
  if (EMAIL_RE.test(email)) {
    const snap = await betaTesterRef(db, email).get();
    if (snap.exists) {
      const t = snap.data();
      tester = {
        status: t.status || 'applied',
        courseSlugs: testerSlugs(t),
        betaGrantedSlugs: Array.isArray(t.betaGrantedSlugs) ? t.betaGrantedSlugs : []
      };
    }
  }
  return { ok: true, courses: await betaCourseOptions(db), defaultSlug: BETA_DEFAULT_SLUG, tester };
});

/**
 * One tester, joined: account, per-course enrollment, progress, the goal date
 * they committed to and their review. Shared by listBetaTesters and the CRM
 * card's getBetaTesterSummary so both read the same numbers.
 */
async function buildBetaRow(db, email, t) {
  const slugs = testerSlugs(t);
  if (!slugs.length) slugs.push(BETA_DEFAULT_SLUG);
  // The account may have been created before the record existed (or without
  // triggering the signup hook), so resolve it on read rather than trusting
  // the stored uid alone.
  let accountUid = t.uid || null;
  let lastActiveAt = null;
  if (!accountUid) {
    const userDoc = await findUserByEmail(db, email);
    if (userDoc) accountUid = userDoc.id;
  }
  // Enrollment is per course now: somebody can be testing two and have only
  // one of them actually applied, which is exactly the state worth seeing.
  const enrolledBySlug = {};
  slugs.forEach((sl) => { enrolledBySlug[sl] = false; });
  const commitmentBySlug = {};
  const reviewBySlug = {};
  const completionBySlug = {};
  if (accountUid) {
    const userRef = db.collection('users').doc(accountUid);
    // One batched read for the user, each course's commitment, completion
    // and review, instead of a round trip per course.
    const refs = [userRef];
    slugs.forEach((sl) => {
      refs.push(userRef.collection('courseCommitments').doc(sl));
      refs.push(userRef.collection('courseCompletions').doc(sl));
      refs.push(db.collection('courseReviews').doc(`${sl}__${accountUid}`));
    });
    const snaps = await db.getAll(...refs);
    const userSnap = snaps[0];
    if (userSnap.exists) {
      const u = userSnap.data();
      lastActiveAt = tsMillis(u.lastActiveAt);
      const owned = Array.isArray(u.enrolledCourseSlugs) ? u.enrolledCourseSlugs : [];
      slugs.forEach((sl) => { enrolledBySlug[sl] = owned.includes(sl); });
    }
    slugs.forEach((sl, i) => {
      const c = snaps[1 + i * 3];
      const done = snaps[2 + i * 3];
      const rv = snaps[3 + i * 3];
      if (c.exists && c.data().active !== false) {
        const cd = c.data();
        commitmentBySlug[sl] = {
          goalDate: cd.goalDate || null,
          startDate: cd.startDate || null,
          weeklyMinutes: cd.weeklyMinutes || null
        };
      }
      if (done.exists) completionBySlug[sl] = tsMillis(done.data().completedAt);
      if (rv.exists) {
        const r = rv.data();
        reviewBySlug[sl] = {
          id: rv.id,
          rating: r.rating || null,
          text: r.text || '',
          status: r.status || 'pending',
          createdAt: tsMillis(r.createdAt)
        };
      }
    });
  }
  const progress = await progressDetailBySlug(db, accountUid, slugs);
  const lessonsBySlug = progress.counts;
  return {
    email,
    name: t.name || '',
    phone: t.phone || null,
    status: t.status || 'applied',
    courseSlugs: slugs,
    courseSlug: slugs[0],
    betaGrantedSlugs: Array.isArray(t.betaGrantedSlugs) ? t.betaGrantedSlugs : [],
    courseName: t.courseName || null,
    cohort: t.cohort || null,
    why: t.why || null,
    note: t.note || null,
    crmContactId: t.crmContactId || null,
    grantPending: t.grantPending === true,
    hasAccount: !!accountUid,
    enrolledBySlug,
    enrolled: slugs.every((sl) => enrolledBySlug[sl]),
    lessonsBySlug,
    lessonsCompleted: Object.values(lessonsBySlug).reduce((a, b) => a + b, 0),
    doneIdsBySlug: progress.doneIds,
    lastLessonAtBySlug: progress.lastAt,
    commitmentBySlug,
    completionBySlug,
    reviewBySlug,
    feedbackCount: t.feedbackCount || 0,
    appliedAt: tsMillis(t.appliedAt),
    grantedAt: tsMillis(t.grantedAt),
    activatedAt: tsMillis(t.activatedAt),
    completedAt: tsMillis(t.completedAt),
    lastFeedbackAt: tsMillis(t.lastFeedbackAt),
    lastActiveAt
  };
}

exports.listBetaTesters = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admins only.');

  const snap = await db.collection('betaTesters').orderBy('updatedAt', 'desc').limit(500).get();

  const rows = [];
  for (const d of snap.docs) {
    rows.push(await buildBetaRow(db, d.id, d.data()));
  }

  // Feedback from testers, so beta signal reads separately from general site
  // bugs. Matched on the reporter email recorded by reportBug.
  const emails = new Set(rows.map((r) => r.email));
  const feedback = [];
  if (emails.size) {
    const bugSnap = await db.collection('bugReports').orderBy('createdAt', 'desc').limit(300).get();
    bugSnap.docs.forEach((d) => {
      const b = d.data();
      const reporter = normalizeEmail(b.reportedByEmail);
      if (!reporter || !emails.has(reporter)) return;
      feedback.push({
        id: d.id,
        email: reporter,
        description: b.description || '',
        severity: b.aiSeverity || 'unknown',
        status: b.status || 'open',
        pageUrl: b.pageUrl || '',
        createdAt: tsMillis(b.createdAt)
      });
    });
  }

  const courses = await betaCourseOptions(db);

  const summary = { applied: 0, declined: 0, granted: 0, active: 0, completed: 0 };
  rows.forEach((r) => { if (summary[r.status] != null) summary[r.status] += 1; });

  return {
    ok: true,
    rows,
    feedback,
    courses,
    defaultSlug: BETA_DEFAULT_SLUG,
    summary: {
      ...summary,
      total: rows.length,
      // Everyone past a decision, which is the number the launch call rests on.
      inCohort: rows.filter((r) => r.status !== 'applied' && r.status !== 'declined').length,
      withFeedback: rows.filter((r) => r.feedbackCount > 0).length,
      started: rows.filter((r) => r.lessonsCompleted > 0).length,
      reviewed: rows.filter((r) => Object.keys(r.reviewBySlug || {}).length > 0).length,
      pendingReviews: rows.reduce((n, r) => n + Object.values(r.reviewBySlug || {})
        .filter((v) => v.status === 'pending').length, 0)
    }
  };
});

/**
 * Take back beta-granted courses: the removal half of an approval, shared with
 * turning a tester off from the CRM card. `wanted` is what they keep. Only
 * courses the beta itself granted can go (revocableSlugs), never a purchase
 * or a course a kept bundle unlocks. Returns { revoked, blocked }.
 */
async function revokeBetaSlugs(db, { email, accountUid, betaGranted, wanted, removing, courseDocs, actor }) {
  const FV = admin.firestore.FieldValue;
  let revoked = [];
  let blocked = [];
  if (removing.length) {
    // Courses held by a real purchase or a comped coupon, which a beta
    // decision must never undo.
    const paidSlugs = [];
    if (accountUid) {
      const purchases = await db.collection('users').doc(accountUid).collection('purchases').get();
      purchases.docs.forEach((pd) => {
        const pdata = pd.data();
        const bought = String(pdata.courseSlug || '').trim();
        if (!bought) return;
        // `grant` is the beta's own receipt, so it protects nothing. A refunded
        // or cancelled purchase no longer holds access up either — but a
        // past_due one does: they still have the course, the payment is late.
        if (!['payment', 'subscription', 'comp'].includes(pdata.mode)) return;
        if (['refunded', 'canceled', 'failed', 'revoked'].includes(String(pdata.status || ''))) return;
        paidSlugs.push(bought);
        // Buying a bundle protects what the bundle unlocks, the same way
        // granting one enrolls it.
        const bcs = courseDocs[bought];
        courseFulfillment(bought, bcs || {}).enrollsAlso.forEach((x) => paidSlugs.push(String(x)));
      });
    }
    // What each KEPT course unlocks on its own, so a bundle that is staying
    // keeps the course it implies.
    const enrollsAlsoBy = {};
    for (const sl of wanted) {
      enrollsAlsoBy[sl] = courseFulfillment(sl, courseDocs[sl] || {}).enrollsAlso;
    }

    // Removing a bundle puts what it unlocked on the table too: the operator
    // unticked the thing that put that course in their hands. revocableSlugs
    // still decides — it survives if it was granted in its own right and is
    // still ticked, if it was bought, or if a kept course unlocks it.
    const removingWithFanout = removing.slice();
    for (const sl of removing) {
      const rcs = await db.collection('courses').doc(sl).get();
      courseFulfillment(sl, rcs.exists ? rcs.data() : {}).enrollsAlso.forEach((x) => {
        const implied = String(x);
        if (!removingWithFanout.includes(implied) && !wanted.includes(implied)) {
          removingWithFanout.push(implied);
        }
      });
    }

    const verdict = revocableSlugs({
      betaGranted, keeping: wanted, removing: removingWithFanout, paidSlugs, enrollsAlsoBy
    });
    revoked = verdict.revoke;
    blocked = verdict.blocked;

    if (revoked.length) {
      if (accountUid) {
        await db.collection('users').doc(accountUid).set({
          enrolledCourseSlugs: FV.arrayRemove(...revoked)
        }, { merge: true });
        // The grant receipt stays as history; this is the matching row saying
        // it was taken back, so the purchase trail reads in both directions.
        for (const sl of revoked) {
          await db.collection('users').doc(accountUid).collection('purchases')
            .doc(`revoke-${sl}-${Date.now()}`).set({
              courseSlug: sl,
              amount: 0,
              mode: 'revoke',
              revokedBy: actor,
              status: 'revoked',
              createdAt: FV.serverTimestamp()
            });
        }
      } else {
        // No account yet: the grant is parked, so revoking means unparking it.
        const pgRef = db.collection('pendingGrants').doc(email);
        const pg = await pgRef.get();
        if (pg.exists) {
          const kept = (Array.isArray(pg.data().slugs) ? pg.data().slugs : [])
            .filter((sl) => !revoked.includes(sl));
          if (kept.length) await pgRef.set({ slugs: kept, updatedAt: FV.serverTimestamp() }, { merge: true });
          else await pgRef.delete();
        }
      }
    }
  }
  return { revoked, blocked };
}

// setBetaTesterStatus — the console's write path. Approving issues the course
// grant in the same call, which is what removes the hand-typed prompt chain in
// manage-courses from the workflow.
// `secrets` is required, not optional: approving a tester sends their invite
// through sendGrantEmail, which reads sendgridKey.value() on the SendGrid path.
exports.setBetaTesterStatus = onCall({ secrets: [sendgridKey] }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admins only.');

  const data = request.data || {};
  const email = normalizeEmail(data.email);
  const action = String(data.action || '').trim();
  const note = String(data.note || '').trim().slice(0, 200) || null;
  const cohort = String(data.cohort || '').trim().slice(0, 60) || null;
  // Default on: an approval nobody is told about leaves the tester waiting on
  // an email that never comes, which is the gap this console exists to close.
  const notify = !(data.notify === false);
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'A valid email is required.');
  if (!['add', 'eligible', 'approve', 'decline', 'complete', 'note'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unknown action.');
  }

  const ref = betaTesterRef(db, email);
  let snap = await ref.get();
  const actor = (request.auth.token && request.auth.token.email) || uid;
  const FV = admin.firestore.FieldValue;

  // `add` is the only action that may run without an existing record — it is
  // the one that creates it. Somebody invited directly never fills in the beta
  // form, and granting them the course from the builder writes no record at
  // all, so without this they stay invisible to the console forever.
  //
  // It is deliberately one person at a time: a bulk import of old CRM leads is
  // a different decision, and not this one.
  if (action === 'add') {
    const addName = String(data.name || '').trim().slice(0, 120);
    if (!addName) throw new HttpsError('invalid-argument', 'A name is required.');
    const already = snap.exists;
    await recordBetaApplication(db, {
      name: addName,
      email,
      phone: String(data.phone || '').trim().slice(0, 40) || null,
      fields: note ? { why: note } : {},
      crmContactId: null
    }, { source: 'manual', addedBy: actor, courseSlugs: normalizeSlugList(data.slugs || data.slug, []) });
    snap = await ref.get();
    // Adding and approving in one step is the common case for someone already
    // invited, but it stays opt-in: an add on its own leaves them in
    // Applicants, where the ordinary decision is made.
    if (!(data.approve === true)) {
      return { ok: true, status: snap.data().status || 'applied', added: !already, existed: already };
    }
  }

  // `eligible` is the CRM contact card's toggle: mark a lead as in or out of
  // the beta without leaving their record. Like `add` it may run with no
  // record, because turning it on is what creates one.
  //
  // Turning it off never deletes anything — it moves them to `declined`, the
  // same state the console's Decline button uses, so the history survives and
  // turning it back on restores them. And it refuses outright once they are
  // past a decision: revoking live course access is not something a checkbox
  // on a CRM card should do by accident.
  if (action === 'eligible') {
    const on = data.eligible === true;
    const current = snap.exists ? (snap.data().status || 'applied') : null;

    if (!on) {
      if (!snap.exists) return { ok: true, status: null, eligible: false };
      if (['granted', 'active', 'completed'].includes(current)) {
        // Taking back live access has to be asked for by name, so no caller
        // that only means "untick the lead" can revoke a course by accident.
        // The card sends it after its own confirm.
        if (data.revoke !== true) {
          throw new HttpsError('failed-precondition',
            'They already have beta access. Confirm removing it to turn them off.');
        }
        const tester = snap.data();
        const removing = testerSlugs(tester);
        const betaGranted = Array.isArray(tester.betaGrantedSlugs) ? tester.betaGrantedSlugs : [];
        const userDoc = await findUserByEmail(db, email);
        const accountUid = userDoc ? userDoc.id : tester.uid || null;
        const courseDocs = {};
        for (const sl of removing) {
          const cs = await db.collection('courses').doc(sl).get();
          if (cs.exists) courseDocs[sl] = cs.data();
        }
        const { revoked, blocked } = await revokeBetaSlugs(db, {
          email, accountUid, betaGranted, wanted: [], removing, courseDocs, actor
        });
        await ref.set({
          status: 'declined',
          betaGrantedSlugs: betaGranted.filter((sl) => !revoked.includes(sl)),
          removedFromBetaAt: FV.serverTimestamp(),
          decidedBy: actor,
          decidedAt: FV.serverTimestamp(),
          updatedAt: FV.serverTimestamp()
        }, { merge: true });
        return { ok: true, status: 'declined', eligible: false, revoked, blocked };
      }
      await ref.set({
        status: 'declined',
        decidedBy: actor,
        decidedAt: FV.serverTimestamp(),
        updatedAt: FV.serverTimestamp()
      }, { merge: true });
      return { ok: true, status: 'declined', eligible: false };
    }

    await recordBetaApplication(db, {
      name: String(data.name || '').trim().slice(0, 120),
      email,
      phone: String(data.phone || '').trim().slice(0, 40) || null,
      fields: {},
      crmContactId: String(data.crmContactId || '').trim() || null
    }, { source: 'crm', addedBy: actor, courseSlugs: normalizeSlugList(data.slugs || data.slug, []) });

    // recordBetaApplication only sets courses on a new record, so an explicit
    // pick for somebody already applied would otherwise be dropped silently.
    // Past a decision the courses are the approve branch's to change.
    const picked = normalizeSlugList(data.slugs || data.slug, []);
    if (snap.exists && picked.length && !['granted', 'active', 'completed'].includes(current)) {
      await ref.set({ courseSlugs: picked, courseSlug: picked[0], updatedAt: FV.serverTimestamp() }, { merge: true });
    }

    // Switching the toggle back on is an explicit re-inclusion, so it undoes a
    // previous decline. Anyone further along keeps the status they earned.
    if (current === 'declined') {
      await ref.set({ status: 'applied', updatedAt: FV.serverTimestamp() }, { merge: true });
      return { ok: true, status: 'applied', eligible: true, restored: true };
    }
    const after = await ref.get();
    return { ok: true, status: after.data().status || 'applied', eligible: true, created: !snap.exists };
  }

  if (!snap.exists) throw new HttpsError('not-found', 'No beta record for that email.');
  const tester = snap.data();

  if (action === 'note') {
    await ref.set({ note, cohort: cohort || tester.cohort || null, updatedAt: FV.serverTimestamp() }, { merge: true });
    return { ok: true, status: tester.status || 'applied' };
  }

  if (action === 'decline') {
    // Declining is the one move that may go backwards — an applicant can be
    // turned down — so it is written directly rather than through the ladder.
    await ref.set({
      status: 'declined',
      decidedBy: actor,
      decidedAt: FV.serverTimestamp(),
      note: note || tester.note || null,
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
    return { ok: true, status: 'declined' };
  }

  if (action === 'complete') {
    await advanceBetaStatus(db, email, 'completed', {
      completedAt: FV.serverTimestamp(),
      note: note || tester.note || null
    });
    return { ok: true, status: 'completed' };
  }

  // approve — the ticked courses ARE the tester's courses. Additions are
  // granted through the same path manage-courses uses (so an applicant without
  // an account is parked in pendingGrants and picked up at signup), and
  // anything unticked is revoked, subject to the guards in revocableSlugs.
  const wanted = normalizeSlugList(data.slugs || data.slug, testerSlugs(tester));
  // An empty picker is never a silent full revoke, and the cap is the invite
  // emails: one goes out per newly granted course.
  if (!wanted.length) throw new HttpsError('invalid-argument', 'Pick at least one course.');
  if (wanted.length > 12) throw new HttpsError('invalid-argument', 'That is too many courses for one tester.');

  // Resolve every course up front: a typo in one slug must not leave the
  // tester half-granted.
  const courseDocs = {};
  for (const sl of wanted) {
    const cs = await db.collection('courses').doc(sl).get();
    if (!cs.exists) throw new HttpsError('not-found', `Unknown course "${sl}".`);
    courseDocs[sl] = cs.data();
  }

  // Only courses the beta actually handed over count as held. An applicant's
  // courseSlugs are what they are down to test, not what they have, so
  // treating them as held would make approving an applicant grant nothing.
  const wasGranted = ['granted', 'active', 'completed'].includes(tester.status);
  const previous = wasGranted ? testerSlugs(tester) : [];
  // Records granted before multi-course have no betaGrantedSlugs, so this is
  // empty for them and nothing is revocable until the next approval writes the
  // field. That is deliberate: inferring "the beta must have granted their one
  // course" would be guessing, and the guess is wrong for anyone who signed up
  // and bought it. One re-approval establishes the baseline honestly.
  const betaGranted = Array.isArray(tester.betaGrantedSlugs) ? tester.betaGrantedSlugs : [];
  const additions = wanted.filter((sl) => !previous.includes(sl));
  const removing = previous.filter((sl) => !wanted.includes(sl));

  const grantNote = note || 'beta tester';
  const userDoc = await findUserByEmail(db, email);
  const accountUid = userDoc ? userDoc.id : tester.uid || null;
  let applied = false;

  // ── Grant the additions ───────────────────────────────────────────────
  if (userDoc) {
    for (const sl of additions) {
      await applyGrant(db, userDoc.id, sl, courseDocs[sl], { note: grantNote, grantedBy: actor });
    }
    applied = true;
  } else if (additions.length) {
    await db.collection('pendingGrants').doc(email).set({
      email,
      slugs: FV.arrayUnion(...additions),
      notes: FV.arrayUnion(...additions.map((sl) => `${sl}: ${grantNote}`)),
      grantedBy: actor,
      updatedAt: FV.serverTimestamp()
    }, { merge: true });
  }

  // ── Revoke the removals, if they may be revoked ───────────────────────
  // Everything here is refusable, and a refusal is reported rather than
  // thrown: the operator unticked something, and they are owed the reason it
  // stayed rather than a failed approval.
  const { revoked, blocked } = await revokeBetaSlugs(db, {
    email, accountUid, betaGranted, wanted, removing, courseDocs, actor
  });

  // Blocked removals are still the tester's courses — they kept access, so the
  // record has to say so or the console and reality drift apart.
  const finalSlugs = wanted.concat(blocked.map((b) => b.slug)).filter((sl, i, a) => a.indexOf(sl) === i);

  await ref.set({
    status: 'granted',
    courseSlugs: finalSlugs,
    courseSlug: finalSlugs[0],
    betaGrantedSlugs: betaGranted
      .concat(additions)
      .filter((sl) => !revoked.includes(sl))
      .filter((sl, i, a) => a.indexOf(sl) === i),
    cohort: cohort || tester.cohort || null,
    uid: accountUid,
    grantedBy: actor,
    grantNote,
    grantPending: !applied,
    note: note || tester.note || null,
    decidedBy: actor,
    decidedAt: FV.serverTimestamp(),
    grantedAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp()
  }, { merge: true });

  if (applied) await markBetaActivated(db, email, userDoc.id);

  // Tell them, once per course that is NEW to them. A member with an account
  // gets the course link; an applicant without one gets the signup link and
  // the instruction to use this exact address, since the grant is parked
  // against it. Best-effort on top of a grant that already landed, so a mail
  // failure never fails the approval — the console reports it instead.
  const emailed = {};
  if (notify) {
    for (const sl of additions) {
      emailed[sl] = await sendGrantEmail(db, {
        email,
        uid: userDoc ? userDoc.id : null,
        slug: sl,
        course: courseDocs[sl],
        note: note || null,
        hasAccount: applied
      });
    }
  }
  const sent = Object.values(emailed);
  if (sent.length && sent.some((x) => !x)) {
    await ref.set({ inviteEmailFailedAt: FV.serverTimestamp() }, { merge: true });
  } else if (sent.length) {
    await ref.set({ inviteEmailedAt: FV.serverTimestamp() }, { merge: true });
  }

  return {
    ok: true,
    status: applied ? 'active' : 'granted',
    applied,
    pending: !applied,
    slugs: finalSlugs,
    granted: additions,
    revoked,
    blocked,
    emailed
  };
});

// ── Course completion and reviews ────────────────────────────────────────
//
// Finishing a course used to leave no trace on the server: progress sat in
// the member's own docs (or, for I Can't, only in their browser), the beta
// record moved to `completed` only when Anthony clicked "Mark done", and the
// only ask at the finish line was an Amazon link. This is the other half:
//
//   recordCourseCompletion — the course player calls it when every module is
//     done. It checks the progress for itself, stamps
//     users/{uid}/courseCompletions/{slug}, moves a beta tester to
//     `completed`, puts the finish on their CRM card and emails the review ask.
//   submitCourseReview — the /review page. Held as `pending` until approved.
//   moderateCourseReview — the owner approves or rejects from the beta
//     console; approval republishes the course's rating.
//
// courseReviews/{slug}__{uid} is the review; reviewRequests/{slug}__{uid}
// drives the one follow-up nudge the automation tick sends if nobody reviewed.

// Module counts for courses whose lessons live in JS rather than
// courses/{slug}/modules. Keep in step with MODULES in public/js/icant-course.js.
const CODE_COURSE_MODULE_COUNTS = { icant: 11 };
const REVIEW_NUDGE_DAYS = 3;

async function courseModuleTotal(db, slug, course) {
  const codeCount = CODE_COURSE_MODULE_COUNTS[slug];
  if (codeCount && (!course || course.contentSource !== 'firestore')) return codeCount;
  const snap = await db.collection('courses').doc(slug).collection('modules').get();
  return snap.docs.filter((d) => d.data().published !== false).length;
}

function reviewPageUrl(slug) {
  return `${APP_BASE_URL}/review.html?course=${encodeURIComponent(slug)}`;
}

/**
 * Writes a course event onto the member's CRM card: tags plus one timeline
 * activity. Best-effort — a CRM hiccup must never fail the member's action.
 * Returns the contact's ids so a following email can land on the same card.
 */
async function logCourseEventToCrm(db, { uid, user, email, tags, activity }) {
  try {
    const u = user || {};
    const companyId = u.crmCompanyId || await resolveAcademyCompanyId(db);
    if (!companyId) return {};
    let hint = u.crmContactId || null;
    if (!hint) {
      const t = await betaTesterRef(db, email).get();
      if (t.exists) hint = t.data().crmContactId || null;
    }
    const ref = await upsertCrmContact(db, companyId, {
      name: u.displayName || null,
      email,
      phone: u.phone || null,
      source: 'Academy',
      tags: (tags || []).map((t) => String(t).slice(0, 40)),
      contactId: hint,
      memberUid: uid
    });
    if (activity) {
      await ref.collection('activities').add({
        actorUid: 'system',
        actorName: 'Academy',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ...activity
      });
    }
    return { companyId, contactId: ref.id };
  } catch (e) {
    console.warn('[course-crm] CRM write failed:', e && e.message);
    return {};
  }
}

function reviewRequestEmailContent({ firstName, courseTitle, slug, nudge }) {
  const name = firstName || 'there';
  const titleHtml = textToHtml(courseTitle);
  const url = reviewPageUrl(slug);
  const subject = nudge
    ? `Two minutes on ${courseTitle}?`
    : `You finished ${courseTitle}. How did it land?`;
  const lead = nudge
    ? `A few days ago you finished ${courseTitle}. If you have two minutes, your rating and a few honest lines would mean a lot.`
    : `You finished ${courseTitle}. That puts you in a very small group.`;
  const ask = `Would you rate the course and say what it changed for you? Honest beats polite. Your review helps the next person decide to start.`;
  const text =
    `Hi ${name},\n\n${lead}\n\n${ask}\n\nLeave your review: ${url}\n\n` +
    `Anthony Brown Sr.\nFounder, The One Percent Nation`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#111;max-width:560px;margin:0 auto;line-height:1.55;">
      <h2 style="color:#000;margin:0 0 12px;font-size:22px;">${nudge ? 'Quick favor' : 'You did it'}, ${textToHtml(name)}.</h2>
      <p style="margin:0 0 14px;">${textToHtml(lead).replace(textToHtml(courseTitle), `<strong>${titleHtml}</strong>`)}</p>
      <p style="margin:0 0 22px;">${textToHtml(ask)}</p>
      <p style="margin:0 0 22px;"><a href="${url}" style="display:inline-block;background:#e60306;color:#fff;padding:12px 22px;border-radius:4px;text-decoration:none;font-weight:600;">★★★★★ Rate the course</a></p>
      <p style="margin:0;">Anthony Brown Sr.<br/>Founder, The One Percent Nation</p>
    </div>`;
  return { subject, text, html };
}

// Never throws; the caller must declare `secrets: [sendgridKey]`.
async function sendReviewRequestEmail({ email, firstName, courseTitle, slug, nudge, crmArgs }) {
  if (!EMAIL_RE.test(email || '')) return false;
  const { subject, text, html } = reviewRequestEmailContent({ firstName, courseTitle, slug, nudge });
  try {
    await sendEmail({
      to: email,
      from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
      replyTo: REPLY_TO,
      subject,
      text,
      html,
      customArgs: Object.assign({ type: nudge ? 'review_nudge' : 'review_request', slug }, crmArgs || {})
    });
    return true;
  } catch (err) {
    console.error('[review-email] send failed:', String((err && err.message) || err).slice(0, 300));
    return false;
  }
}

exports.recordCourseCompletion = onCall({ secrets: [sendgridKey] }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const slug = String((request.data && request.data.slug) || '').trim();
  if (!slug || slug.length > 120 || slug.includes('/')) throw new HttpsError('invalid-argument', 'slug is required.');

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const doneRef = userRef.collection('courseCompletions').doc(slug);
  const [userSnap, courseSnap, doneSnap] = await db.getAll(userRef, db.collection('courses').doc(slug), doneRef);
  // Already recorded: nothing to do, and no second email.
  if (doneSnap.exists) return { ok: true, already: true };

  const u = userSnap.exists ? userSnap.data() : {};
  const enrolled = Array.isArray(u.enrolledCourseSlugs) && u.enrolledCourseSlugs.includes(slug);
  if (!enrolled) throw new HttpsError('permission-denied', 'Not enrolled in this course.');

  const course = courseSnap.exists ? courseSnap.data() : null;
  const total = await courseModuleTotal(db, slug, course);
  const done = (await countProgressBySlug(db, uid, [slug]))[slug] || 0;
  if (!total || done < total) {
    return { ok: false, reason: 'incomplete', done, total };
  }

  const FV = admin.firestore.FieldValue;
  const courseTitle = (course && (course.title || course.short)) || String((request.data && request.data.title) || slug).slice(0, 160);
  const email = normalizeEmail(u.email || (request.auth.token && request.auth.token.email));

  // create() fails if a parallel call got there first, which is what keeps
  // the email to one.
  try {
    await doneRef.create({ courseSlug: slug, courseTitle, completedAt: FV.serverTimestamp() });
  } catch (e) {
    return { ok: true, already: true };
  }

  await advanceBetaStatus(db, email, 'completed', { completedAt: FV.serverTimestamp() });

  const crm = await logCourseEventToCrm(db, {
    uid, user: u, email,
    tags: [`Completed: ${courseTitle}`],
    activity: {
      type: 'course_completed',
      description: `Completed "${courseTitle}"`,
      meta: { courseSlug: slug, courseTitle, modules: total }
    }
  });

  await db.collection('reviewRequests').doc(`${slug}__${uid}`).set({
    uid, email, courseSlug: slug, courseTitle,
    createdAt: FV.serverTimestamp(),
    nudgeAt: admin.firestore.Timestamp.fromMillis(Date.now() + REVIEW_NUDGE_DAYS * 86400000)
  }, { merge: true });

  const emailed = await sendReviewRequestEmail({
    email,
    firstName: String(u.displayName || '').trim().split(/\s+/)[0] || '',
    courseTitle, slug, nudge: false,
    crmArgs: crm.contactId ? { companyId: crm.companyId, contactId: crm.contactId } : null
  });

  return { ok: true, emailed };
});

/** "Maria D." — enough to be real on a public page, not a full name. */
function reviewerDisplayName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Academy member';
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

async function publishCourseRating(db, slug) {
  const snap = await db.collection('courseReviews')
    .where('courseSlug', '==', slug).where('status', '==', 'approved').get();
  const summary = ratingSummary(snap.docs.map((d) => d.data().rating));
  await db.collection('courses').doc(slug).set(summary, { merge: true });
  return summary;
}

exports.submitCourseReview = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const data = request.data || {};
  const slug = String(data.slug || '').trim();
  if (!slug || slug.length > 120 || slug.includes('/')) throw new HttpsError('invalid-argument', 'slug is required.');
  const rating = Number(data.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpsError('invalid-argument', 'Pick a rating from 1 to 5 stars.');
  const text = String(data.text || '').trim().slice(0, 2000);

  const db = admin.firestore();
  await rateLimitCaller(db, request, { action: 'submitCourseReview', max: 10, windowSec: 600 });
  const userRef = db.collection('users').doc(uid);
  const reviewRef = db.collection('courseReviews').doc(`${slug}__${uid}`);
  const [userSnap, doneSnap, prevSnap] = await db.getAll(
    userRef, userRef.collection('courseCompletions').doc(slug), reviewRef);
  if (!doneSnap.exists) throw new HttpsError('failed-precondition', 'Finish the course first, then leave your review.');

  const u = userSnap.exists ? userSnap.data() : {};
  const email = normalizeEmail(u.email || (request.auth.token && request.auth.token.email));
  const courseTitle = doneSnap.data().courseTitle || slug;
  const wasApproved = prevSnap.exists && prevSnap.data().status === 'approved';
  const FV = admin.firestore.FieldValue;

  const crm = await logCourseEventToCrm(db, {
    uid, user: u, email,
    tags: [`Reviewed: ${courseTitle}`],
    activity: {
      type: 'course_review',
      description: `Left a ${rating}★ review of "${courseTitle}"`,
      meta: { courseSlug: slug, courseTitle, rating, text: text.slice(0, 500) }
    }
  });

  // An edit goes back through approval, so what is public is always
  // something Anthony has read.
  await reviewRef.set({
    courseSlug: slug,
    courseTitle,
    uid,
    email,
    name: reviewerDisplayName(u.displayName),
    rating,
    text,
    status: 'pending',
    crmCompanyId: crm.companyId || null,
    crmContactId: crm.contactId || null,
    updatedAt: FV.serverTimestamp(),
    ...(prevSnap.exists ? {} : { createdAt: FV.serverTimestamp() })
  }, { merge: true });

  await db.collection('reviewRequests').doc(`${slug}__${uid}`)
    .set({ nudgeAt: null, reviewedAt: FV.serverTimestamp() }, { merge: true });
  if (wasApproved) await publishCourseRating(db, slug);

  return { ok: true, status: 'pending' };
});

exports.moderateCourseReview = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admins only.');
  const id = String((request.data && request.data.id) || '').trim();
  const decision = String((request.data && request.data.decision) || '');
  if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'Review id is required.');
  if (!['approve', 'reject'].includes(decision)) throw new HttpsError('invalid-argument', 'decision must be approve or reject.');

  const ref = db.collection('courseReviews').doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Review not found.');
  const r = snap.data();
  const FV = admin.firestore.FieldValue;
  await ref.set({
    status: decision === 'approve' ? 'approved' : 'rejected',
    decidedAt: FV.serverTimestamp(),
    decidedBy: uid
  }, { merge: true });
  const summary = await publishCourseRating(db, r.courseSlug);

  if (r.crmCompanyId && r.crmContactId) {
    try {
      await db.collection('companies').doc(r.crmCompanyId).collection('contacts').doc(r.crmContactId)
        .collection('activities').add({
          type: decision === 'approve' ? 'review_approved' : 'review_rejected',
          description: decision === 'approve'
            ? `${r.rating}★ review of "${r.courseTitle}" published on the website`
            : `${r.rating}★ review of "${r.courseTitle}" kept private`,
          actorUid: 'system',
          actorName: 'Academy',
          createdAt: FV.serverTimestamp(),
          meta: { courseSlug: r.courseSlug, rating: r.rating, reviewId: id }
        });
    } catch (e) {
      console.warn('[moderateCourseReview] CRM log failed:', e && e.message);
    }
  }
  return { ok: true, ...summary };
});

/**
 * Automation-tick step: one follow-up email to anybody who finished a course
 * REVIEW_NUDGE_DAYS ago and has not reviewed it. `nudgeAt` is cleared the
 * moment a nudge goes out or a review lands, so each person gets at most one.
 */
async function sendReviewNudges(db) {
  const snap = await db.collection('reviewRequests')
    .where('nudgeAt', '<=', admin.firestore.Timestamp.now()).limit(50).get();
  let sent = 0;
  for (const d of snap.docs) {
    const r = d.data();
    const FV = admin.firestore.FieldValue;
    const reviewed = (await db.collection('courseReviews').doc(d.id).get()).exists;
    let ok = false;
    if (!reviewed) {
      const u = (await db.collection('users').doc(r.uid).get()).data() || {};
      ok = await sendReviewRequestEmail({
        email: r.email,
        firstName: String(u.displayName || '').trim().split(/\s+/)[0] || '',
        courseTitle: r.courseTitle || r.courseSlug,
        slug: r.courseSlug,
        nudge: true,
        crmArgs: u.crmCompanyId && u.crmContactId ? { companyId: u.crmCompanyId, contactId: u.crmContactId } : null
      });
      if (ok) sent += 1;
    }
    await d.ref.set({ nudgeAt: null, ...(ok ? { nudgedAt: FV.serverTimestamp() } : {}) }, { merge: true });
  }
  return { checked: snap.size, sent };
}

// getBetaTesterSummary — the CRM card's one-line view of a tester's progress,
// from the same row builder the beta console uses.
exports.getBetaTesterSummary = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admins only.');
  const ref = betaTesterRef(db, request.data && request.data.email);
  if (!ref) return { ok: true, row: null };
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, row: null };
  const row = await buildBetaRow(db, snap.id, snap.data());
  return { ok: true, row, courses: await betaCourseOptions(db) };
});

// validateCoupon — pre-checkout preview so the buyer sees the discounted
// price before committing. Sign-in required (checkout requires it anyway),
// and rate-limited so the coupons collection doesn't need public reads.
exports.validateCoupon = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  await rateLimitCaller(db, request, { action: 'validateCoupon', max: 30, windowSec: 600 });

  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  const kind = String((request.data && request.data.kind) || 'course');
  const id = String((request.data && request.data.id) || '').trim();
  if (!code || !id || !['course', 'product'].includes(kind)) {
    throw new HttpsError('invalid-argument', 'code, kind and id are required.');
  }

  let priceDollars = null;
  if (kind === 'course') {
    const snap = await db.collection('courses').doc(id).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Unknown course.');
    if (snap.data().pricing && snap.data().pricing.mode === 'subscription') {
      throw new HttpsError('failed-precondition', 'Promo codes can\'t be applied to subscriptions yet.');
    }
    priceDollars = effectivePriceDollars(snap.data());
  } else {
    const snap = await db.collection('products').doc(id).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Unknown product.');
    priceDollars = typeof snap.data().price === 'number' ? snap.data().price : null;
  }
  if (priceDollars == null || priceDollars <= 0) {
    throw new HttpsError('failed-precondition', 'This item doesn\'t have a promo-eligible price.');
  }

  const resolved = await resolveCoupon(db, code, { kind, id, priceDollars });
  return {
    ok: true,
    code: resolved.code,
    percentOff: resolved.percentOff,
    amountOff: resolved.amountOff,
    originalPrice: priceDollars,
    discountedPrice: resolved.discountedDollars,
    isFree: resolved.isFree
  };
});

// createCheckoutSession — starts a Stripe Checkout for a live paid course or
// a sellable product. Price is always read server-side (courses/{slug} or
// products/{productId}); the client sends only the identifier, an optional
// refCode, and an optional couponCode.
// ── Course fulfillment ──────────────────────────────────────────────
// Courses that ship a physical item and/or unlock other courses when bought.
// The I Can't course and its bundle both ship a paperback of the book:
// Checkout collects a US shipping address and the webhook writes the order
// to `orders` for Anthony to work from the store console. The bundle also
// enrolls the buyer in the course itself (bundle-icant has no lessons of its
// own). Firestore `courses/{slug}.shipsBook` / `.enrollsAlso` override these
// defaults so the owner can change them without a deploy.
// `sellable: false` means the course can only be reached through a bundle:
// checkout refuses it directly. The I Can't course is sold only as
// The Complete I Can't Experience (bundle-icant), which ships the paperback.
//
// `grantsBooks` attaches digital books from the library (books/{bookId}) to a
// course. Every path that grants the course also adds these ids to
// users/{uid}.ownedBookIds, the field the reader and storage.rules gate on.
// The buyer picks the format: bundle-icant is digital only (nothing ships),
// bundle-icant-print adds the shipped paperback.
const COURSE_FULFILLMENT = {
  'bundle-icant':       { shipsBook: false, enrollsAlso: ['icant'], grantsBooks: ['i-cant'], sellable: true },
  'bundle-icant-print': { shipsBook: true,  enrollsAlso: ['icant'], grantsBooks: ['i-cant'], sellable: true },
  'icant':              { shipsBook: false, enrollsAlso: [],        grantsBooks: ['i-cant'], sellable: false }
};
const SHIPPED_BOOK_NAME = 'I Can\'t: Is Not A Strategy (paperback)';

function courseFulfillment(slug, course) {
  const d = COURSE_FULFILLMENT[slug] || { shipsBook: false, enrollsAlso: [], grantsBooks: [], sellable: true };
  const c = course || {};
  const shipsBook = typeof c.shipsBook === 'boolean' ? c.shipsBook : d.shipsBook;
  const sellable = typeof c.sellable === 'boolean' ? c.sellable : d.sellable;
  const list = (v, fallback) => (Array.isArray(v) ? v.map(String).filter(Boolean) : fallback);
  const enrollsAlso = list(c.enrollsAlso, d.enrollsAlso);
  const grantsBooks = list(c.grantsBooks, d.grantsBooks || []);
  return { shipsBook, enrollsAlso, grantsBooks, sellable };
}

// The users/{uid} fields that grant `slug`: the course, whatever it unlocks,
// and the books attached to either. Books attached to an unlocked course
// (icant's own grantsBooks) come from COURSE_FULFILLMENT defaults, so a
// bundle still grants them without an extra read.
// `courseDocs` (slug -> Firestore record) lets the courses a bundle unlocks
// contribute the books on THEIR records, which is where Manage Library
// writes them. Without it only the code defaults are known for those.
function booksForCourse(slug, course, courseDocs) {
  const f = courseFulfillment(slug, course);
  const books = new Set(f.grantsBooks);
  const docs = courseDocs || {};
  f.enrollsAlso.forEach((s) => courseFulfillment(s, docs[s] || {}).grantsBooks.forEach((b) => books.add(b)));
  return [...books];
}

// Reads the records of the courses `slug` unlocks so booksForCourse sees
// what Manage Library attached to them, not just the code defaults.
async function fulfillmentDocs(db, slug, course) {
  const f = courseFulfillment(slug, course);
  const docs = {};
  await Promise.all(f.enrollsAlso.map(async (s) => {
    try {
      const snap = await db.collection('courses').doc(s).get();
      docs[s] = snap.exists ? snap.data() : {};
    } catch (e) { docs[s] = {}; }
  }));
  return docs;
}

// Every course slug whose fulfillment (defaults plus the Firestore record)
// grants `bookId`, given a map of slug -> course record.
function grantingSlugsFor(bookId, courseDocs) {
  return Object.keys(courseDocs).filter((slug) => booksForCourse(slug, courseDocs[slug]).includes(bookId));
}

function enrollmentFields(slug, course, courseDocs) {
  const FV = admin.firestore.FieldValue;
  const f = courseFulfillment(slug, course);
  const books = booksForCourse(slug, course, courseDocs);
  const out = { enrolledCourseSlugs: FV.arrayUnion(slug, ...f.enrollsAlso) };
  if (books.length) out.ownedBookIds = FV.arrayUnion(...books);
  return out;
}

// The async form every enrollment path uses: fetches the unlocked courses'
// records first so the books they carry are granted too.
async function resolveEnrollmentFields(db, slug, course) {
  return enrollmentFields(slug, course, await fulfillmentDocs(db, slug, course));
}

// Stripe moved the collected address from `session.shipping_details` to
// `session.collected_information.shipping_details` in newer API versions.
// Return the `{ name, address }` shape either way.
function sessionShipping(session) {
  if (!session) return null;
  if (session.shipping_details) return session.shipping_details;
  const ci = session.collected_information;
  if (ci && ci.shipping_details) return ci.shipping_details;
  return null;
}

exports.createCheckoutSession = onCall({ secrets: STRIPE_SECRETS }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const slug = String((request.data && request.data.slug) || '').trim();
  const productId = String((request.data && request.data.productId) || '').trim();
  if (!slug && !productId) throw new HttpsError('invalid-argument', 'slug or productId is required.');
  const couponCode = String((request.data && request.data.couponCode) || '').trim().toUpperCase();

  // Throttle checkout session creation: 15 per user per 10 minutes.
  await rateLimitCaller(admin.firestore(), request,
    { action: 'createCheckoutSession', max: 15, windowSec: 600 });

  const stripe = getStripe();
  if (!stripe) {
    throw new HttpsError('failed-precondition',
      'Online checkout isn\'t available yet — payments are still being set up.');
  }

  const db = admin.firestore();

  // ── Product checkout ────────────────────────────────────────────────
  // Sellable products (digital or physical) from products/{id}. Physical
  // items collect a shipping address in Stripe Checkout and land in the
  // orders collection for manual fulfillment.
  if (productId) {
    const prodSnap = await db.collection('products').doc(productId).get();
    if (!prodSnap.exists) throw new HttpsError('not-found', 'Unknown product.');
    const product = prodSnap.data();
    // Pre-order is a status that exists precisely so a product can be bought
    // before it ships; the gate used to demand 'live', which made every
    // pre-order unpurchasable.
    if (!['live', 'preorder'].includes(product.status) || product.sellable !== true) {
      throw new HttpsError('failed-precondition', 'This product isn\'t available to buy yet.');
    }
    const basePrice = typeof product.price === 'number' ? product.price : null;
    if (basePrice == null || basePrice <= 0) {
      throw new HttpsError('failed-precondition', 'This product doesn\'t have a price yet.');
    }
    if (typeof product.inventory === 'number' && product.inventory <= 0) {
      throw new HttpsError('resource-exhausted', 'This product is sold out.');
    }

    const wantsShipping = product.requiresShipping === true
      || (product.requiresShipping !== false && product.type === 'physical');

    let unitDollars = basePrice;
    const prodMeta = { productId, uid };

    // Coach/affiliate attribution on product sales. Coaches selling the
    // client-facing A.L.I.G.N. products earn their license tier's rate
    // (rates.clientProductPercent); classic affiliates fall back to their
    // flat commissionPercent. Validated and locked here, paid by the webhook.
    let prodRefCode = String((request.data && request.data.refCode) || '').trim().toUpperCase();
    if (prodRefCode) {
      const affSnap = await db.collection('affiliates').doc(prodRefCode).get();
      const aff = affSnap.exists ? affSnap.data() : null;
      const buyerEmail = ((request.auth.token && request.auth.token.email) || '').toLowerCase();
      const selfReferral = aff && (
        (aff.uid && aff.uid === uid)
        || (aff.email && String(aff.email).toLowerCase() === buyerEmail)
      );
      if (aff && aff.active !== false && !selfReferral) {
        const rate = (aff.rates && typeof aff.rates.clientProductPercent === 'number')
          ? aff.rates.clientProductPercent
          : (typeof aff.commissionPercent === 'number' ? aff.commissionPercent : 20);
        prodMeta.refCode = prodRefCode;
        prodMeta.refPercent = String(rate);
      }
    }

    if (couponCode) {
      const resolved = await resolveCoupon(db, couponCode,
        { kind: 'product', id: productId, priceDollars: basePrice });
      if (resolved.isFree) {
        // A $0 order can't go through Stripe, and a comped physical item has
        // no way to collect a shipping address. Comps are for courses and
        // classes; keep product codes above zero.
        throw new HttpsError('failed-precondition',
          'Free product codes aren\'t supported — set the code below 100%.');
      }
      unitDollars = resolved.discountedDollars;
      prodMeta.couponCode = resolved.code;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: Math.max(50, Math.round(unitDollars * 100)),
          product_data: { name: product.name || 'One Percent Nation product' }
        }
      }],
      ...(wantsShipping ? { shipping_address_collection: { allowed_countries: ['US'] } } : {}),
      customer_email: (request.auth.token && request.auth.token.email) || undefined,
      client_reference_id: uid,
      metadata: prodMeta,
      success_url: `${APP_BASE_URL}/upcoming.html?purchase=success`,
      cancel_url: `${APP_BASE_URL}/upcoming.html`
    });
    return { ok: true, url: session.url };
  }

  // ── Course checkout ─────────────────────────────────────────────────
  const courseSnap = await db.collection('courses').doc(slug).get();
  if (!courseSnap.exists) throw new HttpsError('not-found', 'Unknown course.');
  const course = courseSnap.data();
  if (course.status !== 'live') {
    throw new HttpsError('failed-precondition', 'This course isn\'t available to join yet.');
  }
  const fulfil = courseFulfillment(slug, course);
  if (fulfil.sellable === false) {
    throw new HttpsError('failed-precondition',
      'This course is included in The Complete I Can\'t Experience. Enroll through the bundle.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const enrolled = (userSnap.exists && userSnap.data().enrolledCourseSlugs) || [];
  if (enrolled.includes(slug)) {
    throw new HttpsError('already-exists', 'You\'re already enrolled in this course.');
  }
  // The two I Can't bundles unlock the same course. Owning it through one
  // means the other would charge again for access already held.
  if (fulfil.enrollsAlso.length && fulfil.enrollsAlso.every((s) => enrolled.includes(s))) {
    throw new HttpsError('already-exists', 'You already have this course and its book in your library.');
  }

  const dollars = effectivePriceDollars(course);
  if (dollars == null || dollars <= 0) {
    throw new HttpsError('failed-precondition', 'This course is free — use enrollFree.');
  }

  const isSubscription = !!(course.pricing && course.pricing.mode === 'subscription');
  const interval = isSubscription
    ? (course.pricing.interval === 'year' ? 'year' : 'month')
    : null;

  // ── Payment plans (1P Certified Life Coach) ─────────────────────────
  // Fixed-count installments modeled as a monthly subscription that the
  // webhook cancels after the final payment (see invoice.paid below).
  // Enrollment happens on checkout completion like any purchase; a missed
  // installment marks the purchase past_due, which blocks certification
  // issuance (not course access) until it's resolved.
  const PLAN_OPTIONS = {
    '6x': { installments: 6, monthlyCents: 69700, label: '6 payments of $697' },
    '10x': { installments: 10, monthlyCents: 39700, label: '10 payments of $397' }
  };
  const planKey = String((request.data && request.data.plan) || '').trim();
  const plan = planKey ? PLAN_OPTIONS[planKey] : null;
  if (planKey && !plan) throw new HttpsError('invalid-argument', 'Unknown payment plan.');
  if (plan && slug !== '1p-clc') {
    throw new HttpsError('failed-precondition', 'Payment plans are only available for the 1P Certified Life Coach program.');
  }
  if (plan && couponCode) {
    throw new HttpsError('failed-precondition', 'Promo codes can\'t be combined with a payment plan.');
  }

  // ── Promo code ──────────────────────────────────────────────────────
  // Validated in Firestore and baked into the session's unit_amount. A code
  // at 100% never reaches Stripe: it enrolls directly, the same writes the
  // webhook would have made.
  let chargeDollars = dollars;
  let appliedCoupon = null;
  if (couponCode) {
    if (isSubscription || plan) {
      // An ad-hoc recurring price would carry the discount into every
      // renewal. Until subscription coupons are designed deliberately,
      // refuse rather than surprise.
      throw new HttpsError('failed-precondition',
        'Promo codes can\'t be applied to subscriptions yet.');
    }
    const resolved = await resolveCoupon(db, couponCode,
      { kind: 'course', id: slug, priceDollars: dollars });
    if (resolved.isFree) {
      await db.collection('users').doc(uid).set({
        ...(await resolveEnrollmentFields(db, slug, course)),
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      if (fulfil.shipsBook) {
        // No Stripe session, so no address was collected. The order lands in
        // the store console flagged so Anthony can ask for one.
        await db.collection('orders').doc(`comp-${slug}-${uid}`).set({
          kind: 'course-book',
          courseSlug: slug,
          productName: SHIPPED_BOOK_NAME,
          productType: 'book',
          uid,
          email: (request.auth.token && request.auth.token.email) || null,
          amountTotal: 0,
          currency: 'usd',
          couponCode: resolved.code,
          shipping: null,
          status: 'needs-address',
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
      await db.collection('users').doc(uid).collection('purchases').doc(`comp-${slug}`).set({
        courseSlug: slug,
        amount: 0,
        mode: 'comp',
        couponCode: resolved.code,
        status: 'comped',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      await countCouponRedemption(db, resolved.code);
      return { ok: true, enrolled: true };
    }
    chargeDollars = resolved.discountedDollars;
    appliedCoupon = resolved.code;
  }

  // Affiliate attribution — validate the referral code server-side and lock
  // the commission rate into the session metadata at purchase time.
  let refCode = String((request.data && request.data.refCode) || '').trim().toUpperCase();
  let refPercent = null;
  if (refCode) {
    const affSnap = await db.collection('affiliates').doc(refCode).get();
    const aff = affSnap.exists ? affSnap.data() : null;
    const buyerEmail = ((request.auth.token && request.auth.token.email) || '').toLowerCase();
    const selfReferral = aff && (
      (aff.uid && aff.uid === uid)
      || (aff.email && String(aff.email).toLowerCase() === buyerEmail)
    );
    if (aff && aff.active !== false && !selfReferral) {
      refPercent = typeof aff.commissionPercent === 'number' ? aff.commissionPercent : 20;
    } else {
      refCode = '';
    }
  }

  const metadata = { courseSlug: slug, uid };
  if (refCode) {
    metadata.refCode = refCode;
    metadata.refPercent = String(refPercent);
  }
  if (appliedCoupon) metadata.couponCode = appliedCoupon;
  if (fulfil.shipsBook) metadata.shipsBook = '1';
  if (fulfil.enrollsAlso.length) metadata.enrollsAlso = fulfil.enrollsAlso.join(',');
  const grantsBooks = booksForCourse(slug, course, await fulfillmentDocs(db, slug, course));
  if (grantsBooks.length) metadata.grantsBooks = grantsBooks.join(',');

  if (plan) {
    metadata.installments = String(plan.installments);
    metadata.plan = planKey;
  }

  const priceData = {
    currency: 'usd',
    unit_amount: plan ? plan.monthlyCents : Math.max(50, Math.round(chargeDollars * 100)),
    product_data: { name: plan ? `${course.title || slug} (${plan.label})` : (course.title || slug) }
  };
  if (isSubscription) priceData.recurring = { interval };
  if (plan) priceData.recurring = { interval: 'month' };

  // No allow_promotion_codes: coupons are validated in Firestore above and
  // priced into unit_amount, so per-item scoping and the active toggle are
  // actually enforced. Stripe-native promo codes would bypass both.
  const session = await stripe.checkout.sessions.create({
    mode: (isSubscription || plan) ? 'subscription' : 'payment',
    line_items: [{ price_data: priceData, quantity: 1 }],
    // Courses that ship the book ask for a US address inside Stripe Checkout.
    ...(fulfil.shipsBook ? { shipping_address_collection: { allowed_countries: ['US'] } } : {}),
    customer_email: (request.auth.token && request.auth.token.email) || undefined,
    client_reference_id: uid,
    metadata,
    ...((isSubscription || plan) ? { subscription_data: { metadata } } : {}),
    // A bundle record has no lessons of its own, so send the buyer to the
    // course it unlocks. Landing on the bundle showed "content is being
    // prepared" to someone who had just paid.
    success_url: `${APP_BASE_URL}/courses.html?course=${encodeURIComponent(fulfil.enrollsAlso[0] || slug)}&purchase=success`,
    cancel_url: `${APP_BASE_URL}/courses.html`
  });

  return { ok: true, url: session.url };
});

// bookFile — serves a digital book's EPUB to its owner from the site's own
// domain (Hosting rewrites /api/book-file here), so the reader never needs
// the Storage bucket's CORS configured. The rule it enforces is the same as
// storage.rules: owners of the book, or admins/owner (who also see hidden
// books, to proof them). The caller proves who they are with their Firebase
// ID token in the Authorization header.
exports.bookFile = onRequest({ cors: false, invoker: 'public', memory: '512MiB', timeoutSeconds: 120 }, async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.status(405).send('method not allowed'); return; }
  const bookId = String(req.query.book || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(bookId)) { res.status(400).send('bad book id'); return; }

  const m = /^Bearer (.+)$/.exec(String(req.get('Authorization') || ''));
  if (!m) { res.status(401).send('sign in required'); return; }
  let token;
  try { token = await admin.auth().verifyIdToken(m[1]); } catch (e) { res.status(401).send('sign in required'); return; }

  const db = admin.firestore();
  const [userSnap, bookSnap] = await Promise.all([
    db.collection('users').doc(token.uid).get(),
    db.collection('books').doc(bookId).get()
  ]);
  if (!bookSnap.exists) { res.status(404).send('unknown book'); return; }
  const u = userSnap.exists ? (userSnap.data() || {}) : {};
  const isAdmin = token.role === 'owner' || u.role === 'admin' || u.role === 'owner';
  const owns = Array.isArray(u.ownedBookIds) && u.ownedBookIds.includes(bookId);
  const book = bookSnap.data() || {};
  if (!isAdmin && (!owns || book.status === 'hidden')) { res.status(403).send('not in your library'); return; }

  const file = admin.storage().bucket().file(book.filePath || `books/${bookId}/book.epub`);
  try {
    const [meta] = await file.getMetadata();
    res.set('Content-Type', 'application/epub+zip');
    if (meta && meta.size) res.set('Content-Length', String(meta.size));
  } catch (e) {
    res.status(404).send('book file missing');
    return;
  }
  file.createReadStream()
    .on('error', (err) => {
      console.error('[bookFile] stream failed:', err && err.message);
      if (!res.headersSent) res.status(500).send('read failed'); else res.end();
    })
    .pipe(res);
});

// syncBookGrants — put a digital book in the library of everyone already
// enrolled in a course that grants it. Checkout and grants do this for new
// members automatically (enrollmentFields); this covers members who were
// enrolled before the book was attached, or before it existed. Called from
// /manage-library.html. users.ownedBookIds is Admin-SDK-only, so a browser
// cannot do this itself.
exports.syncBookGrants = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admins only.');
  const bookId = String((request.data && request.data.bookId) || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(bookId)) throw new HttpsError('invalid-argument', 'bookId is required.');
  const bookSnap = await db.collection('books').doc(bookId).get();
  if (!bookSnap.exists) throw new HttpsError('not-found', 'Unknown book.');

  const coursesSnap = await db.collection('courses').get();
  const courseDocs = {};
  coursesSnap.forEach((d) => { courseDocs[d.id] = d.data(); });
  // Code defaults cover courses with no Firestore record yet.
  Object.keys(COURSE_FULFILLMENT).forEach((slug) => { if (!courseDocs[slug]) courseDocs[slug] = {}; });
  const grantingSlugs = grantingSlugsFor(bookId, courseDocs);

  const seen = new Set();
  let granted = 0;
  const FV = admin.firestore.FieldValue;
  let batch = db.batch();
  let inBatch = 0;
  for (const slug of grantingSlugs) {
    const snap = await db.collection('users').where('enrolledCourseSlugs', 'array-contains', slug).get();
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const owned = Array.isArray(d.data().ownedBookIds) ? d.data().ownedBookIds : [];
      if (owned.includes(bookId)) continue;
      batch.set(d.ref, { ownedBookIds: FV.arrayUnion(bookId) }, { merge: true });
      granted++;
      if (++inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
  }
  if (inBatch) await batch.commit();
  return { ok: true, granted, checked: seen.size, courses: grantingSlugs };
});

// stripeWebhook — enrolls buyers after checkout and revokes subscription
// access on cancellation. Configure the endpoint in the Stripe dashboard to
// send: checkout.session.completed, customer.subscription.deleted,
// invoice.paid, invoice.payment_failed.
exports.stripeWebhook = onRequest(
  // sendgridKey: the purchase confirmation goes out from here.
  { cors: false, invoker: 'public', secrets: [...STRIPE_SECRETS, sendgridKey] },
  async (req, res) => {
    const stripe = getStripe();
    const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!stripe || !webhookSecret) {
      console.warn('[stripeWebhook] Stripe not configured');
      res.status(503).send('stripe not configured');
      return;
    }

    let event;
    try {
      const rawBody = req.rawBody ? Buffer.from(req.rawBody) : Buffer.from('');
      event = stripe.webhooks.constructEvent(rawBody, req.get('stripe-signature'), webhookSecret);
    } catch (e) {
      console.warn('[stripeWebhook] signature verification failed:', e && e.message);
      res.status(400).send('invalid signature');
      return;
    }

    const db = admin.firestore();

    // Idempotency: each Stripe event is processed once.
    const evRef = db.collection('stripeEvents').doc(event.id);
    const seen = await evRef.get();
    if (seen.exists) {
      res.status(200).send('ok (duplicate)');
      return;
    }

    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const uid = (session.metadata && session.metadata.uid) || session.client_reference_id;
        const courseSlug = session.metadata && session.metadata.courseSlug;
        const productId = session.metadata && session.metadata.productId;
        const couponCode = session.metadata && session.metadata.couponCode;
        const licenseRenewal = session.metadata && session.metadata.licenseRenewal;

        // ── License renewal ──────────────────────────────────────────
        // Extends the A.L.I.G.N. Practitioner License one year from its
        // current expiry (or from today if it already lapsed) and
        // reactivates the coach's directory listing.
        if (uid && licenseRenewal) {
          const certRef = db.collection('certifications').doc(`${uid}_${licenseRenewal}`);
          const certSnap = await certRef.get();
          if (certSnap.exists) {
            const cert = certSnap.data();
            const now = Date.now();
            const currentExpiry = cert.licenseExpiresAt && cert.licenseExpiresAt.toMillis
              ? cert.licenseExpiresAt.toMillis() : now;
            const newExpiry = Math.max(now, currentExpiry) + 365 * 24 * 60 * 60 * 1000;
            await certRef.set({
              licenseExpiresAt: admin.firestore.Timestamp.fromMillis(newExpiry),
              status: 'active',
              lastRenewedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            await db.collection('coachDirectory').doc(uid).set({
              active: true,
              licenseExpiresAt: admin.firestore.Timestamp.fromMillis(newExpiry)
            }, { merge: true });
            await db.collection('users').doc(uid).collection('purchases').doc(session.id).set({
              licenseRenewal,
              amount: (session.amount_total || 0) / 100,
              mode: 'license-renewal',
              status: 'paid',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }
        }

        // ── Product order ────────────────────────────────────────────
        // Fulfillment is manual: the order lands in `orders` with the
        // shipping address Stripe collected, and Anthony works the list
        // from the store console. Idempotent via the stripeEvents guard.
        if (uid && productId) {
          const prodRef = db.collection('products').doc(productId);
          const prodSnap = await prodRef.get();
          const product = prodSnap.exists ? prodSnap.data() : {};
          await db.collection('orders').doc(session.id).set({
            productId,
            productName: product.name || null,
            productType: product.type || null,
            uid,
            email: (session.customer_details && session.customer_details.email)
              || session.customer_email || null,
            amountTotal: (session.amount_total || 0) / 100,
            currency: session.currency || 'usd',
            couponCode: couponCode || null,
            shipping: sessionShipping(session),
            status: 'new',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          if (typeof product.inventory === 'number') {
            await prodRef.set({
              inventory: admin.firestore.FieldValue.increment(-1)
            }, { merge: true });
          }
          await db.collection('users').doc(uid).collection('purchases').doc(session.id).set({
            productId,
            productName: product.name || null,
            amount: (session.amount_total || 0) / 100,
            mode: 'product',
            couponCode: couponCode || null,
            status: 'paid',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          if (couponCode) await countCouponRedemption(db, couponCode);

          // Commission on product sales — the code + rate were validated and
          // locked into metadata by createCheckoutSession.
          const prodRefCode = session.metadata && session.metadata.refCode;
          if (prodRefCode) {
            const affRef = db.collection('affiliates').doc(prodRefCode);
            const affSnap = await affRef.get();
            if (affSnap.exists) {
              const pct = Number(session.metadata.refPercent)
                || (typeof affSnap.data().commissionPercent === 'number' ? affSnap.data().commissionPercent : 20);
              const saleAmount = (session.amount_total || 0) / 100;
              const commission = Math.round(saleAmount * pct) / 100;
              await affRef.collection('referrals').doc(session.id).set({
                productId,
                productName: product.name || null,
                kind: 'product',
                buyerUid: uid,
                saleAmount,
                commissionPercent: pct,
                commission,
                mode: 'product',
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              await affRef.set({
                totalSales: admin.firestore.FieldValue.increment(saleAmount),
                totalCommission: admin.firestore.FieldValue.increment(commission),
                saleCount: admin.firestore.FieldValue.increment(1),
                lastSaleAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
            }
          }
        }

        if (uid && courseSlug) {
          // A bundle unlocks the course it wraps (see COURSE_FULFILLMENT).
          const enrollsAlso = String((session.metadata && session.metadata.enrollsAlso) || '')
            .split(',').map((x) => x.trim()).filter(Boolean);
          // Books were locked into metadata at checkout; sessions opened
          // before that existed fall back to the code defaults.
          const metaBooks = session.metadata && session.metadata.grantsBooks;
          const grantsBooks = metaBooks != null
            ? String(metaBooks).split(',').map((x) => x.trim()).filter(Boolean)
            : booksForCourse(courseSlug, {}, await fulfillmentDocs(db, courseSlug, {}));
          await db.collection('users').doc(uid).set({
            enrolledCourseSlugs: admin.firestore.FieldValue.arrayUnion(courseSlug, ...enrollsAlso),
            ...(grantsBooks.length
              ? { ownedBookIds: admin.firestore.FieldValue.arrayUnion(...grantsBooks) }
              : {})
          }, { merge: true });

          // The book ships with this course: record the order with the address
          // Stripe collected. Worked from the store console like product orders.
          if (session.metadata && session.metadata.shipsBook === '1') {
            await db.collection('orders').doc(session.id).set({
              kind: 'course-book',
              courseSlug,
              productName: SHIPPED_BOOK_NAME,
              productType: 'book',
              uid,
              email: (session.customer_details && session.customer_details.email)
                || session.customer_email || null,
              amountTotal: (session.amount_total || 0) / 100,
              currency: session.currency || 'usd',
              couponCode: couponCode || null,
              shipping: sessionShipping(session),
              status: sessionShipping(session) ? 'new' : 'needs-address',
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
          }
          // The confirmation: where the course is, that the book is in
          // their library, and (print bundle) that the paperback is coming.
          const buyerEmail = (session.customer_details && session.customer_details.email)
            || session.customer_email || null;
          const emailed = await sendPurchaseEmail(db, {
            email: buyerEmail, uid, courseSlug,
            landingSlug: enrollsAlso[0] || courseSlug,
            grantsBooks,
            shipsBook: !!(session.metadata && session.metadata.shipsBook === '1'),
            shipping: sessionShipping(session)
          });
          await db.collection('users').doc(uid).collection('purchases').doc(session.id).set({
            courseSlug,
            amount: (session.amount_total || 0) / 100,
            mode: session.mode,
            couponCode: couponCode || null,
            stripeCustomerId: session.customer || null,
            subscriptionId: session.subscription || null,
            status: session.mode === 'subscription' ? 'active' : 'paid',
            confirmationEmail: emailed ? 'sent' : 'failed',
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          // Count the promo redemption. The stripeEvents/{eventId} guard
          // above makes this once-per-checkout even across Stripe retries.
          if (couponCode) await countCouponRedemption(db, couponCode);
          if (session.mode === 'subscription' && session.subscription) {
            // Index for cancellation handling.
            const installments = Number(session.metadata && session.metadata.installments) || null;
            await db.collection('stripeSubscriptions').doc(String(session.subscription)).set({
              uid, courseSlug, sessionId: session.id,
              ...(installments ? { installments, paidCount: 0 } : {}),
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }

          // Affiliate commission — the code + rate were validated and locked
          // into metadata by createCheckoutSession.
          const refCode = session.metadata && session.metadata.refCode;
          if (refCode) {
            const affRef = db.collection('affiliates').doc(refCode);
            const affSnap = await affRef.get();
            if (affSnap.exists) {
              const pct = Number(session.metadata.refPercent) ||
                (typeof affSnap.data().commissionPercent === 'number' ? affSnap.data().commissionPercent : 20);
              const saleAmount = (session.amount_total || 0) / 100;
              const commission = Math.round(saleAmount * pct) / 100;
              await affRef.collection('referrals').doc(session.id).set({
                courseSlug,
                buyerUid: uid,
                saleAmount,
                commissionPercent: pct,
                commission,
                mode: session.mode,
                status: 'pending',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              await affRef.set({
                totalSales: admin.firestore.FieldValue.increment(saleAmount),
                totalCommission: admin.firestore.FieldValue.increment(commission),
                saleCount: admin.firestore.FieldValue.increment(1),
                lastSaleAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
              await db.collection('users').doc(uid).collection('purchases').doc(session.id)
                .set({ refCode }, { merge: true });
            }
          }

          // ── CRM deal revenue tie-in ──
          // Best-effort: match the buyer to a CRM contact and mark their newest
          // open opportunity as won, recording the paid amount. Non-breaking.
          try {
            let email = (session.customer_details && session.customer_details.email)
              || session.customer_email || null;
            if (!email) {
              const us = await db.collection('users').doc(uid).get();
              email = us.exists ? (us.data().email || null) : null;
            }
            const cid = email ? await resolveAcademyCompanyId(db) : null;
            if (email && cid) {
              const cs = await db.collection('companies').doc(cid).collection('contacts')
                .where('email', '==', email).limit(1).get();
              if (!cs.empty) {
                const contactId = cs.docs[0].id;
                const os = await db.collection('companies').doc(cid).collection('opportunities')
                  .where('contactId', '==', contactId).limit(20).get();
                const open = os.docs.filter((d) => (d.data().status || 'open') === 'open');
                if (open.length) {
                  open.sort((a, b) => {
                    const am = a.data().createdAt && a.data().createdAt.toMillis ? a.data().createdAt.toMillis() : 0;
                    const bm = b.data().createdAt && b.data().createdAt.toMillis ? b.data().createdAt.toMillis() : 0;
                    return bm - am;
                  });
                  const pick = open[0];
                  const amount = (session.amount_total || 0) / 100;
                  await pick.ref.set({
                    status: 'won',
                    wonAt: admin.firestore.FieldValue.serverTimestamp(),
                    stripeSessionId: session.id,
                    amountPaid: amount,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastActivityAt: admin.firestore.FieldValue.serverTimestamp()
                  }, { merge: true });
                  await db.collection('companies').doc(cid).collection('contacts').doc(contactId)
                    .collection('activities').add({
                      type: 'deal_won',
                      description: `Deal won via Stripe — ${courseSlug} ($${amount})`,
                      actorUid: uid,
                      actorName: 'Stripe',
                      meta: { opportunityId: pick.id, stripeSessionId: session.id, amount },
                      createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
              }
            }
          } catch (e) { console.warn('[stripeWebhook] deal tie-in skipped:', e && e.message); }
        } else {
          console.warn('[stripeWebhook] session missing uid/courseSlug metadata', session.id);
        }
      } else if (event.type === 'invoice.paid') {
        // Installment-plan bookkeeping. Each paid invoice counts one payment;
        // after the final one the subscription is set to cancel at period end
        // and the purchase is marked paid in full so the later
        // customer.subscription.deleted event does NOT revoke access.
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          const idxRef = db.collection('stripeSubscriptions').doc(String(subId));
          const idx = await idxRef.get();
          const meta = idx.exists ? idx.data() : null;
          if (meta && meta.installments) {
            const paidCount = (Number(meta.paidCount) || 0) + 1;
            await idxRef.set({ paidCount }, { merge: true });
            if (meta.uid && meta.sessionId && meta.courseSlug) {
              await db.collection('users').doc(meta.uid).collection('purchases').doc(meta.sessionId)
                .set({ status: paidCount >= meta.installments ? 'paid_in_full' : 'active' }, { merge: true });
            }
            if (paidCount >= meta.installments) {
              await idxRef.set({ installmentsComplete: true }, { merge: true });
              try {
                await stripe.subscriptions.update(String(subId), { cancel_at_period_end: true });
              } catch (e) {
                console.warn('[stripeWebhook] installment cancel_at_period_end failed:', e && e.message);
              }
            }
          }
        }
      } else if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object;
        const idx = await db.collection('stripeSubscriptions').doc(String(sub.id)).get();
        const meta = idx.exists ? idx.data() : (sub.metadata && sub.metadata.uid ? sub.metadata : null);
        if (meta && meta.installmentsComplete === true) {
          // A completed installment plan ending is not a cancellation —
          // the buyer paid in full and keeps access.
        } else if (meta && meta.uid && meta.courseSlug) {
          await db.collection('users').doc(meta.uid).set({
            enrolledCourseSlugs: admin.firestore.FieldValue.arrayRemove(meta.courseSlug)
          }, { merge: true });
          if (meta.sessionId) {
            await db.collection('users').doc(meta.uid).collection('purchases').doc(meta.sessionId)
              .set({ status: 'canceled' }, { merge: true });
          }
        }
      } else if (event.type === 'invoice.payment_failed') {
        const invoice = event.data.object;
        const subId = invoice.subscription;
        if (subId) {
          const idx = await db.collection('stripeSubscriptions').doc(String(subId)).get();
          if (idx.exists && idx.data().sessionId) {
            const meta = idx.data();
            await db.collection('users').doc(meta.uid).collection('purchases').doc(meta.sessionId)
              .set({ status: 'past_due' }, { merge: true });
          }
        }
      }

      await evRef.set({
        type: event.type,
        processedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      res.status(200).send('ok');
    } catch (e) {
      console.error('[stripeWebhook] handler error:', e);
      // Non-2xx so Stripe retries.
      res.status(500).send('handler error');
    }
  }
);

// syncCoupon — mirrors a coupons/{code} doc into a Stripe Coupon +
// Promotion Code so it's redeemable on the checkout page. Admin/owner only.
exports.syncCoupon = onCall({ secrets: STRIPE_SECRETS }, async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const stripe = getStripe();
  if (!stripe) {
    throw new HttpsError('failed-precondition',
      'Stripe isn\'t configured yet — set STRIPE_SECRET_KEY first.');
  }

  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  if (!code) throw new HttpsError('invalid-argument', 'code is required.');
  const ref = db.collection('coupons').doc(code);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Coupon not found.');
  const c = snap.data();
  if (c.stripePromotionCodeId) return { ok: true, alreadySynced: true };

  const couponParams = c.percentOff
    ? { percent_off: Number(c.percentOff) }
    : { amount_off: Math.round(Number(c.amountOff) * 100), currency: 'usd' };
  if (c.expiresAt && c.expiresAt.toDate) {
    couponParams.redeem_by = Math.floor(c.expiresAt.toDate().getTime() / 1000);
  }
  const stripeCoupon = await stripe.coupons.create(couponParams);
  const promo = await stripe.promotionCodes.create({
    coupon: stripeCoupon.id,
    code,
    active: c.active !== false
  });

  await ref.set({
    stripeCouponId: stripeCoupon.id,
    stripePromotionCodeId: promo.id,
    syncedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { ok: true, promotionCodeId: promo.id };
});

// ────────────────────────────────────────────────────────────────
// Affiliate program — referral codes, click tracking, commissions.
//
// Affiliates live at affiliates/{CODE} (created by owner/admin from
// /manage-affiliates.html). Attribution: links carry ?ref=CODE → stored
// client-side (referral.js) → passed to createCheckoutSession → commission
// recorded by the Stripe webhook. Payouts are manual (mark-as-paid ledger).
// ────────────────────────────────────────────────────────────────

// recordAffiliateClick — public, best-effort click counter for ?ref= visits.
exports.recordAffiliateClick = onCall(async (request) => {
  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  if (!code || code.length > 32) return { ok: false };
  const db = admin.firestore();
  // Throttle click inflation: 30 clicks per IP per 10 minutes per code.
  // Fails open on limiter error, and returns a soft {ok:false} on overflow
  // rather than throwing (this is a fire-and-forget beacon from the client).
  try {
    await enforceRateLimit(db, {
      action: 'recordAffiliateClick',
      key: `ip:${clientIp(request)}:${code}`,
      max: 30, windowSec: 600
    });
  } catch (e) {
    if (e instanceof HttpsError) return { ok: false };
    throw e;
  }
  const ref = db.collection('affiliates').doc(code);
  const snap = await ref.get();
  if (!snap.exists || snap.data().active === false) return { ok: false };
  await ref.set({
    clicks: admin.firestore.FieldValue.increment(1),
    lastClickAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// markAffiliatePaid — flips all pending referrals for an affiliate to 'paid'
// and rolls the amount into totalPaid. Owner/admin only (the actual payout
// happens outside the platform — bank transfer, PayPal, etc.).
exports.markAffiliatePaid = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  if (!code) throw new HttpsError('invalid-argument', 'code is required.');

  const affRef = db.collection('affiliates').doc(code);
  const affSnap = await affRef.get();
  if (!affSnap.exists) throw new HttpsError('not-found', 'Affiliate not found.');

  const pending = await affRef.collection('referrals').where('status', '==', 'pending').get();
  if (pending.empty) return { ok: true, paidCount: 0, paidAmount: 0 };

  let paidAmount = 0;
  const batch = db.batch();
  pending.docs.forEach((d) => {
    paidAmount += d.data().commission || 0;
    batch.set(d.ref, {
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paidBy: (request.auth.token && request.auth.token.email) || request.auth.uid
    }, { merge: true });
  });
  paidAmount = Math.round(paidAmount * 100) / 100;
  batch.set(affRef, {
    totalPaid: admin.firestore.FieldValue.increment(paidAmount)
  }, { merge: true });
  await batch.commit();

  return { ok: true, paidCount: pending.size, paidAmount };
});

// ════════════════════════════════════════════════════════════════
// Scheduled reminder emails (CRM tasks + appointments). Reuse SendGrid.
// Each item is reminded once (remindedAt dedupe). Collection-group queries.
// ════════════════════════════════════════════════════════════════
async function emailForUid(db, uid) {
  if (!uid) return null;
  try {
    const u = await db.collection('users').doc(uid).get();
    return u.exists ? (u.data().email || null) : null;
  } catch (e) { return null; }
}

function reminderHtml(title, lines) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;">
    <h2 style="color:#E60306;margin:0 0 12px;">${title}</h2>
    ${lines.map((l) => `<p style="font-size:15px;color:#222;margin:6px 0;">${l}</p>`).join('')}
    <p style="font-size:13px;color:#888;margin-top:18px;">— The One Percent Nation CRM</p>
  </div>`;
}

// ════════════════════════════════════════════════════════════════
// 2-way SMS — send (callable), plus the Telnyx inbound/status webhooks below.
// Conversations live at companies/{cid}/conversations/{contactId} with a
// messages subcollection (written only here, via Admin SDK). The twilio*
// webhooks that follow are the superseded pair, kept as a revert path.
// ════════════════════════════════════════════════════════════════
/**
 * The single answer to "may we text this contact". Used by sendSms and by the
 * sequence sender so the two can never disagree.
 *
 * Consent must be affirmatively on record: `smsConsent === true`, written only
 * by the lead forms (per-channel box ticked), recordSmsConsent (an admin with
 * a note), or the inbound webhook (they texted us first). Anything else —
 * an explicit decline, or no record at all (imports, manual entry) — is a
 * refusal, with a reason that says which. STOP always wins.
 */
function smsSendBlockReason(contact) {
  if (!contact) return 'Contact not found.';
  if (contact.smsOptedOut === true) {
    return 'This contact has opted out of SMS (replied STOP) and cannot be messaged.';
  }
  if (contact.smsConsent !== true) {
    return contact.smsConsent === false
      ? 'This contact declined SMS consent when they registered. Record consent on their record first.'
      : 'No SMS consent is on record for this contact. Record consent on their record first.';
  }
  return null;
}

exports.sendSms = onCall(
  async (request) => {
    const db = admin.firestore();
    const { companyId, contactId, body } = request.data || {};
    if (!companyId || !contactId || !body) {
      throw new HttpsError('invalid-argument', 'companyId, contactId and body are required.');
    }
    await assertCompanyAdmin(db, companyId, request);

    // Throttle outbound SMS: 100 per admin per 10 minutes.
    await rateLimitCaller(db, request, { action: 'sendSms', max: 100, windowSec: 600 });

    const cfg = telnyxSmsConfig();
    if (!cfg.ok) {
      throw new HttpsError('failed-precondition',
        'SMS is not configured yet. Add the Telnyx secrets first (missing ' + cfg.missing.join(', ') + ').');
    }
    const from = cfg.from;

    const cRef = db.collection('companies').doc(companyId).collection('contacts').doc(contactId);
    const cSnap = await cRef.get();
    if (!cSnap.exists) throw new HttpsError('not-found', 'Contact not found.');
    const to = normalizePhone(cSnap.data().phone);
    if (!to) throw new HttpsError('failed-precondition', 'Contact has no phone number.');
    const blocked = smsSendBlockReason(cSnap.data());
    if (blocked) throw new HttpsError('failed-precondition', blocked);

    let msg;
    try {
      msg = await sendTelnyxSms({ to, body });
    } catch (e) {
      throw new HttpsError('internal', 'SMS send failed: ' + (e && e.message));
    }

    const FV = admin.firestore.FieldValue;
    const convRef = db.collection('companies').doc(companyId).collection('conversations').doc(contactId);
    await convRef.set({
      contactId, contactPhone: to, channel: 'sms',
      lastMessageAt: FV.serverTimestamp(), lastMessageText: String(body).slice(0, 200), lastDirection: 'out',
      updatedAt: FV.serverTimestamp(), createdAt: FV.serverTimestamp()
    }, { merge: true });
    await convRef.collection('messages').doc(msg.sid).set({
      direction: 'out', body: String(body), fromNumber: from, toNumber: to,
      status: msg.status || 'sent', twilioSid: msg.sid, provider: 'telnyx',
      sentByUid: request.auth.uid, createdAt: FV.serverTimestamp()
    });
    await cRef.collection('activities').add({
      type: 'manual_sms', description: 'SMS sent: ' + String(body).slice(0, 120),
      actorUid: request.auth.uid, actorName: 'You', createdAt: FV.serverTimestamp(), meta: { direction: 'out' }
    });
    await cRef.set({
      lastActivityAt: FV.serverTimestamp(),
      ...lastContactedFields('sms', 'out')
    }, { merge: true });
    return { ok: true, sid: msg.sid, status: msg.status || 'sent' };
  }
);

exports.twilioInboundWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    const db = admin.firestore();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    // Signature validation — reject anything not signed by Twilio.
    try {
      const twilioLib = require('twilio');
      const signature = req.get('X-Twilio-Signature') || '';
      const url = `https://${req.get('host')}${req.originalUrl}`;
      if (!token || !twilioLib.validateRequest(token, signature, url, req.body || {})) {
        res.status(403).send('invalid signature');
        return;
      }
    } catch (e) { res.status(403).send('signature error'); return; }

    const from = normalizePhone(req.body.From);
    const to = normalizePhone(req.body.To);
    const text = req.body.Body || '';
    const sid = req.body.MessageSid || ('in_' + Date.now());

    try {
      const cid = await resolveAcademyCompanyId(db);
      if (cid && from) {
        const FV = admin.firestore.FieldValue;
        const contactsRef = db.collection('companies').doc(cid).collection('contacts');
        let contactDoc = null;
        const q1 = await contactsRef.where('phone', '==', from).limit(1).get();
        if (!q1.empty) contactDoc = q1.docs[0];
        if (!contactDoc) {
          const newRef = await contactsRef.add({
            name: from, email: null, phone: from, companyName: null,
            source: 'SMS', stage: 'new', tags: [], ownerUid: null,
            createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
            createdBy: 'twilio', lastActivityAt: FV.serverTimestamp()
          });
          contactDoc = await newRef.get();
        }
        const contactId = contactDoc.id;
        const convRef = db.collection('companies').doc(cid).collection('conversations').doc(contactId);
        await convRef.set({
          contactId, contactPhone: from, channel: 'sms',
          lastMessageAt: FV.serverTimestamp(), lastMessageText: String(text).slice(0, 200), lastDirection: 'in',
          unreadCount: FV.increment(1), updatedAt: FV.serverTimestamp(), createdAt: FV.serverTimestamp()
        }, { merge: true });
        await convRef.collection('messages').doc(sid).set({
          direction: 'in', body: String(text), fromNumber: from, toNumber: to,
          status: 'received', twilioSid: sid, createdAt: FV.serverTimestamp()
        });
        await contactDoc.ref.collection('activities').add({
          type: 'sms_received', description: 'SMS received: ' + String(text).slice(0, 120),
          actorUid: 'twilio', actorName: from, createdAt: FV.serverTimestamp(), meta: { direction: 'in' }
        });
        // A reply is the lead engaging: no follow-up cadence should keep
        // firing over the top of a live conversation.
        try { await stopEnrollmentsForContact(db, cid, contactId, 'replied by SMS'); } catch (e) {}

        // ── TCPA opt-out / opt-in keyword handling ──────────────────────────
        // Carriers honor STOP at the network level, but we must also record it
        // so our own sendSms/sendCampaign never message an opted-out number.
        const kw = String(text).trim().toUpperCase().replace(/[^A-Z]/g, '');
        const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT'];
        const START_WORDS = ['START', 'YES', 'UNSTOP', 'OPTIN'];
        if (STOP_WORDS.includes(kw)) {
          await contactDoc.ref.set({
            smsOptedOut: true, smsOptedOutAt: FV.serverTimestamp()
          }, { merge: true });
          await contactDoc.ref.collection('activities').add({
            type: 'sms_opt_out', description: 'Contact opted OUT of SMS (replied ' + kw + ').',
            actorUid: 'twilio', actorName: from, createdAt: FV.serverTimestamp(), meta: { keyword: kw }
          });
        } else if (START_WORDS.includes(kw)) {
          await contactDoc.ref.set({
            smsOptedOut: false, smsOptedInAt: FV.serverTimestamp()
          }, { merge: true });
          await contactDoc.ref.collection('activities').add({
            type: 'sms_opt_in', description: 'Contact opted IN to SMS (replied ' + kw + ').',
            actorUid: 'twilio', actorName: from, createdAt: FV.serverTimestamp(), meta: { keyword: kw }
          });
        }

        await contactDoc.ref.set({
          lastActivityAt: FV.serverTimestamp(),
          ...lastContactedFields('sms', 'in')
        }, { merge: true });
      }
    } catch (e) { console.warn('[twilioInbound]', e && e.message); }

    res.set('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');
  }
);

exports.twilioStatusWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    const db = admin.firestore();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    try {
      const twilioLib = require('twilio');
      const signature = req.get('X-Twilio-Signature') || '';
      const url = `https://${req.get('host')}${req.originalUrl}`;
      if (!token || !twilioLib.validateRequest(token, signature, url, req.body || {})) {
        res.status(403).send('invalid signature');
        return;
      }
    } catch (e) { res.status(403).send('signature error'); return; }

    const sid = req.body.MessageSid;
    const status = req.body.MessageStatus;
    if (sid && status) {
      try {
        const ms = await db.collectionGroup('messages').where('twilioSid', '==', sid).limit(1).get();
        if (!ms.empty) await ms.docs[0].ref.set({ status }, { merge: true });
      } catch (e) { console.warn('[twilioStatus] (index?)', e && e.message); }
    }
    res.status(200).send('ok');
  }
);


// ════════════════════════════════════════════════════════════════
// Telnyx 2-way SMS webhooks.
//
// Point the number's messaging profile at telnyxInboundWebhook for inbound
// and at telnyxStatusWebhook for delivery receipts (Telnyx will happily send
// both to one URL; we keep them split so a status flood can never touch the
// contact-creation path).
//
// Both verify the Ed25519 signature over req.rawBody before touching
// Firestore, and both answer 200 on anything they cannot act on so Telnyx
// does not retry a payload we will never understand.
// ════════════════════════════════════════════════════════════════

/** Telnyx nests everything under data.payload; normalise the bits we use. */
function telnyxMessagePayload(req) {
  const data = (req.body && req.body.data) || {};
  const payload = data.payload || {};
  const toList = Array.isArray(payload.to) ? payload.to : [];
  return {
    eventType: data.event_type || '',
    id: payload.id || '',
    text: payload.text || '',
    from: normalizePhone(payload.from && payload.from.phone_number),
    to: normalizePhone(toList[0] && toList[0].phone_number),
    // Delivery state lives per-recipient, not on the message.
    recipientStatus: (toList[0] && toList[0].status) || ''
  };
}

exports.telnyxInboundWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    if (!telnyxSignatureOk(req)) { res.status(403).send('invalid signature'); return; }
    const db = admin.firestore();
    const m = telnyxMessagePayload(req);
    if (m.eventType !== 'message.received') { res.status(200).send('ignored'); return; }

    const from = m.from;
    const to = m.to;
    const text = m.text;
    const sid = m.id || ('in_' + Date.now());

    try {
      const cid = await resolveAcademyCompanyId(db);
      if (cid && from) {
        const FV = admin.firestore.FieldValue;
        const contactsRef = db.collection('companies').doc(cid).collection('contacts');
        let contactDoc = null;
        const q1 = await contactsRef.where('phone', '==', from).limit(1).get();
        if (!q1.empty) contactDoc = q1.docs[0];
        if (!contactDoc) {
          const newRef = await contactsRef.add({
            name: from, email: null, phone: from, companyName: null,
            source: 'SMS', stage: 'new', tags: [], ownerUid: null,
            createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
            createdBy: 'telnyx', lastActivityAt: FV.serverTimestamp()
          });
          contactDoc = await newRef.get();
        }
        const contactId = contactDoc.id;
        const convRef = db.collection('companies').doc(cid).collection('conversations').doc(contactId);
        await convRef.set({
          contactId, contactPhone: from, channel: 'sms',
          lastMessageAt: FV.serverTimestamp(), lastMessageText: String(text).slice(0, 200), lastDirection: 'in',
          unreadCount: FV.increment(1), updatedAt: FV.serverTimestamp(), createdAt: FV.serverTimestamp()
        }, { merge: true });
        await convRef.collection('messages').doc(sid).set({
          direction: 'in', body: String(text), fromNumber: from, toNumber: to,
          status: 'received', twilioSid: sid, provider: 'telnyx', createdAt: FV.serverTimestamp()
        });
        await contactDoc.ref.collection('activities').add({
          type: 'sms_received', description: 'SMS received: ' + String(text).slice(0, 120),
          actorUid: 'telnyx', actorName: from, createdAt: FV.serverTimestamp(), meta: { direction: 'in' }
        });
        // A reply is the lead engaging: no follow-up cadence should keep
        // firing over the top of a live conversation.
        try { await stopEnrollmentsForContact(db, cid, contactId, 'replied by SMS'); } catch (e) {}

        // ── TCPA opt-out / opt-in keyword handling ──────────────────────────
        // Carriers honor STOP at the network level, but we must also record it
        // so our own sendSms/sendCampaign never message an opted-out number.
        const kw = String(text).trim().toUpperCase().replace(/[^A-Z]/g, '');
        const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT'];
        const START_WORDS = ['START', 'YES', 'UNSTOP', 'OPTIN'];
        if (STOP_WORDS.includes(kw)) {
          await contactDoc.ref.set({
            smsOptedOut: true, smsOptedOutAt: FV.serverTimestamp()
          }, { merge: true });
          await contactDoc.ref.collection('activities').add({
            type: 'sms_opt_out', description: 'Contact opted OUT of SMS (replied ' + kw + ').',
            actorUid: 'telnyx', actorName: from, createdAt: FV.serverTimestamp(), meta: { keyword: kw }
          });
        } else if (START_WORDS.includes(kw)) {
          await contactDoc.ref.set({
            smsOptedOut: false, smsOptedInAt: FV.serverTimestamp()
          }, { merge: true });
          await contactDoc.ref.collection('activities').add({
            type: 'sms_opt_in', description: 'Contact opted IN to SMS (replied ' + kw + ').',
            actorUid: 'telnyx', actorName: from, createdAt: FV.serverTimestamp(), meta: { keyword: kw }
          });
        }

        // Someone who texts us first has asked for a reply. Under the strict
        // send gate that has to be on record or the conversation cannot be
        // answered. A STOP in the same message wins: smsOptedOut is checked
        // before consent, and we do not record consent on a STOP.
        if (!STOP_WORDS.includes(kw) && contactDoc.data().smsConsent !== true
            && contactDoc.data().smsOptedOut !== true) {
          const inboundText = `Texted us first from ${from}`;
          await contactDoc.ref.set({
            smsConsent: true, smsConsentAt: FV.serverTimestamp(), smsConsentText: inboundText,
            smsConsentDeclinedAt: FV.delete()
          }, { merge: true });
          await contactDoc.ref.collection('activities').add({
            type: 'consent_updated', description: 'SMS consent: ' + inboundText + '.',
            actorUid: 'telnyx', actorName: from, createdAt: FV.serverTimestamp(),
            meta: { channel: 'inbound-sms', smsConsent: true, consentText: { sms: inboundText } }
          });
        }

        await contactDoc.ref.set({
          lastActivityAt: FV.serverTimestamp(),
          ...lastContactedFields('sms', 'in')
        }, { merge: true });
      }
    } catch (e) { console.warn('[telnyxInbound]', e && e.message); }

    res.status(200).send('ok');
  }
);

exports.telnyxStatusWebhook = onRequest(
  { cors: false, invoker: 'public' },
  async (req, res) => {
    if (!telnyxSignatureOk(req)) { res.status(403).send('invalid signature'); return; }
    const db = admin.firestore();
    const m = telnyxMessagePayload(req);
    // message.sent is the handoff to the carrier; message.finalized carries the
    // terminal delivered / failed state.
    if (m.eventType !== 'message.sent' && m.eventType !== 'message.finalized') {
      res.status(200).send('ignored'); return;
    }
    if (m.id && m.recipientStatus) {
      try {
        const ms = await db.collectionGroup('messages').where('twilioSid', '==', m.id).limit(1).get();
        if (!ms.empty) await ms.docs[0].ref.set({ status: m.recipientStatus }, { merge: true });
      } catch (e) { console.warn('[telnyxStatus] (index?)', e && e.message); }
    }
    res.status(200).send('ok');
  }
);

// ════════════════════════════════════════════════════════════════
// Twilio Voice — browser softphone, cell bridge, inbound routing, call
// status/recording webhooks, and one-click voicemail drop.
//
// Two ways out:
//   softphone — the browser registers as client:agent_<uid> against the TwiML
//     App; device.connect() hits voiceOutboundTwiml, which <Dial>s the lead.
//   bridge — startBridgeCall rings the rep's own cell from Twilio; when they
//     pick up, voiceBridgeTwiml <Dial>s the lead. No WebRTC, works on mobile.
//
// Every path writes back to companies/{cid}/calls/{callId}, created by the
// client the moment dialing starts, so one call has one row no matter which
// mode placed it.
// ════════════════════════════════════════════════════════════════

/**
 * Load the company's dialer settings, which live on the company doc (admins
 * can already write it, so this needs no extra collection or rules).
 */
async function dialerSettings(db, companyId) {
  const defaults = { recordingMode: 'off', quietHoursEnabled: true, quietHoursStart: 21, quietHoursEnd: 8 };
  try {
    const snap = await db.collection('companies').doc(companyId).get();
    return { ...defaults, ...((snap.exists && snap.data().dialer) || {}) };
  } catch (e) { return defaults; }
}

/**
 * getVoiceToken({ companyId }) — a short-lived JWT for the browser softphone.
 *
 * Identity is pinned to the caller's own uid: a token cannot be minted for
 * someone else, so inbound routing to client:agent_<uid> is trustworthy.
 */
exports.getVoiceToken = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId } = request.data || {};
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
  const { uid } = await assertCompanyAdmin(db, companyId, request);

  // Tokens are cheap but not free, and a loop that re-mints on every render
  // would be invisible without this.
  await rateLimitCaller(db, request, { action: 'getVoiceToken', max: 60, windowSec: 600 });

  const cfg = telnyxVoiceConfig();
  if (!cfg.ok) {
    throw new HttpsError('failed-precondition',
      'Calling is not set up yet. Missing: ' + cfg.missing.join(', ') + '.');
  }

  // Telnyx authenticates the browser with a JWT minted against a per-agent
  // telephony credential. The JWT is good for 24 hours or until the parent
  // credential expires, whichever comes first; we report a 1 hour lifetime so
  // the client refreshes well inside that and a stale tab never fails a call.
  let agent;
  try {
    agent = await ensureAgentCredential(db, companyId, uid);
  } catch (e) {
    throw new HttpsError('failed-precondition',
      'Could not create a calling credential: ' + (e && e.message));
  }

  let token;
  try {
    // This endpoint answers with the bare JWT, not a JSON envelope.
    const res = await fetch(`${TELNYX_API}/telephony_credentials/${agent.credentialId}/token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` }
    });
    const text = (await res.text()).trim();
    if (!res.ok || !text) throw new Error(text || `HTTP ${res.status}`);
    token = text;
  } catch (e) {
    throw new HttpsError('internal', 'Could not mint a calling token: ' + (e && e.message));
  }

  return {
    token,
    identity: agent.sipUsername || `agent_${uid}`,
    expiresAt: Date.now() + 3600 * 1000,
    callerId: cfg.callerId
  };
});

/**
 * A minimal TeXML builder.
 *
 * TeXML is TwiML-compatible markup, so this exposes the same fluent subset the
 * voice endpoints already used from the Twilio SDK — say/dial/record/hangup,
 * with number/client/sip nested under dial — and nothing else. Hand-rolling it
 * is what lets the twilio package be dropped without rewriting every endpoint.
 *
 * Attribute names are passed through as given, because TeXML uses TwiML's
 * camelCase (callerId, answerOnBridge, recordingStatusCallback).
 */
function xmlEscape(v) {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function attrString(attrs) {
  return Object.keys(attrs || {})
    .filter((k) => attrs[k] !== undefined && attrs[k] !== null && attrs[k] !== '')
    .map((k) => ` ${k}="${xmlEscape(attrs[k])}"`)
    .join('');
}

function texmlResponse() {
  const parts = [];
  const self = {
    say(attrs, text) {
      // Called as say(text) or say(attrs, text), matching the Twilio builder.
      if (typeof attrs === 'string') { text = attrs; attrs = {}; }
      parts.push(`<Say${attrString(attrs)}>${xmlEscape(text)}</Say>`);
      return self;
    },
    hangup() { parts.push('<Hangup/>'); return self; },
    reject(attrs) { parts.push(`<Reject${attrString(attrs)}/>`); return self; },
    record(attrs) { parts.push(`<Record${attrString(attrs)}/>`); return self; },
    pause(attrs) { parts.push(`<Pause${attrString(attrs)}/>`); return self; },
    play(attrs, url) {
      if (typeof attrs === 'string') { url = attrs; attrs = {}; }
      parts.push(`<Play${attrString(attrs)}>${xmlEscape(url)}</Play>`);
      return self;
    },
    dial(attrs) {
      const nested = [];
      const dialSelf = {
        number(n, nAttrs) { nested.push(`<Number${attrString(nAttrs)}>${xmlEscape(n)}</Number>`); return dialSelf; },
        sip(uri, sAttrs) { nested.push(`<Sip${attrString(sAttrs)}>${xmlEscape(uri)}</Sip>`); return dialSelf; }
      };
      // The element is serialised lazily so nested children added after the
      // dial() call still land inside it.
      parts.push(() => nested.length
        ? `<Dial${attrString(attrs)}>${nested.join('')}</Dial>`
        : `<Dial${attrString(attrs)}/>`);
      return dialSelf;
    },
    toString() {
      const body = parts.map((p) => (typeof p === 'function' ? p() : p)).join('');
      return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
    }
  };
  return self;
}

/**
 * A callback token for the webhook URLs we build ourselves.
 *
 * Telnyx signs webhooks with Ed25519, and the voice endpoints check that
 * first. This is a second, independent proof for the callbacks we hand Telnyx
 * in a Url or StatusCallback parameter: the URL is known only to us and to
 * Telnyx, and the token is an HMAC keyed on the API key, which never leaves
 * the server. Belt and braces, because the alternative to a callback we cannot
 * authenticate is a public endpoint that writes call records.
 */
function voiceCallbackToken(companyId, callId) {
  const key = telnyxApiKey();
  if (!key) return '';
  return require('crypto')
    .createHmac('sha256', key)
    .update(`${companyId}|${callId}`)
    .digest('hex')
    .slice(0, 32);
}

/** Accept a Telnyx-signed request, or one carrying a token we issued. */
function telnyxVoiceWebhookOk(req) {
  if (telnyxSignatureOk(req)) return true;
  const token = (req.query && req.query.token ? String(req.query.token) : '');
  if (!token) return false;
  const companyId = (req.query.companyId || '').toString();
  const callId = (req.query.callId || '').toString();
  const expected = voiceCallbackToken(companyId, callId);
  if (!expected || token.length !== expected.length) return false;
  try {
    return require('crypto').timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch (e) { return false; }
}

/**
 * SIP URIs for the agents' browsers, so an inbound TeXML <Dial> can ring them.
 * Only agents who have a telephony credential appear, which means only agents
 * who have opened the dialer at least once — a rep who never has cannot be
 * rung, and ringing nobody is what the voicemail fallback is for.
 */
async function agentSipTargets(db, companyId, uids) {
  if (!uids || !uids.length) return [];
  const snap = await db.collection('companies').doc(companyId)
    .collection('private').doc('telnyxAgents').get();
  const agents = (snap.exists && snap.data().agents) || {};
  return uids
    .map((u) => agents[u] && agents[u].sipUsername)
    .filter(Boolean)
    .map((username) => `sip:${username}@sip.telnyx.com`);
}

/**
 * authorizeCall — the server's say on whether this call may be placed.
 *
 * Twilio's softphone path re-read the lead's number from Firestore inside
 * voiceOutboundTwiml, so a tampered client could not dial anywhere. Telnyx
 * WebRTC dials the PSTN directly from the browser, so that interception point
 * is gone and this callable replaces it: the client must call it immediately
 * before dialing, and it re-checks consent server-side and returns the number
 * and caller ID to use.
 *
 * Be clear about what this is and is not. Against an honest client it enforces
 * do-not-call and SMS-style opt-out the same way the TwiML <Reject> did.
 * Against a tampered client it does not, because the browser holds a real SIP
 * credential and could dial without asking. The hard limit on that is the
 * Telnyx outbound voice profile — destination restrictions and a daily spend
 * cap — which is why docs/telnyx-setup.md treats it as required setup rather
 * than as billing configuration.
 */
exports.authorizeCall = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId, contactId } = request.data || {};
  if (!companyId || !contactId) {
    throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
  }
  await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'authorizeCall', max: 300, windowSec: 600 });

  const cfg = telnyxVoiceConfig();
  if (!cfg.ok) {
    throw new HttpsError('failed-precondition',
      'Calling is not set up yet. Missing: ' + cfg.missing.join(', ') + '.');
  }

  // Every refusal below carries { blocked: true } in the error details, and the
  // client keys off that rather than the message text. Matching on wording is
  // how a hard stop quietly becomes a fallback: reword one string and a
  // do-not-call contact starts getting dialed from the phone's own dialer. The
  // configuration failure above is deliberately NOT flagged, because degrading
  // to the manual handoff is the right answer when calling is merely unset up.
  const blocked = (message) => new HttpsError('failed-precondition', message, { blocked: true });

  const cSnap = await db.collection('companies').doc(companyId)
    .collection('contacts').doc(contactId).get();
  // A contact the server cannot find must not be dialed by any route.
  if (!cSnap.exists) throw new HttpsError('not-found', 'Contact not found.', { blocked: true });
  const contact = cSnap.data();

  if (contact.doNotCall === true) {
    throw blocked('This contact is marked do not call and cannot be dialed.');
  }
  const to = normalizePhone(contact.phone);
  if (!to) throw blocked('Contact has no phone number.');

  return { ok: true, to, callerId: cfg.callerId };
});

/**
 * voiceOutboundTwiml — the TwiML App's Voice URL. Twilio calls this when the
 * softphone dials, with the params device.connect() passed through.
 *
 * Those params come from a browser, so they are verified here rather than
 * trusted: the client identity in `From` must really admin the companyId it
 * claims, and the lead's number is read from Firestore rather than from the
 * request, so a tampered client cannot use our caller ID to dial anywhere.
 */
exports.voiceOutboundTwiml = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const VoiceResponse = require('twilio').twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (!twilioSignatureOk(req)) { res.status(403).send('invalid signature'); return; }

  const db = admin.firestore();
  const companyId = (req.body.companyId || '').toString();
  const contactId = (req.body.contactId || '').toString();
  const callId = (req.body.callId || '').toString();
  const agentUid = uidFromClientIdentity(req.body.From);

  const say = (msg) => {
    twiml.say({ voice: 'alice' }, msg);
    twiml.hangup();
    res.set('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());
  };

  try {
    if (!companyId || !contactId) return say('This call is missing its contact details.');
    if (!agentUid || !(await uidAdminsCompany(db, companyId, agentUid))) {
      console.warn('[voiceOutbound] identity/company mismatch', req.body.From, companyId);
      return say('You are not authorized to place calls for this account.');
    }

    const cRef = db.collection('companies').doc(companyId).collection('contacts').doc(contactId);
    const cSnap = await cRef.get();
    if (!cSnap.exists) return say('That contact no longer exists.');
    const contact = cSnap.data();

    // The do-not-call guard is enforced here as well as in the browser: the
    // server is the only place it cannot be skipped.
    if (contact.doNotCall === true) {
      console.warn('[voiceOutbound] blocked do-not-call contact', contactId);
      return say('This contact is on the do-not-call list.');
    }
    const to = normalizePhone(contact.phone);
    if (!to) return say('This contact has no phone number.');

    const cfg = voiceConfig();
    const settings = await dialerSettings(db, companyId);

    // Two-party-consent states make the announcement the only defensible
    // default when recording is on at all.
    if (settings.recordingMode === 'announce') {
      twiml.say({ voice: 'alice' }, 'This call may be recorded for quality purposes.');
    }

    const base = fnBaseUrl(req);
    const dialAttrs = {
      callerId: cfg.callerId,
      answerOnBridge: true,
      action: `${base}/voiceStatusWebhook?companyId=${encodeURIComponent(companyId)}&callId=${encodeURIComponent(callId)}`,
      method: 'POST'
    };
    if (settings.recordingMode === 'announce' || settings.recordingMode === 'on') {
      dialAttrs.record = 'record-from-answer-dual';
      dialAttrs.recordingStatusCallback =
        `${base}/voiceRecordingWebhook?companyId=${encodeURIComponent(companyId)}&callId=${encodeURIComponent(callId)}`;
      dialAttrs.recordingStatusCallbackMethod = 'POST';
    }
    twiml.dial(dialAttrs).number(to);

    res.set('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());
  } catch (e) {
    console.error('[voiceOutbound]', e && e.message);
    return say('Something went wrong placing this call.');
  }
});

/**
 * startBridgeCall({ companyId, contactId, callId }) — cell-bridge mode.
 * Twilio rings the rep's own mobile; voiceBridgeTwiml dials the lead once
 * they answer. The rep never needs a working microphone in the browser.
 */
exports.startBridgeCall = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId, contactId, callId } = request.data || {};
  if (!companyId || !contactId) {
    throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
  }
  const { uid } = await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'startBridgeCall', max: 120, windowSec: 600 });

  const cfg = telnyxVoiceConfig();
  if (!cfg.ok || !cfg.texmlAppId) {
    const missing = cfg.ok ? ['TELNYX_TEXML_APP_ID'] : cfg.missing;
    throw new HttpsError('failed-precondition',
      'Cell-bridge calling is not set up yet. Missing: ' + missing.join(', ') + '.');
  }

  const meSnap = await db.collection('users').doc(uid).get();
  const agentCell = normalizePhone(meSnap.exists && meSnap.data().mobilePhone);
  if (!agentCell) {
    throw new HttpsError('failed-precondition',
      'Add your mobile number in CRM Settings to use cell-bridge mode.');
  }

  const cSnap = await db.collection('companies').doc(companyId)
    .collection('contacts').doc(contactId).get();
  if (!cSnap.exists) throw new HttpsError('not-found', 'Contact not found.');
  if (cSnap.data().doNotCall === true) {
    throw new HttpsError('failed-precondition', 'This contact is on the do-not-call list.');
  }
  if (!normalizePhone(cSnap.data().phone)) {
    throw new HttpsError('failed-precondition', 'Contact has no phone number.');
  }

  const base = functionsBaseUrl();
  const token = voiceCallbackToken(companyId, callId || '');
  const q = `companyId=${encodeURIComponent(companyId)}`
    + `&callId=${encodeURIComponent(callId || '')}`
    + `&token=${encodeURIComponent(token)}`;
  const bridgeUrl = `${base}/voiceBridgeTwiml?${q}`
    + `&contactId=${encodeURIComponent(contactId)}`
    + `&agentUid=${encodeURIComponent(uid)}`;

  let call;
  try {
    // TeXML's outbound-call endpoint takes Twilio-shaped parameters, so the
    // call is set up exactly as before: ring the rep's cell, then fetch the
    // bridge document to find out who to connect them to.
    call = await telnyx('POST', `/texml/calls/${encodeURIComponent(cfg.texmlAppId)}`, {
      To: agentCell,
      From: cfg.callerId,
      Url: bridgeUrl,
      StatusCallback: `${base}/voiceStatusWebhook?${q}`,
      StatusCallbackMethod: 'POST'
    });
  } catch (e) {
    throw new HttpsError('internal', 'Telnyx could not start the call: ' + (e && e.message));
  }

  const sid = (call && (call.call_sid || call.sid || call.call_control_id)) || null;
  if (callId) {
    try {
      await db.collection('companies').doc(companyId).collection('calls').doc(callId).set({
        twilioCallSid: sid, mode: 'bridge', status: 'ringing',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e) { /* the client also writes this; losing the mirror is survivable */ }
  }

  return { ok: true, sid, ringing: agentCell };
});

/**
 * voiceBridgeTwiml — answered by the rep's cell in bridge mode. Reads the
 * lead's number from Firestore (never the query string) and dials it.
 */
exports.voiceBridgeTwiml = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const twiml = texmlResponse();
  const send = () => {
    res.set('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());
  };

  if (!telnyxVoiceWebhookOk(req)) { res.status(403).send('invalid signature'); return; }

  const db = admin.firestore();
  const companyId = (req.query.companyId || '').toString();
  const contactId = (req.query.contactId || '').toString();
  const callId = (req.query.callId || '').toString();
  const agentUid = (req.query.agentUid || '').toString();

  try {
    if (!(await uidAdminsCompany(db, companyId, agentUid))) {
      twiml.say('This call is no longer authorized.');
      twiml.hangup();
      return send();
    }
    const cSnap = await db.collection('companies').doc(companyId)
      .collection('contacts').doc(contactId).get();
    const contact = cSnap.exists ? cSnap.data() : null;
    const to = contact && contact.doNotCall !== true ? normalizePhone(contact.phone) : null;
    if (!to) {
      twiml.say('That contact can no longer be called.');
      twiml.hangup();
      return send();
    }

    const cfg = telnyxVoiceConfig();
    const settings = await dialerSettings(db, companyId);
    twiml.say(`Connecting you to ${(contact.name || 'your contact').toString().slice(0, 60)}.`);
    if (settings.recordingMode === 'announce') {
      twiml.say('This call may be recorded for quality purposes.');
    }

    const base = fnBaseUrl(req);
    const token = voiceCallbackToken(companyId, callId);
    const dialAttrs = { callerId: cfg.callerId, answerOnBridge: true };
    if (settings.recordingMode === 'announce' || settings.recordingMode === 'on') {
      dialAttrs.record = 'record-from-answer-dual';
      dialAttrs.recordingStatusCallback =
        `${base}/voiceRecordingWebhook?companyId=${encodeURIComponent(companyId)}`
        + `&callId=${encodeURIComponent(callId)}&token=${encodeURIComponent(token)}`;
      dialAttrs.recordingStatusCallbackMethod = 'POST';
    }
    twiml.dial(dialAttrs).number(to);
    return send();
  } catch (e) {
    console.error('[voiceBridge]', e && e.message);
    twiml.say('Something went wrong connecting this call.');
    twiml.hangup();
    return send();
  }
});

/**
 * voiceInboundTwiml — point the Twilio number's Voice webhook here. Rings the
 * owning rep's softphone, falls back to voicemail, and makes sure a returning
 * lead lands on a real contact record rather than a mystery number.
 */
exports.voiceInboundTwiml = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const twiml = texmlResponse();
  const send = () => {
    res.set('Content-Type', 'text/xml');
    res.status(200).send(twiml.toString());
  };

  // This URL is configured by hand in the Telnyx portal, so it cannot carry a
  // token we issued: the Ed25519 signature is the only check, and with no
  // public key configured inbound calls will not ring. That is fail-closed by
  // design — the endpoint creates contacts.
  if (!telnyxSignatureOk(req)) { res.status(403).send('invalid signature'); return; }

  const db = admin.firestore();
  const FV = admin.firestore.FieldValue;
  const from = normalizePhone(req.body.From);
  const to = normalizePhone(req.body.To);
  const sid = req.body.CallSid || null;

  try {
    const cid = await resolveAcademyCompanyId(db);
    if (!cid || !from) {
      twiml.say('Thanks for calling. Please try again later.');
      twiml.hangup();
      return send();
    }

    // Same upsert-by-phone the inbound SMS webhook does, so a lead who texts
    // and then calls is one contact, not two.
    const contactsRef = db.collection('companies').doc(cid).collection('contacts');
    let contactDoc = null;
    const q1 = await contactsRef.where('phone', '==', from).limit(1).get();
    if (!q1.empty) contactDoc = q1.docs[0];
    if (!contactDoc) {
      const newRef = await contactsRef.add({
        name: from, email: null, phone: from, companyName: null,
        source: 'Inbound call', stage: 'new', tags: [], ownerUid: null,
        createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
        createdBy: 'telnyx', lastActivityAt: FV.serverTimestamp()
      });
      contactDoc = await newRef.get();
    }
    const contact = contactDoc.data();

    const callRef = db.collection('companies').doc(cid).collection('calls').doc();
    await callRef.set({
      contactId: contactDoc.id,
      contactName: contact.name || from,
      contactPhone: from,
      direction: 'in',
      mode: 'softphone',
      status: 'ringing',
      disposition: null,
      dispositionNote: null,
      twilioCallSid: sid,
      durationSec: null,
      agentUid: contact.ownerUid || null,
      agentName: null,
      startedAt: FV.serverTimestamp(),
      endedAt: null,
      createdAt: FV.serverTimestamp(),
      updatedAt: FV.serverTimestamp()
    });
    await contactDoc.ref.collection('activities').add({
      type: 'call_inbound',
      description: 'Inbound call from ' + from,
      actorUid: 'telnyx', actorName: from,
      createdAt: FV.serverTimestamp(),
      meta: { callId: callRef.id, direction: 'in' }
    });
    try { await stopEnrollmentsForContact(db, cid, contactDoc.id, 'called in'); } catch (e) {}
    await contactDoc.ref.set({
      lastActivityAt: FV.serverTimestamp(),
      ...lastContactedFields('call', 'in')
    }, { merge: true });

    const base = fnBaseUrl(req);
    const token = voiceCallbackToken(cid, callRef.id);
    const statusUrl = `${base}/voiceStatusWebhook?companyId=${encodeURIComponent(cid)}`
      + `&callId=${encodeURIComponent(callRef.id)}&token=${encodeURIComponent(token)}`;

    // Ring the assigned rep if there is one; otherwise every admin at once,
    // because an unassigned inbound lead going to voicemail is a lost lead.
    const targets = [];
    if (contact.ownerUid) targets.push(contact.ownerUid);
    else {
      const coSnap = await db.collection('companies').doc(cid).get();
      ((coSnap.exists && coSnap.data().adminUids) || []).slice(0, 5).forEach((u) => targets.push(u));
    }

    // Twilio addressed a browser as <Client>identity</Client>. Telnyx has no
    // such verb: a registered WebRTC client is a SIP endpoint, reached at its
    // credential's SIP username.
    const sipTargets = await agentSipTargets(db, cid, targets);
    if (sipTargets.length) {
      const dial = twiml.dial({
        timeout: 20,
        answerOnBridge: true,
        action: statusUrl,
        method: 'POST'
      });
      sipTargets.forEach((uri) => dial.sip(uri));
    }

    // Reached when nobody answers (or nobody is registered).
    twiml.say('Sorry we missed you. Please leave a message after the tone and we will call you right back.');
    twiml.record({
      maxLength: 120,
      playBeep: true,
      recordingStatusCallback:
        `${base}/voiceRecordingWebhook?companyId=${encodeURIComponent(cid)}`
        + `&callId=${encodeURIComponent(callRef.id)}&voicemail=1&token=${encodeURIComponent(token)}`,
      recordingStatusCallbackMethod: 'POST'
    });
    twiml.hangup();
    return send();
  } catch (e) {
    console.error('[voiceInbound]', e && e.message);
    twiml.say('Thanks for calling. Please try again later.');
    twiml.hangup();
    return send();
  }
});

/**
 * voiceStatusWebhook — call lifecycle. Used both as a <Dial action> and as a
 * statusCallback, which post different field names, so both are read.
 *
 * Looks the row up by the callId we threaded through the query string, and
 * falls back to a collectionGroup lookup by SID for calls we did not originate
 * (inbound legs, or a callId that never made it).
 */
exports.voiceStatusWebhook = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  // Always answer with valid TeXML: this doubles as a <Dial action>, and a
  // non-TeXML body there drops the call.
  const respond = () => {
    res.set('Content-Type', 'text/xml');
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  };

  if (!telnyxVoiceWebhookOk(req)) { res.status(403).send('invalid signature'); return; }

  const db = admin.firestore();
  const companyId = (req.query.companyId || '').toString();
  const callId = (req.query.callId || '').toString();
  const sid = req.body.DialCallSid || req.body.CallSid || null;
  const status = req.body.DialCallStatus || req.body.CallStatus || null;
  const durationRaw = req.body.DialCallDuration || req.body.CallDuration || req.body.RecordingDuration;
  const durationSec = durationRaw != null ? Number(durationRaw) : null;

  try {
    let ref = null;
    if (companyId && callId) {
      ref = db.collection('companies').doc(companyId).collection('calls').doc(callId);
      const snap = await ref.get();
      if (!snap.exists) ref = null;
    }
    if (!ref && sid) {
      const found = await db.collectionGroup('calls').where('twilioCallSid', '==', sid).limit(1).get();
      if (!found.empty) ref = found.docs[0].ref;
    }
    if (!ref) { respond(); return; }

    const patch = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (status) patch.status = status;
    if (sid) patch.twilioCallSid = sid;
    if (Number.isFinite(durationSec)) patch.durationSec = durationSec;
    if (status && ['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
      patch.endedAt = admin.firestore.FieldValue.serverTimestamp();
    }
    await ref.set(patch, { merge: true });

    // A completed call is worth a timeline entry even if the rep closes the
    // tab before picking a disposition — otherwise the attempt disappears.
    const snap = await ref.get();
    const data = snap.data() || {};
    if (status === 'completed' && data.contactId && !data.statusActivityAt) {
      const cRef = db.collection('companies').doc(companyId || snap.ref.parent.parent.id)
        .collection('contacts').doc(data.contactId);
      await cRef.collection('activities').add({
        type: 'call_completed',
        description: Number.isFinite(durationSec) && durationSec > 0
          ? `Call ended after ${durationSec}s`
          : 'Call ended with no answer',
        actorUid: 'telnyx', actorName: 'Phone system',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        meta: { callId: snap.id, status, durationSec: durationSec || 0 }
      }).catch(() => {});
      await ref.set({ statusActivityAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      // A ringout is an attempt, not a conversation. Only a call that actually
      // connected resets the contact clock — otherwise dialling a dead number
      // every morning would keep a lead looking freshly worked forever.
      const connected = Number.isFinite(durationSec) && durationSec > 0;
      await cRef.set({
        lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(connected ? lastContactedFields('call', data.direction === 'in' ? 'in' : 'out') : {})
      }, { merge: true }).catch(() => {});
    }
  } catch (e) {
    console.warn('[voiceStatus]', e && e.message);
  }
  respond();
});

/**
 * voiceRecordingWebhook — the recording (or inbound voicemail) is ready.
 * Stores Twilio's own URL rather than re-hosting the audio; playback in the
 * CRM is an <audio src> against it.
 */
exports.voiceRecordingWebhook = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  if (!telnyxVoiceWebhookOk(req)) { res.status(403).send('invalid signature'); return; }

  const db = admin.firestore();
  const FV = admin.firestore.FieldValue;
  const companyId = (req.query.companyId || '').toString();
  const callId = (req.query.callId || '').toString();
  const isVoicemail = req.query.voicemail === '1';
  // Telnyx sends a complete, playable URL; Twilio sent one needing a format
  // suffix. Only append .mp3 when there is no extension already.
  const rawUrl = req.body.RecordingUrl ? String(req.body.RecordingUrl) : null;
  const url = rawUrl ? (/\.(mp3|wav|ogg)(\?|$)/i.test(rawUrl) ? rawUrl : rawUrl + '.mp3') : null;
  const durationSec = req.body.RecordingDuration != null ? Number(req.body.RecordingDuration) : null;

  try {
    if (companyId && callId && url) {
      const ref = db.collection('companies').doc(companyId).collection('calls').doc(callId);
      await ref.set({
        recordingUrl: url,
        recordingStatus: 'ready',
        recordingIsVoicemail: isVoicemail,
        ...(Number.isFinite(durationSec) ? { recordingDurationSec: durationSec } : {}),
        updatedAt: FV.serverTimestamp()
      }, { merge: true });

      // An inbound voicemail is a lead asking to be called back, so it earns
      // its own timeline entry rather than sitting silently on the call row.
      if (isVoicemail) {
        const snap = await ref.get();
        const contactId = (snap.data() || {}).contactId;
        if (contactId) {
          await db.collection('companies').doc(companyId).collection('contacts').doc(contactId)
            .collection('activities').add({
              type: 'voicemail_received',
              description: `Voicemail left (${durationSec || '?'}s)`,
              actorUid: 'telnyx', actorName: 'Phone system',
              createdAt: FV.serverTimestamp(),
              meta: { callId, durationSec: durationSec || null }
            }).catch(() => {});
        }
      }
    }
  } catch (e) {
    console.warn('[voiceRecording]', e && e.message);
  }
  res.status(200).send('ok');
});

/**
 * dropVoicemail({ companyId, callSid, dropId }) — redirect a live call into a
 * prerecorded greeting. The point is speed: the rep hears the voicemail beep,
 * hits one button, and moves to the next lead instead of talking.
 */
exports.dropVoicemail = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId, callSid, dropId } = request.data || {};
  if (!companyId || !callSid) {
    throw new HttpsError('invalid-argument', 'companyId and callSid are required.');
  }
  await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'dropVoicemail', max: 200, windowSec: 600 });

  if (!telnyxApiKey()) throw new HttpsError('failed-precondition', 'Calling is not set up yet.');

  // Named drop, else the one marked default, else the most recent.
  const dropsCol = db.collection('companies').doc(companyId).collection('voicemailDrops');
  let drop = null;
  if (dropId) {
    const snap = await dropsCol.doc(dropId).get();
    if (snap.exists) drop = { id: snap.id, ...snap.data() };
  }
  if (!drop) {
    const snap = await dropsCol.where('isDefault', '==', true).limit(1).get();
    if (!snap.empty) drop = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  if (!drop) {
    const snap = await dropsCol.orderBy('createdAt', 'desc').limit(1).get().catch(() => null);
    if (snap && !snap.empty) drop = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  if (!drop || !drop.playToken) {
    throw new HttpsError('failed-precondition',
      'Record a voicemail greeting in CRM Settings first.');
  }

  // Telnyx redirects a live call to a TeXML *document*, where Twilio accepted
  // inline markup, so the greeting is served from voicemailTexml and only its
  // URL is handed over.
  const texmlUrl = `${functionsBaseUrl()}/voicemailTexml`
    + `?cid=${encodeURIComponent(companyId)}`
    + `&id=${encodeURIComponent(drop.id)}`
    + `&token=${encodeURIComponent(drop.playToken)}`;

  try {
    await telnyx('POST', `/texml/calls/${encodeURIComponent(callSid)}/update`, {
      Url: texmlUrl,
      Method: 'POST'
    });
  } catch (e) {
    throw new HttpsError('internal', 'Could not drop the voicemail: ' + (e && e.message));
  }
  return { ok: true, dropId: drop.id };
});

/**
 * voicemailTexml — the document a dropped call is redirected to: play the
 * greeting, then hang up.
 *
 * Gated by the same per-drop playToken as the audio itself, which is written
 * server-side and never reaches the browser. Telnyx fetches this
 * unauthenticated, so the token is the whole access check.
 */
exports.voicemailTexml = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const db = admin.firestore();
  const cid = (req.query.cid || '').toString();
  const id = (req.query.id || '').toString();
  const token = (req.query.token || '').toString();
  const twiml = texmlResponse();

  try {
    const snap = await db.collection('companies').doc(cid).collection('voicemailDrops').doc(id).get();
    if (!snap.exists || !snap.data().playToken || snap.data().playToken !== token) {
      res.status(403).send('forbidden');
      return;
    }
    const audioUrl = `${fnBaseUrl(req)}/voicemailAudio`
      + `?cid=${encodeURIComponent(cid)}&id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
    twiml.play(audioUrl);
    twiml.hangup();
  } catch (e) {
    console.warn('[voicemailTexml]', e && e.message);
    twiml.hangup();
  }
  res.set('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
});

/**
 * voicemailAudio — serves a recorded greeting to Twilio, which fetches it
 * unauthenticated. Gated by the per-drop playToken rather than being open:
 * the token is written server-side and never exposed to the browser.
 */
exports.voicemailAudio = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const db = admin.firestore();
  const cid = (req.query.cid || '').toString();
  const id = (req.query.id || '').toString();
  const token = (req.query.token || '').toString();
  if (!cid || !id || !token) { res.status(400).send('bad request'); return; }

  try {
    const snap = await db.collection('companies').doc(cid).collection('voicemailDrops').doc(id).get();
    if (!snap.exists) { res.status(404).send('not found'); return; }
    const drop = snap.data();
    // Constant-time-ish compare is overkill for a random 32-char token, but a
    // length check first avoids leaking via early exit on short guesses.
    if (!drop.playToken || drop.playToken.length !== token.length || drop.playToken !== token) {
      res.status(403).send('forbidden');
      return;
    }
    if (!drop.storagePath) { res.status(404).send('no audio'); return; }

    const file = admin.storage().bucket().file(drop.storagePath);
    const [exists] = await file.exists();
    if (!exists) { res.status(404).send('no audio'); return; }

    res.set('Content-Type', drop.contentType || 'audio/mpeg');
    res.set('Cache-Control', 'private, max-age=300');
    file.createReadStream()
      .on('error', (e) => {
        console.warn('[voicemailAudio] stream failed', e && e.message);
        if (!res.headersSent) res.status(500).send('stream error');
      })
      .pipe(res);
  } catch (e) {
    console.warn('[voicemailAudio]', e && e.message);
    if (!res.headersSent) res.status(500).send('error');
  }
});


// ════════════════════════════════════════════════════════════════
// Google Calendar — two-way sync for companies/{cid}/appointments.
//
// No googleapis dependency: the OAuth token endpoint and the Calendar v3 REST
// surface used here are a handful of JSON calls, and Node 20 has fetch.
//
// Where things live:
//   companies/{cid}/private/googleOAuth   — refresh token, sync cursor, watch
//                                           channel. Rules: nobody, ever.
//   companies/{cid}/integrations/google   — client-readable status mirror.
//   oauthStates/{state}                   — single-use CSRF tokens.
//
// Loop prevention, which is the one part of two-way sync that bites:
// every appointment carries googleSyncHash, a hash of the fields we mirror.
// onAppointmentWritten pushes to Google only when the doc's content hash
// differs from googleSyncHash, then stores the new hash. Inbound sync writes
// the fields AND the matching hash in one write, so the trigger it fires
// sees hash == content and does nothing. No flags to clear, no bouncing.
// ════════════════════════════════════════════════════════════════

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid', 'email'
].join(' ');

function googleConfig() {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim()
    || `${functionsBaseUrl()}/googleOAuthCallback`;
  return { clientId, clientSecret, redirectUri, ok: !!(clientId && clientSecret) };
}

function privateGoogleRef(db, companyId) {
  return db.collection('companies').doc(companyId).collection('private').doc('googleOAuth');
}
function googleStatusRef(db, companyId) {
  return db.collection('companies').doc(companyId).collection('integrations').doc('google');
}

/** The fields that round-trip to Google, hashed for change detection. */
function appointmentSyncHash(a) {
  const crypto = require('crypto');
  const start = a.startAt && a.startAt.toMillis ? a.startAt.toMillis()
    : (a.startAt instanceof Date ? a.startAt.getTime() : (a.startAt || null));
  const basis = JSON.stringify({
    t: (a.title || '').trim(),
    s: start,
    d: Number(a.durationMin) || 30,
    l: (a.location || '').trim(),
    n: (a.notes || '').trim(),
    st: a.status || 'scheduled'
  });
  return crypto.createHash('sha1').update(basis).digest('hex');
}

/**
 * A valid access token for the company's connected account, refreshing
 * through the stored refresh token when the cached one is within a minute of
 * expiry. Returns null when the company is not connected.
 */
async function googleAccessToken(db, companyId) {
  const ref = privateGoogleRef(db, companyId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (!d.refreshToken) return null;
  if (d.accessToken && d.accessTokenExpiry && d.accessTokenExpiry - Date.now() > 60 * 1000) {
    return d.accessToken;
  }
  const cfg = googleConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: d.refreshToken,
    grant_type: 'refresh_token'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    // A revoked grant surfaces here. Flip the mirror so the UI offers
    // reconnect instead of silently failing every push.
    if (json.error === 'invalid_grant') {
      await googleStatusRef(db, companyId).set({
        connected: false, error: 'Google access was revoked. Reconnect in CRM Settings.',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    throw new Error('Google token refresh failed: ' + (json.error_description || json.error || res.status));
  }
  await ref.set({
    accessToken: json.access_token,
    accessTokenExpiry: Date.now() + (Number(json.expires_in) || 3600) * 1000
  }, { merge: true });
  return json.access_token;
}

/** Thin Calendar v3 caller. Throws on non-2xx with the API's message. */
async function gcal(db, companyId, method, path, { query, body } = {}) {
  const token = await googleAccessToken(db, companyId);
  if (!token) throw new Error('Google Calendar is not connected.');
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return { status: 204 };
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((json.error && json.error.message) || `Google Calendar ${res.status}`);
    err.status = res.status;
    err.reason = json.error && json.error.errors && json.error.errors[0] && json.error.errors[0].reason;
    throw err;
  }
  return json;
}

/**
 * googleOAuthStart({ companyId, returnTo }) — mints a single-use state and
 * returns the consent URL. access_type=offline + prompt=consent is what makes
 * Google hand back a refresh token, and it only does so on a consent screen.
 */
exports.googleOAuthStart = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId, returnTo } = request.data || {};
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
  const { uid } = await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'googleOAuthStart', max: 10, windowSec: 600 });

  const cfg = googleConfig();
  if (!cfg.ok) {
    throw new HttpsError('failed-precondition',
      'Google Calendar is not set up yet. Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first.');
  }

  const crypto = require('crypto');
  const state = crypto.randomBytes(24).toString('base64url');
  const safeReturn = typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')
    ? returnTo.split('?')[0] : '/crm-settings.html';
  await db.collection('oauthStates').doc(state).set({
    companyId, uid, returnTo: safeReturn,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state
  }).toString();
  return { url };
});

/**
 * googleOAuthCallback — Google redirects here with ?code&state. Exchanges the
 * code, stores the refresh token where no client can read it, starts the push
 * channel, runs the first sync, and bounces back to the CRM.
 */
exports.googleOAuthCallback = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const db = admin.firestore();
  const FV = admin.firestore.FieldValue;
  const back = (path, params) => {
    const qs = new URLSearchParams(params).toString();
    res.redirect(302, `${APP_BASE_URL}${path}?${qs}`);
  };

  const code = (req.query.code || '').toString();
  const state = (req.query.state || '').toString();
  const oauthError = (req.query.error || '').toString();
  if (!state) { res.status(400).send('missing state'); return; }

  const stateRef = db.collection('oauthStates').doc(state);
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) { res.status(400).send('unknown or already-used state'); return; }
  const st = stateSnap.data();
  await stateRef.delete();   // single use, success or not
  const returnTo = st.returnTo || '/crm-settings.html';
  const createdMs = st.createdAt && st.createdAt.toMillis ? st.createdAt.toMillis() : 0;
  if (Date.now() - createdMs > 10 * 60 * 1000) return back(returnTo, { google: 'error', reason: 'the link expired' });
  if (oauthError || !code) return back(returnTo, { google: 'error', reason: oauthError || 'no code' });

  const cfg = googleConfig();
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri, grant_type: 'authorization_code'
      }).toString()
    });
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tok.access_token) {
      return back(returnTo, { google: 'error', reason: tok.error_description || tok.error || 'token exchange failed' });
    }
    if (!tok.refresh_token) {
      // Happens when the user has previously granted and Google skipped the
      // consent screen despite prompt=consent (rare, but real).
      return back(returnTo, { google: 'error', reason: 'Google did not return a refresh token; remove the app at myaccount.google.com/permissions and connect again' });
    }

    let email = null;
    try {
      const me = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` }
      }).then((r) => r.json());
      email = me && me.email ? String(me.email) : null;
    } catch (e) {}

    await privateGoogleRef(db, st.companyId).set({
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      accessTokenExpiry: Date.now() + (Number(tok.expires_in) || 3600) * 1000,
      calendarId: 'primary',
      googleEmail: email,
      connectedBy: st.uid,
      syncToken: null,
      watchChannelId: null, watchResourceId: null, watchExpiry: null,
      connectedAt: FV.serverTimestamp()
    }, { merge: true });

    await googleStatusRef(db, st.companyId).set({
      connected: true, googleEmail: email, calendarId: 'primary', error: null,
      connectedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
    }, { merge: true });

    // Push channel + first sync are best-effort: a failure here should not
    // undo a successful connection, it just means the next tick retries.
    try { await ensureGoogleWatchInternal(db, st.companyId, true); } catch (e) { console.warn('[googleOAuthCallback] watch', e && e.message); }
    try { await syncFromGoogle(db, st.companyId); } catch (e) { console.warn('[googleOAuthCallback] sync', e && e.message); }

    return back(returnTo, { google: 'connected' });
  } catch (e) {
    console.error('[googleOAuthCallback]', e && e.message);
    return back(returnTo, { google: 'error', reason: 'unexpected error' });
  }
});

/** googleDisconnect({ companyId }) — stop the channel, forget the tokens. */
exports.googleDisconnect = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId } = request.data || {};
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
  await assertCompanyAdmin(db, companyId, request);

  const ref = privateGoogleRef(db, companyId);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data();
    if (d.watchChannelId && d.watchResourceId) {
      try {
        await gcal(db, companyId, 'POST', '/channels/stop', {
          body: { id: d.watchChannelId, resourceId: d.watchResourceId }
        });
      } catch (e) { /* already expired or revoked; nothing to keep */ }
    }
    if (d.refreshToken) {
      try {
        await fetch('https://oauth2.googleapis.com/revoke?' + new URLSearchParams({ token: d.refreshToken }), { method: 'POST' });
      } catch (e) {}
    }
    await ref.delete();
  }
  await googleStatusRef(db, companyId).set({
    connected: false, googleEmail: null, error: null,
    watchExpiry: null, lastSyncAt: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

/**
 * Create or renew the push notification channel. Calendar channels live at
 * most a week; with no cron in this project, renewal is opportunistic —
 * every push, every appointment write, every settings page load, and the
 * GitHub Actions tick all call this and it only acts inside the last 24h.
 */
async function ensureGoogleWatchInternal(db, companyId, force = false) {
  const ref = privateGoogleRef(db, companyId);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().refreshToken) return { connected: false };
  const d = snap.data();
  const expiry = Number(d.watchExpiry) || 0;
  const DAY = 24 * 3600 * 1000;
  if (!force && d.watchChannelId && expiry - Date.now() > DAY) {
    return { connected: true, renewed: false, watchExpiry: expiry };
  }

  // Stop the old one first so Google does not deliver to two channels.
  if (d.watchChannelId && d.watchResourceId) {
    try {
      await gcal(db, companyId, 'POST', '/channels/stop', {
        body: { id: d.watchChannelId, resourceId: d.watchResourceId }
      });
    } catch (e) { /* expired channels 404; fine */ }
  }

  const crypto = require('crypto');
  const channelId = crypto.randomUUID();
  const calendarId = d.calendarId || 'primary';
  const out = await gcal(db, companyId, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
    body: {
      id: channelId,
      type: 'web_hook',
      address: `${functionsBaseUrl()}/googleCalendarPush`,
      token: companyId,
      params: { ttl: String(7 * 24 * 3600) }
    }
  });
  const newExpiry = Number(out.expiration) || (Date.now() + 7 * DAY);
  await ref.set({
    watchChannelId: channelId,
    watchResourceId: out.resourceId || null,
    watchExpiry: newExpiry
  }, { merge: true });
  await googleStatusRef(db, companyId).set({
    watchExpiry: admin.firestore.Timestamp.fromMillis(newExpiry),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { connected: true, renewed: true, watchExpiry: newExpiry };
}

exports.ensureGoogleWatch = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId } = request.data || {};
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
  await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'ensureGoogleWatch', max: 30, windowSec: 600 });
  try {
    return await ensureGoogleWatchInternal(db, companyId, false);
  } catch (e) {
    return { connected: true, renewed: false, error: e && e.message };
  }
});

/**
 * Pull changes from Google into Firestore. Incremental via syncToken; a 410
 * from Google means the token is stale and a bounded full resync is done.
 */
async function syncFromGoogle(db, companyId) {
  const ref = privateGoogleRef(db, companyId);
  const snap = await ref.get();
  if (!snap.exists || !snap.data().refreshToken) return { synced: 0 };
  const d = snap.data();
  const calendarId = d.calendarId || 'primary';
  const FV = admin.firestore.FieldValue;
  const apptsCol = db.collection('companies').doc(companyId).collection('appointments');

  let pageToken = null;
  let syncToken = d.syncToken || null;
  let nextSyncToken = null;
  let touched = 0;
  const path = `/calendars/${encodeURIComponent(calendarId)}/events`;

  const listPage = async () => {
    const query = { maxResults: '250', singleEvents: 'true', showDeleted: 'true' };
    if (pageToken) query.pageToken = pageToken;
    else if (syncToken) query.syncToken = syncToken;
    else {
      // First sync: a bounded window. Wider than this and a busy calendar
      // floods the CRM with every recurring standup for a year.
      const now = Date.now();
      query.timeMin = new Date(now - 7 * 24 * 3600 * 1000).toISOString();
      query.timeMax = new Date(now + 90 * 24 * 3600 * 1000).toISOString();
    }
    return gcal(db, companyId, 'GET', path, { query });
  };

  for (let guard = 0; guard < 40; guard++) {
    let page;
    try {
      page = await listPage();
    } catch (e) {
      if (e.status === 410 && syncToken) {
        // Stale cursor: drop it and start a fresh bounded sync.
        syncToken = null; pageToken = null;
        await ref.set({ syncToken: null }, { merge: true });
        continue;
      }
      throw e;
    }

    for (const ev of (page.items || [])) {
      if (!ev.id) continue;
      const found = await apptsCol.where('googleEventId', '==', ev.id).limit(1).get();
      const existing = found.empty ? null : found.docs[0];

      if (ev.status === 'cancelled') {
        if (existing && existing.data().status !== 'canceled') {
          const next = { ...existing.data(), status: 'canceled' };
          await existing.ref.set({
            status: 'canceled', googleSyncHash: appointmentSyncHash(next),
            updatedAt: FV.serverTimestamp()
          }, { merge: true });
          touched++;
        }
        continue;
      }

      // All-day events have `date` not `dateTime`; treat them as 9am local-ish
      // for an hour rather than dropping them, since they may still be a
      // booking someone made on the calendar side.
      const startIso = (ev.start && (ev.start.dateTime || (ev.start.date ? ev.start.date + 'T09:00:00Z' : null)));
      const endIso = (ev.end && (ev.end.dateTime || (ev.end.date ? ev.end.date + 'T10:00:00Z' : null)));
      if (!startIso) continue;
      const startMs = Date.parse(startIso);
      const endMs = endIso ? Date.parse(endIso) : startMs + 30 * 60 * 1000;
      const durationMin = Math.max(5, Math.round((endMs - startMs) / 60000));
      const meetLink = ev.hangoutLink || null;
      const fields = {
        title: (ev.summary || 'Untitled event').slice(0, 200),
        startAt: admin.firestore.Timestamp.fromMillis(startMs),
        durationMin,
        location: ev.location || meetLink || null,
        notes: ev.description ? String(ev.description).slice(0, 2000) : null,
        status: existing && existing.data().status === 'completed' ? 'completed' : 'scheduled',
        meetLink,
        googleEventId: ev.id,
        googleEtag: ev.etag || null,
        syncSource: 'google',
        updatedAt: FV.serverTimestamp()
      };
      fields.googleSyncHash = appointmentSyncHash(fields);

      if (existing) {
        // Skip a no-op to keep the trigger quiet.
        if (existing.data().googleSyncHash === fields.googleSyncHash && existing.data().googleEtag === fields.googleEtag) continue;
        await existing.ref.set(fields, { merge: true });
      } else {
        // A booking that originated in Google. Try to attach it to a contact
        // by attendee email, so it shows on their timeline.
        let contactId = null, contactName = null;
        const attendees = (ev.attendees || []).map((a) => (a.email || '').toLowerCase()).filter(Boolean);
        for (const em of attendees) {
          const c = await db.collection('companies').doc(companyId).collection('contacts')
            .where('email', '==', em).limit(1).get();
          if (!c.empty) { contactId = c.docs[0].id; contactName = c.docs[0].data().name || null; break; }
        }
        await apptsCol.add({
          ...fields,
          contactId, contactName,
          ownerUid: d.connectedBy || null,
          remindedAt: null,
          createdAt: FV.serverTimestamp(),
          createdBy: 'google'
        });
      }
      touched++;
    }

    if (page.nextPageToken) { pageToken = page.nextPageToken; continue; }
    nextSyncToken = page.nextSyncToken || null;
    break;
  }

  await ref.set({ syncToken: nextSyncToken || syncToken || null }, { merge: true });
  await googleStatusRef(db, companyId).set({
    lastSyncAt: FV.serverTimestamp(), error: null, updatedAt: FV.serverTimestamp()
  }, { merge: true });
  return { synced: touched };
}

/**
 * googleCalendarPush — Google's webhook. Validates the channel against what
 * we stored, then runs an incremental sync. The `sync` message Google sends
 * on channel creation carries no changes and is acknowledged only.
 */
exports.googleCalendarPush = onRequest({ cors: false, invoker: 'public' }, async (req, res) => {
  const db = admin.firestore();
  const channelId = req.get('X-Goog-Channel-ID') || '';
  const resourceId = req.get('X-Goog-Resource-ID') || '';
  const companyId = req.get('X-Goog-Channel-Token') || '';
  const resourceState = req.get('X-Goog-Resource-State') || '';

  if (!channelId || !companyId) { res.status(400).send('bad request'); return; }
  try {
    const snap = await privateGoogleRef(db, companyId).get();
    const d = snap.exists ? snap.data() : null;
    if (!d || d.watchChannelId !== channelId || (d.watchResourceId && d.watchResourceId !== resourceId)) {
      // Not a channel we own (stale, or forged). 404 tells Google to stop.
      res.status(404).send('unknown channel');
      return;
    }
    if (resourceState !== 'sync') {
      await syncFromGoogle(db, companyId);
    }
    // Renew here too: a busy calendar renews itself without any tick at all.
    try { await ensureGoogleWatchInternal(db, companyId, false); } catch (e) {}
  } catch (e) {
    console.warn('[googleCalendarPush]', e && e.message);
  }
  res.status(200).send('ok');
});

/**
 * onAppointmentWritten — the outbound half. Creates, updates or deletes the
 * Google event to match Firestore, with a Meet link and the contact invited
 * when the booking asked for it. See the hash note at the top of this section
 * for why this cannot loop with googleCalendarPush.
 */
exports.onAppointmentWritten = onDocumentWritten(
  'companies/{companyId}/appointments/{apptId}',
  async (event) => {
    const db = admin.firestore();
    const FV = admin.firestore.FieldValue;
    const { companyId, apptId } = event.params;
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;

    const priv = await privateGoogleRef(db, companyId).get();
    if (!priv.exists || !priv.data().refreshToken) return;
    const calendarId = priv.data().calendarId || 'primary';
    const evPath = (id) => `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`;

    // Deleted in the CRM → delete in Google.
    if (before && !after) {
      if (before.googleEventId) {
        try { await gcal(db, companyId, 'DELETE', evPath(before.googleEventId), { query: { sendUpdates: 'all' } }); }
        catch (e) { if (e.status !== 404 && e.status !== 410) console.warn('[onAppointmentWritten] delete', e.message); }
      }
      return;
    }
    if (!after) return;

    // Already mirrored: the content hash matches what we last synced.
    const hash = appointmentSyncHash(after);
    if (after.googleSyncHash === hash) return;

    const ref = event.data.after.ref;

    // Canceled in the CRM → cancel in Google, keep the row.
    if (after.status === 'canceled' || after.status === 'noshow') {
      if (after.googleEventId) {
        try { await gcal(db, companyId, 'DELETE', evPath(after.googleEventId), { query: { sendUpdates: 'all' } }); }
        catch (e) { if (e.status !== 404 && e.status !== 410) console.warn('[onAppointmentWritten] cancel', e.message); }
      }
      await ref.set({ googleSyncHash: hash }, { merge: true });
      return;
    }

    const startMs = after.startAt && after.startAt.toMillis ? after.startAt.toMillis() : null;
    if (!startMs) { await ref.set({ googleSyncHash: hash }, { merge: true }); return; }
    const endMs = startMs + (Number(after.durationMin) || 30) * 60 * 1000;

    // Invite the contact only when the booking asked to, and only with a real
    // address: an invite is an email to the lead, not a side effect.
    const attendees = [];
    if (after.inviteContact && after.contactId) {
      try {
        const c = await db.collection('companies').doc(companyId).collection('contacts').doc(after.contactId).get();
        const em = c.exists && c.data().email;
        if (em) attendees.push({ email: em, displayName: c.data().name || undefined });
      } catch (e) {}
    }

    const body = {
      summary: after.title || 'Appointment',
      description: after.notes || undefined,
      location: after.location && !/^https?:\/\/meet\.google\.com/.test(after.location) ? after.location : undefined,
      start: { dateTime: new Date(startMs).toISOString() },
      end: { dateTime: new Date(endMs).toISOString() },
      attendees: attendees.length ? attendees : undefined,
      extendedProperties: { private: { onePCrmAppointmentId: apptId, onePCrmCompanyId: companyId } }
    };

    try {
      let ev;
      if (after.googleEventId) {
        ev = await gcal(db, companyId, 'PATCH', evPath(after.googleEventId), {
          query: { sendUpdates: attendees.length ? 'all' : 'none', conferenceDataVersion: '1' },
          body
        });
      } else {
        const crypto = require('crypto');
        body.conferenceData = {
          createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } }
        };
        ev = await gcal(db, companyId, 'POST', `/calendars/${encodeURIComponent(calendarId)}/events`, {
          query: { sendUpdates: attendees.length ? 'all' : 'none', conferenceDataVersion: '1' },
          body
        });
      }
      const meetLink = ev.hangoutLink || after.meetLink || null;
      const patch = {
        googleEventId: ev.id,
        googleEtag: ev.etag || null,
        meetLink,
        syncSource: 'crm',
        googleSyncedAt: FV.serverTimestamp()
      };
      // A brand-new booking with no location gets the Meet link as its
      // location, which is what the reminder email and the calendar show.
      if (!after.location && meetLink) patch.location = meetLink;
      const next = { ...after, ...patch };
      patch.googleSyncHash = appointmentSyncHash(next);
      await ref.set(patch, { merge: true });

      if (after.contactId && !after.googleEventId) {
        await db.collection('companies').doc(companyId).collection('contacts').doc(after.contactId)
          .collection('activities').add({
            type: 'calendar_synced',
            description: `Added to Google Calendar${attendees.length ? ' and invited ' + attendees[0].email : ''}${meetLink ? ' · Meet link ready' : ''}`,
            actorUid: 'google', actorName: 'Google Calendar',
            createdAt: FV.serverTimestamp(),
            meta: { appointmentId: apptId, googleEventId: ev.id, meetLink }
          }).catch(() => {});
      }
    } catch (e) {
      console.warn('[onAppointmentWritten] push failed', e && e.message);
      // Record the failure on the row so the UI can show it, and store the
      // hash so a failing event does not retry on every unrelated write.
      await ref.set({ googleSyncError: (e && e.message) || 'sync failed', googleSyncHash: hash }, { merge: true });
    }

    try { await ensureGoogleWatchInternal(db, companyId, false); } catch (e) {}
  }
);


// ════════════════════════════════════════════════════════════════
// Voicemail drops — registration. The browser uploads the audio to Storage
// (storage.rules: admins only, audio/*, 5 MB); this creates the doc with a
// play token the browser never sees, which is what voicemailAudio checks.
// ════════════════════════════════════════════════════════════════
exports.registerVoicemailDrop = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId, name, storagePath, contentType, durationSec, isDefault } = request.data || {};
  if (!companyId || !storagePath) {
    throw new HttpsError('invalid-argument', 'companyId and storagePath are required.');
  }
  const { uid } = await assertCompanyAdmin(db, companyId, request);

  // The path must be this company's own voicemail folder: registering a
  // path elsewhere in the bucket would let voicemailAudio serve it publicly.
  const expectedPrefix = `companies/${companyId}/voicemails/`;
  if (!String(storagePath).startsWith(expectedPrefix) || String(storagePath).includes('..')) {
    throw new HttpsError('invalid-argument', 'storagePath must be inside this company\'s voicemails folder.');
  }
  const file = admin.storage().bucket().file(storagePath);
  const [exists] = await file.exists();
  if (!exists) throw new HttpsError('not-found', 'Upload the audio before registering it.');

  const crypto = require('crypto');
  const FV = admin.firestore.FieldValue;
  const col = db.collection('companies').doc(companyId).collection('voicemailDrops');
  const makeDefault = isDefault === true;
  if (makeDefault) {
    const others = await col.where('isDefault', '==', true).get();
    await Promise.all(others.docs.map((d) => d.ref.set({ isDefault: false }, { merge: true })));
  } else {
    // First drop becomes the default automatically so "Drop VM" works at once.
    const any = await col.limit(1).get();
    if (any.empty) { /* handled below */ }
  }
  const countSnap = await col.limit(1).get();
  const ref = await col.add({
    name: (name || 'Voicemail').toString().slice(0, 80),
    storagePath,
    contentType: (contentType || 'audio/mpeg').toString().slice(0, 60),
    durationSec: Number(durationSec) || null,
    isDefault: makeDefault || countSnap.empty,
    playToken: crypto.randomBytes(24).toString('base64url'),
    createdBy: uid,
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp()
  });
  return { ok: true, id: ref.id };
});

// ════════════════════════════════════════════════════════════════
// Automation tick — the cron this project cannot deploy.
//
// Cloud Scheduler is blocked by an IAM gap (see scripts/deploy-functions.sh),
// so anything time-based runs from runAutomationTick, an HTTP endpoint that
// a GitHub Actions schedule (.github/workflows/crm-tick.yml) POSTs every
// 15 minutes with a shared secret. The same work can be kicked for one
// company from the CRM through runAutomationNowForCompany.
//
// Each tick:
//   1. sends due sequence steps (SMS via Telnyx, email via SendGrid, or a
//      task), advancing currentStep / nextRunAt, and completing enrollments
//      that ran out of steps;
//   2. renews Google Calendar watch channels inside their last 24 hours;
//   3. sends task and appointment reminders.
// ════════════════════════════════════════════════════════════════

function renderMergeServer(text, ctx) {
  const contact = ctx.contact || {};
  const owner = ctx.owner || {};
  const first = (s) => String(s || '').trim().split(/\s+/)[0] || '';
  const fields = {
    firstName: first(contact.name),
    lastName: String(contact.name || '').trim().split(/\s+/).slice(1).join(' '),
    fullName: contact.name || '',
    company: contact.companyName || '',
    phone: contact.phone || '',
    email: contact.email || '',
    ownerFirstName: first(owner.displayName || owner.name),
    ownerName: owner.displayName || owner.name || owner.email || '',
    companyName: ctx.companyName || '',
    today: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  };
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, token) =>
    (fields[token] ? String(fields[token]) : whole));
}

/** Stop every active enrollment for a contact. Called on inbound SMS/call. */
async function stopEnrollmentsForContact(db, companyId, contactId, reason) {
  if (!companyId || !contactId) return 0;
  const FV = admin.firestore.FieldValue;
  let snap;
  try {
    snap = await db.collection('companies').doc(companyId).collection('enrollments')
      .where('contactId', '==', contactId).where('status', '==', 'active').get();
  } catch (e) {
    // Index may not exist yet; fall back to a contact-only query.
    const all = await db.collection('companies').doc(companyId).collection('enrollments')
      .where('contactId', '==', contactId).get();
    snap = { docs: all.docs.filter((d) => d.data().status === 'active') };
  }
  let n = 0;
  for (const d of snap.docs) {
    await d.ref.set({ status: 'stopped', stoppedAt: FV.serverTimestamp(), stoppedReason: reason, updatedAt: FV.serverTimestamp() }, { merge: true });
    n++;
  }
  if (n) {
    await db.collection('companies').doc(companyId).collection('contacts').doc(contactId)
      .collection('activities').add({
        type: 'sequence_stopped',
        description: `Stopped ${n} sequence${n === 1 ? '' : 's'}: ${reason}`,
        actorUid: 'system', actorName: 'Automation',
        createdAt: FV.serverTimestamp(), meta: { reason, count: n }
      }).catch(() => {});
  }
  return n;
}

/** Send one sequence step. Returns a short outcome string for the log. */
async function executeSequenceStep(db, companyId, enrollment, step, seq) {
  const FV = admin.firestore.FieldValue;
  const cRef = db.collection('companies').doc(companyId).collection('contacts').doc(enrollment.contactId);
  const cSnap = await cRef.get();
  if (!cSnap.exists) return 'contact missing';
  const contact = { id: cSnap.id, ...cSnap.data() };
  if (contact.doNotCall === true && step.channel === 'task') { /* tasks are fine */ }

  // Resolve the copy: a template wins over inline body.
  let body = step.body || '';
  let subject = step.subject || '';
  if (step.templateId) {
    const t = await db.collection('companies').doc(companyId).collection('messageTemplates').doc(step.templateId).get();
    if (t.exists) { body = t.data().body || body; subject = t.data().subject || subject; }
  }
  let ownerDoc = null;
  const ownerUid = contact.ownerUid || seq.createdBy || enrollment.enrolledBy;
  if (ownerUid) {
    const o = await db.collection('users').doc(ownerUid).get();
    if (o.exists) ownerDoc = o.data();
  }
  const coSnap = await db.collection('companies').doc(companyId).get();
  const ctx = { contact, owner: ownerDoc, companyName: coSnap.exists ? coSnap.data().name : '' };
  body = renderMergeServer(body, ctx);
  subject = renderMergeServer(subject, ctx);

  if (step.channel === 'sms') {
    const blocked = smsSendBlockReason(contact);
    if (blocked) return 'skipped: ' + blocked;
    const to = normalizePhone(contact.phone);
    if (!to) return 'skipped: no phone';
    const cfg = telnyxSmsConfig();
    if (!cfg.ok) return 'skipped: SMS not configured';
    const from = cfg.from;
    if (!body) return 'skipped: empty body';
    const msg = await sendTelnyxSms({ to, body });
    const convRef = db.collection('companies').doc(companyId).collection('conversations').doc(contact.id);
    await convRef.set({
      contactId: contact.id, contactPhone: to, channel: 'sms',
      lastMessageAt: FV.serverTimestamp(), lastMessageText: body.slice(0, 200), lastDirection: 'out',
      updatedAt: FV.serverTimestamp(), createdAt: FV.serverTimestamp()
    }, { merge: true });
    await convRef.collection('messages').doc(msg.sid).set({
      direction: 'out', body, fromNumber: from, toNumber: to,
      status: msg.status || 'sent', twilioSid: msg.sid, provider: 'telnyx',
      sentByUid: 'sequence', sequenceId: enrollment.sequenceId, createdAt: FV.serverTimestamp()
    });
    await cRef.collection('activities').add({
      type: 'manual_sms', description: `Sequence SMS (${seq.name}): ${body.slice(0, 120)}`,
      actorUid: 'system', actorName: 'Automation', createdAt: FV.serverTimestamp(),
      meta: { direction: 'out', sequenceId: enrollment.sequenceId, step: step.order }
    });
    await cRef.set(lastContactedFields('sms', 'out'), { merge: true });
    return 'sms sent';
  }

  if (step.channel === 'email') {
    if (!contact.email) return 'skipped: no email';
    if (contact.emailUnsubscribed === true || contact.unsubscribed === true) return 'skipped: unsubscribed';
    if (!body) return 'skipped: empty body';
    if (!emailConfigured()) return 'skipped: email not configured';
    const fromName = (ownerDoc && (ownerDoc.displayName || ownerDoc.name)) || FROM_NAME_DEFAULT;
    await sendEmail({
      to: contact.email,
      from: { email: FROM_EMAIL, name: fromName },
      replyTo: (ownerDoc && ownerDoc.email) || REPLY_TO,
      subject: subject || `A note from ${fromName}`,
      text: body,
      html: textToHtml(body)
    });
    await cRef.collection('activities').add({
      type: 'manual_email', description: `Sequence email (${seq.name}): ${subject || body.slice(0, 80)}`,
      actorUid: 'system', actorName: 'Automation', createdAt: FV.serverTimestamp(),
      meta: { sequenceId: enrollment.sequenceId, step: step.order }
    });
    await cRef.set(lastContactedFields('email', 'out'), { merge: true });
    return 'email sent';
  }

  if (step.channel === 'task') {
    const assignee = contact.ownerUid || seq.createdBy || enrollment.enrolledBy || null;
    await db.collection('companies').doc(companyId).collection('tasks').add({
      title: (subject || body || `Follow up with ${contact.name || 'contact'}`).slice(0, 160),
      description: body || null,
      contactId: contact.id, contactName: contact.name || null,
      assigneeUid: assignee,
      status: 'open', priority: 'normal',
      dueAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 3600 * 1000),
      remindedAt: null,
      sequenceId: enrollment.sequenceId,
      createdBy: 'sequence',
      createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
    });
    await cRef.collection('activities').add({
      type: 'task_created', description: `Sequence task (${seq.name}): ${(subject || body || 'Follow up').slice(0, 120)}`,
      actorUid: 'system', actorName: 'Automation', createdAt: FV.serverTimestamp(),
      meta: { sequenceId: enrollment.sequenceId, step: step.order }
    });
    return 'task created';
  }
  return 'skipped: unknown channel';
}

async function processDueEnrollments(db, { companyId = null, limitN = 200, dryRun = false } = {}) {
  const FV = admin.firestore.FieldValue;
  const now = admin.firestore.Timestamp.now();
  let docs = [];
  try {
    let q = companyId
      ? db.collection('companies').doc(companyId).collection('enrollments')
      : db.collectionGroup('enrollments');
    q = q.where('status', '==', 'active').where('nextRunAt', '<=', now).limit(limitN);
    docs = (await q.get()).docs;
  } catch (e) {
    console.warn('[tick] enrollments query failed (index?):', e && e.message);
    return { processed: 0, error: e && e.message };
  }

  // dryRun stops here: it reports how many enrollments are due without
  // claiming, sending or advancing any of them. executeSequenceStep sends
  // real SMS and real email, so this is the difference between measuring the
  // backlog and firing it at people.
  if (dryRun) {
    return {
      dryRun: true,
      wouldProcess: docs.length,
      considered: docs.length,
      sample: docs.slice(0, 10).map((d) => `${d.ref.parent.parent.id}/${d.id} step ${Number(d.data().currentStep) || 0}`)
    };
  }

  let processed = 0;
  const log = [];
  for (const d of docs) {
    const en = d.data();
    const cid = d.ref.parent.parent.id;
    // Claim it first so two overlapping ticks cannot both send the step.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(d.ref);
      if (!fresh.exists || fresh.data().status !== 'active') return false;
      const nra = fresh.data().nextRunAt;
      if (!nra || nra.toMillis() > now.toMillis()) return false;
      tx.set(d.ref, { nextRunAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1000), lockedAt: FV.serverTimestamp() }, { merge: true });
      return true;
    });
    if (!claimed) continue;

    try {
      const seqSnap = await db.collection('companies').doc(cid).collection('sequences').doc(en.sequenceId).get();
      if (!seqSnap.exists || seqSnap.data().active === false) {
        await d.ref.set({ status: 'stopped', stoppedReason: 'sequence inactive', stoppedAt: FV.serverTimestamp() }, { merge: true });
        continue;
      }
      const seq = { id: seqSnap.id, ...seqSnap.data() };
      const steps = seq.steps || [];
      const idx = Number(en.currentStep) || 0;
      const step = steps[idx];
      if (!step) {
        await d.ref.set({ status: 'completed', completedAt: FV.serverTimestamp() }, { merge: true });
        continue;
      }
      const outcome = await executeSequenceStep(db, cid, { id: d.id, ...en }, step, seq);
      log.push(`${cid}/${d.id} step ${idx}: ${outcome}`);
      const next = steps[idx + 1];
      if (next) {
        await d.ref.set({
          currentStep: idx + 1,
          nextRunAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + (Number(next.delayHours) || 0) * 3600 * 1000),
          lastOutcome: outcome, lastStepAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
        }, { merge: true });
      } else {
        await d.ref.set({
          currentStep: idx + 1, status: 'completed', lastOutcome: outcome,
          completedAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
        }, { merge: true });
      }
      processed++;
    } catch (e) {
      console.warn('[tick] step failed', d.id, e && e.message);
      // Retry in an hour rather than hammering a broken step every tick.
      await d.ref.set({
        nextRunAt: admin.firestore.Timestamp.fromMillis(now.toMillis() + 3600 * 1000),
        lastOutcome: 'error: ' + (e && e.message), updatedAt: FV.serverTimestamp()
      }, { merge: true });
    }
  }
  return { processed, considered: docs.length, log };
}

async function renewAllGoogleWatches(db) {
  let renewed = 0, checked = 0;
  try {
    const snap = await db.collectionGroup('integrations').where('connected', '==', true).limit(100).get();
    for (const d of snap.docs) {
      if (d.id !== 'google') continue;
      const cid = d.ref.parent.parent.id;
      checked++;
      try {
        const r = await ensureGoogleWatchInternal(db, cid, false);
        if (r && r.renewed) renewed++;
      } catch (e) { console.warn('[tick] watch renew failed', cid, e && e.message); }
    }
  } catch (e) { console.warn('[tick] integrations query failed', e && e.message); }
  return { checked, renewed };
}

/**
 * Task and appointment reminders: one email to the assignee 24h before a task
 * is due or an appointment starts, `remindedAt` stamped so it only ever goes
 * out once.
 *
 * Runs from the tick rather than Cloud Scheduler because this project's deploy
 * service account lacks roles/cloudscheduler.admin (see scripts/deploy-functions.sh
 * and .github/workflows/crm-tick.yml). A pair of onSchedule twins used to sit
 * unexported further up this file as the "real" version; they were dead code
 * whose comment claimed reminders were switched off, which is a much more
 * expensive kind of wrong than a missing feature — anyone reading it concluded
 * the reminders did not work. Deleted. This is the live implementation.
 */
async function sendReminders(db) {
  const now = admin.firestore.Timestamp.now();
  const horizon = admin.firestore.Timestamp.fromMillis(now.toMillis() + 24 * 3600 * 1000);
  if (!emailConfigured()) return { tasks: 0, appointments: 0, skipped: 'email not configured' };
  let tasks = 0, appts = 0;

  try {
    const snap = await db.collectionGroup('tasks').where('status', '==', 'open').where('dueAt', '<=', horizon).limit(200).get();
    for (const d of snap.docs) {
      const t = d.data();
      if (t.remindedAt || !t.dueAt) continue;
      const email = await emailForUid(db, t.assigneeUid);
      if (email) {
        const due = t.dueAt.toDate ? t.dueAt.toDate() : new Date(t.dueAt);
        try {
          await sendEmail({
            to: email, from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT }, replyTo: REPLY_TO,
            subject: `Reminder: ${t.title}`,
            html: reminderHtml('Task reminder', [
              `<strong>${t.title}</strong>`, t.contactName ? `Contact: ${t.contactName}` : '',
              `Due: ${due.toLocaleString()}`, `<a href="${APP_BASE_URL}/tasks.html" style="color:#E60306;">Open Tasks →</a>`
            ].filter(Boolean)),
            text: `Task reminder: ${t.title} — due ${due.toLocaleString()}`
          });
          tasks++;
        } catch (e) { console.warn('[tick] task reminder failed', e && e.message); }
      }
      await d.ref.set({ remindedAt: now }, { merge: true });
    }
  } catch (e) { console.warn('[tick] task reminders query failed', e && e.message); }

  try {
    const snap = await db.collectionGroup('appointments').where('status', '==', 'scheduled').where('startAt', '<=', horizon).limit(200).get();
    for (const d of snap.docs) {
      const a = d.data();
      if (a.remindedAt || !a.startAt) continue;
      if (a.startAt.toMillis && a.startAt.toMillis() < now.toMillis()) { await d.ref.set({ remindedAt: now }, { merge: true }); continue; }
      const email = await emailForUid(db, a.ownerUid);
      if (email) {
        const start = a.startAt.toDate ? a.startAt.toDate() : new Date(a.startAt);
        try {
          await sendEmail({
            to: email, from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT }, replyTo: REPLY_TO,
            subject: `Upcoming: ${a.title}`,
            html: reminderHtml('Appointment reminder', [
              `<strong>${a.title}</strong>`, a.contactName ? `With: ${a.contactName}` : '',
              `When: ${start.toLocaleString()}`, a.location ? `Where: ${a.location}` : '',
              a.meetLink ? `<a href="${a.meetLink}" style="color:#E60306;">Join Google Meet →</a>` : '',
              `<a href="${APP_BASE_URL}/calendar.html" style="color:#E60306;">Open Calendar →</a>`
            ].filter(Boolean)),
            text: `Appointment: ${a.title} at ${start.toLocaleString()}`
          });
          appts++;
        } catch (e) { console.warn('[tick] appointment reminder failed', e && e.message); }
      }
      await d.ref.set({ remindedAt: now }, { merge: true });
    }
  } catch (e) { console.warn('[tick] appointment reminders query failed', e && e.message); }

  return { tasks, appointments: appts };
}

// ════════════════════════════════════════════════════════════════
// Course commitments — Parkinson's Law reminders.
// Before a member's first session in a course, /commit.html has them set a
// finish date, a weekly budget and a daily rhythm (days + reminder time in
// their own timezone). Stored at users/{uid}/courseCommitments/{slug}; only
// saveCourseCommitment writes it. Each tick, sendCourseWorkReminders sends
// "time to get to work" by email, push and the in-app bell to anyone whose
// reminder time has arrived today.
// ════════════════════════════════════════════════════════════════

/** Local calendar date, weekday (0=Sun) and minutes past midnight in `timeZone`; null for a bad zone. */
function commitmentLocalClock(now, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(now);
  } catch (e) { return null; }
  const g = (t) => (parts.find((p) => p.type === t) || {}).value;
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    weekday: WD[g('weekday')],
    minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute'))
  };
}

/**
 * Is a reminder due for this commitment right now?
 *   { kind: 'work' | 'deadline', date } or null.
 *
 * Due once per local day, on a chosen weekday, from the reminder time until
 * six hours after it. The window absorbs the tick's lateness (it runs about
 * hourly, sometimes two hours apart) without sending a 7 PM reminder at 3 AM.
 * `lastRemindedDate` makes it once-only per day. After the goal date passes,
 * a single 'deadline' check-in replaces the daily reminders until the member
 * sets a new date.
 */
function commitmentDue(c, now) {
  if (!c || c.active === false) return null;
  const clock = commitmentLocalClock(now, c.timezone || 'America/New_York');
  if (!clock) return null;
  if (c.lastRemindedDate === clock.date) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(c.reminderTime || '');
  if (!m) return null;
  const at = Number(m[1]) * 60 + Number(m[2]);
  if (clock.minutes < at || clock.minutes >= at + 360) return null;
  if (c.goalDate && clock.date > c.goalDate) {
    return c.deadlineNoticeSent ? null : { kind: 'deadline', date: clock.date };
  }
  if (!Array.isArray(c.days) || !c.days.includes(clock.weekday)) return null;
  return { kind: 'work', date: clock.date };
}

/**
 * Validate a commitment from the questionnaire. `today` is the member's
 * local date. Returns { value } or { error } (a message for the member).
 */
function validateCommitmentInput(data, today) {
  const d = data || {};
  const dayMs = (iso) => { const [y, mo, da] = iso.split('-').map(Number); return Date.UTC(y, mo - 1, da); };
  const goalDate = String(d.goalDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goalDate) || Number.isNaN(dayMs(goalDate))) return { error: 'Pick a finish date.' };
  if (goalDate <= today) return { error: 'Your finish date needs to be in the future.' };
  if ((dayMs(goalDate) - dayMs(today)) / 86400000 > 366) return { error: 'Keep your finish date within a year.' };
  const weeklyMinutes = Math.round(Number(d.weeklyMinutes));
  if (!(weeklyMinutes >= 30 && weeklyMinutes <= 1680)) return { error: 'Choose how much time you\'ll give it each week.' };
  const sessionMinutes = Math.round(Number(d.sessionMinutes));
  if (!(sessionMinutes >= 10 && sessionMinutes <= 240)) return { error: 'Choose a session length.' };
  if (!Array.isArray(d.days)) return { error: 'Pick at least one day.' };
  const days = [...new Set(d.days.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort((a, b) => a - b);
  if (!days.length || days.length !== d.days.length) return { error: 'Pick at least one day.' };
  const reminderTime = String(d.reminderTime || '');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime)) return { error: 'Pick a reminder time.' };
  const ch = d.channels || {};
  const channels = { email: ch.email !== false, inapp: ch.inapp !== false, push: ch.push === true };
  return { value: { goalDate, weeklyMinutes, sessionMinutes, days, reminderTime, channels } };
}

const PARKINSON_LINES = [
  'Work expands to fill the time you give it. Give this {m} minutes, starting now.',
  'Your deadline is doing its job. Do yours: {m} focused minutes.',
  'The 1% show up when it\'s scheduled, not when it\'s convenient.',
  'No open-ended sessions. Set a timer for {m} minutes and go.',
  '{d} days to your finish line. Today\'s session keeps it real.',
  'Momentum is built in small, scheduled blocks. This is one of them.'
];

/** Title, body and link for one reminder. Pure, so the copy is testable. */
function courseReminderMessage(c, slug, due, courseTitle) {
  const title = courseTitle || slug;
  const dayMs = (iso) => { const [y, mo, da] = iso.split('-').map(Number); return Date.UTC(y, mo - 1, da); };
  const daysLeft = c.goalDate ? Math.round((dayMs(c.goalDate) - dayMs(due.date)) / 86400000) : null;
  const courseUrl = `https://the1pnation.com/courses.html?course=${encodeURIComponent(slug)}`;
  const editUrl = `https://the1pnation.com/commit.html?course=${encodeURIComponent(slug)}&edit=1`;
  if (due.kind === 'deadline') {
    return {
      subject: `Deadline check-in: ${title}`,
      heading: 'Your deadline has passed',
      body: `Your finish date for ${title} came and went. No judgment, just data. Set a new, tighter date and let Parkinson's Law work for you again.`,
      cta: 'Set a new deadline',
      url: editUrl,
      editUrl
    };
  }
  let n = 0;
  for (const ch of due.date + slug) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  const line = PARKINSON_LINES[n % PARKINSON_LINES.length]
    .replace('{m}', String(c.sessionMinutes || 30))
    .replace('{d}', String(daysLeft != null ? daysLeft : ''));
  const left = daysLeft == null ? '' : daysLeft === 0 ? ' Today is your finish date.' : ` ${daysLeft} day${daysLeft === 1 ? '' : 's'} to your deadline.`;
  return {
    subject: `Time to get to work: ${title}`,
    heading: 'Time to get to work',
    body: `${line} Your ${c.sessionMinutes || 30}-minute ${title} session is on the calendar.${left}`,
    cta: 'Start session',
    url: courseUrl,
    editUrl
  };
}

function courseReminderHtml(msg) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:8px;">
    <h2 style="color:#E60306;margin:0 0 12px;font-size:22px;">${esc(msg.heading)}</h2>
    <p style="font-size:16px;line-height:1.5;color:#222;margin:0 0 20px;">${esc(msg.body)}</p>
    <p style="margin:0 0 24px;"><a href="${esc(msg.url)}" style="display:inline-block;background:#E60306;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;">${esc(msg.cta)} →</a></p>
    <p style="font-size:12px;color:#888;margin:0;">You set this reminder when you committed to this course. <a href="${esc(msg.editUrl)}" style="color:#888;">Change your plan or turn reminders off</a>.</p>
    <p style="font-size:12px;color:#888;margin:6px 0 0;">The One Percent Academy</p>
  </div>`;
}

/** Tick step: send every course work reminder that is due right now. */
async function sendCourseWorkReminders(db, { now = new Date() } = {}) {
  const FV = admin.firestore.FieldValue;
  const out = { due: 0, email: 0, emailNoAddress: 0, emailNotConfigured: 0, emailFailed: 0, push: 0, inapp: 0, deadlines: 0 };
  const snap = await db.collectionGroup('courseCommitments').where('active', '==', true).limit(2000).get();
  const titles = new Map();

  for (const d of snap.docs) {
    const c = d.data() || {};
    const due = commitmentDue(c, now);
    if (!due) continue;
    const userRef = d.ref.parent.parent;
    const uid = userRef.id;
    const slug = d.id;

    // Claim the day before sending, so overlapping ticks can't double-send.
    let claimed = false;
    try {
      claimed = await db.runTransaction(async (tx) => {
        const s = await tx.get(d.ref);
        if (!s.exists || (s.data() || {}).lastRemindedDate === due.date) return false;
        tx.update(d.ref, {
          lastRemindedDate: due.date,
          lastRemindedAt: FV.serverTimestamp(),
          ...(due.kind === 'deadline' ? { deadlineNoticeSent: true } : {})
        });
        return true;
      });
    } catch (e) { claimed = false; }
    if (!claimed) continue;

    try {
      const userSnap = await userRef.get();
      const u = userSnap.exists ? (userSnap.data() || {}) : null;
      if (!u) continue;
      // Access revoked (refund, expired grant): stop reminding.
      if (!Array.isArray(u.enrolledCourseSlugs) || !u.enrolledCourseSlugs.includes(slug)) {
        await d.ref.set({ active: false }, { merge: true });
        continue;
      }

      if (!titles.has(slug)) {
        let t = c.courseTitle || '';
        try {
          const cs = await db.collection('courses').doc(slug).get();
          if (cs.exists && cs.data().title) t = cs.data().title;
        } catch (e) { /* keep fallback */ }
        titles.set(slug, t || slug);
      }
      const msg = courseReminderMessage(c, slug, due, titles.get(slug));
      const ch = c.channels || {};
      out.due++;
      if (due.kind === 'deadline') out.deadlines++;

      // Every skipped email names its cause in the tick summary (printed in
      // the Actions log), so "sent 0" is never a mystery again.
      if (ch.email !== false) {
        let to = u.email || '';
        if (!to) {
          try { to = (await admin.auth().getUser(uid)).email || ''; } catch (e) { /* no auth record */ }
        }
        if (!to) {
          out.emailNoAddress++;
        } else if (!emailConfigured()) {
          out.emailNotConfigured++;
          out.emailProvider = emailProvider();
        } else {
          try {
            await sendEmail({
              to, from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT }, replyTo: REPLY_TO,
              subject: msg.subject,
              html: courseReminderHtml(msg),
              text: `${msg.body}\n\n${msg.cta}: ${msg.url}\n\nChange your plan or turn reminders off: ${msg.editUrl}`
            });
            out.email++;
          } catch (e) {
            out.emailFailed++;
            if (!out.emailError) out.emailError = String((e && e.message) || e).slice(0, 200);
            console.warn('[tick] course reminder email failed', e && e.message);
          }
        }
      }

      if (ch.inapp !== false) {
        try {
          await notifyUser(db, uid, {
            id: `course_${due.kind}_${slug}_${due.date}`,
            type: due.kind === 'deadline' ? 'course_deadline' : 'course_reminder',
            fromName: titles.get(slug),
            preview: msg.body,
            link: msg.url.replace(APP_BASE_URL, '')
          });
          out.inapp++;
        } catch (e) { console.warn('[tick] course reminder in-app failed', e && e.message); }
      }

      if (ch.push === true) {
        const r = await pushToUser(db, uid, {
          title: msg.subject,
          body: msg.body,
          data: { url: msg.url, type: 'course_reminder', slug }
        });
        out.push += r.sent || 0;
      }
    } catch (e) {
      console.warn('[tick] course reminder failed', slug, e && e.message);
    }
  }
  return out;
}

// Constant-time string compare that tolerates unequal lengths.
//
// crypto.timingSafeEqual throws a RangeError when the two buffers differ in
// size, so every caller has to length-check first — and that bare length check
// leaks how long the expected value is. Hashing both sides to a fixed width
// removes both problems at once: the comparison is always over 32 bytes, and
// the length of the secret is no longer observable from the outside.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * One tick: the time-based jobs this project has, run together.
 *
 * Shared by the scheduled function and the HTTP endpoint so there is exactly
 * one definition of what a tick does, rather than two that can drift.
 *
 * Every step gets its own catch. Previously only promoteLaunchedItems had one,
 * so a throw from any of the other three rejected the whole Promise.all,
 * aborted the siblings and reported nothing about which had failed — the tick
 * returned a 500 that named no cause.
 *
 * `ok` is false when any step recorded an error, so a partial failure is
 * visible to the caller instead of hiding inside a 200.
 */
async function runTick(db, { dryRun = false } = {}) {
  const startedAt = Date.now();
  const step = (name, p) => Promise.resolve(p).catch((e) => {
    console.warn(`[tick] ${name} failed:`, e && e.message);
    return { error: (e && e.message) || String(e) };
  });

  const [sequences, watches, reminders, courseReminders, launches, announcements, reviewNudges] = await Promise.all([
    step('sequences', processDueEnrollments(db, { dryRun })),
    // These only ever renew or send; there is nothing to preview, so a dry
    // run skips them rather than pretending to measure something.
    step('watches', dryRun ? { skipped: 'dryRun' } : renewAllGoogleWatches(db)),
    step('reminders', dryRun ? { skipped: 'dryRun' } : sendReminders(db)),
    step('courseReminders', dryRun ? { skipped: 'dryRun' } : sendCourseWorkReminders(db)),
    step('launches', promoteLaunchedItems(db, { dryRun })),
    step('announcements', fanOutDueAnnouncements(db, { dryRun })),
    step('reviewNudges', dryRun ? { skipped: 'dryRun' } : sendReviewNudges(db))
  ]);

  const steps = { sequences, watches, reminders, courseReminders, launches, announcements, reviewNudges };
  const failedSteps = Object.keys(steps).filter((k) => steps[k] && steps[k].error);
  const summary = { ok: failedSteps.length === 0, dryRun, ms: Date.now() - startedAt, ...steps };
  if (failedSteps.length) summary.failedSteps = failedSteps;
  console.log('[tick]', JSON.stringify(summary));
  return summary;
}

// Why there is no scheduled function here.
//
// A tick on a real 15-minute clock was attempted: `exports.automationTick`,
// an onSchedule function. The deploy failed with "Failed to upsert schedule
// function automationTick in region us-central1" (backend run #90), while
// every other function in the same deploy updated successfully.
//
// The belief that this project cannot use Cloud Scheduler was therefore
// right, even though the only error it had ever actually shown was
// `cloudscheduler.jobs.delete`. Whether the block is jobs.create, a disabled
// Cloud Scheduler API, or a missing App Engine app is still unknown —
// firebase-tools does not print the underlying HTTP error without --debug.
//
// Until that is resolved, .github/workflows/crm-tick.yml is the clock and
// runAutomationTick below is what it calls. See scripts/deploy-functions.sh
// for the IAM grant that is the real fix.

/**
 * runAutomationTick — POST with header `X-Tick-Secret: $CRM_TICK_SECRET`.
 *
 * The manual and fallback path, driven by .github/workflows/crm-tick.yml.
 * Kept alongside the scheduled function above because it is the only way to
 * run a tick on demand, and the only way to run one as a dry run.
 *
 * `?dryRun=1` reports what a tick would do and writes nothing.
 */
exports.runAutomationTick = onRequest({ cors: false, invoker: 'public', secrets: [sendgridKey], timeoutSeconds: 300 }, async (req, res) => {
  const expected = (process.env.CRM_TICK_SECRET || '').trim();
  const given = (req.get('X-Tick-Secret') || '').trim();
  if (!expected) { res.status(503).json({ ok: false, error: 'CRM_TICK_SECRET is not set' }); return; }
  if (req.method !== 'POST' || !given || !timingSafeEqualStr(given, expected)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
  const summary = await runTick(admin.firestore(), { dryRun });
  res.status(summary.ok ? 200 : 500).json(summary);
});

/** The same sequence work for one company, from the CRM UI. */
exports.runAutomationNowForCompany = onCall({ secrets: [sendgridKey] }, async (request) => {
  const db = admin.firestore();
  const { companyId } = request.data || {};
  if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
  await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'runAutomationNow', max: 20, windowSec: 600 });
  const sequences = await processDueEnrollments(db, { companyId, limitN: 50 });
  let watch = null;
  try { watch = await ensureGoogleWatchInternal(db, companyId, false); } catch (e) {}
  return { ok: true, sequences, watch };
});

// ── Auto-enrollment triggers ─────────────────────────────────────────────
// Event-driven, so enrolling needs no cron: a stage change or a tag added on
// a contact, or a disposition on a call, enrolls into any active sequence
// whose trigger matches. Inbound SMS/calls stop sequences (wired into the
// Twilio webhooks via stopEnrollmentsForContact).

async function autoEnroll(db, companyId, contact, triggerType, value, source) {
  if (!contact || !contact.id) return 0;
  let seqs;
  try {
    seqs = await db.collection('companies').doc(companyId).collection('sequences')
      .where('active', '==', true).where('trigger.type', '==', triggerType).get();
  } catch (e) { return 0; }
  const FV = admin.firestore.FieldValue;
  let n = 0;
  for (const s of seqs.docs) {
    const seq = s.data();
    const want = (seq.trigger && seq.trigger.value) || null;
    if (want && String(want) !== String(value)) continue;
    if (!seq.steps || !seq.steps.length) continue;
    const dupe = await db.collection('companies').doc(companyId).collection('enrollments')
      .where('contactId', '==', contact.id).where('sequenceId', '==', s.id).get();
    if (dupe.docs.some((d) => d.data().status === 'active')) continue;
    const firstDelayMs = (Number(seq.steps[0].delayHours) || 0) * 3600 * 1000;
    await db.collection('companies').doc(companyId).collection('enrollments').add({
      sequenceId: s.id, sequenceName: seq.name || null,
      contactId: contact.id, contactName: contact.name || null,
      status: 'active', currentStep: 0,
      nextRunAt: admin.firestore.Timestamp.fromMillis(Date.now() + firstDelayMs),
      source, startedAt: FV.serverTimestamp(), stoppedAt: null, stoppedReason: null,
      enrolledBy: 'auto', createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp()
    });
    await db.collection('companies').doc(companyId).collection('contacts').doc(contact.id)
      .collection('activities').add({
        type: 'sequence_enrolled', description: `Enrolled in sequence: ${seq.name} (${source})`,
        actorUid: 'system', actorName: 'Automation', createdAt: FV.serverTimestamp(),
        meta: { sequenceId: s.id, trigger: triggerType, value }
      }).catch(() => {});
    n++;
  }
  return n;
}

exports.onContactWrittenForSequences = onDocumentWritten(
  'companies/{companyId}/contacts/{contactId}',
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after) return;
    const db = admin.firestore();
    const { companyId, contactId } = event.params;
    const contact = { id: contactId, ...after };

    // Bulk-change escape hatch. The CRM assistant's apply path sets this flag
    // in the same write when the admin unticks "also run matching automations"
    // on the confirmation card, then clears it immediately afterwards.
    //
    // Without this, "add the tag `nurture` to twenty cold leads" is an
    // untickable send-twenty-sequences button: a tag add is an outbound
    // communication trigger wearing a field-write costume.
    if (after._automationSuppressed === true) {
      console.log(`[autoEnroll] suppressed for ${companyId}/${contactId} (bulk change)`);
      return;
    }

    if (!before || before.stage !== after.stage) {
      await autoEnroll(db, companyId, contact, 'stage_change', after.stage, `stage → ${after.stage}`);
    }
    const oldTags = new Set((before && before.tags) || []);
    for (const t of (after.tags || [])) {
      if (!oldTags.has(t)) await autoEnroll(db, companyId, contact, 'tag_added', t, `tag #${t}`);
    }
    // Consent revoked mid-sequence: stop everything that would text or call.
    if (after.smsOptedOut === true && !(before && before.smsOptedOut === true)) {
      await stopEnrollmentsForContact(db, companyId, contactId, 'opted out of SMS');
    }
    if (after.doNotCall === true && !(before && before.doNotCall === true)) {
      await stopEnrollmentsForContact(db, companyId, contactId, 'added to do-not-call');
    }
  }
);

exports.onCallWrittenForSequences = onDocumentWritten(
  'companies/{companyId}/calls/{callId}',
  async (event) => {
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    if (!after || !after.disposition || (before && before.disposition === after.disposition)) return;
    if (!after.contactId) return;
    const db = admin.firestore();
    const { companyId } = event.params;
    const c = await db.collection('companies').doc(companyId).collection('contacts').doc(after.contactId).get();
    if (!c.exists) return;
    // A connected call is the lead engaging — that ends any cadence.
    if (['connected', 'booked'].includes(after.disposition)) {
      await stopEnrollmentsForContact(db, companyId, after.contactId, `call ${after.disposition}`);
    }
    await autoEnroll(db, companyId, { id: c.id, ...c.data() }, 'disposition', after.disposition, `call: ${after.disposition}`);
  }
);

// ════════════════════════════════════════════════════════════════
// Product interest / pre-order signals + early-access list.
// Public callables (allow unauthenticated) that upsert a CRM contact and
// tag them, so demand can be gauged and emailed via existing campaigns.
// ════════════════════════════════════════════════════════════════

// registerProductInterest({ productId, name, email, phone, consent })
exports.registerProductInterest = onCall(async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const productId = (data.productId || '').toString().trim();
  const name = (data.name || '').toString().trim().slice(0, 120);
  const email = (data.email || '').toString().trim().toLowerCase().slice(0, 160);
  const phone = (data.phone || '').toString().trim().slice(0, 40) || null;
  const consent = !!data.consent;
  if (!productId) throw new HttpsError('invalid-argument', 'Missing product.');
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email.');

  const prodRef = db.collection('products').doc(productId);
  const prodSnap = await prodRef.get();
  if (!prodSnap.exists) throw new HttpsError('not-found', 'Product not found.');
  const product = prodSnap.data();
  const FV = admin.firestore.FieldValue;
  const uid = (request.auth && request.auth.uid) || null;

  // Dedupe interest by email (doc id = sanitized email).
  const interestId = email.replace(/[^a-z0-9]/g, '_').slice(0, 120);
  const intRef = prodRef.collection('interests').doc(interestId);
  const existing = await intRef.get();
  const isNew = !existing.exists;
  await intRef.set({
    name: name || null, email, phone, uid, consent,
    createdAt: existing.exists ? existing.data().createdAt : FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
  if (isNew) await prodRef.set({ interestCount: FV.increment(1) }, { merge: true });

  // Upsert into the CRM (best-effort).
  try {
    const companyId = await resolveAcademyCompanyId(db);
    if (companyId) {
      const tags = [`Interest: ${product.name}`.slice(0, 40)];
      if (consent) tags.push('Opt-In: Calls/SMS/Email');
      const ref = await upsertCrmContact(db, companyId, {
        name: name || null, email, phone, source: 'Product Interest', tags
      });
      if (consent) {
        await ref.set({
          marketingConsent: true, marketingConsentAt: FV.serverTimestamp(),
          marketingConsentText: 'Opted in via product interest form'
        }, { merge: true });
      }
      await ref.collection('activities').add({
        type: 'product_interest', description: `Interested in "${product.name}"`,
        actorUid: 'system', actorName: 'Product interest',
        createdAt: FV.serverTimestamp(), meta: { productId, productName: product.name }
      });
    }
  } catch (e) { console.warn('[registerProductInterest] CRM upsert failed:', e && e.message); }

  return { ok: true, alreadyJoined: !isNew, count: (product.interestCount || 0) + (isNew ? 1 : 0) };
});

// joinEarlyAccess({ name, email, consent }) — general "future products" list.
exports.joinEarlyAccess = onCall(async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const name = (data.name || '').toString().trim().slice(0, 120);
  const email = (data.email || '').toString().trim().toLowerCase().slice(0, 160);
  const consent = !!data.consent;
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email.');
  try {
    const companyId = await resolveAcademyCompanyId(db);
    if (companyId) {
      const FV = admin.firestore.FieldValue;
      const tags = ['Early Access'];
      if (consent) tags.push('Opt-In: Calls/SMS/Email');
      const ref = await upsertCrmContact(db, companyId, { name: name || null, email, source: 'Early Access', tags });
      if (consent) {
        await ref.set({
          marketingConsent: true, marketingConsentAt: FV.serverTimestamp(),
          marketingConsentText: 'Opted in via early-access form'
        }, { merge: true });
      }
      await ref.collection('activities').add({
        type: 'early_access', description: 'Joined the early-access list',
        actorUid: 'system', actorName: 'Early access', createdAt: FV.serverTimestamp()
      });
    }
  } catch (e) { console.warn('[joinEarlyAccess]', e && e.message); }
  return { ok: true };
});

// ────────────────────────────────────────────────────────────────
// Launch emails — "the thing you asked about is open".
//
// Shared by products and courses. The two waitlists live in different places
// (products/{id}/interests vs users/{uid}/courseInterests/{slug}), so each
// kind collects its own recipients and hands them here. The button links to
// the item itself — a product's off-site link or its anchor on /upcoming, a
// course's sales page — where it used to link to the bare homepage.
// ────────────────────────────────────────────────────────────────

async function sendLaunchEmails({ name, summary, url, recipients }) {
  const list = (recipients || []).filter((e) => e && EMAIL_RE.test(e));
  if (!list.length) return 0;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:0 auto;">
    <h2 style="color:#E60306;margin:0 0 10px;">It's here: ${name}</h2>
    <p style="font-size:15px;color:#222;">You asked to be the first to know — ${name} is now open.</p>
    ${summary ? `<p style="font-size:14px;color:#444;">${summary}</p>` : ''}
    <p style="margin:18px 0;"><a href="${url}" style="background:#E60306;color:#fff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600;">Check it out →</a></p>
    <p style="font-size:12px;color:#888;">— The One Percent Nation</p>
  </div>`;
  let sent = 0;
  for (let i = 0; i < list.length; i += 900) {
    const chunk = list.slice(i, i + 900);
    const res = await sendEmailBatch({
      from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
      replyTo: REPLY_TO,
      subject: `It's here: ${name}`,
      html,
      text: `${name} is now open. Visit ${url}`,
      recipients: chunk.map((to) => ({ email: to })),
      customArgs: { type: 'launch' }
    });
    sent += res.accepted;
    for (const e of res.errors) console.warn('[launchEmail] send failed', e);
  }
  return sent;
}

function productLaunchUrl(productId, product) {
  return product.externalUrl || `${APP_BASE_URL}/upcoming.html#p-${encodeURIComponent(productId)}`;
}

// Email everyone on a product's interest list that it's live.
async function sendProductLaunchEmails(db, productId, product) {
  const intsnap = await db.collection('products').doc(productId).collection('interests').get();
  const recipients = intsnap.docs.map((d) => d.data().email);
  return sendLaunchEmails({
    name: product.name,
    summary: product.summary,
    url: productLaunchUrl(productId, product),
    recipients
  });
}

// A course's waitlist is fanned out per member (users/{uid}/courseInterests/
// {slug}, written by registerCourseInterest), so it is gathered with a
// collection-group query — hence the `courseInterests.slug` field override
// in firestore.indexes.json — then joined back to each member's email.
async function sendCourseLaunchEmails(db, slug, course) {
  const snap = await db.collectionGroup('courseInterests').where('slug', '==', slug).get();
  const uids = Array.from(new Set(snap.docs.map((d) => d.ref.parent.parent && d.ref.parent.parent.id).filter(Boolean)));
  const recipients = [];
  for (let i = 0; i < uids.length; i += 100) {
    const refs = uids.slice(i, i + 100).map((uid) => db.collection('users').doc(uid));
    const users = await db.getAll(...refs);
    users.forEach((u) => { if (u.exists && u.data().email) recipients.push(u.data().email); });
  }
  return sendLaunchEmails({
    name: course.title || slug,
    summary: course.short || course.subtitle || null,
    url: `${APP_BASE_URL}/course.html?course=${encodeURIComponent(slug)}`,
    recipients
  });
}

// When a product flips to "live", auto-email its interest list once.
exports.onProductWritten = onDocumentWritten(
  { document: 'products/{productId}', secrets: [sendgridKey] },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    if (!after) return;
    const becameLive = after.status === 'live' && (!before || before.status !== 'live');
    if (!becameLive || after.launchNotifiedAt) return;
    const db = admin.firestore();
    const productId = event.params.productId;
    try {
      const n = await sendProductLaunchEmails(db, productId, after);
      await db.collection('products').doc(productId).set({
        launchNotifiedAt: admin.firestore.FieldValue.serverTimestamp(), launchNotifiedCount: n
      }, { merge: true });
    } catch (e) { console.warn('[onProductWritten]', e && e.message); }
  }
);

// The twin for courses. Courses have collected a waitlist for as long as the
// "Notify me when enrollment opens" button has existed; this is the first
// thing that has ever contacted it.
exports.onCourseWritten = onDocumentWritten(
  { document: 'courses/{slug}', secrets: [sendgridKey] },
  async (event) => {
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
    if (!after) return;
    const becameLive = after.status === 'live' && (!before || before.status !== 'live');
    if (!becameLive || after.launchNotifiedAt) return;
    const db = admin.firestore();
    const slug = event.params.slug;
    try {
      const n = await sendCourseLaunchEmails(db, slug, after);
      await db.collection('courses').doc(slug).set({
        launchNotifiedAt: admin.firestore.FieldValue.serverTimestamp(), launchNotifiedCount: n
      }, { merge: true });
    } catch (e) { console.warn('[onCourseWritten]', e && e.message); }
  }
);

// Manual "Notify list" button (admin) — backup for the auto trigger. Returns
// whether the launch email has already gone out so the console can warn
// before re-sending; the auto trigger guards itself, this never did.
exports.notifyProductInterest = onCall({ secrets: [sendgridKey] }, async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) throw new HttpsError('permission-denied', 'Admin or owner role required.');
  const productId = (request.data && request.data.productId || '').toString();
  const snap = await db.collection('products').doc(productId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Product not found.');
  const product = snap.data();
  const previouslyAt = product.launchNotifiedAt && product.launchNotifiedAt.toMillis ? product.launchNotifiedAt.toMillis() : null;
  const n = await sendProductLaunchEmails(db, productId, product);
  await snap.ref.set({
    launchNotifiedAt: admin.firestore.FieldValue.serverTimestamp(), launchNotifiedCount: n
  }, { merge: true });
  return { ok: true, sent: n, previouslyNotifiedAt: previouslyAt };
});

// ────────────────────────────────────────────────────────────────
// Launch-date promotion — the tick's catalog step.
//
// An item marked coming soon (or pre-order) with a launchDate that has
// arrived flips to live. Nothing else has to happen here: the two
// onDocumentWritten triggers above see the transition and email the
// waitlists, and every surface reads status, so the badge, the banner, the
// store and the sales page all follow from this one write.
//
// Both collections are small, so the date compare is done in memory rather
// than with a range query that would need a composite index per collection.
// ────────────────────────────────────────────────────────────────

async function promoteLaunchedItems(db, { dryRun = false } = {}) {
  const now = admin.firestore.Timestamp.now();
  const due = (snap) => snap.docs.filter((d) => {
    const ld = d.data().launchDate;
    return ld && typeof ld.toMillis === 'function' && ld.toMillis() <= now.toMillis();
  });

  const [courses, products] = await Promise.all([
    db.collection('courses').where('status', '==', 'coming-soon').get(),
    db.collection('products').where('status', 'in', ['interest', 'preorder']).get()
  ]);

  const patch = {
    status: 'live',
    launchedAt: admin.firestore.FieldValue.serverTimestamp(),
    launchedBy: 'auto'
  };
  const flipped = { courses: [], products: [] };

  // dryRun reports what would flip and writes nothing. A status flip here is
  // what fires the launch emails, and those cannot be unsent, so there has to
  // be a way to see the blast radius before causing it.
  for (const d of due(courses)) {
    if (!dryRun) await d.ref.set({ ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: 'launch-tick' }, { merge: true });
    flipped.courses.push(d.id);
  }
  for (const d of due(products)) {
    if (!dryRun) await d.ref.set({ ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    flipped.products.push(d.id);
  }
  if (flipped.courses.length || flipped.products.length) {
    console.log(dryRun ? '[launch-tick] would promote' : '[launch-tick] promoted', JSON.stringify(flipped));
  }
  const out = { courses: flipped.courses.length, products: flipped.products.length };
  if (dryRun) { out.dryRun = true; out.wouldPromote = flipped; }
  return out;
}

// ════════════════════════════════════════════════════════════════
// Course Advisor Chatbot — powered by Claude (Anthropic).
//
// courseAdvisorChat({ message, history }) → { reply, sessionId }
//
// Public callers (no auth) get general course info and OPN mission guidance.
// Authenticated callers get their profile + enrolled courses injected into the
// system prompt for personalised recommendations.
//
// When the user expresses intent to suggest a new course topic the function
// saves a courseSuggestions/{id} doc and acknowledges receipt.
// ════════════════════════════════════════════════════════════════

const OPN_COURSES = [
  { slug: '1p-clc',              title: '1P Certified Life Coach',          price: 3497, modules: 8, eyebrow: 'Certification · 16 Weeks', desc: 'Certified in 16 weeks: live weekly coaching, a certification exam, a reviewed session, and an A.L.I.G.N. Practitioner License.' },
  { slug: 'bundle-icant',        title: 'The Complete I Can\'t Experience', price: 197, modules: 10, eyebrow: 'Best Value · Book + Course', desc: 'The course plus a paperback of I Can\'t: Is Not A Strategy shipped to you. One module per chapter; every workbook is the book\'s own exercise.' },
  { slug: 'icant',               title: 'I Can\'t: The Course',             price: 197, modules: 10, eyebrow: 'Self-paced', desc: 'The companion to the book, one module per chapter. Not sold separately: it is included in The Complete I Can\'t Experience.' },
  { slug: 'mindset-foundations', title: 'Mindset Foundations',              price: 197, modules: 5,  eyebrow: 'Self-paced', desc: 'Rewire how you relate to success, setbacks, and self.' },
  { slug: 'business-alignment',  title: 'Business Alignment',               price: 297, modules: 6,  eyebrow: 'Self-paced', desc: 'Build a business that reflects your values and sustains your life.' },
  { slug: 'faith-leadership',    title: 'Faith & Leadership',               price: 197, modules: 4,  eyebrow: 'Self-paced', desc: 'Lead from purpose — grounded in principle, not performance.' },
  { slug: 'performance-discipline', title: 'Performance & Discipline',      price: 247, modules: 5,  eyebrow: 'Self-paced', desc: 'Daily structure and habits that compound into long-term results.' }
];

function buildCourseKnowledge() {
  return OPN_COURSES.map((c) =>
    `- ${c.title} (${c.eyebrow} · ${c.modules} modules · $${c.price}): ${c.desc}`
  ).join('\n');
}

function buildSystemPrompt(userContext, knowledgeEntries, communityContext) {
  const courseList = buildCourseKnowledge();

  // Inject owner-supplied knowledge base entries
  let kbSection = '';
  if (knowledgeEntries && knowledgeEntries.length) {
    const items = knowledgeEntries
      .map((e) => `### ${e.title}\n${e.body}`)
      .join('\n\n');
    kbSection = `\n\nADDITIONAL KNOWLEDGE BASE:\n${items}`;
  }

  const base = `You are an intelligent course advisor and member support chatbot for One Percent Nation (OPN). Your role is to help members learn, grow, and discover courses aligned with their goals.

OPN's mission is redefining success and realigning purpose — one percent at a time.

AVAILABLE COURSES:
${courseList}${kbSection}

GUIDELINES:
- Maintain a warm, encouraging tone aligned with OPN's philosophy of realigning purpose.
- Keep responses focused and actionable — avoid long walls of text.
- When recommending courses, briefly explain WHY a specific course fits the member's stated goal.
- You never share other members' data or progress information.
- If a member suggests a new course topic or learning area they wish OPN offered, acknowledge their suggestion enthusiastically, ask 1-2 clarifying questions about their learning goals and preferred outcomes, then tell them you've submitted their suggestion to the course team. Use the keyword COURSE_SUGGESTION_DETECTED in your response ONLY when you have gathered enough context (after the clarifying exchange) and are ready to log the suggestion — wrap the full suggestion detail in JSON after that keyword like: COURSE_SUGGESTION_DETECTED{"topic":"...","goals":"...","outcomes":"..."}`;

  if (!userContext) {
    return base + '\n\nCONTEXT: You are speaking with a visitor on the public website. They are not yet logged in.';
  }

  const { displayName, enrolledCourses, progressSummary, bio, profession, location } = userContext;
  const name = displayName ? `Their name is ${displayName}.` : '';
  const enrolled = enrolledCourses && enrolledCourses.length
    ? `They are currently enrolled in: ${enrolledCourses.join(', ')}.`
    : 'They are not yet enrolled in any courses.';
  const progress = progressSummary || '';

  // Build profile snapshot for context
  const profileParts = [];
  if (displayName) profileParts.push(`Name: ${displayName}`);
  if (bio)         profileParts.push(`Bio: ${bio}`);
  if (profession)  profileParts.push(`Profession: ${profession}`);
  if (location)    profileParts.push(`Location: ${location}`);
  const profileSnapshot = profileParts.length
    ? `\nMEMBER PROFILE:\n${profileParts.map(p => `- ${p}`).join('\n')}`
    : '';

  const communitySection = communityContext
    ? `\n\nCOMMUNITY SNAPSHOT (last 7 days):\n${communityContext}`
    : '';

  const portalInstructions = `

PORTAL CAPABILITIES (authenticated members only):
1. PROFILE UPDATES — If the member asks to update their display name, bio, profession, company, industry, location, LinkedIn URL, website, phone, community goals, or pronouns: confirm what they want, then output PROFILE_UPDATE immediately followed by a compact JSON object with ONLY the fields being changed. Example: PROFILE_UPDATE{"bio":"I'm a leadership coach in Atlanta"}. Never include this signal for fields not in that list (role, email, avatar, etc.). Strip any other commentary from the signal line — just the keyword and JSON. After the signal, confirm what was updated in natural language.
2. COMMUNITY UPDATES — When asked "what's new", "any updates", "what's happening in the community", or similar: summarize the COMMUNITY SNAPSHOT above. Lead with announcements, then highlight wins. Keep it to 3–5 sentences. If the snapshot is empty, say "Check the Community tab for the latest — I don't have a live feed right now."`;

  return `${base}${profileSnapshot}${communitySection}${portalInstructions}\n\nCONTEXT: You are speaking with an authenticated member inside the One Percent Academy portal. ${name} ${enrolled} ${progress}`.trim();
}

async function fetchMemberContext(db, uid) {
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) return null;
    const u = userSnap.data();

    const enrolledCourses = (u.enrolledCourseSlugs || []).map((slug) => {
      const course = OPN_COURSES.find((c) => c.slug === slug);
      return course ? course.title : slug;
    });

    // Fetch up to 5 most recently active course progress docs.
    let progressSummary = '';
    try {
      const progSnap = await db.collection('users').doc(uid).collection('courseProgress')
        .orderBy('lastActiveAt', 'desc').limit(5).get();
      if (!progSnap.empty) {
        const parts = progSnap.docs.map((d) => {
          const p = d.data();
          const course = OPN_COURSES.find((c) => c.slug === d.id);
          const name = course ? course.title : d.id;
          const pct = p.progressPct != null ? `${Math.round(p.progressPct)}% complete` : '';
          const mod = p.currentModule ? `on module ${p.currentModule}` : '';
          return [name, pct, mod].filter(Boolean).join(', ');
        });
        if (parts.length) progressSummary = `Progress: ${parts.join(' | ')}.`;
      }
    } catch (e) { /* progress subcollection may not exist yet */ }

    return {
      displayName:   u.displayName   || null,
      bio:           u.bio           || null,
      profession:    u.profession    || null,
      location:      u.location      || null,
      companyId:     u.companyId     || null,
      enrolledCourses,
      progressSummary
    };
  } catch (e) {
    console.warn('[courseAdvisorChat] fetchMemberContext failed:', e && e.message);
    return null;
  }
}

// Fetch all active knowledge base entries (ordered by pinned desc, then order asc).
async function fetchKnowledgeEntries(db) {
  try {
    const snap = await db.collection('chatbotKnowledge')
      .where('active', '==', true)
      .orderBy('order', 'asc')
      .limit(50)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[courseAdvisorChat] fetchKnowledgeEntries failed:', e && e.message);
    return [];
  }
}

// Fetch recent community posts visible to this member for chatbot context.
async function fetchCommunityContext(db, companyId) {
  try {
    // Single query ordered by date — no composite index needed.
    const snap = await db.collection('posts').orderBy('createdAt', 'desc').limit(25).get();

    function relTime(ts) {
      if (!ts || !ts.toMillis) return '';
      const m = Math.floor((Date.now() - ts.toMillis()) / 60000);
      if (m < 60) return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    }

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - sevenDaysMs;

    // Visibility: global posts (companyId null/undefined) + member's company posts.
    const visible = snap.docs.filter((d) => {
      const cid = d.data().companyId;
      if (!cid) return true;
      return companyId && cid === companyId;
    }).filter((d) => {
      const ts = d.data().createdAt;
      return ts && ts.toMillis && ts.toMillis() > cutoff;
    });

    const byCategory = { announcements: [], wins: [], other: [] };
    visible.forEach((d) => {
      const cat = d.data().category || 'other';
      if (cat === 'announcements') byCategory.announcements.push(d);
      else if (cat === 'wins')     byCategory.wins.push(d);
      else                         byCategory.other.push(d);
    });

    function fmt(d) {
      const data = d.data();
      const text = String(data.text || '').trim();
      const preview = text.length > 200 ? text.slice(0, 200) + '...' : text;
      const when = relTime(data.createdAt);
      const author = data.authorName || 'Member';
      return `"${preview}" — ${author}${when ? ` (${when})` : ''}`;
    }

    const lines = [];
    if (byCategory.announcements.length) {
      lines.push('📣 ANNOUNCEMENTS:');
      byCategory.announcements.slice(0, 3).forEach((d) => lines.push(`  - ${fmt(d)}`));
    }
    if (byCategory.wins.length) {
      lines.push('🏆 WINS & HIGHLIGHTS:');
      byCategory.wins.slice(0, 3).forEach((d) => lines.push(`  - ${fmt(d)}`));
    }
    if (byCategory.other.length) {
      lines.push('💬 RECENT ACTIVITY:');
      byCategory.other.slice(0, 3).forEach((d) => lines.push(`  - ${fmt(d)}`));
    }

    return lines.length ? lines.join('\n') : null;
  } catch (e) {
    console.warn('[courseAdvisorChat] fetchCommunityContext failed:', e && e.message);
    return null;
  }
}

// Allowed fields for PROFILE_UPDATE signal — whitelist keeps sensitive fields safe.
const PROFILE_UPDATE_ALLOWED = {
  displayName: 100, bio: 500, profession: 150, company: 150,
  industry: 100, location: 150, linkedinUrl: 300, website: 300,
  phone: 40, communityGoals: 1000, pronouns: 50
};

// saveKnowledgeEntry — create or update a KB entry. Owner/admin only.
exports.saveKnowledgeEntry = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const { id, title, body, order, active } = request.data || {};
  if (!title || !title.trim()) throw new HttpsError('invalid-argument', 'title is required.');
  if (!body  || !body.trim())  throw new HttpsError('invalid-argument', 'body is required.');

  const payload = {
    title:     String(title).trim().slice(0, 200),
    body:      String(body).trim().slice(0, 8000),
    order:     typeof order === 'number' ? order : 0,
    active:    active !== false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid
  };

  if (id) {
    // Update existing
    const ref = db.collection('chatbotKnowledge').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Entry not found.');
    await ref.set(payload, { merge: true });
    return { ok: true, id };
  } else {
    // Create new
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.createdBy = request.auth.uid;
    const ref = await db.collection('chatbotKnowledge').add(payload);
    return { ok: true, id: ref.id };
  }
});

// deleteKnowledgeEntry — hard-delete a KB entry. Owner/admin only.
exports.deleteKnowledgeEntry = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const id = String((request.data && request.data.id) || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'id is required.');
  await db.collection('chatbotKnowledge').doc(id).delete();
  return { ok: true };
});

// listKnowledgeEntries — returns all entries (incl. inactive). Owner/admin only.
exports.listKnowledgeEntries = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const snap = await db.collection('chatbotKnowledge').orderBy('order', 'asc').limit(200).get();
  return {
    entries: snap.docs.map((d) => ({ id: d.id, ...d.data(),
      createdAt: d.data().createdAt ? d.data().createdAt.toMillis() : null,
      updatedAt: d.data().updatedAt ? d.data().updatedAt.toMillis() : null
    }))
  };
});

exports.courseAdvisorChat = onCall({ secrets: [anthropicKey] }, async (request) => {
  const db = admin.firestore();
  const { message, history } = request.data || {};

  // Require auth: this endpoint calls a paid LLM on every request, so it must
  // not be open to anonymous callers.
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'message is required.');
  }
  if (message.length > 4000) {
    throw new HttpsError('invalid-argument', 'message is too long (max 4000 chars).');
  }

  // Throttle: at most 20 AI messages per user per 5 minutes.
  await rateLimitCaller(db, request, { action: 'courseAdvisorChat', max: 20, windowSec: 300 });
  // Fetch member context first so we have companyId for community scoping.
  const memberContext = uid ? await fetchMemberContext(db, uid) : null;
  const [knowledgeEntries, communityContext] = await Promise.all([
    fetchKnowledgeEntries(db),
    uid ? fetchCommunityContext(db, memberContext && memberContext.companyId) : Promise.resolve(null)
  ]);
  const systemPrompt = buildSystemPrompt(memberContext, knowledgeEntries, communityContext);

  // Build conversation history (max 20 turns to stay within context limits).
  const safeHistory = Array.isArray(history) ? history.slice(-20) : [];
  const messages = [
    ...safeHistory.map((turn) => ({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: String(turn.content || '').slice(0, 4000)
    })),
    { role: 'user', content: message.trim() }
  ];

  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new HttpsError('internal', 'Anthropic SDK not available.');
  }

  const apiKey = ANTHROPIC_API_KEY();
  if (!apiKey) {
    throw new HttpsError('failed-precondition',
      'ANTHROPIC_API_KEY is not configured. Create it in Secret Manager (Google Cloud Console > Security > Secret Manager) and redeploy.');
  }
  const client = new Anthropic.default({ apiKey });

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: systemPrompt,
    messages
  });

  const rawReply = (response.content && response.content[0] && response.content[0].text) || '';

  // Detect and extract course suggestion signal.
  let replyText = rawReply;
  if (rawReply.includes('COURSE_SUGGESTION_DETECTED')) {
    try {
      const jsonMatch = rawReply.match(/COURSE_SUGGESTION_DETECTED(\{[\s\S]*?\})/);
      if (jsonMatch) {
        const suggestionData = JSON.parse(jsonMatch[1]);
        // Save to Firestore (best-effort — don't fail the reply if this errors).
        try {
          await db.collection('courseSuggestions').add({
            uid: uid || null,
            displayName: (memberContext && memberContext.displayName) || null,
            topic: suggestionData.topic || '',
            goals: suggestionData.goals || '',
            outcomes: suggestionData.outcomes || '',
            rawMessage: message,
            submittedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        } catch (e) { console.warn('[courseAdvisorChat] suggestion save failed:', e && e.message); }
      }
    } catch (e) { console.warn('[courseAdvisorChat] suggestion parse failed:', e && e.message); }
    // Strip the internal signal from the user-facing reply.
    replyText = rawReply.replace(/COURSE_SUGGESTION_DETECTED\{[\s\S]*?\}/g, '').trim();
  }

  // Detect and handle profile update signal (authenticated members only).
  let profileUpdated = null;
  if (uid && replyText.includes('PROFILE_UPDATE')) {
    try {
      const match = replyText.match(/PROFILE_UPDATE(\{[\s\S]*?\})/);
      if (match) {
        const parsed = JSON.parse(match[1]);
        const patch = {};
        for (const [key, maxLen] of Object.entries(PROFILE_UPDATE_ALLOWED)) {
          if (parsed[key] === undefined) continue;
          const val = String(parsed[key]).trim().slice(0, maxLen);
          if (val) patch[key] = val;
        }
        if (Object.keys(patch).length) {
          patch.lastActiveAt = admin.firestore.FieldValue.serverTimestamp();
          await db.collection('users').doc(uid).set(patch, { merge: true });
          const { lastActiveAt: _ts, ...updatedFields } = patch;
          profileUpdated = updatedFields;
          console.info('[courseAdvisorChat] profile updated:', uid, Object.keys(updatedFields));
        }
      }
    } catch (e) { console.warn('[courseAdvisorChat] profile update failed:', e && e.message); }
    replyText = replyText.replace(/PROFILE_UPDATE\{[\s\S]*?\}/g, '').trim();
  }

  return { reply: replyText, profileUpdated: profileUpdated || null };
});

// reportBug — any user (authenticated or not) can submit a bug report.
// Captures description + optional screenshot, runs Claude AI analysis,
// saves to bugReports collection, and emails the owner.
//
// `secrets` is required, not optional: this function calls sendgridKey.value()
// to send the owner notification, and a secret that is not declared here is
// never injected at runtime. Without it the notification threw on every
// report, was swallowed by the try/catch around the email block, and the
// reporter was still told "Bug report sent" while nobody was ever notified.
exports.reportBug = onCall({ secrets: [sendgridKey, anthropicKey] }, async (request) => {
  const db = admin.firestore();

  const { description, screenshotDataUrl, url: pageUrl, userAgent } = request.data || {};
  if (!description || typeof description !== 'string' || !description.trim()) {
    throw new HttpsError('invalid-argument', 'description is required.');
  }
  if (description.length > 2000) {
    throw new HttpsError('invalid-argument', 'description is too long (max 2000 chars).');
  }

  // Open to anonymous users (bug reports from logged-out visitors are useful),
  // but throttled by uid/IP since it runs Claude analysis + emails the owner.
  await rateLimitCaller(db, request, { action: 'reportBug', max: 5, windowSec: 600 });

  const uid = request.auth && request.auth.uid;
  // Recorded so beta feedback can be told apart from general site bugs: the
  // report only ever carried a uid, which nothing else in the portal keys on.
  const reporterEmail = (request.auth && request.auth.token && request.auth.token.email)
    ? String(request.auth.token.email).trim().toLowerCase().slice(0, 160)
    : null;
  const reportRef = db.collection('bugReports').doc();
  const reportId = reportRef.id;

  // ── Upload screenshot to Firebase Storage ──────────────────────────────────
  let screenshotUrl = null;
  if (screenshotDataUrl && typeof screenshotDataUrl === 'string'
      && screenshotDataUrl.startsWith('data:image/')) {
    try {
      const base64Data = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buf = Buffer.from(base64Data, 'base64');
      const bucket = admin.storage().bucket();
      const file = bucket.file(`bug-screenshots/${reportId}.jpg`);
      await file.save(buf, { metadata: { contentType: 'image/jpeg' } });
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 30 * 24 * 60 * 60 * 1000
      });
      screenshotUrl = signedUrl;
    } catch (e) {
      console.warn('[reportBug] screenshot upload failed:', e && e.message);
    }
  }

  // ── Claude AI bug analysis ─────────────────────────────────────────────────
  let aiAnalysis = 'AI analysis unavailable.';
  let aiSeverity = 'unknown';
  try {
    let Anthropic;
    try { Anthropic = require('@anthropic-ai/sdk'); }
    catch (e) { throw new Error('Anthropic SDK not available'); }

    const apiKey = ANTHROPIC_API_KEY();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
    const client = new Anthropic.default({ apiKey });

    const userContent = [];

    if (screenshotDataUrl && screenshotDataUrl.startsWith('data:image/')) {
      const base64Only = screenshotDataUrl.replace(/^data:image\/\w+;base64,/, '');
      userContent.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64Only }
      });
    }

    userContent.push({
      type: 'text',
      text: [
        'Bug Report — The One Percent Academy (1PN) web app:',
        '',
        `Description: ${description.trim()}`,
        `Page URL: ${pageUrl || 'unknown'}`,
        `User Agent: ${userAgent || 'unknown'}`,
        `Reported by UID: ${uid || 'anonymous'}`,
        '',
        'Please analyze this bug and respond with:',
        '1. **Root Cause**: What is likely causing this?',
        '2. **Proposed Fix**: Specific code or config change to fix it',
        '3. **Severity**: one of: low | medium | high | critical',
        '',
        'Be concise and specific. The app uses Firebase (Firestore, Auth, Functions, Storage), vanilla JS ES modules, and Firebase Hosting.'
      ].join('\n')
    });

    const aiRes = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      system: 'You are a senior software engineer reviewing bug reports for a web app called "The One Percent Academy" (1PN). Provide concise, actionable analysis.',
      messages: [{ role: 'user', content: userContent }]
    });

    const rawText = (aiRes.content && aiRes.content[0] && aiRes.content[0].text) || '';
    aiAnalysis = rawText;

    const sevMatch = rawText.match(/\b(critical|high|medium|low)\b/i);
    if (sevMatch) aiSeverity = sevMatch[1].toLowerCase();

  } catch (e) {
    console.warn('[reportBug] AI analysis failed:', e && e.message);
  }

  // ── Save to Firestore ──────────────────────────────────────────────────────
  await reportRef.set({
    reportId,
    description: description.trim().slice(0, 2000),
    pageUrl: (pageUrl || '').slice(0, 500),
    userAgent: (userAgent || '').slice(0, 500),
    reportedByUid: uid || null,
    reportedByEmail: reporterEmail,
    screenshotUrl,
    aiAnalysis,
    aiSeverity,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Beta testers' reports count toward their cohort record. Best-effort and
  // a no-op for everyone who isn't one.
  if (reporterEmail) {
    try {
      await noteBetaFeedback(db, reporterEmail);
    } catch (e) {
      console.warn('[reportBug] beta feedback count failed:', e && e.message);
    }
  }

  // ── Email owner ────────────────────────────────────────────────────────────
  try {
    const shortDesc = description.trim().slice(0, 80);
    const htmlBody = [
      `<h2 style="color:#c20000;">Bug Report — ${textToHtml(shortDesc)}</h2>`,
      `<table style="border-collapse:collapse;font-size:13px;">`,
      `<tr><td style="padding:4px 12px 4px 0;color:#888;">Severity</td><td><strong>${aiSeverity}</strong></td></tr>`,
      `<tr><td style="padding:4px 12px 4px 0;color:#888;">Page</td><td>${textToHtml(pageUrl || 'unknown')}</td></tr>`,
      `<tr><td style="padding:4px 12px 4px 0;color:#888;">Reporter</td><td>${uid || 'anonymous'}</td></tr>`,
      `</table>`,
      `<h3>Description</h3>`,
      `<blockquote style="border-left:3px solid #c20000;margin:0;padding:8px 14px;background:#fff8f8;">${textToHtml(description.trim())}</blockquote>`,
      `<h3>AI Analysis &amp; Fix Proposal</h3>`,
      `<pre style="white-space:pre-wrap;font-family:monospace;font-size:13px;background:#f5f5f5;padding:12px;border-radius:6px;line-height:1.5;">${textToHtml(aiAnalysis)}</pre>`,
      screenshotUrl
        ? `<p><a href="${screenshotUrl}" style="color:#c20000;">View Screenshot →</a> (link expires in 30 days)</p>`
        : '<p><em>No screenshot attached.</em></p>',
      `<hr/><p><a href="https://the-1p-leadership.web.app/bug-reports.html" style="color:#c20000;">Review all bug reports →</a></p>`
    ].join('');

    await sendEmail({
      to: NOTIFY_EMAIL,
      from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
      replyTo: REPLY_TO,
      subject: `[Bug][${aiSeverity.toUpperCase()}] ${shortDesc}`,
      text: `Bug Report\n\nSeverity: ${aiSeverity}\nPage: ${pageUrl || 'unknown'}\nReporter: ${uid || 'anonymous'}\n\nDescription:\n${description.trim()}\n\nAI Analysis:\n${aiAnalysis}\n\nReview: https://the-1p-leadership.web.app/bug-reports.html`,
      html: htmlBody
    });
  } catch (e) {
    console.warn('[reportBug] email send failed:', e && e.message);
  }

  return { ok: true, reportId };
});

// ════════════════════════════════════════════════════════════════
// AI Course Generator — powered by Claude (Anthropic).
//
// Two admin-only callables orchestrated by the course builder
// (public/js/course-ai.js): generateCourseOutline returns the course
// skeleton fast, then the browser calls generateCourseLesson once per
// lesson and writes each result to courses/{slug}/modules/* itself as a
// draft — Firestore writes stay client-side so the security model lives
// in firestore.rules, and a cancelled run simply keeps the drafts
// written so far.
// ════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════
// CRM assistant — admin-only, company-scoped, tool-using.
//
// Answers "who needs contacting?", "who has gone stagnant?", "what's
// overdue?", "audit my pipeline", "what's the story with X" against live data,
// and stages task/tag changes for the admin to approve.
//
// SECURITY, in one place because it is the whole design:
//
//  1. `companyId` comes from the client and is verified with
//     assertCompanyAdmin — NOT isAdminCaller, which is true for a platform
//     admin of *any* company and would make this a cross-tenant read endpoint.
//  2. `companyId` appears in NO tool schema. Executors are built over a
//     `scope` closure and never receive `db`, so they cannot construct a path
//     outside this company. A model-invented companyId/path argument is
//     dropped and the tool proceeds scoped.
//  3. NO collectionGroup queries. activities/notes/emails/messages/calls
//     documents carry no companyId field, so a collection-group query is an
//     unfilterable cross-tenant read. There is no safe version of this.
//  4. Client-supplied history is replayed as plain text only — tool_use and
//     tool_result blocks are stripped, so row data never round-trips through
//     the browser where a history from company A could be replayed at B.
//  5. Nothing is written by the model. Writes are staged as a plan the admin
//     approves; the apply path runs with no LLM in it at all.
// ════════════════════════════════════════════════════════════════

// Haiku 4.5, not Opus, because the expensive questions are answered for free
// by the deterministic reports on the CRM dashboard. What is left for the
// model is ad-hoc phrasing, which Haiku handles at roughly a fifth of the
// cost (~$1/$5 per MTok against $5/$25).
//
// Switching this constant is not just a string swap: thinking is configured
// differently per model family, so use crmThinkingConfig() below rather than
// hardcoding a thinking block. Opus 5 / Sonnet 5 take adaptive thinking and
// reject budget_tokens with a 400; Haiku 4.5 is the reverse.
const CRM_MODEL = 'claude-haiku-4-5';

/**
 * The right `thinking` parameter for whichever model CRM_MODEL names.
 *
 * Getting this wrong is a 400 at runtime, not a lint error, so it lives in one
 * place next to the model constant rather than inline at the call site.
 */
function crmThinkingConfig(model) {
  // Haiku 4.5 and older models: an explicit token budget, which must be below
  // max_tokens. Adaptive is rejected.
  if (/haiku/.test(model)) return { type: 'enabled', budget_tokens: 2048 };
  // Opus 5 / Sonnet 5 / the 4.6+ family: adaptive. budget_tokens is a 400.
  return { type: 'adaptive' };
}
const CRM_MAX_ITERATIONS = 6;        // model turns before we force an answer
const CRM_MAX_TOOL_CALLS = 10;
const CRM_MAX_ROWS_PER_TOOL = 50;
const CRM_FETCH_CAP = 300;           // docs pulled before in-memory filtering
const CRM_MAX_TOTAL_ROWS = 200;      // across one turn
const CRM_SOFT_DEADLINE_MS = 240000; // leave headroom under timeoutSeconds 300
const CRM_PLAN_TTL_MS = 15 * 60 * 1000;

// Write caps. Sized for the fact that a tag add can trigger sequence
// auto-enrolment, which sends real email and SMS — see the automation warning
// machinery below.
const CRM_MAX_CONTACTS_PER_PLAN = 25;
const CRM_MAX_ITEMS_PER_PLAN = 40;
const CRM_MAX_CONTACTS_PER_DAY = 200;

// Stage changes are staged and recorded but NOT applied. Turning this on is a
// deliberate decision that wants evidence behind it: a stage write fires
// onContactWrittenForSequences → autoEnroll, so "mark these 40 as lost" can
// mean "send 40 breakup emails". Leaving it false accumulates real proposals
// in aiPlans that can be read back before anyone flips it.
const CRM_STAGE_WRITES_ENABLED = false;

const FRESHNESS_BANDS = { warm: 7, cooling: 14, stagnant: 30 };
const CRM_STAGES = ['new', 'contacted', 'qualified', 'negotiating', 'customer', 'lost'];

function daysAgoTs(days) {
  return admin.firestore.Timestamp.fromMillis(Date.now() - days * 86400000);
}

function msOf(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  return null;
}

function daysSince(ts) {
  const m = msOf(ts);
  return m === null ? null : Math.floor((Date.now() - m) / 86400000);
}

function freshnessId(contact) {
  const d = daysSince(contact.lastContactedAt);
  if (d === null) return 'never';
  if (d < FRESHNESS_BANDS.warm) return 'warm';
  if (d < FRESHNESS_BANDS.cooling) return 'cooling';
  if (d < FRESHNESS_BANDS.stagnant) return 'stagnant';
  return 'cold';
}

/** Clamp to [min,max], tolerating the model handing us a string or nonsense. */
function clampInt(v, min, max, dflt) {
  // null and '' must fall through to the default, not be coerced. Number(null)
  // is 0, which is finite, so the naive version turned an omitted `limit` into
  // limit:1 — one row returned and reported on with total confidence.
  if (v === null || v === undefined || v === '') return dflt;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/** Free text out of the CRM and into the model's context, length-bounded. */
function snip(s, n = 300) {
  const t = String(s == null ? '' : s).trim();
  return t.length > n ? t.slice(0, n) + '…[truncated]' : t;
}

/**
 * A contact row for the model. A whitelist, never `...doc.data()` — internal
 * plumbing (Stripe ids, unsub tokens, message ids) has no business in an LLM
 * context, and the phone number buys nothing because the assistant cannot dial.
 */
function contactRow(id, c) {
  const optOuts = [];
  if (c.emailOptOut === true) optOuts.push('email');
  if (c.smsOptedOut === true) optOuts.push('sms');
  if (c.doNotCall === true) optOuts.push('calls');
  if (Array.isArray(c.tags) && c.tags.includes('Unsubscribed')) optOuts.push('unsubscribed');
  return {
    contactId: id,
    name: c.name || null,
    companyName: c.companyName || null,
    email: c.email || null,
    hasPhone: !!c.phone,
    stage: c.stage || null,
    source: c.source || null,
    tags: Array.isArray(c.tags) ? c.tags.slice(0, 10) : [],
    ownerUid: c.ownerUid || null,
    freshness: freshnessId(c),
    daysSinceContact: daysSince(c.lastContactedAt),
    lastContactChannel: c.lastContactChannel || null,
    lastContactDirection: c.lastContactDirection || null,
    daysSinceActivity: daysSince(c.lastActivityAt),
    unreadEmails: Number(c.emailUnreadCount) || 0,
    optOuts
  };
}

/** Every tool result carries these, even when nothing was truncated, so the
 *  model can never mistake a capped list for a complete one. */
function envelope(rows, { scanned, matchedAtLeast = null, note = null }) {
  // Two ways to be incomplete, and both must set the flag. The post-filter
  // count can fit inside the limit while the underlying query still hit the
  // fetch cap — reporting that as complete is exactly the confident
  // under-report this envelope exists to prevent.
  const truncated = (matchedAtLeast !== null && matchedAtLeast > rows.length)
    || scanned >= CRM_FETCH_CAP;
  return {
    rows,
    returned: rows.length,
    scanned,
    matchedAtLeast,
    truncated,
    truncationNote: truncated
      ? `Showing ${rows.length} of at least ${matchedAtLeast || scanned}. Say "at least N", never a bare count, and offer to narrow by stage, owner or tag.`
      : null,
    note
  };
}

// ── Tool schemas ────────────────────────────────────────────────
// No tool takes companyId. That is not an oversight and must stay true.

const CRM_READ_TOOLS = [
  {
    name: 'crm_find_contacts',
    description: 'Find contacts by stage, owner, tag, staleness or free text. Returns WHICH contacts match, sorted by how long they have been ignored. For HOW MANY, use crm_pipeline_snapshot instead — do not count these rows.',
    input_schema: {
      type: 'object',
      properties: {
        stages: { type: 'array', items: { type: 'string', enum: CRM_STAGES }, description: 'OR filter. Omit for all stages.' },
        staleness: { type: 'string', enum: ['warm', 'cooling', 'stagnant', 'cold', 'never'], description: 'warm <7d, cooling 7-14d, stagnant 14-30d, cold >30d since real outreach; never = nobody has ever contacted them.' },
        contactedBeforeDays: { type: 'integer', minimum: 0, maximum: 3650, description: 'Alternative to staleness: last contacted more than N days ago.' },
        ownerUid: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
        query: { type: 'string', description: 'Case-insensitive substring on name, company or email.' },
        excludeOptedOut: { type: 'boolean', description: 'Drop contacts who opted out of email or SMS or are marked do-not-call.' },
        limit: { type: 'integer', minimum: 1, maximum: CRM_MAX_ROWS_PER_TOOL }
      },
      additionalProperties: false
    }
  },
  {
    name: 'crm_contact_detail',
    description: 'The full story on one lead: their record plus recent emails, texts, calls, notes, tasks and deals. Use this for "what is going on with X".',
    input_schema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        nameQuery: { type: 'string', description: 'Use when you only have a name. Returns candidates if more than one matches, rather than guessing.' },
        perSectionLimit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'crm_list_tasks',
    description: 'Follow-up tasks, with overdue and due-today counts.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'any'] },
        overdueOnly: { type: 'boolean' },
        dueWithinDays: { type: 'integer', minimum: 0, maximum: 365 },
        assigneeUid: { type: 'string' },
        contactId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: CRM_MAX_ROWS_PER_TOOL }
      },
      additionalProperties: false
    }
  },
  {
    name: 'crm_pipeline_snapshot',
    description: 'Exact counts across the whole book of business: contacts by stage, staleness distribution, open deals and their value, open and overdue tasks. Returns NUMBERS ONLY, computed by the database. Always use this for counts rather than counting rows yourself.',
    input_schema: {
      type: 'object',
      properties: {
        includeStaleness: { type: 'boolean' },
        includeOwners: { type: 'boolean' }
      },
      additionalProperties: false
    }
  },
  {
    name: 'crm_outreach_metrics',
    description: 'How much outreach happened recently: distinct contacts actually reached in the last N days, split by channel and direction, plus new contacts created. Counts DISTINCT CONTACTS TOUCHED, not number of messages.',
    input_schema: {
      type: 'object',
      properties: {
        sinceDays: { type: 'integer', minimum: 1, maximum: 365 },
        groupBy: { type: 'string', enum: ['none', 'channel', 'direction', 'owner', 'stage'] }
      },
      additionalProperties: false
    }
  }
];

const CRM_WRITE_TOOL = {
  name: 'propose_crm_changes',
  description: 'Stage changes for the admin to review. THIS DOES NOT APPLY ANYTHING — nothing changes until the admin clicks Apply. Call it only when the admin has explicitly told you to make a change, at most once per turn, with every change in one call. Every contactId must come from a tool result earlier in this conversation.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', maxLength: 300, description: 'One sentence the admin will see on the confirm card.' },
      rationale: { type: 'string', maxLength: 600, description: 'Why these specific contacts, including the filter you used.' },
      createTasks: {
        type: 'array', maxItems: CRM_MAX_CONTACTS_PER_PLAN,
        items: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            title: { type: 'string', maxLength: 140 },
            dueInDays: { type: 'integer', minimum: 0, maximum: 180 },
            priority: { type: 'string', enum: ['low', 'normal', 'high'] }
          },
          required: ['contactId', 'title'],
          additionalProperties: false
        }
      },
      tagChanges: {
        type: 'array', maxItems: CRM_MAX_CONTACTS_PER_PLAN,
        items: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            addTags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 5 },
            removeTags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 5 }
          },
          required: ['contactId'],
          additionalProperties: false
        }
      },
      stageChanges: {
        type: 'array', maxItems: 10,
        items: {
          type: 'object',
          properties: {
            contactId: { type: 'string' },
            toStage: { type: 'string', enum: CRM_STAGES },
            reason: { type: 'string', maxLength: 140 }
          },
          required: ['contactId', 'toStage', 'reason'],
          additionalProperties: false
        }
      }
    },
    required: ['summary', 'rationale'],
    additionalProperties: false
  }
};

// ── Tool executors ──────────────────────────────────────────────
//
// Each takes (scope, args, ctx) where `scope` is the company document
// reference. None of them can see `db`. That is the containment boundary:
// there is no path from here to another company's data.

async function execFindContacts(scope, args, ctx) {
  const limit = clampInt(args.limit, 1, CRM_MAX_ROWS_PER_TOOL, 25);
  const stages = Array.isArray(args.stages) ? args.stages.filter((s) => CRM_STAGES.includes(s)) : [];
  const col = scope.collection('contacts');

  // One indexed predicate plus one range; everything else is filtered in
  // memory over a bounded fetch. Adding an index per filter combination would
  // multiply out fast for very little gain.
  let q = col;
  if (args.staleness === 'never') {
    q = q.where('lastContactedAt', '==', null);
  } else {
    let cutoffDays = null;
    if (Number.isFinite(Number(args.contactedBeforeDays))) cutoffDays = clampInt(args.contactedBeforeDays, 0, 3650, 30);
    else if (args.staleness === 'cold') cutoffDays = FRESHNESS_BANDS.stagnant;
    else if (args.staleness === 'stagnant') cutoffDays = FRESHNESS_BANDS.cooling;
    else if (args.staleness === 'cooling') cutoffDays = FRESHNESS_BANDS.warm;

    if (stages.length === 1) q = q.where('stage', '==', stages[0]);
    else if (args.ownerUid) q = q.where('ownerUid', '==', String(args.ownerUid));

    if (cutoffDays !== null) {
      // The lower bound is what excludes never-contacted rows: null sorts
      // before every timestamp, so a bare `<=` would sweep them in and report
      // brand-new leads as the coldest in the book.
      q = q.where('lastContactedAt', '>', new admin.firestore.Timestamp(0, 0))
           .where('lastContactedAt', '<=', daysAgoTs(cutoffDays));
    }
    q = q.orderBy('lastContactedAt', 'asc');
  }

  const snap = await q.limit(CRM_FETCH_CAP).get();
  let rows = snap.docs.map((d) => contactRow(d.id, d.data() || {}));

  if (stages.length) rows = rows.filter((r) => stages.includes(r.stage));
  if (args.ownerUid) rows = rows.filter((r) => r.ownerUid === String(args.ownerUid));
  if (args.staleness === 'warm') rows = rows.filter((r) => r.freshness === 'warm');
  if (Array.isArray(args.tags) && args.tags.length) {
    const want = args.tags.slice(0, 5).map((t) => String(t).toLowerCase());
    rows = rows.filter((r) => r.tags.some((t) => want.includes(String(t).toLowerCase())));
  }
  if (args.query) {
    const needle = String(args.query).toLowerCase();
    rows = rows.filter((r) => [r.name, r.companyName, r.email]
      .some((v) => v && String(v).toLowerCase().includes(needle)));
  }
  if (args.excludeOptedOut === true) rows = rows.filter((r) => !r.optOuts.length);

  const matched = rows.length;
  rows = rows.slice(0, limit);
  rows.forEach((r) => ctx.seenContacts.add(r.contactId));
  return envelope(rows, {
    scanned: snap.size,
    matchedAtLeast: matched,
    note: args.staleness || args.contactedBeforeDays
      ? 'Staleness is based on lastContactedAt (real outreach only), not lastActivityAt.'
      : null
  });
}

async function execContactDetail(scope, args, ctx) {
  const per = clampInt(args.perSectionLimit, 1, 20, 10);
  const contacts = scope.collection('contacts');

  let id = args.contactId ? String(args.contactId) : null;
  let snap = id ? await contacts.doc(id).get() : null;

  if ((!snap || !snap.exists) && args.nameQuery) {
    const needle = String(args.nameQuery).toLowerCase();
    const all = await contacts.limit(CRM_FETCH_CAP).get();
    const hits = all.docs.filter((d) => {
      const c = d.data() || {};
      return [c.name, c.email, c.companyName].some((v) => v && String(v).toLowerCase().includes(needle));
    });
    if (!hits.length) return { error: 'not_found', note: `No contact matches "${args.nameQuery}".` };
    if (hits.length > 1) {
      // Better to ask than to guess which Mike.
      return {
        ambiguous: true,
        candidates: hits.slice(0, 10).map((d) => contactRow(d.id, d.data() || {})),
        note: 'More than one contact matches. Ask the admin which one, or call again with a contactId.'
      };
    }
    snap = hits[0]; id = snap.id;
  }
  if (!snap || !snap.exists) return { error: 'not_found', note: 'Provide a contactId or a nameQuery.' };

  const c = snap.data() || {};
  const ref = contacts.doc(id);
  ctx.seenContacts.add(id);

  const byCreated = (col) => col.orderBy('createdAt', 'desc').limit(per).get().catch(() => null);
  const [emails, notes, activities, calls, messages, tasks, opps] = await Promise.all([
    byCreated(ref.collection('emails')),
    byCreated(ref.collection('notes')),
    byCreated(ref.collection('activities')),
    scope.collection('calls').where('contactId', '==', id).orderBy('createdAt', 'desc').limit(per).get().catch(() => null),
    scope.collection('conversations').doc(id).collection('messages').orderBy('createdAt', 'desc').limit(per).get().catch(() => null),
    scope.collection('tasks').where('contactId', '==', id).limit(per).get().catch(() => null),
    scope.collection('opportunities').where('contactId', '==', id).limit(per).get().catch(() => null)
  ]);

  const map = (s, f) => (s && !s.empty ? s.docs.map((d) => f(d.id, d.data() || {})) : []);
  return {
    contact: contactRow(id, c),
    emails: map(emails, (i, e) => ({ direction: e.direction, subject: snip(e.subject, 140), body: snip(e.bodyText), status: e.status, daysAgo: daysSince(e.createdAt) })),
    texts: map(messages, (i, m) => ({ direction: m.direction, body: snip(m.body, 200), daysAgo: daysSince(m.createdAt) })),
    calls: map(calls, (i, k) => ({ direction: k.direction, disposition: k.disposition || null, durationSec: k.durationSec || 0, note: snip(k.dispositionNote, 200), daysAgo: daysSince(k.createdAt) })),
    notes: map(notes, (i, n) => ({ body: snip(n.body), author: n.authorName || null, daysAgo: daysSince(n.createdAt) })),
    activities: map(activities, (i, a) => ({ type: a.type, description: snip(a.description, 160), actor: a.actorName || null, daysAgo: daysSince(a.createdAt) })),
    tasks: map(tasks, (i, t) => ({ taskId: i, title: snip(t.title, 140), status: t.status, dueInDays: t.dueAt ? -(daysSince(t.dueAt) || 0) : null, priority: t.priority })),
    deals: map(opps, (i, o) => ({ title: snip(o.title, 140), value: o.value || 0, stageId: o.stageId, status: o.status })),
    note: 'Bodies are truncated to 300 characters. Sections cap at ' + per + ' items each.'
  };
}

async function execListTasks(scope, args, ctx) {
  const limit = clampInt(args.limit, 1, CRM_MAX_ROWS_PER_TOOL, 25);
  const status = ['open', 'done', 'any'].includes(args.status) ? args.status : 'open';
  let q = scope.collection('tasks');
  if (status !== 'any') q = q.where('status', '==', status);
  if (args.assigneeUid) q = q.where('assigneeUid', '==', String(args.assigneeUid));
  if (args.contactId) q = q.where('contactId', '==', String(args.contactId));

  const snap = await q.limit(CRM_FETCH_CAP).get();
  const now = Date.now();
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);

  let rows = snap.docs.map((d) => {
    const t = d.data() || {};
    const dueMs = msOf(t.dueAt);
    return {
      taskId: d.id,
      title: snip(t.title, 140),
      contactId: t.contactId || null,
      contactName: t.contactName || null,
      assigneeUid: t.assigneeUid || null,
      status: t.status,
      priority: t.priority || 'normal',
      dueInDays: dueMs === null ? null : Math.round((dueMs - now) / 86400000),
      overdue: dueMs !== null && dueMs < now && t.status !== 'done'
    };
  });

  const counts = {
    overdue: rows.filter((r) => r.overdue).length,
    dueToday: rows.filter((r) => r.dueInDays === 0 && r.status !== 'done').length,
    dueThisWeek: rows.filter((r) => r.dueInDays !== null && r.dueInDays >= 0 && r.dueInDays <= 7 && r.status !== 'done').length,
    noDueDate: rows.filter((r) => r.dueInDays === null && r.status !== 'done').length
  };

  if (args.overdueOnly === true) rows = rows.filter((r) => r.overdue);
  if (Number.isFinite(Number(args.dueWithinDays))) {
    const w = clampInt(args.dueWithinDays, 0, 365, 7);
    rows = rows.filter((r) => r.dueInDays !== null && r.dueInDays <= w);
  }
  rows.sort((a, b) => (a.dueInDays === null ? Infinity : a.dueInDays) - (b.dueInDays === null ? Infinity : b.dueInDays));

  const matched = rows.length;
  rows.forEach((r) => { if (r.contactId) ctx.seenContacts.add(r.contactId); });
  return { ...envelope(rows.slice(0, limit), { scanned: snap.size, matchedAtLeast: matched }), counts };
}

/**
 * Counts, not rows. An LLM tallying 400 rows is unreliable in a way that does
 * not announce itself — "37 stagnant leads" when it is 52 looks exactly as
 * confident as the truth. These come from Firestore count() aggregations, so
 * they are exact regardless of collection size and cost no document reads.
 */
async function execPipelineSnapshot(scope, args, ctx) {
  const contacts = scope.collection('contacts');
  const countOf = async (q) => {
    try { return (await q.count().get()).data().count; } catch (e) { return null; }
  };

  const stageEntries = await Promise.all(
    CRM_STAGES.map(async (s) => [s, await countOf(contacts.where('stage', '==', s))])
  );
  const totalContacts = await countOf(contacts);

  const out = {
    totalContacts,
    contactsByStage: Object.fromEntries(stageEntries),
    exact: true,
    note: 'These are exact database counts. Report them as given; do not re-derive them from row listings.'
  };

  if (args.includeStaleness !== false) {
    const gt0 = contacts.where('lastContactedAt', '>', new admin.firestore.Timestamp(0, 0));
    const [never, warm, cooling, stagnant, cold] = await Promise.all([
      countOf(contacts.where('lastContactedAt', '==', null)),
      countOf(gt0.where('lastContactedAt', '>', daysAgoTs(FRESHNESS_BANDS.warm))),
      countOf(gt0.where('lastContactedAt', '>', daysAgoTs(FRESHNESS_BANDS.cooling)).where('lastContactedAt', '<=', daysAgoTs(FRESHNESS_BANDS.warm))),
      countOf(gt0.where('lastContactedAt', '>', daysAgoTs(FRESHNESS_BANDS.stagnant)).where('lastContactedAt', '<=', daysAgoTs(FRESHNESS_BANDS.cooling))),
      countOf(gt0.where('lastContactedAt', '<=', daysAgoTs(FRESHNESS_BANDS.stagnant)))
    ]);
    out.staleness = { never, warm, cooling, stagnant, cold };
    out.stalenessNote = 'never = nobody has ever made contact, which is different from cold. warm <7d, cooling 7-14d, stagnant 14-30d, cold >30d.';
  }

  const [openTasks, openDeals] = await Promise.all([
    countOf(scope.collection('tasks').where('status', '==', 'open')),
    countOf(scope.collection('opportunities').where('status', '==', 'open'))
  ]);
  out.tasks = { open: openTasks };
  out.deals = { open: openDeals };

  // Deal value needs the documents; bounded, and only when there are few
  // enough that the sum is trustworthy.
  try {
    const deals = await scope.collection('opportunities').where('status', '==', 'open').limit(CRM_FETCH_CAP).get();
    out.deals.openValue = deals.docs.reduce((n, d) => n + (Number((d.data() || {}).value) || 0), 0);
    out.deals.valueExact = deals.size < CRM_FETCH_CAP;
  } catch (e) { /* counts alone still answer most questions */ }

  return out;
}

async function execOutreachMetrics(scope, args, ctx) {
  const days = clampInt(args.sinceDays, 1, 365, 7);
  const cutoff = daysAgoTs(days);
  const contacts = scope.collection('contacts');
  const countOf = async (q) => {
    try { return (await q.count().get()).data().count; } catch (e) { return null; }
  };

  const [touched, created] = await Promise.all([
    countOf(contacts.where('lastContactedAt', '>=', cutoff)),
    countOf(contacts.where('createdAt', '>=', cutoff))
  ]);

  const out = {
    windowDays: days,
    contactsTouched: touched,
    newContacts: created,
    exact: true,
    // Said plainly because it is the difference between the number the admin
    // thinks they asked for and the one they got.
    note: 'lastContactedAt holds only the MOST RECENT contact, so this counts DISTINCT CONTACTS reached in the window, not how many messages were sent. Three emails to one lead count once.'
  };

  const groupBy = args.groupBy;
  if (groupBy && groupBy !== 'none') {
    const snap = await contacts.where('lastContactedAt', '>=', cutoff).limit(CRM_FETCH_CAP).get();
    const buckets = {};
    snap.docs.forEach((d) => {
      const c = d.data() || {};
      const key = groupBy === 'channel' ? (c.lastContactChannel || 'unknown')
        : groupBy === 'direction' ? (c.lastContactDirection || 'unknown')
        : groupBy === 'owner' ? (c.ownerUid || 'unassigned')
        : (c.stage || 'unknown');
      buckets[key] = (buckets[key] || 0) + 1;
    });
    out.groupedBy = groupBy;
    out.groups = buckets;
    out.groupsExact = snap.size < CRM_FETCH_CAP;
    if (!out.groupsExact) out.groupsNote = `Grouping scanned the first ${CRM_FETCH_CAP} and may undercount; contactsTouched above is exact.`;
  }
  return out;
}

// ── Staging writes ──────────────────────────────────────────────
//
// The model never writes. It stages a plan; the admin approves it; a separate
// callable applies it with no LLM in the loop, so the bytes that were approved
// are the bytes that execute. A dry-run-then-execute flag on this same
// callable would re-run the model and could apply a different plan than the
// one previewed.

/** Snap a tag to the company's existing casing, so `Follow-Up` does not grow
 *  up beside `follow-up` and silt the namespace within a week. */
function snapTag(tag, vocabulary) {
  const clean = String(tag || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return null;
  const hit = vocabulary.find((t) => t.toLowerCase() === clean.toLowerCase());
  return hit || clean;
}

/**
 * Which sequences a staged change would set off.
 *
 * This is the part that makes a tag or stage write more than a field edit:
 * onContactWrittenForSequences fires autoEnroll on a stage change or a tag
 * add, and sequence steps send real email and SMS. The admin sees this count
 * before they approve, not afterwards in their sent folder.
 */
async function automationWarnings(scope, { stages = [], tags = [] }) {
  const warnings = [];
  try {
    const snap = await scope.collection('sequences').where('active', '==', true).get();
    snap.docs.forEach((d) => {
      const seq = d.data() || {};
      const trig = seq.trigger || {};
      const steps = Array.isArray(seq.steps) ? seq.steps : [];
      const sends = steps.filter((s) => s.channel === 'email' || s.channel === 'sms');
      if (!steps.length) return;
      const match = (trig.type === 'stage_change' && stages.some((v) => !trig.value || String(trig.value) === String(v)))
        || (trig.type === 'tag_added' && tags.some((v) => !trig.value || String(trig.value).toLowerCase() === String(v).toLowerCase()));
      if (!match) return;
      warnings.push({
        sequenceName: seq.name || d.id,
        triggerType: trig.type,
        triggerValue: trig.value || '(any)',
        totalSteps: steps.length,
        sendingSteps: sends.length,
        sendsEmail: sends.some((s) => s.channel === 'email'),
        sendsSms: sends.some((s) => s.channel === 'sms')
      });
    });
  } catch (e) { console.warn('[crmAssistant] automation scan failed', e && e.message); }
  return warnings;
}

async function execProposeChanges(scope, args, ctx) {
  if (ctx.planStaged) {
    return { error: 'plan_already_staged', note: 'You have already staged a plan this turn. Tell the admin what is waiting instead of staging another.' };
  }

  const rejected = [];
  const clamped = {};
  const items = [];
  const takeList = (v, cap, label) => {
    const list = Array.isArray(v) ? v : [];
    if (list.length > cap) clamped[label] = `truncated from ${list.length} to ${cap} (per-plan cap)`;
    return list.slice(0, cap);
  };

  const wantTasks = takeList(args.createTasks, CRM_MAX_CONTACTS_PER_PLAN, 'createTasks');
  const wantTags = takeList(args.tagChanges, CRM_MAX_CONTACTS_PER_PLAN, 'tagChanges');
  const wantStages = takeList(args.stageChanges, 10, 'stageChanges');

  // Existing tag vocabulary, for casing.
  const vocabulary = [];
  try {
    const sample = await scope.collection('contacts').limit(CRM_FETCH_CAP).get();
    const seen = new Set();
    sample.docs.forEach((d) => (((d.data() || {}).tags) || []).forEach((t) => {
      const k = String(t).toLowerCase();
      if (!seen.has(k)) { seen.add(k); vocabulary.push(String(t)); }
    }));
  } catch (e) { /* casing is a nicety, not a blocker */ }

  const resolve = async (contactId) => {
    const id = String(contactId || '');
    // The model may only act on contacts it actually looked at. This turns a
    // prompt rule into an invariant.
    if (!ctx.seenContacts.has(id)) {
      rejected.push({ contactId: id, reason: 'not retrieved in this conversation — look it up first' });
      return null;
    }
    const snap = await scope.collection('contacts').doc(id).get();
    if (!snap.exists) { rejected.push({ contactId: id, reason: 'contact not found' }); return null; }
    return snap;
  };

  for (const t of wantTasks) {
    const snap = await resolve(t.contactId);
    if (!snap) continue;
    const c = snap.data() || {};
    const dueInDays = clampInt(t.dueInDays, 0, 180, 3);
    items.push({
      kind: 'task',
      contactId: snap.id,
      contactName: c.name || null,
      after: {
        title: snip(t.title, 140) || `Follow up with ${(c.name || 'contact').split(' ')[0]}`,
        // Resolved now, so the date on the confirm card is the real date.
        dueAt: admin.firestore.Timestamp.fromMillis(Date.now() + dueInDays * 86400000),
        dueInDays,
        priority: ['low', 'normal', 'high'].includes(t.priority) ? t.priority : 'normal',
        assigneeUid: c.ownerUid || ctx.uid
      }
    });
  }

  const allAddedTags = [];
  for (const g of wantTags) {
    const snap = await resolve(g.contactId);
    if (!snap) continue;
    const c = snap.data() || {};
    const current = Array.isArray(c.tags) ? c.tags : [];
    const add = (Array.isArray(g.addTags) ? g.addTags : []).slice(0, 5)
      .map((t) => snapTag(t, vocabulary)).filter(Boolean)
      .filter((t) => !current.some((x) => String(x).toLowerCase() === t.toLowerCase()));
    const remove = (Array.isArray(g.removeTags) ? g.removeTags : []).slice(0, 5)
      .map((t) => String(t || '').trim()).filter(Boolean)
      .filter((t) => current.some((x) => String(x).toLowerCase() === t.toLowerCase()));
    if (!add.length && !remove.length) continue;   // no-op, not worth an approval
    allAddedTags.push(...add);
    items.push({ kind: 'tags', contactId: snap.id, contactName: c.name || null, before: { tags: current }, after: { addTags: add, removeTags: remove } });
  }

  const allStages = [];
  for (const sChange of wantStages) {
    const snap = await resolve(sChange.contactId);
    if (!snap) continue;
    const c = snap.data() || {};
    if (c.stage === sChange.toStage) continue;     // no-op churn
    allStages.push(sChange.toStage);
    items.push({
      kind: 'stage',
      contactId: snap.id,
      contactName: c.name || null,
      before: { stage: c.stage || null },
      after: { stage: sChange.toStage, reason: snip(sChange.reason, 140) },
      // Staged and recorded, never applied, while stage writes are shadowed.
      shadowed: !CRM_STAGE_WRITES_ENABLED
    });
  }

  if (!items.length) {
    return { staged: false, rejected, clamped, note: 'Nothing to stage — every proposed change was a no-op or was rejected. Explain that to the admin.' };
  }
  if (items.length > CRM_MAX_ITEMS_PER_PLAN) {
    clamped.items = `truncated from ${items.length} to ${CRM_MAX_ITEMS_PER_PLAN}`;
    items.length = CRM_MAX_ITEMS_PER_PLAN;
  }

  const warnings = await automationWarnings(scope, { stages: allStages, tags: allAddedTags });
  const distinct = new Set(items.map((i) => i.contactId));

  const planRef = scope.collection('aiPlans').doc();
  await planRef.set({
    planId: planRef.id,
    companyId: ctx.companyId,
    createdByUid: ctx.uid,
    createdByName: ctx.actorName,
    conversationId: ctx.conversationId || null,
    userPrompt: snip(ctx.userPrompt, 1000),
    assistantSummary: snip(args.summary, 300),
    assistantRationale: snip(args.rationale, 600),
    model: CRM_MODEL,
    items,
    counts: {
      tasks: items.filter((i) => i.kind === 'task').length,
      tagChanges: items.filter((i) => i.kind === 'tags').length,
      stageChanges: items.filter((i) => i.kind === 'stage').length,
      distinctContacts: distinct.size
    },
    automationWarnings: warnings,
    stageWritesEnabled: CRM_STAGE_WRITES_ENABLED,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + CRM_PLAN_TTL_MS)
  });

  ctx.planStaged = {
    planId: planRef.id,
    summary: snip(args.summary, 300),
    rationale: snip(args.rationale, 600),
    counts: { tasks: items.filter((i) => i.kind === 'task').length, tagChanges: items.filter((i) => i.kind === 'tags').length, stageChanges: items.filter((i) => i.kind === 'stage').length, distinctContacts: distinct.size },
    items: items.map((i) => ({ kind: i.kind, contactId: i.contactId, contactName: i.contactName, before: i.before || null, after: i.after || null, shadowed: !!i.shadowed })),
    automationWarnings: warnings,
    stageWritesEnabled: CRM_STAGE_WRITES_ENABLED,
    expiresAt: Date.now() + CRM_PLAN_TTL_MS
  };

  return {
    staged: true,
    planId: planRef.id,
    status: 'awaiting_admin_approval',
    counts: ctx.planStaged.counts,
    rejected,
    clamped,
    automationWarnings: warnings,
    shadowedStageChanges: CRM_STAGE_WRITES_ENABLED ? 0 : items.filter((i) => i.kind === 'stage').length,
    note: 'NOTHING HAS BEEN CHANGED. The admin must click Apply. Tell them what is waiting for approval, in the present tense — never say "done", "created" or "updated". Do not call this tool again this turn.'
      + (CRM_STAGE_WRITES_ENABLED ? '' : ' Stage changes are recorded for review but will NOT be applied; say so plainly if you staged any.')
  };
}

// ── The system prompt ───────────────────────────────────────────
//
// A separate prompt in a separate function, not a branch of the member
// chatbot's. courseAdvisorChat's prompt carries "You never share other
// members' data", and an admin branch would mean conditionally deleting a
// security rule based on a runtime boolean — the shape that fails open when
// the boolean is wrong. Two doors, two locks.

function crmAssistantSystemPrompt({ companyName, adminName, writesAllowed }) {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are a CRM analyst for ${companyName}. You are speaking with ${adminName}, a verified admin of this company who is entitled to see every contact record in it.`,
    `Today is ${today}.`,
    '',
    'SCOPE',
    '- Every tool is permanently scoped to this one company. You cannot query any other company and must never claim to have done so.',
    '- If a tool result says arguments were ignored, that is expected; carry on.',
    '',
    'THE TWO RECENCY FIELDS — do not conflate them',
    '- lastContactedAt (what "staleness", "stagnant" and "days since contact" mean here) moves ONLY on real outreach: an email, a text, a connected call, or a logged call/meeting. It is the honest one.',
    '- lastActivityAt moves whenever the RECORD is touched — a tag edit, a stage change, a field save, a CSV import. A lead can have recent activity and have gone months without anyone speaking to them. Never describe lastActivityAt as contact.',
    '- Bands: warm under 7 days, cooling 7-14, stagnant 14-30, cold over 30. "Never contacted" is its own state, not cold — a lead that arrived this morning has not been neglected.',
    '',
    'COUNTS',
    '- For any "how many", distribution or audit question, call crm_pipeline_snapshot or crm_outreach_metrics. They return exact database counts.',
    '- Never count rows from crm_find_contacts and present that as a total. That tool tells you WHICH, not HOW MANY.',
    '- When a result has truncated: true, say "at least N" and offer to narrow. Never present a capped list as complete.',
    '',
    'HONESTY',
    '- Never invent a contact, a number, a date or a quote. Everything you state comes from a tool result.',
    '- If a tool returns nothing, say so plainly rather than hedging.',
    '- If a tool fails, say what you could not check.',
    '',
    'OUTREACH ETIQUETTE',
    '- Respect opt-outs. Never suggest emailing someone whose optOuts include email, texting one who opted out of SMS, or calling one marked do-not-call. Flag them as reachable by other channels only.',
    '',
    'STYLE',
    '- Short and scannable. Lead with the answer. Names, days since contact, and the next action.',
    '- Use "- " bullets for lists. No preamble, no restating the question.',
    writesAllowed ? [
      '',
      'CHANGES — you stage, you do not apply',
      '- propose_crm_changes stages a plan for the admin to approve. It changes nothing by itself.',
      '- Call it ONLY when the admin has explicitly told you to change something in this turn. "Create follow-up tasks for those people" is an instruction. "Who should I follow up with?", "what is overdue?", "audit my pipeline", "these look dead" are questions and observations — answer them with words only.',
      '- Your own analysis is never authorization. Finding 30 stagnant leads does not authorize creating 30 tasks.',
      '- Never bundle changes that were not asked for. Asked for tasks means tasks, not tasks plus retagging.',
      '- If the scope is ambiguous ("clean up the old leads"), ask which contacts and which change instead of staging. One question is cheaper than a wrong plan.',
      '- Suggesting is encouraged: "I can create follow-up tasks for these 12 — want me to?" Staging unasked is not.',
      '- At most one call per turn, with every change in it.',
      '- Every contactId must come from a tool result in this conversation.',
      '- After staging, say what is waiting for approval and that nothing has changed yet. Never say "done", "created", "updated", "I have moved" or any past-tense completion about a staged plan.',
      '- A stage change can trigger automated email and SMS sequences. Only stage one when the admin named the stage, and never infer "lost" from inactivity — a quiet lead is not a dead one.'
    ].join('\n') : [
      '',
      'CHANGES',
      '- You have no ability to change anything. If asked to, say so and describe what you would do.'
    ].join('\n')
  ].join('\n');
}

/**
 * Does this turn look like an instruction to change something?
 *
 * The cheapest guardrail against an unasked-for plan is not offering the tool
 * at all. A false negative is a mild annoyance (the admin rephrases); a false
 * positive is a confirmation card nobody asked for, so this errs toward
 * excluding the tool.
 */
function looksLikeChangeRequest(message, previousAssistantText) {
  const m = String(message || '').toLowerCase();
  const verb = /\b(create|add|make|set|assign|tag|untag|remove|move|mark|change|update|schedule|stage|apply|do it|go ahead|yes please)\b/.test(m);
  const objectish = /\b(task|tasks|follow[- ]?up|follow[- ]?ups|tag|tags|stage|reminder|them|these|those|it)\b/.test(m);
  if (verb && objectish) return true;
  // "yes" / "go ahead" only counts as an instruction if we just offered.
  if (/^(yes|yep|yeah|do it|go ahead|please do|sounds good|ok|okay)\b/.test(m.trim())) {
    return /\b(want me to|shall i|should i|i can)\b/.test(String(previousAssistantText || '').toLowerCase());
  }
  return false;
}

/**
 * Client history, sanitized.
 *
 * The browser sends conversation history. A history from company A replayed
 * against company B's callable would put A's rows into B's context, so tool
 * blocks are stripped and only plain text is replayed — row data never
 * round-trips through the browser at all.
 */
const BUDGET_NOTICE = 'Tool budget reached. Answer now from what you already have, and say plainly what you were not able to check.';

/**
 * Append the out-of-budget notice without creating two consecutive user turns.
 *
 * The last message at this point is normally a user turn carrying tool
 * results, so pushing a second user message beside it would be a malformed
 * conversation. Fold the notice into that turn instead.
 */
function withBudgetNotice(messages) {
  const out = messages.slice();
  const last = out[out.length - 1];
  if (last && last.role === 'user' && Array.isArray(last.content)) {
    out[out.length - 1] = { role: 'user', content: [...last.content, { type: 'text', text: BUDGET_NOTICE }] };
    return out;
  }
  if (last && last.role === 'user') {
    out[out.length - 1] = { role: 'user', content: `${last.content}\n\n${BUDGET_NOTICE}` };
    return out;
  }
  out.push({ role: 'user', content: BUDGET_NOTICE });
  return out;
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const h of history.slice(-20)) {
    const role = h && h.role === 'assistant' ? 'assistant' : 'user';
    let text = '';
    if (typeof (h && h.content) === 'string') text = h.content;
    else if (Array.isArray(h && h.content)) {
      text = h.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
    }
    text = String(text || '').slice(0, 4000).trim();
    if (text) out.push({ role, content: text });
  }
  // The API requires the first message to be from the user.
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// ── crmAssistantChat ────────────────────────────────────────────

exports.crmAssistantChat = onCall(
  { secrets: [anthropicKey], timeoutSeconds: 300, memory: '512MiB' },
  async (request) => {
    const db = admin.firestore();
    const data = request.data || {};
    const companyId = String(data.companyId || '').trim();
    const message = String(data.message || '').trim();
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');
    if (!message) throw new HttpsError('invalid-argument', 'A message is required.');
    if (message.length > 4000) throw new HttpsError('invalid-argument', 'Message is too long.');

    // assertCompanyAdmin, not isAdminCaller: the latter is true for a platform
    // admin of ANY company and returns no companyId, which would make this a
    // cross-tenant endpoint.
    const { uid, company } = await assertCompanyAdmin(db, companyId, request);

    // Two limiters. The per-admin one does not stop five admins in one company
    // burning the budget together, and this endpoint can spend real money per
    // call.
    await rateLimitCaller(db, request, { action: 'crmAssistantChat', max: 15, windowSec: 600 });
    await enforceRateLimit(db, { action: 'crmAssistantChat:company', key: 'co:' + companyId, max: 60, windowSec: 3600 });

    let actorName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || null;
    if (!actorName) {
      try {
        const u = await db.collection('users').doc(uid).get();
        if (u.exists) actorName = u.data().displayName || u.data().email || null;
      } catch (e) {}
    }
    actorName = actorName || 'Admin';

    const scope = db.collection('companies').doc(companyId);
    const history = sanitizeHistory(data.history);
    const lastAssistant = [...history].reverse().find((h) => h.role === 'assistant');
    const writesAllowed = looksLikeChangeRequest(message, lastAssistant && lastAssistant.content);

    const ctx = {
      uid,
      companyId,
      actorName,
      userPrompt: message,
      conversationId: data.conversationId || null,
      // Every contact the model has actually looked at. A staged change may
      // only touch one of these — the prompt says so, this enforces it.
      seenContacts: new Set(),
      planStaged: null,
      rowsUsed: 0
    };

    const EXECUTORS = {
      crm_find_contacts: execFindContacts,
      crm_contact_detail: execContactDetail,
      crm_list_tasks: execListTasks,
      crm_pipeline_snapshot: execPipelineSnapshot,
      crm_outreach_metrics: execOutreachMetrics,
      propose_crm_changes: execProposeChanges
    };

    const tools = writesAllowed ? [...CRM_READ_TOOLS, CRM_WRITE_TOOL] : CRM_READ_TOOLS.slice();
    // A stable prefix across every iteration, cached so iterations 2+ do not
    // re-pay for the tool definitions and the system prompt.
    const systemBlocks = [{
      type: 'text',
      text: crmAssistantSystemPrompt({ companyName: (company && company.name) || 'this company', adminName: actorName, writesAllowed }),
      cache_control: { type: 'ephemeral' }
    }];

    const client = getAnthropicClient();
    const messages = [...history, { role: 'user', content: message }];
    const toolTrace = [];
    const calledSignatures = new Set();
    const deadline = Date.now() + CRM_SOFT_DEADLINE_MS;

    let iterations = 0;
    let complete = true;
    let response = null;

    while (true) {
      iterations++;
      const outOfBudget = iterations > CRM_MAX_ITERATIONS
        || toolTrace.length >= CRM_MAX_TOOL_CALLS
        || Date.now() > deadline - 45000;

      try {
        response = await client.messages.create({
          model: CRM_MODEL,
          max_tokens: 4096,
          thinking: crmThinkingConfig(CRM_MODEL),
          system: systemBlocks,
          tools,
          // Out of budget: one last call with tools switched off, so the admin
          // gets an honest partial answer rather than a 504 or an empty reply.
          ...(outOfBudget ? { tool_choice: { type: 'none' } } : {}),
          messages: outOfBudget ? withBudgetNotice(messages) : messages
        });
      } catch (err) {
        const status = err && err.status;
        console.error('[crmAssistant] model call failed', status, err && err.message);
        if (status === 429 || (status >= 500 && status < 600)) {
          throw new HttpsError('unavailable', 'The assistant is busy right now. Try again in a moment.');
        }
        throw new HttpsError('internal', 'The assistant could not complete that request.');
      }

      if (outOfBudget) { complete = false; break; }
      if (response.stop_reason !== 'tool_use') break;

      // Push the assistant turn WHOLE — thinking blocks included. Dropping or
      // reordering them breaks the next request on a thinking-enabled model.
      messages.push({ role: 'assistant', content: response.content });

      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      const results = [];
      for (const use of toolUses) {
        const signature = use.name + ':' + JSON.stringify(use.input || {});
        let payload;
        if (calledSignatures.has(signature)) {
          // Cheap and very effective against a model stuck in a loop.
          payload = { error: 'duplicate_call', note: 'You already called this tool with these exact arguments. The previous result stands — answer now, or call a different tool.' };
        } else if (ctx.rowsUsed >= CRM_MAX_TOTAL_ROWS) {
          payload = { error: 'row_budget_exhausted', rowsUsed: ctx.rowsUsed, note: 'You have pulled enough rows for one answer. Summarize what you have.' };
        } else {
          calledSignatures.add(signature);
          const exec = EXECUTORS[use.name];
          try {
            payload = exec
              ? await exec(scope, use.input || {}, ctx)
              : { error: 'unknown_tool' };
            if (payload && Array.isArray(payload.rows)) ctx.rowsUsed += payload.rows.length;
          } catch (e) {
            // A raw Firestore index error embeds a console URL we do not want
            // surfacing in a chat reply.
            const raw = String((e && e.message) || e);
            console.error('[crmAssistant] tool failed', use.name, raw);
            payload = {
              error: 'tool_failed',
              note: /index/i.test(raw)
                ? 'That query is not available yet (a database index is still building). Say so and try a different angle.'
                : 'That lookup failed. Say what you could not check.'
            };
          }
        }
        toolTrace.push({ name: use.name, input: use.input || {}, rows: (payload && payload.rows && payload.rows.length) || null, error: (payload && payload.error) || null });
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(payload), ...(payload && payload.error ? { is_error: true } : {}) });
      }
      // All results in ONE user message — splitting them teaches the model to
      // stop making parallel calls.
      messages.push({ role: 'user', content: results });
    }

    let reply = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!reply) reply = 'I could not put an answer together for that. Try rephrasing, or ask me something narrower.';

    if (ctx.planStaged) {
      try {
        await scope.collection('aiPlans').doc(ctx.planStaged.planId).set({ toolTrace }, { merge: true });
      } catch (e) {}
    }

    const usage = response.usage || {};
    console.log('[crmAssistant]', JSON.stringify({
      companyId, uid, iterations, tools: toolTrace.length,
      in: usage.input_tokens, out: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens, complete
    }));

    return {
      reply,
      complete,
      plan: ctx.planStaged,
      toolCalls: toolTrace.map((t) => ({ name: t.name, rows: t.rows, error: t.error })),
      iterations
    };
  }
);

// ── crmAssistantApply ───────────────────────────────────────────
//
// Deterministic. No model in this path: the plan the admin approved is the
// plan that executes, byte for byte.

exports.crmAssistantApply = onCall({ timeoutSeconds: 120 }, async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const companyId = String(data.companyId || '').trim();
  const planId = String(data.planId || '').trim();
  const runAutomations = data.runAutomations !== false;   // default on, as the CRM normally behaves
  if (!companyId || !planId) throw new HttpsError('invalid-argument', 'companyId and planId are required.');

  const { uid, isOwner } = await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'crmAssistantApply', max: 10, windowSec: 600 });

  const scope = db.collection('companies').doc(companyId);
  const planRef = scope.collection('aiPlans').doc(planId);
  const FV = admin.firestore.FieldValue;

  // Claim the plan transactionally. This is the double-click and retry gate:
  // anything not 'pending' has already been handled.
  const plan = await db.runTransaction(async (tx) => {
    const snap = await tx.get(planRef);
    if (!snap.exists) throw new HttpsError('not-found', 'That plan no longer exists.');
    const p = snap.data();
    if (p.status === 'applied') throw new HttpsError('failed-precondition', 'That plan has already been applied.');
    if (p.status !== 'pending') throw new HttpsError('failed-precondition', `That plan is ${p.status}.`);
    if (p.createdByUid !== uid && !isOwner) {
      throw new HttpsError('permission-denied', 'Only the admin who staged this plan can apply it.');
    }
    const expires = msOf(p.expiresAt);
    if (expires && expires < Date.now()) {
      tx.set(planRef, { status: 'expired' }, { merge: true });
      throw new HttpsError('failed-precondition', 'That plan expired. Ask again and I will restage it.');
    }
    tx.set(planRef, { status: 'applying', appliedByUid: uid }, { merge: true });
    return p;
  });

  // Daily blast-radius counter. Unlike the read limiter this fails CLOSED: a
  // read that fails open costs money, a write that fails open costs data.
  const distinct = new Set((plan.items || []).map((i) => i.contactId));
  const dayKey = new Date().toISOString().slice(0, 10);
  const usageRef = scope.collection('aiUsage').doc(dayKey);
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const used = (snap.exists && Number(snap.data().contactsWritten)) || 0;
      if (used + distinct.size > CRM_MAX_CONTACTS_PER_DAY) {
        throw new HttpsError('resource-exhausted',
          `Daily limit reached: the assistant may change at most ${CRM_MAX_CONTACTS_PER_DAY} contacts per day. Make this change manually or wait until tomorrow.`);
      }
      tx.set(usageRef, { contactsWritten: used + distinct.size, updatedAt: FV.serverTimestamp() }, { merge: true });
    });
  } catch (e) {
    await planRef.set({ status: 'pending' }, { merge: true });
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('unavailable', 'Could not reserve the daily change budget; nothing was applied.');
  }

  let actorName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || 'Admin';
  const byLine = `${actorName} via CRM Assistant`;
  const results = [];

  for (let idx = 0; idx < (plan.items || []).length; idx++) {
    const item = plan.items[idx];
    const cRef = scope.collection('contacts').doc(item.contactId);
    const baseMeta = {
      source: 'ai_assistant',
      planId,
      itemIndex: idx,
      model: plan.model || CRM_MODEL,
      userPrompt: snip(plan.userPrompt, 500),
      assistantRationale: snip(plan.assistantRationale, 300),
      conversationId: plan.conversationId || null
    };
    try {
      if (item.kind === 'stage' && !CRM_STAGE_WRITES_ENABLED) {
        results.push({ idx, kind: 'stage', status: 'shadowed', note: 'Recorded for review; stage writes are not enabled.' });
        continue;
      }

      const snap = await cRef.get();
      if (!snap.exists) { results.push({ idx, kind: item.kind, status: 'skipped', reason: 'contact_deleted' }); continue; }
      const c = snap.data() || {};

      if (item.kind === 'task') {
        const taskRef = scope.collection('tasks').doc();
        await taskRef.set({
          title: item.after.title,
          contactId: item.contactId,
          contactName: item.contactName || null,
          opportunityId: null,
          assigneeUid: item.after.assigneeUid || uid,
          dueAt: item.after.dueAt || null,
          status: 'open',
          priority: item.after.priority || 'normal',
          completedAt: null, completedByUid: null, remindedAt: null,
          createdAt: FV.serverTimestamp(), updatedAt: FV.serverTimestamp(),
          createdBy: uid, createdVia: 'ai_assistant', planId
        });
        await cRef.collection('activities').add({
          type: 'task_created',
          description: `Task: ${item.after.title}`,
          // The approving human owns this, not 'system'. They clicked Apply.
          actorUid: uid, actorName: byLine,
          createdAt: FV.serverTimestamp(),
          meta: { ...baseMeta, taskId: taskRef.id }
        });
        results.push({ idx, kind: 'task', status: 'applied', taskId: taskRef.id });
        continue;
      }

      if (item.kind === 'tags') {
        // Drift check: the admin approved a diff from a specific starting state.
        const current = Array.isArray(c.tags) ? c.tags : [];
        const add = (item.after.addTags || []).filter((t) => !current.some((x) => String(x).toLowerCase() === String(t).toLowerCase()));
        const remove = (item.after.removeTags || []).filter((t) => current.some((x) => String(x).toLowerCase() === String(t).toLowerCase()));
        if (!add.length && !remove.length) { results.push({ idx, kind: 'tags', status: 'skipped', reason: 'already_applied' }); continue; }
        const next = current.filter((t) => !remove.some((r) => String(r).toLowerCase() === String(t).toLowerCase())).concat(add);
        const patch = { tags: next, updatedAt: FV.serverTimestamp() };
        // Suppression flag read by onContactWrittenForSequences.
        if (!runAutomations) patch._automationSuppressed = true;
        await cRef.set(patch, { merge: true });
        if (!runAutomations) {
          await cRef.set({ _automationSuppressed: FV.delete() }, { merge: true }).catch(() => {});
        }
        for (const t of add) {
          await cRef.collection('activities').add({
            type: 'tag_added', description: `Tag added: ${t}`,
            actorUid: uid, actorName: byLine, createdAt: FV.serverTimestamp(),
            meta: { ...baseMeta, tag: t, before: { tags: current }, automationsSuppressed: !runAutomations }
          });
        }
        for (const t of remove) {
          await cRef.collection('activities').add({
            type: 'tag_removed', description: `Tag removed: ${t}`,
            actorUid: uid, actorName: byLine, createdAt: FV.serverTimestamp(),
            meta: { ...baseMeta, tag: t, before: { tags: current } }
          });
        }
        results.push({ idx, kind: 'tags', status: 'applied', added: add, removed: remove, before: current });
        continue;
      }

      if (item.kind === 'stage') {
        if (c.stage !== (item.before && item.before.stage)) {
          results.push({ idx, kind: 'stage', status: 'skipped', reason: 'changed_since_preview', now: c.stage, expected: item.before && item.before.stage });
          continue;
        }
        const patch = { stage: item.after.stage, updatedAt: FV.serverTimestamp() };
        if (!runAutomations) patch._automationSuppressed = true;
        await cRef.set(patch, { merge: true });
        if (!runAutomations) await cRef.set({ _automationSuppressed: FV.delete() }, { merge: true }).catch(() => {});
        await cRef.collection('activities').add({
          type: 'stage_changed',
          description: `Stage: ${item.before.stage || '—'} → ${item.after.stage}`,
          actorUid: uid, actorName: byLine, createdAt: FV.serverTimestamp(),
          meta: { ...baseMeta, from: item.before.stage || null, to: item.after.stage, reason: item.after.reason, automationsSuppressed: !runAutomations }
        });
        results.push({ idx, kind: 'stage', status: 'applied', from: item.before.stage, to: item.after.stage });
      }
    } catch (e) {
      console.error('[crmAssistantApply] item failed', idx, e && e.message);
      results.push({ idx, kind: item.kind, status: 'failed', reason: (e && e.message) || 'unknown' });
    }
  }

  const applied = results.filter((r) => r.status === 'applied').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  await planRef.set({
    status: failed ? 'partially_applied' : 'applied',
    appliedAt: FV.serverTimestamp(),
    appliedByUid: uid,
    runAutomations,
    results,
    // Keep the applied plan around as the revert record.
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 90 * 86400000)
  }, { merge: true });

  return { ok: true, applied, failed, results, revertible: applied > 0 };
});

// ── crmAssistantRevert ──────────────────────────────────────────
//
// What makes write access survivable. Restores the recorded before-state, and
// is honest that a sent email cannot be unsent.

exports.crmAssistantRevert = onCall({ timeoutSeconds: 120 }, async (request) => {
  const db = admin.firestore();
  const companyId = String((request.data || {}).companyId || '').trim();
  const planId = String((request.data || {}).planId || '').trim();
  if (!companyId || !planId) throw new HttpsError('invalid-argument', 'companyId and planId are required.');

  const { uid, isOwner } = await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'crmAssistantRevert', max: 10, windowSec: 600 });

  const scope = db.collection('companies').doc(companyId);
  const planRef = scope.collection('aiPlans').doc(planId);
  const snap = await planRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That plan no longer exists.');
  const plan = snap.data();
  if (!['applied', 'partially_applied'].includes(plan.status)) {
    throw new HttpsError('failed-precondition', `Nothing to revert — that plan is ${plan.status}.`);
  }
  if (plan.createdByUid !== uid && plan.appliedByUid !== uid && !isOwner) {
    throw new HttpsError('permission-denied', 'Only the admin who applied this plan can revert it.');
  }
  const appliedMs = msOf(plan.appliedAt);
  if (appliedMs && Date.now() - appliedMs > 7 * 86400000) {
    throw new HttpsError('failed-precondition', 'That plan is more than a week old; revert it by hand so the change is deliberate.');
  }

  const FV = admin.firestore.FieldValue;
  let actorName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || 'Admin';
  const byLine = `${actorName} via CRM Assistant (revert)`;
  const out = [];

  for (const r of (plan.results || [])) {
    if (r.status !== 'applied') continue;
    const item = (plan.items || [])[r.idx];
    if (!item) continue;
    const cRef = scope.collection('contacts').doc(item.contactId);
    const meta = { source: 'ai_revert', revertsPlanId: planId, itemIndex: r.idx };
    try {
      if (r.kind === 'task' && r.taskId) {
        const tRef = scope.collection('tasks').doc(r.taskId);
        const t = await tRef.get();
        if (!t.exists) { out.push({ idx: r.idx, status: 'skipped', reason: 'already_deleted' }); continue; }
        if ((t.data() || {}).status === 'done') { out.push({ idx: r.idx, status: 'kept', reason: 'already_completed' }); continue; }
        await tRef.delete();
        out.push({ idx: r.idx, status: 'reverted', kind: 'task' });
        continue;
      }
      if (r.kind === 'tags') {
        // Inverse delta, not a whole-array restore — restoring the snapshot
        // would clobber tags someone else added in the meantime.
        const cur = await cRef.get();
        if (!cur.exists) { out.push({ idx: r.idx, status: 'skipped', reason: 'contact_deleted' }); continue; }
        const now = Array.isArray((cur.data() || {}).tags) ? cur.data().tags : [];
        const next = now
          .filter((t) => !(r.added || []).some((a) => String(a).toLowerCase() === String(t).toLowerCase()))
          .concat((r.removed || []).filter((t) => !now.some((x) => String(x).toLowerCase() === String(t).toLowerCase())));
        await cRef.set({ tags: next, _automationSuppressed: true, updatedAt: FV.serverTimestamp() }, { merge: true });
        await cRef.set({ _automationSuppressed: FV.delete() }, { merge: true }).catch(() => {});
        await cRef.collection('activities').add({
          type: 'tag_removed', description: 'AI tag change reverted',
          actorUid: uid, actorName: byLine, createdAt: FV.serverTimestamp(), meta
        });
        out.push({ idx: r.idx, status: 'reverted', kind: 'tags' });
        continue;
      }
      if (r.kind === 'stage') {
        const cur = await cRef.get();
        if (!cur.exists) { out.push({ idx: r.idx, status: 'skipped', reason: 'contact_deleted' }); continue; }
        if ((cur.data() || {}).stage !== r.to) { out.push({ idx: r.idx, status: 'skipped', reason: 'changed_since' }); continue; }
        await cRef.set({ stage: r.from, _automationSuppressed: true, updatedAt: FV.serverTimestamp() }, { merge: true });
        await cRef.set({ _automationSuppressed: FV.delete() }, { merge: true }).catch(() => {});
        await cRef.collection('activities').add({
          type: 'stage_changed', description: `Stage reverted: ${r.to} → ${r.from}`,
          actorUid: uid, actorName: byLine, createdAt: FV.serverTimestamp(),
          meta: { ...meta, from: r.to, to: r.from }
        });
        out.push({ idx: r.idx, status: 'reverted', kind: 'stage' });
      }
    } catch (e) {
      out.push({ idx: r.idx, status: 'failed', reason: (e && e.message) || 'unknown' });
    }
  }

  // Stop anything the original change set running. Delivered mail cannot be
  // recalled, and the caller is told so rather than left to assume.
  let stoppedEnrollments = 0;
  try {
    for (const cid of new Set((plan.items || []).map((i) => i.contactId))) {
      const en = await scope.collection('enrollments').where('contactId', '==', cid).where('status', '==', 'active').get();
      for (const d of en.docs) {
        const started = msOf(d.data().startedAt) || msOf(d.data().createdAt);
        if (appliedMs && started && started >= appliedMs) {
          await d.ref.set({ status: 'stopped', stoppedReason: 'AI change reverted', stoppedAt: FV.serverTimestamp() }, { merge: true });
          stoppedEnrollments++;
        }
      }
    }
  } catch (e) { console.warn('[crmAssistantRevert] enrollment stop failed', e && e.message); }

  await planRef.set({ status: 'reverted', revertedAt: FV.serverTimestamp(), revertedByUid: uid, revertResults: out }, { merge: true });

  return {
    ok: true,
    reverted: out.filter((r) => r.status === 'reverted').length,
    results: out,
    stoppedEnrollments,
    note: stoppedEnrollments
      ? `Stopped ${stoppedEnrollments} sequence enrolment(s). Any email or SMS already delivered cannot be recalled.`
      : null
  };
});


function getAnthropicClient() {
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    throw new HttpsError('internal', 'Anthropic SDK not available.');
  }
  const apiKey = ANTHROPIC_API_KEY();
  if (!apiKey) {
    throw new HttpsError('failed-precondition',
      'ANTHROPIC_API_KEY is not configured. Create it in Secret Manager (Google Cloud Console > Security > Secret Manager) and redeploy.');
  }
  return new Anthropic.default({ apiKey });
}

// Claude is told to answer with ONLY JSON, but be tolerant of markdown
// fences and stray prose around the object.
function extractJson(text) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new HttpsError('internal', 'AI returned malformed JSON — please try again.');
  }
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    throw new HttpsError('internal', 'AI returned malformed JSON — please try again.');
  }
}

const clampStr = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

exports.generateCourseOutline = onCall({ timeoutSeconds: 300, secrets: [anthropicKey] }, async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  await rateLimitCaller(db, request, { action: 'generateCourse', max: 30, windowSec: 3600 });

  const topic = clampStr(request.data && request.data.topic, 2000);
  if (!topic) throw new HttpsError('invalid-argument', 'topic is required.');
  const audience = clampStr(request.data && request.data.audience, 500);
  const notes = clampStr(request.data && request.data.notes, 2000);
  const source = clampStr(request.data && request.data.source, 80000);
  let lessonCount = parseInt(request.data && request.data.lessonCount, 10);
  if (!Number.isFinite(lessonCount)) lessonCount = 5;
  lessonCount = Math.max(1, Math.min(12, lessonCount));

  const system = [
    'You design online courses for The One Percent Academy, a personal-growth and',
    'leadership platform focused on mindset, discipline, and self-mastery.',
    'You respond with ONLY a valid JSON object — no prose, no markdown fences.',
    'Schema:',
    '{',
    '  "title": "course title (max 70 chars)",',
    '  "short": "very short display name (max 20 chars)",',
    '  "subtitle": "one-line tagline",',
    '  "category": "e.g. Mindset & Personal Growth",',
    '  "description": ["2-4 sales-page paragraphs"],',
    '  "whatYoullLearn": ["4-6 concrete outcomes"],',
    '  "lessons": [',
    '    { "title": "lesson title", "subtitle": "one line",',
    '      "pillar": "section label like \'Part 1 — Foundations\'",',
    '      "duration": "estimate like \'15 min\'", "tagLabel": "LESSON",',
    '      "brief": "2-3 sentences specifying exactly what this lesson must cover" }',
    '  ]',
    '}',
    `The lessons array must contain exactly ${lessonCount} lessons that build on`,
    'each other in a logical arc. Group lessons into 2-3 pillars when it helps.',
    'When the creator provides reference material, base the course structure and',
    'lesson briefs on it — use its concepts, terminology, and examples.'
  ].join('\n');

  const user = [
    `Course topic / description: ${topic}`,
    audience ? `Target audience: ${audience}` : '',
    notes ? `Additional notes from the course creator: ${notes}` : '',
    source ? `Reference material from the course creator (manuscripts/notes to base the course on):\n"""\n${source}\n"""` : ''
  ].filter(Boolean).join('\n');

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 3000,
    system,
    messages: [{ role: 'user', content: user }]
  });

  const outline = extractJson(
    (response.content && response.content[0] && response.content[0].text) || '');
  if (!Array.isArray(outline.lessons) || !outline.lessons.length) {
    throw new HttpsError('internal', 'AI outline had no lessons — please try again.');
  }
  return { outline };
});

exports.generateCourseLesson = onCall({ timeoutSeconds: 300, secrets: [anthropicKey] }, async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  await rateLimitCaller(db, request, { action: 'generateCourseLesson', max: 60, windowSec: 3600 });

  const d = request.data || {};
  const lessonTitle = clampStr(d.lessonTitle, 200);
  if (!lessonTitle) throw new HttpsError('invalid-argument', 'lessonTitle is required.');
  const courseTitle = clampStr(d.courseTitle, 200);
  const audience = clampStr(d.audience, 500);
  const lessonSubtitle = clampStr(d.lessonSubtitle, 300);
  const brief = clampStr(d.brief, 2000);
  const lessonNumber = parseInt(d.lessonNumber, 10) || 1;
  const totalLessons = parseInt(d.totalLessons, 10) || 1;
  const outlineTitles = (Array.isArray(d.outlineTitles) ? d.outlineTitles : [])
    .slice(0, 12).map((t) => clampStr(t, 200));
  const source = clampStr(d.source, 80000);

  const system = [
    'You write full lessons for online courses on The One Percent Academy, a',
    'personal-growth and leadership platform. Write with energy and directness;',
    'be practical and specific, never generic filler.',
    'You respond with ONLY a valid JSON object — no prose, no markdown fences.',
    'Schema:',
    '{',
    '  "html": "the complete lesson body as HTML",',
    '  "workbook": { "reflection": "one reflection prompt", "action": "one action prompt",',
    '                "prompts": ["2-4 writing prompts"] } or null,',
    '  "summary": ["3-5 key takeaways"] or null',
    '}',
    'The html field: 600-1000 words using ONLY these tags: <h2>, <h3>, <p>,',
    '<ul>, <ol>, <li>, <blockquote>, <strong>, <em>. No images, iframes,',
    'scripts, styles, or classes. Escape the HTML properly inside the JSON string.',
    'When the creator provides reference material, ground the lesson in it —',
    'draw on its concepts, terminology, stories, and examples rather than inventing your own.'
  ].join('\n');

  const user = [
    courseTitle ? `Course: ${courseTitle}` : '',
    audience ? `Audience: ${audience}` : '',
    outlineTitles.length ? `Full course outline:\n${outlineTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : '',
    `Write lesson ${lessonNumber} of ${totalLessons}: "${lessonTitle}"`,
    lessonSubtitle ? `Lesson subtitle: ${lessonSubtitle}` : '',
    brief ? `This lesson must cover: ${brief}` : '',
    source ? `Reference material from the course creator (base the lesson on this):\n"""\n${source}\n"""` : ''
  ].filter(Boolean).join('\n');

  const client = getAnthropicClient();
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 6000,
    system,
    messages: [{ role: 'user', content: user }]
  });

  const lesson = extractJson(
    (response.content && response.content[0] && response.content[0].text) || '');
  if (!lesson.html || typeof lesson.html !== 'string') {
    throw new HttpsError('internal', 'AI lesson had no content — please try again.');
  }
  return { lesson };
});

// ════════════════════════════════════════════════════════════════
// 1P Certification (Life Coach) — server-gated credentialing.
//
// The credential is a certification; the annual IP usage right is the
// license. Everything that decides whether someone is certified lives
// behind these callables and Admin-SDK-only records, because progress
// and certificates under users/{uid} are self-writable by design:
//   - examBank/{slug}/questions      admin-only (answers never client-readable)
//   - users/{uid}/examAttempts       Admin SDK writes; member reads own
//   - users/{uid}/coachingHours      member submits; server approves
//   - users/{uid}/capstone           member submits URL; server reviews
//   - certifications/{uid}_{slug}    Admin SDK writes; member reads own
// ════════════════════════════════════════════════════════════════

const CERT_CONFIG_DEFAULTS = {
  passingScorePercent: 80,
  maxExamAttempts: 3,
  requiredHours: 25,          // minimum logged + approved practice coaching hours
  examQuestionCount: 25,
  renewalHours: 10,           // approved hours since last issuance/renewal
  renewalCeCredits: 10        // approved CE credits since last issuance/renewal
};

async function loadCertConfig(db) {
  try {
    const snap = await db.collection('config').doc('certification').get();
    return { ...CERT_CONFIG_DEFAULTS, ...(snap.exists ? snap.data() : {}) };
  } catch (e) {
    return { ...CERT_CONFIG_DEFAULTS };
  }
}

// Same FNV-1a derivation as public/js/certificate.js so the printed sheet and
// the server record always carry the same number.
function certHash36(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

function certNumberFor(uid, slug) {
  const part = String(slug || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5) || 'COURSE';
  return `1P-${part}-${certHash36(`${uid || 'anon'}::${slug || ''}`)}`;
}

async function assertEnrolled(db, uid, slug) {
  const snap = await db.collection('users').doc(uid).get();
  const enrolled = (snap.exists && snap.data().enrolledCourseSlugs) || [];
  if (!enrolled.includes(slug)) {
    throw new HttpsError('permission-denied', 'You must be enrolled in this course.');
  }
}

// startExam — begins (or resumes) a written exam attempt. Questions are
// served without their answers; grading happens in submitExam.
exports.startExam = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const slug = String((request.data && request.data.slug) || '').trim();
  if (!slug) throw new HttpsError('invalid-argument', 'slug is required.');
  const db = admin.firestore();
  await rateLimitCaller(db, request, { action: 'startExam', max: 10, windowSec: 600 });
  await assertEnrolled(db, uid, slug);
  const cfg = await loadCertConfig(db);

  const attemptsRef = db.collection('users').doc(uid).collection('examAttempts');
  const prior = await attemptsRef.where('courseSlug', '==', slug).get();

  // Resume an open attempt rather than burning a new one on a page refresh.
  const open = prior.docs.find((d) => d.data().status === 'in-progress');
  const finished = prior.docs.filter((d) => d.data().status === 'finished');
  if (finished.some((d) => d.data().passed === true)) {
    throw new HttpsError('already-exists', 'You have already passed this exam.');
  }
  if (!open && finished.length >= cfg.maxExamAttempts) {
    throw new HttpsError('resource-exhausted',
      'You have used all exam attempts. Contact your program admin for a reset.');
  }

  const bankSnap = await db.collection('examBank').doc(slug).collection('questions').get();
  const bank = bankSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((q) => q.active !== false && q.prompt && Array.isArray(q.choices) && q.choices.length >= 2);
  if (bank.length < 5) {
    throw new HttpsError('failed-precondition', 'The exam isn\'t ready yet. Check back soon.');
  }

  let attemptId;
  let questionIds;
  if (open) {
    attemptId = open.id;
    questionIds = open.data().questionIds || [];
  } else {
    const shuffled = bank.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    questionIds = shuffled.slice(0, Math.min(cfg.examQuestionCount, shuffled.length)).map((q) => q.id);
    const ref = await attemptsRef.add({
      courseSlug: slug,
      status: 'in-progress',
      questionIds,
      startedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    attemptId = ref.id;
  }

  const byId = new Map(bank.map((q) => [q.id, q]));
  const questions = questionIds
    .filter((id) => byId.has(id))
    .map((id) => ({ id, prompt: byId.get(id).prompt, choices: byId.get(id).choices }));
  return {
    attemptId,
    questions,
    attemptsUsed: finished.length,
    attemptsAllowed: cfg.maxExamAttempts,
    passingScorePercent: cfg.passingScorePercent
  };
});

// submitExam — grades an in-progress attempt server-side.
exports.submitExam = onCall(async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const attemptId = String((request.data && request.data.attemptId) || '').trim();
  const answers = (request.data && request.data.answers) || {};
  if (!attemptId) throw new HttpsError('invalid-argument', 'attemptId is required.');
  const db = admin.firestore();
  await rateLimitCaller(db, request, { action: 'submitExam', max: 10, windowSec: 600 });

  const attemptRef = db.collection('users').doc(uid).collection('examAttempts').doc(attemptId);
  const attemptSnap = await attemptRef.get();
  if (!attemptSnap.exists) throw new HttpsError('not-found', 'Unknown exam attempt.');
  const attempt = attemptSnap.data();
  if (attempt.status !== 'in-progress') {
    throw new HttpsError('failed-precondition', 'This attempt has already been submitted.');
  }
  const slug = attempt.courseSlug;
  const cfg = await loadCertConfig(db);

  const bankSnap = await db.collection('examBank').doc(slug).collection('questions').get();
  const byId = new Map(bankSnap.docs.map((d) => [d.id, d.data()]));
  const ids = attempt.questionIds || [];
  let correct = 0;
  ids.forEach((qid) => {
    const q = byId.get(qid);
    if (q && Number(answers[qid]) === Number(q.correctIndex)) correct += 1;
  });
  const score = ids.length ? Math.round((correct / ids.length) * 100) : 0;
  const passed = score >= cfg.passingScorePercent;

  await attemptRef.set({
    status: 'finished',
    score,
    passed,
    finishedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return { score, passed, correct, total: ids.length, passingScorePercent: cfg.passingScorePercent };
});

// reviewCoachingHours — admin approves or rejects a submitted hour-log entry.
exports.reviewCoachingHours = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const uid = String((request.data && request.data.uid) || '').trim();
  const entryId = String((request.data && request.data.entryId) || '').trim();
  const decision = String((request.data && request.data.decision) || '').trim();
  const note = String((request.data && request.data.note) || '').trim();
  if (!uid || !entryId) throw new HttpsError('invalid-argument', 'uid and entryId are required.');
  if (!['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be approved or rejected.');
  }
  const ref = db.collection('users').doc(uid).collection('coachingHours').doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Unknown hour-log entry.');
  await ref.set({
    status: decision,
    reviewNote: note || null,
    reviewedBy: request.auth.uid,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// reviewCeCredits — admin approves or rejects a submitted continuing
// education entry (renewal requirement).
exports.reviewCeCredits = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const uid = String((request.data && request.data.uid) || '').trim();
  const entryId = String((request.data && request.data.entryId) || '').trim();
  const decision = String((request.data && request.data.decision) || '').trim();
  if (!uid || !entryId) throw new HttpsError('invalid-argument', 'uid and entryId are required.');
  if (!['approved', 'rejected'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be approved or rejected.');
  }
  const ref = db.collection('users').doc(uid).collection('ceCredits').doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Unknown CE entry.');
  await ref.set({
    status: decision,
    reviewedBy: request.auth.uid,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// reviewCapstone — admin scores a submitted recorded coaching session
// against the published rubric and approves or returns it for another take.
exports.reviewCapstone = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const uid = String((request.data && request.data.uid) || '').trim();
  const docId = String((request.data && request.data.docId) || '').trim();
  const decision = String((request.data && request.data.decision) || '').trim();
  const feedback = String((request.data && request.data.feedback) || '').trim();
  const scores = (request.data && request.data.scores) || {};
  if (!uid || !docId) throw new HttpsError('invalid-argument', 'uid and docId are required.');
  if (!['approved', 'revise'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'decision must be approved or revise.');
  }
  const clean = {};
  ['presence', 'questions', 'structure', 'nonAdvising'].forEach((k) => {
    const v = Number(scores[k]);
    if (Number.isFinite(v)) clean[k] = Math.max(0, Math.min(5, v));
  });
  const ref = db.collection('users').doc(uid).collection('capstone').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Unknown capstone submission.');
  await ref.set({
    status: decision,
    rubricScores: clean,
    feedback: feedback || null,
    reviewedBy: request.auth.uid,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// reviewPracticeRecording — feedback on one of the two feedback-only
// recordings (after modules 4 and 6). No score is recorded and nothing here
// affects certification: per criterion, one strength and one specific change,
// as the rubric doc prescribes.
exports.reviewPracticeRecording = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const uid = String((request.data && request.data.uid) || '').trim();
  const docId = String((request.data && request.data.docId) || '').trim();
  const raw = (request.data && request.data.feedback) || {};
  if (!uid || !docId) throw new HttpsError('invalid-argument', 'uid and docId are required.');
  const clip = (v, n) => String(v || '').trim().slice(0, n);
  const feedback = { overall: clip(raw.overall, 2000) };
  let filled = !!feedback.overall;
  ['presence', 'questions', 'structure', 'nonAdvising'].forEach((k) => {
    const c = raw[k] || {};
    const strength = clip(c.strength, 600);
    const change = clip(c.change, 600);
    if (strength || change) filled = true;
    feedback[k] = { strength, change };
  });
  if (!filled) throw new HttpsError('invalid-argument', 'Write some feedback before sending it.');
  const ref = db.collection('users').doc(uid).collection('practiceRecordings').doc(docId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Unknown practice recording.');
  await ref.set({
    status: 'reviewed',
    feedback,
    reviewedBy: request.auth.uid,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

// listCertificationQueue — everything waiting on an admin: submitted hour
// logs and capstone recordings, plus recent exam results for context.
exports.listCertificationQueue = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const [hoursSnap, capsSnap, ceSnap, practiceSnap] = await Promise.all([
    db.collectionGroup('coachingHours').where('status', '==', 'submitted').limit(200).get(),
    db.collectionGroup('capstone').where('status', '==', 'submitted').limit(100).get(),
    db.collectionGroup('ceCredits').where('status', '==', 'submitted').limit(200).get(),
    db.collectionGroup('practiceRecordings').where('status', '==', 'submitted').limit(100).get()
  ]);
  const uidOf = (ref) => ref.path.split('/')[1];
  const uids = new Set();
  const hours = hoursSnap.docs.map((d) => {
    const uid = uidOf(d.ref);
    uids.add(uid);
    return { uid, entryId: d.id, ...d.data() };
  });
  const capstones = capsSnap.docs.map((d) => {
    const uid = uidOf(d.ref);
    uids.add(uid);
    return { uid, docId: d.id, ...d.data() };
  });
  const ceCredits = ceSnap.docs.map((d) => {
    const uid = uidOf(d.ref);
    uids.add(uid);
    return { uid, entryId: d.id, ...d.data() };
  });
  const practice = practiceSnap.docs.map((d) => {
    const uid = uidOf(d.ref);
    uids.add(uid);
    return { uid, docId: d.id, ...d.data() };
  });
  const names = {};
  await Promise.all(Array.from(uids).map(async (uid) => {
    try {
      const u = await db.collection('users').doc(uid).get();
      names[uid] = (u.exists && (u.data().displayName || u.data().email)) || uid;
    } catch (e) { names[uid] = uid; }
  }));
  const clean = (rows) => rows.map((r) => {
    const out = { ...r, userName: names[r.uid] || r.uid };
    Object.keys(out).forEach((k) => {
      if (out[k] && typeof out[k].toDate === 'function') out[k] = out[k].toDate().toISOString();
    });
    return out;
  });
  return { hours: clean(hours), capstones: clean(capstones), ceCredits: clean(ceCredits), practice: clean(practice) };
});

// getCertificationStatus — one call that tells a member (or an admin asking
// about a member) exactly where they stand against every requirement.
exports.getCertificationStatus = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  let uid = callerUid;
  const askedUid = String((request.data && request.data.uid) || '').trim();
  if (askedUid && askedUid !== callerUid) {
    if (!(await isAdminCaller(db, request))) {
      throw new HttpsError('permission-denied', 'Admin or owner role required.');
    }
    uid = askedUid;
  }
  const slug = String((request.data && request.data.slug) || '1p-clc').trim();
  const cfg = await loadCertConfig(db);

  const [hoursSnap, capsSnap, attemptsSnap, certSnap, practiceSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('coachingHours').get(),
    db.collection('users').doc(uid).collection('capstone').get(),
    db.collection('users').doc(uid).collection('examAttempts').where('courseSlug', '==', slug).get(),
    db.collection('certifications').doc(`${uid}_${slug}`).get(),
    db.collection('users').doc(uid).collection('practiceRecordings').get()
  ]);

  // Feedback-only recordings (after modules 4 and 6). Informational: they
  // never gate certification, but the member sees the feedback here.
  const iso = (t) => (t && typeof t.toDate === 'function') ? t.toDate().toISOString() : null;
  const practice = practiceSnap.docs
    .map((d) => {
      const p = d.data();
      return {
        docId: d.id,
        module: Number(p.module) || null,
        status: p.status || 'submitted',
        submittedAt: iso(p.submittedAt),
        reviewedAt: iso(p.reviewedAt),
        feedback: p.status === 'reviewed' ? (p.feedback || null) : null
      };
    })
    .sort((a, b) => String(a.submittedAt || '').localeCompare(String(b.submittedAt || '')));

  let approvedMinutes = 0;
  let pendingMinutes = 0;
  hoursSnap.docs.forEach((d) => {
    const e = d.data();
    if (e.status === 'approved') approvedMinutes += Number(e.minutes) || 0;
    else if (e.status === 'submitted') pendingMinutes += Number(e.minutes) || 0;
  });
  const capstoneApproved = capsSnap.docs.some((d) => d.data().status === 'approved');
  const capstoneSubmitted = capsSnap.docs.some((d) => d.data().status === 'submitted');
  const examPassed = attemptsSnap.docs.some((d) => d.data().passed === true);
  const attemptsUsed = attemptsSnap.docs.filter((d) => d.data().status === 'finished').length;

  return {
    slug,
    requiredHours: cfg.requiredHours,
    approvedHours: Math.round((approvedMinutes / 60) * 10) / 10,
    pendingHours: Math.round((pendingMinutes / 60) * 10) / 10,
    hoursMet: approvedMinutes >= cfg.requiredHours * 60,
    examPassed,
    attemptsUsed,
    attemptsAllowed: cfg.maxExamAttempts,
    capstoneApproved,
    capstoneSubmitted,
    practice,
    certified: certSnap.exists && certSnap.data().status === 'active',
    certification: certSnap.exists ? {
      certNumber: certSnap.data().certNumber,
      track: certSnap.data().track,
      issuedAt: certSnap.data().issuedAt && certSnap.data().issuedAt.toDate
        ? certSnap.data().issuedAt.toDate().toISOString() : null,
      licenseExpiresAt: certSnap.data().licenseExpiresAt && certSnap.data().licenseExpiresAt.toDate
        ? certSnap.data().licenseExpiresAt.toDate().toISOString() : null,
      status: certSnap.data().status
    } : null
  };
});

// issueCertification — the only path to the credential. Verifies every
// requirement server-side, then writes the Admin-SDK-only record the
// certificate page and (later) the coach license system key off.
exports.issueCertification = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const uid = String((request.data && request.data.uid) || '').trim();
  const slug = String((request.data && request.data.slug) || '1p-clc').trim();
  if (!uid) throw new HttpsError('invalid-argument', 'uid is required.');
  const cfg = await loadCertConfig(db);

  await assertEnrolled(db, uid, slug);

  const [hoursSnap, capsSnap, attemptsSnap, purchasesSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('coachingHours').where('status', '==', 'approved').get(),
    db.collection('users').doc(uid).collection('capstone').where('status', '==', 'approved').get(),
    db.collection('users').doc(uid).collection('examAttempts').where('courseSlug', '==', slug).get(),
    db.collection('users').doc(uid).collection('purchases').get()
  ]);

  const approvedMinutes = hoursSnap.docs.reduce((sum, d) => sum + (Number(d.data().minutes) || 0), 0);
  if (approvedMinutes < cfg.requiredHours * 60) {
    throw new HttpsError('failed-precondition',
      `Only ${Math.floor(approvedMinutes / 60)} of ${cfg.requiredHours} approved practice hours.`);
  }
  if (capsSnap.empty) {
    throw new HttpsError('failed-precondition', 'No approved recorded-session review.');
  }
  if (!attemptsSnap.docs.some((d) => d.data().passed === true)) {
    throw new HttpsError('failed-precondition', 'The written exam has not been passed.');
  }
  const pastDue = purchasesSnap.docs.some((d) =>
    d.data().courseSlug === slug && d.data().status === 'past_due');
  if (pastDue) {
    throw new HttpsError('failed-precondition',
      'A payment on this enrollment is past due. Resolve it before issuing.');
  }

  const issuedAt = admin.firestore.Timestamp.now();
  const licenseExpiresAt = admin.firestore.Timestamp.fromMillis(
    issuedAt.toMillis() + 365 * 24 * 60 * 60 * 1000);
  const certRef = db.collection('certifications').doc(`${uid}_${slug}`);
  const existing = await certRef.get();
  if (existing.exists && existing.data().status === 'active') {
    throw new HttpsError('already-exists', 'This certification has already been issued.');
  }
  await certRef.set({
    uid,
    slug,
    track: 'life',
    certNumber: certNumberFor(uid, slug),
    issuedAt,
    licenseExpiresAt,
    status: 'active',
    issuedBy: request.auth.uid
  }, { merge: true });
  await db.collection('users').doc(uid).set({
    coachLevel: 'practitioner'
  }, { merge: true });

  // Every certified coach gets a referral code so they can sell the
  // client-facing 1P products from day one. Tiered rates: practitioner
  // keeps 50% on client products, Certified + Practice Build keeps 70%
  // (upgradeCoachLevel bumps it); certification referrals stay at 20%.
  try {
    await ensureCoachAffiliate(db, uid, 'practitioner');
  } catch (e) {
    console.warn('[issueCertification] affiliate create failed:', e && e.message);
  }

  // Directory listing is a license benefit — created active, hidden when the
  // license lapses.
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.exists ? userSnap.data() : {};
    await db.collection('coachDirectory').doc(uid).set({
      uid,
      name: u.displayName || null,
      photoUrl: u.photoURL || null,
      location: u.location || null,
      bio: null,
      specialties: [],
      bookingUrl: null,
      track: 'life',
      active: true,
      licenseExpiresAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.warn('[issueCertification] directory create failed:', e && e.message);
  }

  return { ok: true, certNumber: certNumberFor(uid, slug) };
});

// Coach revenue-share tiers, by license level.
const COACH_PRODUCT_RATES = { 'practitioner': 50, 'practice-build': 70 };

async function ensureCoachAffiliate(db, uid, coachLevel) {
  const existing = await db.collection('affiliates').where('uid', '==', uid).limit(1).get();
  const rates = {
    courseReferralPercent: 20,
    clientProductPercent: COACH_PRODUCT_RATES[coachLevel] || 50
  };
  if (!existing.empty) {
    await existing.docs[0].ref.set({ rates, type: 'coach' }, { merge: true });
    return existing.docs[0].id;
  }
  const userSnap = await db.collection('users').doc(uid).get();
  const u = userSnap.exists ? userSnap.data() : {};
  const base = String(u.displayName || 'COACH').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 10) || 'COACH';
  let code = null;
  for (let i = 0; i < 8 && !code; i++) {
    const candidate = base + crypto.randomInt(100, 999);
    const clash = await db.collection('affiliates').doc(candidate).get();
    if (!clash.exists) code = candidate;
  }
  if (!code) code = base + Date.now().toString(36).toUpperCase().slice(-4);
  await db.collection('affiliates').doc(code).set({
    code,
    name: u.displayName || null,
    email: u.email || null,
    uid,
    type: 'coach',
    commissionPercent: 20,
    rates,
    active: true,
    clicks: 0,
    saleCount: 0,
    totalSales: 0,
    totalCommission: 0,
    totalPaid: 0,
    createdBy: 'issueCertification',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return code;
}

// upgradeCoachLevel — admin moves a coach to the Certified + Practice Build
// tier (70% on client products). The license record and rates follow.
exports.upgradeCoachLevel = onCall(async (request) => {
  const db = admin.firestore();
  if (!(await isAdminCaller(db, request))) {
    throw new HttpsError('permission-denied', 'Admin or owner role required.');
  }
  const uid = String((request.data && request.data.uid) || '').trim();
  const level = String((request.data && request.data.level) || '').trim();
  if (!uid || !COACH_PRODUCT_RATES[level]) {
    throw new HttpsError('invalid-argument', 'uid and a valid level (practitioner | practice-build) are required.');
  }
  await db.collection('users').doc(uid).set({ coachLevel: level }, { merge: true });
  await ensureCoachAffiliate(db, uid, level);
  return { ok: true, level };
});

// createRenewalCheckout — the $597 annual A.L.I.G.N. Practitioner License
// renewal. Deliberately a one-time payment rather than an auto-renewing
// subscription: renewal is GATED on continued practice (approved hours) and
// continuing education, and an auto-charge would bypass the gate. The
// webhook extends licenseExpiresAt when the payment lands.
exports.createRenewalCheckout = onCall({ secrets: STRIPE_SECRETS }, async (request) => {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const db = admin.firestore();
  await rateLimitCaller(db, request, { action: 'createRenewalCheckout', max: 10, windowSec: 600 });
  const slug = String((request.data && request.data.slug) || '1p-clc').trim();
  const cfg = await loadCertConfig(db);

  const certRef = db.collection('certifications').doc(`${uid}_${slug}`);
  const certSnap = await certRef.get();
  if (!certSnap.exists) {
    throw new HttpsError('failed-precondition', 'No certification on file to renew.');
  }
  const cert = certSnap.data();
  if (cert.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'This license has been revoked. Contact the program.');
  }

  // Hours + CE since the last issuance or renewal.
  const sinceMs = cert.lastRenewedAt && cert.lastRenewedAt.toMillis
    ? cert.lastRenewedAt.toMillis()
    : (cert.issuedAt && cert.issuedAt.toMillis ? cert.issuedAt.toMillis() : 0);

  const [hoursSnap, ceSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('coachingHours').where('status', '==', 'approved').get(),
    db.collection('users').doc(uid).collection('ceCredits').where('status', '==', 'approved').get()
  ]);
  const minutesSince = hoursSnap.docs.reduce((sum, d) => {
    const t = d.data().reviewedAt && d.data().reviewedAt.toMillis ? d.data().reviewedAt.toMillis() : 0;
    return t >= sinceMs ? sum + (Number(d.data().minutes) || 0) : sum;
  }, 0);
  const ceSince = ceSnap.docs.reduce((sum, d) => {
    const t = d.data().reviewedAt && d.data().reviewedAt.toMillis ? d.data().reviewedAt.toMillis() : 0;
    return t >= sinceMs ? sum + (Number(d.data().credits) || 0) : sum;
  }, 0);

  if (minutesSince < cfg.renewalHours * 60) {
    throw new HttpsError('failed-precondition',
      `Renewal requires ${cfg.renewalHours} approved coaching hours this license year; you have ${Math.floor(minutesSince / 60)}.`);
  }
  if (ceSince < cfg.renewalCeCredits) {
    throw new HttpsError('failed-precondition',
      `Renewal requires ${cfg.renewalCeCredits} approved CE credits this license year; you have ${ceSince}.`);
  }

  const stripe = getStripe();
  if (!stripe) {
    throw new HttpsError('failed-precondition', 'Online checkout isn\'t available yet.');
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: 59700,
        product_data: { name: 'A.L.I.G.N. Practitioner License — annual renewal' }
      }
    }],
    customer_email: (request.auth.token && request.auth.token.email) || undefined,
    client_reference_id: uid,
    metadata: { uid, licenseRenewal: slug },
    success_url: `${APP_BASE_URL}/affiliate.html?renewal=success`,
    cancel_url: `${APP_BASE_URL}/affiliate.html`
  });
  return { ok: true, url: session.url };
});

// ════════════════════════════════════════════════════════════════
// Financial services — co-branded lead capture (Phase 3).
//
// The founder's insurance and securities licenses are in progress, NOT
// held, so nothing here transacts or makes an offer: bookkeeping leads go
// to the bookkeeping partner's CRM company (config/leadRouting), and the
// insurance / investment waitlists stay with the academy. Keep it that
// way until the licenses are in hand.
// ════════════════════════════════════════════════════════════════

const FIN_SERVICES = {
  'bookkeeping': { label: 'Bookkeeping', tags: ['Financial Services', 'Bookkeeping'], routeKey: 'financial-services' },
  'insurance-waitlist': { label: 'Insurance planning waitlist', tags: ['Financial Services', 'Insurance Waitlist'], routeKey: null },
  'investments-waitlist': { label: 'Investment planning waitlist', tags: ['Financial Services', 'Investments Waitlist'], routeKey: null }
};

exports.registerServiceInterest = onCall(async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const serviceKey = (data.service || '').toString().trim();
  const service = FIN_SERVICES[serviceKey];
  if (!service) throw new HttpsError('invalid-argument', 'Unknown service.');

  const name = (data.name || '').toString().trim().slice(0, 120);
  const email = (data.email || '').toString().trim().toLowerCase().slice(0, 160);
  const phone = (data.phone || '').toString().trim().slice(0, 40) || null;
  const businessName = (data.businessName || '').toString().trim().slice(0, 120) || null;
  const notes = (data.notes || '').toString().trim().slice(0, 500) || null;
  const parsedConsent = parseFormConsent(data);
  const consent = parsedConsent.consent;
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email.');

  await rateLimitCaller(db, request, { action: 'registerServiceInterest', max: 10, windowSec: 600 });

  const FV = admin.firestore.FieldValue;
  const companyId = await resolveCompanyForSource(db, service.routeKey);
  if (!companyId) throw new HttpsError('internal', 'Lead routing is not configured yet.');

  const tags = service.tags.slice();
  if (consent) tags.push('Opt-In: Calls/SMS/Email');
  const ref = await upsertCrmContact(db, companyId, {
    name: name || null, email, phone,
    companyName: businessName,
    source: 'Financial Services', tags
  });
  // The bookkeeping form is a declared SMS opt-in point and sends per-channel
  // consent; the waitlist form shows no SMS box and sends only the boolean.
  await recordFormConsent(db, ref, {
    parsed: parsedConsent, source: 'Financial services', channel: 'financial-services',
    fallbackText: `Opted in via financial services form (${service.label})`
  });
  await ref.collection('activities').add({
    type: 'service_interest',
    description: `${service.label} inquiry${notes ? ': ' + notes.slice(0, 120) : ''}`,
    actorUid: 'system', actorName: 'Financial services form',
    createdAt: FV.serverTimestamp(),
    meta: { service: serviceKey, notes }
  });

  return { ok: true, service: serviceKey };
});

// ════════════════════════════════════════════════════════════════
// Native lead capture — replaces the GoHighLevel form posts.
//
// One public callable for the site's lead forms (webinar signup, speaking
// request, goal planner). Upserts the contact into the academy CRM with a
// per-form source and tags, records the full answers as an activity, and
// stamps marketing consent. The webinar page separately registers the
// signup for the webinar event (registerForEvent) to get its gated Zoom
// join link; this callable is the lead-capture half.
// ════════════════════════════════════════════════════════════════

const LEAD_FORMS = {
  'webinar': { source: 'Webinar', tags: ['Webinar Signup'] },
  'speaking': { source: 'Speaking Request', tags: ['Speaking Request'] },
  'goal-planner': { source: 'Goal Planner', tags: ['Goal Planner'] },
  'newsletter': { source: 'Newsletter', tags: ['Newsletter'] },
  // The Alignment Audit is the top of the corporate funnel and the path to an
  // annual program, so it is tagged as its own pipeline rather than folded in
  // with generic speaking requests.
  'alignment-audit': { source: 'Alignment Audit', tags: ['Alignment Audit', 'Corporate'] },
  // Homepage footer signup for people willing to test a course before it is
  // finished and report back. Tagged separately so the beta group is one
  // filter in the CRM when it is time to invite them.
  'beta-tester': { source: 'Beta Tester', tags: ['Beta Tester'] },
  // /book-bonus — readers claiming the companion material for the book.
  // These are the warmest leads on the site (they bought the book), so they
  // get their own tag rather than being folded into the newsletter.
  'book-bonus': { source: 'Book Bonus', tags: ['Book Bonus', 'Book Reader'] },
  // /contact-us — the public "get in touch" form. Someone who writes in
  // unprompted is asking for a reply, so this type always notifies.
  'contact': { source: 'Contact Form', tags: ['Contact Form'], urgent: true }
};

/**
 * Email the owner that a lead came in.
 *
 * Every lead form on the site wrote to Firestore and stopped there, so a
 * speaking request, a corporate Alignment Audit enquiry or someone using the
 * contact form sat in the CRM until somebody happened to open it. Nothing told
 * anyone it had arrived.
 *
 * Best-effort by design: the caller has already stored the lead before this
 * runs, so a mail failure must never turn a captured lead into an error the
 * visitor sees. Requires `sendgridKey` to be declared on the calling function.
 */
async function notifyOwnerOfLead({ source, name, email, phone, fields, contactUrl }) {
  try {
    if (!emailConfigured()) return;

    const rows = Object.entries(fields || {})
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;">${escapeHtmlBasic(k)}</td><td style="padding:4px 0;">${escapeHtmlBasic(v)}</td></tr>`)
      .join('');
    const textRows = Object.entries(fields || {})
      .map(([k, v]) => `${k}: ${v}`).join('\n');

    await sendEmail({
      to: NOTIFY_EMAIL,
      from: { email: FROM_EMAIL, name: FROM_NAME_DEFAULT },
      // Replying to the notification replies to the person who wrote in.
      replyTo: email || REPLY_TO,
      subject: `New ${source}: ${name || email || 'someone'}`,
      text: `${source}\n\nName: ${name || '—'}\nEmail: ${email || '—'}\nPhone: ${phone || '—'}\n\n${textRows}\n\n${contactUrl || ''}`,
      html: `
        <div style="font-family:Arial,sans-serif;color:#222;max-width:560px;margin:0 auto;">
          <h2 style="color:#CC1B1B;margin-bottom:4px;">New ${escapeHtmlBasic(source)}</h2>
          <p style="margin:0 0 16px;color:#666;font-size:13px;">Reply to this email to answer them directly.</p>
          <table style="font-size:14px;border-collapse:collapse;">
            <tr><td style="padding:4px 12px 4px 0;color:#666;">Name</td><td style="padding:4px 0;"><strong>${escapeHtmlBasic(name || '—')}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666;">Email</td><td style="padding:4px 0;">${escapeHtmlBasic(email || '—')}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666;">Phone</td><td style="padding:4px 0;">${escapeHtmlBasic(phone || '—')}</td></tr>
            ${rows}
          </table>
          ${contactUrl ? `<p style="margin-top:20px;"><a href="${contactUrl}" style="display:inline-block;background:#CC1B1B;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:600;">Open in CRM</a></p>` : ''}
        </div>`,
      customArgs: { type: 'lead_notification' }
    });
  } catch (e) {
    console.warn('[notifyOwnerOfLead] failed:', e && e.message);
  }
}

/** Minimal HTML escaping for values interpolated into notification email. */
function escapeHtmlBasic(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// `secrets` is required for the owner notification below — an undeclared
// secret is never injected at runtime, so sendgridKey.value() would throw.
/**
 * recordSmsConsent({ companyId, contactId, note }) — an admin records consent
 * given outside a web form, typically verbally on a call, for a contact who
 * declined on the form or has no consent on file.
 *
 * A callable rather than a client write for the same reason setDoNotCall sits
 * outside the updateContact whitelist: a consent change must reach the activity
 * trail with a trustworthy actor, and firestore.rules refuses client writes to
 * these fields so this is the only way in.
 */
exports.recordSmsConsent = onCall(async (request) => {
  const db = admin.firestore();
  const { companyId, contactId } = request.data || {};
  const note = String((request.data || {}).note || '').trim().slice(0, 500);
  if (!companyId || !contactId) {
    throw new HttpsError('invalid-argument', 'companyId and contactId are required.');
  }
  if (!note) {
    throw new HttpsError('invalid-argument',
      'Say how consent was given — this note is the record.');
  }
  const { uid } = await assertCompanyAdmin(db, companyId, request);
  await rateLimitCaller(db, request, { action: 'recordSmsConsent', max: 60, windowSec: 600 });

  const ref = db.collection('companies').doc(companyId).collection('contacts').doc(contactId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Contact not found.');
  if (snap.data().smsOptedOut === true) {
    throw new HttpsError('failed-precondition',
      'This contact replied STOP. Only they can opt back in, by replying START.');
  }

  const FV = admin.firestore.FieldValue;
  const actorName = (request.auth.token && (request.auth.token.name || request.auth.token.email)) || uid;
  const text = `Consent recorded by ${actorName}: ${note}`;
  await ref.set({
    smsConsent: true,
    smsConsentAt: FV.serverTimestamp(),
    smsConsentText: text,
    smsConsentDeclinedAt: FV.delete(),
    updatedAt: FV.serverTimestamp()
  }, { merge: true });
  await ref.collection('activities').add({
    type: 'consent_updated',
    description: `SMS consent recorded: ${note}`,
    actorUid: uid, actorName,
    createdAt: FV.serverTimestamp(),
    meta: { channel: 'manual', smsConsent: true, consentText: { sms: text } }
  });
  return { ok: true };
});

/**
 * Consent as a public form sends it. Newer pages send per-channel state plus
 * the exact wording shown (`consents` + `consentText`); older pages, and a
 * page that deploys ahead of this function, send one boolean. The boolean is
 * derived from the per-channel state when present so tag behaviour is the
 * same either way.
 */
function parseFormConsent(data) {
  const hasChannels = !!(data.consents && typeof data.consents === 'object');
  const smsConsent = hasChannels ? data.consents.sms === true : null;
  const marketingConsent = hasChannels ? data.consents.marketing === true : null;
  const consent = hasChannels ? (smsConsent || marketingConsent) : !!data.consent;
  const textIn = data.consentText && typeof data.consentText === 'object' ? data.consentText : {};
  const consentTextFor = (k) => String(textIn[k] == null ? '' : textIn[k]).trim().slice(0, 1000);
  return { hasChannels, smsConsent, marketingConsent, consent, consentTextFor };
}

/**
 * Record a form's consent on the contact, per channel, with the wording the
 * person actually saw, and leave one consent_updated activity as proof.
 *
 * Shared by every public form that can grant SMS consent so the stored
 * record is identical whichever page it came from. Opt-in is additive: a
 * later submission never downgrades an earlier `true`, because revocation is
 * a STOP reply, which has its own path. The one negative outcome is an
 * explicit decline — the SMS box was shown (hasChannels) and left unticked by
 * someone with no prior consent on file — which the send gate then honours.
 * A form that shows no SMS box must not send `consents`, or it would record
 * a decline for a choice the person was never offered.
 */
async function recordFormConsent(db, ref, { parsed, source, channel, fallbackText }) {
  const FV = admin.firestore.FieldValue;
  const { hasChannels, smsConsent, marketingConsent, consent, consentTextFor } = parsed;
  const consentPatch = {};
  let smsOutcome = null;
  if (hasChannels) {
    const prior = await ref.get();
    const priorSms = prior.exists ? prior.data().smsConsent : undefined;
    if (smsConsent) {
      consentPatch.smsConsent = true;
      consentPatch.smsConsentAt = FV.serverTimestamp();
      consentPatch.smsConsentText = consentTextFor('sms') || fallbackText;
      consentPatch.smsConsentDeclinedAt = FV.delete();
      smsOutcome = 'granted';
    } else if (priorSms !== true) {
      consentPatch.smsConsent = false;
      consentPatch.smsConsentDeclinedAt = FV.serverTimestamp();
      smsOutcome = 'declined';
    }
    if (marketingConsent) {
      consentPatch.marketingConsent = true;
      consentPatch.marketingConsentAt = FV.serverTimestamp();
      consentPatch.marketingConsentText = consentTextFor('marketing') || fallbackText;
    }
  } else if (consent) {
    consentPatch.marketingConsent = true;
    consentPatch.marketingConsentAt = FV.serverTimestamp();
    consentPatch.marketingConsentText = fallbackText;
  }
  if (!Object.keys(consentPatch).length) return { smsOutcome };
  await ref.set(consentPatch, { merge: true });
  // The durable proof of opt-in: what was agreed to, in what words, when.
  await ref.collection('activities').add({
    type: 'consent_updated',
    description: hasChannels
      ? `${source} form: SMS ${smsOutcome || 'unchanged'}, marketing ${marketingConsent ? 'granted' : 'not given'}.`
      : `${source} form: opted in.`,
    actorUid: 'system', actorName: 'Consent capture',
    createdAt: FV.serverTimestamp(),
    meta: {
      channel,
      smsConsent: hasChannels ? smsConsent : null,
      marketingConsent: hasChannels ? marketingConsent : consent,
      consentText: hasChannels
        ? { sms: consentTextFor('sms') || null, marketing: consentTextFor('marketing') || null }
        : null
    }
  });
  return { smsOutcome };
}

exports.submitLeadForm = onCall({ secrets: [sendgridKey] }, async (request) => {
  const db = admin.firestore();
  const data = request.data || {};
  const formType = (data.formType || '').toString().trim();
  const form = LEAD_FORMS[formType];
  if (!form) throw new HttpsError('invalid-argument', 'Unknown form.');

  const name = (data.name || '').toString().trim().slice(0, 120);
  const email = (data.email || '').toString().trim().toLowerCase().slice(0, 160);
  const phone = (data.phone || '').toString().trim().slice(0, 40) || null;
  const parsedConsent = parseFormConsent(data);
  const consent = parsedConsent.consent;
  if (!name) throw new HttpsError('invalid-argument', 'Please enter your name.');
  if (!EMAIL_RE.test(email)) throw new HttpsError('invalid-argument', 'Please enter a valid email.');

  await rateLimitCaller(db, request, { action: 'submitLeadForm', max: 10, windowSec: 600 });

  // The form's answers, kept as a bounded map of short strings.
  const fields = {};
  const raw = data.fields && typeof data.fields === 'object' ? data.fields : {};
  Object.keys(raw).slice(0, 20).forEach((k) => {
    const key = String(k).slice(0, 40);
    const val = String(raw[k] == null ? '' : raw[k]).trim().slice(0, 600);
    if (val) fields[key] = val;
  });

  const FV = admin.firestore.FieldValue;
  const companyId = await resolveAcademyCompanyId(db);
  if (!companyId) throw new HttpsError('internal', 'Lead routing is not configured yet.');

  const tags = form.tags.slice();
  if (consent) tags.push('Opt-In: Calls/SMS/Email');
  const ref = await upsertCrmContact(db, companyId, {
    name, email, phone, source: form.source, tags
  });
  await recordFormConsent(db, ref, {
    parsed: parsedConsent, source: form.source, channel: formType,
    fallbackText: `Opted in via ${form.source.toLowerCase()} form`
  });
  // A beta application is also a cohort record, not just a lead. Best-effort:
  // the lead is already saved, so a failure here must not fail the form.
  if (formType === 'beta-tester') {
    try {
      await recordBetaApplication(db, { name, email, phone, fields, crmContactId: ref.id });
    } catch (e) {
      console.error('[submitLeadForm] beta record failed:', e && e.message);
    }
  }

  const summary = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(' · ');
  await ref.collection('activities').add({
    type: 'lead_form',
    description: `${form.source} form${summary ? ': ' + summary.slice(0, 200) : ''}`,
    actorUid: 'system', actorName: `${form.source} form`,
    createdAt: FV.serverTimestamp(),
    meta: { formType, fields }
  });

  // Tell the owner. The lead is already saved, so this is best-effort and
  // never fails the submission. Awaited rather than fire-and-forget because a
  // Cloud Function's runtime can be frozen the moment the handler returns,
  // which would drop an in-flight send.
  await notifyOwnerOfLead({
    source: form.source,
    name, email, phone, fields,
    contactUrl: `${APP_BASE_URL}/contact.html?id=${encodeURIComponent(ref.id)}`
  });

  return { ok: true };
});

// ────────────────────────────────────────────────────────────────
// Exposed for the emulator test (tests/launch-tick.test.mjs). A plain
// function is not a trigger: the Functions loader registers only exports
// that carry an endpoint definition, so this deploys nothing.
// ────────────────────────────────────────────────────────────────
exports.promoteLaunchedItems = promoteLaunchedItems;
