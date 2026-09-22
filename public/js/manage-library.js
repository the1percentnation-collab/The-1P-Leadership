// Admin: Library — upload, proof and publish the digital books, and attach
// them to courses. Admin/owner only; the rules enforce that independently.

import { firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderTopbar } from './topbar.js';
import { escapeHtml } from './products.js';
import {
  ID_RE, slugify, validateEpub, validateCover, uploadEpub, uploadCover,
  listBooks, saveBook, listCourseGrants, setCourseGrants, syncBookGrants
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
            <div style="font-size:12px;color:var(--gray-light);">${escapeHtml(b.author || '')} · <code>${escapeHtml(b.id)}</code></div></td>
        <td><span style="color:${live ? '#56D4A8' : '#E8C547'};font-weight:600;">${live ? 'live' : 'hidden (proofing)'}</span></td>
        <td>${fmtVersion(b.version)}</td>
        <td style="font-size:12px;">${courses.length
          ? courses.map((c) => escapeHtml(c.title)).join(', ')
          : '<span style="color:var(--gray-light);">nothing yet</span>'}</td>
        <td style="white-space:nowrap;text-align:right;">
          <a class="btn btn-ghost" href="/read?book=${encodeURIComponent(b.id)}" target="_blank">Open in reader ↗</a>
          <button class="btn btn-ghost" data-edit="${escapeHtml(b.id)}">Edit</button>
        </td>
      </tr>`;
    }).join('')}
    </tbody></table></div>`;
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
    if (!editing && !epubFile) { err('Choose the EPUB file.'); return; }

    const save = $('b-save');
    save.disabled = true;
    const bar = $('b-epub-bar'); const fill = $('b-epub-fill');
    try {
      let coverUrl = b.coverUrl || null;
      if (epubFile) {
        bar.style.display = '';
        save.textContent = 'Uploading book…';
        await uploadEpub(id, epubFile, (p) => { fill.style.width = `${Math.round(p * 100)}%`; });
      }
      if (coverFile) {
        save.textContent = 'Uploading cover…';
        coverUrl = await uploadCover(id, coverFile);
      }
      save.textContent = 'Saving…';
      await saveBook(id, {
        title: $('b-title').value, author: $('b-author').value, status: $('b-status').value, coverUrl
      }, { isNew: !editing, newFile: !!epubFile });

      const wanted = [...$('b-courses').querySelectorAll('input[data-slug]')].filter((i) => i.checked).map((i) => i.dataset.slug);
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
}

main();
