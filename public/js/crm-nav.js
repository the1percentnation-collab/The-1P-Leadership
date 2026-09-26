// Prev / Next through contacts, in the order the CRM last showed them.
//
// The contacts board is where the order is decided (filters, sort column,
// kanban stage), so it records the exact list it drew. The contact page reads
// that list back to find its neighbours: working down a filtered, sorted list
// one card at a time is the whole point, and a Next that jumped to some other
// order would be worse than none.
//
// sessionStorage, not localStorage: the list belongs to this tab's session of
// working a list. A second tab working a different filter keeps its own.

const KEY = '1p_crm_contact_order';

/** Remember the order of contact ids the CRM board is currently showing. */
export function rememberContactOrder(companyId, ids) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ companyId, ids: ids.slice(0, 5000) }));
  } catch (e) { /* private mode or full; the contact page falls back */ }
}

/** The stored order for this company, or null when there is none. */
export function storedContactOrder(companyId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved && saved.companyId === companyId && Array.isArray(saved.ids)) return saved.ids;
  } catch (e) { /* unreadable: treat as absent */ }
  return null;
}

/**
 * Where `id` sits in `ids`: its 1-based position, the total, and the ids
 * either side (null at the ends). Null when the id is not in the list.
 */
export function neighbours(ids, id) {
  const i = ids ? ids.indexOf(id) : -1;
  if (i === -1) return null;
  return {
    position: i + 1,
    total: ids.length,
    prev: i > 0 ? ids[i - 1] : null,
    next: i < ids.length - 1 ? ids[i + 1] : null
  };
}
