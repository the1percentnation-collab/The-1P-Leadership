// The assessment prompt: when to invite a visitor to take a free assessment.
//
// Pure, so the rules are tested (tests/assessment-prompt.test.mjs) and the
// page script (assessment-prompt.js) only gathers signals and draws the UI.
//
// The timing is engagement-gated, not a bare timer. Dwell-time research
// (Liu, White & Dumais, SIGIR 2010) shows the odds of leaving a page are
// highest in the first ~10 seconds and level off around 30, and popup
// benchmarks agree that a delayed prompt beats one on landing. So nobody is
// asked until they have spent 30 visible seconds on the site and shown
// intent (read 40% of a page or opened a second one). A desktop visitor
// heading for the tab bar is asked earlier, once they have stayed 10s.

export const PROMPT = {
  minActiveMs: 30000,      // visible time on site, summed across pages
  minScrollPct: 40,        // ...plus this much of the current page read
  minPageViews: 2,         // ...or a second page opened
  exitMinActiveMs: 10000,  // desktop exit intent counts after this long
  snoozeDays: 14,          // quiet period after "Not right now"
  // Checkout and buyer pages stay clean: the Alignment Audit is the ask there.
  excludePaths: [/^\/assessments?(\/|\.html|$)/, /^\/membership/, /^\/corporate/, /^\/book-a-call/, /^\/speaking/, /^\/login/, /^\/signup/]
};

const DAY = 86400000;
export const STORE_KEY = '1p-prompt';

// Called by the assessment pages: anyone who has found the library on their
// own is never prompted for it.
export function markVisited() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') || {};
    if (!s.visited) localStorage.setItem(STORE_KEY, JSON.stringify(Object.assign(s, { visited: Date.now() })));
  } catch (e) { /* private mode: they may be prompted once, which is fine */ }
}

export function isExcluded(path) {
  return PROMPT.excludePaths.some((re) => re.test(path || '/'));
}

// Has this visitor already said no recently, or already found the library?
// store: { visited, convertedAt, dismissedAt } from localStorage.
export function isSuppressed(store, now) {
  const s = store || {};
  if (s.visited || s.convertedAt) return true;
  return !!(s.dismissedAt && now - s.dismissedAt < PROMPT.snoozeDays * DAY);
}

// Returns the trigger that fires now ('engaged' | 'exit'), or null to wait.
// sig: { path, now, activeMs, scrollPct, pageViews, exitIntent, consentPending,
//        shownThisSession, store }
export function decide(sig) {
  if (isExcluded(sig.path) || isSuppressed(sig.store, sig.now)) return null;
  if (sig.shownThisSession || sig.consentPending) return null;
  if (sig.exitIntent && sig.activeMs >= PROMPT.exitMinActiveMs) return 'exit';
  if (sig.activeMs < PROMPT.minActiveMs) return null;
  if (sig.scrollPct >= PROMPT.minScrollPct || sig.pageViews >= PROMPT.minPageViews) return 'engaged';
  return null;
}

// The small "Free assessment" tab, shown after a dismissal so the offer stays
// one click away (click-triggered prompts convert far better than timed ones)
// without asking again.
export function showPill(sig) {
  const s = sig.store || {};
  if (isExcluded(sig.path) || s.visited || s.convertedAt || sig.pillClosed) return false;
  return !!(s.dismissedAt && sig.now - s.dismissedAt < PROMPT.snoozeDays * DAY);
}

// Campaign tags for the assessment link. A real campaign the visitor arrived
// on wins; the prompt only claims visits that had none.
export function promptUtm(existing, choice) {
  if (existing && (existing.source || existing.campaign)) return '';
  return `?utm_source=site&utm_medium=popup&utm_campaign=assessment-prompt-${choice}`;
}
