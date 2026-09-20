// The catalog loader — fetches courses and products and hands them to the
// pure normaliser in catalog-core.js.
//
// Products always come through listVisibleProducts(), on every surface. The
// products read rule admits only visible statuses to anyone who is not an
// admin, so a member could not read a draft or archived product even if we
// asked; asking for "all" would just fail the query.

import { loadCourses, getCourses } from './courses-data.js';
import { listVisibleProducts } from './products.js';
import { normalizeCourse, normalizeProduct } from './catalog-core.js';

export * from './catalog-core.js';

let _promise = null;

/**
 * Every course and every visible product, normalised. Cached for the page;
 * pass { force: true } after an admin write.
 */
export function loadCatalog({ force = false } = {}) {
  if (_promise && !force) return _promise;
  _promise = (async () => {
    const now = Date.now();
    const [, products] = await Promise.all([
      loadCourses({ force }).catch(() => []),
      listVisibleProducts().catch(() => [])
    ]);
    const courses = getCourses({ includeInactive: true })
      .map((c) => normalizeCourse(c, { now }))
      .filter(Boolean);
    const prods = (products || [])
      .map((p) => normalizeProduct(p, { now }))
      .filter(Boolean);
    return [...courses, ...prods];
  })();
  return _promise;
}
