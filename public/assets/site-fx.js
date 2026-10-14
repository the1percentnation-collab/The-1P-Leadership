/* ============================================================
   THE ONE PERCENT NATION: shared behaviour for the public marketing pages
   (index, start, books, about). Loaded with `defer`.

   Everything here is the original homepage's effect stack, moved into one
   file so the four front-door pages behave identically:
     nav scroll state + mobile menu, newsletter form, hero cursor spotlight
     (and touch glow), hero particles, title reveal + scramble, magnetic
     buttons, 3D card tilt, scroll fade/stagger, red page sweep.

   Reveal animations only run when <html> carries .anim, which each page's
   head sets for motion-OK visitors and this file confirms by setting
   window.__1pFx. If this file never loads, the head script drops .anim after
   a few seconds so nothing is left hidden.
============================================================ */
(function () {
  'use strict';
  window.__1pFx = true;

  var docEl = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var animating = docEl.classList.contains('anim');

  /* ── Nav: solid once scrolled, mobile menu ─────────────────── */
  var nav = document.getElementById('nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    var burger = document.getElementById('burger');
    var setMenu = function (open) {
      nav.classList.toggle('menu-open', open);
      if (burger) {
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      }
    };
    if (burger) burger.addEventListener('click', function () { setMenu(!nav.classList.contains('menu-open')); });
    nav.querySelectorAll('.mobile-menu a').forEach(function (a) { a.addEventListener('click', function () { setMenu(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  }

  /* ── Newsletter → portal CRM (js/newsletter-lead.js) ───────── */
  var nlForm = document.getElementById('nl-form');
  if (nlForm) {
    var nlEmail = document.getElementById('nl-email');
    var nlMsg = document.getElementById('nl-msg');
    var nlBtn = nlForm.querySelector('button[type="submit"]');
    var say = function (text, kind) {
      nlMsg.textContent = text;
      nlMsg.classList.toggle('is-error', kind === 'error');
      nlMsg.classList.toggle('is-ok', kind === 'ok');
    };
    nlForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = nlEmail.value.trim();
      // Same test the server applies, so an address it will reject is caught
      // here instead of failing behind a success message.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        say('Enter a full email address, like name@company.com.', 'error');
        nlEmail.focus();
        return;
      }
      if (!window.__1pNewsletterLead) {
        say('Still loading. Give it a second and try again.', 'error');
        return;
      }
      nlBtn.disabled = true;
      say('Signing you up…');
      try {
        await window.__1pNewsletterLead({ email: email });
        say("You're on the list. Welcome to the Nation.", 'ok');
        nlEmail.value = '';
      } catch (err) {
        say((err && err.message) || 'We could not sign you up just now. Email the1percentnation@gmail.com and we will add you.', 'error');
      } finally {
        nlBtn.disabled = false;
      }
    });
  }

  /* ── Hero: cursor spotlight + touch glow ───────────────────── */
  var hero = document.querySelector('.hero');
  var spot = hero && hero.querySelector('.hero-spotlight');
  if (hero && spot) {
    var lastTouch = 0, tx = 0, ty = 0, raf = 0;
    // Phones fire emulated mouse events right after a tap; ignore them so they
    // don't re-light the glow the touch handlers just faded out.
    var fromTouch = function () { return Date.now() - lastTouch < 800; };
    hero.addEventListener('mouseenter', function () { if (!fromTouch()) spot.classList.add('active'); });
    hero.addEventListener('mousemove', function (e) {
      if (fromTouch()) return;
      var r = hero.getBoundingClientRect();
      spot.style.background = 'radial-gradient(600px circle at ' + (e.clientX - r.left) + 'px ' + (e.clientY - r.top) + 'px, rgba(255,30,40,0.22) 0%, rgba(230,3,6,0.08) 35%, transparent 65%)';
    });
    hero.addEventListener('mouseleave', function () {
      if (fromTouch()) return;
      spot.style.background = 'radial-gradient(600px circle at 50% 50%, rgba(255,30,40,0.10) 0%, transparent 70%)';
    });
    var paint = function () {
      raf = 0;
      spot.style.background = 'radial-gradient(260px circle at ' + tx + 'px ' + ty + 'px, rgba(255,30,40,0.28) 0%, rgba(230,3,6,0.10) 40%, transparent 70%)';
    };
    var track = function (e) {
      lastTouch = Date.now();
      var t = e.touches[0];
      if (!t) return false;
      var r = hero.getBoundingClientRect();
      tx = t.clientX - r.left; ty = t.clientY - r.top;
      return true;
    };
    hero.addEventListener('touchstart', function (e) { if (!track(e)) return; paint(); spot.classList.add('active', 'touching'); }, { passive: true });
    hero.addEventListener('touchmove', function (e) { if (track(e) && !raf) raf = requestAnimationFrame(paint); }, { passive: true });
    var release = function (e) {
      lastTouch = Date.now();
      if (e.touches && e.touches.length) return;
      spot.classList.remove('active', 'touching');
    };
    hero.addEventListener('touchend', release, { passive: true });
    hero.addEventListener('touchcancel', release, { passive: true });
  }

  /* ── Hero: drifting particles ──────────────────────────────── */
  if (hero && !reduce && hero.hasAttribute('data-particles')) {
    var canvas = document.createElement('canvas');
    canvas.className = 'hero-particles';
    canvas.setAttribute('aria-hidden', 'true');
    var bg = hero.querySelector('.hero-bg');
    if (bg) bg.after(canvas); else hero.prepend(canvas);
    var ctx = canvas.getContext('2d');
    var w = 0, h = 0, particles = [], running = true;
    var resize = function () { w = canvas.width = canvas.offsetWidth; h = canvas.height = canvas.offsetHeight; };
    var make = function () {
      return {
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.5 + 0.5, a: Math.random() * 0.4 + 0.1, red: Math.random() < 0.2
      };
    };
    resize();
    for (var i = 0; i < 60; i++) particles.push(make());
    var draw = function () {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      particles.forEach(function (p) {
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.red ? 'rgba(230,3,6,' + p.a + ')' : 'rgba(255,255,255,' + p.a + ')';
        ctx.fill();
      });
      requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener('resize', resize);
    // Stop drawing while the hero is off screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        var vis = entries[0].isIntersecting;
        if (vis && !running) { running = true; draw(); } else if (!vis) running = false;
      }).observe(hero);
    }
  }

  /* ── Hero title: letter scramble on hover ──────────────────── */
  var title = document.querySelector('.hero-title');
  if (title && !reduce) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1%!';
    var timer = null;
    title.addEventListener('mouseenter', function () {
      title.querySelectorAll('.red').forEach(function (span) {
        var target = span.querySelector('.word-inner') || span;
        var original = target.dataset.orig || (target.dataset.orig = target.textContent);
        var it = 0;
        clearInterval(timer);
        timer = setInterval(function () {
          target.textContent = original.split('').map(function (c, i) {
            if (i < it) return original[i];
            if (c === ' ') return ' ';
            return chars[Math.floor(Math.random() * chars.length)];
          }).join('');
          if (it >= original.length) { clearInterval(timer); target.textContent = original; }
          it += 0.5;
        }, 40);
      });
    });
  }

  /* ── Magnetic buttons ──────────────────────────────────────── */
  if (finePointer && !reduce) {
    document.querySelectorAll('.magnetic, .btn-cta-nav').forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
        var dy = (e.clientY - (r.top + r.height / 2)) * 0.22;
        btn.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(1.02)';
        btn.style.boxShadow = '0 8px 28px rgba(230,3,6,0.28)';
      });
      btn.addEventListener('mouseleave', function () { btn.style.transform = ''; btn.style.boxShadow = ''; });
      btn.addEventListener('mousedown', function () { btn.style.transform = 'scale(0.96)'; });
      btn.addEventListener('mouseup', function () { btn.style.transform = ''; });
    });
  }

  /* ── 3D card tilt (also re-run for catalog cards injected later) ── */
  function attachTilt(root) {
    if (!finePointer || reduce) return;
    (root || document).querySelectorAll('.tilt, .course-card').forEach(function (card) {
      if (card.dataset.tilt) return;
      card.dataset.tilt = '1';
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = 'perspective(900px) rotateX(' + (-y * 5) + 'deg) rotateY(' + (x * 5) + 'deg) scale(1.01)';
        card.style.transition = 'transform 0.1s ease-out, border-color .2s, box-shadow .3s';
      });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
        card.style.transition = 'transform 0.5s cubic-bezier(0.16,1,0.3,1), border-color .2s, box-shadow .3s';
      });
    });
  }
  attachTilt();
  window.__1pAttachTilt = attachTilt;

  /* ── Scroll fade-up + stagger ──────────────────────────────── */
  var fadeSel = '.fade-up, .stagger';
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -48px 0px' }) : null;
  function observeFades(root) {
    (root || document).querySelectorAll(fadeSel).forEach(function (el) {
      if (!io) { el.classList.add('visible'); return; }
      io.observe(el);
    });
  }
  observeFades();
  // js/home-courses.js injects course cards and books after load.
  window.__1pObserveFades = observeFades;

  /* ── Red page sweep: uncover on load, cover on internal links ── */
  var sweep = document.getElementById('page-sweep');
  if (sweep && animating) {
    var uncover = function () {
      sweep.style.transformOrigin = 'right';
      sweep.style.transition = 'transform 0.45s cubic-bezier(0.16,1,0.3,1)';
      requestAnimationFrame(function () { requestAnimationFrame(function () { sweep.classList.remove('cover'); }); });
    };
    uncover();
    // Back/forward cache restores the page mid-sweep; clear it.
    window.addEventListener('pageshow', function (e) { if (e.persisted) { sweep.style.transition = 'none'; sweep.classList.remove('cover'); } });
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target === '_blank' || a.hasAttribute('download')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(https?:|mailto:|tel:|sms:|javascript:)/i.test(href)) return;
      var url = new URL(href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.hash) return; // same-page anchor
      e.preventDefault();
      sweep.style.transformOrigin = 'left';
      sweep.style.transition = 'transform 0.35s cubic-bezier(0.76,0,0.24,1)';
      sweep.classList.add('cover');
      setTimeout(function () { location.href = url.href; }, 340);
    });
  } else if (sweep) {
    sweep.classList.remove('cover');
  }

  /* ── Hero cinematic sequence ───────────────────────────────── */
  if (!animating) return;
  if (title) {
    title.querySelectorAll('.line').forEach(function (line) {
      var nodes = Array.prototype.slice.call(line.childNodes);
      line.textContent = '';
      nodes.forEach(function (n) {
        var cls = n.nodeType === 1 ? n.className : '';
        (n.textContent || '').split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) { line.appendChild(document.createTextNode(' ')); return; }
          var wrap = document.createElement('span');
          wrap.className = 'word-wrap' + (cls ? ' ' + cls : '');
          var inner = document.createElement('span');
          inner.className = 'word-inner';
          inner.textContent = w;
          wrap.appendChild(inner);
          line.appendChild(wrap);
        });
      });
    });
    title.classList.add('split');
    var words = title.querySelectorAll('.word-inner');
    words.forEach(function (w, i) { setTimeout(function () { w.classList.add('in'); }, 250 + i * 90); });
    setTimeout(function () {
      title.querySelectorAll('.red, .outline').forEach(function (el) { el.classList.add('revealed'); });
    }, 650 + words.length * 90);
  }
  var eyebrow = document.querySelector('.hero-eyebrow');
  if (eyebrow) setTimeout(function () { eyebrow.classList.add('in'); }, 100);
  var line = document.querySelector('.hero-title-line');
  if (line) line.classList.add('revealed');
  document.querySelectorAll('.hero-reveal').forEach(function (el, i) { setTimeout(function () { el.classList.add('in'); }, 900 + i * 180); });
  // Desktop card beside the copy, and the phone copy under the headline.
  document.querySelectorAll('.hero-card').forEach(function (card) { card.classList.add('in'); });
})();
