// A.L.I.G.N. — the 1P Certified Life Coach framework.
//
// Used by the CLC certification UI (clc-certification.js). It used to live in
// icant-course.js, but the I Can't book does not contain the A.L.I.G.N.
// framework, so the I Can't course no longer references it.
//
// Confirmed by Anthony on 2026-09-11. These five are the canonical letters
// and are used verbatim by clc-certification.js, scripts/seed-clc.js and the
// corporate page. The Brand & Company Reference and the Corporate & Speaking
// Offer Framework (section 12) still list them as an open item; update both
// docs to match this file rather than the other way around.

export const ALIGN = {
  A: { label: 'Awareness',  desc: 'Seeing the belief clearly' },
  L: { label: 'Leadership', desc: 'Taking ownership of your story' },
  I: { label: 'Identity',   desc: 'Rewriting who you believe you are' },
  G: { label: 'Growth',     desc: 'Choosing expansion over comfort' },
  N: { label: 'Navigation', desc: 'Executing the path forward' },
};
