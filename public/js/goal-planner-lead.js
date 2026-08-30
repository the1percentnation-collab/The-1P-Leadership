// Goal planner → portal lead capture (best-effort, fire-and-forget).
// Replaces the old GoHighLevel survey handoff: when someone builds a plan
// and leaves an email, the lead lands in the academy CRM with their answers.

import { functions, firebaseReady } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

window.__1pGoalPlannerLead = ({ name, email, fields }) => {
  if (!firebaseReady) return;
  httpsCallable(functions, 'submitLeadForm')({
    formType: 'goal-planner', name, email, fields, consent: false
  }).catch((e) => console.warn('[goal-planner] lead capture skipped:', e && e.message));
};
