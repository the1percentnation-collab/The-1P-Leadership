import { onAuthReady } from './auth.js';
    import { db, functions, firebaseReady, firebaseConfig } from './firebase.js';
    import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
    import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

    const $ = (id) => document.getElementById(id);
    const msg = $('auth-msg');
    function showErr(txt) { msg.innerHTML = `<div class="auth-error">${txt}</div>`; }
    function clearMsg() { msg.innerHTML = ''; }

    function nextUrl() {
      const n = new URLSearchParams(location.search).get('next');
      return n && n.startsWith('/') ? n : '/dashboard';
    }

    if (!firebaseReady) showErr('Authentication service is unreachable. Check your connection and retry.');

    const user = await onAuthReady();
    if (!user) {
      location.replace('/login.html?next=' + encodeURIComponent('/onboarding.html'));
    } else {
      // Pre-fill name; skip onboarding entirely for staff or anyone already done.
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const d = snap.exists() ? snap.data() : {};
        if (d.role === 'owner' || d.role === 'admin' || d.onboardingComplete === true) {
          location.replace(nextUrl());
        }
        $('displayName').value = d.displayName || user.displayName || '';
        if (d.phone) $('phone').value = d.phone;
        if (d.address) $('address').value = d.address;
        if (d.company) $('company').value = d.company;
        if (d.industry) $('industry').value = d.industry;
        if (d.communityGoals) $('goals').value = d.communityGoals;
      } catch (e) {
        $('displayName').value = user.displayName || '';
      }
    }

    // ── Phone: auto-insert dashes as the member types ──────────────
    function formatPhone(raw) {
      const d = (raw || '').replace(/\D/g, '').slice(0, 15);
      if (d.length <= 3) return d;
      if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
      if (d.length <= 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
      // 11+ digits → treat the leading digits as a country code.
      const cc = d.slice(0, d.length - 10);
      const rest = d.slice(d.length - 10);
      return `+${cc} ${rest.slice(0, 3)}-${rest.slice(3, 6)}-${rest.slice(6)}`;
    }
    const phoneEl = $('phone');
    phoneEl.addEventListener('input', () => { phoneEl.value = formatPhone(phoneEl.value); });
    if (phoneEl.value) phoneEl.value = formatPhone(phoneEl.value);

    // ── Address: Google Places autocomplete (graceful fallback) ────
    // Uses the modern PlaceAutocompleteElement (Places API "New"), loaded via
    // the official bootstrap so importLibrary() resolves only when the places
    // library is truly ready (no race). If Maps/Places isn't enabled for the
    // key, the field stays a normal text input — nothing breaks.
    function bootstrapMaps(key) {
      if (window.google && window.google.maps && window.google.maps.importLibrary) return;
      ((g) => {
        let h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary",
            q = "__ib__", m = document, b = window;
        b = b[c] || (b[c] = {});
        const d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
          u = () => h || (h = new Promise(async (f, n) => {
            a = m.createElement("script");
            e.set("libraries", [...r] + "");
            for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
            e.set("callback", c + ".maps." + q);
            a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
            d[q] = f;
            a.onerror = () => h = n(Error(p + " could not load."));
            a.nonce = m.querySelector("script[nonce]")?.nonce || "";
            m.head.append(a);
          }));
        d[l] ? console.warn(p + " only loads once. Ignoring:", g)
             : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
      })({ key, v: "weekly" });
    }
    (async () => {
      const addressEl = $('address');
      try {
        bootstrapMaps(firebaseConfig.apiKey);
        // Resolves ONLY when the places library is actually ready — no race.
        const { PlaceAutocompleteElement } = await google.maps.importLibrary('places');

        // Modern web component, restricted to address-type predictions.
        const pac = new PlaceAutocompleteElement({
          includedPrimaryTypes: ['street_address', 'premise', 'subpremise', 'route']
        });
        pac.id = 'address-ac';
        pac.className = 'ob-address-ac';
        if (addressEl.placeholder) pac.placeholder = addressEl.placeholder;

        // Show the component; keep #address as a hidden mirror that the form
        // submit + pre-fill logic already read/write ($('address').value).
        addressEl.parentNode.insertBefore(pac, addressEl);
        addressEl.type = 'hidden';

        // Pre-fill on return: if #address already has a value (set above), show it.
        if (addressEl.value) pac.value = addressEl.value;

        // Selection: fetch the formatted address and mirror it into #address.
        pac.addEventListener('gmp-select', async ({ placePrediction }) => {
          try {
            const place = placePrediction.toPlace();
            await place.fetchFields({ fields: ['formattedAddress'] });
            const fa = place.formattedAddress || '';
            addressEl.value = fa;
            pac.value = fa;
          } catch (err) {
            console.warn('[onboarding] could not resolve selected place', err);
          }
        });

        // Don't let Enter (to pick a suggestion) submit the form.
        pac.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
      } catch (e) {
        // Graceful fallback: leave a normal typeable text input.
        if (addressEl.type === 'hidden') addressEl.type = 'text';
        console.warn('[onboarding] address autocomplete unavailable; using plain input', e);
      }
    })();

    $('onboarding-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      clearMsg();
      const payload = {
        displayName: $('displayName').value.trim(),
        phone: $('phone').value.trim(),
        address: $('address').value.trim(),
        company: $('company').value.trim(),
        industry: $('industry').value.trim(),
        goals: $('goals').value.trim(),
        marketingConsent: $('consent').checked,
        consentText: $('consent-text').textContent.replace(/\s+/g, ' ').trim()
      };
      if (!payload.displayName) return showErr('Please enter your name.');
      if (!payload.phone) return showErr('Please enter a phone number.');
      $('btn-submit').disabled = true;
      try {
        await httpsCallable(functions, 'submitOnboarding')(payload);
        location.replace(nextUrl());
      } catch (err) {
        showErr(err.message || 'Could not save your details. Please try again.');
        $('btn-submit').disabled = false;
      }
    });

