// Speaking Engagement Agreement on One Percent letterhead.
//
// Renders a snapshot (agreement-terms.js buildSnapshot, or the copy the
// server stored when the agreement was sent) as the document clients read,
// sign, and save as a PDF. Pure: returns an HTML string, every value escaped.
// Styles live in /assets/agreement.css under .ag-doc.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function fmtStamp(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
}

function rows(list) {
  return list.map(({ k, v }) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v) || '<span class="ag-blank">&nbsp;</span>'}</td></tr>`).join('');
}

function signatureBlock({ party, sig, name, title, pending }) {
  return `<div class="ag-sig">
    <div class="ag-sig-party">${esc(party)}</div>
    <div class="ag-sig-line">${sig ? `<span class="ag-sig-script">${esc(sig.name)}</span>` : `<span class="ag-sig-pending">${esc(pending)}</span>`}</div>
    <dl class="ag-sig-meta">
      <div><dt>Name</dt><dd>${esc(sig ? sig.name : name)}</dd></div>
      <div><dt>Title</dt><dd>${esc(sig ? sig.title : title)}</dd></div>
      <div><dt>Date</dt><dd>${sig ? esc(fmtStamp(sig.signedAt)) : ''}</dd></div>
    </dl>
    ${sig ? '<div class="ag-sig-e">Signed electronically</div>' : ''}
  </div>`;
}

/**
 * snap        the snapshot
 * provider    { name, title, signedAt } once the owner has sent it
 * client      { name, title, email, signedAt, ip } once the client has signed
 * audit       { sentAt, viewedAt, signedAt, hash } for the certificate
 * draft       true in the owner's preview, before anything is sent
 */
export function renderAgreement(snap, { provider = null, client = null, audit = null, draft = false } = {}) {
  const p = snap.provider;
  const no = snap.agreementNo || 'Draft';
  const sections = snap.sections.map((s) => `<section class="ag-section">
      <h2><span class="ag-sn">${esc(s.n)}.</span>${esc(s.title)}</h2>
      <ol class="ag-clauses">${s.clauses.map((c) => `<li><span class="ag-cn">${esc(c.n)}</span><p>${esc(c.text)}</p></li>`).join('')}</ol>
    </section>`).join('');
  const sch = snap.schedule;
  const certificate = audit && client ? `<section class="ag-cert">
      <h2>Certificate of Completion</h2>
      <p class="ag-cert-lead">This record is part of the executed Agreement.</p>
      <table class="ag-table ag-cert-table"><tbody>
        ${rows([
          { k: 'Agreement', v: `${no}, terms version ${snap.termsVersion}` },
          { k: 'Sent for signature', v: fmtStamp(audit.sentAt) },
          { k: `Signed for ${p.legalName}`, v: `${provider ? provider.name : p.speaker}, ${fmtStamp(provider && provider.signedAt)}` },
          { k: 'First opened by client', v: fmtStamp(audit.viewedAt) },
          { k: `Signed for ${snap.client.legalName}`, v: `${client.name}, ${client.title}, ${fmtStamp(client.signedAt)}` },
          { k: 'Client signer email', v: client.email },
          { k: 'Client signer IP address', v: client.ip || 'Not recorded' },
          { k: 'Document fingerprint (SHA-256)', v: audit.hash }
        ])}
      </tbody></table>
      <p class="ag-cert-note">The fingerprint identifies the exact text both parties signed. Any change to the Agreement would produce a different fingerprint.</p>
    </section>` : '';

  return `<article class="ag-doc${draft ? ' is-draft' : ''}">
  <header class="ag-letterhead">
    <div class="ag-brand">
      <img class="ag-mark" src="/assets/favicon.jpg" alt="">
      <div class="ag-word"><span class="ag-word-1">The One Percent</span><span class="ag-word-2">Nation</span></div>
    </div>
    <div class="ag-contact">
      <div>${esc(p.web)}</div>
      <div>${esc(p.email)}</div>
    </div>
  </header>
  <div class="ag-rule" aria-hidden="true"><span></span></div>

  <div class="ag-titleblock">
    <div class="ag-kicker"><span>Agreement No. ${esc(no)}</span><span>Terms version ${esc(snap.termsVersion)}</span></div>
    <h1>Speaking Engagement Agreement</h1>
    <p class="ag-preamble">This Speaking Engagement Agreement (the "Agreement") is made between ${esc(p.legalName)} and ${esc(snap.client.legalName || '[Client]')}, effective on the date of the last signature below.</p>
  </div>

  ${sections}

  <section class="ag-schedule">
    <h2><span class="ag-sn">A.</span>Schedule A: Engagement Details</h2>
    <div class="ag-sched-grid">
      <table class="ag-table"><caption>Client</caption><tbody>${rows(sch.client)}</tbody></table>
      <table class="ag-table"><caption>Event</caption><tbody>${rows(sch.event)}</tbody></table>
    </div>
    <table class="ag-table ag-fees"><caption>Fees</caption><tbody>
      ${rows(sch.fees)}
      ${sch.totals.map(({ k, v }, i) => `<tr class="${i === 0 ? 'ag-total' : 'ag-sub'}"><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
    </tbody></table>
    <div class="ag-special"><div class="ag-special-k">Special terms</div><p>${esc(sch.specialTerms)}</p></div>
  </section>

  <section class="ag-execution">
    <h2>Signatures</h2>
    <p class="ag-exec-lead">Each person signing below confirms they are authorized to sign for the party named, and agrees to sign electronically.</p>
    <div class="ag-sig-grid">
      ${signatureBlock({ party: p.legalName, sig: provider, name: p.speaker, title: p.signerTitle, pending: draft ? 'Signed when sent' : 'Awaiting signature' })}
      ${signatureBlock({ party: snap.client.legalName || '[Client]', sig: client, name: snap.client.signerName, title: snap.client.signerTitle, pending: 'Awaiting signature' })}
    </div>
  </section>

  ${certificate}

  <footer class="ag-foot"><span>${esc(p.legalName)}</span><span>Speaking Engagement Agreement · ${esc(no)}</span></footer>
</article>`;
}
