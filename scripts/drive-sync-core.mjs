// Drive sync: what goes where, and what needs uploading. Pure, so
// tests/drive-sync.test.mjs can pin it without Google or Firestore.
//
// Everything under social/ in this repo is mirrored into the owner's Google
// Drive, under one root folder, keeping the folder names:
//
//   social/2026-10 Membership Launch/Instagram Stories (1080x1920)/Story 01.png
//   → Drive: Social Media - Ready to Post / 2026-10 Membership Launch /
//            Instagram Stories (1080x1920) / Story 01.png
//
// Two suffixes become native Google files instead of uploads, so a posting
// schedule or a caption sheet can live in the repo as plain text:
//   name.gsheet.csv  → Google Sheet "name"
//   name.gdoc.html   → Google Doc "name"
//
// A file is uploaded once, then updated in place only when its bytes change,
// so the Drive copy keeps its link (and any autoposter pointed at it).

export const ROOT_DIR = 'social';
export const DRIVE_ROOT_NAME = 'Social Media - Ready to Post';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

const CONVERT = [
  { suffix: '.gsheet.csv', googleMime: 'application/vnd.google-apps.spreadsheet', uploadMime: 'text/csv' },
  { suffix: '.gdoc.html', googleMime: 'application/vnd.google-apps.document', uploadMime: 'text/html' }
];

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', mov: 'video/quicktime', pdf: 'application/pdf',
  csv: 'text/csv', txt: 'text/plain', md: 'text/markdown', html: 'text/html', json: 'application/json'
};

/** Files the sync ignores: dotfiles, OS debris, and the folder's own README. */
export function isIgnored(relPath) {
  const segs = String(relPath).split('/');
  if (segs[segs.length - 1].toLowerCase() === 'readme.md') return true;
  return segs.some((seg) => !seg || seg.startsWith('.') || seg === 'Thumbs.db' || seg === 'desktop.ini');
}

/**
 * Where a repo file lands in Drive. relPath is relative to the repo root and
 * must sit under social/.
 * → { folders: [...names under the Drive root], name, uploadMime, googleMime|null }
 */
export function driveTarget(relPath) {
  const parts = String(relPath).split('/');
  if (parts[0] !== ROOT_DIR || parts.length < 2) throw new Error(`not under ${ROOT_DIR}/: ${relPath}`);
  const inner = parts.slice(1);
  const file = inner[inner.length - 1];
  const folders = inner.slice(0, -1);
  const conv = CONVERT.find((c) => file.toLowerCase().endsWith(c.suffix));
  if (conv) {
    return { folders, name: file.slice(0, -conv.suffix.length), uploadMime: conv.uploadMime, googleMime: conv.googleMime };
  }
  const ext = (file.includes('.') ? file.split('.').pop() : '').toLowerCase();
  return { folders, name: file, uploadMime: MIME[ext] || 'application/octet-stream', googleMime: null };
}

/**
 * What to do with each local file, given what was uploaded before.
 * local: [{ path, md5 }]; manifest: { [path]: { md5, fileId } }
 * → [{ path, action: 'create' | 'update' | 'skip', fileId? }]
 */
export function planSync(local, manifest) {
  const seen = manifest || {};
  return local
    .filter((f) => !isIgnored(f.path))
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => {
      const prev = seen[f.path];
      if (!prev || !prev.fileId) return { path: f.path, action: 'create' };
      if (prev.md5 !== f.md5) return { path: f.path, action: 'update', fileId: prev.fileId };
      return { path: f.path, action: 'skip', fileId: prev.fileId };
    });
}

/** Firestore-safe document id for a path (paths contain slashes). */
export function keyFor(path) {
  return Buffer.from(String(path), 'utf8').toString('base64url').slice(0, 1400);
}

/** True when a stored OAuth scope string allows the sync to write Drive files. */
export function hasDriveScope(scopeString) {
  return String(scopeString || '').split(/\s+/).includes('https://www.googleapis.com/auth/drive.file');
}
