// The assessment prompt: a one-time invitation to take a free assessment.
//
// Drop on a marketing page with:
//   <script type="module" src="/js/assessment-prompt.js"></script>
// When it opens is decided in assessment-prompt-core.js. This file gathers the
// signals (visible time, scroll depth, pages seen, desktop exit intent), draws
// the dialog and, after "Not right now", a small tab that keeps the offer one
// click away. It never opens over the cookie banner or the open chat panel.
import { decide, showPill, promptUtm, STORE_KEY } from './assessment-prompt-core.js';

const SESSION_KEY = '1p-prompt-s';
const UTM_KEY = '1p-utm'; // shared with assessment-page.js

const CHOICES = [
  { key: 'me', slug: 'alignment-scorecard', label: 'For me', title: 'The Alignment Scorecard', line: 'Where the life you built and the life you want are out of step.' },
  { key: 'team', slug: 'team-alignment', label: 'For my team', title: 'The Team Alignment Assessment', line: 'Where your team is moving together, and where it is not.' }
];

const read = (store, key) => { try { return JSON.parse(store.getItem(key) || 'null') || {}; } catch (e) { return {}; } };
const write = (store, key, val) => { try { store.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode */ } };
const track = (name, params) => { try { if (typeof gtag === 'function') gtag('event', name, params || {}); } catch (e) { /* analytics never breaks the page */ } };

const local = read(localStorage, STORE_KEY);
const session = Object.assign({ activeMs: 0, pageViews: 0 }, read(sessionStorage, SESSION_KEY));
session.pageViews += 1;
write(sessionStorage, SESSION_KEY, session);

// Keep the campaign a visitor landed on, so an ad click that reaches an
// assessment through the prompt is still credited to the ad.
(function keepUtm() {
  const p = new URLSearchParams(location.search);
  const fresh = { source: p.get('utm_source'), medium: p.get('utm_medium'), campaign: p.get('utm_campaign') };
  if (fresh.source || fresh.campaign) write(sessionStorage, UTM_KEY, fresh);
})();

let maxScroll = 0;
let exitIntent = false;
let root = null;
let pill = null;
let lastFocus = null;

const consentPending = () => !!document.querySelector('[aria-label="Cookie consent"]');
const chatOpen = () => { const f = document.getElementById('opn-fab'); return !!f && f.getAttribute('aria-expanded') === 'true'; };
const isSheet = () => window.matchMedia('(max-width: 640px)').matches;

function signals() {
  return {
    path: location.pathname,
    now: Date.now(),
    activeMs: session.activeMs,
    scrollPct: maxScroll,
    pageViews: session.pageViews,
    exitIntent,
    consentPending: consentPending() || chatOpen(),
    shownThisSession: !!session.shown,
    pillClosed: !!session.pillClosed,
    store: local
  };
}

function measureScroll() {
  const doc = document.documentElement;
  const total = doc.scrollHeight - window.innerHeight;
  const pct = total <= 0 ? 100 : Math.round((window.scrollY / total) * 100);
  if (pct > maxScroll) maxScroll = pct;
}

// ── Styles (self-contained, so any page can host the prompt) ───────────────
function injectStyles() {
  if (document.getElementById('ap-styles')) return;
  const css = `
.ap-overlay{position:fixed;inset:0;z-index:99990;background:rgba(0,0,0,.66);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;transition:opacity .35s ease}
.ap-overlay.on{opacity:1}
.ap-dialog{position:fixed;z-index:99991;left:50%;top:50%;width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;transform:translate(-50%,-46%);opacity:0;transition:transform .45s cubic-bezier(.16,1,.3,1),opacity .35s ease;background:#0F0F0F;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6);padding:34px 32px 24px;font-family:'Outfit',system-ui,sans-serif}
.ap-dialog.on{transform:translate(-50%,-50%);opacity:1}
.ap-dialog::before{content:"";position:absolute;left:32px;right:32px;top:0;height:2px;background:linear-gradient(90deg,transparent,#E60306,transparent)}
.ap-x{position:absolute;top:12px;right:12px;width:40px;height:40px;border-radius:50%;border:0;background:transparent;color:#A0A0A0;font-size:24px;line-height:1;cursor:pointer}
.ap-x:hover,.ap-x:focus-visible{color:#fff;background:rgba(255,255,255,.08)}
.ap-eyebrow{font-family:'Space Mono',ui-monospace,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#ff5a5c}
.ap-title{font-family:'Bebas Neue',Impact,'Arial Narrow',sans-serif;font-weight:400;font-size:clamp(38px,7vw,52px);line-height:.95;letter-spacing:.01em;margin:10px 0 12px}
.ap-title span{color:#E60306}
.ap-body{color:#B4B4B4;font-size:16px;line-height:1.55;margin:0 0 22px}
.ap-choices{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ap-choice{display:flex;flex-direction:column;gap:6px;padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#151515;color:#fff;text-decoration:none;transition:border-color .2s,transform .2s,background .2s}
.ap-choice:hover,.ap-choice:focus-visible{border-color:#E60306;background:#1A1A1A;transform:translateY(-2px);outline:none}
.ap-choice b{font-family:'Space Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#ff5a5c;font-weight:700}
.ap-choice strong{font-size:16px;font-weight:600;line-height:1.25}
.ap-choice small{font-size:13.5px;color:#A0A0A0;line-height:1.45}
.ap-choice em{font-style:normal;font-weight:600;font-size:14px;margin-top:auto;padding-top:6px}
.ap-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:18px;font-size:14px}
.ap-later{border:0;background:transparent;color:#A0A0A0;font:inherit;cursor:pointer;padding:8px 0}
.ap-later:hover,.ap-later:focus-visible{color:#fff}
.ap-all{color:#fff;text-decoration:none;border-bottom:1px solid rgba(230,3,6,.6)}
.ap-pill{position:fixed;z-index:9990;left:max(20px,env(safe-area-inset-left,0px));bottom:max(24px,env(safe-area-inset-bottom,0px));display:flex;align-items:center;border-radius:999px;background:#0F0F0F;border:1px solid rgba(230,3,6,.55);box-shadow:0 10px 30px rgba(0,0,0,.45);font-family:'Outfit',system-ui,sans-serif;opacity:0;transform:translateY(10px);transition:opacity .35s ease,transform .35s ease}
.ap-pill.on{opacity:1;transform:none}
.ap-pill button{border:0;background:transparent;color:#fff;font:inherit;cursor:pointer}
.ap-pill .ap-pill-open{padding:11px 6px 11px 16px;font-size:14px;font-weight:600}
.ap-pill .ap-pill-open span{color:#ff5a5c;font-weight:500}
.ap-pill .ap-pill-x{padding:11px 14px 11px 8px;color:#7A7A7A;font-size:18px;line-height:1}
.ap-pill .ap-pill-x:hover{color:#fff}
@media (max-width:640px){
  .ap-overlay{display:none}
  .ap-dialog{left:0;right:0;top:auto;bottom:0;width:100%;max-height:78vh;transform:translateY(100%);border-radius:20px 20px 0 0;border-bottom:0;padding:28px 20px calc(18px + env(safe-area-inset-bottom,0px))}
  .ap-dialog.on{transform:none}
  .ap-dialog::before{left:20px;right:20px}
  .ap-wide,.ap-choice small,.ap-choice em{display:none}
  .ap-choices{grid-template-columns:1fr;gap:10px}
  .ap-choice{padding:12px 44px 12px 14px;gap:3px;position:relative}
  .ap-choice::after{content:"\\2192";position:absolute;right:16px;top:50%;transform:translateY(-50%);font-weight:600}
  .ap-title{font-size:38px;margin:8px 0 10px}
  .ap-body{font-size:15px;margin-bottom:14px}
  .ap-foot{margin-top:12px}
}
@media (prefers-reduced-motion:reduce){.ap-overlay,.ap-dialog,.ap-pill,.ap-choice{transition:none}}`;
  const style = document.createElement('style');
  style.id = 'ap-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

// ── The dialog ─────────────────────────────────────────────────────────────
function link(choice) {
  return `/assessments/${choice.slug}${promptUtm(read(sessionStorage, UTM_KEY), choice.key)}`;
}

function open(trigger) {
  if (root) return;
  injectStyles();
  hidePill();
  lastFocus = document.activeElement;
  const sheet = isSheet();
  root = document.createElement('div');
  root.innerHTML = `
    <div class="ap-overlay" data-ap="dismiss"></div>
    <div class="ap-dialog" role="dialog" aria-modal="${sheet ? 'false' : 'true'}" aria-labelledby="ap-title" aria-describedby="ap-body">
      <button class="ap-x" type="button" data-ap="dismiss" aria-label="Close">&times;</button>
      <div class="ap-eyebrow">Free &middot; 5 minutes<span class="ap-wide"> &middot; Your score and a plan</span></div>
      <h2 class="ap-title" id="ap-title">Where do you actually <span>stand?</span></h2>
      <p class="ap-body" id="ap-body">Successful on paper does not always mean aligned in practice. Answer a few honest questions and leave with your score and one clear next step you can start this week.</p>
      <div class="ap-choices">
        ${CHOICES.map((c) => `<a class="ap-choice" href="${link(c)}" data-ap-choice="${c.key}">
          <b>${c.label}</b><strong>${c.title}</strong><small>${c.line}</small><em>Start &rarr;</em>
        </a>`).join('')}
      </div>
      <div class="ap-foot">
        <button class="ap-later" type="button" data-ap="dismiss">Not right now</button>
        <a class="ap-all" href="/assessments" data-ap-choice="library">Browse all assessments</a>
      </div>
    </div>`;
  document.body.appendChild(root);

  session.shown = Date.now();
  write(sessionStorage, SESSION_KEY, session);
  track('assessment_prompt_shown', { trigger, layout: sheet ? 'sheet' : 'modal' });

  root.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-ap-choice]');
    if (choice) {
      local.convertedAt = Date.now();
      write(localStorage, STORE_KEY, local);
      track('assessment_prompt_click', { choice: choice.dataset.apChoice, trigger });
      return; // the link navigates
    }
    if (e.target.closest('[data-ap="dismiss"]')) dismiss('button', trigger);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); dismiss('escape', trigger); }
    if (e.key === 'Tab') trapFocus(e);
  });

  requestAnimationFrame(() => {
    root.querySelectorAll('.ap-overlay,.ap-dialog').forEach((el) => el.classList.add('on'));
    const first = root.querySelector('.ap-choice');
    if (first) first.focus({ preventScroll: true });
  });
}

function trapFocus(e) {
  const items = root.querySelectorAll('.ap-dialog a, .ap-dialog button');
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function dismiss(how, trigger) {
  if (!root) return;
  local.dismissedAt = Date.now();
  write(localStorage, STORE_KEY, local);
  track('assessment_prompt_dismiss', { how, trigger });
  const el = root;
  root = null;
  el.querySelectorAll('.on').forEach((n) => n.classList.remove('on'));
  setTimeout(() => el.remove(), 400);
  if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  renderPill();
}

// ── The tab after "Not right now" ──────────────────────────────────────────
function renderPill() {
  if (pill || root || !showPill(signals()) || consentPending()) return;
  injectStyles();
  pill = document.createElement('div');
  pill.className = 'ap-pill';
  pill.innerHTML = `<button class="ap-pill-open" type="button">Free assessment <span>&middot; 5 min</span></button>
    <button class="ap-pill-x" type="button" aria-label="Hide for now">&times;</button>`;
  pill.querySelector('.ap-pill-open').addEventListener('click', () => {
    track('assessment_prompt_pill_open');
    open('pill');
  });
  pill.querySelector('.ap-pill-x').addEventListener('click', () => {
    session.pillClosed = true;
    write(sessionStorage, SESSION_KEY, session);
    hidePill();
  });
  document.body.appendChild(pill);
  requestAnimationFrame(() => pill && pill.classList.add('on'));
}

function hidePill() {
  if (!pill) return;
  pill.remove();
  pill = null;
}

// ── Signals ────────────────────────────────────────────────────────────────
function check() {
  if (root) return;
  const trigger = decide(signals());
  if (trigger) { stop(); open(trigger); }
}

const tick = setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  session.activeMs += 1000;
  write(sessionStorage, SESSION_KEY, session);
  if (!pill) renderPill(); // waits out the cookie banner
  check();
}, 1000);

function onExit(e) {
  if (e.relatedTarget || e.clientY > 0) return;
  exitIntent = true;
  check();
  exitIntent = false;
}

function stop() {
  clearInterval(tick);
  window.removeEventListener('scroll', measureScroll);
  document.removeEventListener('mouseout', onExit);
}

measureScroll();
window.addEventListener('scroll', measureScroll, { passive: true });
// Exit intent only means something with a mouse: on touch there is no
// cursor heading for the tab bar.
if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) document.addEventListener('mouseout', onExit);
