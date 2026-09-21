// Renders the "Academy Courses" grid on the public homepage (index.html) from
// the live course catalog, showing the courses the owner has switched
// "On main site" in /manage-courses.html (`showOnSite`).
//
// Both live and coming-soon courses are advertised. A coming-soon card is
// badged "Coming Soon" rather than "Enroll Now" and points at the public
// course page, which already offers "Notify me when enrollment opens" for a
// course that isn't live (course-landing.js). Marketing a course before it
// opens is the point: it builds the waitlist.
//
// Why this exists: the section used to be three hand-written <div>s, so
// changing what the public sees meant editing HTML and redeploying — and the
// copy had drifted badly from the real catalog (wrong module counts, a course
// that didn't exist). Rendering from courses-data.js means the homepage can't
// go stale, and the owner controls it with a switch.
//
// Two things about index.html make this trickier than it looks:
//
//   1. index.html does NOT load styles.css — all of its CSS is inlined, and
//      its .course-card/.course-thumb classes are a DIFFERENT set from the
//      ones in styles.css that the member library uses. So this file emits the
//      homepage's own markup shape and can't share courses-page.js's card
//      renderer.
//   2. The scroll/tilt animations in index.html run querySelectorAll once, at
//      parse time. Cards injected later are never picked up, and .fade-up
//      starts at opacity:0 — so without re-hooking them the section renders
//      blank. index.html exposes __1pObserveFades / __1pAttachTilt for that.

import { loadCourses, getCourses } from './courses-data.js';
import { launchDateMs, fmtLaunchDate, launchCountdown } from './launch-date.js';
import { loadCatalog, visibleOn, nextLaunch, hrefFor, isExternal, ctaFor, sortForDisplay } from './catalog.js';

// Firebase is already initialised on this page (chatbot.js imports
// firebase.js), so pulling in courses-data.js costs no extra connection.

const GRID_ID = 'home-courses-grid';
const BANNER_ID = 'launch-banner';
const SHOP_ID = 'home-shop';

// No cap on the number of cards, deliberately: the "On main site" switch is
// meant to be the single control over what the public sees, and a silent
// top-N here would quietly override it. The grid is 3-up on desktop and wraps.

// Alternating thumb backgrounds, matching the hand-written cards this replaces.
const THUMB_BGS = [
  '',
  'linear-gradient(135deg, #0a0a0a 0%, #001a1a 100%)',
  'linear-gradient(135deg, #0a0a0a 0%, #1a0a00 100%)'
];

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Two-letter mark for the card thumbnail, standing in for the cover art the
// catalog doesn't have yet. Picks the most recognisable pair available:
//   "1P Certified Executive Leader" -> 1P   (a leading branded token wins)
//   "Bundle Deal"               -> BD   (multi-word `short`)
//   "Mindset Foundations"       -> MF   (falls through to the title, since
//                                        `short` is the single word "Mindset")
//   "Faith & Leadership"        -> FL   ("&" is not a word)
function words(str) {
  return String(str || '')
    .split(/\s+/)
    .map((w) => w.replace(/[^\w']/g, ''))       // drop "&", ":" etc.
    .filter((w) => w && !/^(the|a|an|of|and|for)$/i.test(w));
}

// Initials of the first two words, or '' when there aren't two — so the caller
// can fall through to a better source rather than settling for "MI".
function pairInitials(str) {
  const w = words(str);
  return w.length >= 2 ? (w[0][0] + w[1][0]).toUpperCase() : '';
}

function monogram(course) {
  // A leading token like "1P" is already a mark — keep it intact.
  const lead = words(course.title)[0] || '';
  if (lead.length === 2 && /\d/.test(lead)) return lead.toUpperCase();

  const single = words(course.short)[0] || words(course.title)[0] || course.slug || '1P';
  return pairInitials(course.short)
    || pairInitials(course.title)
    || single.slice(0, 2).toUpperCase();
}

// `eyebrow` is already authored as "Self-paced · 8 Modules" / "Certification ·
// 7 Modules", which maps straight onto the card's two meta lines. Bold the
// leading token of each half the way the static markup did.
function metaLines(course) {
  const parts = String(course.eyebrow || '')
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  return parts.slice(0, 2).map((part, i) => {
    // "8 Modules" -> "<strong>8</strong> Modules"; otherwise bold the whole
    // fragment ("Self-paced", "Best Value").
    const m = part.match(/^(\S+)\s+(.+)$/);
    const html = m && /^[\d]/.test(m[1])
      ? `<strong>${escapeHtml(m[1])}</strong> ${escapeHtml(m[2])}`
      : `<strong>${escapeHtml(part)}</strong>`;
    return `<div class="course-detail"${i ? ' style="margin-top:4px;"' : ''}>${html}</div>`;
  }).join('');
}

// The badge is the card's one-word status. Availability wins over kind: a
// bundle that isn't open yet reads "Coming Soon", not "Best Value", because
// the visitor can't buy it either way.
//
// A course with a launch date says the date instead of the word. "Coming Soon"
// is a promise nobody can plan around; "Coming Mar 3" is a reason to come back.
// A date that has already passed falls back to the word rather than
// advertising a launch that visibly did not happen.
function badgeLabel(course) {
  if (course.status !== 'live') {
    const ms = launchDateMs(course);
    return (ms != null && launchCountdown(ms)) ? `Coming ${fmtLaunchDate(ms, { short: true })}` : 'Coming Soon';
  }
  return course.bundleHref ? 'Best Value' : 'Enroll Now';
}

function cardHtml(course, i) {
  const slug = encodeURIComponent(course.slug);
  const delay = i > 0 ? ` fade-up-delay-${Math.min(i, 5)}` : '';
  const bg = THUMB_BGS[i % THUMB_BGS.length];

  // The monogram is always rendered and the cover image sits on top, so a
  // cover URL that 404s degrades to the mark rather than a broken image.
  // Same trick as the admin dashboard cards (manage-courses.js).
  const cover = course.coverImage || course.image;
  const coverImg = cover
    ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.remove()"
            style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover;">`
    : '';

  // Bundles have their own sales page; everything else uses the shared public
  // course landing page. A course that isn't live goes to the course page
  // whatever its kind — a bundle sales page would invite a purchase that
  // can't happen, where the course page offers the waitlist instead.
  const isLive = course.status === 'live';
  const href = (isLive && course.bundleHref) || `/course.html?course=${slug}`;

  return `
      <div class="course-card fade-up${delay}">
        <div class="course-thumb">
          <div class="course-thumb-bg"${bg ? ` style="background: ${bg};"` : ''}></div>
          <div class="course-thumb-num">${escapeHtml(monogram(course))}</div>
          ${coverImg}
          <div class="course-thumb-badge${isLive ? '' : ' is-soon'}">${escapeHtml(badgeLabel(course))}</div>
        </div>
        <div class="course-body">
          <div class="course-cat">${escapeHtml(course.category || '')}</div>
          <div class="course-title">${escapeHtml(course.title || '')}</div>
          <p class="course-desc">${escapeHtml(course.subtitle || '')}</p>
          <div class="course-meta">
            <div>${metaLines(course)}</div>
            <a href="${escapeHtml(href)}" class="course-arrow" aria-label="View ${escapeHtml(course.title || 'course')}">→</a>
          </div>
        </div>
      </div>`;
}

// Nothing publishable to show. Hide the section outright rather than leaving
// an empty grid or a heading with no content under it.
//
// The in-page links that point at #courses have to go with it, or the nav
// item and the hero button become dead clicks. "Courses" links are hidden;
// the hero's generic "Start Your Journey" CTA is repointed at the Programs
// section, which is the nearest equivalent, rather than disappearing — it's
// the primary call to action on the page.
function hideCoursesSection(section) {
  section.hidden = true;

  document.querySelectorAll('a[href="#courses"]').forEach((a) => {
    if (a.closest('.hero-actions')) {
      a.setAttribute('href', '#impact');
      return;
    }
    // Hide the whole <li> in the desktop nav so the list doesn't keep its gap.
    (a.closest('li') || a).style.display = 'none';
  });
}

// ── Launch banner ──────────────────────────────────────────────────────────
//
// The strip under the hero announcing the next thing to open — a course or a
// product, whichever is soonest. It is the one place on the marketing site
// that answers "when?" above the fold, so it is driven by the launchDate the
// owner types on the item and nothing else: no date, no banner.
//
// Only the soonest future launch is shown. Stacking every upcoming item here
// would turn the loudest slot on the page into a list, and the visitor only
// has to care about the next one.
function renderLaunchBanner(items) {
  const banner = document.getElementById(BANNER_ID);
  if (!banner) return;

  const next = nextLaunch(items, { channel: 'site' });
  if (!next) {
    banner.hidden = true;
    return;
  }

  const { item, ms } = next;
  const countdown = launchCountdown(ms);
  const href = item.kind === 'product' ? `/upcoming.html#p-${encodeURIComponent(item.id)}` : hrefFor(item, 'site');
  const cta = item.kind === 'product' && item.status === 'preorder' ? 'Pre-order now →' : 'Join the waitlist →';
  banner.innerHTML = `
    <div class="container-wide launch-banner-inner">
      <div class="launch-banner-copy">
        <span class="launch-banner-label">Opening ${escapeHtml(countdown)}</span>
        <span class="launch-banner-title">${escapeHtml(item.title || 'Something new')}</span>
        <span class="launch-banner-date">${escapeHtml(fmtLaunchDate(ms))}</span>
      </div>
      <a class="launch-banner-cta" href="${escapeHtml(href)}">${escapeHtml(cta)}</a>
    </div>`;
  banner.hidden = false;
}

// ── Shop ───────────────────────────────────────────────────────────────────
//
// The books, from the products catalog. This section used to be two blocks
// of hand-written HTML with a hardcoded $49 → $14.99 and a "Coming Soon" block
// whose button linked to itself — while the same coming-soon book already
// existed as a product in the admin. One record now, and the price, the
// sale, the launch date and the button all come from it.
//
// The existing markup shape and classes are kept so the section looks the
// same; only the source of truth moved. Buttons that need sign-in or the
// waitlist modal go to the product's anchor on /upcoming, where both work —
// this page does not load the app stylesheet the modal is styled by.
function bookBlockHtml(item, i) {
  const visual = item.videoUrl
    ? `<div class="book-visual book-visual--video">
         <div class="book-video-frame">
           <video class="book-video"${item.posterUrl ? ` poster="${escapeHtml(item.posterUrl)}"` : ''} preload="metadata" controls playsinline muted loop autoplay
                  aria-label="${escapeHtml(item.title)}">
             <source src="${escapeHtml(item.videoUrl)}" type="video/mp4">
           </video>
         </div>
       </div>`
    : (item.imageUrl
      ? `<div class="book-visual"><img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" style="max-width:100%;border-radius:12px;"></div>`
      : '');

  const cta = ctaFor(item);
  const href = item.externalUrl ? item.externalUrl : `/upcoming.html#p-${encodeURIComponent(item.id)}`;
  const ext = isExternal(href);
  const label = cta.kind === 'notify' ? 'Notify me →' : (cta.kind === 'soldout' ? 'Sold out' : 'Get Your Copy →');

  const live = item.status === 'live' || item.status === 'preorder';
  const tag = item.onSale ? 'On Sale' : (item.status === 'live' ? 'Now Available' : (item.status === 'preorder' ? 'Pre-order' : 'Coming Soon'));

  const priceRow = item.label
    ? `<div class="book-price-row">
         ${item.onSale ? `<div class="book-price-orig">${escapeHtml(item.originalLabel)}</div>` : ''}
         <div class="book-price-now">${escapeHtml(item.label)}</div>
       </div>`
    : '';

  const when = !live && item.launchDateMs && launchCountdown(item.launchDateMs)
    ? `Opens ${escapeHtml(fmtLaunchDate(item.launchDateMs))} — ${escapeHtml(launchCountdown(item.launchDateMs))}.`
    : (!live ? 'A New Book by Anthony Brown — Coming Soon.' : '30-Day Money-Back Guarantee. Zero Risk.');

  // Bebas Neue is caps-only, so the title reads as the old hand-set caps did.
  return `
    <div class="book-section fade-up${i ? ` fade-up-delay-${Math.min(i, 5)}` : ''}${live ? '' : ' book-section--soon'}" id="shop-${escapeHtml(item.id)}">
      <div>
        <div class="book-eyebrow"><span class="tag">${escapeHtml(tag)}</span></div>
        <div class="book-title">${escapeHtml(item.title)}</div>
        ${item.summary ? `<p class="book-desc">${escapeHtml(item.summary)}</p>` : ''}
        ${priceRow}
        <a href="${escapeHtml(href)}" class="btn-primary btn-lg"${ext ? ' target="_blank" rel="noopener"' : ''}${cta.kind === 'soldout' ? ' aria-disabled="true" style="opacity:.6;pointer-events:none;"' : ''}>${escapeHtml(label)}</a>
        <div class="book-guarantee">${when}</div>
      </div>
      ${visual}
    </div>`;
}

function renderShop(items) {
  const host = document.getElementById(SHOP_ID);
  if (!host) return;

  const books = sortForDisplay(items.filter((i) =>
    i.kind === 'product' && i.productType === 'book' && visibleOn(i, 'site')));

  // No book in the catalog yet: leave the hand-written fallback in place
  // rather than blank the section. Once the seed script has run this branch
  // is never taken again.
  if (!books.length) return;

  host.innerHTML = books.map(bookBlockHtml).join('');
  host.removeAttribute('data-fallback');

  // .fade-up starts at opacity:0 and is revealed by index.html's
  // IntersectionObserver. If that hook is ever missing the whole section
  // would render invisible rather than unanimated, so fall back to showing
  // the blocks outright — a section nobody can see is the worse failure.
  if (typeof window.__1pObserveFades === 'function') window.__1pObserveFades(host);
  else host.querySelectorAll('.fade-up').forEach((el) => el.classList.add('visible'));
}

export async function init() {
  const grid = document.getElementById(GRID_ID);
  const section = document.getElementById('courses');
  if (!grid || !section) return;

  try {
    await loadCourses();
  } catch (e) {
    // Fail closed: we can't tell which courses are published, and showing an
    // unpublished one on the marketing site is worse than showing none.
    console.warn('[home-courses] catalog load failed; hiding the section', e);
    hideCoursesSection(section);
    const banner = document.getElementById(BANNER_ID);
    if (banner) banner.hidden = true;
    return;
  }

  // `status` is the publish state set from the builder's Publish menu. 'live'
  // means members can enroll today; 'coming-soon' is announced but not yet
  // open, and is advertised here so the waitlist can build. 'inactive' is the
  // one state that stays off the public site.
  //
  // `showOnSite` is the owner's per-course override on top of that, a
  // default-true opt-out so existing courses needed no backfill.
  // `sellable: false` marks a course sold only inside a bundle, which has its
  // own card — it never gets a second one of its own.
  const PUBLIC_STATUSES = ['live', 'coming-soon'];
  const courses = getCourses().filter(
    (c) => PUBLIC_STATUSES.includes(c.status) && c.showOnSite !== false && c.sellable !== false
  );

  // The banner and the shop read the whole catalog — courses and products —
  // so a book launch can lead the page. Independent of the grid: a launch is
  // worth announcing even in the odd case where the section below ends up
  // empty. Fail-soft: if products cannot be read the courses still render.
  try {
    const items = await loadCatalog();
    renderLaunchBanner(items);
    renderShop(items);
  } catch (e) {
    console.warn('[home-courses] catalog load failed; banner and shop stay as they are', e);
  }

  if (!courses.length) {
    hideCoursesSection(section);
    return;
  }

  grid.innerHTML = courses.map(cardHtml).join('');
  section.hidden = false;

  // Re-hook the animations for the cards we just injected (see header note).
  if (typeof window.__1pObserveFades === 'function') window.__1pObserveFades(grid);
  if (typeof window.__1pAttachTilt === 'function') window.__1pAttachTilt(grid);
}
