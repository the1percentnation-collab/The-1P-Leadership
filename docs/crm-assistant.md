# The admin CRM assistant

The chatbot widget, in CRM mode. Admin-only. Ask it who needs contacting, who
has gone quiet, what is overdue, or for an audit of the pipeline; it can also
stage follow-up tasks and tag changes for you to approve.

Available on every CRM screen and on the contact card. Members see no change:
they get the same course advisor they always had.

---

## What it can answer

| Ask | What it does |
| --- | --- |
| "Who's gone stagnant?" | Lists contacts by how long since anyone actually reached them |
| "What's overdue?" | Open tasks past their due date, with counts |
| "Audit my pipeline" | Exact counts by stage, staleness distribution, open deals and value |
| "How many leads did we contact this week?" | Distinct contacts reached, split by channel and direction |
| "What's the story with Jane Cole?" | One lead's full history: emails, texts, calls, notes, tasks, deals |
| "Create follow-up tasks for those twelve" | Stages the tasks and waits for you to click Apply |

### Staleness means real outreach

The bands are warm under 7 days, cooling 7-14, stagnant 14-30, cold over 30 —
measured on `lastContactedAt`, which moves only when someone actually emailed,
texted, spoke to, or logged a meeting with the lead.

This is not `lastActivityAt`. That field moves whenever the *record* is touched:
a tag edit, a stage change, a CSV import. A lead can have activity from
yesterday and have gone two months without anyone speaking to them. The
assistant is told the difference explicitly and will not conflate them.

"Never contacted" is its own answer, not "cold" — a lead that arrived this
morning has not been neglected.

---

## Counts are exact

Counts come from database aggregations, not from the model tallying rows. This
is deliberate: an LLM counting a long list is wrong in a way that does not
announce itself, and "37 stagnant leads" when it is 52 reads exactly as
confident as the truth.

When a list is capped, the assistant says "at least N" rather than a total, and
offers to narrow. If it ever gives you a bare count off the back of a list,
that is a bug worth reporting.

---

## Changes: it stages, you apply

The assistant never writes to your CRM. It stages a plan and you approve it.

1. You give it an explicit instruction ("create follow-up tasks for those").
   A question is not an instruction — "who should I follow up with?" gets an
   answer, not a plan.
2. A card appears listing every contact affected. **Nothing has changed yet.**
3. You click Apply. The apply step re-checks your admin rights and runs the
   stored plan with no AI in the loop, so the change you approved is the change
   that executes.
4. An Undo button appears afterwards.

### The automation warning

A tag add or a stage change can trigger a sequence, and sequence steps send
real email and SMS. So a "field edit" from the assistant can put messages in
your leads' inboxes.

When a staged change would do that, the card says so in red above the Apply
button, naming the sequence and how many sending steps it has, with a tick to
suppress automations for that batch. The tick defaults to **on**, because that
is how the CRM behaves when you make the change by hand and silently differing
would be its own surprise.

### What it may change

- **Follow-up tasks** — create only
- **Tags** — add and remove, with casing snapped to your existing tags so
  `Follow-Up` does not grow up beside `follow-up`
- **Stages** — *staged and recorded, but not applied* (see below)

It cannot delete anything, edit contact fields, send email or SMS directly,
touch opportunities, or reassign owners.

### Stage changes are shadowed

`CRM_STAGE_WRITES_ENABLED` is `false` in `functions/index.js`.

Stage proposals are recorded in full but never applied. The reason is the
automation path above: "these forty have been cold for two months, clean them
up" reads to a model like `lost`, and if you have a stage-change sequence — a
breakup email is the most common one there is — forty people who were merely
slow get told it sounds like now isn't the right time.

Shadowing gives you a free evaluation set, and **CRM → AI Activity** is where
you read it. The top section lists every stage change the assistant proposed
and was not allowed to make: the contact, the move, its reasoning, the prompt
that produced it, and whether it would have triggered a sequence. Read it top to
bottom and you can answer the only question that matters — would I have been
happy if these had gone through? — then flip the flag with evidence rather than
hope.

### Caps

25 contacts per plan, 40 items, 10 stage changes, 200 contacts per company per
day. The daily counter fails closed: if it cannot be read, the apply is
refused. A read that fails open costs money; a write that fails open costs data.

---

## Audit trail

Every applied change writes an activity on the contact with:

- `actorUid` — **you**, the admin who clicked Apply. A human approved it, so
  attribution is yours.
- `actorName` — `"<your name> via CRM Assistant"`, so a timeline read six
  months later explains itself
- `meta.userPrompt` — the message that caused it
- `meta.planId` and `meta.before` — what it was before, which is what makes
  Undo possible

The plan document at `companies/{cid}/aiPlans/{planId}` keeps the whole story:
your prompt, the assistant's reasoning, every item, every result, and the tool
calls that selected the contacts. Plans are readable by company admins and
writable only by the Cloud Functions.

**CRM → AI Activity** renders all of it, so none of this needs the Firestore
console. Every plan expands to show the prompt, the reasoning, each change, the
automations it would have triggered, what actually happened, and how the
assistant chose those contacts. A plan staged and never approved shows as
*expired unapproved* rather than sitting there looking live — nothing sweeps
them server-side, so the page derives that from the expiry itself.

Undo lives there too. It used to exist only on the chat bubble in the session
that applied the plan, so a refresh lost it even though the record keeps
everything the revert needs for the full seven days.

Undo works for 7 days. It restores tags by inverse delta rather than
overwriting, so it will not clobber edits someone else made in between, and it
stops sequence enrolments the change started. It cannot recall email that has
already been delivered, and says so.

---

## Boundaries

- **One company.** Whichever the CRM company switcher is showing. `companyId`
  is verified with `assertCompanyAdmin` on every call and appears in no tool
  schema — tools are built over a scope closure and cannot construct a path
  outside your company.
- **No cross-tenant reads.** No `collectionGroup` queries: activities, notes,
  emails, messages and calls carry no `companyId` field, so a collection-group
  query over them would be unfilterable.
- **Phone numbers never reach the model.** It sees `hasPhone: true`, nothing
  more. Message bodies are truncated to 300 characters.
- **Opt-outs travel with every row** so it will not suggest emailing someone
  who unsubscribed or calling a do-not-call number.

---

## Cost, and what not to use this for

**Use the CRM Dashboard for standing questions.** Stagnant leads, who needs
contacting, overdue follow-ups, outreach this week, pipeline by stage, owner
load, lead-source ROI — all of it is on `/crm-dashboard.html`, computed from
your own data, exact, instant, and **free**. Every row there opens to show the
named contacts behind the number.

Those are database questions. Paying a language model to phrase a count
Firestore already has is the wrong trade, and the dashboard is a better answer
anyway: you glance at it rather than interviewing it.

The assistant is for what a dashboard cannot anticipate — "what's the story
with Jane Cole and should I call her before Thursday?" — and for staging
changes.

**Running on Haiku 4.5** (`$1`/`$5` per MTok), since the heavy questions are
handled for free. Roughly:

| | Cost |
| --- | --- |
| Typical question | ~$0.014 |
| Multi-step question | ~$0.04 |
| Worst case at the caps | ~$0.11 |

About $4/month at ten questions a day. Rate limited to 15 per admin per 10
minutes and 60 per company per hour — the second limit exists because the first
does not stop several admins spending together.

To change model, edit `CRM_MODEL` in `functions/index.js`. It is not only a
string swap: thinking is configured differently per model family, which is why
`crmThinkingConfig()` sits next to it. Opus 5 and Sonnet 5 take adaptive
thinking and reject `budget_tokens` with a 400; Haiku 4.5 is the reverse. Going
back to Opus 5 costs roughly 5x and buys more reliable multi-step reasoning.

Token usage is logged per call. Search Cloud Functions logs for
`[crmAssistant]` to see input, output and cache-read counts.

---

## Configuration

Nothing new to set up. It uses the existing `ANTHROPIC_API_KEY` secret.

Two things must be true before the answers are trustworthy:

1. **The `lastContactedAt` backfill has run** —
   `node scripts/backfill-last-contacted.js`. Firestore range queries silently
   skip documents missing the ordered field, so without it "who has gone cold?"
   returns almost nothing and looks healthy doing it.
2. **The new indexes have finished building** — deploy `firestore:indexes` and
   wait. Until then staleness queries report that a database index is still
   building.
