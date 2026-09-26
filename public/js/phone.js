// Phone normalization for the CRM, shared by every client write path.
//
// Contacts store phone numbers in E.164 ("+14055550123") because that is the
// only shape the inbound SMS and voice webhooks can match on: Firestore
// equality is exact, and a contact saved as "(405) 555-0123" who texts in
// from +14055550123 used to become a second contact named after the number.
// This mirrors normalizePhone in functions/index.js; keep the two in step.
//
// Pure module, no imports, so tests can load it under Node.

/** Best-effort E.164. Ten bare digits are assumed US (+1). Null when empty. */
export function normalizePhone(p) {
  if (!p) return null;
  let s = String(p).trim().replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s[0] !== '+') {
    const digits = s.replace(/\D/g, '');
    s = digits.length === 10 ? '+1' + digits : '+' + digits;
  }
  return s;
}

/**
 * A number as a rep reads it: "(405) 555-0123" for US, unchanged otherwise.
 * Display only; never store the result.
 */
export function formatPhone(p) {
  const e = normalizePhone(p);
  if (!e) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e;
}
