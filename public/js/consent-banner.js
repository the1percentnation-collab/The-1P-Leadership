// consent-banner.js — lightweight cookie/analytics consent notice.
//
// Plain (non-module) script so it can be dropped onto any page with a single
// <script src="/js/consent-banner.js" defer></script> tag. Shows a one-time
// banner until the visitor accepts or declines, stores the choice in
// localStorage, and (when declined) sets Google Analytics consent to denied
// via the gtag consent API if gtag is present.
(function () {
  'use strict';
  var KEY = 'cookieConsent'; // 'accepted' | 'declined'

  // Meta (Facebook) pixel for ad measurement. Blank means off: paste the
  // Pixel ID from Meta Events Manager here to turn it on. It loads only for
  // visitors who accept cookies, never for anyone who declines or has not
  // chosen yet. The assessment pages send Lead, CompleteRegistration and a
  // custom PriorityLead event through it (js/assessment-page.js).
  var META_PIXEL_ID = '';

  function loadMetaPixel() {
    if (!META_PIXEL_ID || window.fbq) return;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function save(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* ignore */ }
  }

  // Apply GA consent state if the gtag consent API is available.
  function applyConsent(choice) {
    if (choice === 'accepted') loadMetaPixel();
    if (typeof window.gtag !== 'function') return;
    var granted = choice === 'accepted' ? 'granted' : 'denied';
    try {
      window.gtag('consent', 'update', {
        ad_storage: granted,
        analytics_storage: granted,
        ad_user_data: granted,
        ad_personalization: granted
      });
    } catch (e) { /* ignore */ }
  }

  function build() {
    var bar = document.createElement('div');
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.style.cssText = [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:99999',
      'max-width:720px', 'margin:0 auto', 'background:#111', 'color:#fff',
      'border:1px solid rgba(255,255,255,.15)', 'border-radius:14px',
      'box-shadow:0 18px 50px rgba(0,0,0,.5)', 'padding:16px 18px',
      'font-family:Outfit,system-ui,sans-serif', 'font-size:.95rem',
      'display:flex', 'flex-wrap:wrap', 'gap:12px', 'align-items:center',
      'justify-content:space-between'
    ].join(';');

    var text = document.createElement('div');
    text.style.cssText = 'flex:1 1 320px;line-height:1.5;';
    text.innerHTML = 'We use cookies for sign-in and to measure site usage. See our ' +
      '<a href="/privacy.html" style="color:#ff5a5c;">Privacy Policy</a>. ' +
      'You can accept analytics cookies or decline non-essential ones.';

    var btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:10px;flex:0 0 auto;';

    var decline = document.createElement('button');
    decline.type = 'button';
    decline.textContent = 'Decline';
    decline.style.cssText = 'padding:9px 16px;border-radius:9px;border:1px solid rgba(255,255,255,.35);background:transparent;color:#fff;cursor:pointer;font-weight:600;';

    var accept = document.createElement('button');
    accept.type = 'button';
    accept.textContent = 'Accept';
    accept.style.cssText = 'padding:9px 18px;border-radius:9px;border:none;background:#E60306;color:#fff;cursor:pointer;font-weight:700;';

    function close(choice) {
      save(choice);
      applyConsent(choice);
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    }
    accept.addEventListener('click', function () { close('accepted'); });
    decline.addEventListener('click', function () { close('declined'); });

    btns.appendChild(decline);
    btns.appendChild(accept);
    bar.appendChild(text);
    bar.appendChild(btns);
    return bar;
  }

  function init() {
    var choice = stored();
    if (choice === 'accepted' || choice === 'declined') {
      applyConsent(choice); // re-apply on each load
      return;
    }
    document.body.appendChild(build());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
