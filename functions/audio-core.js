// Audiobooks: the pure rules behind the bookAudio stream and the products
// that put a book in a member's library. No Firebase, no I/O, so
// tests/audiobook.test.cjs can pin every rule without an emulator.
//
// An audiobook is a books/{bookId} record with format 'audio' and a list of
// tracks, one per chapter, stored beside it in Storage:
//   books/{bookId}/audio-01.mp3, audio-02.mp3, ...
// Ownership is the same users/{uid}.ownedBookIds the EPUB reader uses, so a
// bundle, a course grant or a product purchase all unlock it the same way.

// One response never carries more than this. An <audio> element asks for
// "bytes=0-" and takes a shorter 206 in stride, asking for the rest as it
// plays. Small slices keep every response fast and far under the 32 MiB
// limit a Cloud Run response with a Content-Length has.
const AUDIO_CHUNK = 4 * 1024 * 1024;

// A listening pass lives this long. The player asks for a fresh one when it
// opens, so a pass only has to outlast one sitting.
const PASS_TTL_MS = 12 * 60 * 60 * 1000;
// Reissue instead of reusing once less than this is left, so a pass handed
// out never runs out mid-chapter.
const PASS_MIN_LEFT_MS = 3 * 60 * 60 * 1000;

const AUDIO_TYPES = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac'
};

const TRACK_PATH_RE = /^books\/([a-z0-9][a-z0-9-]{1,80})\/audio-\d{2,3}\.(mp3|m4a|m4b|aac)$/;

function isAudioBook(book) {
  return !!book && book.format === 'audio';
}

function tracksOf(book) {
  return isAudioBook(book) && Array.isArray(book.tracks) ? book.tracks : [];
}

// The track at `index`, only if its file sits under this book's own folder.
// A record pointing anywhere else in the bucket is refused, so a bad edit can
// never turn the stream into a way to read some other file.
function trackAt(book, bookId, index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0) return null;
  const t = tracksOf(book)[i];
  if (!t || typeof t.path !== 'string') return null;
  const m = TRACK_PATH_RE.exec(t.path);
  if (!m || m[1] !== bookId) return null;
  return { index: i, path: t.path, title: String(t.title || `Chapter ${i + 1}`), contentType: AUDIO_TYPES[m[2]] };
}

// The free chapter anyone may play, signed in or not, while the book is live.
function isSampleTrack(book, index) {
  if (!isAudioBook(book) || book.status === 'hidden') return false;
  const s = book.sampleTrack;
  return Number.isInteger(s) && s >= 0 && s === Number(index) && s < tracksOf(book).length;
}

// Parses a Range header against a file of `size` bytes into the slice to
// send: { start, end } (inclusive), clipped to AUDIO_CHUNK. No header means
// the first slice. `null` means the range can't be met (send 416).
function parseRange(header, size, chunk = AUDIO_CHUNK) {
  if (!(size > 0)) return null;
  let start = 0;
  let end = size - 1;
  if (header) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (m[1] === '') {
      // "bytes=-500": the last 500 bytes.
      const n = Number(m[2]);
      if (!(n > 0)) return null;
      start = Math.max(0, size - n);
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
  }
  if (start >= size || end < start) return null;
  end = Math.min(end, start + chunk - 1);
  return { start, end };
}

// The library books a product unlocks when bought.
function productBooks(product) {
  const list = product && Array.isArray(product.grantsBooks) ? product.grantsBooks : [];
  return [...new Set(list.map(String).filter((id) => /^[a-z0-9][a-z0-9-]{1,80}$/.test(id)))];
}

// A product that only unlocks library books is delivered the moment it is
// paid: nothing ships, so its order is born done.
function isDigitalLibraryProduct(product) {
  if (!productBooks(product).length) return false;
  return product.requiresShipping !== true && product.type !== 'physical';
}

// One pass per member per book, so the collection never grows past one doc
// each. The secret half rotates on reissue.
function passDocId(uid, bookId) {
  return `${uid}_${bookId}`;
}

function passUsable(pass, { bookId, now = Date.now(), minLeftMs = 0 } = {}) {
  if (!pass || pass.bookId !== bookId || typeof pass.token !== 'string') return false;
  const exp = Number(pass.expiresAtMs);
  return Number.isFinite(exp) && exp - minLeftMs > now;
}

// "<docId>.<secret>" from a pass or feed link, only if the doc id belongs to
// this book. Anything else is null.
function splitCredential(raw, bookId) {
  const str = String(raw || '');
  const dot = str.lastIndexOf('.');
  if (dot <= 0 || str.length > 300) return null;
  const docId = str.slice(0, dot);
  const token = str.slice(dot + 1);
  if (!token || !/^[A-Za-z0-9_-]+$/.test(docId) || !docId.endsWith(`_${bookId}`)) return null;
  return { docId, token };
}

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// A private podcast feed: the whole audiobook as one show, one episode per
// chapter, so a buyer can listen in Apple Podcasts, Overcast, Pocket Casts or
// any app that follows a show by URL. `audioUrl(i)` is the signed link to
// track i. The show is marked serial and chapter one gets the earliest date,
// one minute apart, so apps list it first, in book order. Dates come from the
// edition (book.version) so they hold still between refreshes.
function editionMs(book) {
  const v = Number(book && book.version);
  return v > 1e12 ? v : Date.UTC(2026, 0, 1);
}

function feedXml({ book, bookId, link, audioUrl, publishedMs = editionMs(book) }) {
  const tracks = tracksOf(book);
  const title = book.title || bookId;
  const author = book.author || 'Anthony Brown Sr.';
  const summary = book.description
    || `Your private audiobook feed for ${title}. This link is yours alone; please do not share it.`;
  const items = tracks.map((t, i) => {
    const pub = new Date(publishedMs + i * 60000).toUTCString();
    const ext = (/\.(mp3|m4a|m4b|aac)$/.exec(String(t.path || '')) || [])[1] || 'mp3';
    const dur = Number(t.duration) > 0 ? Math.round(Number(t.duration)) : null;
    return `
    <item>
      <title>${xmlEscape(t.title || `Chapter ${i + 1}`)}</title>
      <guid isPermaLink="false">${xmlEscape(`${bookId}-${i + 1}-${book.version || '1'}`)}</guid>
      <pubDate>${pub}</pubDate>
      <enclosure url="${xmlEscape(audioUrl(i))}" length="${Number(t.size) > 0 ? Math.round(Number(t.size)) : 0}" type="${AUDIO_TYPES[ext]}"/>
      <itunes:episode>${i + 1}</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>${dur ? `
      <itunes:duration>${dur}</itunes:duration>` : ''}
    </item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${xmlEscape(title)}</title>
    <link>${xmlEscape(link)}</link>
    <description>${xmlEscape(summary)}</description>
    <language>en-us</language>
    <itunes:author>${xmlEscape(author)}</itunes:author>
    <itunes:type>serial</itunes:type>
    <itunes:block>Yes</itunes:block>
    <itunes:explicit>false</itunes:explicit>${book.coverUrl ? `
    <itunes:image href="${xmlEscape(book.coverUrl)}"/>
    <image><url>${xmlEscape(book.coverUrl)}</url><title>${xmlEscape(title)}</title><link>${xmlEscape(link)}</link></image>` : ''}${items}
  </channel>
</rss>
`;
}

module.exports = {
  AUDIO_CHUNK,
  PASS_TTL_MS,
  PASS_MIN_LEFT_MS,
  AUDIO_TYPES,
  isAudioBook,
  tracksOf,
  trackAt,
  isSampleTrack,
  parseRange,
  productBooks,
  isDigitalLibraryProduct,
  passDocId,
  passUsable,
  splitCredential,
  xmlEscape,
  feedXml
};
