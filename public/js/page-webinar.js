  // Countdown to next Thursday 7PM ET
  function updateCd() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(19, 0, 0, 0);
    const dow = now.getDay();
    const days = (4 - dow + 7) % 7 || 7;
    next.setDate(now.getDate() + days);
    const diff = next - now;
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    document.getElementById('cd-d').textContent = String(d).padStart(2,'0');
    document.getElementById('cd-h').textContent = String(h).padStart(2,'0');
    document.getElementById('cd-m').textContent = String(m).padStart(2,'0');
    document.getElementById('cd-s').textContent = String(s).padStart(2,'0');
  }
  updateCd(); setInterval(updateCd, 1000);

  // Spots simulation (bar only; counter removed)
  let spots = 53;
  setInterval(() => {
    if (spots < 80 && Math.random() < 0.2) {
      spots++;
      const bar = document.getElementById('spots-bar');
      if (bar) bar.style.width = spots + '%';
    }
  }, 12000);

  // Consent toggles
  function toggleConsent(id) {
    const box = document.getElementById(id);
    box.classList.toggle('checked');
  }

  // Step navigation (questions only)
  (function(){
    const form = document.getElementById('webinar-form');
    const steps = Array.from(form.querySelectorAll('.form-step'));
    const total = steps.length;
    const backBtn = document.getElementById('btn-back');
    const nextBtn = document.getElementById('btn-next');
    const stepLabel = document.getElementById('step-label');
    const progressFill = document.getElementById('step-progress-fill');
    const finalStep = document.getElementById('final-step');
    const stepNav = form.querySelector('.step-nav');
    let current = 0;

    function showStep(i) {
      steps.forEach((s, idx) => s.classList.toggle('is-active', idx === i));
      stepLabel.textContent = `Question ${i + 1} of ${total}`;
      progressFill.style.width = `${((i + 1) / total) * 100}%`;
      backBtn.disabled = i === 0;
      backBtn.style.display = i === 0 ? 'none' : '';
      nextBtn.style.display = '';
      nextBtn.textContent = i === total - 1 ? 'Review & Confirm →' : 'Continue →';
      // Re-lock final section if user steps back from review
      if (i !== total - 1) finalStep.classList.remove('is-unlocked');
    }

    function validateStep(i) {
      const f = form;
      const showErr = (id, bad) => { const el = document.getElementById(id); if (el) el.style.display = bad ? 'block' : 'none'; };
      const setInvalid = (id, bad) => { const el = document.getElementById(id); if (el) el.classList.toggle('invalid', bad); };
      switch (i) {
        case 0: {
          const ok = !!(f.inspire && f.inspire.value);
          showErr('err-inspire', !ok);
          return ok;
        }
        case 1: {
          const ok = !!(f.holdback && f.holdback.value);
          showErr('err-holdback', !ok);
          return ok;
        }
        case 2: {
          const ok = !!(f.reset && f.reset.value);
          showErr('err-reset', !ok);
          return ok;
        }
        case 3: {
          const ok = !!document.getElementById('f-question').value.trim();
          showErr('err-question', !ok);
          return ok;
        }
        case 4: {
          const ok = !!f.source.value;
          setInvalid('f-source', !ok);
          return ok;
        }
        default: return true;
      }
    }

    nextBtn.addEventListener('click', () => {
      if (!validateStep(current)) return;
      if (current < total - 1) {
        current++; showStep(current);
      } else {
        // Last question answered — reveal consent + submit
        finalStep.classList.add('is-unlocked');
        nextBtn.style.display = 'none';
        finalStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    backBtn.addEventListener('click', () => {
      if (current > 0) { current--; showStep(current); }
    });

    showStep(0);
  })();

  // Form validation & submission
  document.getElementById('webinar-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    let valid = true;

    // Name
    const name = this.name.value.trim();
    document.getElementById('f-name').classList.toggle('invalid', !name);
    if (!name) valid = false;

    // Phone
    const phone = this.phone.value.trim();
    document.getElementById('f-phone').classList.toggle('invalid', !phone);
    if (!phone) valid = false;

    // Email
    const email = this.email.value.trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    document.getElementById('f-email').classList.toggle('invalid', !emailOk);
    if (!emailOk) valid = false;

    // State
    const state = this.state.value;
    document.getElementById('f-state').classList.toggle('invalid', !state);
    if (!state) valid = false;

    // City
    const city = this.city.value.trim();
    document.getElementById('f-city').classList.toggle('invalid', !city);
    if (!city) valid = false;

    // Radio groups
    const inspire = this.inspire ? this.inspire.value : '';
    const errInspire = document.getElementById('err-inspire');
    if (!inspire) { errInspire.style.display = 'block'; valid = false; } else errInspire.style.display = 'none';

    const holdback = this.holdback ? this.holdback.value : '';
    const errHoldback = document.getElementById('err-holdback');
    if (!holdback) { errHoldback.style.display = 'block'; valid = false; } else errHoldback.style.display = 'none';

    const reset = this.reset ? this.reset.value : '';
    const errReset = document.getElementById('err-reset');
    if (!reset) { errReset.style.display = 'block'; valid = false; } else errReset.style.display = 'none';

    // Question
    const question = document.getElementById('f-question').value.trim();
    const errQ = document.getElementById('err-question');
    if (!question) { errQ.style.display = 'block'; valid = false; } else errQ.style.display = 'none';

    // Source
    const source = this.source.value;
    document.getElementById('f-source').classList.toggle('invalid', !source);
    if (!source) valid = false;

    if (!valid) {
      this.querySelector('.invalid, [id^="err-"]:not([style*="none"])') &&
        this.querySelector('.invalid')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // Submit
    const btn = document.getElementById('btn-submit');
    const btnText = document.getElementById('btn-text');
    btn.disabled = true;
    btnText.textContent = 'Securing your spot...';

    // Submit to GoHighLevel
    try {
      const formData = new FormData();
      formData.append('full_name', name);
      formData.append('phone', phone);
      formData.append('email', email);
      formData.append('state', state);
      formData.append('city', city);
      formData.append('inspire', inspire);
      formData.append('holdback', holdback);
      formData.append('reset', reset);
      formData.append('question', question);
      formData.append('source', source);

      await fetch('https://api.leadconnectorhq.com/widget/form/2RRVTzt8PJABfOAPd84Z', {
        method: 'POST',
        mode: 'no-cors',
        body: formData
      });
    } catch(err) {
      // no-cors means we can't read the response; proceed to success
    }

    // Show success
    document.getElementById('webinar-form').style.display = 'none';
    const success = document.getElementById('form-success');
    success.style.display = 'flex';

    // Scroll into view
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Scroll animations
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));

// ─── PAGE TRANSITION ─────────────────────────────────────────
(function() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#E60306;transform:scaleX(1);transform-origin:right;pointer-events:none;';
  document.body.appendChild(overlay);
  window.addEventListener('load', () => {
    overlay.style.transition = 'transform 0.45s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      overlay.style.transform = 'scaleX(0)';
    }));
  });
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto')) return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      overlay.style.transformOrigin = 'left';
      overlay.style.transition = 'transform 0.35s cubic-bezier(0.76,0,0.24,1)';
      overlay.style.transform = 'scaleX(1)';
      setTimeout(() => { window.location.href = href; }, 340);
    });
  });
})();

// ─── MAGNETIC BUTTONS ────────────────────────────────────────
document.querySelectorAll('.btn-submit, .cdb-cta').forEach(btn => {
  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const dx = (e.clientX - rect.left - rect.width/2) * 0.2;
    const dy = (e.clientY - rect.top  - rect.height/2) * 0.2;
    btn.style.transform = `translate(${dx}px,${dy}px) scale(1.02)`;
    btn.style.boxShadow = '0 8px 28px rgba(230,3,6,0.3)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = '';
    btn.style.boxShadow = '';
  });
});

// ─── STAGGER LIST ────────────────────────────────────────────
const staggerObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); staggerObs.unobserve(e.target); }});
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.stagger-list').forEach(el => staggerObs.observe(el));

// Bindings for former inline handlers (R7 — CSP: no inline JS).
document.querySelectorAll('[data-scroll]').forEach((el) => {
  el.addEventListener('click', () => {
    const t = document.getElementById(el.getAttribute('data-scroll'));
    if (t) t.scrollIntoView({ behavior: 'smooth' });
  });
});
document.querySelectorAll('[data-consent]').forEach((el) => {
  el.addEventListener('click', () => toggleConsent(el.getAttribute('data-consent')));
});

