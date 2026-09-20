// Load a pure browser module from public/js for testing under Node.
//
// public/js sits outside any package.json, so Node would read a .js file
// there as CommonJS and refuse its `export`. The earlier suites sidestepped
// that by importing the source through a data: URL — which works for a
// module with no imports, and fails the moment one says `from './x.js'`,
// because a data: URL has no directory to resolve './x.js' against.
//
// This does the resolution by hand: read the file, replace each relative
// import with the data: URL of THAT file (recursively), and import the
// result. Only relative './' specifiers are rewritten, so a module that
// imports Firebase from a CDN is rejected loudly rather than half-loaded —
// that is what marks a module as not pure.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../public/js/', import.meta.url);
const cache = new Map();

function toDataUrl(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  const file = new URL(relPath, ROOT);
  let src = fs.readFileSync(file, 'utf8');

  src = src.replace(/(from\s+|import\s*\(\s*)(['"])(\.\/[^'"]+)\2/g, (m, lead, q, spec) => {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), spec));
    return `${lead}${q}${toDataUrl(target)}${q}`;
  });

  if (/from\s+['"]https?:\/\//.test(src)) {
    throw new Error(`${relPath} imports from a URL; it is not a pure module and cannot be tested this way`);
  }

  // encodeURIComponent leaves ' ( ) unencoded. The URL is spliced into a
  // single-quoted import specifier in the parent module, so an apostrophe in
  // a comment ("item's") would end the string mid-URL. Encode it explicitly.
  const url = 'data:text/javascript,' + encodeURIComponent(src).replace(/'/g, '%27');
  cache.set(relPath, url);
  return url;
}

/** `await loadPure('catalog-core.js')` → the module's exports. */
export function loadPure(relPath) {
  return import(toDataUrl(relPath));
}
