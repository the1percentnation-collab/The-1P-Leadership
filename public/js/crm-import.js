// CRM contact import — CSV upload, column mapping, preview, chunked import.
//
// The flow is deliberately four steps rather than one "upload and pray"
// button: every list that arrives from Mailchimp, GoHighLevel or a
// conference organizer has different headers, and an import that guesses
// wrong writes hundreds of contacts that then have to be cleaned up by hand.
// So: parse locally, let the user map columns, show them exactly what the
// first rows will become, and only then write.
//
// Writes go through the importContacts callable in chunks of CHUNK rows. The
// callable owns validation and de-duplication; this module owns the mapping
// UI and progress reporting.

import { functions, firebaseReady } from './firebase.js';
import { onAuthReady } from './auth.js';
import { getRoleInfo } from './roles.js';
import { renderCrmShell } from './crm-shell.js';
import { resolveCrmCompany, mountCrmCompanySwitcher } from './company-resolver.js';
import { escapeHtml, STAGES, SOURCES } from './crm.js';
import { parseCsv, toCsv, downloadCsv } from './csv.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const $ = (id) => document.getElementById(id);

// Rows per callable invocation. Matches IMPORT_MAX_ROWS on the server.
const CHUNK = 250;
// A file this size is a mistake (a database export, a wrong column) far more
// often than a real contact list, and parsing it in the page would lock the
// tab. The cap is on rows, checked after parse, so the message can say so.
const MAX_ROWS = 20000;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// CRM fields an import can fill. `key` matches the payload the callable reads.
const FIELDS = [
  { key: 'email',       label: 'Email',        required: true,  hints: ['email', 'e-mail', 'email address', 'emailaddress', 'primary email'] },
  // `avoid` keeps the loose "name" match off columns that merely contain the
  // word. Without it a Mailchimp export (First Name / Last Name / Email
  // Address) maps Name to the first-name column and the surname is dropped.
  { key: 'name',        label: 'Name',         required: false, hints: ['name', 'full name', 'fullname', 'contact', 'contact name'],
    avoid: ['first', 'last', 'company', 'organization', 'organisation', 'business', 'user', 'nick', 'file', 'tag', 'id'] },
  { key: 'firstName',   label: 'First name',   required: false, hints: ['first name', 'firstname', 'first', 'given name'] },
  { key: 'lastName',    label: 'Last name',    required: false, hints: ['last name', 'lastname', 'last', 'surname', 'family name'] },
  { key: 'phone',       label: 'Phone',        required: false, hints: ['phone', 'phone number', 'mobile', 'cell', 'telephone'] },
  { key: 'companyName', label: 'Company',      required: false, hints: ['company', 'company name', 'organization', 'organisation', 'business'] },
  { key: 'tags',        label: 'Tags',         required: false, hints: ['tags', 'tag', 'labels', 'segments'] }
];

// Auto-map resolves in this order, not the display order above: the specific
// first/last columns must claim their headers before the generic Name field
// gets a chance at them.
const AUTOMAP_ORDER = ['email', 'firstName', 'lastName', 'name', 'phone', 'companyName', 'tags'];

const state = {
  uid: null,
  companyId: null,
  step: 'upload',        // upload | map | running | done
  fileName: '',
  headers: [],
  rows: [],
  mapping: {},           // field key → header index, or -1 for "not mapped"
  duplicateMode: 'update',
  importTag: '',
  defaultSource: 'Import',
  defaultStage: 'new',
  result: null           // { created, updated, skipped, errors[] }
};

function todayTag() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `import:${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Best-guess header → field mapping, so the common export needs no edits. */
function autoMap(headers) {
  // Headers and hints go through the same normalizer, so "E-Mail",
  // "email_address" and "Email Address" all land on the same hint.
  const normalize = (h) => String(h).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = headers.map(normalize);
  const used = new Set();
  const mapping = {};
  AUTOMAP_ORDER.forEach((key) => {
    const f = FIELDS.find((x) => x.key === key);
    const free = (i) => !used.has(i) && !(f.avoid || []).some((a) => norm[i].includes(a));
    let idx = -1;
    // Exact match on a hint first, then a contains match, so "Email" wins
    // over "Email Opt-In" when both are present.
    const hints = f.hints.map(normalize);
    for (const hint of hints) {
      const exact = norm.findIndex((h, i) => h === hint && free(i));
      if (exact !== -1) { idx = exact; break; }
    }
    if (idx === -1) {
      for (const hint of hints) {
        const partial = norm.findIndex((h, i) => h.includes(hint) && free(i));
        if (partial !== -1) { idx = partial; break; }
      }
    }
    if (idx !== -1) used.add(idx);
    mapping[f.key] = idx;
  });
  return mapping;
}

/**
 * Turn one CSV row into the payload shape the callable expects.
 * First/last name columns are joined when there is no single Name column,
 * which is how most platforms export.
 */
function mapRow(row, rowNum) {
  const at = (key) => {
    const i = state.mapping[key];
    return i >= 0 && i < row.length ? String(row[i] || '').trim() : '';
  };
  let name = at('name');
  if (!name) name = [at('firstName'), at('lastName')].filter(Boolean).join(' ').trim();
  const rawTags = at('tags');
  const tags = rawTags
    ? rawTags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean).slice(0, 20)
    : [];
  return {
    rowNum,
    email: at('email').toLowerCase(),
    name,
    phone: at('phone'),
    companyName: at('companyName'),
    tags,
    source: state.defaultSource,
    stage: state.defaultStage
  };
}

/** All rows mapped, in file order. Row numbers count the header as line 1. */
function mappedRows() {
  return state.rows.map((r, i) => mapRow(r, i + 2));
}

// ────────────────────────────────────────────────────────────────
// Step 1 — upload
// ────────────────────────────────────────────────────────────────

function renderUpload() {
  $('crm-content').innerHTML = `
    <div class="crm-section-sub">
      Bulk-add contacts from a CSV. Existing contacts are matched on email, so
      re-importing an updated list tops up what is already here instead of
      duplicating it.
    </div>
    <div class="card" style="max-width:760px;">
      <div class="crm-import-drop" id="drop-zone">
        <div class="crm-import-drop-icon">⇪</div>
        <div class="crm-import-drop-main">Drop a CSV here, or <button class="crm-linkish" id="browse">choose a file</button></div>
        <div class="crm-import-drop-sub">Up to ${MAX_ROWS.toLocaleString()} rows. Email column required.</div>
        <input type="file" id="file-input" accept=".csv,text/csv,text/plain" hidden>
      </div>
      <div id="upload-err"></div>

      <details class="crm-import-paste">
        <summary>Or paste CSV text</summary>
        <textarea id="paste-area" class="c-input" rows="6" placeholder="name,email,phone&#10;Jane Doe,jane@example.com,555-0100"></textarea>
        <button class="btn btn-ghost" id="paste-go" style="margin-top:10px;">Use pasted text</button>
      </details>

      <div class="crm-import-foot">
        <button class="crm-linkish" id="dl-template">Download a template CSV</button>
      </div>
    </div>
  `;

  const fileInput = $('file-input');
  const drop = $('drop-zone');

  $('browse').addEventListener('click', () => fileInput.click());
  drop.addEventListener('click', (e) => {
    // The whole panel is a target, but not the controls inside it.
    if (e.target.closest('button') || e.target.closest('details')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) readFile(f);
  });

  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  $('paste-go').addEventListener('click', () => {
    const text = $('paste-area').value;
    if (!text.trim()) { uploadError('Paste some CSV text first.'); return; }
    loadCsv(text, 'pasted-text.csv');
  });

  $('dl-template').addEventListener('click', () => {
    downloadCsv('contacts-template.csv', toCsv(
      ['Name', 'Email', 'Phone', 'Company', 'Tags'],
      [['Jane Doe', 'jane@example.com', '555-0100', 'Acme Inc', 'Speaking; Warm lead']]
    ));
  });
}

function uploadError(msg) {
  const el = $('upload-err');
  if (el) el.innerHTML = `<div class="auth-error" style="margin-top:12px;">${escapeHtml(msg)}</div>`;
}

// Spreadsheet apps save in their own binary formats, and the file picker's
// `accept` filter is only a hint: a .numbers or .xlsx file still gets through
// a drag-and-drop or an "All files" pick. Read as text, those bytes parse as
// ~1,500 rows of symbols that map onto every column, and a stray "@" in
// them passes as an email. So check the first bytes and the extension, and
// say how to export a real CSV, instead of previewing garbage.
const SPREADSHEET_HELP =
  'Export it as CSV first. In Numbers: File → Export To → CSV. ' +
  'In Excel: File → Save As → CSV UTF-8. In Google Sheets: File → Download → Comma-separated values.';

function binaryKind(bytes, name) {
  const ext = (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const starts = (...sig) => sig.every((b, i) => bytes[i] === b);
  if (ext === 'numbers') return 'an Apple Numbers file';
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xls') return 'an Excel file';
  if (ext === 'ods') return 'an OpenDocument spreadsheet';
  if (starts(0x50, 0x4b, 0x03, 0x04)) return 'a spreadsheet or zip file';   // PK: xlsx, numbers, ods, zip
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return 'an old-format Excel file';    // OLE2: .xls
  if (starts(0x25, 0x50, 0x44, 0x46)) return 'a PDF';                       // %PDF
  // Plain text never carries NUL bytes; any binary format almost always does.
  // (UTF-16 text does too, which is also not something the parser reads.)
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) return 'a binary file';
  return null;
}

function readFile(file) {
  const reader = new FileReader();
  reader.onerror = () => uploadError('That file could not be read.');
  reader.onload = () => {
    const bytes = new Uint8Array(reader.result || new ArrayBuffer(0));
    const kind = binaryKind(bytes.subarray(0, 4096), file.name);
    if (kind) {
      uploadError(`“${file.name}” is ${kind}, not a CSV. ${SPREADSHEET_HELP}`);
      return;
    }
    loadCsv(new TextDecoder('utf-8').decode(bytes), file.name);
  };
  reader.readAsArrayBuffer(file);
}

function loadCsv(text, fileName) {
  let parsed;
  try {
    parsed = parseCsv(text);
  } catch (e) {
    uploadError('That file could not be parsed as CSV.');
    return;
  }
  if (!parsed.headers.length) { uploadError('No header row found.'); return; }
  if (!parsed.rows.length) { uploadError('The file has headers but no data rows.'); return; }
  if (parsed.rows.length > MAX_ROWS) {
    uploadError(`That file has ${parsed.rows.length.toLocaleString()} rows. Split it into files of ${MAX_ROWS.toLocaleString()} or fewer.`);
    return;
  }
  state.fileName = fileName || 'contacts.csv';
  state.headers = parsed.headers;
  state.rows = parsed.rows;
  state.mapping = autoMap(parsed.headers);
  state.importTag = todayTag();
  state.step = 'map';
  render();
}

// ────────────────────────────────────────────────────────────────
// Step 2 — map columns + preview
// ────────────────────────────────────────────────────────────────

function headerOptions(selected) {
  const opts = [`<option value="-1">${escapeHtml('— not imported —')}</option>`];
  state.headers.forEach((h, i) => {
    opts.push(`<option value="${i}" ${i === selected ? 'selected' : ''}>${escapeHtml(h || `Column ${i + 1}`)}</option>`);
  });
  return opts.join('');
}

function renderMap() {
  const rows = mappedRows();
  const valid = rows.filter((r) => EMAIL_RE.test(r.email));
  const invalid = rows.length - valid.length;
  const unique = new Set(valid.map((r) => r.email)).size;
  const dupesInFile = valid.length - unique;
  const emailMapped = state.mapping.email >= 0;

  $('crm-content').innerHTML = `
    <div class="crm-section-sub">
      <b>${escapeHtml(state.fileName)}</b> — ${state.rows.length.toLocaleString()} row${state.rows.length === 1 ? '' : 's'},
      ${state.headers.length} column${state.headers.length === 1 ? '' : 's'}.
      <button class="crm-linkish" id="start-over">Use a different file</button>
    </div>

    <div class="card" style="max-width:900px;">
      <label class="crm-field-label" style="display:block;margin-bottom:10px;">Match your columns</label>
      <div class="crm-import-map">
        ${FIELDS.map((f) => `
          <div class="crm-import-map-row">
            <span class="crm-import-map-label">${escapeHtml(f.label)}${f.required ? ' <b style="color:var(--red)">*</b>' : ''}</span>
            <select class="c-input crm-import-select" data-field="${f.key}">${headerOptions(state.mapping[f.key])}</select>
          </div>
        `).join('')}
      </div>
      <div class="crm-import-note">
        Leave First/Last name unmapped if your file has a single full-name column.
        Tags can be separated by <code>;</code> <code>,</code> or <code>|</code> inside one cell.
      </div>
    </div>

    <div class="card" style="max-width:900px;">
      <label class="crm-field-label" style="display:block;margin-bottom:10px;">Options</label>
      <div class="crm-import-opts">
        <div class="crm-field">
          <label>When the email already exists</label>
          <select class="c-input" id="dup-mode">
            <option value="update" ${state.duplicateMode === 'update' ? 'selected' : ''}>Update the existing contact</option>
            <option value="skip" ${state.duplicateMode === 'skip' ? 'selected' : ''}>Skip the row, change nothing</option>
          </select>
        </div>
        <div class="crm-field">
          <label>Tag every imported contact</label>
          <input class="c-input" id="import-tag" value="${escapeHtml(state.importTag)}" maxlength="40" placeholder="Leave blank for none">
        </div>
        <div class="crm-field">
          <label>Source</label>
          <select class="c-input" id="def-source">
            ${['Import'].concat(SOURCES).map((s) => `<option value="${escapeHtml(s)}" ${s === state.defaultSource ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
          </select>
        </div>
        <div class="crm-field">
          <label>Starting stage</label>
          <select class="c-input" id="def-stage">
            ${STAGES.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === state.defaultStage ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="card" style="max-width:900px;">
      <label class="crm-field-label" style="display:block;margin-bottom:10px;">Preview</label>
      ${!emailMapped
        ? `<div class="auth-error">Map the Email column to continue. It is how contacts are matched and mailed.</div>`
        : `
        <div class="crm-import-stats">
          <span class="crm-import-stat ok">${unique.toLocaleString()} to import</span>
          ${dupesInFile ? `<span class="crm-import-stat warn">${dupesInFile.toLocaleString()} duplicate row${dupesInFile === 1 ? '' : 's'} in the file (last wins)</span>` : ''}
          ${invalid ? `<span class="crm-import-stat err">${invalid.toLocaleString()} row${invalid === 1 ? '' : 's'} with no valid email (skipped)</span>` : ''}
        </div>
        <div class="crm-import-table-wrap">
          <table class="crm-import-table">
            <thead><tr><th>Row</th><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th>Tags</th></tr></thead>
            <tbody>
              ${rows.slice(0, 10).map((r) => {
                const bad = !EMAIL_RE.test(r.email);
                const tags = r.tags.concat(state.importTag ? [state.importTag] : []);
                return `<tr class="${bad ? 'bad' : ''}">
                  <td class="crm-import-rownum">${r.rowNum}</td>
                  <td>${escapeHtml(r.name || '—')}</td>
                  <td>${bad ? `<span class="crm-import-bad">${escapeHtml(r.email || 'missing')}</span>` : escapeHtml(r.email)}</td>
                  <td>${escapeHtml(r.phone || '—')}</td>
                  <td>${escapeHtml(r.companyName || '—')}</td>
                  <td>${tags.length ? escapeHtml(tags.join(', ')) : '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        ${rows.length > 10 ? `<div class="crm-import-note">Showing the first 10 of ${rows.length.toLocaleString()} rows.</div>` : ''}
      `}
      <div class="crm-save-row" style="margin-top:18px;">
        <span id="run-status" class="crm-save-status"></span>
        <button class="btn btn-primary" id="run-import" ${!emailMapped || !unique ? 'disabled' : ''}>
          Import ${unique ? unique.toLocaleString() + ' contact' + (unique === 1 ? '' : 's') : 'contacts'}
        </button>
      </div>
    </div>
  `;

  $('start-over').addEventListener('click', () => {
    state.step = 'upload';
    state.headers = []; state.rows = []; state.result = null;
    render();
  });
  document.querySelectorAll('.crm-import-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      state.mapping[sel.dataset.field] = Number(sel.value);
      renderMap();
    });
  });
  $('dup-mode').addEventListener('change', (e) => { state.duplicateMode = e.target.value; });
  $('import-tag').addEventListener('input', (e) => { state.importTag = e.target.value.trim(); });
  $('def-source').addEventListener('change', (e) => { state.defaultSource = e.target.value; renderMap(); });
  $('def-stage').addEventListener('change', (e) => { state.defaultStage = e.target.value; renderMap(); });
  $('run-import').addEventListener('click', runImport);
}

// ────────────────────────────────────────────────────────────────
// Step 3 — run
// ────────────────────────────────────────────────────────────────

async function runImport() {
  const mapped = mappedRows();
  const all = mapped.filter((r) => EMAIL_RE.test(r.email));

  // Rows the server will never see, because they are filtered here. They still
  // belong in the final report and in the downloadable problem file — an
  // import that silently drops 40 rows is how a list quietly goes missing.
  const preErrors = mapped
    .filter((r) => !EMAIL_RE.test(r.email))
    .map((r) => ({
      rowNum: r.rowNum,
      email: r.email,
      message: r.email ? 'Invalid email address' : 'No email address'
    }));

  if (!all.length) {
    state.step = 'done';
    state.result = { created: 0, updated: 0, skipped: 0, errors: preErrors };
    render();
    return;
  }

  // Collapse duplicates here as well as on the server: two chunks that each
  // contain the same address would otherwise race, and the second would not
  // see the contact the first had just created.
  const seen = new Set();
  const rows = [];
  for (let i = all.length - 1; i >= 0; i--) {      // last occurrence wins
    if (seen.has(all[i].email)) continue;
    seen.add(all[i].email);
    rows.unshift(all[i]);
  }

  state.step = 'running';
  state.result = { created: 0, updated: 0, skipped: 0, errors: preErrors.slice() };
  renderRunning(0, rows.length);

  const call = httpsCallable(functions, 'importContacts');
  const chunks = [];
  for (let i = 0; i < rows.length; i += CHUNK) chunks.push(rows.slice(i, i + CHUNK));

  let done = 0;
  for (const chunk of chunks) {
    try {
      const res = (await call({
        companyId: state.companyId,
        rows: chunk,
        duplicateMode: state.duplicateMode,
        importTag: state.importTag || null
      })).data || {};
      state.result.created += res.created || 0;
      state.result.updated += res.updated || 0;
      state.result.skipped += res.skipped || 0;
      if (Array.isArray(res.errors)) state.result.errors.push(...res.errors);
    } catch (err) {
      // One failed chunk does not abandon the rest — the remaining rows are
      // still worth importing, and the failure is reported row by row so the
      // user can retry exactly what did not land.
      const message = (err && err.message) || 'Import failed';
      chunk.forEach((r) => state.result.errors.push({ rowNum: r.rowNum, email: r.email, message }));
    }
    done += chunk.length;
    renderRunning(done, rows.length);
  }

  state.result.errors.sort((a, b) => (a.rowNum || 0) - (b.rowNum || 0));
  state.step = 'done';
  render();
}

function renderRunning(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  $('crm-content').innerHTML = `
    <div class="card" style="max-width:760px;">
      <label class="crm-field-label" style="display:block;margin-bottom:14px;">Importing…</label>
      <div class="crm-import-bar"><div class="crm-import-bar-fill" style="width:${pct}%;"></div></div>
      <div class="crm-import-note">${done.toLocaleString()} of ${total.toLocaleString()} rows · ${pct}%</div>
      <div class="crm-import-note">Keep this tab open until it finishes.</div>
    </div>
  `;
}

// ────────────────────────────────────────────────────────────────
// Step 4 — result
// ────────────────────────────────────────────────────────────────

function renderDone() {
  const r = state.result || { created: 0, updated: 0, skipped: 0, errors: [] };
  const errs = r.errors || [];
  $('crm-content').innerHTML = `
    <div class="card" style="max-width:900px;">
      <label class="crm-field-label" style="display:block;margin-bottom:12px;">Import finished</label>
      <div class="crm-import-stats">
        <span class="crm-import-stat ok">${r.created.toLocaleString()} created</span>
        <span class="crm-import-stat">${r.updated.toLocaleString()} updated</span>
        ${r.skipped ? `<span class="crm-import-stat warn">${r.skipped.toLocaleString()} skipped</span>` : ''}
        ${errs.length ? `<span class="crm-import-stat err">${errs.length.toLocaleString()} failed</span>` : ''}
      </div>
      ${state.importTag ? `<div class="crm-import-note">
        Everything imported is tagged <code>${escapeHtml(state.importTag)}</code> — filter by that tag on Contacts to review this batch.
      </div>` : ''}
      ${errs.length ? `
        <div class="crm-import-table-wrap" style="margin-top:16px;">
          <table class="crm-import-table">
            <thead><tr><th>Row</th><th>Email</th><th>Problem</th></tr></thead>
            <tbody>
              ${errs.slice(0, 50).map((e) => `<tr class="bad">
                <td class="crm-import-rownum">${escapeHtml(String(e.rowNum || '—'))}</td>
                <td>${escapeHtml(e.email || '—')}</td>
                <td>${escapeHtml(e.message || 'Failed')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${errs.length > 50 ? `<div class="crm-import-note">Showing the first 50 of ${errs.length.toLocaleString()} problem rows.</div>` : ''}
        <button class="btn btn-ghost" id="dl-errors" style="margin-top:12px;">Download the problem rows</button>
      ` : ''}
      <div class="crm-save-row" style="margin-top:20px;">
        <button class="btn btn-ghost" id="import-another">Import another file</button>
        <a class="btn btn-primary" href="/crm.html">Go to Contacts</a>
      </div>
    </div>
  `;

  $('import-another').addEventListener('click', () => {
    state.step = 'upload';
    state.headers = []; state.rows = []; state.result = null;
    render();
  });
  const dl = $('dl-errors');
  if (dl) dl.addEventListener('click', () => {
    downloadCsv('import-problems.csv', toCsv(
      ['Row', 'Email', 'Problem'],
      errs.map((e) => [e.rowNum || '', e.email || '', e.message || 'Failed'])
    ));
  });
}

// ────────────────────────────────────────────────────────────────

function render() {
  if (state.step === 'upload') return renderUpload();
  if (state.step === 'map') return renderMap();
  if (state.step === 'done') return renderDone();
}

async function main() {
  if (!firebaseReady) return;
  const u = await onAuthReady();
  if (!u) { location.replace('/login.html?next=' + encodeURIComponent('/crm-import.html')); return; }
  const info = await getRoleInfo(true);
  if (!info.isAdmin) { location.replace('/index.html'); return; }
  state.uid = u.uid;

  const content = renderCrmShell({ active: 'contacts', title: 'Import Contacts', user: u, role: info.role });

  let companyId = new URLSearchParams(location.search).get('companyId') || info.companyId || null;
  if (!companyId && info.isAdmin) {
    try {
      const resolved = await resolveCrmCompany(u.uid);
      if (resolved.companyId) companyId = resolved.companyId;
    } catch (e) {}
  }
  if (companyId) mountCrmCompanySwitcher(u.uid, companyId);
  if (!companyId) {
    content.innerHTML = `<div class="card"><div class="auth-error">You are not an admin of any company yet. Use /owner.html.</div></div>`;
    return;
  }
  state.companyId = companyId;
  render();
}

main();
