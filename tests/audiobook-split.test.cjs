// Cutting one long audiobook MP3 into chapter tracks
// (scripts/lib/audiobook-split.js, run by scripts/publish-audiobook.js).
//
// What has to hold: every cut lands in the pause between chapters, even when
// the narration pace drifts far from the word-count estimate and the
// chapter pause is only a little longer than the pauses inside a chapter;
// hand-set cuts are checked before they are trusted; Drive links resolve.
//
// Run: node tests/audiobook-split.test.cjs
const assert = require('assert');
const path = require('path');
const S = require(path.join(__dirname, '..', 'scripts', 'lib', 'audiobook-split.js'));
const cfg = require(path.join(__dirname, '..', 'scripts', 'audiobooks', 'i-cant.json'));

let passed = 0;
function ok(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + (e && e.message)); process.exitCode = 1; }
}

// A narration with known chapter starts: pauses of 0.4-0.7s between
// sentences, 1.0s between sections, 1.6s between chapters, and a pace that
// differs by up to 15% from chapter to chapter.
function simulate(words, seed = 3) {
  let x = seed;
  const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
  const silences = [];
  const truth = [];
  let t = 0;
  words.forEach((w, i) => {
    if (i) { silences.push({ start: t, end: t + 1.6, duration: 1.6 }); t += 1.6; }
    truth.push(t);
    const end = t + w * (60 / 160) * (0.85 + rnd() * 0.3);
    let since = 0;
    while (t < end) {
      t += 2 + rnd() * 5; since += 1;
      const g = since % 12 === 0 ? 1.0 : 0.4 + rnd() * 0.3;
      silences.push({ start: t, end: t + g, duration: g });
      t += g;
    }
  });
  return { silences, truth, duration: t };
}

console.log('audiobook split');

ok('silencedetect output parses into pauses', () => {
  const err = '[silencedetect @ 0x1] silence_start: 12.5\nsize=N/A\n[silencedetect @ 0x1] silence_end: 14.25 | silence_duration: 1.75\n[silencedetect @ 0x1] silence_start: -0.01\n[silencedetect @ 0x1] silence_end: 0.4 | silence_duration: 0.41';
  assert.deepStrictEqual(S.parseSilences(err), [{ start: 12.5, end: 14.25, duration: 1.75 }, { start: 0, end: 0.4, duration: 0.41 }]);
});

ok('every cut of the I Can\'t plan lands in its chapter pause', () => {
  const words = cfg.tracks.map((t) => t.words);
  for (const seed of [3, 11, 29, 97]) {
    const { silences, truth, duration } = simulate(words, seed);
    const cuts = S.chooseCuts({ words, duration, silences });
    assert.strictEqual(cuts.length, words.length);
    cuts.forEach((c, i) => {
      if (!i) return assert.strictEqual(c.at, 0);
      assert.ok(c.at >= truth[i] - 1.6 && c.at <= truth[i], `seed ${seed} track ${i + 1}: cut ${c.at} vs start ${truth[i].toFixed(2)}`);
    });
  }
});

ok('a cut leaves a short breath before the chapter, not the whole gap', () => {
  const cuts = S.chooseCuts({ words: [100, 100], duration: 100, silences: [{ start: 48, end: 51, duration: 3 }] });
  assert.strictEqual(cuts[1].at, 51 - S.LEAD_IN);
});

ok('with no pause anywhere near, the cut falls back to the estimate and says so', () => {
  const cuts = S.chooseCuts({ words: [100, 100], duration: 1000, silences: [] });
  assert.strictEqual(cuts[1].at, 500);
  assert.strictEqual(cuts[1].confidence, null);
});

ok('two equally long pauses near a cut are flagged for a listen', () => {
  const cuts = S.chooseCuts({ words: [100, 100], duration: 1000, silences: [{ start: 480, end: 482, duration: 2 }, { start: 520, end: 522, duration: 2 }] });
  assert.ok(cuts[1].confidence < 1.25);
});

ok('hand-set cuts accept seconds or clock times and are checked', () => {
  const r = S.parseCutOverride('58, 0:06:10, 1:00:00', { tracks: 4, duration: 4000 });
  assert.deepStrictEqual(r.map((c) => c.at), [0, 58, 370, 3600]);
  assert.strictEqual(S.parseCutOverride('  ', { tracks: 4, duration: 4000 }), null);
  assert.throws(() => S.parseCutOverride('58, 370', { tracks: 4, duration: 4000 }), /need 3/);
  assert.throws(() => S.parseCutOverride('58, 30, 90', { tracks: 4, duration: 4000 }), /go up/);
  assert.throws(() => S.parseCutOverride('58, 90, 5000', { tracks: 4, duration: 4000 }), /inside the audio/);
});

ok('a Drive share link or bare id resolves to the file id', () => {
  const id = '1R46FOhbJSrAjR0qF1vaQb3WaKc6IAUXM';
  for (const l of [`https://drive.google.com/file/d/${id}/view?usp=sharing`, `https://drive.google.com/open?id=${id}`, id]) {
    assert.strictEqual(S.driveFileId(l), id, l);
  }
  assert.strictEqual(S.driveFileId('https://example.com/x.mp3'), null);
});

ok('the I Can\'t config is the 13 narrated tracks, sample on the Introduction', () => {
  assert.strictEqual(cfg.tracks.length, 13);
  assert.strictEqual(cfg.tracks[cfg.sampleTrack].title, 'Introduction');
  assert.strictEqual(cfg.title, 'I Can\'t: Strategies To Overcoming Your Limiting Beliefs');
  assert.strictEqual(cfg.product.price, 9.99);
  assert.ok(!/—/.test(cfg.description), 'no em dashes in the description');
});

console.log(`\n${passed} passed`);
