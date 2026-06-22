// Server mirror of public/js/tracks.js — keep the TRACKS definitions in sync.
// Used by assignCompanyCourses to validate the chosen track + course slugs.

const TRACKS = [
  { id: 'new-managers', label: 'New Managers', slugs: ['1p-clc', 'performance-discipline', 'mindset-foundations'] },
  { id: 'sales-leaders', label: 'Sales Leaders', slugs: ['1p-clc', 'business-alignment', 'performance-discipline'] },
  { id: 'faith-driven', label: 'Faith-Driven Teams', slugs: ['faith-leadership', 'mindset-foundations', '1p-clc'] },
  { id: 'foundations', label: 'Foundations for Everyone', slugs: ['icant', 'mindset-foundations'] },
  { id: 'full-leadership', label: 'Complete Leadership Path', slugs: ['1p-clc', 'business-alignment', 'performance-discipline', 'mindset-foundations', 'faith-leadership'] }
];

// Every slug that appears in any curated track — the allowlist of course slugs
// (registry courses) that don't necessarily have a courses/{slug} Firestore doc.
const TRACK_SLUGS = new Set(TRACKS.reduce((acc, t) => acc.concat(t.slugs), []));

function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || null;
}

module.exports = { TRACKS, TRACK_SLUGS, getTrack };
