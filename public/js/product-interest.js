// The "Notify me" modal for a product that has not opened yet.
//
// Lifted out of upcoming.js so the homepage shop and the member Store use
// the same one instead of each growing a copy. It needs a `#modal-root`
// element on the page (the same slot the admin consoles use).

import { registerInterest, escapeHtml } from './products.js';

/**
 * Open the waitlist modal for `product` ({ id, title|name }). `onJoined` is
 * called after a successful signup, once the modal has closed — typically to
 * refresh the card's interest count.
 */
export function openInterestModal(product, { onJoined = null } = {}) {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const name = product.title || product.name || 'this';

  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card">
        <h1>Join the <span>list</span></h1>
        <div class="pre-modal-sub">Be the first to know when <b>${escapeHtml(name)}</b> launches.</div>
        <form id="int-form" class="crm-form">
          <div class="crm-form-row"><label>Name</label><input class="c-input" id="i-name" placeholder="Your name" /></div>
          <div class="crm-form-row"><label>Email *</label><input class="c-input" id="i-email" type="email" required placeholder="you@email.com" /></div>
          <div class="crm-form-row"><label>Phone (optional)</label><input class="c-input" id="i-phone" placeholder="+1 555…" /></div>
          <label class="pre-consent"><input type="checkbox" id="i-consent" /> Email/SMS me updates about this</label>
          <div id="i-err" class="auth-error" style="display:none;"></div>
          <div id="i-ok" class="auth-ok" style="display:none;"></div>
          <div class="crm-modal-actions">
            <button type="button" class="btn btn-ghost" id="i-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary" id="i-submit">Join list</button>
          </div>
        </form>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const close = () => { root.innerHTML = ''; };
  $('i-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });
  $('int-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('i-submit'); btn.disabled = true; btn.textContent = 'Joining…';
    $('i-err').style.display = 'none';
    try {
      const res = await registerInterest(product.id, {
        name: $('i-name').value.trim(), email: $('i-email').value.trim(),
        phone: $('i-phone').value.trim(), consent: $('i-consent').checked
      });
      $('i-ok').textContent = res.alreadyJoined ? "You're already on the list ✓" : "You're on the list! 🎉";
      $('i-ok').style.display = 'block';
      btn.textContent = 'Done';
      setTimeout(() => { close(); if (onJoined) onJoined(res); }, 1100);
    } catch (err) {
      $('i-err').textContent = err.message || String(err);
      $('i-err').style.display = 'block';
      btn.disabled = false; btn.textContent = 'Join list';
    }
  });
}
