// Certificate of completion — the shared pieces used by the in-course player,
// the course roadmap and the printable sheet on /certificate.html.
//
// Everything here is markup + pure functions. Reading progress lives in
// course-progress.js; issuing the record lives in certificate-page.js.

// Local escaper rather than importing the player's — course-player.js imports
// this module, and a cycle here would be needless.
function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const CERT_SIGNER = {
  name: 'Anthony Brown Sr.',
  title: 'Founder, The One Percent Nation'
};

export function certificateHref(slug) {
  return `/certificate.html?course=${encodeURIComponent(slug)}`;
}

// FNV-1a — small, stable, and dependency-free. Not a security primitive; it
// exists so the same member and course always produce the same number.
function hash36(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

/**
 * Certificate number, derived rather than stored, so a reprint always matches
 * the copy already in someone's hands even if the Firestore record is missing.
 */
export function certificateNumber(uid, slug) {
  const part = String(slug || '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 5) || 'COURSE';
  return `1P-${part}-${hash36(`${uid || 'anon'}::${slug || ''}`)}`;
}

export function formatCertDate(date) {
  const d = date instanceof Date && !isNaN(date) ? date : new Date();
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * The certificate itself. Deliberately light-on-dark-page: the sheet prints
 * on paper, so it carries its own white background and dark type rather than
 * inheriting the site's dark theme.
 */
export function certificateSheetHtml({
  name,
  courseTitle,
  courseSubtitle = '',
  dateLabel,
  certNumber,
  signer = CERT_SIGNER
} = {}) {
  return `
    <div class="cert-sheet" id="cert-sheet">
      <div class="cert-inner">
        <div class="cert-head">
          <div class="cert-monogram">1P</div>
          <div class="cert-org">The One Percent Academy</div>
        </div>

        <div class="cert-kicker">Certificate of Completion</div>

        <p class="cert-lead">This is to certify that</p>
        <div class="cert-name">${esc(name || 'Member')}</div>

        <p class="cert-lead">has successfully completed every module of</p>
        <div class="cert-course">${esc(courseTitle || 'The Course')}</div>
        ${courseSubtitle ? `<p class="cert-course-sub">${esc(courseSubtitle)}</p>` : ''}

        <div class="cert-foot">
          <div class="cert-foot-col">
            <div class="cert-foot-val">${esc(dateLabel || '')}</div>
            <div class="cert-foot-lbl">Date completed</div>
          </div>
          <div class="cert-seal">
            <span class="cert-seal-num">1%</span>
            <span class="cert-seal-txt">Better · Every · Day</span>
          </div>
          <div class="cert-foot-col">
            <div class="cert-foot-val cert-sign">${esc(signer.name)}</div>
            <div class="cert-foot-lbl">${esc(signer.title)}</div>
          </div>
        </div>

        <div class="cert-id">Certificate No. ${esc(certNumber || '')}</div>
      </div>
    </div>`;
}

/**
 * The "you finished" panel shown inside the course player once every module is
 * complete, and on the roadmap for a finished course.
 */
export function courseCompleteHtml({ href, courseTitle = '', compact = false } = {}) {
  return `
    <div class="course-done ${compact ? 'is-compact' : ''}">
      <div class="course-done-mark">★</div>
      <div class="course-done-text">
        <div class="course-done-eyebrow">Course complete</div>
        <h3 class="course-done-title">You finished${courseTitle ? ` ${esc(courseTitle)}` : ' the course'}.</h3>
        <p class="course-done-sub">Your certificate of completion is ready to view, print, or save as a PDF.</p>
      </div>
      <a class="course-done-btn" href="${esc(href)}">Get your certificate →</a>
    </div>`;
}
