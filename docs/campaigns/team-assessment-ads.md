# Paid campaign: Team Alignment and Delegation Audit

**Goal:** Alignment Audit requests from leaders of 11 or more people. Form
fills are not the goal. The site already tags these people as **Priority
Lead**, shows them the Audit twice, and (after My Plan ships) emails them
once from Anthony three days into their plan.

**The path:** ad → free assessment → report → plan → Alignment Audit →
intensive → annual program.

Every ad below uses its page's own headline ("Is your team rowing in the
same direction?" / "Are you the bottleneck?"), so the click lands on the
promise it was made. No page changes are needed.

---

## Before launch

1. **Paste the Meta Pixel ID** into `META_PIXEL_ID` in
   `public/js/consent-banner.js` (Meta Events Manager → Data sources). It
   loads only for visitors who accept cookies. Until it is set, Meta can
   optimize for clicks only.
2. In Events Manager, create a **custom conversion** from the custom event
   `PriorityLead`. The site fires it when a leader of 11 or more people, or
   an owner, executive, pastor or nonprofit leader with a team, unlocks their
   report.
3. Use the exact links below. The `utm_campaign` value becomes a CRM tag
   (`Campaign: ta-a`), so you can see which ad produced which Priority Lead.

---

## The Team Alignment Assessment

Link base: `https://the1pnation.com/assessments/team-alignment`

### Ad A: The question
- **Primary text:** Your team is busy. Is it busy in the same direction? Six minutes, six areas: vision, roles, trust, accountability, communication and engagement. You get an honest score, the one area to fix first, and a plan you can start this week. Free.
- **Headline:** Is your team rowing together?
- **Description:** Free · 6 min · Instant score
- **Button:** Learn More
- **Link:** `…/team-alignment?utm_source=meta&utm_medium=paid&utm_campaign=ta-a`

### Ad B: The view from the top
- **Primary text:** You can see the plan. The question is whether your team sees the same one. The Team Alignment Assessment shows where your team is pulling together and where it is quietly pulling apart. Then it turns your results into a 30-day plan.
- **Headline:** You see the plan. Do they?
- **Description:** Free team alignment score
- **Button:** Learn More
- **Link:** `…/team-alignment?utm_source=meta&utm_medium=paid&utm_campaign=ta-b`

### Ad C: What misalignment looks like
- **Primary text:** Misalignment rarely looks like conflict. It looks like rework, dropped handoffs, and meetings that end without an owner. Find out which of six areas is costing your team the most. Six minutes, free, with a plan to close the gap.
- **Headline:** Find the gap costing your team
- **Description:** 6-minute leadership assessment
- **Button:** Learn More
- **Link:** `…/team-alignment?utm_source=meta&utm_medium=paid&utm_campaign=ta-c`

---

## The Delegation Audit

Link base: `https://the1pnation.com/assessments/delegation-audit`

### Ad A: The bottleneck
- **Primary text:** If every decision still runs through you, the business can only grow as fast as your calendar. The Delegation Audit shows whether your team is growing around you or waiting on you, and the first thing to hand off this week. Seven minutes. Free.
- **Headline:** Are you the bottleneck?
- **Description:** Free · 7 min · Instant score
- **Button:** Learn More
- **Link:** `…/delegation-audit?utm_source=meta&utm_medium=paid&utm_campaign=da-a`

### Ad B: The week away
- **Primary text:** Could your team run a full week without texting you? If the honest answer is no, the problem is not effort. It is how work moves through you. Score yourself across trust, systems, letting go, team capability and focus, then get a plan to change it.
- **Headline:** Could they run a week without you?
- **Description:** The Delegation Audit, free
- **Button:** Learn More
- **Link:** `…/delegation-audit?utm_source=meta&utm_medium=paid&utm_campaign=da-b`

### Ad C: The work only you can do
- **Primary text:** Most leaders do not have a time problem. They have a hand-off problem. Find out how much of your week goes to work someone else could own, and which area to fix first so you get back to the work only you can do.
- **Headline:** Get back to the work only you can do
- **Description:** 7-minute assessment · Free
- **Button:** Learn More
- **Link:** `…/delegation-audit?utm_source=meta&utm_medium=paid&utm_campaign=da-c`

---

## Who to show it to

**Meta (start here, lowest cost to test):**
- Oklahoma City and Tulsa metros, 40-mile radius. Local leaders also avoid
  the travel fee on in-person work.
- Ages 30 to 64.
- Interests and behaviors: Small business owners, Business page admins,
  Entrepreneurship, Leadership, Management, Sales.
- One ad set per assessment; let Meta rotate the three ads inside it.

**LinkedIn (add once Meta shows which message wins):** this is where job-title
targeting actually works.
- Titles: CEO, President, Owner, Founder, COO, VP of Sales, Sales Director,
  Executive Director.
- Company size 11 to 200.
- Oklahoma first, then expand.
- Run only the winning ad from each assessment. LinkedIn costs several times
  more per click, so do not test there.

## Budget and rules

- **Test:** $25 a day per assessment for 14 days (about $700 total).
- **Optimize for:** Lead (report unlock) at first. Switch to the
  `PriorityLead` custom conversion once it has about 50 events.
- **The number that matters:** cost per Priority Lead, then cost per Audit
  request. Ignore cost per click.
- **Kill rule:** pause any ad that spends $150 without a Priority Lead.
- **Scale rule:** move budget to any ad whose Priority Leads request Audits.
  One Core annual program ($65,000) pays for this test about ninety times
  over.

## Where to watch

- **CRM:** filter Priority Lead plus `Campaign: ta-*` or `Campaign: da-*`.
  Audit requests carry the **Alignment Audit** tag. The note from Anthony adds
  **Audit Note Sent**.
- **Google Analytics:** `assessment_unlocked`, `priority_lead`,
  `plan_saved`, `plan_build_audit` (Audit clicks inside the plan wizard).
