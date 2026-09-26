// Prev / Next on the contact card: the neighbour lookup and the per-company
// order stored by the CRM board. Pure module, no emulator.
import assert from 'node:assert/strict';

// crm-nav.js reads sessionStorage; give Node a minimal one.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
const { neighbours, rememberContactOrder, storedContactOrder } =
  await import('../public/js/crm-nav.js');

let passed = 0;
function ok(name, fn) { fn(); passed += 1; console.log('  ✓ ' + name); }

ok('first contact has no Prev', () => {
  assert.deepEqual(neighbours(['a', 'b', 'c'], 'a'), { position: 1, total: 3, prev: null, next: 'b' });
});
ok('middle contact has both', () => {
  assert.deepEqual(neighbours(['a', 'b', 'c'], 'b'), { position: 2, total: 3, prev: 'a', next: 'c' });
});
ok('last contact has no Next', () => {
  assert.deepEqual(neighbours(['a', 'b', 'c'], 'c'), { position: 3, total: 3, prev: 'b', next: null });
});
ok('a contact outside the list, or no list, gives null', () => {
  assert.equal(neighbours(['a', 'b'], 'z'), null);
  assert.equal(neighbours(null, 'a'), null);
});
ok('the stored order is scoped to its company', () => {
  rememberContactOrder('co1', ['x', 'y']);
  assert.deepEqual(storedContactOrder('co1'), ['x', 'y']);
  assert.equal(storedContactOrder('co2'), null);
});
ok('unreadable storage reads as no order', () => {
  sessionStorage.setItem('1p_crm_contact_order', '{not json');
  assert.equal(storedContactOrder('co1'), null);
});

console.log(`\n${passed} passed`);
