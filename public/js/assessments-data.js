// The free assessment library. One data file per assessment in
// js/assessments/, listed here in the order the library shows them.
//
// To add one: write js/assessments/<slug>.js in the same shape (see
// assessment-core.js for the contract), import it below, and add its slug to
// ASSESSMENT_SLUGS in functions/index.js so results can be saved. The tests
// fail if the two lists drift.
import alignmentScorecard from './assessments/alignment-scorecard.js';
import alignmentAssessment from './assessments/alignment-assessment.js';
import successOnPaper from './assessments/success-on-paper.js';
import burnoutCheck from './assessments/burnout-check.js';
import disciplineScore from './assessments/discipline-score.js';
import playingSmall from './assessments/playing-small.js';
import findYourWhy from './assessments/find-your-why.js';
import purposeAtWork from './assessments/purpose-at-work.js';
import leadershipStyle from './assessments/leadership-style.js';
import leadershipReadiness from './assessments/leadership-readiness.js';
import limitingBeliefs from './assessments/limiting-beliefs.js';
import delegationAudit from './assessments/delegation-audit.js';
import faithLeader from './assessments/faith-leader.js';
import teamAlignment from './assessments/team-alignment.js';
import salesMindset from './assessments/sales-mindset.js';
import financialReadiness from './assessments/financial-readiness.js';
import moneyMindset from './assessments/money-mindset.js';
import legacyProtection from './assessments/legacy-protection.js';

export const ASSESSMENTS = [
  alignmentScorecard,
  successOnPaper,
  burnoutCheck,
  disciplineScore,
  playingSmall,
  findYourWhy,
  purposeAtWork,
  leadershipStyle,
  leadershipReadiness,
  limitingBeliefs,
  delegationAudit,
  faithLeader,
  alignmentAssessment,
  teamAlignment,
  salesMindset,
  financialReadiness,
  moneyMindset,
  legacyProtection
];

export function getAssessment(slug) {
  return ASSESSMENTS.find((a) => a.slug === slug) || null;
}
