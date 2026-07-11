/**
 * extract-1pclc.js — ONE-TIME browser-console extraction of the legacy 1P-CLC
 * course content out of public/js/modules.js.
 *
 * WHY: the 1P-CLC lessons are render() functions coupled to per-user runtime
 * state (store.isComplete, getNotes) rather than static HTML, so they can't be
 * moved with a file transform. This script renders each module in the browser,
 * strips the per-user chrome (completion banners + notes textareas), and emits
 * clean per-module HTML you can feed to migrate-1pclc.js.
 *
 * HOW TO RUN:
 *   1. Sign in as an admin/owner account THAT HAS NO 1P-CLC progress or notes
 *      (so no completion banners or saved note text leak into the output).
 *   2. Open the 1P-CLC course page in the browser.
 *   3. Open DevTools > Console, paste this whole file, press Enter.
 *   4. It downloads `1pclc-content.json`. Review it, then run migrate-1pclc.js.
 *
 * This script only READS and downloads a file — it writes nothing to Firebase.
 */
(async () => {
  // Adjust the path if the site is served from a sub-path.
  const mod = await import('/js/modules.js');
  const MODULES = mod.MODULES || [];
  if (!MODULES.length) {
    console.error('[extract] MODULES not found — are you on the 1P-CLC site?');
    return;
  }

  // Parse each rendered module into a detached DOM and strip per-user chrome.
  function clean(html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    // Remove completion banners (only present when the runner marked complete).
    wrap.querySelectorAll('.completion-banner').forEach((n) => n.remove());
    // Notes textareas are per-user workbook inputs; the generic player handles
    // notes separately, so drop them here (review whether any should become
    // static workbook prompts in the new course).
    wrap.querySelectorAll('textarea.notes-area').forEach((n) => n.remove());
    return wrap.innerHTML.trim();
  }

  const out = MODULES.map((m) => ({
    id: m.id,
    title: m.title || `Module ${m.id}`,
    subtitle: m.subtitle || '',
    pillar: m.pillar || '',
    duration: m.duration || '',
    tagLabel: m.tagLabel || '',
    sortOrder: m.id,
    published: true,
    html: (() => {
      try { return clean(m.render()); }
      catch (e) { console.warn('[extract] render failed for module', m.id, e); return ''; }
    })()
  }));

  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '1pclc-content.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  console.log('[extract] wrote 1pclc-content.json with', out.length, 'modules — REVIEW IT before migrating.');
})();
