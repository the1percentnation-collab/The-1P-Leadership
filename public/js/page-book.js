  // ─── Program catalog (sourced from the Corporate Seminar Series Framework + rate sheet) ───
  const PROGRAMS = {
    'mindset-reset': {
      tag: 'Program 01 · Mindset',
      icon: '🧠',
      titleHTML: 'THE <span class="red">MINDSET RESET</span>',
      sub: 'A high-impact experience that breaks through the internal barriers holding teams back — replacing burnout, fear, and disengagement with ownership, resilience, and renewed momentum.',
      formats: [
        { name: 'Motivational Keynote', meta: '60–90 min · Unlimited audience', price: '$4,000' },
        { name: 'Mastermind Session', meta: '60–90 min · 5–15 participants', price: '$3,000' },
        { name: 'Professional Development Session', meta: '60–90 min · 10–30 participants', price: '$2,500' },
        { name: 'Virtual Session', meta: 'Live online · Flexible group', price: '$2,000' }
      ],
      upsell: 'Want it ongoing? Add <strong>1:1 coaching</strong> at $300/participant per session, or roll this into a <strong>Customized Corporate Package</strong> from $10,000.'
    },
    'purpose-pathways': {
      tag: 'Program 02 · Alignment',
      icon: '🧭',
      titleHTML: '<span class="red">PURPOSE</span> PATHWAYS',
      sub: 'Designed for teams that are busy but misaligned. Brings clarity to priorities, connects individual purpose to company goals, and turns effort into intentional execution.',
      formats: [
        { name: 'Workshop / Breakout', meta: '60–90 min · 10–20 participants', price: '$3,500' },
        { name: 'Corporate Training — Half-Day', meta: '60–90 min · 10–30 participants', price: '$4,500' },
        { name: 'Corporate Training — Full-Day', meta: '60–90 min · 10–30 participants', price: '$7,500' },
        { name: 'Professional Development Session', meta: '60–90 min · 10–30 participants', price: '$2,500' }
      ],
      upsell: 'Aligning multiple teams? A <strong>Customized Corporate Package</strong> (from $10,000) or an <strong>Annual Subscription</strong> ($50,000/company) keeps everyone on the same pathway year-round.'
    },
    'leadership-ascension': {
      tag: 'Program 03 · Leadership',
      icon: '⚡',
      titleHTML: 'LEADERSHIP <span class="red">ASCENSION</span>',
      sub: 'Equips leaders with the mindset, tools, and accountability frameworks needed to lead confidently and build cultures where people and performance thrive.',
      formats: [
        { name: 'Leadership Development Seminar — Half-Day', meta: '60–90 min · 10–50 participants', price: '$3,500' },
        { name: 'Leadership Development Seminar — Full-Day', meta: '60–90 min · 10–50 participants', price: '$6,500' },
        { name: 'Multi-Day Conference Facilitation', meta: '60–90 min · Leadership team', price: '$15,000+' },
        { name: 'Add-on 1:1 Leadership Coaching', meta: '60–90 min · Per participant', price: '$300' }
      ],
      upsell: 'For sustained culture change, an <strong>Annual Subscription</strong> ($50,000/company) or a <strong>Customized Corporate Package</strong> (from $10,000) builds accountability across the whole leadership bench.'
    }
  };

  const ORDER = ['mindset-reset', 'purpose-pathways', 'leadership-ascension'];

  function getProgramKey() {
    const p = new URLSearchParams(location.search).get('program');
    return PROGRAMS[p] ? p : 'mindset-reset';
  }

  const key = getProgramKey();
  const prog = PROGRAMS[key];

  // Hero
  document.getElementById('hero-tag').textContent = prog.tag;
  document.getElementById('hero-icon').textContent = prog.icon;
  document.getElementById('hero-title').innerHTML = prog.titleHTML;
  document.getElementById('hero-sub').textContent = prog.sub;
  document.title = prog.titleHTML.replace(/<[^>]+>/g, '') + ' | Book | The One Percent Nation';

  // Program switcher
  const switchEl = document.getElementById('prog-switch');
  ORDER.forEach(k => {
    const a = document.createElement('a');
    a.href = '/book.html?program=' + k;
    a.textContent = PROGRAMS[k].titleHTML.replace(/<[^>]+>/g, '');
    if (k === key) a.classList.add('active');
    switchEl.appendChild(a);
  });

  // Hidden fields
  document.getElementById('f-program').value = prog.titleHTML.replace(/<[^>]+>/g, '');
  document.getElementById('f-source').value = 'book_' + key;

  // Formats list + select
  const listEl = document.getElementById('format-list');
  const selectEl = document.getElementById('f-format');
  prog.formats.forEach(f => {
    const label = f.name + ' — ' + f.price;

    const card = document.createElement('div');
    card.className = 'format-card';
    card.innerHTML =
      '<div class="format-main"><div class="format-name">' + f.name + '</div>' +
      '<div class="format-meta">' + f.meta + '</div></div>' +
      '<div class="format-price">' + f.price + '<small>starting</small></div>';
    card.addEventListener('click', () => {
      document.querySelectorAll('.format-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selectEl.value = label;
      document.getElementById('book-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    listEl.appendChild(card);

    const opt = document.createElement('option');
    opt.value = label; opt.textContent = label;
    selectEl.appendChild(opt);
  });

  // Keep cards in sync if user picks from the dropdown
  selectEl.addEventListener('change', () => {
    document.querySelectorAll('.format-card').forEach((c, i) => {
      c.classList.toggle('selected', (prog.formats[i].name + ' — ' + prog.formats[i].price) === selectEl.value);
    });
  });

  document.getElementById('upsell-note').innerHTML = prog.upsell;

  // Consent toggle
  let consentChecked = false;
  const consentBox = document.getElementById('consent-box');
  document.getElementById('consent').addEventListener('click', () => {
    consentChecked = !consentChecked;
    consentBox.classList.toggle('checked', consentChecked);
  });

  // ─── Submit ───
  document.getElementById('book-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    let valid = true;

    const name = this.full_name.value.trim();
    const email = this.email.value.trim();
    const goals = this.goals.value.trim();

    const setErr = (wrapId, ok) => document.getElementById(wrapId).classList.toggle('invalid', !ok);
    setErr('f-wrap-name', !!name);
    setErr('f-wrap-email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    const goalsField = document.getElementById('f-goals').closest('.field');
    goalsField.classList.toggle('invalid', !goals);

    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !goals) valid = false;

    if (!consentChecked) {
      consentBox.style.borderColor = 'var(--red)';
      valid = false;
    }
    if (!valid) {
      this.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = document.getElementById('btn-submit');
    const btnText = document.getElementById('btn-text');
    btn.disabled = true;
    btnText.textContent = 'Sending your request...';

    try {
      const fd = new FormData(this);
      // Same public lead destination the site already uses (GoHighLevel / LeadConnector)
      await fetch('https://api.leadconnectorhq.com/widget/form/2RRVTzt8PJABfOAPd84Z', {
        method: 'POST', mode: 'no-cors', body: fd
      });
    } catch (err) {
      // no-cors: response is opaque, proceed to success
    }

    try { gtag('event', 'generate_lead', { program: key, value: 1 }); } catch (e) {}

    document.getElementById('book-form').style.display = 'none';
    const success = document.getElementById('form-success');
    success.style.display = 'flex';
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Fade-up on scroll
  const obs = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) en.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));

