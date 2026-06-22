# Product Roadmap — The 1P Leadership

A dependency-aware, phased build sequencing 20 enhancements. Phases are ordered so
each unlocks the next. Item numbers in brackets map to the original idea list.

> **Cut line:** Phases 0–2 are the "make it real and defensible" core. Phases 3–6
> are expansion.

---

## Phase 0 — Finish the foundation
Close the gaps in the company-courses feature and put a safety net under future work.

- **[3] `icant` progress persistence** — migrate from localStorage to the Firestore progress model so it shows on rosters and earns certificates.
- **[1] Learning paths / sequencing & prerequisites** — make `assignedTrackId` an *ordered* path with "next up" + prerequisite gating.
- **[4] Certificate verification page** — public `/verify?cert=ID` + a code on the PDF.
- **[5] Renewal & seat lifecycle** — owner suspend/resume access, dunning emails, lapse behavior.
- **[18] Test coverage + CI** — Firestore rules tests + emulator integration tests for the new callables/trigger.

*Reuses:* progress + `companyCourseSlugs` model, `stripeWebhook` plan branches, SendGrid, scheduled reminder functions.
*Exit:* every course persists progress, paths are ordered, certs are verifiable, CI runs the suite.

## Phase 1 — Measurement & accountability
Make the flat-rate sale defensible at renewal. You can't improve completion until you can see it.

- **[15] Analytics instrumentation** — an events collection over the funnel (enroll → start → complete → certify).
- **[2] Company analytics dashboard** — completion rate per course, stalled members, time-to-complete, certs over time.
- **[6] Drip + reminders** — "1 module from your certificate" nudges + weekly digests to member *and* manager.
- **[7] Cohorts & due dates** — assign a course to a group with a deadline.

*Reuses:* GA4 tags, `taskReminders`/`appointmentReminders` infra, the admin roster.
*Exit:* admins see team progress; members get automated, deadline-aware nudges.

## Phase 2 — Make completion meaningful
Turn "clicked done" into demonstrated learning — what makes certificates worth paying for.

- **[9] Quizzes / knowledge checks** — pass thresholds gating the certificate (`assessments` subcollection on modules).
- **[11] Capstone review workflow** — submission → review → approval, tied to the cert gate.
- **[8] Streaks / leaderboard tie-in** — points for completions; company leaderboard.

*Reuses:* module model, leaderboard + stats system, `capstoneStatus`.
*Exit:* certificates require a passing assessment and/or approved capstone.

## Phase 3 — Richer content
Upgrade what learners consume now that the rails are solid.

- **[10] Video + resource attachments** — video embeds, downloadable worksheets, audio.

*Reuses:* Cloud Storage, the module HTML renderer.
*Exit:* a module can carry video + downloadable resources.

## Phase 4 — Growth & monetization
Remove the owner bottleneck and increase revenue per account.

- **[12] Self-serve company signup + pricing page** — public "Teams" plan with Stripe-driven onboarding.
- **[13] Bundles & upsells at completion** — recommend the next course; let individuals buy beyond the company set.
- **[14] Coupon/affiliate ROI reporting** — sales by code, conversion, payouts.

*Reuses:* company-flat Stripe plumbing, affiliates + coupons collections, individual checkout flow.
*Exit:* a company can sign up and pay without owner intervention; completion drives upsell.

## Phase 5 — Platform, trust & ops
Harden for scale and bigger buyers.

- **[16] Audit log & granular RBAC** — a "manager" role (view, not delete) + immutable audit trail generalized from the CRM activities pattern.
- **[17] Accessibility & mobile** — mobile course consumption, keyboard nav, cert/email rendering on mobile.

*Reuses:* CRM immutable-activity pattern, role checks in `firestore.rules`.
*Exit:* roles, auditability, and a usable mobile experience.

## Phase 6 — AI layer
Differentiation, built on a now-rich content + data foundation.

- **[19] AI learning coach** — extend the Anthropic chatbot KB into a per-course tutor.
- **[20] AI-assisted roadmap** — Claude generates a tailored path from questionnaire + CRM context, with rationale.

*Reuses:* existing Anthropic integration, chatbot KB, the roadmap questionnaire.
*Exit:* in-context tutoring; AI-generated, explainable course paths.

---

### Why this order
- **Phase 0 first** — certificates/rosters are only as good as the progress data; CI lets every later phase be verified.
- **Phase 1 before 2** — you need the funnel + dashboard to *prove* Phase 2's engagement features lift completion.
- **Content (3) & growth (4)** after the engagement loop works, so more traffic hits a system that converts.
- **AI (6) last** — most valuable once content is rich and there's data + assessments to reason over.

See `PHASE_0_PLAN.md` for the detailed implementation plan of Phase 0.
