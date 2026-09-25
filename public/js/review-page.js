// /review.html?course=<slug> — rate a course you finished.
//
// Only members with a completion record (users/{uid}/courseCompletions/{slug},
// stamped by recordCourseCompletion) get the form. The review is saved through
// submitCourseReview, which logs it on the member's CRM card and holds it as
// pending until the owner approves it in the beta console. Approved reviews
// show on the course page (/course.html?course=<slug>).

import { onAuthReady } from './auth.js';
import { db, functions, firebaseReady } from './firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { loadCourses, getCourseBySlug } from './courses-data.js';

const $ = (id) => document.getElementById(id);
const slug = (new URLSearchParams(location.search).get('course') || '').trim();
const AMAZON_URL = { icant: 'https://a.co/d/0fSUaomu' };
const LABELS = ['', 'Did not work for me', 'Below what I hoped', 'Solid', 'Really good', 'Changed how I operate'];

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const courseUrl = () => `/course.html?course=${encodeURIComponent(slug)}`;

function render(html) { $('rv-root').innerHTML = html; }

function thanksHtml(title, rating) {
  const amazon = AMAZON_URL[slug];
  return `
    <div class="cm-eyebrow">${esc(title)}</div>
    <h1 style="margin-top:10px;">Thank <span>you.</span></h1>
    <p class="cm-lead" style="margin-top:12px;">
      Your ${rating}★ review is in. Once it is approved it goes up on the course page,
      where it helps the next person decide to start.
    </p>
    <div class="rv-links">
      <a href="${courseUrl()}">See the course page →</a>
      ${amazon && rating >= 4 ? `<a href="${amazon}" target="_blank" rel="noopener">Loved the book too? Leave it an Amazon review →</a>` : ''}
      <a href="/dashboard.html" style="color:var(--gray-light);">Back to the Academy</a>
    </div>`;
}

function formHtml(title, prev) {
  return `
    <div class="cm-eyebrow">${esc(title)}</div>
    <h1 style="margin-top:10px;">How did it <span>land?</span></h1>
    <p class="cm-lead" style="margin-top:12px;">
      You finished the course. Rate it and say what it changed for you. Honest beats polite.
    </p>
    <div class="rv-stars" role="radiogroup" aria-label="Your rating">
      ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="rv-star" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? 's' : ''}" data-n="${n}">★</button>`).join('')}
    </div>
    <div class="rv-label" id="rv-label"></div>
    <textarea class="rv-text" id="rv-text" maxlength="2000"
      placeholder="What changed for you? What would you tell someone deciding whether to start?">${esc(prev ? prev.text : '')}</textarea>
    <div class="rv-note">Your first name and last initial show with your review.${prev ? ' Editing sends it back for approval.' : ''}</div>
    <div class="rv-actions">
      <button type="button" class="btn btn-primary" id="rv-submit">Submit review</button>
      <span id="rv-msg"></span>
    </div>`;
}

function bindForm(title, prev) {
  let rating = prev ? Number(prev.rating) || 0 : 0;
  const stars = Array.from(document.querySelectorAll('.rv-star'));
  const paint = (n) => {
    stars.forEach((s) => {
      const on = Number(s.dataset.n) <= n;
      s.classList.toggle('is-on', on);
      s.setAttribute('aria-checked', String(Number(s.dataset.n) === rating));
    });
    $('rv-label').textContent = LABELS[n] || '';
  };
  stars.forEach((s) => {
    s.addEventListener('mouseenter', () => paint(Number(s.dataset.n)));
    s.addEventListener('mouseleave', () => paint(rating));
    s.addEventListener('click', () => { rating = Number(s.dataset.n); paint(rating); });
  });
  paint(rating);

  $('rv-submit').addEventListener('click', async () => {
    const msg = $('rv-msg');
    if (!rating) { msg.innerHTML = '<span class="auth-error" style="display:inline;">Pick a star rating first.</span>'; return; }
    const btn = $('rv-submit');
    btn.disabled = true;
    msg.textContent = 'Saving…';
    try {
      await httpsCallable(functions, 'submitCourseReview')({ slug, rating, text: $('rv-text').value.trim() });
      render(thanksHtml(title, rating));
    } catch (e) {
      msg.innerHTML = `<span class="auth-error" style="display:inline;">${esc(e && e.message ? e.message : e)}</span>`;
      btn.disabled = false;
    }
  });
}

async function boot() {
  if (!slug) { location.replace('/courses.html'); return; }
  if (!firebaseReady) { render('<p class="cm-lead">Reviews are unavailable right now.</p>'); return; }
  const user = await onAuthReady();
  if (!user) {
    location.replace('/login.html?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }

  try { await loadCourses(); } catch (e) {}
  const course = getCourseBySlug(slug, { includeInactive: true });
  let title = (course && course.title) || slug;

  const [done, prev] = await Promise.all([
    getDoc(doc(db, 'users', user.uid, 'courseCompletions', slug)).catch(() => null),
    getDoc(doc(db, 'courseReviews', `${slug}__${user.uid}`)).catch(() => null)
  ]);
  if (done && done.exists() && done.data().courseTitle) title = done.data().courseTitle;
  document.title = `Rate ${title} | The One Percent Academy`;

  if (!done || !done.exists()) {
    render(`
      <div class="cm-eyebrow">${esc(title)}</div>
      <h1 style="margin-top:10px;">Almost <span>there.</span></h1>
      <p class="cm-lead" style="margin-top:12px;">
        Reviews open once you finish every module. Finish the course, then come back and tell us how it landed.
      </p>
      <div class="rv-links"><a href="/courses.html?course=${encodeURIComponent(slug)}">Back to the course →</a></div>`);
    return;
  }

  const prevData = prev && prev.exists() ? prev.data() : null;
  render(formHtml(title, prevData));
  bindForm(title, prevData);
}

boot();
