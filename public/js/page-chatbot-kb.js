import { requireAuth } from './auth.js';
    import { functions, db } from './firebase.js';
    import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
    import { initUserChip } from './topbar.js';
    import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

    const user = await requireAuth('/login.html');
    if (!user) throw new Error('not authed');

    // Gate: owner or admin only
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const role = userSnap.exists() ? userSnap.data().role : null;
    if (role !== 'owner' && role !== 'admin') {
      document.getElementById('gate-msg').innerHTML =
        '<div class="card" style="color:#f88;"><strong>Access denied.</strong> Owner or admin role required.</div>';
      throw new Error('not owner/admin');
    }

    initUserChip(user);
    document.getElementById('panel').style.display = '';

    // ── Callable refs ──
    const listKB   = httpsCallable(functions, 'listKnowledgeEntries');
    const saveKB   = httpsCallable(functions, 'saveKnowledgeEntry');
    const deleteKB = httpsCallable(functions, 'deleteKnowledgeEntry');

    // ── State ──
    let entries = [];
    let editingId = null;

    // ── Toast ──
    const bar = document.getElementById('status-bar');
    let toastTimer;
    function toast(msg, type = 'ok') {
      bar.textContent = msg;
      bar.className = `show ${type}`;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { bar.className = ''; }, 3200);
    }

    // ── Load entries ──
    async function loadEntries() {
      try {
        const res = await listKB({});
        entries = res.data.entries || [];
        renderList();
      } catch (e) {
        document.getElementById('kb-list').innerHTML =
          `<div class="empty-state"><h3>Failed to load</h3><p>${e.message}</p></div>`;
      }
    }

    // ── Render list ──
    function renderList() {
      const el = document.getElementById('kb-list');
      const count = document.getElementById('entry-count');
      count.textContent = `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

      if (!entries.length) {
        el.innerHTML = `<div class="empty-state">
          <h3>No entries yet</h3>
          <p>Click <strong>+ Add Entry</strong> to give the chatbot its first piece of knowledge.</p>
        </div>`;
        return;
      }

      el.innerHTML = '';
      const grid = document.createElement('div');
      grid.className = 'kb-grid';

      entries.forEach((e) => {
        const card = document.createElement('div');
        card.className = `kb-entry${e.active === false ? ' kb-inactive' : ''}`;
        const updated = e.updatedAt ? new Date(e.updatedAt).toLocaleDateString() : '—';
        card.innerHTML = `
          <div>
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
              <span class="kb-entry-title">${esc(e.title)}</span>
              <span class="${e.active === false ? 'kb-badge-inactive' : 'kb-badge-active'}">${e.active === false ? 'Inactive' : 'Active'}</span>
              <span class="kb-order">#${e.order ?? 0}</span>
            </div>
            <div class="kb-entry-body">${esc(e.body)}</div>
            <div class="kb-entry-meta">Last updated ${updated}</div>
          </div>
          <div class="kb-entry-actions">
            <button class="btn-icon btn-edit" data-id="${e.id}" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="btn-icon btn-del" data-id="${e.id}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </button>
          </div>
        `;
        grid.appendChild(card);
      });

      el.appendChild(grid);

      el.querySelectorAll('.btn-edit').forEach((btn) => {
        btn.addEventListener('click', () => openModal(btn.dataset.id));
      });
      el.querySelectorAll('.btn-del').forEach((btn) => {
        btn.addEventListener('click', () => confirmDelete(btn.dataset.id));
      });
    }

    function esc(str) {
      return String(str || '')
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;');
    }

    // ── Modal ──
    const modal   = document.getElementById('modal');
    const fTitle  = document.getElementById('f-title');
    const fBody   = document.getElementById('f-body');
    const fOrder  = document.getElementById('f-order');
    const fActive = document.getElementById('f-active');

    function openModal(id = null) {
      editingId = id;
      const existing = id ? entries.find((e) => e.id === id) : null;
      document.getElementById('modal-title').textContent = id ? 'Edit Entry' : 'Add Knowledge Entry';
      fTitle.value  = existing ? existing.title : '';
      fBody.value   = existing ? existing.body  : '';
      fOrder.value  = existing ? (existing.order ?? 0) : entries.length;
      fActive.checked = existing ? existing.active !== false : true;
      modal.style.display = 'flex';
      fTitle.focus();
    }

    function closeModal() {
      modal.style.display = 'none';
      editingId = null;
    }

    document.getElementById('btn-add').addEventListener('click', () => openModal());
    document.getElementById('btn-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    document.getElementById('btn-save').addEventListener('click', async () => {
      const title  = fTitle.value.trim();
      const body   = fBody.value.trim();
      const order  = parseInt(fOrder.value, 10) || 0;
      const active = fActive.checked;

      if (!title) { fTitle.focus(); toast('Title is required.', 'err'); return; }
      if (!body)  { fBody.focus();  toast('Content is required.', 'err'); return; }

      const saveBtn = document.getElementById('btn-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';

      try {
        await saveKB({ id: editingId || undefined, title, body, order, active });
        closeModal();
        toast(editingId ? 'Entry updated ✓' : 'Entry added ✓');
        await loadEntries();
      } catch (e) {
        toast(`Error: ${e.message}`, 'err');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Entry';
      }
    });

    // ── Delete ──
    async function confirmDelete(id) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      if (!confirm(`Delete "${entry.title}"?\n\nThis cannot be undone.`)) return;
      try {
        await deleteKB({ id });
        toast('Entry deleted.');
        await loadEntries();
      } catch (e) {
        toast(`Error: ${e.message}`, 'err');
      }
    }

    await loadEntries();

