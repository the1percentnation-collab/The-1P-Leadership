// /focus-tax-calculator — the page half of the Focus Tax calculator.
//
// The math lives in focus-tax-core.js (shared with the server, which
// recomputes the emailed report from the same inputs). This file reads the
// form, paints the result on every input, finds the book's live product for
// the CTA, and sends the report request through submitLeadForm.
import {
  computeFocusTax, FOCUS_TAX_DEFAULTS, WORK_WEEKS
} from './focus-tax-core.js';
import { suggestEmail } from './assessment-core.js';
import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { onAuthReady } from './auth.js';
import { loadCatalog, hrefFor, ctaFor, isExternal } from './catalog.js';

const $ = (id) => document.getElementById(id);
const form = $('ft-form');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.round(n));
const hrs = (n) => {
  const v = Math.round(n * 10) / 10;
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)} ${v === 1 ? 'hour' : 'hours'}`;
};
const num = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
const track = (name, params) => { if (typeof gtag === 'function') gtag('event', name, params || {}); };

// Slider id -> how its live value reads.
const OUTPUTS = {
  income: (v) => money(v),
  teamSize: (v) => `${num(v)} people`,
  avgSalary: (v) => money(v),
  hoursPerWeek: (v) => `${v} hrs`,
  interruptionsPerDay: (v) => String(v),
  switchesPerDay: (v) => String(v),
  meetingHoursPerWeek: (v) => `${v} hrs`
};

function readInputs() {
  const fd = new FormData(form);
  const out = {};
  for (const [k, v] of fd.entries()) out[k] = v;
  return out;
}

let last = null;

function render() {
  const raw = readInputs();
  const r = computeFocusTax(raw);
  last = r;
  const team = r.input.mode === 'team';
  document.body.classList.toggle('ft-team', team);
  document.body.classList.toggle('ft-solo', !team);

  Object.keys(OUTPUTS).forEach((id) => {
    const out = $('out-' + id);
    if (out) out.textContent = OUTPUTS[id]($(id).value);
  });

  $('ft-result-eyebrow').textContent = team ? `Your team's Focus Tax · ${num(r.people)} people` : 'Your Focus Tax';
  $('ft-yearly').textContent = money(r.yearlyCost);
  $('ft-mini-v').textContent = money(r.yearlyCost);
  $('ft-mini-k').textContent = team ? 'Team / yr' : 'Per year';
  const pct = Math.round(r.pctOfWeek * 100);
  const days = Math.round(r.workdaysLost * 10) / 10;
  $('ft-sub').innerHTML = team
    ? `<b>${hrs(r.weeklyHours)}</b> a week per person, ${pct}% of every working week. Across the team that is <b>${num(r.weeklyHours * r.people)} hours</b> a week.`
    : `<b>${hrs(r.weeklyHours)}</b> a week, ${pct}% of your working week. That is about <b>${days} ${days === 1 ? 'workday' : 'workdays'}</b> every week.`;

  const max = Math.max(...r.lines.map((l) => l.hours), 0.0001);
  $('ft-lines').innerHTML = r.lines.map((l) => `
    <div class="ft-line${r.biggest && l.key === r.biggest.key ? ' is-biggest' : ''}">
      <div class="ft-line-head"><b>${esc(l.label)}</b><span>${hrs(l.hours)} / wk · ${money(l.hours * r.hourly * r.people * WORK_WEEKS)}</span></div>
      <div class="ft-bar"><i style="width:${Math.round((l.hours / max) * 100)}%"></i></div>
      <div class="ft-line-ch">${esc(l.chapter)}</div>
    </div>`).join('');

  const big = $('ft-biggest');
  if (r.biggest) {
    big.hidden = false;
    big.innerHTML = `
      <div class="eyebrow">Your biggest tax: ${esc(r.biggest.label)}</div>
      <p><b>Run this first.</b> ${esc(r.biggest.fix)}</p>
      <p>Go deeper: <b>${esc(r.biggest.chapter)}</b> in the book, and the essay <a href="/reads/${encodeURIComponent(r.biggest.readSlug)}"><u>${esc(r.biggest.read)}</u></a>.</p>`;
  } else {
    big.hidden = true;
  }

  const back = r.reclaimedHours;
  $('ft-workless').textContent = back > 0 ? `${hrs(back)} back` : 'Already there';
  $('ft-workless-sub').textContent = back > 0
    ? (team
      ? `Per person, every week. Finish earlier, or give the time to the work only your team can do.`
      : `Every week. Same results, finished earlier. That is the time that goes back to the people the work was supposed to be for.`)
    : 'Your inputs already match the system. Protect what you have built.';
  $('ft-gainmore').textContent = back > 0 ? money(r.reclaimedYearlyCost) : money(0);
  $('ft-gainmore-sub').textContent = back > 0
    ? `${num(r.reclaimedYearlyHours * r.people)} protected hours a year${team ? ' across the team' : ''}, worth this much at ${team ? 'their' : 'your'} hourly rate. One protected hour a day becomes 250 hours of progress a year.`
    : 'Keep auditing weekly so it stays that way.';

  scheduleResultEvent(r);
}

let resultTimer = null;
function scheduleResultEvent(r) {
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => track('focus_tax_calc_result', {
    mode: r.input.mode, weekly_hours: Math.round(r.weeklyHours), yearly_cost: Math.round(r.yearlyCost)
  }), 1500);
}

// ── Book CTA: the live product, found by name, so price and status come from
// the catalog the owner already manages. Falls back to the homepage shop. ──
async function wireBook() {
  try {
    const items = await loadCatalog();
    const book = items.find((i) => i.kind === 'product' && /work\s*less/i.test(i.title));
    if (!book || book.status === 'hidden') return;
    const btn = $('ft-book-btn');
    const href = hrefFor(book, 'site');
    const cta = ctaFor(book);
    btn.href = href;
    btn.textContent = cta.kind === 'notify' ? 'Get notified at launch'
      : `${cta.label}${book.label ? ' · ' + book.label : ''}`;
    if (isExternal(href)) { btn.target = '_blank'; btn.rel = 'noopener'; }
  } catch (e) {
    console.warn('[focus-tax] book lookup failed', e && e.message);
  }
}

// ── Report request ─────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setStatus(text, kind) {
  const s = $('rf-status');
  s.textContent = text;
  s.className = 'ft-status' + (kind ? ' is-' + kind : '');
}

function wireEmailSuggest() {
  const input = $('rf-email');
  const hint = $('rf-suggest');
  input.addEventListener('blur', () => {
    const fix = suggestEmail(input.value);
    if (!fix) { hint.hidden = true; return; }
    hint.hidden = false;
    hint.innerHTML = `Did you mean <button type="button">${esc(fix)}</button>?`;
    hint.querySelector('button').addEventListener('click', () => { input.value = fix; hint.hidden = true; });
  });
}

async function submitReport(e) {
  e.preventDefault();
  const name = $('rf-name').value.trim();
  const email = $('rf-email').value.trim();
  if ($('rf-company').value) { setStatus('Sent. Check your inbox.', 'ok'); return; } // honeypot
  if (!name) { setStatus('Add your first name so the report knows who it is for.', 'error'); return; }
  if (!EMAIL_RE.test(email)) { setStatus('That email address does not look right.', 'error'); return; }
  if (!firebaseReady || !functions) { setStatus('Sending is unavailable right now. Please try again shortly.', 'error'); return; }

  const r = last || computeFocusTax(readInputs());
  const i = r.input;
  const fields = {
    mode: i.mode,
    hoursPerWeek: String(i.hoursPerWeek),
    interruptionsPerDay: String(i.interruptionsPerDay),
    switchesPerDay: String(i.switchesPerDay),
    meetingHoursPerWeek: String(i.meetingHoursPerWeek),
    planning: i.planning,
    // Read by the owner notification and the CRM activity. The emailed report
    // is recomputed on the server from the inputs above, never from these.
    weeklyHoursLost: (Math.round(r.weeklyHours * 10) / 10).toString(),
    yearlyCost: String(Math.round(r.yearlyCost)),
    biggestTax: r.biggest ? r.biggest.label : ''
  };
  if (i.mode === 'team') { fields.teamSize = String(i.teamSize); fields.avgSalary = String(i.avgSalary); }
  else fields.income = String(i.income);

  const btn = $('rf-submit');
  btn.disabled = true;
  setStatus('Sending…');
  try {
    await httpsCallable(functions, 'submitLeadForm')({ formType: 'focus-tax', name, email, fields, consent: false });
    setStatus(`Sent. Your report is on its way to ${email}.`, 'ok');
    track('focus_tax_report_request', { mode: i.mode });
    $('ft-report-form').reset();
  } catch (err) {
    const msg = err && err.message && !/internal/i.test(err.message) ? err.message : 'Something went wrong. Please try again.';
    setStatus(msg, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Phones: show the running total only while the form is on screen and the
// full result is not, so it never covers the result it summarizes.
function wireMiniBar() {
  const mini = $('ft-mini');
  if (!('IntersectionObserver' in window)) return;
  const seen = { form: false, result: false };
  const update = () => mini.classList.toggle('is-hidden', !seen.form || seen.result);
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { seen[e.target === form ? 'form' : 'result'] = e.isIntersecting; });
    update();
  });
  io.observe(form);
  io.observe($('ft-result'));
  update();
}

// ── Boot ──────────────────────────────────────────────────────────────────
// Defaults live in the core module; the markup's starting values match them.
Object.entries(FOCUS_TAX_DEFAULTS).forEach(([k, v]) => {
  const el = form.elements[k];
  if (el && el.type === 'range') el.value = v;
});
form.addEventListener('input', render);
form.addEventListener('change', render);
form.addEventListener('submit', (e) => e.preventDefault());
$('ft-report-form').addEventListener('submit', submitReport);
wireEmailSuggest();
wireMiniBar();
render();
wireBook();
track('focus_tax_calc_view');

onAuthReady((user) => {
  if (!user) return;
  const nav = $('nav-account');
  nav.textContent = 'My Portal';
  nav.href = '/dashboard';
});
