// Join the Team (/join): renders the open roles from careers-data.js and
// sends inquiries to the CRM.
//
// An inquiry goes through submitLeadForm as formType 'careers'. The server
// tags the contact "Recruiting" plus one tag per role (functions/careers.js),
// so each hiring track is one filter in the CRM, and emails the owner.
//
// Callback-only: this page is not one of the declared SMS opt-in points, so
// it shows no consent boxes and asserts no consent. tests/consent-labels
// holds it to that.

import { TEAMS, NOT_SURE, openRoles, roleByKey } from './careers-data.js';

// Firebase is loaded on submit, not up front, so the postings render even
// when the SDK is slow or blocked. Started early in the background so the
// submit itself rarely waits.
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

const $ = (id) => document.getElementById(id);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;

function roleCard(r) {
  return `<article class="role" id="role-${esc(r.key)}">
    <span class="role-status">Open</span>
    <h3>${esc(r.title)}</h3>
    <div class="role-meta">${r.meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
    <p class="role-summary">${esc(r.summary)}</p>
    <div class="role-cols">
      <div><div class="role-k">What you will do</div>${list(r.does)}</div>
      <div><div class="role-k">Who fits</div>${list(r.fits)}</div>
    </div>
    ${r.path ? `<p class="role-path">${esc(r.path.text)} <a href="${esc(r.path.href)}">${esc(r.path.label)}</a></p>` : ''}
    <div class="role-foot"><button class="btn-outline" type="button" data-inquire="${esc(r.key)}">Inquire about this role &rarr;</button></div>
  </article>`;
}

function render() {
  const roles = openRoles();
  const teams = TEAMS
    .map((t) => ({ ...t, roles: roles.filter((r) => r.team === t.key) }))
    .filter((t) => t.roles.length);

  $('jump').innerHTML = teams.map((t) => `<a href="#team-${esc(t.key)}">${esc(t.label)}</a>`).join('')
    + '<a href="#inquire">Inquire</a>';

  $('teams').innerHTML = teams.map((t) => `<section class="team" id="team-${esc(t.key)}">
      <div class="team-head">
        <div><div class="team-org">${esc(t.org)}</div><h2 class="team-title">${esc(t.label)}</h2></div>
        <p class="team-intro">${esc(t.intro)}</p>
      </div>
      ${t.path ? `<div class="team-path-k">How you get started</div><ol class="team-path">${t.path.map((st, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><strong>${esc(st.title)}</strong><span>${esc(st.text)}</span></li>`).join('')}</ol>` : ''}
      <div class="roles${t.roles.length === 1 ? ' one' : ''}">${t.roles.map(roleCard).join('')}</div>
      ${t.disclaimer ? `<p class="team-note">${esc(t.disclaimer)}</p>` : ''}
    </section>`).join('');

  $('j-role').innerHTML = '<option value="">Select a role</option>'
    + teams.map((t) => `<optgroup label="${esc(t.label)}">${t.roles.map((r) => `<option value="${esc(r.key)}">${esc(r.title)}</option>`).join('')}</optgroup>`).join('')
    + `<option value="${NOT_SURE.key}">${esc(NOT_SURE.title)}</option>`;

  document.querySelectorAll('[data-inquire]').forEach((b) => b.addEventListener('click', () => {
    $('j-role').value = b.dataset.inquire;
    $('inquire').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('j-name').focus({ preventScroll: true }), 500);
  }));

  // A link like /join?role=coach arrives with the role already chosen.
  const wanted = roleByKey(new URLSearchParams(location.search).get('role'));
  if (wanted) $('j-role').value = wanted.key;
}

function show(text, isErr) {
  $('j-msg').textContent = text || '';
  $('j-msg').className = 'msg' + (isErr ? ' err' : '');
}

async function submit(e) {
  e.preventDefault();
  show('');
  const role = roleByKey($('j-role').value);
  const name = $('j-name').value.trim();
  const email = $('j-email').value.trim();
  const why = $('j-why').value.trim();
  if (!role) { show('Please choose the role you are asking about.', true); $('j-role').focus(); return; }
  if (!name) { show('Please enter your name.', true); $('j-name').focus(); return; }
  if (!EMAIL_RE.test(email)) { show('Please enter a valid email address.', true); $('j-email').focus(); return; }
  if (!why) { show('Tell us a little about what draws you to this team.', true); $('j-why').focus(); return; }
  const btn = $('j-submit');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending…';

  const fields = {
    role: role.title,
    role_key: role.key,
    location: $('j-location').value.trim(),
    experience: $('j-experience').value,
    credentials: $('j-credentials').value.trim(),
    why,
    link: $('j-link').value.trim()
  };
  Object.keys(fields).forEach((k) => { if (!fields[k]) delete fields[k]; });

  try {
    const { functions, firebaseReady, httpsCallable } = await loadFirebase();
    if (!firebaseReady) throw new Error('The form is unavailable right now. Email anthonybrown@the1pnation.com and we will pick it up there.');
    await httpsCallable(functions, 'submitLeadForm')({
      formType: 'careers',
      name,
      email,
      phone: $('j-phone').value.trim() || undefined,
      fields,
      consent: false
    });
  } catch (err) {
    // Never show the confirmation on failure: it would promise a reply that
    // never comes.
    console.warn('[join] inquiry failed', err);
    show((err && err.message) || 'We could not send that. Email anthonybrown@the1pnation.com and we will pick it up there.', true);
    btn.disabled = false;
    btn.textContent = label;
    return;
  }
  $('join-form').style.display = 'none';
  $('join-done').classList.add('show');
  if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form: 'careers', role: role.key });
}

render();
$('join-form').addEventListener('submit', submit);
loadFirebase().catch((e) => console.warn('[join] Firebase did not load yet', e));
