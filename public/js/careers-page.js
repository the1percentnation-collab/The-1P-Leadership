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

const list = (items) => `<ul class="dots">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
const meta = (m) => `<div class="role-meta">${m.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`;
const roleHref = (key) => `/join?role=${encodeURIComponent(key)}`;

// Two views on one page:
//   /join             every open role as a short row, then the form
//   /join?role=<key>  one role as a single-column posting, then the form
// Recruiting links go straight to the second, so an applicant reads one role,
// not the whole board.
let heroBrowse = null;

// Recruiting links can say where they were shared and who shared them:
//   /join?role=life-insurance&src=linkedin&ref=marcus
// Read once on arrival, so moving between roles on the page keeps them.
// The server turns a known src into a CRM tag (functions/careers.js); ref is
// kept as a field on the inquiry. utm_source works as a fallback for src.
const clean = (v, n) => String(v || '').toLowerCase().trim().replace(/[^a-z0-9 _.-]/g, '').slice(0, n);
const arrival = new URLSearchParams(location.search);
const TRACK = {
  source: clean(arrival.get('src') || arrival.get('utm_source'), 40),
  referred_by: clean(arrival.get('ref'), 60)
};

function teamsWithRoles() {
  const roles = openRoles();
  return TEAMS
    .map((t) => ({ ...t, roles: roles.filter((r) => r.team === t.key) }))
    .filter((t) => t.roles.length);
}

function roleRow(r) {
  return `<a class="role-row" href="${roleHref(r.key)}" data-nav>
    <div class="role-row-main">
      <h3>${esc(r.title)}</h3>
      ${meta(r.meta)}
      <p>${esc(r.summary)}</p>
    </div>
    <span class="role-row-go">View role <span aria-hidden="true">&rarr;</span></span>
  </a>`;
}

function renderBrowse(teams) {
  $('hero').innerHTML = heroBrowse;
  $('role-view').innerHTML = '';
  $('teams').innerHTML = teams.map((t) => `<section class="team" id="team-${esc(t.key)}">
      <div class="team-org">${esc(t.org)}</div>
      <h2 class="team-title">${esc(t.label)}</h2>
      <p class="team-intro">${esc(t.intro)}</p>
      <div class="role-rows">${t.roles.map(roleRow).join('')}</div>
    </section>`).join('');
  $('others').innerHTML = '';
  const notes = teams.filter((t) => t.disclaimer).map((t) => esc(t.disclaimer));
  $('note').innerHTML = notes.join('<br><br>');
  $('role-field').hidden = false;
  $('role-chosen').hidden = true;
}

function renderRole(role, teams) {
  const team = teams.find((t) => t.key === role.team);
  $('hero').innerHTML = `
    <a class="back" href="/join" data-nav>&larr; All open roles</a>
    <span class="tag">${esc(team.org)} &middot; Open role</span>
    <h1 class="title role-title">${esc(role.title)}</h1>
    ${meta(role.meta)}
    <p class="sub">${esc(role.summary)}</p>
    <div class="hero-cta">
      <a class="btn-primary" href="#inquire">Start your inquiry &rarr;</a>
      <span class="hint">Takes about two minutes. No resume needed.</span>
    </div>`;

  $('role-view').innerHTML = `
    <section class="block">
      <div class="cols2">
        <div><h2 class="k">What you will do</h2>${list(role.does)}</div>
        <div><h2 class="k">Who fits</h2>${list(role.fits)}</div>
      </div>
      ${role.path ? `<p class="role-path">${esc(role.path.text)} <a href="${esc(role.path.href)}">${esc(role.path.label)}</a></p>` : ''}
    </section>
    ${team.path ? `<section class="block">
      <h2 class="k">How you get started</h2>
      <ol class="steps">${team.path.map((st, i) => `<li><span class="n">${String(i + 1).padStart(2, '0')}</span><div><strong>${esc(st.title)}</strong><span>${esc(st.text)}</span></div></li>`).join('')}</ol>
    </section>` : ''}`;
  $('teams').innerHTML = '';

  const others = teams.flatMap((t) => t.roles).filter((r) => r.key !== role.key);
  $('others').innerHTML = others.length ? `<h2 class="k">Other open roles</h2>
    <div class="other-list">${others.map((r) => `<a href="${roleHref(r.key)}" data-nav><span>${esc(r.title)}</span><span aria-hidden="true">&rarr;</span></a>`).join('')}</div>` : '';
  $('note').textContent = team.disclaimer || '';

  $('role-field').hidden = true;
  $('role-chosen').hidden = false;
  $('role-chosen-name').textContent = role.title;
}

function render() {
  const teams = teamsWithRoles();
  if (heroBrowse === null) heroBrowse = $('hero').innerHTML;

  // A link like /join?role=coach arrives with the role already chosen.
  const wanted = roleByKey(new URLSearchParams(location.search).get('role'));
  const focused = wanted && wanted !== NOT_SURE;
  document.body.classList.toggle('focused', !!focused);

  $('j-role').innerHTML = '<option value="">Select a role</option>'
    + teams.map((t) => `<optgroup label="${esc(t.label)}">${t.roles.map((r) => `<option value="${esc(r.key)}">${esc(r.title)}</option>`).join('')}</optgroup>`).join('')
    + `<option value="${NOT_SURE.key}">${esc(NOT_SURE.title)}</option>`;
  if (wanted) $('j-role').value = wanted.key;

  if (focused) renderRole(wanted, teams);
  else renderBrowse(teams);
  document.title = focused ? `${wanted.title} | Join the Team | The One Percent Nation` : 'Join the Team | The One Percent Nation';
}

// Moving between roles stays on the page: no reload, back button works.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-nav]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  history.pushState(null, '', a.getAttribute('href'));
  render();
  window.scrollTo(0, 0);
});
window.addEventListener('popstate', render);

// Phones: a pinned "Start your inquiry" bar while neither the hero button nor
// the form is on screen.
function stickyCta() {
  const bar = $('sticky-cta');
  if (!bar || !('IntersectionObserver' in window)) return;
  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => seen.set(en.target, en.isIntersecting));
    bar.classList.toggle('show', ![...seen.values()].some(Boolean));
  });
  io.observe($('hero'));
  io.observe($('inquire'));
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
    link: $('j-link').value.trim(),
    source: TRACK.source,
    referred_by: TRACK.referred_by
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
  if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form: 'careers', role: role.key, source: TRACK.source || 'direct' });
}

render();
stickyCta();
$('join-form').addEventListener('submit', submit);
loadFirebase().catch((e) => console.warn('[join] Firebase did not load yet', e));
