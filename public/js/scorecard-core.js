// Alignment Scorecard: the shape, the rules, and the printed document.
//
// The Alignment Audit promises "a one-page Alignment Scorecard, in your hands
// within 48 hours." Written freehand, every one would look different and take
// as long as the blank page does. This fixes the frame: the same six areas
// the Team Alignment Assessment measures, the same rating scale, the same
// plan and recommendation blocks, in the same co-branded layout. Anthony
// writes the findings and the solutions; the format is never his job.
//
// Pure by design (no Firebase, no DOM): scorecards.js loads and saves, this
// decides what a scorecard is and how it prints, so tests can pin both.

import teamAlignment from './assessments/team-alignment.js';

// The six areas, taken from the Team Alignment Assessment so the audit and
// the free assessment speak the same language. A leader who took the
// assessment sees the same words on their scorecard.
export const AREAS = teamAlignment.dimensions.map((d) => ({ key: d.key, label: d.label, desc: d.desc }));

// 0 means the area did not come up in the session. It prints as "Not
// assessed" and is left out of the overall index rather than counted as a 0.
export const RATINGS = [
  { value: 0, label: 'Not assessed' },
  { value: 1, label: 'Misaligned' },
  { value: 2, label: 'At risk' },
  { value: 3, label: 'Holding' },
  { value: 4, label: 'Aligned' },
  { value: 5, label: 'Fully aligned' }
];

export const FORMATS = [
  { key: 'team', label: 'Team session' },
  { key: 'leader', label: 'Leader one-on-one' }
];

// The signature programs and delivery formats as the corporate page sells
// them, so a recommendation always names something that can be booked.
export const PROGRAMS = [
  { key: '', label: 'No recommendation yet' },
  { key: 'mindset-reset', label: 'The Mindset Reset' },
  { key: 'purpose-pathways', label: 'Purpose Pathways' },
  { key: 'leadership-ascension', label: 'Leadership Ascension' }
];

export const DELIVERY = [
  { key: '', label: 'Format to be decided' },
  { key: 'keynote', label: 'Keynote' },
  { key: 'workshop', label: 'Workshop' },
  { key: 'intensive', label: 'Intensive' },
  { key: 'retreat', label: 'Retreat' },
  { key: 'annual', label: '12-month program' }
];

export const PLAN_WINDOWS = [
  { key: 'd30', label: 'First 30 days' },
  { key: 'd60', label: 'Days 31 to 60' },
  { key: 'd90', label: 'Days 61 to 90' }
];

// Character limits are what keep it one page. They are generous enough for
// two honest sentences and short enough that nobody writes an essay.
export const LIMITS = {
  orgName: 80,
  preparedFor: 80,
  preparedRole: 80,
  headline: 180,
  finding: 200,
  solution: 200,
  plan: 220,
  why: 280,
  note: 320
};

export const DEFAULT_ACCENT = '#E60306';
export const DUE_HOURS = 48;

const HEX_RE = /^#[0-9a-f]{6}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const pick = (list, v) => (list.some((x) => x.key === v) ? v : list[0].key);

export function isHexColor(v) { return HEX_RE.test(String(v || '')); }

/** A complete scorecard with every field present, from whatever was stored. */
export function normalizeScorecard(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const areasIn = Array.isArray(r.areas) ? r.areas : [];
  const planIn = r.plan && typeof r.plan === 'object' ? r.plan : {};
  const recIn = r.recommendation && typeof r.recommendation === 'object' ? r.recommendation : {};
  const rating = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 5 ? n : 0;
  };
  return {
    orgName: str(r.orgName, LIMITS.orgName),
    preparedFor: str(r.preparedFor, LIMITS.preparedFor),
    preparedRole: str(r.preparedRole, LIMITS.preparedRole),
    contactId: str(r.contactId, 128) || null,
    contactEmail: str(r.contactEmail, 160) || null,
    format: pick(FORMATS, r.format),
    sessionDate: DATE_RE.test(String(r.sessionDate || '')) ? r.sessionDate : '',
    teamSize: str(r.teamSize, 20),
    accent: isHexColor(r.accent) ? r.accent.toUpperCase() : DEFAULT_ACCENT,
    logoUrl: /^https:\/\//.test(String(r.logoUrl || '')) ? String(r.logoUrl).slice(0, 2048) : '',
    logoPath: str(r.logoPath, 300),
    headline: str(r.headline, LIMITS.headline),
    areas: AREAS.map((a) => {
      const found = areasIn.find((x) => x && x.key === a.key) || {};
      return {
        key: a.key,
        rating: rating(found.rating),
        finding: str(found.finding, LIMITS.finding),
        solution: str(found.solution, LIMITS.solution)
      };
    }),
    priority: AREAS.some((a) => a.key === r.priority) ? r.priority : '',
    plan: Object.fromEntries(PLAN_WINDOWS.map((w) => [w.key, str(planIn[w.key], LIMITS.plan)])),
    recommendation: {
      program: pick(PROGRAMS, recIn.program),
      delivery: pick(DELIVERY, recIn.delivery),
      why: str(recIn.why, LIMITS.why)
    },
    note: str(r.note, LIMITS.note),
    status: r.status === 'delivered' ? 'delivered' : 'draft'
  };
}

/**
 * The overall alignment index, 0 to 100, from the assessed areas only.
 * Null when nothing has been rated, so an empty draft does not print a 0.
 */
export function alignmentIndex(areas) {
  const rated = (areas || []).map((a) => a.rating).filter((n) => n >= 1 && n <= 5);
  if (!rated.length) return null;
  const avg = rated.reduce((s, n) => s + n, 0) / rated.length;
  return Math.round(((avg - 1) / 4) * 100);
}

export function indexLabel(index) {
  if (index == null) return '';
  if (index < 35) return 'Pulling apart';
  if (index < 65) return 'Partly aligned';
  if (index < 85) return 'Moving together';
  return 'Fully aligned';
}

/**
 * The area to work on first: the one Anthony picked, else the lowest rated.
 * Ties go to the earlier area, which keeps the choice stable between saves.
 */
export function priorityArea(sc) {
  if (sc.priority) return sc.priority;
  let best = null;
  for (const a of sc.areas) {
    if (a.rating < 1) continue;
    if (!best || a.rating < best.rating) best = a;
  }
  return best ? best.key : '';
}

/** When the scorecard is owed: 48 hours after the session, as epoch ms. */
export function dueAt(sessionDate) {
  if (!DATE_RE.test(String(sessionDate || ''))) return null;
  const [y, m, d] = sessionDate.split('-').map(Number);
  // The session time is not recorded, so the clock starts at the end of the
  // session day. Local time, because the promise is made in the owner's day.
  return new Date(y, m - 1, d, 23, 59).getTime() + DUE_HOURS * 3600 * 1000;
}

/** 'delivered' | 'unscheduled' | 'open' | 'due-soon' | 'overdue' */
export function dueState(sc, now = Date.now()) {
  if (sc.status === 'delivered') return 'delivered';
  const due = dueAt(sc.sessionDate);
  if (due == null) return 'unscheduled';
  if (now > due) return 'overdue';
  if (due - now < 24 * 3600 * 1000) return 'due-soon';
  return 'open';
}

/** What still has to be written before this can go to the client. */
export function missingForDelivery(sc) {
  const out = [];
  if (!sc.orgName) out.push('Organization name');
  if (!sc.preparedFor) out.push('Who it is prepared for');
  if (!sc.sessionDate) out.push('Session date');
  if (!sc.headline) out.push('The headline');
  const rated = sc.areas.filter((a) => a.rating >= 1);
  if (!rated.length) out.push('At least one rated area');
  rated.forEach((a) => {
    const label = AREAS.find((x) => x.key === a.key).label;
    if (!a.finding) out.push(`${label}: what we saw`);
    if (!a.solution) out.push(`${label}: what to do`);
  });
  if (!PLAN_WINDOWS.some((w) => sc.plan[w.key])) out.push('The 90-day plan');
  return out;
}

/** Turn an audit request (CRM contact plus its form answers) into a draft. */
export function draftFromRequest({ contactId, name, email, fields = {} } = {}) {
  const f = fields || {};
  const fmt = /one-on-one|just me/i.test(f.format || '') ? 'leader' : 'team';
  return normalizeScorecard({
    contactId, contactEmail: email,
    orgName: f.organization || '',
    preparedFor: name || '',
    preparedRole: f.role || '',
    teamSize: f.team_size || '',
    format: fmt
  });
}

// ─── The printed document ────────────────────────────────────────────────

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function fmtSessionDate(iso) {
  if (!DATE_RE.test(String(iso || ''))) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * The scorecard as print-ready HTML (one US Letter page). Styles live in
 * scorecard.css under .sc-doc; the only per-client value is the accent,
 * passed as a CSS variable. Every string is escaped here.
 */
export function renderScorecard(input, { brandMark = '/assets/favicon.jpg' } = {}) {
  const sc = normalizeScorecard(input);
  const index = alignmentIndex(sc.areas);
  const first = priorityArea(sc);
  const firstArea = AREAS.find((a) => a.key === first);
  const formatLabel = FORMATS.find((f) => f.key === sc.format).label;
  const program = PROGRAMS.find((p) => p.key === sc.recommendation.program);
  const delivery = DELIVERY.find((d) => d.key === sc.recommendation.delivery);
  const meta = [
    sc.preparedFor && `Prepared for ${esc(sc.preparedFor)}${sc.preparedRole ? `, ${esc(sc.preparedRole)}` : ''}`,
    fmtSessionDate(sc.sessionDate) && `Session ${esc(fmtSessionDate(sc.sessionDate))}`,
    `${esc(formatLabel)} on Zoom`,
    sc.teamSize && `Team of ${esc(sc.teamSize)}`
  ].filter(Boolean);

  const clientMark = sc.logoUrl
    ? `<img class="sc-client-logo" src="${esc(sc.logoUrl)}" alt="${esc(sc.orgName)}">`
    : `<div class="sc-client-name">${esc(sc.orgName || 'Your organization')}</div>`;

  const rows = sc.areas.map((a) => {
    const def = AREAS.find((x) => x.key === a.key);
    const rated = a.rating >= 1;
    const pips = [1, 2, 3, 4, 5].map((n) => `<i class="${rated && n <= a.rating ? 'on' : ''}"></i>`).join('');
    return `<tr class="${a.key === first ? 'is-first' : ''}${rated ? '' : ' is-skipped'}">
      <th scope="row"><div class="sc-area">${esc(def.label)}</div><div class="sc-pips" aria-hidden="true">${pips}</div><div class="sc-rating">${esc(RATINGS[a.rating].label)}</div></th>
      <td>${rated ? esc(a.finding) || '<span class="sc-empty">Not written yet</span>' : ''}</td>
      <td>${rated ? esc(a.solution) || '<span class="sc-empty">Not written yet</span>' : ''}</td>
    </tr>`;
  }).join('');

  const plan = PLAN_WINDOWS.map((w) => `<div class="sc-plan-col">
      <div class="sc-k">${esc(w.label)}</div>
      <p>${esc(sc.plan[w.key]) || '<span class="sc-empty">Not written yet</span>'}</p>
    </div>`).join('');

  const recTitle = program.key
    ? `${esc(program.label)}${delivery.key ? ` <span class="sc-rec-format">${esc(delivery.label)}</span>` : ''}`
    : '';

  return `<article class="sc-doc" style="--sc-accent:${sc.accent}">
  <header class="sc-head">
    <div class="sc-brand">
      <img class="sc-1p" src="${esc(brandMark)}" alt="The One Percent">
      <div class="sc-x" aria-hidden="true">&times;</div>
      ${clientMark}
    </div>
    <div class="sc-title">
      <div class="sc-eyebrow">The One Percent &middot; Alignment Audit</div>
      <h1>Alignment Scorecard</h1>
      ${sc.logoUrl ? `<div class="sc-org">${esc(sc.orgName)}</div>` : ''}
    </div>
  </header>
  <div class="sc-meta">${meta.join('<span class="sc-dot">&middot;</span>')}</div>

  <section class="sc-summary">
    <div class="sc-index">
      <div class="sc-index-n">${index == null ? '&ndash;' : index}</div>
      <div class="sc-index-l">${index == null ? 'Alignment index' : `Alignment index &middot; ${esc(indexLabel(index))}`}</div>
      <div class="sc-bar"><span style="width:${index == null ? 0 : index}%"></span></div>
    </div>
    <div class="sc-headline">
      <div class="sc-k">The headline</div>
      <p>${esc(sc.headline) || '<span class="sc-empty">One sentence on what is actually going on.</span>'}</p>
    </div>
  </section>

  <table class="sc-areas">
    <thead><tr><th scope="col">Area</th><th scope="col">What we saw</th><th scope="col">What to do</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <section class="sc-plan">
    <div class="sc-plan-head">
      <div class="sc-k">Your 90-day plan</div>
      ${firstArea ? `<div class="sc-start">Start here: <strong>${esc(firstArea.label)}</strong></div>` : ''}
    </div>
    <div class="sc-plan-grid">${plan}</div>
  </section>

  <section class="sc-foot">
    <div class="sc-rec${recTitle || sc.recommendation.why ? '' : ' is-empty'}">
      <div class="sc-k">Recommended next step</div>
      ${recTitle ? `<div class="sc-rec-t">${recTitle}</div>` : ''}
      <p>${esc(sc.recommendation.why) || (recTitle ? '' : '<span class="sc-empty">Optional. Leave blank and this prints as an open conversation.</span>')}</p>
    </div>
    <div class="sc-sign">
      ${sc.note ? `<p class="sc-note">${esc(sc.note)}</p>` : ''}
      <div class="sc-sig">Anthony Brown Sr.</div>
      <div class="sc-sig-r">Founder, The One Percent Nation</div>
    </div>
  </section>

  <footer class="sc-legal">
    <span>Prepared for ${esc(sc.orgName || 'your organization')}. Confidential.</span>
    <span>the1pnation.com</span>
  </footer>
</article>`;
}
