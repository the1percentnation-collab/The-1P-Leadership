// The audiobook: the stream's rules (functions/audio-core.js) and the
// player's (public/js/listen-core.js).
//
// What has to hold: a chapter streams in slices an <audio> element can seek
// through; a track record can never point the stream at another file; only
// the chosen sample chapter plays without a pass; a product that unlocks a
// book is delivered digitally; the private feed lists chapters in order with
// their signed links; and the player resumes where the listener stopped.
//
// Run: node tests/audiobook.test.cjs
const assert = require('assert');
const path = require('path');
const audio = require(path.join(__dirname, '..', 'functions', 'audio-core.js'));

let passed = 0;
const pending = [];
function ok(name, run) {
  const go = async () => {
    try { await run(); passed++; console.log('  ✓ ' + name); }
    catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
  };
  pending.push(go);
}

const BOOK = {
  format: 'audio',
  status: 'live',
  title: 'I Can\'t',
  author: 'Anthony Brown Sr.',
  version: String(Date.UTC(2026, 9, 1)),
  sampleTrack: 0,
  tracks: [
    { title: 'Introduction', path: 'books/i-cant-audio/audio-01.mp3', duration: 300, size: 4800000 },
    { title: 'Chapter One', path: 'books/i-cant-audio/audio-02.mp3', duration: 1200, size: 19200000 },
    { title: 'Chapter Two', path: 'books/i-cant-audio/audio-03.m4a', duration: 900, size: 14400000 }
  ]
};

console.log('audiobook — the stream');

ok('no Range header sends the first slice', () => {
  assert.deepStrictEqual(audio.parseRange(undefined, 10_000_000), { start: 0, end: audio.AUDIO_CHUNK - 1 });
});

ok('an open range is capped to one slice', () => {
  assert.deepStrictEqual(audio.parseRange('bytes=0-', 10_000_000), { start: 0, end: audio.AUDIO_CHUNK - 1 });
  assert.deepStrictEqual(audio.parseRange('bytes=9000000-', 10_000_000), { start: 9000000, end: 9999999 });
});

ok('a closed range is honored, clipped to the file', () => {
  assert.deepStrictEqual(audio.parseRange('bytes=0-1', 100), { start: 0, end: 1 });
  assert.deepStrictEqual(audio.parseRange('bytes=50-500', 100), { start: 50, end: 99 });
});

ok('a suffix range returns the tail', () => {
  assert.deepStrictEqual(audio.parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepStrictEqual(audio.parseRange('bytes=-1000', 100), { start: 0, end: 99 });
});

ok('an unsatisfiable or malformed range is refused', () => {
  assert.strictEqual(audio.parseRange('bytes=100-', 100), null);
  assert.strictEqual(audio.parseRange('bytes=50-10', 100), null);
  assert.strictEqual(audio.parseRange('bytes=-', 100), null);
  assert.strictEqual(audio.parseRange('items=0-5', 100), null);
  assert.strictEqual(audio.parseRange('bytes=0-5,10-20', 100), null);
  assert.strictEqual(audio.parseRange('bytes=0-', 0), null);
});

ok('a track resolves only inside its own book\'s folder', () => {
  assert.strictEqual(audio.trackAt(BOOK, 'i-cant-audio', 1).path, 'books/i-cant-audio/audio-02.mp3');
  assert.strictEqual(audio.trackAt(BOOK, 'i-cant-audio', '2').contentType, 'audio/mp4');
  assert.strictEqual(audio.trackAt(BOOK, 'other-book', 0), null);
  const evil = { ...BOOK, tracks: [{ path: 'books/i-cant/book.epub' }, { path: 'books/i-cant-audio/../i-cant/book.epub' }, { path: 'users/x/audio-01.mp3' }] };
  for (let i = 0; i < 3; i++) assert.strictEqual(audio.trackAt(evil, 'i-cant-audio', i), null, `track ${i}`);
});

ok('a bad track index is refused', () => {
  for (const i of [-1, 3, 1.5, 'x', undefined]) assert.strictEqual(audio.trackAt(BOOK, 'i-cant-audio', i), null, String(i));
  assert.strictEqual(audio.trackAt({ ...BOOK, format: 'epub' }, 'i-cant-audio', 0), null);
});

ok('only the chosen sample chapter plays free, and only while live', () => {
  assert.strictEqual(audio.isSampleTrack(BOOK, 0), true);
  assert.strictEqual(audio.isSampleTrack(BOOK, '0'), true);
  assert.strictEqual(audio.isSampleTrack(BOOK, 1), false);
  assert.strictEqual(audio.isSampleTrack({ ...BOOK, status: 'hidden' }, 0), false);
  assert.strictEqual(audio.isSampleTrack({ ...BOOK, sampleTrack: null }, 0), false);
  assert.strictEqual(audio.isSampleTrack({ ...BOOK, sampleTrack: 9 }, 9), false);
});

console.log('audiobook — passes and feed links');

ok('a credential splits into its doc and secret, for this book only', () => {
  assert.deepStrictEqual(audio.splitCredential('uid123_i-cant-audio.abc123', 'i-cant-audio'), { docId: 'uid123_i-cant-audio', token: 'abc123' });
  assert.strictEqual(audio.splitCredential('uid123_other.abc', 'i-cant-audio'), null);
  assert.strictEqual(audio.splitCredential('uid123_i-cant-audio.', 'i-cant-audio'), null);
  assert.strictEqual(audio.splitCredential('noDot', 'i-cant-audio'), null);
  assert.strictEqual(audio.splitCredential('../x_i-cant-audio.abc', 'i-cant-audio'), null);
  assert.strictEqual(audio.splitCredential('', 'i-cant-audio'), null);
});

ok('a pass is usable for its own book until it expires', () => {
  const now = 1_000_000;
  const pass = { bookId: 'b1', token: 't', expiresAtMs: now + 1000 };
  assert.strictEqual(audio.passUsable(pass, { bookId: 'b1', now }), true);
  assert.strictEqual(audio.passUsable(pass, { bookId: 'b2', now }), false);
  assert.strictEqual(audio.passUsable(pass, { bookId: 'b1', now: now + 1000 }), false);
  assert.strictEqual(audio.passUsable(pass, { bookId: 'b1', now, minLeftMs: 5000 }), false);
  assert.strictEqual(audio.passUsable(null, { bookId: 'b1', now }), false);
});

ok('the feed lists every chapter, in book order, with its signed link', () => {
  const xml = audio.feedXml({
    book: BOOK, bookId: 'i-cant-audio', link: 'https://the1pnation.com/listen?book=i-cant-audio',
    audioUrl: (i) => `https://fn/bookAudio?book=i-cant-audio&track=${i}&feed=a_b.c`
  });
  const titles = [...xml.matchAll(/<item>\s*<title>([^<]*)<\/title>/g)].map((m) => m[1]);
  assert.deepStrictEqual(titles, ['Introduction', 'Chapter One', 'Chapter Two']);
  assert.ok(xml.includes('url="https://fn/bookAudio?book=i-cant-audio&amp;track=1&amp;feed=a_b.c"'), 'enclosure is escaped');
  assert.ok(xml.includes('length="19200000" type="audio/mpeg"'));
  assert.ok(xml.includes('type="audio/mp4"'), 'm4a chapter typed as mp4');
  assert.ok(xml.includes('<itunes:type>serial</itunes:type>'));
  assert.ok(xml.includes('<itunes:block>Yes</itunes:block>'), 'kept out of public directories');
  const dates = [...xml.matchAll(/<pubDate>([^<]*)<\/pubDate>/g)].map((m) => Date.parse(m[1]));
  assert.ok(dates[0] < dates[1] && dates[1] < dates[2], 'chapter one is the oldest episode');
  assert.strictEqual(audio.feedXml({ book: BOOK, bookId: 'i-cant-audio', link: 'x', audioUrl: () => 'y' }),
    audio.feedXml({ book: BOOK, bookId: 'i-cant-audio', link: 'x', audioUrl: () => 'y' }), 'stable between refreshes');
});

ok('the feed escapes whatever the titles hold', () => {
  const xml = audio.feedXml({
    book: { ...BOOK, title: 'A <b> & "c"', tracks: [{ title: '</title><x>', path: 'books/b/audio-01.mp3' }] },
    bookId: 'b', link: 'https://x', audioUrl: () => 'https://y'
  });
  assert.ok(!xml.includes('<x>') && !xml.includes('<b>'));
  assert.ok(xml.includes('A &lt;b&gt; &amp; &quot;c&quot;'));
});

console.log('audiobook — products');

ok('a product unlocks the books it names, de-duplicated and validated', () => {
  assert.deepStrictEqual(audio.productBooks({ grantsBooks: ['i-cant-audio', 'i-cant-audio', 'Bad Id', ''] }), ['i-cant-audio']);
  assert.deepStrictEqual(audio.productBooks({}), []);
  assert.deepStrictEqual(audio.productBooks(null), []);
});

ok('a library product with nothing to ship is delivered digitally', () => {
  assert.strictEqual(audio.isDigitalLibraryProduct({ type: 'book', grantsBooks: ['i-cant-audio'] }), true);
  assert.strictEqual(audio.isDigitalLibraryProduct({ type: 'book', grantsBooks: ['i-cant-audio'], requiresShipping: true }), false);
  assert.strictEqual(audio.isDigitalLibraryProduct({ type: 'physical', grantsBooks: ['i-cant-audio'] }), false);
  assert.strictEqual(audio.isDigitalLibraryProduct({ type: 'book' }), false);
});

console.log('audiobook — the player');

ok('player rules', async () => {
  const { loadPure } = await import('./_load-pure.mjs');
  const L = await loadPure('listen-core.js');

  assert.strictEqual(L.fmtTime(75), '1:15');
  assert.strictEqual(L.fmtTime(3725), '1:02:05');
  assert.strictEqual(L.fmtTime(NaN), '0:00');

  assert.strictEqual(L.nextSpeed(1), 1.25);
  assert.strictEqual(L.nextSpeed(0.75), 1);
  assert.strictEqual(L.nextSpeed(3), 1, 'an unknown speed restarts the cycle');

  assert.strictEqual(L.totalDuration(BOOK.tracks), 2400);
  assert.strictEqual(L.totalDuration([{ duration: 10 }, {}]), 0);
  assert.strictEqual(L.overallFraction(BOOK.tracks, 1, 600), 900 / 2400);
  assert.strictEqual(L.overallFraction(BOOK.tracks, 2, 99999), 1);
  assert.strictEqual(L.overallFraction([{}, {}, {}, {}], 2, 30), 0.5, 'counts chapters without durations');

  assert.deepStrictEqual(L.resumePoint(BOOK.tracks, null), { track: 0, time: 0 });
  assert.deepStrictEqual(L.resumePoint(BOOK.tracks, { track: 1, time: 600 }), { track: 1, time: 600 });
  assert.deepStrictEqual(L.resumePoint(BOOK.tracks, { track: 1, time: 1195 }), { track: 2, time: 0 }, 'a finished chapter moves on');
  assert.deepStrictEqual(L.resumePoint(BOOK.tracks, { track: 9, time: 50 }), { track: 2, time: 0 }, 'a re-cut book never resumes past its end');

  const links = L.podcastLinks('https://the1pnation.com/api/audio-feed?book=b&feed=x_b.t');
  assert.deepStrictEqual(links.map((l) => l.key), ['apple', 'overcast', 'pocketcasts', 'castro']);
  assert.strictEqual(links[0].href, 'podcast://the1pnation.com/api/audio-feed?book=b&feed=x_b.t');
  assert.strictEqual(links[1].href, 'overcast://x-callback-url/add?url=' + encodeURIComponent('https://the1pnation.com/api/audio-feed?book=b&feed=x_b.t'));
  assert.deepStrictEqual(L.podcastLinks('http://insecure'), []);

  const products = [
    { id: 'a', sellable: true, status: 'live', grantsBooks: ['i-cant-audio'], price: 14.99 },
    { id: 'b', sellable: true, status: 'live', grantsBooks: ['i-cant-audio'], price: 9.99 },
    { id: 'c', sellable: false, status: 'live', grantsBooks: ['i-cant-audio'], price: 1 },
    { id: 'd', sellable: true, status: 'planned', grantsBooks: ['i-cant-audio'], price: 1 },
    { id: 'e', sellable: true, status: 'live', grantsBooks: ['other'], price: 1 },
    { id: 'f', sellable: true, status: 'live', grantsBooks: ['i-cant-audio'], price: 1, externalUrl: 'https://a.co' }
  ];
  assert.strictEqual(L.productForBook(products, 'i-cant-audio').id, 'b');
  assert.strictEqual(L.productForBook(products, 'nothing'), null);
});

(async () => {
  for (const go of pending) await go();
  console.log(`\n${passed} passed${process.exitCode ? ', some failed' : ''}`);
})();
