// Book Anthony to Speak (/speaking): the speaking inquiry form.
//
// Goes through submitLeadForm as formType 'speaking', so it lands in the CRM
// as a "Speaking Request" lead and emails the owner, the same pipeline the
// older /book.html program form uses. This page asks for the event, not a
// program: date, room, audience, format, and budget.
//
// Callback-only: not one of the declared SMS opt-in pages, so no consent
// boxes and no consent asserted. tests/consent-labels holds it to that.
//
// Firebase loads in the background and is awaited only on submit, so the
// form works the moment the page paints.

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let firebaseLoad = null;
function loadFirebase() {
  if (!firebaseLoad) {
    firebaseLoad = Promise.all([
      import('./firebase.js'),
      import('https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js')
    ]).then(([fb, fn]) => ({ functions: fb.functions, firebaseReady: fb.firebaseReady, httpsCallable: fn.httpsCallable }));
  }
  return firebaseLoad;
}

function show(text, isErr) {
  $('sp-msg').textContent = text || '';
  $('sp-msg').className = 'msg' + (isErr ? ' err' : '');
}

async function submit(e) {
  e.preventDefault();
  show('');
  const name = $('sp-name').value.trim();
  const email = $('sp-email').value.trim();
  const organization = $('sp-org').value.trim();
  const goals = $('sp-goals').value.trim();
  if (!name) { show('Please enter your name.', true); $('sp-name').focus(); return; }
  if (!EMAIL_RE.test(email)) { show('Please enter a valid email address.', true); $('sp-email').focus(); return; }
  if (!organization) { show('Please add your organization.', true); $('sp-org').focus(); return; }
  if (!goals) { show('Tell us what people should walk out with.', true); $('sp-goals').focus(); return; }

  const btn = $('sp-submit');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const fields = {
    organization,
    event: $('sp-event').value.trim(),
    event_date: $('sp-date').value.trim(),
    location: $('sp-where').value.trim(),
    audience: $('sp-size').value,
    event_type: $('sp-type').value,
    format: $('sp-format').value,
    budget: $('sp-budget').value,
    goals,
    page: 'speaking'
  };
  Object.keys(fields).forEach((k) => { if (!fields[k]) delete fields[k]; });

  try {
    const { functions, firebaseReady, httpsCallable } = await loadFirebase();
    if (!firebaseReady) throw new Error('The form is unavailable right now. Email anthonybrown@the1pnation.com and we will pick it up there.');
    await httpsCallable(functions, 'submitLeadForm')({
      formType: 'speaking',
      name,
      email,
      phone: $('sp-phone').value.trim() || undefined,
      fields,
      consent: false
    });
  } catch (err) {
    // Never show the confirmation on failure: it would promise a reply that
    // never comes.
    console.warn('[speaking] request failed', err);
    show((err && err.message) || 'We could not send that. Email anthonybrown@the1pnation.com and we will pick it up there.', true);
    btn.disabled = false;
    btn.textContent = label;
    return;
  }
  $('sp-form').style.display = 'none';
  $('sp-done').classList.add('show');
  if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form: 'speaking' });
}

$('sp-form').addEventListener('submit', submit);
loadFirebase().catch((e) => console.warn('[speaking] Firebase did not load yet', e));
