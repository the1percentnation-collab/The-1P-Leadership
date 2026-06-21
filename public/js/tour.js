// Welcome tour — a one-time guided walkthrough shown to new members the first
// time they reach the dashboard after onboarding. Spotlights the key areas of
// the member portal (navigation, quick access, and the 1PN chat assistant) so
// people know what's available and how to get help.
//
// Trigger model:
//   • onboarding.html sets localStorage['opn_welcome_tour_pending'] = '1' right
//     after a member finishes onboarding (their genuine "first sign-in").
//   • hub.js calls maybeStartWelcomeTour() on the dashboard. The tour runs once,
//     then a per-user "seen" flag prevents it from showing again.
//   • A member can replay it any time via startWelcomeTour() (e.g. a help link).

const SEEN_PREFIX = 'opn_tour_seen_';
const PENDING_KEY = 'opn_welcome_tour_pending';

// Wait (briefly) for a selector to appear — the chatbot FAB is injected
// asynchronously, so the tour shouldn't race it. Resolves null if it never shows.
function waitForEl(selector, timeout = 4000) {
  return new Promise((resolve) => {
    const found = document.querySelector(selector);
    if (found) return resolve(found);
    const started = Date.now();
    const iv = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) { clearInterval(iv); resolve(el); }
      else if (Date.now() - started > timeout) { clearInterval(iv); resolve(null); }
    }, 120);
  });
}

// Auto-run for first-time members only. Honors the per-user "seen" flag so a
// refresh of the dashboard never replays it.
export async function maybeStartWelcomeTour({ user, name } = {}) {
  const uid = (user && user.uid) || 'anon';
  const seenKey = SEEN_PREFIX + uid;
  const pending = localStorage.getItem(PENDING_KEY) === '1';
  const seen = localStorage.getItem(seenKey) === '1';

  // Manual preview: visiting the dashboard with ?tour=1 always replays the
  // tour, ignoring the pending/seen flags. Handy for reviewing the experience.
  const forced = new URLSearchParams(location.search).get('tour') === '1';

  // Only auto-start when this is a fresh first-time arrival and we haven't
  // already walked them through it (unless forced via ?tour=1).
  if (!forced && (!pending || seen)) return;

  // Make sure the chatbot FAB is on the page before we point at it.
  await waitForEl('#opn-fab');

  startWelcomeTour({ name, onDone: () => {
    try {
      localStorage.setItem(seenKey, '1');
      localStorage.removeItem(PENDING_KEY);
    } catch (e) {}
  } });
}

// Mark that the next dashboard visit should show the tour. Called from
// onboarding once a member completes their details.
export function flagWelcomeTourPending() {
  try { localStorage.setItem(PENDING_KEY, '1'); } catch (e) {}
}

const STEPS = (name) => ([
  {
    selector: '.academy-hero',
    title: `Welcome${name ? `, ${name}` : ''} 👋`,
    body: 'This is your Academy home base. Here you\'ll see your daily focus, course progress, and the latest from the community. Let\'s take 30 seconds to show you around.',
    placement: 'bottom'
  },
  {
    selector: '#academy-tabs',
    title: 'Get anywhere fast',
    body: 'Use the top navigation to jump between your Dashboard, Courses, the members Community, the Resource library, and your Profile.',
    placement: 'bottom'
  },
  {
    selector: '.academy-grid',
    title: 'Quick access',
    body: 'These tiles are your shortcuts — pick up a course where you left off, enter the community, browse resources, or update your profile.',
    placement: 'top'
  },
  {
    selector: '#hub-continue-slot',
    title: 'Pick up where you left off',
    body: 'Your current course and next step always live right here, so you can dive back in with one click.',
    placement: 'bottom'
  },
  {
    selector: '#opn-fab',
    title: 'Meet 1PN — your AI assistant',
    body: 'Tap this anytime for help. 1PN can answer questions about the courses, guide your learning, and point you in the right direction. You can <strong>type or tap the mic to speak</strong>, turn on <strong>voice replies</strong>, and even <strong>report a bug</strong> with a screenshot — all from the chat. It\'s always here in the bottom corner.',
    placement: 'left'
  }
]);

let _active = false;

export function startWelcomeTour({ name = '', onDone = () => {} } = {}) {
  if (_active) return;
  const steps = STEPS(name).filter((s) => document.querySelector(s.selector));
  if (steps.length === 0) { onDone(); return; }
  _active = true;

  injectStyles();

  const overlay = document.createElement('div');
  overlay.className = 'opn-tour';
  overlay.innerHTML = `
    <div class="opn-tour-hole" id="opn-tour-hole"></div>
    <div class="opn-tour-card" id="opn-tour-card" role="dialog" aria-modal="true" aria-label="Portal tour">
      <div class="opn-tour-progress" id="opn-tour-progress"></div>
      <h3 class="opn-tour-title" id="opn-tour-title"></h3>
      <p class="opn-tour-body" id="opn-tour-body"></p>
      <div class="opn-tour-actions">
        <button class="opn-tour-skip" id="opn-tour-skip" type="button">Skip</button>
        <div class="opn-tour-nav">
          <button class="opn-tour-back" id="opn-tour-back" type="button">Back</button>
          <button class="opn-tour-next" id="opn-tour-next" type="button">Next</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const hole = overlay.querySelector('#opn-tour-hole');
  const card = overlay.querySelector('#opn-tour-card');
  const titleEl = overlay.querySelector('#opn-tour-title');
  const bodyEl = overlay.querySelector('#opn-tour-body');
  const progressEl = overlay.querySelector('#opn-tour-progress');
  const backBtn = overlay.querySelector('#opn-tour-back');
  const nextBtn = overlay.querySelector('#opn-tour-next');
  const skipBtn = overlay.querySelector('#opn-tour-skip');

  let i = 0;

  function finish() {
    if (!_active) return;
    _active = false;
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
    overlay.classList.add('opn-tour-closing');
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 240);
    try { onDone(); } catch (e) {}
  }

  function reposition() {
    const step = steps[i];
    const target = document.querySelector(step.selector);
    if (!target) return;
    const r = target.getBoundingClientRect();
    const pad = 8;
    const round = step.selector === '#opn-fab' ? '50%' : '12px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.left = (r.left - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (r.height + pad * 2) + 'px';
    hole.style.borderRadius = round;

    // Place the card relative to the target, then clamp into the viewport.
    const vw = window.innerWidth, vh = window.innerHeight;
    const cardW = Math.min(360, vw - 32);
    card.style.width = cardW + 'px';
    const cardH = card.offsetHeight || 200;
    const gap = 16;
    let top, left;
    const place = step.placement || 'bottom';

    if (place === 'bottom') { top = r.bottom + gap; left = r.left; }
    else if (place === 'top') { top = r.top - cardH - gap; left = r.left; }
    else if (place === 'left') { top = r.top; left = r.left - cardW - gap; }
    else { top = r.top; left = r.right + gap; }

    // If there isn't room, flip to the opposite side / center.
    if (top + cardH > vh - 12) top = Math.max(12, r.top - cardH - gap);
    if (top < 12) top = 12;
    if (left + cardW > vw - 12) left = vw - cardW - 12;
    if (left < 12) left = 12;

    card.style.top = top + 'px';
    card.style.left = left + 'px';
  }

  function render() {
    const step = steps[i];
    const target = document.querySelector(step.selector);
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    titleEl.textContent = step.title;
    bodyEl.innerHTML = step.body;
    progressEl.innerHTML = steps.map((_, idx) =>
      `<span class="opn-tour-dot${idx === i ? ' is-on' : ''}"></span>`).join('');
    backBtn.style.visibility = i === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = i === steps.length - 1 ? 'Get started' : 'Next';
    // Let the scroll settle before measuring positions.
    setTimeout(reposition, 180);
  }

  nextBtn.addEventListener('click', () => {
    if (i < steps.length - 1) { i++; render(); } else { finish(); }
  });
  backBtn.addEventListener('click', () => { if (i > 0) { i--; render(); } });
  skipBtn.addEventListener('click', finish);
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') finish(); });
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);

  render();
  setTimeout(() => nextBtn.focus(), 120);
}

function injectStyles() {
  if (document.getElementById('opn-tour-css')) return;
  const el = document.createElement('style');
  el.id = 'opn-tour-css';
  el.textContent = `
.opn-tour {
  position: fixed;
  inset: 0;
  z-index: 10000;
  font-family: 'Outfit', sans-serif;
  animation: opn-tour-fade .25s ease;
}
.opn-tour-closing { animation: opn-tour-fade .24s ease reverse; }
@keyframes opn-tour-fade { from { opacity: 0; } to { opacity: 1; } }

.opn-tour-hole {
  position: fixed;
  top: 0; left: 0;
  width: 0; height: 0;
  border-radius: 12px;
  box-shadow: 0 0 0 9999px rgba(0,0,0,.74), 0 0 0 1.5px rgba(230,3,6,.7);
  transition: top .3s cubic-bezier(.34,1.1,.64,1), left .3s cubic-bezier(.34,1.1,.64,1),
              width .3s cubic-bezier(.34,1.1,.64,1), height .3s cubic-bezier(.34,1.1,.64,1),
              border-radius .3s ease;
  pointer-events: none;
}

.opn-tour-card {
  position: fixed;
  width: 360px;
  max-width: calc(100vw - 32px);
  background:
    linear-gradient(rgba(255,255,255,.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.018) 1px, transparent 1px),
    #0c0c0c;
  background-size: 22px 22px, 22px 22px, auto;
  border: 1px solid rgba(230,3,6,.4);
  border-radius: 16px;
  padding: 20px 20px 16px;
  box-shadow: 0 0 40px rgba(230,3,6,.12), 0 24px 64px rgba(0,0,0,.7);
  transition: top .3s ease, left .3s ease;
}
.opn-tour-progress { display: flex; gap: 6px; margin-bottom: 12px; }
.opn-tour-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: rgba(255,255,255,.18);
  transition: background .2s, transform .2s;
}
.opn-tour-dot.is-on { background: #E60306; transform: scale(1.25); box-shadow: 0 0 8px rgba(230,3,6,.6); }

.opn-tour-title {
  margin: 0 0 8px;
  font-size: 19px;
  font-weight: 700;
  color: #fff;
  line-height: 1.25;
}
.opn-tour-body {
  margin: 0 0 18px;
  font-size: 14px;
  line-height: 1.6;
  color: #c4c4cc;
}
.opn-tour-body strong { color: #fff; font-weight: 600; }

.opn-tour-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.opn-tour-nav { display: flex; gap: 8px; }
.opn-tour-skip, .opn-tour-back, .opn-tour-next {
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 600;
  border-radius: 9px;
  padding: 9px 16px;
  cursor: pointer;
  transition: background .15s, color .15s, border-color .15s, box-shadow .15s;
}
.opn-tour-skip {
  background: none;
  border: none;
  color: #777;
  padding-left: 0;
}
.opn-tour-skip:hover { color: #aaa; }
.opn-tour-back {
  background: none;
  border: 1px solid rgba(255,255,255,.14);
  color: #bbb;
}
.opn-tour-back:hover { border-color: rgba(255,255,255,.3); color: #eee; }
.opn-tour-next {
  background: #E60306;
  border: 1px solid #E60306;
  color: #fff;
  box-shadow: 0 3px 14px rgba(230,3,6,.4);
}
.opn-tour-next:hover { background: #c20205; box-shadow: 0 4px 18px rgba(230,3,6,.6); }

@media (max-width: 600px) {
  .opn-tour-card { left: 16px !important; right: 16px; width: auto !important; }
}
  `;
  document.head.appendChild(el);
}
