  const form    = document.getElementById('bonus-form');
  const success = document.getElementById('form-success');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = document.getElementById('btn-text');

  function setInvalid(fieldId, errId, show) {
    const field = document.getElementById('field-' + fieldId);
    const err   = document.getElementById('err-' + errId);
    if (field) field.classList.toggle('invalid', show);
    if (err) err.style.display = show ? 'block' : 'none';
  }

  function validateEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const fname = document.getElementById('fname').value.trim();
    const lname = document.getElementById('lname').value.trim();
    const email = document.getElementById('email').value.trim();

    let valid = true;
    setInvalid('fname', 'fname', !fname); if (!fname) valid = false;
    setInvalid('lname', 'lname', !lname); if (!lname) valid = false;
    setInvalid('email', 'email', !validateEmail(email)); if (!validateEmail(email)) valid = false;

    if (!valid) return;

    submitBtn.disabled = true;
    btnText.textContent = 'Sending…';

    // In production: POST to your email provider (Mailchimp, ConvertKit, etc.)
    // For now, simulate a short delay and show the success state.
    await new Promise(r => setTimeout(r, 900));

    form.style.display = 'none';
    success.style.display = 'flex';

    // Store locally so returning visitors skip the form.
    try { localStorage.setItem('1p-book-bonus-submitted', '1'); } catch {}
  });

  // If already submitted this session, show success immediately.
  try {
    if (localStorage.getItem('1p-book-bonus-submitted')) {
      form.style.display = 'none';
      success.style.display = 'flex';
    }
  } catch {}

