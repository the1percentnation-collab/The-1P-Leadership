// GENERATED COPY of public/js/agreement-terms.js for the Cloud Functions
// runtime (Node 20 cannot require an ES module). Do not edit by hand: edit the
// browser module, then regenerate with
//   node scripts/build-agreement-server.cjs
// tests/agreement.test.mjs fails if the two drift apart.

// Speaking Engagement Agreement: the terms, the fees, and the snapshot that
// gets signed.
//
// Pure: no imports, no DOM. The owner's builder (agreements.js) and the
// signing page render from it, and the server (functions/agreement-terms.js,
// a generated CommonJS copy) builds the exact snapshot a client signs and
// hashes it. One source:
//   node scripts/build-agreement-server.cjs
// tests/agreement.test.mjs fails if the copies drift.
//
// The terms are versioned. Changing any clause means bumping TERMS_VERSION,
// so a signed agreement always records which wording it was signed under.
// Agreements already sent keep the wording in their own snapshot.

const TERMS_VERSION = '2026-10-16.2';

// Update the legal name and address here once the entity details are final.
const PROVIDER = {
  legalName: 'The 1P Nation',
  shortName: 'The One Percent',
  speaker: 'Anthony Brown Sr.',
  signerTitle: 'Founder',
  email: 'anthonybrown@the1pnation.com',
  web: 'the1pnation.com'
};

// Starting fees from the current rate card. The builder fills these in and
// the owner can adjust any engagement.
const FORMATS = [
  { key: 'keynote', label: 'Keynote', fee: 3500, virtualDiscount: true },
  { key: 'headline-keynote', label: 'Conference Headline Keynote', fee: 5000, virtualDiscount: true },
  { key: 'workshop', label: 'Workshop or Breakout', fee: 6500, virtualDiscount: true },
  { key: 'retreat-2', label: 'Retreat (two days)', fee: 22000, virtualDiscount: false },
  { key: 'retreat-3', label: 'Retreat (three days)', fee: 30000, virtualDiscount: false }
];

const RATES = {
  travel: 1500,
  workbook: 95,
  recording: 2500,
  virtualDiscount: 0.2,
  deposit: 0.5
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const longStr = (v, max) => String(v == null ? '' : v).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
const money = (v) => {
  const n = Math.round(Number(v) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n <= 1000000 ? n : 0;
};

/** A complete agreement draft with every field present. */
function normalizeAgreement(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = r.client && typeof r.client === 'object' ? r.client : {};
  const e = r.event && typeof r.event === 'object' ? r.event : {};
  const f = r.fees && typeof r.fees === 'object' ? r.fees : {};
  const format = FORMATS.some((x) => x.key === e.format) ? e.format : FORMATS[0].key;
  const workbooks = Math.max(0, Math.min(5000, Math.round(Number(f.workbooks) || 0)));
  return {
    agreementNo: str(r.agreementNo, 24),
    contactId: str(r.contactId, 128) || null,
    client: {
      legalName: str(c.legalName, 140),
      address: str(c.address, 200),
      signerName: str(c.signerName, 100),
      signerTitle: str(c.signerTitle, 100),
      signerEmail: str(c.signerEmail, 160).toLowerCase()
    },
    event: {
      name: str(e.name, 140),
      date: DATE_RE.test(String(e.date || '')) ? e.date : '',
      startTime: str(e.startTime, 40),
      location: str(e.location, 200),
      virtual: e.virtual === true,
      audience: str(e.audience, 160),
      format,
      module: str(e.module, 140),
      planningCall: DATE_RE.test(String(e.planningCall || '')) ? e.planningCall : ''
    },
    fees: {
      session: f.session === undefined || f.session === null || f.session === ''
        ? FORMATS.find((x) => x.key === format).fee
        : money(f.session),
      travel: f.travel === true,
      workbooks,
      recording: f.recording === true
    },
    specialTerms: longStr(r.specialTerms, 1200)
  };
}

/** Fee lines, total, deposit and balance, in dollars. */
function computeFees(input) {
  const a = normalizeAgreement(input);
  const fmt = FORMATS.find((x) => x.key === a.event.format);
  const lines = [{ key: 'session', label: `Session fee: ${fmt.label}`, amount: a.fees.session }];
  if (a.event.virtual && fmt.virtualDiscount) {
    lines.push({ key: 'virtual', label: 'Virtual delivery adjustment (20 percent)', amount: -round2(a.fees.session * RATES.virtualDiscount) });
  }
  if (a.fees.travel) lines.push({ key: 'travel', label: 'Travel fee (flat)', amount: RATES.travel });
  if (a.fees.workbooks > 0) {
    lines.push({ key: 'workbooks', label: `Participant workbooks (${a.fees.workbooks} at $${RATES.workbook})`, amount: a.fees.workbooks * RATES.workbook });
  }
  if (a.fees.recording) lines.push({ key: 'recording', label: 'Recording license (Section 6.4)', amount: RATES.recording });
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const deposit = round2(total * RATES.deposit);
  return { lines, total, deposit, balance: round2(total - deposit), sessionFee: round2(a.fees.session + (lines.find((l) => l.key === 'virtual') || { amount: 0 }).amount) };
}

function round2(n) { return Math.round(n * 100) / 100; }

function fmtMoney(n) {
  const v = round2(Number(n) || 0);
  const neg = v < 0;
  const abs = Math.abs(v);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: abs % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${neg ? '-' : ''}$${s}`;
}

function fmtDate(iso) {
  if (!DATE_RE.test(String(iso || ''))) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/** What still has to be filled in before the agreement can be sent. */
function missingForSend(input) {
  const a = normalizeAgreement(input);
  const out = [];
  if (!a.client.legalName) out.push('Client legal name');
  if (!a.client.address) out.push('Client address');
  if (!a.client.signerName) out.push('Client signer name');
  if (!a.client.signerTitle) out.push('Client signer title');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.client.signerEmail)) out.push('Client signer email');
  if (!a.event.name) out.push('Event name');
  if (!a.event.date) out.push('Event date');
  if (!a.event.virtual && !a.event.location) out.push('Event location');
  if (!(a.fees.session > 0)) out.push('Session fee');
  return out;
}

/**
 * The clauses, with the parties' names filled in. Numbered sections, each a
 * list of numbered clauses of plain text. The renderer adds the styling.
 */
function buildSections(input) {
  const a = normalizeAgreement(input);
  const P = PROVIDER.shortName;
  const client = a.client.legalName || '[Client]';
  return [
    { n: '1', title: 'The Engagement', clauses: [
      `${PROVIDER.legalName} ("${P}") will provide the speaking services described in Schedule A (the "Engagement") to ${client} ("Client") through its founder, ${PROVIDER.speaker} (the "Speaker").`,
      'Schedule A forms part of this Agreement. If Schedule A conflicts with these terms, these terms control unless Schedule A expressly states otherwise.'
    ] },
    { n: '2', title: 'Scope of Services', clauses: [
      'The Speaker will deliver the format and content module stated in Schedule A, in person unless Schedule A states virtual delivery.',
      'The Engagement includes one planning call with Client, held at least twenty-one (21) days before the event, to confirm the audience, the intended outcome, the session length, and the run of show. The session length agreed on that call will be confirmed in writing.',
      'The content will be tailored to Client\'s field and to the priorities identified on the planning call.',
      'Additional sessions, coaching, custom content development, participant workbooks, and recording rights are not included unless listed in Schedule A. A second session on the same day at the same venue is billed at fifty percent (50%) of the lower session fee.'
    ] },
    { n: '3', title: 'Fees and Payment', clauses: [
      'Client will pay the fees stated in Schedule A.',
      `A deposit of fifty percent (50%) of the total is due on signature. The event date is reserved only when ${P} has received both this signed Agreement and the deposit.`,
      'The balance is due on or before the event date.',
      'Amounts not paid within fifteen (15) days of their due date accrue interest at one and one-half percent (1.5%) per month, or the maximum rate permitted by law if lower. Client will pay the reasonable costs of collection, including attorney fees.',
      'Fees exclude applicable sales, use, and withholding taxes, which are Client\'s responsibility.'
    ] },
    { n: '4', title: 'Travel', clauses: [
      'For engagements within the United States and outside the Oklahoma City metropolitan area, Client will pay the flat travel fee stated in Schedule A. The fee covers airfare, lodging, ground transportation, and meals. International travel is quoted separately.'
    ] },
    { n: '5', title: 'Cancellation and Rescheduling', clauses: [
      `Client may cancel or postpone the Engagement by written notice, effective on receipt by ${P}.`,
      'If notice is received more than sixty (60) days before the event date, the deposit will be applied to a new date held within twelve (12) months of the original date. A deposit not applied within that period is forfeited.',
      'If notice is received sixty (60) days or fewer before the event date, the deposit is non-refundable. A new date may be reserved at the rates then in effect.',
      'If notice is received fourteen (14) days or fewer before the event date, the full fee is due, together with any non-refundable travel costs already incurred.',
      `The parties agree that reserving the event date requires ${P} to decline other engagements, that the resulting loss is difficult to determine, and that the amounts in this Section are a reasonable estimate of that loss and not a penalty.`,
      `If the Speaker is unable to appear because of illness, injury, or family emergency, ${P} will offer a new date at no additional cost. If Client declines the new date, ${P} will refund all amounts paid, which is Client's sole remedy.`,
      `Neither party is liable for a failure to perform caused by events beyond its reasonable control, including severe weather, natural disaster, epidemic, government order, or disruption of travel. The parties will reschedule within twelve (12) months or, by mutual agreement, convert the Engagement to virtual delivery. If neither is possible, ${P} will refund the amounts paid, less non-refundable expenses already incurred.`
    ] },
    { n: '6', title: 'Recording, Media, and Intellectual Property', clauses: [
      `The presentation, slides, frameworks (including the A.L.I.G.N. framework), modules, workbooks, and all other materials are and remain the exclusive property of ${P}. Nothing in this Agreement is a work made for hire, and Client acquires no rights in these materials except as stated in Section 6.4.`,
      `No person may record, photograph for commercial use, livestream, broadcast, or transcribe the Engagement without the prior written consent of ${P}. This applies to Client, its employees and contractors, its audio-visual providers, and the venue.`,
      `"Recordings" means all audio, video, photographs, livestreams, transcripts, and other captures of the Engagement in any medium, whether or not made with consent. ${P} owns all Recordings. Client hereby assigns to ${P} all right, title, and interest, including copyright, in every Recording made by Client or by anyone acting on its behalf. Client will (a) obtain a written assignment on the same terms from any vendor or venue that records the Engagement, before the event; (b) deliver all unedited Recordings to ${P} within fourteen (14) days after the event; (c) retain no copies except as licensed under Section 6.4; and (d) sign any further document ${P} reasonably requests to confirm this ownership.`,
      `If Schedule A includes a recording license, ${P} grants Client a non-exclusive, non-transferable license to show the Recording internally to Client's own employees for twelve (12) months after the event. Client may not publish, sell, or distribute the Recording, edit it beyond trimming its beginning and end, or use it to train any artificial intelligence system. The license ends immediately on non-payment or on breach of this Section.`,
      'Attendees may take personal photographs and clips of less than sixty (60) seconds for non-commercial social media use. Recording all or a substantial part of the Engagement is not permitted. Client will announce this policy before the session begins.',
      `Client will remove any Recording published without consent within forty-eight (48) hours of notice and will assist ${P} in removing copies published elsewhere. Because the harm caused by an unlicensed Recording is difficult to determine, Client will pay a license fee equal to two (2) times the session fee for any Recording used without consent, in addition to ${P}'s right to seek injunctive relief.`,
      `Client will post notice at the venue, and include notice in event registration, that the Engagement may be photographed and recorded. ${P} will obtain a signed release from any attendee it features prominently in its own marketing.`
    ] },
    { n: '7', title: 'Client Responsibilities', clauses: [
      `Client will provide, at no cost to ${P}: a point of contact with decision-making authority, available during the event; a wireless lavalier or headset microphone; a projector or screen with HDMI input; a confidence monitor where the room allows; a presentation remote; a technician for a sound check at least sixty (60) minutes before the session; a private room or quiet space with water; and a table near the exit for books and resources, the proceeds of which ${P} retains.`,
      'Client will begin the session at the scheduled time. If Client\'s program runs late, the Speaker may shorten the session to end at the scheduled time, and the full fee remains due.',
      `Client will have the Speaker introduced using the introduction ${P} provides.`,
      `Client may use the Speaker's name, approved photograph, and approved biography to promote the event. Any other material that names the Speaker or ${P} requires prior approval. ${P} may identify Client as a client and use any testimonial Client approves.`,
      'The Speaker may share one resource with the audience at the close of the session so that attendees can continue the work.'
    ] },
    { n: '8', title: 'Relationship, Liability, and Confidentiality', clauses: [
      `${P} and the Speaker are independent contractors and not employees or agents of Client. ${P} is responsible for its own taxes.`,
      `Neither party is liable for indirect, incidental, special, or consequential damages, including lost profits. ${P}'s total liability under this Agreement will not exceed the fees paid by Client.`,
      `Each party will defend and indemnify the other against third-party claims arising from its own negligence or willful misconduct. ${P} will also do so for claims that its materials infringe the rights of others, and Client will also do so for claims arising from the venue, the attendees, or any Recording made by Client or its vendors.`,
      'Client is responsible for the safety of the venue and will maintain general liability insurance for the event.',
      'Each party will keep the other\'s non-public business information confidential and use it only for the Engagement.',
      `${P} will deliver the services described in this Agreement. It does not guarantee any particular business result.`,
      'In any dispute arising under this Agreement, the prevailing party may recover its reasonable attorney fees and costs.'
    ] },
    { n: '9', title: 'General Terms', clauses: [
      'This Agreement is governed by the laws of the State of Oklahoma. The parties consent to the exclusive jurisdiction of the state and federal courts located in Oklahoma County, Oklahoma.',
      'This Agreement, including Schedule A, is the entire agreement of the parties and supersedes all prior proposals and discussions. It may be amended only in a writing signed by both parties, except that a new event date under Section 5 may be confirmed by email.',
      `Client may not assign this Agreement without the written consent of ${P}. If any provision is held unenforceable, the remainder continues in effect. Sections 3, 6, and 8 survive the end of this Agreement.`,
      `The parties agree to conduct this transaction by electronic means. Each party's electronic signature is intended to authenticate this Agreement and has the same force and effect as a handwritten signature under the Oklahoma Uniform Electronic Transactions Act and the federal Electronic Signatures in Global and National Commerce Act. ${P} will provide each party with an electronic copy of the executed Agreement.`
    ] }
  ].map((s) => ({ n: s.n, title: s.title, clauses: s.clauses.map((text, i) => ({ n: `${s.n}.${i + 1}`, text })) }));
}

/**
 * Schedule A as { k, v } rows, from the agreement's own fields. Rows are
 * objects, not [label, value] pairs, because Firestore cannot store an array
 * inside an array and the server stores this in the snapshot.
 */
function buildSchedule(input) {
  const a = normalizeAgreement(input);
  const fmt = FORMATS.find((x) => x.key === a.event.format);
  const fees = computeFees(a);
  return {
    client: [
      { k: 'Client', v: a.client.legalName },
      { k: 'Address', v: a.client.address },
      { k: 'Authorized signer', v: [a.client.signerName, a.client.signerTitle].filter(Boolean).join(', ') },
      { k: 'Signer email', v: a.client.signerEmail }
    ],
    event: [
      { k: 'Event', v: a.event.name },
      { k: 'Date', v: fmtDate(a.event.date) },
      { k: 'Start time', v: a.event.startTime || 'Confirmed on the planning call' },
      { k: 'Location', v: a.event.virtual ? 'Virtual delivery' : a.event.location },
      { k: 'Audience', v: a.event.audience || 'Confirmed on the planning call' },
      { k: 'Format', v: fmt.label },
      { k: 'Content module', v: a.event.module || 'Selected on the planning call' },
      { k: 'Planning call', v: a.event.planningCall ? fmtDate(a.event.planningCall) : 'To be scheduled' }
    ],
    fees: fees.lines.map((l) => ({ k: l.label, v: fmtMoney(l.amount) })),
    totals: [
      { k: 'Total', v: fmtMoney(fees.total) },
      { k: 'Deposit due on signature (50 percent)', v: fmtMoney(fees.deposit) },
      { k: 'Balance due on or before the event date', v: fmtMoney(fees.balance) }
    ],
    specialTerms: a.specialTerms || 'None.'
  };
}

/**
 * The exact content a client signs: parties, terms, and Schedule A, resolved
 * to plain values. The server stores this when the agreement is sent and
 * hashes it, and the signing page renders from it alone, so later edits to
 * the template never change an agreement already sent.
 */
function buildSnapshot(input) {
  const a = normalizeAgreement(input);
  return {
    termsVersion: TERMS_VERSION,
    agreementNo: a.agreementNo,
    provider: { legalName: PROVIDER.legalName, speaker: PROVIDER.speaker, signerTitle: PROVIDER.signerTitle, email: PROVIDER.email, web: PROVIDER.web },
    client: { legalName: a.client.legalName, signerName: a.client.signerName, signerTitle: a.client.signerTitle, signerEmail: a.client.signerEmail },
    eventDate: a.event.date,
    sections: buildSections(a),
    schedule: buildSchedule(a)
  };
}

/** JSON with sorted keys, so the same snapshot always hashes the same. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

module.exports = { TERMS_VERSION, PROVIDER, FORMATS, RATES, normalizeAgreement, computeFees, fmtMoney, fmtDate, missingForSend, buildSections, buildSchedule, buildSnapshot, canonicalJson };
