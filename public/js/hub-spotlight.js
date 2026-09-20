// Spotlight — the rotating hero rail at the top of the dashboard.
//
// Source-agnostic on purpose: it takes an array of already-normalized slides
// and owns nothing but presentation, autoplay and navigation. hub.js decides
// what a slide is; this decides how one behaves.
//
// Built on native scroll + scroll-snap rather than transforms. That buys
// real touch swipe, real keyboard scrolling and real accessibility for free,
// which a transform track would each have to reimplement badly.

const AUTOPLAY_MS = 7000;

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch (e) { return false; }
}

/**
 * A slide:
 *   { id, kind, eyebrow, title, body, imageUrl, ctaLabel, ctaHref,
 *     external?, meta?, priority?, sortAt? }
 *
 * `kind` is cosmetic (it colours the eyebrow); `sortAt` is the millisecond
 * timestamp used to break priority ties.
 */
function slideHtml(s, index) {
  const art = s.imageUrl
    ? `<div class="hub-spot-art"><img src="${escapeHtml(s.imageUrl)}" alt="" loading="${index === 0 ? 'eager' : 'lazy'}"></div>`
    : `<div class="hub-spot-art is-empty" aria-hidden="true"><span>${escapeHtml((s.title || '1P').slice(0, 1).toUpperCase())}</span></div>`;

  const cta = s.ctaHref
    ? `<a class="btn btn-primary hub-spot-cta" href="${escapeHtml(s.ctaHref)}"${s.external ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(s.ctaLabel || 'Open')} →</a>`
    : '';

  return `
    <article class="hub-spot-slide" role="group" aria-roledescription="slide"
             aria-label="${escapeHtml(s.title || 'Announcement')}" data-index="${index}">
      ${art}
      <div class="hub-spot-body">
        <div class="hub-spot-eyebrow hub-spot-kind-${escapeHtml(s.kind || 'announcement')}">${escapeHtml(s.eyebrow || 'Announcement')}</div>
        <h3 class="hub-spot-title">${escapeHtml(s.title || '')}</h3>
        ${s.body ? `<p class="hub-spot-text">${escapeHtml(s.body)}</p>` : ''}
        ${s.meta ? `<div class="hub-spot-meta">${escapeHtml(s.meta)}</div>` : ''}
        ${cta}
      </div>
    </article>
  `;
}

/**
 * Render the carousel into `root` (the section element). Returns a handle
 * with destroy(), or null when there is nothing to show — in which case the
 * section is left hidden and the dashboard simply closes the gap.
 */
export function renderSpotlight(root, slides) {
  if (!root) return null;
  const list = (slides || []).filter(Boolean);
  if (!list.length) {
    root.hidden = true;
    return null;
  }

  root.hidden = false;
  root.innerHTML = `
    <div class="hub-spot" role="region" aria-roledescription="carousel" aria-label="Academy spotlight">
      <div class="hub-spot-track" tabindex="0">
        ${list.map(slideHtml).join('')}
      </div>
      ${list.length > 1 ? `
        <button class="hub-spot-nav is-prev" type="button" aria-label="Previous slide">‹</button>
        <button class="hub-spot-nav is-next" type="button" aria-label="Next slide">›</button>
        <div class="hub-spot-dots" role="tablist" aria-label="Choose slide">
          ${list.map((s, i) => `
            <button class="hub-spot-dot${i === 0 ? ' is-active' : ''}" type="button" role="tab"
                    aria-label="Slide ${i + 1} of ${list.length}"
                    aria-selected="${i === 0 ? 'true' : 'false'}" data-goto="${i}"></button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;

  const track = root.querySelector('.hub-spot-track');
  const dots = Array.from(root.querySelectorAll('.hub-spot-dot'));
  const prev = root.querySelector('.hub-spot-nav.is-prev');
  const next = root.querySelector('.hub-spot-nav.is-next');
  let current = 0;
  let timer = null;
  let destroyed = false;

  function slideAt(i) { return track.children[i] || null; }

  function goTo(i, { smooth = true } = {}) {
    const n = list.length;
    const target = ((i % n) + n) % n; // wrap in both directions
    const el = slideAt(target);
    if (!el) return;
    // scrollTo on the track, not scrollIntoView on the slide — the latter
    // scrolls the whole page to the carousel, which is jarring on autoplay.
    track.scrollTo({ left: el.offsetLeft - track.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    setActive(target);
  }

  function setActive(i) {
    current = i;
    dots.forEach((d, di) => {
      d.classList.toggle('is-active', di === i);
      d.setAttribute('aria-selected', di === i ? 'true' : 'false');
    });
  }

  // Keep the dots honest when the member swipes the track directly.
  let scrollTick = null;
  track.addEventListener('scroll', () => {
    if (scrollTick) clearTimeout(scrollTick);
    scrollTick = setTimeout(() => {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < track.children.length; i++) {
        const d = Math.abs((track.children[i].offsetLeft - track.offsetLeft) - track.scrollLeft);
        if (d < bestDist) { bestDist = d; best = i; }
      }
      setActive(best);
    }, 90);
  }, { passive: true });

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function start() {
    // One slide has nothing to rotate to, and reduced-motion means the member
    // asked us not to move things on our own.
    if (destroyed || list.length < 2 || prefersReducedMotion()) return;
    stop();
    timer = setInterval(() => goTo(current + 1), AUTOPLAY_MS);
  }

  if (prev) prev.addEventListener('click', () => { stop(); goTo(current - 1); });
  if (next) next.addEventListener('click', () => { stop(); goTo(current + 1); });
  dots.forEach((d) => d.addEventListener('click', () => {
    stop();
    goTo(Number(d.dataset.goto) || 0);
  }));

  track.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); stop(); goTo(current + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); goTo(current - 1); }
  });

  // Pause while the member is actually looking at or touching a slide; resume
  // when they leave. Focus counts as attention too, for keyboard users.
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', start);
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', start);
  track.addEventListener('touchstart', stop, { passive: true });

  // A carousel rotating in a background tab is pure waste.
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  // Slides are one track-width each, so any resize — rotating a phone, most
  // of all — leaves the scroll position parked between two of them and clips
  // both. Re-anchor on whichever slide was showing.
  let resizeTick = null;
  const onResize = () => {
    if (resizeTick) clearTimeout(resizeTick);
    resizeTick = setTimeout(() => goTo(current, { smooth: false }), 120);
  };
  window.addEventListener('resize', onResize);

  start();

  return {
    goTo,
    destroy() {
      destroyed = true;
      stop();
      if (resizeTick) clearTimeout(resizeTick);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    }
  };
}
