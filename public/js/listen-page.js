// The audiobook player (/listen?book=<id>).
//
// Two faces on one page. A member who owns the book gets the player: chapter
// list, speed, a sleep timer, lock-screen controls, their place synced across
// devices, and a private feed for their own podcast app. Anyone else gets the
// sales view: the free sample chapter and the buy button, so a shared
// /listen link sells the book on its own.
//
// Audio streams from /api/book-audio (functions bookAudio). An <audio>
// element cannot send an Authorization header, so the member trades their
// sign-in for a listening pass (audioPass) that rides in the URL instead.

import { firebaseReady, auth, db, functions } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getBook, libraryAccess, loadPosition, createPositionSaver } from './books.js';
import { captureRef, getRefCode } from './referral.js';
import { fmtMoney, priceInfo } from './pricing.js';
import {
  nextSpeed, fmtTime, totalDuration, overallFraction, resumePoint, podcastLinks, productForBook
} from './listen-core.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  collection, getDocs, query, where
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);
const LS_LAST = '1p_listen_last';
const LS_SPEED = '1p_listen_speed';

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

const params = new URLSearchParams(location.search);
const S = {
  user: null,
  book: null,
  bookId: '',
  tracks: [],
  pass: null,
  passExp: 0,
  current: 0,
  pendingSeek: null,
  audio: null,
  saver: null,
  lastSave: 0,
  sleep: 0,            // minutes; -1 = end of chapter
  sleepTimer: null,
  retriedAt: 0,
  wantPlay: false
};

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5.5v13L9.5 12z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5.5v13L14.5 12z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4h-4"/></svg>'
};

function coverHtml(book) {
  return book.coverUrl
    ? `<img class="ls-cover" src="${escapeHtml(book.coverUrl)}" alt="${escapeHtml(book.title || '')} cover">`
    : `<div class="ls-cover ls-cover-fallback">${escapeHtml(book.title || 'Audiobook')}</div>`;
}

function runtimeLabel(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} hr ${m} min` : `${m} min`;
}

function heroHtml(book, extra = '') {
  const total = totalDuration(S.tracks);
  const meta = [
    `${S.tracks.length} chapter${S.tracks.length === 1 ? '' : 's'}`,
    total ? runtimeLabel(total) : ''
  ].filter(Boolean).join(' · ');
  return `
    <section class="ls-hero">
      ${coverHtml(book)}
      <div>
        <div class="ls-kicker">Audiobook</div>
        <h1 class="ls-title">${escapeHtml(book.title || '')}</h1>
        <div class="ls-author">${book.author ? `By ${escapeHtml(book.author)}` : ''}</div>
        <div class="ls-meta">${escapeHtml(meta)}</div>
        ${extra}
      </div>
    </section>`;
}

function empty(title, body, actions = '') {
  $('ls-root').innerHTML = `<div class="ls-empty"><h1>${escapeHtml(title)}</h1>${body}${actions ? `<div style="margin-top:22px;">${actions}</div>` : ''}</div>`;
}

// ── Ownership ───────────────────────────────────────────────────────────
// Right after checkout the webhook can trail the redirect by a few seconds,
// so a returning buyer is checked again for a little while before the page
// decides they don't own it.
// An admin can play every audiobook without buying it. "See the customer
// page" (?as=customer) shows them the sales page instead, and buying from it
// goes through checkout like a customer, so the owner can test a purchase on
// the live site.
async function owns(bookId, { wait = false } = {}) {
  if (!S.user) return false;
  const tries = wait ? 12 : 1;
  const asCustomer = params.get('as') === 'customer' || params.get('buy') === '1';
  for (let i = 0; i < tries; i++) {
    const { ids, admin } = await libraryAccess({ fresh: true });
    if (ids.includes(bookId)) return true;
    if (admin && !asCustomer) { S.adminPlay = true; return true; }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

async function firstOwnedAudiobook() {
  const { ids } = await libraryAccess({ fresh: true });
  for (const id of ids) {
    try { const b = await getBook(id); if (b && b.format === 'audio') return id; } catch (e) {}
  }
  return '';
}

// ── Listening pass ──────────────────────────────────────────────────────
async function ensurePass(force = false) {
  if (!force && S.pass && S.passExp - Date.now() > 30 * 60 * 1000) return S.pass;
  const res = await httpsCallable(functions, 'audioPass')({ bookId: S.bookId });
  S.pass = res.data.pass;
  S.passExp = Number(res.data.expiresAtMs) || 0;
  return S.pass;
}

function srcFor(i) {
  return `/api/book-audio?book=${encodeURIComponent(S.bookId)}&track=${i}${S.pass ? `&pass=${encodeURIComponent(S.pass)}` : ''}`;
}

// ── Player ──────────────────────────────────────────────────────────────
function trackTitle(i) {
  const t = S.tracks[i];
  return (t && t.title) || `Chapter ${i + 1}`;
}

// Synchronous on purpose: iOS only lets play() start inside the tap, so
// nothing may be awaited between the tap and this call.
function loadTrack(i, startAt = 0, autoplay = false) {
  S.current = Math.max(0, Math.min(i, S.tracks.length - 1));
  S.pendingSeek = startAt > 0 ? startAt : null;
  S.wantPlay = autoplay;
  S.audio.src = srcFor(S.current);
  S.audio.playbackRate = Number(lsGet(LS_SPEED)) || 1;
  S.audio.load();
  if (autoplay) S.audio.play().catch(() => {});
  renderNow();
}

function renderNow() {
  $('ls-now').textContent = trackTitle(S.current);
  document.querySelectorAll('.ls-chapters li').forEach((li) => {
    li.classList.toggle('is-current', Number(li.dataset.i) === S.current);
  });
  $('ls-prev').disabled = S.current === 0;
  $('ls-next').disabled = S.current >= S.tracks.length - 1;
  updateMediaSession();
}

function renderPlayState() {
  const playing = !S.audio.paused;
  $('ls-play').innerHTML = playing ? ICON.pause : ICON.play;
  $('ls-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function renderTime() {
  const a = S.audio;
  const dur = isFinite(a.duration) ? a.duration : Number(S.tracks[S.current] && S.tracks[S.current].duration) || 0;
  const seek = $('ls-seek');
  if (dur) seek.max = String(dur);
  if (!seek.matches(':active')) seek.value = String(a.currentTime || 0);
  $('ls-cur').textContent = fmtTime(a.currentTime);
  $('ls-dur').textContent = dur ? `-${fmtTime(Math.max(0, dur - a.currentTime))}` : '';
}

function savePosition(flush = false) {
  if (!S.saver) return;
  const time = S.audio.currentTime || 0;
  S.saver.save({
    cfi: '', bookmarks: [],
    track: S.current,
    time,
    fraction: overallFraction(S.tracks, S.current, time),
    chapter: trackTitle(S.current)
  });
  S.lastSave = Date.now();
  if (flush) S.saver.flush();
}

function skip(sec) {
  const a = S.audio;
  const dur = isFinite(a.duration) ? a.duration : Infinity;
  a.currentTime = Math.max(0, Math.min(dur - 0.5, (a.currentTime || 0) + sec));
}

function setStatus(msg) { const el = $('ls-status'); if (el) el.textContent = msg || ''; }

function sleepLabel() {
  if (!S.sleep) return 'Off';
  if (S.sleep === -1) return 'End of chapter';
  return `${S.sleep} min`;
}

function cycleSleep() {
  const steps = [0, 15, 30, 45, 60, -1];
  S.sleep = steps[(steps.indexOf(S.sleep) + 1) % steps.length];
  clearTimeout(S.sleepTimer);
  if (S.sleep > 0) {
    S.sleepTimer = setTimeout(() => { S.audio.pause(); S.sleep = 0; $('ls-sleep').innerHTML = `Sleep <b>${sleepLabel()}</b>`; setStatus('Sleep timer paused playback.'); }, S.sleep * 60000);
  }
  $('ls-sleep').innerHTML = `Sleep <b>${sleepLabel()}</b>`;
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !S.book) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: trackTitle(S.current),
      artist: S.book.author || 'Anthony Brown Sr.',
      album: S.book.title || '',
      artwork: S.book.coverUrl ? [{ src: S.book.coverUrl, sizes: '512x512' }] : []
    });
  } catch (e) {}
}

function wireMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const on = (action, fn) => { try { ms.setActionHandler(action, fn); } catch (e) {} };
  on('play', () => S.audio.play());
  on('pause', () => S.audio.pause());
  on('seekbackward', (d) => skip(-((d && d.seekOffset) || 15)));
  on('seekforward', (d) => skip((d && d.seekOffset) || 30));
  on('previoustrack', () => { if (S.current > 0) loadTrack(S.current - 1, 0, true); });
  on('nexttrack', () => { if (S.current < S.tracks.length - 1) loadTrack(S.current + 1, 0, true); });
  on('seekto', (d) => { if (d && typeof d.seekTime === 'number') S.audio.currentTime = d.seekTime; });
}

function wireAudio() {
  const a = S.audio;
  a.addEventListener('loadedmetadata', () => {
    if (S.pendingSeek != null) { try { a.currentTime = S.pendingSeek; } catch (e) {} S.pendingSeek = null; }
    renderTime();
  });
  a.addEventListener('play', () => { renderPlayState(); setStatus(''); });
  a.addEventListener('pause', () => { renderPlayState(); savePosition(true); });
  a.addEventListener('waiting', () => setStatus('Loading…'));
  a.addEventListener('playing', () => setStatus(''));
  a.addEventListener('timeupdate', () => {
    renderTime();
    if (Date.now() - S.lastSave > 5000) savePosition();
    if ('mediaSession' in navigator && isFinite(a.duration) && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: a.duration, playbackRate: a.playbackRate, position: Math.min(a.currentTime, a.duration) }); } catch (e) {}
    }
  });
  a.addEventListener('ended', () => {
    if (S.sleep === -1) { S.sleep = 0; $('ls-sleep').innerHTML = `Sleep <b>${sleepLabel()}</b>`; savePosition(true); return; }
    if (S.current < S.tracks.length - 1) loadTrack(S.current + 1, 0, true);
    else { setStatus('You finished the book.'); savePosition(true); }
  });
  // An expired or rotated pass shows up as a load error: fetch a fresh one
  // and pick up at the same second. One retry a minute, so a real outage
  // says so instead of looping.
  a.addEventListener('error', async () => {
    if (Date.now() - S.retriedAt < 60000) {
      setStatus('Playback stopped. Check your connection, then press play.');
      return;
    }
    S.retriedAt = Date.now();
    const at = a.currentTime || S.pendingSeek || 0;
    const resume = S.wantPlay || !a.paused;
    try {
      await ensurePass(true);
      loadTrack(S.current, at, resume);
    } catch (e) {
      setStatus('Playback stopped. Refresh the page to keep listening.');
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePosition(true); });
  window.addEventListener('pagehide', () => savePosition(true));
}

async function renderPlayer() {
  const book = S.book;
  const purchased = params.get('purchase') === 'success';
  $('ls-back').href = '/library';
  $('ls-back').innerHTML = '&larr; My library';
  $('ls-root').innerHTML = `
    ${purchased ? '<div class="ls-toast">It\'s yours. Press play, or add it to your podcast app below. A receipt with this link is on its way to your inbox.</div>' : ''}
    ${S.adminPlay ? `<div class="ls-note" style="text-align:center;margin:0 0 14px;">Admin view: you can play this without buying it. <a href="/listen?book=${encodeURIComponent(S.bookId)}&amp;as=customer">See the customer page</a></div>` : ''}
    ${heroHtml(book)}
    <section class="ls-card" aria-label="Player">
      <div class="ls-now" id="ls-now"></div>
      <label class="sr" for="ls-seek">Position in chapter</label>
      <input class="ls-seek" id="ls-seek" type="range" min="0" max="1" step="1" value="0">
      <div class="ls-times"><span id="ls-cur">0:00</span><span id="ls-dur"></span></div>
      <div class="ls-controls">
        <button class="ls-btn" id="ls-prev" aria-label="Previous chapter">${ICON.prev}</button>
        <button class="ls-btn ls-skip" id="ls-back15" aria-label="Back 15 seconds">${ICON.back}<span>15</span></button>
        <button class="ls-btn ls-play" id="ls-play" aria-label="Play" disabled>${ICON.play}</button>
        <button class="ls-btn ls-skip" id="ls-fwd30" aria-label="Forward 30 seconds">${ICON.fwd}<span>30</span></button>
        <button class="ls-btn" id="ls-next" aria-label="Next chapter">${ICON.next}</button>
      </div>
      <div class="ls-extras">
        <button class="ls-pill" id="ls-speed">Speed <b>${Number(lsGet(LS_SPEED)) || 1}x</b></button>
        <button class="ls-pill" id="ls-sleep">Sleep <b>Off</b></button>
      </div>
      <div class="ls-status" id="ls-status" role="status"></div>
    </section>

    <section class="ls-card" aria-label="Chapters">
      <h2>Chapters</h2>
      <ol class="ls-chapters">
        ${S.tracks.map((t, i) => `
          <li data-i="${i}"><button data-track="${i}">
            <span>${escapeHtml(t.title || `Chapter ${i + 1}`)}</span>
            <span class="d">${Number(t.duration) > 0 ? fmtTime(t.duration) : ''}</span>
          </button></li>`).join('')}
      </ol>
    </section>

    <section class="ls-card" id="ls-podcast" aria-label="Podcast app">
      <h2>Listen in your podcast app</h2>
      <p class="ls-sub">Add this audiobook to the app you already use. Every chapter shows up as an episode, downloads for offline listening, and plays in the car.</p>
      <div id="ls-feed"><div class="ls-note">Getting your private link…</div></div>
    </section>

    <section class="ls-card" id="ls-install" hidden aria-label="Home screen">
      <h2>Put it on your home screen</h2>
      <p class="ls-sub" id="ls-install-how"></p>
      <button class="ls-cta ls-cta-ghost" id="ls-install-btn" hidden>Add to home screen</button>
    </section>`;

  S.audio = new Audio();
  S.audio.preload = 'metadata';
  S.saver = createPositionSaver(S.bookId);
  wireAudio();
  wireMediaSession();

  $('ls-play').addEventListener('click', () => { if (S.audio.paused) { S.wantPlay = true; S.audio.play().catch(() => setStatus('Tap play again to start.')); } else { S.wantPlay = false; S.audio.pause(); } });
  $('ls-back15').addEventListener('click', () => skip(-15));
  $('ls-fwd30').addEventListener('click', () => skip(30));
  $('ls-prev').addEventListener('click', () => loadTrack(S.current - 1, 0, true));
  $('ls-next').addEventListener('click', () => loadTrack(S.current + 1, 0, true));
  $('ls-seek').addEventListener('input', (e) => { S.audio.currentTime = Number(e.target.value) || 0; });
  $('ls-speed').addEventListener('click', () => {
    const s = nextSpeed(Number(lsGet(LS_SPEED)) || 1);
    lsSet(LS_SPEED, String(s));
    S.audio.playbackRate = s;
    $('ls-speed').innerHTML = `Speed <b>${s}x</b>`;
  });
  $('ls-sleep').addEventListener('click', cycleSleep);
  document.querySelectorAll('[data-track]').forEach((b) => b.addEventListener('click', () => {
    loadTrack(Number(b.dataset.track), 0, true);
  }));

  // The pass first, so the first tap on play starts audio at once.
  try {
    await ensurePass();
  } catch (e) {
    setStatus('We couldn\'t start the player. Refresh the page to try again.');
    return;
  }
  const pos = await loadPosition(S.bookId).catch(() => null);
  const rp = resumePoint(S.tracks, pos);
  loadTrack(rp.track, rp.time, false);
  // Held until a chapter is loaded: a tap before then had nothing to play.
  $('ls-play').disabled = false;
  // Named by title: track numbers are not chapter numbers (credits and the
  // Introduction come first), so "chapter 2" would point at the wrong one.
  if (rp.time > 0) setStatus(`Picking up at ${fmtTime(rp.time)} in ${trackTitle(rp.track)}.`);
  else if (rp.track > 0) setStatus(`Picking up at ${trackTitle(rp.track)}.`);
  lsSet(LS_LAST, S.bookId);

  renderFeed();
  renderInstall();
}

// ── Private podcast feed ────────────────────────────────────────────────
async function renderFeed(reset = false) {
  const host = $('ls-feed');
  let url = '';
  try {
    const res = await httpsCallable(functions, 'audioFeedLink')({ bookId: S.bookId, reset });
    url = res.data.feedUrl;
  } catch (e) {
    host.innerHTML = '<div class="ls-note">Your podcast link didn\'t load. <button class="ls-link" id="ls-feed-retry">Try again</button></div>';
    $('ls-feed-retry').addEventListener('click', () => renderFeed());
    return;
  }
  host.innerHTML = `
    <div class="ls-apps">
      ${podcastLinks(url).map((l) => `<a class="ls-app" href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a>`).join('')}
    </div>
    <div class="ls-feed-row">
      <label class="sr" for="ls-feed-url">Your private feed link</label>
      <input id="ls-feed-url" readonly value="${escapeHtml(url)}">
      <button class="ls-ghost" id="ls-feed-copy">Copy link</button>
    </div>
    <div class="ls-note">
      Using another app? Copy the link and choose “Add a show by URL” (Apple Podcasts: Library, then the ••• menu, then Follow a Show by URL).
      Spotify and Audible don't accept private links, so for those just play it here.
      This link is yours alone. If it ever gets shared, <button class="ls-link" id="ls-feed-reset">make a new one</button> and the old one stops working.
    </div>`;
  $('ls-feed-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); $('ls-feed-copy').textContent = 'Copied ✓'; }
    catch (e) { $('ls-feed-url').select(); }
  });
  $('ls-feed-reset').addEventListener('click', () => {
    if (!confirm('Make a new private link? The old one stops working in every app that uses it, and you will add the new one again.')) return;
    renderFeed(true);
  });
}

// ── Home screen ─────────────────────────────────────────────────────────
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  const btn = $('ls-install-btn');
  if (btn) { btn.hidden = false; $('ls-install').hidden = false; }
});

function renderInstall() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) return;
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  if (!ios && !android && !deferredInstall) return;
  $('ls-install').hidden = false;
  $('ls-install-how').textContent = ios
    ? 'Open this page in Safari, tap the Share button, then “Add to Home Screen”. It opens straight to your audiobook, full screen, like an app.'
    : 'One tap and it opens straight to your audiobook, full screen, like an app. If no button shows, open your browser menu and choose “Add to Home screen”.';
  const btn = $('ls-install-btn');
  if (deferredInstall) btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) {}
    deferredInstall = null;
    btn.hidden = true;
  });
}

// ── Sales view ──────────────────────────────────────────────────────────
async function findProduct() {
  try {
    const snap = await getDocs(query(collection(db, 'products'), where('status', '==', 'live')));
    return productForBook(snap.docs.map((d) => ({ id: d.id, ...d.data() })), S.bookId);
  } catch (e) {
    console.warn('[listen] product lookup failed', e);
    return null;
  }
}

// ── Price, sale and promo code ──────────────────────────────────────────
// The button shows what checkout will charge: the sale price while a sale
// runs (Manage Products → On sale), less a promo code once one is applied.
// The server prices it again from the same records; this is only the label.
// A code can arrive in the link (?promo=LAUNCH20) so a discount can be shared.
const promo = { code: (params.get('promo') || '').trim().toUpperCase(), price: null, note: '' };

function buyLabel(product) {
  const info = priceInfo(product);
  // A comp code: no payment page, the book goes straight to their library.
  if (promo.price === 0) return `Get it free · <s style="opacity:.65;font-weight:500;">${escapeHtml(info.label)}</s>`;
  const now = promo.price != null ? fmtMoney(promo.price) : info.label;
  const was = promo.price != null ? info.label : (info.onSale ? info.originalLabel : '');
  return `Get the audiobook · ${was ? `<s style="opacity:.65;font-weight:500;margin-right:4px;">${escapeHtml(was)}</s>` : ''}${escapeHtml(now)}`;
}

function signInFirst(extra) {
  const code = promo.code ? `&promo=${encodeURIComponent(promo.code)}` : '';
  location.assign('/login.html?next=' + encodeURIComponent(`/listen?book=${S.bookId}${code}${extra}`));
}

async function applyPromo(product) {
  const msg = $('ls-promo-msg');
  const code = ($('ls-promo-code').value || '').trim().toUpperCase();
  if (!code) { msg.textContent = 'Type the code first.'; return; }
  promo.code = code;
  if (!S.user) { signInFirst(''); return; }
  const btn = $('ls-promo-apply');
  btn.disabled = true;
  msg.textContent = 'Checking…';
  try {
    const r = await httpsCallable(functions, 'validateCoupon')({ code, kind: 'product', id: product.id });
    promo.price = r.data.isFree ? 0 : r.data.discountedPrice;
    const off = r.data.isFree ? 'the full audiobook, free'
      : r.data.percentOff ? `${r.data.percentOff}% off` : `${fmtMoney(r.data.amountOff)} off`;
    msg.innerHTML = `<b>${escapeHtml(r.data.code)}</b> applied: ${escapeHtml(off)}. <button class="ls-link" id="ls-promo-remove">Remove</button>`;
    $('ls-promo-remove').addEventListener('click', () => {
      promo.code = ''; promo.price = null;
      $('ls-promo-code').value = '';
      msg.textContent = '';
      $('ls-buy').innerHTML = buyLabel(product);
    });
  } catch (e) {
    promo.code = ''; promo.price = null;
    msg.textContent = (e && e.message) || 'That code did not work.';
  } finally {
    btn.disabled = false;
    $('ls-buy').innerHTML = buyLabel(product);
  }
}

async function startCheckout(product, btn) {
  if (!S.user) { signInFirst('&buy=1'); return; }
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = promo.price === 0 ? 'Adding it to your library…' : 'Opening checkout…';
  try {
    const res = await httpsCallable(functions, 'createCheckoutSession')({
      productId: product.id,
      refCode: getRefCode() || undefined,
      couponCode: promo.price != null ? promo.code : undefined,
      returnTo: `/listen?book=${S.bookId}`
    });
    if (!res.data || !res.data.url) throw new Error('Checkout could not be started.');
    location.assign(res.data.url);
  } catch (e) {
    if (e && /already-exists/.test(e.code || '')) { location.replace(`/listen?book=${encodeURIComponent(S.bookId)}`); return; }
    btn.disabled = false;
    btn.innerHTML = label;
    alert(e.message || 'Could not start checkout. Please try again.');
  }
}

async function renderSales() {
  const book = S.book;
  $('ls-back').href = S.user ? '/library' : '/';
  $('ls-back').innerHTML = S.user ? '&larr; My library' : '&larr; Home';
  const product = await findProduct();
  const sample = Number.isInteger(book.sampleTrack) && book.sampleTrack < S.tracks.length ? book.sampleTrack : null;

  $('ls-root').innerHTML = `
    ${heroHtml(book)}
    <section class="ls-card">
      ${product
        ? `<button class="ls-cta" id="ls-buy">${buyLabel(product)}</button>
           <div class="ls-promo">
             <button class="ls-link" id="ls-promo-open"${promo.code ? ' hidden' : ''}>Have a promo code?</button>
             <div class="ls-promo-row" id="ls-promo-row"${promo.code ? '' : ' hidden'}>
               <label class="sr" for="ls-promo-code">Promo code</label>
               <input id="ls-promo-code" autocomplete="off" autocapitalize="characters" placeholder="Promo code" value="${escapeHtml(promo.code)}">
               <button class="ls-ghost" id="ls-promo-apply">Apply</button>
             </div>
             <div class="ls-note" id="ls-promo-msg" role="status"></div>
           </div>`
        : '<button class="ls-cta" disabled>Coming soon</button>'}
      <ul class="ls-points">
        <li>Plays right here in your browser on your phone, tablet or laptop. No app to install.</li>
        <li>Add it to Apple Podcasts, Overcast, Pocket Casts or Castro with one tap, and listen offline in the car.</li>
        <li>Picks up where you stopped, on any device. Speed control and a sleep timer included.</li>
        <li>Yours to keep. One payment, no subscription.</li>
      </ul>
    </section>
    ${sample != null ? `
    <section class="ls-card ls-sample">
      <h2>Preview: ${escapeHtml(S.tracks[sample].title || `Chapter ${sample + 1}`)}</h2>
      <p class="ls-sub">Press play. No account needed.</p>
      <audio controls preload="none" src="/api/book-audio?book=${encodeURIComponent(S.bookId)}&track=${sample}"></audio>
    </section>` : ''}
    ${book.description ? `
    <section class="ls-card">
      <h2>About the book</h2>
      <p class="ls-desc">${escapeHtml(book.description)}</p>
    </section>` : ''}`;

  if (product) {
    const btn = $('ls-buy');
    btn.addEventListener('click', () => startCheckout(product, btn));
    $('ls-promo-open').addEventListener('click', () => {
      $('ls-promo-open').hidden = true;
      $('ls-promo-row').hidden = false;
      $('ls-promo-code').focus();
    });
    $('ls-promo-apply').addEventListener('click', () => applyPromo(product));
    $('ls-promo-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPromo(product); });
    // A code from the link (or carried through sign-in) is checked right away.
    if (promo.code && S.user) await applyPromo(product);
    // Back from sign-in after tapping the buy button: carry on to checkout.
    // Nothing else opens checkout without a tap.
    if (params.get('buy') === '1' && S.user) startCheckout(product, btn);
  }
}

// ── Boot ────────────────────────────────────────────────────────────────
async function main() {
  captureRef();
  if (!firebaseReady) { empty('The player is offline', '<p>Refresh the page in a moment.</p>'); return; }
  S.user = await onAuthReady();

  S.bookId = (params.get('book') || '').trim();
  if (!S.bookId && S.user) S.bookId = lsGet(LS_LAST) || await firstOwnedAudiobook();
  if (!S.bookId) {
    if (!S.user) { location.replace('/login.html?next=' + encodeURIComponent('/listen')); return; }
    empty('No audiobooks yet', '<p>Audiobooks you own show up here, ready to play.</p>', '<a class="ls-ghost" href="/library">Go to my library</a>');
    return;
  }

  try { S.book = await getBook(S.bookId); } catch (e) { S.book = null; }
  if (S.book && S.book.format !== 'audio') { location.replace(`/read?book=${encodeURIComponent(S.bookId)}`); return; }
  const owned = await owns(S.bookId, { wait: params.get('purchase') === 'success' });
  if (!S.book || (S.book.status === 'hidden' && !owned)) {
    empty('We couldn\'t find that audiobook', '<p>It may have moved. Your library has everything you own.</p>', '<a class="ls-ghost" href="/library">Go to my library</a>');
    return;
  }
  S.tracks = Array.isArray(S.book.tracks) ? S.book.tracks : [];
  document.title = `${S.book.title || 'Audiobook'} | The One Percent Library`;
  if (!S.tracks.length) {
    empty(S.book.title || 'Audiobook', '<p>The chapters are still being uploaded. Check back soon.</p>');
    return;
  }

  if (owned) {
    await renderPlayer();
  } else if (params.get('purchase') === 'success') {
    empty('Finishing your purchase', '<p>Your payment went through. It can take a minute to reach your library; refresh this page shortly. Your receipt email has the link too.</p>',
      '<a class="ls-ghost" href="">Refresh</a>');
  } else {
    await renderSales();
  }
}

main();
