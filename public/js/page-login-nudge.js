// Sign-up nudge tooltip on the login page. Standalone (non-module) so it runs
// even if Firebase/module imports fail. Externalized from an inline block (R7).
(function signupNudge() {
  function start() {
    var tip = document.getElementById('signup-tip');
    var link = document.getElementById('link-signup');
    var closeBtn = document.getElementById('signup-tip-close');
    if (!tip || !link) return;
    var dismissed = false;
    function hide() {
      dismissed = true;
      tip.classList.remove('show');
      link.classList.remove('signup-pulse');
    }
    // Appear after 3s and stay until the user closes it with the X.
    setTimeout(function () {
      if (dismissed) return;
      tip.classList.add('show');
      link.classList.add('signup-pulse');
    }, 3000);
    // X closes the box (and only the X) — no auto-dismiss.
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        hide();
      });
    }
    // Clicking the box itself heads to sign up.
    tip.addEventListener('click', function () { window.location.href = '/signup.html'; });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
