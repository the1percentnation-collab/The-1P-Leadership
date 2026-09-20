/**
 * Site-wide announcement bar + pre-registration modal.
 *
 * Plain (non-module) script so it can be dropped onto any page with a single
 * <script src="/js/announce-bar.js" defer></script> tag, exactly like
 * js/consent-banner.js. That matters here: the site has no shared header, no
 * server-side include and no build step, so every page gets its own tag, and
 * several pages (crm.html and friends) render their entire body from JS.
 *
 * It deliberately does NOT import js/firebase.js. Pulling the modular SDK onto
 * every marketing page to read one config document would cost more than the
 * feature. Config comes from the Firestore REST API and the pre-registration
 * submit is a plain POST to the callable endpoint, which accepts
 * {"data": {...}} and answers {"result": {...}}.
 *
 * z-index ladder on this site, so the choices below are legible:
 *   99999  cookie consent banner   (must stay reachable, so we sit below it)
 *   90001  this modal
 *   90000  this bar
 *    9999  chatbot widget
 *    2100  homepage modals
 *    1000  homepage #nav
 *     100  marketing page nav
 *      20  .academy-header
 */
(function () {
  'use strict';

  // ── Config ───────────────────────────────────────────────────────────────
  // Everything below is overridden by config/announcement in Firestore, so the
  // copy, the dates and the on/off switch all change without a deploy. This
  // object is what renders when Firestore is slow, blocked or unreachable.
  var FALLBACK = {
    enabled: true,
    version: 1,
    message: 'The 1P Certified Life Coach opens enrollment September 25.',
    // Phone width fits about half as much before the bar starts eating the
    // page. Same fact, fewer words.
    messageShort: 'Life Coach Certification opens September 25.',
    ctaText: 'Pre-register',
    ctaHref: '/clc',
    courseSlug: '1p-clc',
    courseTitle: '1P Certified Life Coach',
    opensAt: '2026-09-25T00:00:00-05:00',
    startAt: '2026-09-01T00:00:00-05:00',
    endAt: '2026-10-02T00:00:00-05:00',
    showDaysLeft: true,
    dismissible: true
  };

  var PROJECT_ID = 'the-1p-leadership';
  var API_KEY = 'AIzaSyCSZvsExv7O_yjE2UzJ4QQ7lsA4R9zG4_A';
  var FN_BASE = 'https://us-central1-' + PROJECT_ID + '.cloudfunctions.net';
  var CFG_URL = 'https://firestore.googleapis.com/v1/projects/' + PROJECT_ID +
    '/databases/(default)/documents/config/announcement?key=' + API_KEY;

  var DISMISS_KEY = '1pAnnounceDismissed';
  var CACHE_KEY = '1pAnnounceCfg';
  var CACHE_TTL_MS = 10 * 60 * 1000;

  // Internal consoles never show a marketing bar. The script tag should not be
  // on these pages at all; this is the belt to that suspenders.
  var INTERNAL_RE = /(^|\/)(crm|crm-[a-z]+|manage-[a-z]+|admin|owner|dialer|campaigns|sequences|tasks|conversations|opportunities|calendar|members|invite|onboarding|certification-admin|class-admin|chatbot-kb|bug-reports|contact|unsubscribe)(\.html)?$/i;

  var REDUCE = false;
  try {
    REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {}

  // ── Small helpers ────────────────────────────────────────────────────────
  function readStore(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) {}
  }
  function ms(value) {
    if (!value) return null;
    var t = Date.parse(value);
    return isNaN(t) ? null : t;
  }
  function el(tag, styles, text) {
    var node = document.createElement(tag);
    if (styles) node.style.cssText = styles;
    if (text != null) node.textContent = text;
    return node;
  }

  // ── Firestore REST ───────────────────────────────────────────────────────
  // One document, unwrapped by hand. Cached per session so moving around the
  // site is one request, not one per page.
  function unwrap(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) {
      var v = fields[k];
      if ('stringValue' in v) out[k] = v.stringValue;
      else if ('booleanValue' in v) out[k] = v.booleanValue;
      else if ('integerValue' in v) out[k] = Number(v.integerValue);
      else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
      else if ('timestampValue' in v) out[k] = v.timestampValue;
    });
    return out;
  }

  function cachedConfig() {
    try {
      var raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
      return parsed.cfg;
    } catch (e) { return null; }
  }

  function loadConfig() {
    var cached = cachedConfig();
    if (cached) return Promise.resolve(cached);
    if (typeof fetch !== 'function') return Promise.resolve(FALLBACK);

    var opts = {};
    var timer = null;
    try {
      var ctrl = new AbortController();
      opts.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, 2500);
    } catch (e) {}

    return fetch(CFG_URL, opts)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) {
        var merged = FALLBACK;
        if (doc && doc.fields) {
          merged = Object.assign({}, FALLBACK, unwrap(doc.fields));
        }
        try {
          window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({
            fetchedAt: Date.now(), cfg: merged
          }));
        } catch (e) {}
        return merged;
      })
      .catch(function () { return FALLBACK; })
      .then(function (cfg) { if (timer) clearTimeout(timer); return cfg; });
  }

  // ── Layout offset ────────────────────────────────────────────────────────
  // The site has three header systems with no shared offset token: a fixed
  // 68px marketing nav, the homepage's fixed nav at 88px (72px on mobile), and
  // a sticky .academy-header. Rather than edit all three, measure the bar and
  // push whatever is pinned to top:0 down by that amount at runtime.
  //
  // Pages that link styles.css get `body { display:flex; height:100vh;
  // overflow:hidden }`, a locked viewport. Adding padding there does nothing
  // useful and shrinking it wrongly breaks the shell, so that case gets its
  // own branch.
  var offset = {
    applied: false,
    height: 0,
    basePadding: 0,
    bodyPaddingTop: '',
    bodyMarginTop: '',
    bodyHeight: '',
    shifted: []
  };

  var HEADER_SEL = '#nav, body > nav, header > nav, .academy-header, .site-nav, #nav-menu, .mobile-menu';

  function isLockedShell() {
    try {
      var bs = window.getComputedStyle(document.body);
      return bs.overflow === 'hidden' && bs.display === 'flex';
    } catch (e) { return false; }
  }

  function applyOffset(bar) {
    var h = bar.offsetHeight;
    if (!h) return;
    offset.height = h;
    document.documentElement.style.setProperty('--announce-h', h + 'px');
    // In-page anchors (clc.html links to #pricing) would otherwise land under
    // the bar.
    document.documentElement.style.scrollPaddingTop = h + 'px';

    if (!offset.applied) {
      offset.bodyPaddingTop = document.body.style.paddingTop;
      offset.bodyMarginTop = document.body.style.marginTop;
      offset.bodyHeight = document.body.style.height;
    }

    if (isLockedShell()) {
      // The shell is a fixed-height flex column. Shrink it and push it down;
      // the sticky header inside rides along on its own.
      document.body.style.marginTop = h + 'px';
      document.body.style.height = 'calc(100vh - ' + h + 'px)';
    } else {
      var base = 0;
      try {
        base = parseFloat(window.getComputedStyle(document.body).paddingTop) || 0;
      } catch (e) {}
      if (!offset.applied) offset.basePadding = base;
      document.body.style.paddingTop = ((offset.basePadding || 0) + h) + 'px';

      // Only move things that are actually pinned to the top. A blanket sweep
      // over position:fixed would catch the chatbot and every modal.
      if (!offset.applied) {
        var nodes = document.querySelectorAll(HEADER_SEL);
        for (var i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          var cs;
          try { cs = window.getComputedStyle(node); } catch (e) { continue; }
          if ((cs.position === 'fixed' || cs.position === 'sticky') && (parseFloat(cs.top) || 0) === 0) {
            offset.shifted.push({ node: node, top: node.style.top });
          }
        }
      }
      offset.shifted.forEach(function (entry) { entry.node.style.top = h + 'px'; });
    }
    offset.applied = true;
  }

  function clearOffset() {
    if (!offset.applied) return;
    document.documentElement.style.removeProperty('--announce-h');
    document.documentElement.style.scrollPaddingTop = '';
    document.body.style.paddingTop = offset.bodyPaddingTop;
    document.body.style.marginTop = offset.bodyMarginTop;
    document.body.style.height = offset.bodyHeight;
    offset.shifted.forEach(function (entry) { entry.node.style.top = entry.top; });
    offset.shifted = [];
    offset.applied = false;
  }

  // ── Copy ─────────────────────────────────────────────────────────────────
  // A static day count, computed once. No ticking clock: it is motion on 57
  // pages and it manufactures urgency on a free waitlist.
  function daysLeftLabel(cfg) {
    if (!cfg.showDaysLeft) return '';
    var opens = ms(cfg.opensAt);
    if (!opens) return '';
    var days = Math.ceil((opens - Date.now()) / 86400000);
    if (days > 30 || days < 0) return '';
    if (days === 0) return 'Today.';
    if (days === 1) return 'Tomorrow.';
    return days + ' days.';
  }

  // ── The bar ──────────────────────────────────────────────────────────────
  function isNarrow() {
    return (window.innerWidth || document.documentElement.clientWidth || 0) < 560;
  }

  function buildBar(cfg, onCta) {
    var narrow = isNarrow();
    var bar = el('div',
      'position:fixed;top:0;left:0;right:0;z-index:90000;' +
      'background:#080808;border-bottom:1px solid rgba(230,3,6,0.55);' +
      // The right gutter is reserved for the dismiss control so content never
      // runs underneath it.
      'padding:' + (narrow ? '9px 46px 9px 14px' : '11px 46px 11px 16px') + ';' +
      'padding-top:calc(' + (narrow ? '9px' : '11px') + ' + env(safe-area-inset-top, 0px));' +
      'font-family:Outfit,system-ui,-apple-system,sans-serif;color:#fff;' +
      'display:flex;align-items:center;justify-content:center;' +
      'gap:' + (narrow ? '10px' : '14px') + ';flex-wrap:wrap;' +
      'box-shadow:0 1px 12px rgba(0,0,0,0.5);');
    bar.className = 'announce-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Site announcement');

    var text = el('span',
      'font-size:' + (narrow ? '13px' : '14px') + ';line-height:1.35;text-align:center;',
      (narrow && cfg.messageShort) ? cfg.messageShort : cfg.message);
    bar.appendChild(text);

    // The day count is a nicety. On a phone the bar's height is the scarce
    // resource, so it goes.
    var days = narrow ? '' : daysLeftLabel(cfg);
    if (days) {
      bar.appendChild(el('span',
        'font-size:13px;color:#A0A0A0;letter-spacing:0.02em;', days));
    }

    var cta = el('button',
      'background:#E60306;color:#fff;border:0;border-radius:999px;' +
      'padding:' + (narrow ? '7px 16px' : '8px 18px') + ';min-height:' + (narrow ? '34px' : '40px') + ';' +
      'font:inherit;font-size:13px;font-weight:600;' +
      'cursor:pointer;white-space:nowrap;', cfg.ctaText);
    cta.type = 'button';
    cta.addEventListener('mouseenter', function () { cta.style.background = '#B30205'; });
    cta.addEventListener('mouseleave', function () { cta.style.background = '#E60306'; });
    cta.addEventListener('click', function () { onCta(cta); });
    bar.appendChild(cta);

    if (cfg.dismissible !== false) {
      var close = el('button',
        'position:absolute;right:8px;top:50%;transform:translateY(-50%);' +
        'width:36px;height:36px;border-radius:8px;background:transparent;' +
        'border:0;color:#A0A0A0;font-size:20px;line-height:1;cursor:pointer;', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Dismiss announcement');
      close.addEventListener('click', function () {
        writeStore(DISMISS_KEY, String(cfg.version));
        dismiss(bar);
      });
      bar.appendChild(close);
    }
    return bar;
  }

  function dismiss(bar) {
    clearOffset();
    if (REDUCE) {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
      return;
    }
    bar.style.transition = 'opacity 150ms linear';
    bar.style.opacity = '0';
    setTimeout(function () {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    }, 160);
  }

  // ── Pre-registration modal ───────────────────────────────────────────────
  var CONSENT_TEXT = 'Yes, email me when enrollment opens, plus occasional ' +
    'updates from The One Percent Nation. If I give a phone number I agree to ' +
    'calls and texts about this program. Message and data rates may apply. ' +
    'Reply STOP to opt out at any time.';

  function openModal(cfg, invoker) {
    var overlay = el('div',
      'position:fixed;inset:0;z-index:90001;display:flex;align-items:center;' +
      'justify-content:center;padding:20px;' +
      'font-family:Outfit,system-ui,-apple-system,sans-serif;');
    overlay.className = 'prereg-overlay';

    var backdrop = el('div',
      'position:absolute;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(6px);');
    overlay.appendChild(backdrop);

    var panel = el('div',
      'position:relative;width:100%;max-width:460px;max-height:calc(100vh - 40px);' +
      'overflow-y:auto;background:#0F0F0F;border:1px solid rgba(255,255,255,0.08);' +
      'border-top:3px solid #E60306;border-radius:14px;padding:30px 26px 26px;color:#fff;');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'prereg-title');
    overlay.appendChild(panel);

    var close = el('button',
      'position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:6px;' +
      'background:transparent;border:1px solid rgba(255,255,255,0.08);color:#A0A0A0;' +
      'font-size:21px;line-height:1;cursor:pointer;', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    panel.appendChild(close);

    var heading = el('h2',
      'font-family:"Bebas Neue",Impact,sans-serif;font-size:32px;letter-spacing:0.03em;' +
      'line-height:1;margin:0 0 8px;', 'PRE-REGISTER');
    heading.id = 'prereg-title';
    panel.appendChild(heading);

    panel.appendChild(el('p',
      'font-size:14px;color:#A0A0A0;line-height:1.55;margin:0 0 20px;',
      'No payment and no commitment. We will email you the moment enrollment ' +
      'for the ' + cfg.courseTitle + ' opens.'));

    var form = document.createElement('form');
    form.style.cssText = 'display:grid;gap:13px;';
    form.noValidate = true;

    function field(id, label, type, required, hint) {
      var wrap = el('label', 'display:block;font-size:12px;color:#A0A0A0;');
      wrap.htmlFor = id;
      wrap.appendChild(document.createTextNode(label + (hint ? ' ' + hint : '')));
      var input = document.createElement('input');
      input.id = id;
      input.name = id;
      input.type = type;
      if (required) input.required = true;
      input.style.cssText =
        'display:block;width:100%;margin-top:5px;background:#080808;' +
        'border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;' +
        'padding:11px 12px;font:inherit;font-size:14px;box-sizing:border-box;';
      wrap.appendChild(input);
      form.appendChild(wrap);
      return input;
    }

    var nameIn = field('prereg-name', 'Name', 'text', true);
    var emailIn = field('prereg-email', 'Email', 'email', true);
    var phoneIn = field('prereg-phone', 'Phone', 'tel', false, '(optional)');

    var consentWrap = el('label',
      'display:flex;gap:10px;align-items:flex-start;font-size:12px;color:#A0A0A0;line-height:1.5;');
    var consent = document.createElement('input');
    consent.type = 'checkbox';
    consent.id = 'prereg-consent';
    consent.style.cssText = 'margin-top:3px;flex-shrink:0;';
    consentWrap.htmlFor = 'prereg-consent';
    consentWrap.appendChild(consent);
    consentWrap.appendChild(el('span', '', CONSENT_TEXT));
    form.appendChild(consentWrap);

    var submit = el('button',
      'background:#E60306;color:#fff;border:0;border-radius:8px;padding:12px 20px;' +
      'font:inherit;font-size:14px;font-weight:600;cursor:pointer;margin-top:4px;',
      'Put me on the list');
    submit.type = 'submit';
    form.appendChild(submit);

    var status = el('p', 'margin:0;font-size:13px;color:#A0A0A0;min-height:18px;');
    status.setAttribute('aria-live', 'polite');
    form.appendChild(status);

    panel.appendChild(form);

    // Prefill from a cached profile when one is around. Never block on auth.
    try {
      var cachedUser = window.__1pUser || null;
      if (cachedUser) {
        if (cachedUser.displayName) nameIn.value = cachedUser.displayName;
        if (cachedUser.email) emailIn.value = cachedUser.email;
      }
    } catch (e) {}

    // ── Focus management ───────────────────────────────────────────────────
    var lastFocus = invoker || document.activeElement;
    var prevOverflow = document.body.style.overflow;
    var lockedShell = isLockedShell();
    if (!lockedShell) document.body.style.overflow = 'hidden';

    function focusables() {
      return panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); shut(); return; }
      if (ev.key !== 'Tab') return;
      var list = focusables();
      if (!list.length) return;
      var first = list[0];
      var last = list[list.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault(); last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault(); first.focus();
      }
    }
    function shut() {
      document.removeEventListener('keydown', onKey, true);
      if (!lockedShell) document.body.style.overflow = prevOverflow;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }
    document.addEventListener('keydown', onKey, true);
    close.addEventListener('click', shut);
    backdrop.addEventListener('click', shut);

    // ── Submit ─────────────────────────────────────────────────────────────
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var name = nameIn.value.trim();
      var email = emailIn.value.trim();
      if (!name) { status.textContent = 'Please enter your name.'; nameIn.focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        status.textContent = 'Please enter a valid email.'; emailIn.focus(); return;
      }
      submit.disabled = true;
      submit.style.opacity = '0.6';
      status.textContent = 'Saving…';

      fetch(FN_BASE + '/registerCoursePreregistration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            slug: cfg.courseSlug,
            name: name,
            email: email,
            phone: phoneIn.value.trim() || null,
            consent: !!consent.checked,
            consentText: consent.checked ? CONSENT_TEXT : null
          }
        })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok || (res.body && res.body.error)) {
            var msg = (res.body && res.body.error && res.body.error.message) ||
              'Something went wrong. Please try again.';
            throw new Error(msg);
          }
          var result = (res.body && res.body.result) || {};
          form.remove();
          heading.textContent = result.alreadyJoined ? 'ALREADY ON THE LIST' : 'YOU ARE ON THE LIST';
          panel.appendChild(el('p',
            'font-size:15px;color:#fff;line-height:1.6;margin:0 0 6px;',
            result.alreadyJoined
              ? 'You pre-registered already, so you are set. Nothing else to do.'
              : 'Check your email for a confirmation. We will write the moment enrollment opens.'));
          close.focus();
        })
        .catch(function (err) {
          submit.disabled = false;
          submit.style.opacity = '1';
          status.textContent = (err && err.message) || 'Something went wrong. Please try again.';
        });
    });

    document.body.appendChild(overlay);
    nameIn.focus();
  }

  // ── Print rule ───────────────────────────────────────────────────────────
  function injectPrintStyle() {
    if (document.getElementById('announce-bar-print')) return;
    var style = document.createElement('style');
    style.id = 'announce-bar-print';
    style.textContent = '@media print{.announce-bar,.prereg-overlay{display:none !important}}';
    document.head.appendChild(style);
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function start() {
    if (document.body.dataset.noAnnounce === '1') return;
    if (INTERNAL_RE.test(window.location.pathname)) return;

    loadConfig().then(function (cfg) {
      if (!cfg || !cfg.enabled) return;

      var now = Date.now();
      var from = ms(cfg.startAt);
      var to = ms(cfg.endAt);
      if (from && now < from) return;
      if (to && now > to) return;

      if (cfg.dismissible !== false && readStore(DISMISS_KEY) === String(cfg.version)) return;

      injectPrintStyle();

      // The modal is the point. If anything about it fails, the CTA still has
      // to take them somewhere useful.
      function onCtaClick(invoker) {
        try { openModal(cfg, invoker); }
        catch (e) { window.location.assign(cfg.ctaHref || '/clc'); }
      }

      var bar = buildBar(cfg, onCtaClick);
      document.body.appendChild(bar);
      applyOffset(bar);

      // The message wraps to two lines on narrow viewports, and the homepage
      // nav changes height at its breakpoint, so the offset has to be redone.
      var timer = null;
      var wasNarrow = isNarrow();
      window.addEventListener('resize', function () {
        if (!bar.parentNode) return;
        clearTimeout(timer);
        timer = setTimeout(function () {
          if (!bar.parentNode) return;
          // Crossing the breakpoint changes the copy and the type scale, so
          // the bar is rebuilt rather than just re-measured.
          if (isNarrow() !== wasNarrow) {
            wasNarrow = isNarrow();
            var next = buildBar(cfg, onCtaClick);
            bar.parentNode.replaceChild(next, bar);
            bar = next;
          }
          applyOffset(bar);
        }, 150);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Public handle, so the CLC sales page's own CTAs open this same form rather
  // than shipping a second copy of it. Callers may pass overrides; anything
  // they leave out falls back to the campaign config.
  window.OnePPreReg = {
    open: function (opts) {
      var invoker = (opts && opts.invoker) || document.activeElement;
      return loadConfig().then(function (cfg) {
        openModal(Object.assign({}, cfg || FALLBACK, opts || {}), invoker);
      }).catch(function () {
        openModal(Object.assign({}, FALLBACK, opts || {}), invoker);
      });
    }
  };
})();
