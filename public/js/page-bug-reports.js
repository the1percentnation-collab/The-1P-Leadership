import { auth, db } from './firebase.js';
    import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
    import {
      collection, query, where, orderBy, limit, getDocs, doc, updateDoc, serverTimestamp
    } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

    const gateMsg   = document.getElementById('gate-msg');
    const panel     = document.getElementById('panel');
    const userChip  = document.getElementById('user-chip');
    const listEl    = document.getElementById('reports-list');
    const emptyEl   = document.getElementById('reports-empty');
    const loadingEl = document.getElementById('reports-loading');
    const filterSel = document.getElementById('filter-status');
    const modal     = document.getElementById('modal');
    const modalClose= document.getElementById('modal-close');
    const modalContent = document.getElementById('modal-content');

    let allReports = [];

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        gateMsg.innerHTML = '<p class="alert alert-warn">Sign in as owner to view bug reports.</p>';
        return;
      }
      const token = await user.getIdTokenResult();
      if (token.claims.role !== 'owner') {
        gateMsg.innerHTML = '<p class="alert alert-warn">Owner access required.</p>';
        return;
      }
      userChip.textContent = user.displayName || user.email || 'Owner';
      panel.style.display = '';
      await loadReports();
    });

    async function loadReports() {
      loadingEl.style.display = '';
      listEl.innerHTML = '';
      emptyEl.style.display = 'none';
      try {
        const snap = await getDocs(
          query(collection(db, 'bugReports'), orderBy('createdAt', 'desc'), limit(200))
        );
        allReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderList();
      } catch (e) {
        listEl.innerHTML = `<p style="color:#f08888;">Failed to load: ${e.message}</p>`;
      } finally {
        loadingEl.style.display = 'none';
      }
    }

    function renderList() {
      const filterVal = filterSel.value;
      const filtered = allReports.filter(r => {
        if (filterVal === 'all') return true;
        return (r.status || 'open') === filterVal;
      });
      listEl.innerHTML = '';
      if (!filtered.length) { emptyEl.style.display = ''; return; }
      emptyEl.style.display = 'none';
      filtered.forEach(r => {
        const row = document.createElement('div');
        row.className = 'report-row';
        const sev = (r.aiSeverity || 'unknown').toLowerCase();
        const status = r.status || 'open';
        const dateStr = r.createdAt
          ? new Date(r.createdAt.toMillis()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
          : 'unknown date';
        row.innerHTML = `
          <div class="report-row-top">
            <div class="report-desc">${escHtml(r.description || '').slice(0, 200)}</div>
            <span class="sev-badge sev-${sev}">${sev}</span>
            <span class="status-badge status-${status}">${status}</span>
          </div>
          <div class="report-meta">
            <span>${dateStr}</span>
            ${r.pageUrl ? `<span>${escHtml(r.pageUrl.replace(/^https?:\/\/[^/]+/, ''))}</span>` : ''}
            ${r.reportedByUid ? `<span>uid: ${escHtml(r.reportedByUid.slice(0, 8))}…</span>` : '<span>anonymous</span>'}
          </div>
        `;
        row.addEventListener('click', () => openModal(r));
        listEl.appendChild(row);
      });
    }

    function openModal(r) {
      const sev = (r.aiSeverity || 'unknown').toLowerCase();
      const status = r.status || 'open';
      const dateStr = r.createdAt
        ? new Date(r.createdAt.toMillis()).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
        : '—';
      modalContent.innerHTML = `
        <div style="display:flex; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:16px;">
          <span class="sev-badge sev-${sev}">${sev}</span>
          <span class="status-badge status-${status}">${status}</span>
          <span style="font-size:12px; color:var(--gray-light); margin-left:auto;">${dateStr}</span>
        </div>
        <h3 style="margin-top:0;">Description</h3>
        <p style="white-space:pre-wrap; word-break:break-word; font-size:13.5px; line-height:1.6; background:rgba(255,255,255,.03); border:1px solid var(--border); border-radius:8px; padding:12px;">${escHtml(r.description || '')}</p>
        <div style="display:flex; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--gray-light); margin-bottom:16px;">
          <span><strong>Page:</strong> ${escHtml(r.pageUrl || '—')}</span>
          <span><strong>Reporter:</strong> ${escHtml(r.reportedByUid || 'anonymous')}</span>
        </div>
        ${r.screenshotUrl ? `
        <h3>Screenshot</h3>
        <p><a href="${escHtml(r.screenshotUrl)}" target="_blank" rel="noopener" style="color:#E60306;">Open screenshot →</a></p>
        ` : ''}
        <h3>AI Analysis &amp; Fix Proposal</h3>
        <div class="ai-block">${escHtml(r.aiAnalysis || 'Not available.')}</div>
        ${status === 'open' ? `
        <div style="margin-top:18px; display:flex; gap:10px; align-items:flex-start; flex-wrap:wrap;">
          <textarea id="resolution-note" placeholder="Resolution note (optional)…" rows="2"
            style="flex:1; min-width:200px; background:rgba(255,255,255,.04); border:1px solid var(--border); border-radius:8px; color:var(--text); font-family:'Outfit',sans-serif; font-size:13px; padding:8px 10px; resize:none; outline:none;"></textarea>
          <button id="resolve-btn" class="btn btn-primary" style="height:fit-content;" data-id="${escHtml(r.id)}">Mark Resolved</button>
        </div>
        ` : `<p style="margin-top:16px; color:#4ade80; font-size:13px;">✓ Resolved${r.resolution ? ` — ${escHtml(r.resolution)}` : ''}</p>`}
      `;
      const resolveBtn = modalContent.querySelector('#resolve-btn');
      if (resolveBtn) {
        resolveBtn.addEventListener('click', async () => {
          resolveBtn.disabled = true;
          resolveBtn.textContent = 'Saving…';
          const note = (modalContent.querySelector('#resolution-note') || {}).value || '';
          try {
            const patch = { status: 'resolved', resolvedAt: serverTimestamp() };
            if (note.trim()) patch.resolution = note.trim().slice(0, 1000);
            await updateDoc(doc(db, 'bugReports', r.id), patch);
            // Update local state
            const idx = allReports.findIndex(x => x.id === r.id);
            if (idx !== -1) Object.assign(allReports[idx], patch, { status: 'resolved' });
            modal.classList.remove('open');
            renderList();
          } catch (e) {
            resolveBtn.disabled = false;
            resolveBtn.textContent = 'Mark Resolved';
            alert('Failed to update: ' + e.message);
          }
        });
      }
      modal.classList.add('open');
    }

    modalClose.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });
    filterSel.addEventListener('change', renderList);

    function escHtml(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

