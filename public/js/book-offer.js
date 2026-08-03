// The book path — one module, every surface that sells a course.
//
// A course can offer a lower price to buyers who go through the book first:
// click to the book's listing, and the course drops to `bookPrice`. The click
// is the trigger. Nothing here verifies a purchase, because nothing can —
// Amazon gives authors no order-verification API — so the copy below says
// "get the book", never "verified purchase".
//
// The discount itself is granted server-side by the unlockBookPrice callable
// and enforced in createCheckoutSession. Everything in this file is display:
// a member who forged the unlocked state in their browser would still be
// charged full price at checkout.

import { firebaseReady, functions, db } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { currentUser } from './auth.js';
import { escapeHtml } from './community.js';
import { bookOffer } from './courses-data.js';

export { bookOffer };

const unlocked = new Set();
let _loaded = false;

/** Course slugs where this member has already taken the book path. */
export async function loadBookUnlocks({ force = false } = {}) {
  if (_loaded && !force) return unlocked;
  unlocked.clear();
  const user = currentUser();
  if (!firebaseReady || !user) { _loaded = true; return unlocked; }
  try {
    const snap = await getDocs(collection(db, 'users', user.uid, 'bookUnlocks'));
    snap.forEach((d) => unlocked.add(d.id));
  } catch (e) {
    // Non-fatal: without this the member simply sees the list price, which is
    // the safe direction to fail in.
    console.warn('[book-offer] unlock load failed', e);
  }
  _loaded = true;
  return unlocked;
}

export function isBookUnlocked(slug) {
  return unlocked.has(slug);
}

/**
 * The two-path price block. `compact` is the version that fits on a library
 * card; the full one is for a sales page.
 */
export function bookOfferHtml(course, { compact = false } = {}) {
  const offer = bookOffer(course);
  if (!offer) return '';
  const isUnlocked = isBookUnlocked(course.slug);

  if (isUnlocked) {
    return `
      <div class="book-offer is-unlocked ${compact ? 'is-compact' : ''}">
        <span class="book-offer-check">✓</span>
        <span class="book-offer-text">Book price applied — <strong>${escapeHtml(offer.priceLabel)}</strong> at checkout.</span>
      </div>`;
  }

  return `
    <div class="book-offer ${compact ? 'is-compact' : ''}" data-book-slug="${escapeHtml(course.slug)}">
      <div class="book-offer-head">
        <span class="book-offer-eyebrow">Or take the book path</span>
        <span class="book-offer-price">${escapeHtml(offer.priceLabel)}</span>
      </div>
      <p class="book-offer-copy">
        Get ${escapeHtml(offer.label)} and your course price drops to
        <strong>${escapeHtml(offer.priceLabel)}</strong>.
      </p>
      <button type="button" class="book-offer-btn" data-book-unlock="${escapeHtml(course.slug)}">
        Get the book on Amazon →
      </button>
    </div>`;
}

/**
 * Wires up every book button inside `root`. On click: record the unlock, open
 * the book in a new tab, then hand back to `onUnlocked` so the caller can
 * re-render its price and CTA without a reload.
 *
 * The Amazon URL comes back from the callable rather than from the DOM, so the
 * link the member follows is the one on the course doc.
 */
export function bindBookOffer(root, { onUnlocked } = {}) {
  if (!root) return;
  root.querySelectorAll('[data-book-unlock]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const slug = btn.dataset.bookUnlock;
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Opening Amazon…';

      // Open the tab from inside the click, before any await: a window.open()
      // that happens after a network round-trip has lost the user gesture and
      // gets blocked as a popup.
      const tab = window.open('', '_blank');
      try {
        const res = await httpsCallable(functions, 'unlockBookPrice')({ slug });
        const url = res && res.data && res.data.url;
        if (!url) throw new Error('No book link is set for this course.');
        unlocked.add(slug);
        if (tab) tab.location.href = url; else window.open(url, '_blank', 'noopener');
        if (onUnlocked) onUnlocked(slug);
      } catch (err) {
        if (tab) tab.close();
        console.warn('[book-offer] unlock failed', err);
        btn.disabled = false;
        btn.textContent = original;
        alert(err.message || 'Could not open the book link. Please try again.');
      }
    });
  });
}
