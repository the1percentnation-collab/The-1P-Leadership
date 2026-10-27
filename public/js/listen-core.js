// The audiobook player's pure rules: no Firebase, no DOM, so
// tests/audiobook.test.cjs can pin them. listen-page.js does the wiring.

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

/** The speed after `current` in the cycle the speed button steps through. */
export function nextSpeed(current) {
  const i = SPEEDS.indexOf(Number(current));
  return SPEEDS[(i + 1) % SPEEDS.length];
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Total running time of the book in seconds, or 0 when any track is unknown. */
export function totalDuration(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (!list.length || list.some((t) => !(Number(t && t.duration) > 0))) return 0;
  return list.reduce((n, t) => n + Number(t.duration), 0);
}

/**
 * How far through the whole book (0..1) chapter `track`, `time` seconds in,
 * is. Uses real durations when every track has one, else counts chapters.
 */
export function overallFraction(tracks, track, time) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (!list.length) return 0;
  const i = Math.min(Math.max(0, Number(track) || 0), list.length - 1);
  const total = totalDuration(list);
  if (total) {
    const before = list.slice(0, i).reduce((n, t) => n + Number(t.duration), 0);
    return clamp01((before + Math.min(Number(time) || 0, Number(list[i].duration))) / total);
  }
  const d = Number(list[i] && list[i].duration);
  const within = d > 0 ? Math.min(1, (Number(time) || 0) / d) : 0;
  return clamp01((i + within) / list.length);
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

/**
 * Where to resume: { track, time }. A saved position past the last chapter
 * (the book was re-cut with fewer chapters) starts that last chapter over;
 * one within the final 10 seconds of a chapter moves on to the next.
 */
export function resumePoint(tracks, pos) {
  const n = Array.isArray(tracks) ? tracks.length : 0;
  if (!n || !pos || !Number.isInteger(pos.track)) return { track: 0, time: 0 };
  if (pos.track >= n) return { track: n - 1, time: 0 };
  const time = Math.max(0, Number(pos.time) || 0);
  const d = Number(tracks[pos.track] && tracks[pos.track].duration);
  if (d > 0 && time > d - 10) {
    return pos.track + 1 < n ? { track: pos.track + 1, time: 0 } : { track: pos.track, time: 0 };
  }
  return { track: pos.track, time };
}

/**
 * One-tap links that add a private feed to the podcast apps that accept one.
 * Spotify and Audible take no private feeds; the web player covers those.
 */
export function podcastLinks(feedUrl) {
  const url = String(feedUrl || '');
  if (!/^https:\/\//.test(url)) return [];
  const bare = url.replace(/^https:\/\//, '');
  return [
    { key: 'apple', label: 'Apple Podcasts', href: `podcast://${bare}` },
    { key: 'overcast', label: 'Overcast', href: `overcast://x-callback-url/add?url=${encodeURIComponent(url)}` },
    { key: 'pocketcasts', label: 'Pocket Casts', href: `pktc://subscribe/${bare}` },
    { key: 'castro', label: 'Castro', href: `castro://subscribe/${bare}` }
  ];
}

/** The live, buyable product that unlocks `bookId`, cheapest first. */
export function productForBook(products, bookId) {
  return (Array.isArray(products) ? products : [])
    .filter((p) => p && p.sellable === true && ['live', 'preorder'].includes(p.status)
      && Array.isArray(p.grantsBooks) && p.grantsBooks.includes(bookId)
      && typeof p.price === 'number' && p.price > 0 && !p.externalUrl)
    .sort((a, b) => a.price - b.price)[0] || null;
}
