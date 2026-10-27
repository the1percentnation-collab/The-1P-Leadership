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

ok('a chapter heading is heard in words or digits, and nothing else passes for it', () => {
  const ch7 = S.headingMatcher('Chapter 7: Building Resilience and Overcoming Setbacks', 8);
  assert.ok(ch7('Chapter Seven. Building resilience and overcoming setbacks.'));
  assert.ok(ch7('Chapter 7, building resilience'));
  assert.ok(ch7('...Chapter seven.'));
  assert.ok(!ch7('Chapter Six. Six Weeks Deep.'));
  assert.ok(!ch7('Chapter seventeen'));
  assert.ok(!ch7('The setback is not the problem.'));
  const ch10 = S.headingMatcher('Chapter 10: The Journey of Continuous Growth', 11);
  assert.ok(ch10('Chapter Ten. The journey of continuous growth.') && !ch10('Chapter One. Understanding limiting beliefs.'));
  assert.ok(S.headingMatcher('Introduction', 1)('Introduction.'));
  assert.ok(S.headingMatcher('Conclusion: Embracing Your Limitless Potential', 12)('Conclusion. Embracing your limitless potential.'));
  assert.strictEqual(S.headingMatcher('Opening Credits', 0), null);
});

ok('cutting by heading lands on the pause where the heading is said, even when every pause looks alike', () => {
  // Four tracks; every pause is 1.5 s, chapter or section alike.
  const silences = [
    { start: 40, end: 41.5, duration: 1.5 },   // -> Introduction
    { start: 160, end: 161.5, duration: 1.5 }, // section inside the Introduction
    { start: 300, end: 301.5, duration: 1.5 }, // -> Chapter 1
    { start: 420, end: 421.5, duration: 1.5 }, // section: "In chapter one we..." (decoy)
    { start: 700, end: 701.5, duration: 1.5 }  // -> Chapter 2
  ];
  const heard = { 0: 'Introduction.', 1: 'How to use this book.', 2: 'Chapter One. Understanding limiting beliefs.',
    3: 'In chapter one we name it.', 4: 'Chapter Two. The neuroscience of belief.' };
  const titles = ['Opening Credits', 'Introduction', 'Chapter 1: Understanding Limiting Beliefs', 'Chapter 2: The Neuroscience of Belief'];
  const cuts = S.cutsByHeading({ titles, words: [100, 600, 900, 700], duration: 1000, silences, heard });
  assert.deepStrictEqual(cuts.map((c) => c.at), [0, 41.5 - S.LEAD_IN, 301.5 - S.LEAD_IN, 701.5 - S.LEAD_IN]);
  assert.deepStrictEqual(cuts.map((c) => c.by), ['start', 'heard', 'heard', 'heard']);
});

ok('a heading never heard falls back near its word-count position, without dragging the rest', () => {
  const silences = [{ start: 100, end: 102, duration: 2 }, { start: 480, end: 482, duration: 2 }, { start: 760, end: 762, duration: 2 }];
  const heard = { 0: 'Introduction.', 1: 'and then', 2: 'Chapter Two.' };
  const titles = ['Opening Credits', 'Introduction', 'Chapter 1: A', 'Chapter 2: B'];
  const cuts = S.cutsByHeading({ titles, words: [100, 400, 250, 250], duration: 1000, silences, heard });
  assert.strictEqual(cuts[2].by, 'pause');
  assert.strictEqual(cuts[2].at, 482 - S.LEAD_IN);
  assert.strictEqual(cuts[3].by, 'heard');
});

// Timed words as the transcriber returns them, from "said" phrases.
function timedWords(phrases) {
  const out = [];
  for (const [t, text] of phrases) text.split(' ').forEach((w, j) => out.push({ word: ` ${w}`, start: t + 0.35 * j, end: t + 0.35 * j + 0.3 }));
  return out;
}

ok('listening windows sit around each chapter\'s word-count position, inside the book', () => {
  const w = S.headingWindows({ words: [100, 400, 500], duration: 1000, span: 240 });
  assert.deepStrictEqual(w, [{ track: 1, from: 0, to: 340, expected: 100 }, { track: 2, from: 260, to: 740, expected: 500 }]);
});

ok('a heading is found in timed words, as one token or two, words or digits', () => {
  const t = timedWords([[10, 'and so on'], [20, 'Chapter Seven. Building resilience'], [40, 'Chapter 7, again']]);
  assert.deepStrictEqual(S.findHeading(t, 'Chapter 7: Building Resilience', 8).map((h) => h.start), [20, 40]);
  assert.deepStrictEqual(S.findHeading([{ word: ' Chapter 7.', start: 5, end: 6 }], 'Chapter 7: X', 8).map((h) => h.start), [5]);
  assert.deepStrictEqual(S.findHeading(t, 'Chapter 6: Six Weeks Deep', 7), []);
  assert.deepStrictEqual(S.findHeading(timedWords([[3, 'Conclusion. Embracing']]), 'Conclusion: Embracing Your Limitless Potential', 12).map((h) => h.start), [3]);
});

ok('a heading read with no pause before it is still cut right before its first word', () => {
  const titles = ['Opening Credits', 'Introduction', 'Chapter 1: Understanding Limiting Beliefs', 'Chapter 2: The Neuroscience of Belief'];
  const heardWords = {
    1: timedWords([[45, 'Introduction. If you have']]),
    2: timedWords([[290, 'and that was it'], [300, 'Chapter One. Understanding limiting beliefs'], [420, 'In chapter one we name it']]),
    3: timedWords([[702, 'Chapter Two. The neuroscience']])
  };
  // Pauses only before the Introduction and the decoy; the chapters have none.
  const silences = [{ start: 42, end: 44.8, duration: 2.8 }, { start: 418, end: 419.8, duration: 1.8 }];
  const cuts = S.cutsByWords({ titles, words: [100, 600, 900, 700], duration: 1000, silences, heardWords });
  assert.deepStrictEqual(cuts.map((c) => c.by), ['start', 'heard', 'heard', 'heard']);
  assert.strictEqual(cuts[1].at, 44.45, 'snaps to the pause before the Introduction');
  assert.strictEqual(cuts[2].at, 299.6, 'right before "Chapter One", not at the decoy');
  assert.strictEqual(cuts[3].at, 701.6);
});

ok('a heading never said is placed near its position and reports what was said there', () => {
  const titles = ['Opening Credits', 'Introduction', 'Chapter 1: A'];
  const heardWords = { 1: timedWords([[100, 'Introduction.']]), 2: timedWords([[600, 'the next part begins here']]) };
  const silences = [{ start: 97, end: 99.5, duration: 2.5 }, { start: 598, end: 600, duration: 2 }];
  const cuts = S.cutsByWords({ titles, words: [100, 500, 400], duration: 1000, silences, heardWords });
  assert.strictEqual(cuts[2].by, 'pause');
  assert.strictEqual(cuts[2].at, 600 - S.LEAD_IN);
  assert.ok(/next part begins/.test(cuts[2].near), cuts[2].near);
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
