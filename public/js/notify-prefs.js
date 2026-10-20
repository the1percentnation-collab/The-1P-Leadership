// Notification preferences — who hears about what, and on which device.
//
// Everything lives on users/{uid}, which the member may write (firestore.rules):
//   notifPrefs.{type}         false turns that kind of alert off. Absent = on.
//   channelAlerts.{channel}   'all' (every new thread) or 'mentions'.
//   fcmTokens                 this member's push devices (push.js).
// The server reads the same fields: notifyUser / pushToUser / fanOutNewThread,
// sendCourseWorkReminders and sendCommunityDigests in functions/index.js. Keep the defaults here in
// step with channelAlertLevel there.

import { db, firebaseReady } from './firebase.js';
import { doc, setDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { pushAvailable, enablePush, disablePush, pushEnabledHere, isIosNotInstalled, PUSH_ERRORS } from './push.js';
import { escapeHtml, getUserProfile } from './community.js';

export const ALERT_TYPES = [
  { key: 'newThreads', label: 'New threads', hint: 'In the channels you follow. Pick them below.' },
  { key: 'mentions', label: '@mentions', hint: 'When someone tags you in a post or comment.' },
  { key: 'comments', label: 'Comments on your posts' },
  { key: 'likes', label: 'Likes on your posts' },
  { key: 'announcements', label: 'Announcements', hint: 'Updates from The One Percent team.' },
  { key: 'courseReminders', label: 'Course work reminders on your phone', hint: 'The sessions on your course plans. Email and bell are set on each plan.' },
  { key: 'digest', label: 'Daily community digest email', hint: 'An evening email of new threads, sent only while push is off and only on days with new posts.' }
];

/**
 * 'all' | 'mentions'. Members of a private channel default to every thread;
 * everyone else (public channels, staff reading a private one) to mentions.
 */
export function channelAlertLevel(profile, channelKey, isPrivateMember) {
  const v = profile && profile.channelAlerts && profile.channelAlerts[channelKey];
  if (v === 'all' || v === 'mentions') return v;
  return isPrivateMember ? 'all' : 'mentions';
}

/** Is `uid` in this private channel's member list? */
export function isPrivateMember(channel, uid) {
  return !!channel && channel.visibility === 'private'
    && Array.isArray(channel.memberUids) && channel.memberUids.includes(uid);
}

export function prefOn(profile, key) {
  return !(profile && profile.notifPrefs && profile.notifPrefs[key] === false);
}

export async function setChannelAlert(uid, channelKey, level) {
  if (!firebaseReady || !uid) return;
  await setDoc(doc(db, 'users', uid), { channelAlerts: { [channelKey]: level } }, { merge: true });
}

export async function setNotifPref(uid, key, on) {
  if (!firebaseReady || !uid) return;
  await setDoc(doc(db, 'users', uid), { notifPrefs: { [key]: !!on } }, { merge: true });
}

/**
 * Clear the channel's rolling "new threads" bell row once the member is
 * looking at the channel. A missing row is the common case and not an error.
 */
export function clearThreadAlert(uid, channelKey) {
  if (!firebaseReady || !uid || !channelKey) return;
  updateDoc(doc(db, 'users', uid, 'notifications', `thread_${channelKey}`), { read: true }).catch(() => {});
}

// ─── Opt-in offer ──────────────────────────────────────────────────────────
// Asked right after a member posts, replies or follows a channel: the moment
// an alert is obviously useful to them. "Not now" holds for 30 days.

const OFFER_KEY = 'pushOfferDismissedAt';
const OFFER_SNOOZE_MS = 30 * 86400000;

function offerSnoozed() {
  try {
    const at = Number(localStorage.getItem(OFFER_KEY) || 0);
    return at > 0 && Date.now() - at < OFFER_SNOOZE_MS;
  } catch (e) {
    return false;
  }
}

function snoozeOffer() {
  try { localStorage.setItem(OFFER_KEY, String(Date.now())); } catch (e) { /* private mode */ }
}

/**
 * Show the push offer in `mount` if it applies to this browser: push works
 * here and the member has not answered the browser's prompt yet, or this is
 * an iPhone that needs the site on its Home Screen first.
 */
export async function maybeOfferPush(mount, { uid, reason = 'reply' } = {}) {
  if (!mount || !uid || offerSnoozed()) return;
  const ios = isIosNotInstalled();
  if (!ios) {
    if (!(await pushAvailable())) return;
    if (Notification.permission !== 'default') return;
  }
  const lead = reason === 'follow'
    ? 'Get new threads from this channel on your phone.'
    : 'Know the moment someone replies.';
  mount.innerHTML = ios ? `
    <div class="np-offer" role="region" aria-label="Turn on notifications">
      <div class="np-offer-text">
        <strong>${escapeHtml(lead)}</strong>
        <span>On iPhone, tap Share, then <b>Add to Home Screen</b>. Open the Academy from there and turn notifications on.</span>
      </div>
      <div class="np-offer-actions">
        <button class="btn btn-ghost" type="button" data-np-later>Got it</button>
      </div>
    </div>` : `
    <div class="np-offer" role="region" aria-label="Turn on notifications">
      <div class="np-offer-text">
        <strong>${escapeHtml(lead)}</strong>
        <span>Turn on notifications for replies, mentions and the channels you follow. Change it any time on your profile.</span>
      </div>
      <div class="np-offer-actions">
        <button class="btn btn-primary" type="button" data-np-on>Turn on</button>
        <button class="btn btn-ghost" type="button" data-np-later>Not now</button>
      </div>
      <p class="np-offer-note" data-np-note hidden></p>
    </div>`;
  mount.hidden = false;

  const later = mount.querySelector('[data-np-later]');
  later.addEventListener('click', () => { snoozeOffer(); mount.hidden = true; mount.innerHTML = ''; });
  const on = mount.querySelector('[data-np-on]');
  if (!on) return;
  on.addEventListener('click', async () => {
    on.disabled = true;
    const res = await enablePush(uid);
    if (res.ok) {
      mount.querySelector('.np-offer-text').innerHTML = '<strong>Notifications are on.</strong><span>Fine-tune them any time on your profile.</span>';
      mount.querySelector('.np-offer-actions').remove();
      setTimeout(() => { mount.hidden = true; mount.innerHTML = ''; }, 4000);
      return;
    }
    on.disabled = false;
    if (res.reason === 'dismissed') snoozeOffer();
    const note = mount.querySelector('[data-np-note]');
    note.hidden = false;
    note.textContent = PUSH_ERRORS[res.reason] || PUSH_ERRORS.error;
  });
}

// ─── Settings panel (profile page) ─────────────────────────────────────────

/**
 * Render the full notification settings into `root`.
 *   profile  — the member's users/{uid} doc (notifPrefs, channelAlerts, fcmTokens)
 *   channels — listChannels() rows the member can read
 */
export async function renderNotifSettings(root, { uid, profile, channels }) {
  if (!root || !uid) return;
  const p = profile || {};
  const readable = (channels || []).filter((c) => c && c.key);

  const typeRows = ALERT_TYPES.map((t) => `
    <label class="np-row">
      <span class="np-row-text">
        <span class="np-row-label">${escapeHtml(t.label)}</span>
        ${t.hint ? `<span class="np-row-hint">${escapeHtml(t.hint)}</span>` : ''}
      </span>
      <input type="checkbox" class="np-switch" data-np-pref="${escapeHtml(t.key)}" ${prefOn(p, t.key) ? 'checked' : ''}>
    </label>`).join('');

  const channelRows = readable.map((c) => {
    const isPrivate = c.visibility === 'private';
    const level = channelAlertLevel(p, c.key, isPrivateMember(c, uid));
    return `
    <div class="np-row">
      <span class="np-row-text">
        <span class="np-row-label">${escapeHtml(c.emoji || '#')} ${escapeHtml(c.name || c.key)}</span>
        ${isPrivate ? '<span class="np-row-hint">Private channel</span>' : ''}
      </span>
      <select class="np-select" data-np-channel="${escapeHtml(c.key)}" aria-label="Alerts for ${escapeHtml(c.name || c.key)}">
        <option value="all" ${level === 'all' ? 'selected' : ''}>All new threads</option>
        <option value="mentions" ${level === 'mentions' ? 'selected' : ''}>Mentions only</option>
      </select>
    </div>`;
  }).join('');

  root.innerHTML = `
    <div class="np-device" id="np-device">
      <div class="np-row-text">
        <span class="np-row-label">Push on this device</span>
        <span class="np-row-hint" id="np-device-status">Checking…</span>
      </div>
      <button class="btn btn-ghost" type="button" id="np-device-btn" hidden></button>
    </div>
    <h3 class="np-subhead">What notifies you</h3>
    <div class="np-list">${typeRows}</div>
    ${channelRows ? `<h3 class="np-subhead">Channels</h3><div class="np-list">${channelRows}</div>` : ''}
    <div class="profile-save-status" id="np-status" aria-live="polite"></div>
  `;

  const status = root.querySelector('#np-status');
  const flash = (msg) => {
    status.textContent = msg;
    setTimeout(() => { if (status.textContent === msg) status.textContent = ''; }, 2000);
  };

  root.querySelectorAll('[data-np-pref]').forEach((el) => {
    el.addEventListener('change', async () => {
      try {
        await setNotifPref(uid, el.dataset.npPref, el.checked);
        flash('✓ Saved');
      } catch (e) {
        el.checked = !el.checked;
        flash('Couldn\'t save. Try again.');
      }
    });
  });
  root.querySelectorAll('[data-np-channel]').forEach((el) => {
    el.addEventListener('change', async () => {
      try {
        await setChannelAlert(uid, el.dataset.npChannel, el.value);
        flash('✓ Saved');
      } catch (e) {
        flash('Couldn\'t save. Try again.');
      }
    });
  });

  await paintDevice(root, uid, p);
}

async function paintDevice(root, uid, profile) {
  const statusEl = root.querySelector('#np-device-status');
  const btn = root.querySelector('#np-device-btn');
  if (!statusEl || !btn) return;
  btn.hidden = true;

  if (isIosNotInstalled()) {
    statusEl.textContent = 'On iPhone, tap Share, then Add to Home Screen. Open the Academy from there to turn push on.';
    return;
  }
  if (!(await pushAvailable())) {
    statusEl.textContent = 'This browser can\'t receive push. You\'ll still see everything in the bell.';
    return;
  }
  if (Notification.permission === 'denied') {
    statusEl.textContent = 'Blocked in your browser settings. Allow notifications for this site to turn push on.';
    return;
  }

  const on = await pushEnabledHere(profile.fcmTokens);
  statusEl.textContent = on ? 'On. Alerts reach this device even when the site is closed.' : 'Off for this device.';
  btn.textContent = on ? 'Turn off' : 'Turn on';
  btn.hidden = false;
  btn.onclick = async () => {
    btn.disabled = true;
    statusEl.textContent = on ? 'Turning off…' : 'Waiting for you to allow notifications…';
    const res = on ? await disablePush(uid) : await enablePush(uid);
    btn.disabled = false;
    if (!res.ok) {
      statusEl.textContent = PUSH_ERRORS[res.reason] || PUSH_ERRORS.error;
      return;
    }
    // Re-read the saved tokens so the label reflects what the server has.
    const fresh = await getUserProfile(uid);
    if (fresh) profile.fcmTokens = fresh.fcmTokens || [];
    await paintDevice(root, uid, profile);
  };
}
