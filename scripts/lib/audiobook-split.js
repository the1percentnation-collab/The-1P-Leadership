// Where to cut one long audiobook MP3 into chapter tracks. Pure: no ffmpeg,
// no Firebase, so tests/audiobook-split.test.cjs pins it with made-up
// silences.
//
// The narration script says how many words each track holds. Words come out
// at a steady pace, so the running word count predicts where each chapter
// starts; the cut then lands on the longest pause near that prediction,
// which is the gap the narration tool leaves between chapters. The pace is
// re-measured after every cut, so a long book does not drift.

// ffmpeg's silencedetect writes pairs of lines to stderr:
//   [silencedetect @ 0x..] silence_start: 12.345
//   [silencedetect @ 0x..] silence_end: 14.001 | silence_duration: 1.656
function parseSilences(stderr) {
  const out = [];
  let start = null;
  for (const line of String(stderr || '').split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) { start = Math.max(0, Number(s[1])); continue; }
    const e = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
    if (e && start != null) {
      out.push({ start, end: Number(e[1]), duration: Number(e[2]) });
      start = null;
    }
  }
  return out;
}

// A cut sits just before the speech that follows the pause, so each track
// opens on a short breath, not a long gap.
const LEAD_IN = 0.35;

/**
 * cuts({ words, duration, silences, window }) -> [{ at, silence, expected, confidence }]
 * One entry per track; the first is always 0. The search reaches `window`
 * seconds, or a quarter of the chapter's expected length when that is more,
 * so a long chapter read a little faster or slower is still found; forward,
 * it stops short of where the next chapter should end. `confidence` compares the
 * chosen pause with the next-longest one in the window: about 1 means two
 * pauses looked alike and the cut deserves a listen.
 */
function chooseCuts({ words, duration, silences, window = 120, minTrack = 20 }) {
  const n = words.length;
  const total = words.reduce((a, b) => a + b, 0);
  if (!n || !(duration > 0) || !(total > 0)) throw new Error('need words and a duration');
  const sorted = [...(silences || [])].sort((a, b) => a.start - b.start);
  const out = [{ at: 0, silence: null, expected: 0, confidence: null }];
  let rate = duration / total; // seconds per word
  let wordsSoFar = 0;
  for (let i = 1; i < n; i++) {
    const prev = out[i - 1].at;
    wordsSoFar += words[i - 1];
    const expected = prev + words[i - 1] * rate;
    const mid = (s) => (s.start + s.end) / 2;
    const back = Math.max(window, 0.25 * words[i - 1] * rate);
    const ahead = Math.min(back, Math.max(window / 2, 0.6 * words[i] * rate));
    const inReach = (s, k) => s.start > prev + minTrack && mid(s) >= expected - back * k && mid(s) <= expected + ahead * k;
    const near = sorted.filter((s) => inReach(s, 1));
    let pick = null;
    let confidence = null;
    if (near.length) {
      const ranked = [...near].sort((a, b) => (b.duration - a.duration) || (Math.abs(mid(a) - expected) - Math.abs(mid(b) - expected)));
      pick = ranked[0];
      confidence = ranked[1] ? pick.duration / ranked[1].duration : Infinity;
    } else {
      const wide = sorted.filter((s) => inReach(s, 2.5));
      pick = wide.sort((a, b) => Math.abs(mid(a) - expected) - Math.abs(mid(b) - expected))[0] || null;
      confidence = pick ? 0 : null;
    }
    const at = pick ? Math.max(pick.start, pick.end - LEAD_IN) : expected;
    out.push({ at: round(at), silence: pick, expected: round(expected), confidence });
    rate = at / wordsSoFar; // re-measure the pace from what was actually found
  }
  return out;
}

/** "12.5, 640, 1302.75" -> [0, 12.5, 640, 1302.75]: hand-set cuts, checked. */
function parseCutOverride(text, { tracks, duration }) {
  if (!String(text || '').trim()) return null;
  const nums = String(text).split(/[\s,]+/).filter(Boolean).map((x) => {
    const m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(x);
    if (m) return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    return Number(x);
  });
  const list = nums[0] === 0 ? nums : [0, ...nums];
  if (list.length !== tracks) throw new Error(`cuts: need ${tracks - 1} times (one per chapter start after the first), got ${list.length - 1}`);
  list.forEach((t, i) => {
    if (!Number.isFinite(t) || t < 0 || t >= duration) throw new Error(`cuts: ${t} is not inside the audio`);
    if (i && t <= list[i - 1]) throw new Error('cuts must go up');
  });
  return list.map((at) => ({ at, silence: null, expected: at, confidence: null }));
}

/** A Drive share link, or a bare id -> the file id. */
function driveFileId(link) {
  const s = String(link || '').trim();
  const m = /\/file\/d\/([A-Za-z0-9_-]{20,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{20,})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}

function fmt(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function round(x) { return Math.round(x * 100) / 100; }

// ── Cutting by what is said ─────────────────────────────────────────────
// Pause length alone cannot tell a chapter break from a section break when
// the narration pauses the same before both. So the publisher transcribes
// the first seconds after each pause and cuts where the narrator says the
// chapter's own heading: "Introduction", "Chapter Seven", "Conclusion".

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

/** Lowercase words only: "Chapter 7. Building…" -> "chapter 7 building…". */
function normalizeHeard(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * What the narrator says at the top of a track, as a test on the normalized
 * transcript, from the track's title: "Chapter 7: …" hears "chapter seven"
 * or "chapter 7"; anything else hears its first words ("introduction",
 * "conclusion"). The first track always starts at 0, so it needs none.
 */
function headingMatcher(title, index) {
  if (index === 0) return null;
  const ch = /^chapter\s+(\d+)\b/i.exec(String(title || ''));
  if (ch) {
    const n = Number(ch[1]);
    const alts = [String(n), NUMBER_WORDS[n]].filter(Boolean);
    const re = new RegExp(`^(?:\\w+ ){0,2}chapter (?:${alts.join('|')})\\b`);
    return (heard) => re.test(normalizeHeard(heard));
  }
  const lead = normalizeHeard(String(title || '').split(/[:.]/)[0]);
  if (!lead) return null;
  const re = new RegExp(`^(?:\\w+ ){0,2}${lead.replace(/ /g, ' ')}\\b`);
  return (heard) => re.test(normalizeHeard(heard));
}

/**
 * cutsByHeading({ titles, words, duration, silences, heard })
 *   heard[k] is the transcript just after silences[k] (missing = not checked).
 * Each track starts at the pause where its heading is heard, taking the one
 * nearest the word-count estimate when it is heard more than once. A track
 * whose heading is never heard falls back to chooseCuts' pause and is marked
 * so the report says to listen to it.
 */
function cutsByHeading({ titles, words, duration, silences, heard, minTrack = 20 }) {
  const n = titles.length;
  const total = words.reduce((a, b) => a + b, 0);
  const sorted = (silences || []).map((s, k) => ({ ...s, k })).sort((a, b) => a.start - b.start);
  const out = [{ at: 0, silence: null, expected: 0, confidence: null, heard: null, by: 'start' }];
  let cum = 0;
  for (let i = 1; i < n; i++) {
    cum += words[i - 1];
    const expected = duration * (cum / total);
    const prev = out[i - 1].at;
    const match = headingMatcher(titles[i], i);
    const hits = match ? sorted.filter((s) => s.start > prev + minTrack && heard[s.k] != null && match(heard[s.k])) : [];
    if (hits.length) {
      const pick = hits.sort((a, b) => Math.abs(a.end - expected) - Math.abs(b.end - expected))[0];
      out.push({ at: round(Math.max(pick.start, pick.end - LEAD_IN)), silence: pick, expected: round(expected), confidence: null, heard: heard[pick.k], by: 'heard' });
    } else {
      // Not heard: the longest pause near the plain word-count position.
      // Never re-measured from earlier cuts, so one miss cannot drag the
      // rest of the book with it.
      const near = sorted.filter((s) => s.start > prev + minTrack && Math.abs(s.end - expected) <= 120)
        .sort((a, b) => (b.duration - a.duration) || (Math.abs(a.end - expected) - Math.abs(b.end - expected)));
      const pick = near[0] || null;
      const at = pick ? Math.max(pick.start, pick.end - LEAD_IN) : Math.max(expected, prev + minTrack);
      out.push({ at: round(at), silence: pick, expected: round(expected), confidence: 0, heard: null, by: 'pause' });
    }
  }
  return out;
}

module.exports = {
  parseSilences, chooseCuts, parseCutOverride, driveFileId, fmt, LEAD_IN,
  normalizeHeard, headingMatcher, cutsByHeading
};
