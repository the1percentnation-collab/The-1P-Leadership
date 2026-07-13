// ─── NAV SCROLL ─────────────────────────────────────────────────
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
});

// ─── MOBILE MENU ────────────────────────────────────────────────
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const burger = document.getElementById('hamburger');
  menu.classList.toggle('open');
  burger.classList.toggle('open');
  document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : '';
}
function closeMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const burger = document.getElementById('hamburger');
  menu.classList.remove('open');
  burger.classList.remove('open');
  document.body.style.overflow = '';
}

// ─── LOGIN MODAL ────────────────────────────────────────────────
// Modal removed — clicking any Member Portal / Sign In button now
// navigates straight to the dedicated /login.html. Keeps marketing
// pages free of password inputs so Safari / iCloud Passwords doesn't
// prompt to autofill on initial page load.
function openLogin() { window.location.href = '/login.html'; }
function closeLogin() {}
function closeLoginOutside() {}

function setModalTab() {}

function handleSignIn() { window.location.href = '/login.html'; }
function handleSignUp() { window.location.href = '/signup.html'; }
function handleGoogleAuth() { window.location.href = '/login.html?method=google'; }

// ─── FAQ ────────────────────────────────────────────────────────
function toggleFaq(el) {
  const item = el.parentElement;
  const isOpen = item.classList.contains('open');
  document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
  if (!isOpen) item.classList.add('open');
}

// ============================================================
// ANIMATION SUITE — 5 components + magnetic + stagger + page transition
// ============================================================

// ─── 1. SCROLL FADE (ScrollFade component) ───────────────────
// ease-out-expo matches Framer Motion [0.16,1,0.3,1]
const fadeSelectors = '.fade-up, .fade-down, .fade-left, .fade-right';
const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      // don't unobserve — allows re-trigger if once=false needed
    }
  });
}, { threshold: 0.08, rootMargin: '0px 0px -48px 0px' });
document.querySelectorAll(fadeSelectors).forEach(el => fadeObserver.observe(el));

// ─── 4. STAGGERED LIST REVEAL ────────────────────────────────
const staggerObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      staggerObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.stagger-list').forEach(el => staggerObserver.observe(el));

// ─── 5. COUNT-UP (ease-out-expo via rAF) ─────────────────────
function easeOutExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

function animateCount(el) {
  const target = parseFloat(el.dataset.target);
  const from   = parseFloat(el.dataset.from || '0');
  const duration = parseFloat(el.dataset.duration || '2') * 1000;
  const decimals  = parseInt(el.dataset.decimals || '0');
  let startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    const elapsed  = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = easeOutExpo(progress);
    const current  = from + (target - from) * eased;
    el.textContent = current.toFixed(decimals);
    if (progress < 1) requestAnimationFrame(step);
    else el.textContent = target.toFixed(decimals);
  }
  requestAnimationFrame(step);
}

const countObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      animateCount(e.target);
      countObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.5 });
document.querySelectorAll('.count-up').forEach(el => countObserver.observe(el));

// ─── BONUS: MAGNETIC BUTTONS ─────────────────────────────────
// Buttons subtly follow cursor, snap back on leave
document.querySelectorAll('.btn-primary, .btn-cta-nav').forEach(btn => {
  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top  + rect.height / 2;
    const dx = (e.clientX - cx) * 0.22;
    const dy = (e.clientY - cy) * 0.22;
    btn.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;
    btn.style.boxShadow = `0 8px 28px rgba(230,3,6,0.28)`;
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = '';
    btn.style.boxShadow = '';
  });
  btn.addEventListener('mousedown', () => {
    btn.style.transform = 'scale(0.96)';
  });
  btn.addEventListener('mouseup', () => {
    btn.style.transform = '';
  });
});

// ─── BONUS: HOVER CARD 3D TILT ───────────────────────────────
// Applied to impact-cards and course-cards
document.querySelectorAll('.impact-card, .course-card').forEach(card => {
  card.classList.add('tilt-card');
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width  - 0.5;
    const y = (e.clientY - rect.top)  / rect.height - 0.5;
    card.style.transform = `perspective(900px) rotateX(${-y*5}deg) rotateY(${x*5}deg) scale(1.01)`;
    card.style.transition = 'transform 0.1s ease-out';
  });
  card.addEventListener('mouseleave', () => {
    card.style.transform = '';
    card.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1)';
  });
});

// ─── 3. PAGE TRANSITION OVERLAY ──────────────────────────────
// Red sweep on internal link clicks
(function() {
  // Inject overlay element
  const overlay = document.createElement('div');
  overlay.id = 'page-transition-overlay';
  document.body.appendChild(overlay);

  function runTransition(href) {
    overlay.style.transition = 'transform 0.35s cubic-bezier(0.76,0,0.24,1)';
    overlay.style.transformOrigin = 'left';
    overlay.style.transform = 'scaleX(1)';

    setTimeout(() => {
      window.location.href = href;
    }, 340);
  }

  // Page load: sweep out
  window.addEventListener('load', () => {
    overlay.style.transformOrigin = 'right';
    overlay.style.transition = 'transform 0.45s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.style.transform = 'scaleX(0)';
      });
    });
  });

  // Intercept internal links
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') ||
        href.startsWith('mailto') || href.startsWith('tel')) return;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      runTransition(href);
    });
  });
})();

// ============================================================
// HERO CINEMATIC ANIMATION SYSTEM
// ============================================================
(function () {
  // ── ease-out-expo ──────────────────────────────────────────
  function ease(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  // ── 1. WORD-BY-WORD TITLE REVEAL ─────────────────────────
  // Wraps each line in clip containers so text slides up from below
  function setupTitleReveal() {
    const title = document.getElementById('hero-title-el');
    if (!title) return;

    // Parse lines from innerHTML, preserve spans
    const rawHTML = title.innerHTML;
    const lines = rawHTML.split(/<br\s*\/?>/i);

    title.innerHTML = lines.map((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      return `<span class="word-wrap" style="display:block;overflow:hidden;line-height:0.95;">
        <span class="word-inner" data-line="${i}" style="display:block;">${trimmed}</span>
      </span>`;
    }).join('');
  }

  function revealTitleLines() {
    const lines = document.querySelectorAll('.word-inner');
    lines.forEach((line, i) => {
      const delay = 0.18 + i * 0.13; // stagger per line
      line.style.transition = `transform 0.85s ${delay}s cubic-bezier(0.16,1,0.3,1), opacity 0.6s ${delay}s ease`;
      setTimeout(() => {
        line.style.transform = 'translateY(0)';
        line.style.opacity = '1';
        // Mark red and outline spans after their line reveals
        if (i === 1) {
          const red = line.querySelector('.red');
          if (red) setTimeout(() => red.classList.add('revealed'), 300);
        }
        if (i === 2) {
          const outline = line.querySelector('.outline');
          if (outline) setTimeout(() => outline.classList.add('revealed'), 200);
        }
      }, delay * 1000 + 60);
    });
  }

  // ── 2. EYEBROW TAG REVEAL ──────────────────────────────────
  function revealEyebrow() {
    const eyebrow = document.querySelector('.hero-eyebrow');
    if (!eyebrow) return;
    setTimeout(() => eyebrow.classList.add('tag-revealed'), 80);
  }

  // ── 3. SUBTITLE REVEAL ────────────────────────────────────
  function revealSub() {
    const sub = document.querySelector('.hero-sub');
    if (!sub) return;
    sub.style.opacity = '0';
    sub.style.transform = 'translateY(24px)';
    sub.style.transition = 'opacity 0.8s 0.95s cubic-bezier(0.16,1,0.3,1), transform 0.8s 0.95s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sub.style.opacity = '1';
      sub.style.transform = 'translateY(0)';
    }));
  }

  // ── 4. CTA BUTTON REVEAL ──────────────────────────────────
  function revealActions() {
    const actions = document.querySelector('.hero-actions');
    if (!actions) return;
    actions.style.opacity = '0';
    actions.style.transform = 'translateY(20px)';
    actions.style.transition = 'opacity 0.7s 1.2s cubic-bezier(0.16,1,0.3,1), transform 0.7s 1.2s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      actions.style.opacity = '1';
      actions.style.transform = 'translateY(0)';
    }));
  }

  // ── 5. RED ACCENT LINE ────────────────────────────────────
  function revealLine() {
    const line = document.getElementById('hero-line');
    if (!line) return;
    setTimeout(() => line.classList.add('revealed'), 1400);
  }

  // ── 6. HERO CARD SLIDE-IN FROM RIGHT ─────────────────────
  function revealCard() {
    const card = document.querySelector('.hero-card');
    if (!card) return;
    setTimeout(() => {
      card.classList.add('card-revealed');
      // Stagger pillar items inside card
      const pillars = card.querySelectorAll('.hero-pillar-item');
      pillars.forEach((p, i) => {
        setTimeout(() => p.classList.add('pill-revealed'), 1000 + i * 100);
      });
    }, 600);
  }

  // ── 7. CURSOR SPOTLIGHT ───────────────────────────────────
  function initSpotlight() {
    const hero = document.getElementById('hero');
    const spotlight = document.getElementById('hero-spotlight');
    if (!hero || !spotlight) return;

    let active = false;
    hero.addEventListener('mouseenter', () => {
      if (!active) { active = true; spotlight.classList.add('active'); }
    });
    hero.addEventListener('mousemove', (e) => {
      const rect = hero.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      spotlight.style.background = `radial-gradient(600px circle at ${x}px ${y}px, rgba(255,30,40,0.22) 0%, rgba(230,3,6,0.08) 35%, transparent 65%)`;
    });
    hero.addEventListener('mouseleave', () => {
      spotlight.style.background = 'radial-gradient(600px circle at 50% 50%, rgba(255,30,40,0.10) 0%, transparent 70%)';
    });
  }

  // ── 8. HERO TEXT CHARACTER SCRAMBLE on hover ──────────────
  function initScramble() {
    const title = document.getElementById('hero-title-el');
    if (!title) return;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1%!';
    let scrambleInterval = null;

    title.addEventListener('mouseenter', () => {
      const spans = title.querySelectorAll('.red');
      spans.forEach(span => {
        let iterations = 0;
        const original = span.textContent;
        clearInterval(scrambleInterval);
        scrambleInterval = setInterval(() => {
          span.textContent = original.split('').map((char, i) => {
            if (i < iterations) return original[i];
            if (char === ' ') return ' ';
            return chars[Math.floor(Math.random() * chars.length)];
          }).join('');
          if (iterations >= original.length) {
            clearInterval(scrambleInterval);
            span.textContent = original;
          }
          iterations += 0.5;
        }, 40);
      });
    });
  }

  // ── 9. STAT COUNTER IN CARD ───────────────────────────────
  function initStatCounter() {
    // Animate the 500+ member count when card reveals
    setTimeout(() => {
      const el = document.getElementById('member-count');
      if (!el) return;
      const unit = el.querySelector('.unit');
      const unitText = unit ? unit.outerHTML : '';
      let start = null;
      const target = 500;
      const duration = 1800;

      function countStep(ts) {
        if (!start) start = ts;
        const progress = Math.min((ts - start) / duration, 1);
        const eased = ease(progress);
        el.innerHTML = Math.floor(eased * target) + unitText;
        if (progress < 1) requestAnimationFrame(countStep);
        else el.innerHTML = target + unitText;
      }
      requestAnimationFrame(countStep);
    }, 1100);
  }

  // ── ORCHESTRATE ───────────────────────────────────────────
  setupTitleReveal(); // must run before DOM paints

  function runHeroAnimations() {
    revealEyebrow();
    revealTitleLines();
    revealSub();
    revealActions();
    revealLine();
    revealCard();
    initStatCounter();
    initSpotlight();
    initScramble();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(runHeroAnimations, 50));
  } else {
    setTimeout(runHeroAnimations, 50);
  }
})();

// ─── WEBINAR COUNTDOWN ──────────────────────────────────────────
function updateCountdown() {
  const now = new Date();
  // Next session: next Thursday at 7pm ET
  const next = new Date(now);
  next.setHours(19, 0, 0, 0);
  const dayOfWeek = now.getDay();
  const daysUntilThursday = (4 - dayOfWeek + 7) % 7 || 7;
  next.setDate(now.getDate() + daysUntilThursday);
  const diff = next - now;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  document.getElementById('wc-d').textContent = String(d).padStart(2, '0');
  document.getElementById('wc-h').textContent = String(h).padStart(2, '0');
  document.getElementById('wc-m').textContent = String(m).padStart(2, '0');
}
updateCountdown();
setInterval(updateCountdown, 60000);

// ─── SPOTS COUNTER (simulated urgency) ──────────────────────────
const baseSpots = 47;
let currentSpots = baseSpots;
setInterval(() => {
  if (currentSpots > 28 && Math.random() < 0.15) {
    currentSpots--;
    const el = document.getElementById('spots-count');
    if (el) el.textContent = currentSpots;
  }
}, 8000);

// ─── NEWSLETTER ─────────────────────────────────────────────────
function submitNewsletter() {
  const email = document.getElementById('nl-email').value.trim();
  if (!email || !email.includes('@')) { alert('Please enter a valid email address.'); return; }
  // Integrate with your email marketing system (HighLevel, Mailchimp, etc.)
  alert('Welcome to the Nation! Check your inbox for a confirmation email.');
  document.getElementById('nl-email').value = '';
}

// ─── HERO PARTICLE EFFECT ────────────────────────────────────────
(function() {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.4;';
  document.getElementById('hero').appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w, h, particles = [];
  function resize() {
    w = canvas.width = canvas.offsetWidth;
    h = canvas.height = canvas.offsetHeight;
  }
  function Particle() {
    this.x = Math.random() * w;
    this.y = Math.random() * h;
    this.vx = (Math.random() - 0.5) * 0.3;
    this.vy = (Math.random() - 0.5) * 0.3;
    this.r = Math.random() * 1.5 + 0.5;
    this.alpha = Math.random() * 0.4 + 0.1;
    this.red = Math.random() < 0.2;
  }
  function init() {
    resize();
    particles = Array.from({length: 60}, () => new Particle());
  }
  function draw() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => {
      p.x = (p.x + p.vx + w) % w;
      p.y = (p.y + p.vy + h) % h;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.red ? `rgba(230,3,6,${p.alpha})` : `rgba(255,255,255,${p.alpha})`;
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  init();
  draw();
  window.addEventListener('resize', resize);
})();

// Bindings for former inline handlers (R7 — CSP: no inline JS).
document.querySelectorAll('[data-action]').forEach((el) => {
  el.addEventListener('click', () => {
    switch (el.getAttribute('data-action')) {
      case 'toggleMobileMenu': toggleMobileMenu(); break;
      case 'closeMobileMenu': closeMobileMenu(); break;
      case 'submitNewsletter': submitNewsletter(); break;
      case 'toggleFaq': toggleFaq(el); break;
    }
  });
});

