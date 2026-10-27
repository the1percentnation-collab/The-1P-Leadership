// Admin: Library — upload, proof and publish the digital books, and attach
// them to courses. Admin/owner only; the rules enforce that independently.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import { escapeHtml } from './products.js';
import {
  ID_RE, slugify, validateEpub, validateCover, uploadEpub, uploadCover,
  listBooks, saveBook, listCourseGrants, setCourseGrants, syncBookGrants,
  validateAudio, sortAudioFiles, titleFromFileName, probeDuration, uploadAudioTrack,
  loadArc, saveArcConfig, markArcReviewed
} from './library-admin.js';

const $ = (id) => document.getElementById(id);
const state = { books: [], courses: [] };

function gate(msg) {
  $('gate-msg').innerHTML = `<div class="card"><div class="auth-error">${escapeHtml(msg)}</div></div>`;
}

function fmtVersion(v) {
  const n = Number(v);
  if (!n || n < 1e12) return v ? `v${escapeHtml(v)}` : '—';
  return new Date(n).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function grantedBy(bookId) {
  return state.courses.filter((c) => c.grantsBooks.includes(bookId));
}

function render() {
  const host = $('book-list');
  if (!state.books.length) {
    host.innerHTML = `<div class="card"><div class="crm-subpanel-empty">
      No books yet. Click “+ Add book”, drop in the EPUB, and it will be readable in the Academy in about a minute.
    </div></div>`;
    return;
  }
  host.innerHTML = `<div class="card crm-list-card"><table class="data-table crm-list-table">
    <thead><tr><th></th><th>Book</th><th>State</th><th>Edition</th><th>Attached to</th><th></th></tr></thead>
    <tbody>
    ${state.books.map((b) => {
      const courses = grantedBy(b.id);
      const live = b.status !== 'hidden';
      return `<tr>
        <td style="width:44px;">${b.coverUrl
          ? `<img src="${escapeHtml(b.coverUrl)}" alt="" style="width:36px;aspect-ratio:2/3;object-fit:cover;border-radius:3px;display:block;">`
          : '<div style="width:36px;aspect-ratio:2/3;border-radius:3px;background:var(--surface2);"></div>'}</td>
        <td><div style="font-weight:600;">${escapeHtml(b.title || b.id)}</div>
            <div style="font-size:12px;color:var(--gray-light);">${b.format === 'audio' ? `Audiobook · ${(b.tracks || []).length} chapters · ` : ''}${escapeHtml(b.author || '')} · <code>${escapeHtml(b.id)}</code></div></td>
        <td><span style="color:${live ? '#56D4A8' : '#E8C547'};font-weight:600;">${live ? 'live' : 'hidden (proofing)'}</span>${b.openAccess
          ? `<div style="font-size:12px;color:var(--gray-light);">open access · <a href="#" data-copy="${escapeHtml(b.id)}">copy link</a></div>` : ''}</td>
        <td>${fmtVersion(b.version)}</td>
        <td style="font-size:12px;">${courses.length
          ? courses.map((c) => escapeHtml(c.title)).join(', ')
          : '<span style="color:var(--gray-light);">nothing yet</span>'}</td>
        <td style="white-space:nowrap;text-align:right;">
          <a class="btn btn-ghost" href="/${b.format === 'audio' ? 'listen' : 'read'}?book=${encodeURIComponent(b.id)}" target="_blank">${b.format === 'audio' ? 'Open player' : 'Open in reader'} ↗</a>
          <button class="btn btn-ghost" data-edit="${escapeHtml(b.id)}">Edit</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
  host.querySelectorAll('[data-copy]').forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    // The chapter one preview has a short link (firebase.json redirects).
    const url = a.dataset.copy === 'i-cant-preview'
      ? `${location.origin}/icantpreview`
      : `${location.origin}/read?book=${encodeURIComponent(a.dataset.copy)}`;
    try { await navigator.clipboard.writeText(url); a.textContent = 'copied ✓'; }
    catch (_) { window.prompt('Copy this link', url); }
  }));
  host.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    openModal(state.books.find((b) => b.id === btn.dataset.edit));
  }));
}

function openModal(book) {
  const editing = !!book;
  const b = book || {};
  const root = $('modal-root');
  const attached = new Set(grantedBy(b.id || '').map((c) => c.slug));

  root.innerHTML = `
    <div class="crm-modal-backdrop" id="modal-bd">
      <div class="crm-modal auth-card" style="max-width:640px;">
        <h1>${editing ? 'Edit' : 'Add'} <span>Book</span></h1>
        <form id="b-form" class="crm-form">
          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Title *</label><input class="c-input" id="b-title" required value="${escapeHtml(b.title || '')}" placeholder="I Can't: Is Not A Strategy" /></div>
            <div class="crm-form-row"><label>Author</label><input class="c-input" id="b-author" value="${escapeHtml(b.author || '')}" placeholder="Anthony Brown Sr." /></div>
          </div>
          <div class="crm-form-row-grid">
            <div class="crm-form-row"><label>Book id ${editing ? '(fixed)' : '(used in links, lowercase)'}</label>
              <input class="c-input" id="b-id" value="${escapeHtml(b.id || '')}" placeholder="i-cant" ${editing ? 'readonly' : ''} pattern="[a-z0-9][a-z0-9\\-]{1,60}" /></div>
            <div class="crm-form-row"><label>Visibility</label>
              <select class="c-input crm-select" id="b-status">
                <option value="hidden" ${b.status === 'hidden' ? 'selected' : ''}>Hidden: only you and admins can open it (proofing)</option>
                <option value="live" ${b.status !== 'hidden' ? 'selected' : ''}>Live: members who own it can read it</option>
              </select></div>
          </div>

          <div class="crm-form-row">
            <label>Format</label>
            <select class="c-input crm-select" id="b-format" ${editing ? 'disabled' : ''}>
              <option value="epub" ${b.format !== 'audio' ? 'selected' : ''}>Ebook: one EPUB file, read in the reader</option>
              <option value="audio" ${b.format === 'audio' ? 'selected' : ''}>Audiobook: MP3 or M4A chapter files, played in the listener</option>
            </select>
          </div>

          <div id="b-audio-section" hidden>
            <div class="crm-form-row">
              <label>Description (shown on the audiobook's sales page)</label>
              <textarea class="c-input" id="b-desc" rows="4" placeholder="What the listener walks away with.">${escapeHtml(b.description || '')}</textarea>
            </div>
            <div class="crm-form-row">
              <label>Chapter files ${editing ? '(leave empty to keep the current chapters)' : '*'}</label>
              <div style="border:1px dashed var(--border);border-radius:10px;padding:14px;" id="b-audio-drop">
                <div class="p-img-controls">
                  <label class="btn btn-ghost p-img-btn">Choose chapters<input type="file" id="b-audio" accept=".mp3,.m4a,.m4b,.aac,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac" multiple hidden></label>
                  <span id="b-audio-name" class="crm-save-status">${editing && (b.tracks || []).length ? `${b.tracks.length} chapters uploaded` : 'select every chapter at once, or drag them here'}</span>
                </div>
                <div class="progress-bar" id="b-audio-bar" style="margin-top:10px;display:none;"><div class="progress-fill" id="b-audio-fill" style="width:0%"></div></div>
              </div>
              <div class="pre-modal-sub">One file per chapter, named so they sort in order (01 Intro.mp3, 02 Chapter One.mp3 …). The names become chapter titles; edit them below. Picking new files replaces every chapter.</div>
            </div>
            <div class="crm-form-row">
              <label>Chapters</label>
              <div id="b-tracks" style="display:grid;gap:6px;"></div>
            </div>
            <div class="crm-form-row">
              <label>Free sample chapter</label>
              <select class="c-input crm-select" id="b-sample"></select>
              <div class="pre-modal-sub">Anyone can play this one chapter on the sales page, no account needed. It is the best salesperson the book has.</div>
            </div>
          </div>

          <div class="crm-form-row" id="b-open-row">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-family:var(--font-body);font-size:13px;letter-spacing:0;text-transform:none;color:var(--white);">
              <input type="checkbox" id="b-open" ${b.openAccess ? 'checked' : ''}>
              <span>Open access: a free sample anyone with the link can read, no account needed</span>
            </label>
            <div class="pre-modal-sub">For a preview like chapter one, never the full book. Only works while the book is Live. Share it as <code>/read?book=${escapeHtml(b.id || 'your-book-id')}</code>.</div>
          </div>

          <div class="crm-form-row" id="b-buy-row">
            <label>Buy link</label>
            <input class="c-input" id="b-buy" value="${escapeHtml(b.buyHref || '')}" placeholder="/books for a preview, /bundle.html for a course book" />
            <div class="pre-modal-sub">Where “Get the book” leads. A preview shows it on every page. Leave empty for the default.</div>
          </div>

          <div class="crm-form-row" id="b-epub-row">
            <label>EPUB file ${editing ? '(leave empty to keep the current edition)' : '*'}</label>
            <div class="p-img-uploader" id="b-drop" style="border:1px dashed var(--border);border-radius:10px;padding:14px;">
              <div class="p-img-controls">
                <label class="btn btn-ghost p-img-btn">Choose EPUB<input type="file" id="b-epub" accept=".epub,application/epub+zip" hidden></label>
                <span id="b-epub-name" class="crm-save-status">${editing ? `Current edition: ${fmtVersion(b.version)}` : 'or drag the file here'}</span>
              </div>
              <div class="progress-bar" id="b-epub-bar" style="margin-top:10px;display:none;"><div class="progress-fill" id="b-epub-fill" style="width:0%"></div></div>
            </div>
            <div class="pre-modal-sub">Export the finished manuscript as EPUB (Vellum, Atticus, Kindle Create, Draft2Digital or Calibre). PDF and Word files will not work in the reader. Uploading a new EPUB later publishes a new edition to everyone; their page and bookmarks are kept.</div>
          </div>

          <div class="crm-form-row">
            <label>Cover</label>
            <div class="p-img-uploader">
              <div class="p-img-preview" id="b-cover-preview" style="aspect-ratio:2/3;width:80px;">${b.coverUrl ? `<img src="${escapeHtml(b.coverUrl)}" alt="">` : '<span>No cover</span>'}</div>
              <div class="p-img-controls">
                <label class="btn btn-ghost p-img-btn">Choose cover<input type="file" id="b-cover" accept="image/jpeg,image/png,image/webp" hidden></label>
                <span id="b-cover-name" class="crm-save-status"></span>
              </div>
            </div>
          </div>

          <div class="crm-form-row">
            <label>Attached to courses</label>
            <div id="b-courses" style="display:grid;gap:6px;max-height:180px;overflow:auto;padding:6px 0;">
              ${state.courses.length ? state.courses.map((c) => `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-family:var(--font-body);font-size:13px;letter-spacing:0;text-transform:none;color:var(--white);">
                  <input type="checkbox" data-slug="${escapeHtml(c.slug)}" ${attached.has(c.slug) ? 'checked' : ''}>
                  <span>${escapeHtml(c.title)} <code style="color:var(--gray-light);font-size:11px;">${escapeHtml(c.slug)}</code>${c.status && c.status !== 'live' ? ` <span style="color:var(--gray-light);font-size:11px;">· ${escapeHtml(c.status)}</span>` : ''}</span>
                </label>`).join('') : '<span class="crm-save-status">No course records yet. Publish a course from Manage Courses first.</span>'}
            </div>
            <div class="pre-modal-sub">Anyone who buys or is granted a checked course gets this book automatically. Members already enrolled: use “Grant to enrolled members” after saving.</div>
          </div>

          <div id="b-err" class="auth-error" style="display:none;"></div>
          <div class="crm-modal-actions">
            ${editing ? `<button type="button" class="btn btn-ghost" id="b-sync" style="margin-right:auto;">Grant to enrolled members</button>` : ''}
            <button type="button" class="btn btn-ghost" id="b-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary" id="b-save">${editing ? 'Save' : 'Upload & save'}</button>
          </div>
        </form>
      </div>
    </div>`;

  const close = () => { root.innerHTML = ''; };
  const err = (m) => { $('b-err').textContent = m; $('b-err').style.display = m ? '' : 'none'; };
  $('b-cancel').addEventListener('click', close);
  $('modal-bd').addEventListener('click', (e) => { if (e.target.id === 'modal-bd') close(); });

  if (!editing) {
    $('b-title').addEventListener('input', () => {
      if (!$('b-id').dataset.touched) $('b-id').value = slugify($('b-title').value);
    });
    $('b-id').addEventListener('input', () => { $('b-id').dataset.touched = '1'; });
  }

  let epubFile = null;
  let coverFile = null;
  const takeEpub = async (f) => {
    const problem = await validateEpub(f);
    if (problem) { epubFile = null; $('b-epub-name').textContent = ''; err(problem); return; }
    epubFile = f;
    err('');
    $('b-epub-name').textContent = `${f.name} · ${(f.size / 1024 / 1024).toFixed(1)} MB ✓`;
    $('b-epub-name').className = 'crm-save-status ok';
  };
  $('b-epub').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) takeEpub(f); });
  const drop = $('b-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.borderColor = 'var(--red)'; });
  drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--border)'; });
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.style.borderColor = 'var(--border)';
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) takeEpub(f);
  });
  $('b-cover').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const problem = validateCover(f);
    if (problem) { coverFile = null; err(problem); return; }
    coverFile = f; err('');
    $('b-cover-name').textContent = f.name;
    try { $('b-cover-preview').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="">`; } catch (_) {}
  });

  // ── Audiobook chapters ──
  // `tracks` is what gets saved: existing chapters (with their Storage path)
  // or freshly picked files waiting to upload. Titles stay editable either way.
  let tracks = (b.tracks || []).map((t) => ({ title: t.title, path: t.path, duration: t.duration, size: t.size }));
  let audioFiles = null;
  const isAudio = () => $('b-format').value === 'audio';
  const applyFormat = () => {
    const audio = isAudio();
    $('b-audio-section').hidden = !audio;
    $('b-epub-row').hidden = audio;
    $('b-open-row').hidden = audio;
    $('b-buy-row').hidden = audio;
  };
  const renderTracks = () => {
    $('b-tracks').innerHTML = tracks.length ? tracks.map((t, i) => `
      <div style="display:grid;grid-template-columns:28px 1fr 60px;gap:8px;align-items:center;">
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--gray-light);">${String(i + 1).padStart(2, '0')}</span>
        <input class="c-input" data-title="${i}" value="${escapeHtml(t.title || '')}">
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--gray-light);text-align:right;">${t.duration ? `${Math.floor(t.duration / 60)}:${String(t.duration % 60).padStart(2, '0')}` : ''}</span>
      </div>`).join('') : '<span class="crm-save-status">No chapters yet.</span>';
    $('b-tracks').querySelectorAll('[data-title]').forEach((inp) => inp.addEventListener('input', () => {
      tracks[Number(inp.dataset.title)].title = inp.value;
    }));
    const cur = Number.isInteger(b.sampleTrack) ? b.sampleTrack : (editing ? -1 : 0);
    const keep = $('b-sample').value;
    $('b-sample').innerHTML = `<option value="">No free sample</option>` + tracks.map((t, i) =>
      `<option value="${i}">${String(i + 1).padStart(2, '0')}. ${escapeHtml(t.title || '')}</option>`).join('');
    $('b-sample').value = keep !== '' && Number(keep) < tracks.length ? keep : (cur >= 0 && cur < tracks.length ? String(cur) : '');
  };
  const takeAudio = async (fileList) => {
    const files = sortAudioFiles([...fileList]);
    if (!files.length) return;
    const problem = files.map(validateAudio).find(Boolean);
    if (problem) { err(problem); return; }
    err('');
    $('b-audio-name').textContent = 'Reading chapter lengths…';
    const durations = await Promise.all(files.map(probeDuration));
    audioFiles = files;
    tracks = files.map((f, i) => ({ title: titleFromFileName(f.name, i), duration: durations[i], size: f.size, file: f }));
    const mb = files.reduce((n, f) => n + f.size, 0) / 1024 / 1024;
    $('b-audio-name').textContent = `${files.length} chapters · ${mb.toFixed(0)} MB ✓`;
    $('b-audio-name').className = 'crm-save-status ok';
    renderTracks();
  };
  $('b-format').addEventListener('change', applyFormat);
  $('b-audio').addEventListener('change', (e) => takeAudio(e.target.files || []));
  const adrop = $('b-audio-drop');
  adrop.addEventListener('dragover', (e) => { e.preventDefault(); adrop.style.borderColor = 'var(--red)'; });
  adrop.addEventListener('dragleave', () => { adrop.style.borderColor = 'var(--border)'; });
  adrop.addEventListener('drop', (e) => {
    e.preventDefault(); adrop.style.borderColor = 'var(--border)';
    takeAudio(e.dataTransfer.files || []);
  });
  applyFormat();
  renderTracks();

  if (editing) $('b-sync').addEventListener('click', async () => {
    const btn = $('b-sync');
    btn.disabled = true; btn.textContent = 'Granting…';
    try {
      const r = await syncBookGrants(b.id);
      btn.textContent = r.granted
        ? `Added to ${r.granted} member${r.granted === 1 ? '' : 's'} ✓`
        : `Everyone enrolled already has it ✓ (${r.checked} checked)`;
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Grant to enrolled members';
      err(e.message || String(e));
    }
  });

  $('b-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    err('');
    const id = editing ? b.id : $('b-id').value.trim();
    if (!ID_RE.test(id)) { err('The book id needs lowercase letters, numbers and dashes, like i-cant.'); return; }
    if (!editing && state.books.some((x) => x.id === id)) { err(`A book with the id "${id}" already exists.`); return; }
    const audio = isAudio();
    if (!editing && !audio && !epubFile) { err('Choose the EPUB file.'); return; }
    if (audio && !tracks.length) { err('Choose the chapter files.'); return; }
    const openAccess = !audio && $('b-open').checked;
    const buy = $('b-buy').value.trim();
    if (buy && !/^(\/(?!\/)|https:\/\/)/.test(buy)) { err('The buy link must start with / (a page on this site) or https://.'); return; }
    const wanted = [...$('b-courses').querySelectorAll('input[data-slug]')].filter((i) => i.checked).map((i) => i.dataset.slug);
    // A book that comes with a paid course is the product itself. Opening it
    // would give it away, so the two never go together.
    if (openAccess && (wanted.length || id === 'i-cant')) {
      err('Open access gives the book away free, so it can\'t also come with a paid course. Upload the preview as its own book, or untick the courses.');
      return;
    }

    const save = $('b-save');
    save.disabled = true;
    const bar = $('b-epub-bar'); const fill = $('b-epub-fill');
    try {
      let coverUrl = b.coverUrl || null;
      if (audio && audioFiles) {
        // One chapter at a time, so the bar means something and a dropped
        // connection loses one chapter, not the batch.
        $('b-audio-bar').style.display = '';
        const total = audioFiles.reduce((n, f) => n + f.size, 0) || 1;
        let done = 0;
        for (let i = 0; i < audioFiles.length; i++) {
          save.textContent = `Uploading chapter ${i + 1} of ${audioFiles.length}…`;
          const f = audioFiles[i];
          tracks[i].path = await uploadAudioTrack(id, i, f, (p) => {
            $('b-audio-fill').style.width = `${Math.round(((done + p * f.size) / total) * 100)}%`;
          });
          done += f.size;
        }
      }
      if (epubFile && !audio) {
        bar.style.display = '';
        save.textContent = 'Uploading book…';
        await uploadEpub(id, epubFile, (p) => { fill.style.width = `${Math.round(p * 100)}%`; });
      }
      if (coverFile) {
        save.textContent = 'Uploading cover…';
        coverUrl = await uploadCover(id, coverFile);
      }
      save.textContent = 'Saving…';
      const sample = $('b-sample').value;
      await saveBook(id, {
        title: $('b-title').value, author: $('b-author').value, status: $('b-status').value, coverUrl, openAccess, buyHref: $('b-buy').value,
        ...(audio ? {
          format: 'audio',
          description: $('b-desc').value,
          sampleTrack: sample === '' ? null : Number(sample),
          tracks: tracks.map(({ title, path, duration, size }) => ({ title, path, duration, size }))
        } : {})
      }, { isNew: !editing, newFile: audio ? !!audioFiles : !!epubFile });

      for (const c of state.courses) {
        const has = c.grantsBooks.includes(id);
        const want = wanted.includes(c.slug);
        if (has === want) continue;
        const next = want ? [...c.grantsBooks, id] : c.grantsBooks.filter((x) => x !== id);
        await setCourseGrants(c.slug, next);
      }
      close();
      await reload();
    } catch (ex) {
      console.error('[manage-library] save failed', ex);
      err(ex.message || String(ex));
      save.disabled = false; save.textContent = editing ? 'Save' : 'Upload & save';
    }
  });
}

async function reload() {
  [state.books, state.courses] = await Promise.all([listBooks(), listCourseGrants()]);
  render();
}

// ── Advance readers ─────────────────────────────────────────────────────
// The switch and the list for /arc. claimArcCopy enforces all of this on
// the server; the page only reads config/arc to say "closed" up front.

const fmtDate = (t) => (t && t.toDate
  ? t.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

function renderArc({ cfg, readers }) {
  const host = $('arc-panel');
  const open = cfg.open !== false;
  const bookId = cfg.bookId || 'i-cant';
  const limit = Number(cfg.limit) > 0 ? Math.floor(Number(cfg.limit)) : '';
  const reviewed = readers.filter((r) => r.reviewedAt).length;
  const hasBook = state.books.some((b) => b.id === bookId);
  const bookOpts = state.books.filter((b) => !b.openAccess).map((b) =>
    `<option value="${escapeHtml(b.id)}" ${b.id === bookId ? 'selected' : ''}>${escapeHtml(b.title || b.id)}</option>`).join('');

  host.innerHTML = `
    <div class="card" style="margin-bottom:14px;">
      ${hasBook ? '' : `<div class="auth-error" style="margin-bottom:12px;">The ARC book <code>${escapeHtml(bookId)}</code> is not in the Library yet. Upload the full EPUB above with that id, or pick another book, before you share the link.</div>`}
      <div style="display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;">
        <div>
          <div style="font-size:12px;color:var(--gray-light);margin-bottom:6px;">Sign-ups</div>
          <button class="btn ${open ? 'btn-primary' : 'btn-ghost'}" id="arc-toggle" type="button">${open ? 'Open · click to close' : 'Closed · click to open'}</button>
        </div>
        <div class="crm-form-row" style="margin:0;min-width:220px;"><label>Book they get</label>
          <select class="c-input" id="arc-book">${bookOpts || `<option value="${escapeHtml(bookId)}">${escapeHtml(bookId)}</option>`}</select></div>
        <div class="crm-form-row" style="margin:0;width:140px;"><label>Copy limit</label>
          <input class="c-input" id="arc-limit" type="number" min="1" placeholder="No limit" value="${escapeHtml(limit)}"></div>
        <div class="crm-form-row" style="margin:0;flex:1;min-width:240px;"><label>Review link (optional, in their email)</label>
          <input class="c-input" id="arc-review" type="url" placeholder="https://www.amazon.com/review/create-review?asin=…" value="${escapeHtml(cfg.reviewUrl || '')}"></div>
        <button class="btn btn-ghost" id="arc-save" type="button">Save</button>
      </div>
      <div id="arc-err" class="auth-error" style="display:none;margin-top:12px;"></div>
      <div style="margin-top:14px;font-size:13px;color:var(--gray-light);">
        <strong style="color:var(--white);">${readers.length}</strong> claimed${limit ? ` of ${limit}` : ''} ·
        <strong style="color:var(--white);">${reviewed}</strong> reviewed
      </div>
    </div>
    <div class="card crm-list-card">${readers.length ? `<table class="data-table crm-list-table">
      <thead><tr><th>Reader</th><th>Review on</th><th>Claimed</th><th>Review</th></tr></thead>
      <tbody>${readers.map((r) => `<tr>
        <td><div style="font-weight:600;">${escapeHtml(r.name || r.email || r.id)}</div>
            <div style="font-size:12px;color:var(--gray-light);">${escapeHtml(r.email || '')}</div></td>
        <td>${escapeHtml(r.reviewPlatform || '—')}</td>
        <td>${fmtDate(r.claimedAt)}</td>
        <td>${r.reviewedAt
          ? `<span style="color:#56D4A8;font-weight:600;">in · ${fmtDate(r.reviewedAt)}</span> <a href="#" data-unreview="${escapeHtml(r.id)}" style="font-size:12px;">undo</a>`
          : `<button class="btn btn-ghost" data-review="${escapeHtml(r.id)}" type="button">Mark reviewed</button>`}</td>
      </tr>`).join('')}</tbody></table>`
      : '<div class="crm-subpanel-empty">No advance readers yet. Share the1pnation.com/arc and they will show up here.</div>'}
    </div>`;

  const arcErr = (m) => { const el = $('arc-err'); el.textContent = m || ''; el.style.display = m ? '' : 'none'; };
  const run = async (fn) => {
    arcErr('');
    try { await fn(); await reloadArc(); } catch (e) { arcErr(e.message || String(e)); }
  };
  $('arc-toggle').addEventListener('click', () => run(() => saveArcConfig({ open: !open })));
  $('arc-save').addEventListener('click', () => run(() => saveArcConfig({
    bookId: $('arc-book').value, limit: $('arc-limit').value, reviewUrl: $('arc-review').value
  })));
  host.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => run(() => markArcReviewed(b.dataset.review, true))));
  host.querySelectorAll('[data-unreview]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    run(() => markArcReviewed(a.dataset.unreview, false));
  }));
}

async function reloadArc() {
  try { renderArc(await loadArc()); }
  catch (e) {
    $('arc-panel').innerHTML = `<div class="card"><div class="auth-error">Could not load advance readers: ${escapeHtml(e.message || String(e))}</div></div>`;
  }
}

async function main() {
  if (!firebaseReady) { gate('Firebase is unavailable.'); return; }
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/manage-library.html')); return; }
  const info = await getRoleInfo(true);
  renderTopbar({ user: u, role: info.role, currentPage: 'library-admin' });
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  $('panel').style.display = 'block';
  // Held until the books and courses are in, so the "Attached to courses"
  // list in the modal is never opened empty.
  const addBtn = $('btn-new-book');
  addBtn.disabled = true;
  addBtn.addEventListener('click', () => openModal(null));
  try { await reload(); addBtn.disabled = false; } catch (e) { gate('Could not load the library: ' + (e.message || e)); }
  $('arc-copy').addEventListener('click', async () => {
    const url = `${location.origin}/arc`;
    try { await navigator.clipboard.writeText(url); $('arc-copy').textContent = 'Copied ✓'; }
    catch (_) { window.prompt('Copy this link', url); }
  });
  await reloadArc();
}

main();
