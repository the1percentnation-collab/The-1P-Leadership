// Lead capture around a free book preview (/read?book=<open-access id>).
//
// Two moments, one card (#gate in read.html):
//
//   front   Before the EPUB downloads. Name and email buy the preview. This
//           is the only wall on the book, so it stays one screen and three
//           fields.
//   back    When the last section of the preview loads. Someone who read it
//           end to end is the warmest person on the site that day, so they
//           get tagged again ("Preview Finished") and handed the buy link.
//
// Both write into the academy CRM through submitLeadForm with formType
// 'chapter-preview' (functions/index.js → LEAD_FORMS), the same callable the
// book-bonus and speaking forms use. Nothing is stored client-side except the
// reader's own details, so the second ask can skip straight to the offer.
//
// Who never sees the front wall:
//   · a signed-in member (already a contact, and the library is theirs)
//   · anyone who already submitted on this device, for this book
//   · a link carrying the bypass key (?k=…), for warm DMs where asking a
//     friend to fill out a form before answering your question is how you
//     get no answer
//
// Guests only: a failed capture must never trap a reader on a dead form, so
// a submit that errors shows the error and lets them try again, and a broken
// Firebase connection opens the book rather than holding it hostage.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);

// Share this with warm contacts: /read?book=i-cant-preview&k=dm
const BYPASS_KEYS = ['dm'];

const LS_PREFIX = '1p_reader_lead:';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function lsKey(bookId) { return LS_PREFIX + bookId; }

export function savedLead(bookId) {
  try {
    const raw = localStorage.getItem(lsKey(bookId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.email ? v : null;
  } catch (e) { return null; }
}

function rememberLead(bookId, lead) {
  try { localStorage.setItem(lsKey(bookId), JSON.stringify(lead)); } catch (e) {}
}

export function hasBypass(params) {
  return BYPASS_KEYS.includes((params.get('k') || '').trim().toLowerCase());
}

/**
 * Write the reader into the CRM. `stage` is 'start' (opened the preview) or
 * 'finish' (read it through); the backend turns 'finish' into its own tag.
 */
async function capture({ firstName, lastName, email, book, bookId, stage }) {
  if (!firebaseReady) throw new Error('The form is unavailable right now. Please refresh and try again.');
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  await httpsCallable(functions, 'submitLeadForm')({
    formType: 'chapter-preview',
    name,
    email,
    fields: {
      firstName,
      lastName,
      stage,
      book_id: bookId,
      book_title: (book && book.title) || ''
    },
    // The card says plainly that this is how the rest of the book reaches
    // them, so submitting is the opt-in. Recorded so the CRM can prove it.
    consent: true
  });
}

// ── The card ─────────────────────────────────────────────────────────────

function showGate({ eyebrow, title, sub, submitLabel, fine, cover, prefill }) {
  $('gate-cover').src = cover || '';
  $('gate-eyebrow').textContent = eyebrow || '';
  $('gate-eyebrow').hidden = !eyebrow;
  $('gate-title').textContent = title;
  $('gate-sub').textContent = sub;
  $('gate-submit').textContent = submitLabel;
  $('gate-fine').innerHTML = fine || '';
  $('gate-actions').hidden = true;
  $('gate-actions').innerHTML = '';
  $('gate-form').hidden = false;
  clearError();
  if (prefill) {
    $('gate-first').value = prefill.firstName || '';
    $('gate-last').value = prefill.lastName || '';
    $('gate-email').value = prefill.email || '';
  }
  $('gate').hidden = false;
  $('gate').classList.remove('gone');
}

function hideGate() {
  const el = $('gate');
  el.classList.add('gone');
  setTimeout(() => { el.hidden = true; }, 320);
}

function clearError() {
  $('gate-err').hidden = true;
  $('gate-err').textContent = '';
  for (const id of ['gate-first', 'gate-last', 'gate-email']) $(id).removeAttribute('aria-invalid');
}

function showError(msg, focusId) {
  $('gate-err').textContent = msg;
  $('gate-err').hidden = false;
  if (focusId) {
    $(focusId).setAttribute('aria-invalid', 'true');
    $(focusId).focus();
  }
}

function readForm() {
  return {
    firstName: $('gate-first').value.trim().slice(0, 60),
    lastName: $('gate-last').value.trim().slice(0, 60),
    email: $('gate-email').value.trim().toLowerCase().slice(0, 160)
  };
}

function validate(v) {
  if (!v.firstName) return ['Please enter your first name.', 'gate-first'];
  if (!v.lastName) return ['Please enter your last name.', 'gate-last'];
  if (!EMAIL_RE.test(v.email)) return ['Please enter a valid email address.', 'gate-email'];
  return null;
}

/**
 * Wire the form to one submit handler. Resolves with the captured reader.
 * Rejecting is not an option here: the caller is waiting to open a book.
 */
function onSubmit(handler) {
  const form = $('gate-form');
  const btn = $('gate-submit');
  const label = btn.textContent;
  form.onsubmit = async (e) => {
    e.preventDefault();
    clearError();
    const v = readForm();
    const bad = validate(v);
    if (bad) { showError(bad[0], bad[1]); return; }
    btn.disabled = true;
    btn.textContent = 'One moment…';
    try {
      await handler(v);
    } catch (err) {
      console.error('[reader-lead] capture failed', err);
      showError((err && err.message) || 'That didn\'t go through. Please try again.');
      btn.disabled = false;
      btn.textContent = label;
    }
  };
}

// ── Front door ───────────────────────────────────────────────────────────

/**
 * Hold the book until the reader is captured. Resolves with their details
 * (or null when the wall was skipped) and never rejects.
 */
export function gateBeforeOpen({ book, bookId, skip }) {
  const already = savedLead(bookId);
  if (skip || already) return Promise.resolve(already);
  if (!firebaseReady) return Promise.resolve(null);

  return new Promise((resolve) => {
    showGate({
      cover: book && book.coverUrl,
      eyebrow: 'Free preview',
      title: 'Where should the rest of the book find you?',
      sub: 'Tell me where to reach you and chapter one opens on the next screen. No cost, no catch.',
      submitLabel: 'Start reading',
      fine: 'You\'ll get the occasional note from me and nothing else. Unsubscribe any time.'
    });
    setTimeout(() => $('gate-first').focus({ preventScroll: true }), 120);

    onSubmit(async (v) => {
      await capture({ ...v, book, bookId, stage: 'start' });
      rememberLead(bookId, v);
      hideGate();
      resolve(v);
    });
  });
}

// ── Back door ────────────────────────────────────────────────────────────

/**
 * Shown once the reader reaches the end of the preview. A reader we already
 * have is re-tagged with one tap instead of being asked to type their name a
 * second time; one who came in on a bypass link gets the full form here,
 * which is the whole point of having a second ask.
 */
export function showPreviewEnd({ book, bookId }) {
  const buyHref = (book && book.buyHref) || '/books';
  const known = savedLead(bookId);
  const title = (book && book.title) || 'this book';

  const finish = async (v) => {
    try {
      await capture({ ...v, book, bookId, stage: 'finish' });
      rememberLead(bookId, v);
    } catch (e) {
      // The offer matters more than the tag: never block the buy link on a
      // CRM write that can be retried from the front wall next time.
      console.error('[reader-lead] finish capture failed', e);
    }
  };

  if (known) {
    showGate({
      cover: book && book.coverUrl,
      eyebrow: 'End of the preview',
      title: 'That was chapter one.',
      sub: `The other nine chapters are where the method actually gets built. ${known.firstName ? known.firstName + ', t' : 'T'}he full book picks up exactly where this left off.`,
      submitLabel: '',
      fine: ''
    });
    $('gate-form').hidden = true;
    const actions = $('gate-actions');
    actions.innerHTML =
      `<a class="btn primary" href="${buyHref}">Get the full book</a>` +
      '<button class="btn" id="gate-back" type="button">Keep reading the preview</button>';
    actions.hidden = false;
    $('gate-back').addEventListener('click', hideGate);
    // Reaching the end is the signal, whether or not they click through.
    finish(known);
    return;
  }

  showGate({
    cover: book && book.coverUrl,
    eyebrow: 'End of the preview',
    title: 'That was chapter one.',
    sub: 'Tell me where to send the next step and I\'ll point you to the rest of the book.',
    submitLabel: 'Send me the rest',
    fine: 'You\'ll get the occasional note from me and nothing else. Unsubscribe any time.'
  });
  onSubmit(async (v) => {
    await capture({ ...v, book, bookId, stage: 'finish' });
    rememberLead(bookId, v);
    $('gate-form').hidden = true;
    $('gate-title').textContent = `Thanks, ${v.firstName}.`;
    $('gate-sub').textContent = `Watch your inbox. In the meantime, ${title} is right here.`;
    $('gate-eyebrow').hidden = true;
    const actions = $('gate-actions');
    actions.innerHTML =
      `<a class="btn primary" href="${buyHref}">Get the full book</a>` +
      '<button class="btn" id="gate-back" type="button">Back to the preview</button>';
    actions.hidden = false;
    $('gate-back').addEventListener('click', hideGate);
  });
}
