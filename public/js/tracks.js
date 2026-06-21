// Curated course tracks for the company roadmap wizard.
//
// A "track" is a recommended bundle of course slugs for a particular kind of
// team. The admin answers a short questionnaire (team size, goals, challenges)
// and `recommendTrack()` returns the best-fit track; the admin can then add or
// remove individual courses before confirming. The confirmed slug set is sent
// to the `assignCompanyCourses` Cloud Function, which auto-enrolls every seat.
//
// IMPORTANT: keep this file in sync with functions/tracks.js (the server
// validates the chosen track + slugs against the same definitions).

export const TRACKS = [
  {
    id: 'new-managers',
    label: 'New Managers',
    blurb: 'First-time leaders learning to coach, set structure, and build trust.',
    slugs: ['1p-clc', 'performance-discipline', 'mindset-foundations']
  },
  {
    id: 'sales-leaders',
    label: 'Sales Leaders',
    blurb: 'Revenue teams aligning business goals with disciplined daily execution.',
    slugs: ['1p-clc', 'business-alignment', 'performance-discipline']
  },
  {
    id: 'faith-driven',
    label: 'Faith-Driven Teams',
    blurb: 'Lead from purpose and principle, grounded in shared values.',
    slugs: ['faith-leadership', 'mindset-foundations', '1p-clc']
  },
  {
    id: 'foundations',
    label: 'Foundations for Everyone',
    blurb: 'Break limiting beliefs and build a growth mindset across the whole team.',
    slugs: ['icant', 'mindset-foundations']
  },
  {
    id: 'full-leadership',
    label: 'Complete Leadership Path',
    blurb: 'The full journey — mindset, business, discipline, and purpose.',
    slugs: ['1p-clc', 'business-alignment', 'performance-discipline', 'mindset-foundations', 'faith-leadership']
  }
];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || null;
}

// Scores each track against the questionnaire answers and returns the best fit.
// answers: { teamSize: 'small'|'medium'|'large', goals: string[], challenges: string[] }
// Goal/challenge tokens map onto track ids; the highest score wins, with
// 'foundations' as the safe default.
export function recommendTrack(answers) {
  const goals = new Set(answers && Array.isArray(answers.goals) ? answers.goals : []);
  const challenges = new Set(answers && Array.isArray(answers.challenges) ? answers.challenges : []);
  const teamSize = (answers && answers.teamSize) || 'small';

  const score = { 'new-managers': 0, 'sales-leaders': 0, 'faith-driven': 0, 'foundations': 0, 'full-leadership': 0 };

  // Goals → tracks
  if (goals.has('develop-managers')) score['new-managers'] += 3;
  if (goals.has('grow-revenue')) score['sales-leaders'] += 3;
  if (goals.has('build-culture')) score['faith-driven'] += 2;
  if (goals.has('mindset-shift')) score['foundations'] += 3;
  if (goals.has('full-program')) score['full-leadership'] += 4;

  // Challenges → tracks
  if (challenges.has('new-to-leadership')) score['new-managers'] += 2;
  if (challenges.has('missing-targets')) score['sales-leaders'] += 2;
  if (challenges.has('low-accountability')) score['new-managers'] += 1;
  if (challenges.has('alignment')) score['faith-driven'] += 1;
  if (challenges.has('limiting-beliefs')) score['foundations'] += 2;

  // Larger teams lean toward the complete path.
  if (teamSize === 'large') score['full-leadership'] += 2;

  let best = 'foundations';
  let bestScore = -1;
  Object.keys(score).forEach((id) => {
    if (score[id] > bestScore) { best = id; bestScore = score[id]; }
  });
  return getTrack(best);
}

// Questionnaire option metadata (drives the wizard UI).
export const ROADMAP_QUESTIONS = {
  teamSize: [
    { value: 'small', label: '1–10 people' },
    { value: 'medium', label: '11–50 people' },
    { value: 'large', label: '50+ people' }
  ],
  goals: [
    { value: 'develop-managers', label: 'Develop new managers' },
    { value: 'grow-revenue', label: 'Grow revenue / sales' },
    { value: 'build-culture', label: 'Build culture & values' },
    { value: 'mindset-shift', label: 'Shift team mindset' },
    { value: 'full-program', label: 'Full leadership program' }
  ],
  challenges: [
    { value: 'new-to-leadership', label: 'Leaders new to the role' },
    { value: 'missing-targets', label: 'Missing targets' },
    { value: 'low-accountability', label: 'Low accountability' },
    { value: 'alignment', label: 'Lack of alignment' },
    { value: 'limiting-beliefs', label: 'Limiting beliefs' }
  ]
};
