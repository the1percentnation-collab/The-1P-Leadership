# CRM audit, September 2026

A full read of the CRM as it exists in this repository: the contacts board and
card, pipeline, tasks, calendar, dialer, conversations, campaigns, sequences,
the AI assistant, every lead-capture entry point, the Firestore rules, and the
automation tick. Every finding below was verified against the code; each one
carries a file and line reference so it can be fixed without re-discovery.

The audit is scored against the business goal in the brand brief: one Core
annual program plus one keynote, which is a one-client goal. The CRM's job is
to catch every corporate lead, move it from Alignment Audit to engagement to
annual program without anything falling through, and keep the individual
funnel (books, courses, beta) feeding the same record. That lens decides the
priority order.

---

## 1. Verdict

The architecture is better than most home-built CRMs. Email, SMS and calling
are real, the consent model is server-enforced, the AI assistant stages
changes rather than writing them, and the `lastContactedAt` versus
`lastActivityAt` distinction is the right one. The engineering discipline in
the comments and rules is unusually high.

The problems are in the seams. The CRM has excellent parts that do not close
into a loop:

- The highest-intent action on the site, booking a call, writes nothing to
  the CRM.
- A purchase never makes anyone a Customer.
- The corporate form drops the organization name on the floor.
- Automated sequence email ignores real unsubscribes and carries no opt-out.
- The clock that drives every automation fires roughly hourly with two-hour
  gaps, and delays compound on top of that.
- Phone numbers are stored raw but matched in E.164, so every inbound text or
  call from a form lead creates a duplicate contact.
- Deleting a contact leaves its emails, texts, calls, deals, tasks and active
  sequence enrollments behind, and the sequence keeps firing at the ghost.

None of these are hard to fix individually. Together they mean the CRM cannot
currently answer "who is a customer", "who booked a call", or "which corporate
lead came from which organization", which are the three questions that matter
for a $65,000 annual sale.

### The eight fixes that matter most

| # | Fix | Why | Where |
|---|---|---|---|
| 1 | Sequence email must use `isEmailSuppressed()` and carry an unsubscribe footer plus `List-Unsubscribe` | CAN-SPAM exposure on every automated email today | `functions/index.js:10242`, `:10248-10259` vs `:2209`, `:2360-2387` |
| 2 | Stripe purchases, free enrollments, grants and beta approvals must upsert the contact, tag it, set `stage: customer`, and move the deal to the won column | The CRM cannot identify a customer | `functions/index.js:7951-7998`, `:5497`, `:5595`, `:5849`, `:6700-6835` |
| 3 | Book-a-call must create a contact, an appointment and a follow-up task | Highest-intent event is untracked | `public/js/book-a-call.js` (Zoom iframe only) |
| 4 | Alignment Audit form must write `companyName`, plus budget, program date and decision timeline | Corporate leads arrive without their organization | `public/js/corporate.js:51-57`, `functions/index.js:14289-14291` |
| 5 | Normalize phone to E.164 on every write path | Inbound SMS and calls fork contacts and grant consent to the wrong record | `public/js/crm.js:229`, `functions/index.js:1077`, `:14265`, matching at `:8323`, `:8465`, `:9077` |
| 6 | `deleteContact` must cascade to emails, conversations, calls, tasks, opportunities, appointments, enrollments and the member back-pointer | Ghost deals, ghost threads, sequences firing at deleted leads | `functions/index.js:993-997` |
| 7 | Move the tick to Cloud Scheduler or Cloud Tasks; until then compute `nextRunAt` from the scheduled time, not the tick time, and add a send window | Every sequence, reminder and launch is late by one to two hours and drifts | `.github/workflows/crm-tick.yml:21-24`, `functions/index.js:10347` |
| 8 | Turn on App Check (site key is empty) and rate-limit the four public callables that have none | Every public form is an open door that creates contacts and can trigger SMS sequences | `public/js/firebase.js:37`, `functions/index.js:10923`, `:10980`, `:2646`, `:3041` |

---

## 2. Scorecard against HubSpot, GoHighLevel, Close and Pipedrive

Scores are for what exists and works today, out of 5. The comparison column is
what a business at this stage would actually use from those tools.

| Area | Score | What the major CRMs do that this one does not |
|---|---|---|
| Contact record and timeline | 3 | Duplicate detection and merge, custom fields, files, editable notes, purchase and enrollment panels, company or account object for B2B |
| Contacts board | 2.5 | Saved views on the board, bulk actions, multi-select filters, column chooser, inline edit, phone and tag search, pagination |
| Lead capture | 2 | Form builder, UTM and first/last touch, lead routing and assignment, spam protection, auto-task on new lead, native booking page that creates a deal |
| Pipeline | 2.5 | Edit or delete a deal, lost reasons, days in stage, multiple pipelines in the UI, board filters, products or line items, deal-won automation trigger |
| Tasks | 2 | Edit a task, task types, recurring tasks, in-app assignment notification, task calendar view, snooze |
| Calendar and booking | 2.5 | Native booking with availability and buffers, lead-facing confirmation and reminders, no-show tracking, week and day views, per-user calendars |
| Email | 3 | Open and click on the contact for campaigns, scheduling, HTML templates, attachments, per-user signatures, Gmail sync or BCC-to-CRM |
| SMS | 3 | Quiet hours, MMS, scheduled texts, SMS broadcasts, missed-call text-back, HELP keyword |
| Calling | 3 | Recording and consent notice in softphone mode, inbound ringing on all pages, local presence, transfer, transcription |
| Conversations inbox | 2 | Unified email, SMS and calls in one thread, assignment, snooze, unread badge that includes SMS |
| Campaigns | 2.5 | Merge fields in the body, SMS campaigns, per-recipient status, resend to unopened, engagement written to the contact |
| Sequences and automation | 2.5 | Branching, goals that auto-exit, send windows, step analytics, reliable scheduler, outbound webhooks |
| Reporting | 2.5 | Date ranges, stage conversion, velocity, activity leaderboard, export, drill into filtered lists |
| AI assistant | 4 | Ahead of most: staged writes, exact counts, undo, audit log. Missing untrusted-data framing for lead-authored text |
| Compliance and consent | 3 | SMS consent is strong. Email suppression is not applied to sequences, no quiet hours, SendGrid webhook open when unsigned |
| Security rules | 3 | Good on consent and server-written collections. Gaps on `seatCount`, `members` self-insert, opt-out fields, sales-suite shape |
| Performance at scale | 2 | Whole-collection reads on every action, no pagination, no listeners |

---

## 3. Findings by area

Severity: Critical means compliance, money or data loss. High means a sales
rep is misled or a lead is lost. Medium is friction or drift. Low is polish.

### A. Lead capture and revenue signals

Every public form funnels into one callable, `submitLeadForm`
(`functions/index.js:14259-14335`), which calls the single server upserter
`upsertCrmContact` (`:2793-2840`). That part is right. The gaps are around it.

**A1. Purchases never create a customer. Critical.**
The Stripe webhook course branch (`:7951-7998`) only looks up an existing
contact by email, and only if an open opportunity already exists does it mark
that deal `status: won` and log `deal_won`. It does not set `stageId` to the
won stage (the card stays in its old column while the forecast counts it), it
does not move `contact.stage` to `customer`, and the Stripe email is not
lowercased before the equality lookup (`:7955`) while every stored email is.
Product orders (`:7745-7845`), license renewals (`:7714-7743`), free coupon
comps (`:7532`), `enrollFree` (`:5497`), `applyGrant` (`:5595`),
`grantCourseAccess` (`:5849`) and beta approval (`:6700-6835`) write nothing
to the CRM at all. No code anywhere sets `stage: 'customer'`. Subscription
cancellation and payment failure (`:8030`, `:8047`) update
`users/{uid}/purchases` only, so churn never reaches the contact.

**A2. No spam protection on any public form. Critical.**
`RECAPTCHA_V3_SITE_KEY` is empty (`public/js/firebase.js:37`) so App Check
never initializes, and no function calls `enforceAppCheck`. `submitLeadForm`
and `registerServiceInterest` have an IP rate limit of 10 per 10 minutes;
`registerProductInterest` (`:10923`), `joinEarlyAccess` (`:10980`),
`registerForEvent` (`:2646`) and `registerCourseInterest` (`:3041`) have
none. No form has a honeypot. Each junk submission creates a contact, an
activity, an owner email, and can auto-enroll a sequence that sends real SMS.

**A3. The corporate form drops the organization. High.**
`corporate.js:51-57` sends `organization, role, field, team_size, situation`
inside `fields`. `submitLeadForm` (`:14289-14291`) passes only
`name, email, phone, source, tags` to the upserter, so `companyName` stays
null on every corporate lead. The organization lives only in the activity
meta and the notification email. The form also has no budget, program date,
format, or decision-timeline field, which the speaking form on `book.html`
does have.

**A4. Book-a-call is an untracked Zoom iframe. High.**
`public/js/book-a-call.js` embeds `scheduler.zoom.us`. No contact,
appointment, activity, task or notification is created. The only indirect
path is Zoom to the owner's Google Calendar to `syncFromGoogle`
(`:9879-9887`), which links a contact only if one already exists with the
attendee's exact email. Otherwise the appointment lands with
`contactId: null`.

**A5. No UTM, referrer or landing-page capture on any live form. High.**
The only UTM capture in the codebase is in `public/assets/class-form.js:25-30`,
which posts to a separate backend (the `classes` codebase from the
the1pnation-site repo, per `firestore.rules:21`) and never reaches this CRM.
`source` is first-touch only by construction (`:2812-2818` never overwrites
it) with no last-touch field.

**A6. Newsletter signups overwrite real names. High.**
`newsletter-lead.js:16` derives `name` from the email local part, and
`upsertCrmContact` (`:2812`) applies `if (name) patch.name = name` on every
match. A contact named Robert Smith who subscribes becomes `rsmith`. Any
later form can rename a contact the same way.

**A7. Server-created contacts are invisible to "never contacted" queries.
High.**
`createContact` (`crm.js:240-248`) writes `lastContactedAt: null` explicitly
because Firestore equality and range queries skip documents where the field
is absent. `upsertCrmContact` (`:2822-2836`), `importContacts`
(`:1154-1169`), `upsertEventContact` (`:2617-2630`), inbound SMS (`:8326`),
inbound call (`:9082`) and inbound email (`:2024`) all omit it. The AI
assistant's `staleness: never` filter (`:12091`), the pipeline staleness
counts (`:12271`) and the `(stage, lastContactedAt)` indexes therefore miss
every imported, web-form, member and inbound lead. The client-side freshness
pill handles both cases, so the board looks right while the server
under-reports.

**A8. Six intake paths never notify the owner, all leads are unassigned,
and no path creates a follow-up task. Medium.**
`notifyOwnerOfLead` (`:14071`) is called only from `submitLeadForm`.
`registerServiceInterest`, `registerProductInterest`, `joinEarlyAccess`,
`registerForEvent`, `registerCourseInterest` and the three inbound-channel
contact creates send nothing. Every server-created contact has
`ownerUid: null`.

**A9. Consent tag misrepresents scope. Medium, compliance.**
`:14287-14288` pushes the tag `Opt-In: Calls/SMS/Email` when
`consent = smsConsent || marketingConsent`. Ticking only the marketing box
yields a tag claiming SMS and call opt-in. The send gate checks the real
`smsConsent` field, so sends are safe, but any sequence keyed on the tag is
not.

**A10. Duplicate creation races and the manual New Contact form. Medium.**
`upsertCrmContact` is read-then-add with no transaction or deterministic id;
`onUserCreated` and a lead form for the same email can race. The board's
New Contact modal calls `createContact` (`crm.js:217`) with no email lookup,
so an admin typing an existing lead's email creates a duplicate.

**A11. Silent failure paths. Medium.**
`goal-planner-lead.js:10-12` is fire-and-forget. `registerForEvent` skips
the CRM entirely when the event has no resolvable company (`:2690-2697`).
`webinar-register.js:24-28` skips event registration when
`config/booking.webinarEventId` is unset. `registerCourseInterest` and
`registerProductInterest` swallow CRM errors.

**A12. Webinar registration double-upserts. Low.**
`webinar-register.js:51-55` runs `submitLeadForm` then `registerForEvent`;
the second re-finds by email and writes a second activity.

### B. Contacts, data model and multi-tenant

**B1. Phone is stored raw, matched in E.164. High.**
`createContact` stores `data.phone.trim()` (`crm.js:229`); import stores
the raw string (`:1077`); lead forms store `data.phone.trim()` (`:14265`).
Inbound SMS (`:8323`), Telnyx inbound (`:8465`) and inbound voice (`:9077`)
all do `where('phone', '==', normalizePhone(From))`. A contact stored as
`(405) 555-0123` who texts in gets a new contact named after their number,
with `smsConsent: true` granted to the duplicate (`:8523-8535`) while the
real record stays unconsented. Outbound works because `sendSms` normalizes
at send time, so the team only notices when replies fork. The server helper
`normalizePhone` (`:711-720`) already exists; it is just not applied on
write.

**B2. Delete cascade orphans almost everything. High.**
`deleteContact` (`:993-997`) deletes `notes` and `activities` then the
contact. Left behind: the `emails` subcollection, `conversations/{contactId}`
and its `messages`, `calls`, `tasks`, `opportunities`, `appointments`,
`enrollments` (the tick keeps trying to text or email the deleted lead),
`users/{memberUid}.crmContactId` and `betaTesters.crmContactId`. The
confirm text on the card ("This also removes all notes and history",
`contact-page.js:1506`) is untrue for emails, texts and calls. The
opportunities board then shows deals linking to a 404 contact.

**B3. The contact card and tasks page ignore the selected company. High.**
`contact-page.js:96-106` resolves the company as `info.companyId` or the
first company where the user is an admin, `limit(1)`. It never reads
`?companyId=` or the switcher's stored choice, and does not use
`company-resolver.js`, which every other CRM page uses. `tasks.js:201-211`
has the same pattern. An admin of two companies (the financial-services
partner case that `company-resolver.js:6-8` calls out) switches to company B,
clicks any contact, and gets "Contact not found."

**B4. Stage list is defined five times. Medium.**
`STAGES` (`crm.js:16-23`), `DEFAULT_PIPELINE_STAGES` (`crm.js:653-660`,
relabels `customer` as "Won"), `IMPORT_STAGES` (`:1023`), `CRM_STAGES`
(`:11847`), `STAGE_ORDER` (`dialer-core.js:460`, drops `lost`). The pipeline
editor in settings can rename deal stages, but the contact kanban still
renders from the hard-coded list, so the same id shows "Customer" on the
stage badge and "Won" on the deal line of the same card.

**B5. Admin identity is split-brained. Medium.**
The UI gates on `users.role == 'admin'` (`roles.js:47`); the rules gate on
`companies.adminUids` (`firestore.rules:58-62`). `adminUids` is written only
at company creation (`owner.js:80`) and shrunk by revoke; there is no "add
admin" path. `acceptInvite` (`:930`) sets `role: 'user'` on join. A user can
be `role: admin` and not in `adminUids` (empty board, permission errors) or
the reverse (bounced by the client gate). `isAnyAdmin` (`rules:13-18`) also
grants cross-company access to books, courses, products, coupons and orders
to anyone with `role: admin`, including a partner company's admin.

**B6. Import gaps. Medium.**
Dedupe is email-only and rows without email are rejected (`:1060`), so a
conference list of names and phones cannot be imported. Export emits 12
columns; the importer maps 7 (`crm-import.js:35-47`), so Stage, Source, Owner
and Source details are lost on a round trip despite the comment at
`crm-page.js:146-147`. Updating existing contacts bumps `lastActivityAt`
(`:1138`), so a monthly re-import floats every lead to the top of the board.

**B7. `acceptInvite` silently moves a user between companies. Medium.**
`:928-931` overwrites `companyId` unconditionally; the old company's seat
count is never decremented and its `members/{uid}` doc is left behind.

**B8. Smart lists exist but the board cannot use or create them. Medium.**
`crm.js:1650-1746` implements saved filters, seeds three defaults, and the
dialer and sequences pages consume them. The contacts board has no smart-list
dropdown, and `createSmartList` is called only by the seeder, so no custom
list can be made anywhere in the app. The "coldest" sort and
`lastActivityOlderThanDays` filter also run on `lastActivityAt`
(`crm.js:1730-1749`), the field the file's own comment calls dishonest, so
the dialer queue prioritizes the wrong leads.

**B9. Kanban and card friction. Low.**
Drag-and-drop is HTML5 only, so stages cannot be moved by touch
(`crm-page.js:508-548`). `changeStage` writes blindly without checking the
current stage, so two admins moving the same card produce a wrong `from`.
The board's "Text" button enables on `phone && !smsOptedOut` but the composer
it opens blocks on missing `smsConsent` (`crm-page.js:435-437` vs
`contact-page.js:846-849`). `updateContact` logs no activity, so "who changed
this email" is unanswerable. `address` is written by import and member sync
but displayed nowhere. `contact.html` renders the plain topbar instead of the
CRM shell, so the page reps live on has no sidebar, switcher or unread badge.

### C. Communications and compliance

**C1. Sequence email ignores real unsubscribes. Critical.**
`executeSequenceStep` (`:10242`) checks `contact.emailUnsubscribed` and
`contact.unsubscribed`. Nothing writes either field. The unsubscribe
endpoint (`:2180-2188`) and the SendGrid event webhook (`:3394-3401`) write
`emailOptOut: true` and the `Unsubscribed` tag, which `isEmailSuppressed()`
(`:2209`) reads, and which `sendContactEmail` and `sendCampaign` use. The
sequence sender is the one email path that does not. A lead who clicks
Unsubscribe keeps receiving drip email. Sequence email also has no
unsubscribe footer, no `List-Unsubscribe` header, no `reply+` routing
address, no `customArgs`, and no `emails` document (`:10248-10259`), so
replies to it cannot be matched back except for the academy company, opens
and bounces are unattributable, and it appears on the timeline as a
human-sent `manual_email`.

**C2. Softphone calls are never recorded or announced, despite the setting.
High.**
`placeSoftphoneCall` (`dialer-core.js:314-320`) dials PSTN directly via
`device.newCall`; no TeXML is fetched, so `recordingMode` (`:8876-8892`,
`:9017-9030`) applies only to bridge calls. CRM Settings advertises "On, with
a spoken notice (recommended)" with no mode caveat (`crm-settings.js:516-533`).
A rep who believes calls are recorded and announced is wrong for every
default-mode call. Two-party-consent exposure plus a false product promise.

**C3. Inbound calls do not ring on most CRM pages, and an answered inbound
call freezes the dock. High.**
`voiceInboundTwiml` dials the SIP client (`:9139-9148`), which rings only a
registered WebRTC device. `dialer-core.configure()` explicitly does not
build the client (`:190`); `prewarm()` runs only on the dialer page
(`dialer-page.js:632`). A rep working the inbox never hears the call; it
goes to voicemail after 20 seconds. When an inbound call is answered on the
dialer page, `handleIncoming` (`dialer-core.js:473-495`) never creates a
`callDoc`, `recordDisposition` returns early on `!state.callDoc` (`:426-427`),
and the dock is stuck on "Log the outcome" with dead buttons until reload.

**C4. No quiet hours for SMS anywhere. High, TCPA.**
The only `quietHours` reference is the defaults in `dialerSettings()`
(`:8589`). Neither `sendSms` (`:8238`) nor the sequence step (`:10207`) reads
them. A sequence with `delayHours` fires whenever the tick runs, including
2 a.m. The client call warning uses the agent's clock, not the lead's, and
is a `window.confirm` only.

**C5. SendGrid event webhook accepts unsigned payloads when the key is
unset. High.**
`:3503-3517` logs a warning and processes the body. Anyone who can POST
`[{event:'unsubscribe', companyId, email}]` to the public URL can suppress
arbitrary contacts or inflate campaign counters. Every Telnyx webhook fails
closed on Ed25519 by contrast.

**C6. Campaign bodies are never personalized; the From hint is wrong.
High.**
`sendCampaign` (`:2360`) replaces `{{firstName}}` in the subject only, and
an empty name renders "Hi ," . The body is sent raw, so any token in a
campaign body goes out literally to every recipient (`:2390-2400`). The
campaign modal shows "From: the1percentnation@gmail.com"
(`campaigns.js:259`); the server sends from `anthonybrown@the1pnation.com`
(`:66`, `:2403`).

**C7. Campaigns ignore `marketingConsent` and never stamp
`lastContactedAt`. Medium.**
`buildRecipients` (`:2280-2287`) filters only `isEmailSuppressed`; contacts
auto-created from inbound channels or who explicitly declined marketing are
mailed by an "all contacts" campaign. `sendCampaign` (`:2291-2440`) writes
nothing to the contact, so a broadcast to 500 leads leaves all 500 reading
"never contacted" on the dashboard and to the assistant, and no campaign
appears on any timeline. Campaign `customArgs` carry no `contactId`
(`:2379-2384`), so campaign opens and clicks never reach a card.

**C8. Bridge calls mark ring-outs as connected. Medium.**
`voiceBridgeTwiml` (`:9023`) has no `action`, so the status webhook sees only
the agent leg. `CallDuration` is above zero as soon as the rep's cell picks
up, so `:9238` stamps `lastContactedAt` and writes `call_completed` for a
call the lead never answered. `hangUp` in bridge mode always calls
`finishCall('completed')` (`dialer-core.js:401-407`).

**C9. STOP and HELP handling. Medium.**
The consent copy promises "Reply HELP" (`consent-labels.js:11,14`); no HELP
handling exists. `START_WORDS` includes `YES` (`:8500`), so a lead answering
"Yes" to a question is logged as opting in to SMS. No confirmation text is
sent on STOP or START.

**C10. GET unsubscribe is prefetch-vulnerable. Medium.**
`unsubscribe` (`:2157`) suppresses on any method; `unsubscribe.html:64`
fetches it on page load. Outlook SafeLinks and Proofpoint follow links and
will silently unsubscribe corporate contacts, which is precisely the
audience for the annual program.

**C11. Conversations is an SMS inbox, not a unified one. Medium.**
Rows are SMS conversations plus one synthetic row per contact with
`lastEmailAt` (`conversations.js:39-68`); clicking an email row redirects to
the card. Calls are absent. The shell badge counts `emailUnreadCount` only
(`conversations.js:216`); SMS `unreadCount` never reaches the nav badge, and
no notification of any kind fires on inbound SMS.

**C12. Smaller items. Low.**
Voice token never refreshes (`:8647`, `dialer-core.js:126-128`), so a tab
left open silently falls back to `tel:` dialing. `dropVoicemail` (`:9308`)
logs nothing on the call. `actorName: 'You'` is hard-coded on SMS activity
(`:8286`). Campaign counters double-count on webhook retries (`:3372-3376`).
Inbound email threading inspects only the newest email doc (`:2043-2052`).
`hasUnresolved` in `merge-fields.js:66` has no caller, so a template with a
literal `{{appointmentTime}}` can be sent; the server renderer also lacks
`appointmentTime` and `meetLink` (`:10120-10151`).

### D. Automation, sequences and the clock

**D1. The clock is hourly with two-hour gaps, and delays compound. High.**
`crm-tick.yml:21-24` admits observed gaps of ~2 hours; `functions/index.js:10121`
still claims every 15 minutes. `nextRunAt = now + delayHours` (`:10347`) uses
the tick's `now`, not the scheduled time, so a day-1 / day-3 / day-5 cadence
drifts into evenings. There is no send window or business-hours logic in the
sequence engine at all. `processDueEnrollments` is capped at 200 steps per
tick across all companies (`:10289`). Reminders "24h before" become 24 to
26h, and an appointment booked inside 24h is either reminded at the next tick
or, if the tick lands after `startAt`, stamped `remindedAt` without sending
(`:10439`). A real scheduled function failed to deploy on IAM grounds
(`scripts/deploy-functions.sh:38-44`); that grant is the real fix.

**D2. Contact creation counts as a stage change. High.**
`onContactWrittenForSequences` (`:10874`) fires `stage_change` when
`!before`, so every new contact triggers "enters New". CSV import, member
sync, event registration and inbound-email auto-create all create contacts.
A sequence on "enters New" or "any stage" enrolls an entire import and texts
or emails everyone with consent on record. The `_automationSuppressed` flag
(`:10869`) is set only by the AI apply path, never by import.

**D3. A step can re-send after a post-send failure. High.**
The claim transaction (`:10318-10327`) sets a 10-minute lock. The send
happens before the conversation, activity and contact writes
(`:10218-10236`, `:10248-10259`). If any post-send write throws, the catch
(`:10357-10364`) reschedules the same `currentStep` in one hour and the
message goes out again. `runAutomationTick` has a 300-second timeout against
a 10-minute lock and up to 200 serial enrollments, so a timeout after a send
but before the step advances also re-fires it.

**D4. Auto-exit is partial and the UI promises more. High.**
The Sequences page header (`sequences-page.js:38-41`) says a reply, inbound
call, booked appointment, SMS opt-out or DNC flag stops a sequence. Verified:
SMS reply, inbound call, connected or booked disposition, SMS opt-out and DNC
work. Booked appointment does not (`onAppointmentWritten` only syncs Google).
Stage change to `customer` or `lost` does not. Email unsubscribe does not.
Email reply works only via the `reply+` token, which sequence email does not
carry. The `stopOnReply` checkbox (`sequences-page.js:178`, stored by
`crm.js:1801`) is never read by `functions/index.js`; it is decorative.

**D5. Reminder starvation. Medium.**
`sendReminders` (`:10410-10413`, `:10435-10439`) queries
`status == open AND dueAt <= horizon LIMIT 200` then skips rows with
`remindedAt` in code. Reminded overdue tasks stay open and keep occupying the
200 slots; past `scheduled` appointments are never auto-completed. Once 200
such rows exist, no new task or appointment is ever reminded, silently.
Reminder emails also print UTC times (`:10416`, `:10442`), four to five hours
off for a US team.

**D6. Silent skips advance the cadence; edits shift indices. Medium.**
`executeSequenceStep` returns strings like `skipped: no phone` and
`processDueEnrollments` treats any return as success (`:10343-10355`). A
three-step SMS sequence for an unconsented contact "completes" with no
message and no contact-visible record. Steps are addressed by array index
(`:10338-10339`), so reordering or inserting a step mid-flight makes active
contacts repeat or skip one. `deleteSequence` leaves enrollments active
until their next due time.

**D7. Re-enrollment and trigger matching. Medium.**
`autoEnroll` dedupes only against `status == active` (`:10833-10835`) with no
cooldown, so a contact bouncing between stages re-enrolls immediately.
`tag_added` matches case-sensitively (`:10832`) while the assistant's
automation warning matches case-insensitively (`:12385`), so the warning
card can name a sequence the engine will not fire. Tag removal never
un-enrolls.

**D8. AI assistant ingests lead-authored text with no untrusted-data
framing. Medium.**
`execContactDetail` (`:12147-12200`) feeds email bodies, SMS bodies, notes
and disposition notes into tool results with no instruction in the system
prompt (`:12559-12607`) that they are data. Blast radius is limited by
staging, the change-request gate and `textContent` rendering, but an inbound
email can still steer an answer or pad a legitimately staged plan.

**D9. Smaller items. Low.**
A crash mid-apply leaves a plan at `status: applying` forever, which both
apply and revert then refuse (`:12888`, `:13039`). The daily budget is
reserved even for shadowed or failed items. Plan TTL is 15 minutes with no
countdown on the card. CRM mode leaks onto public pages for admins via
`localStorage` (`chatbot.js:46-56`). `enrolledCount` is written as 0 and never
incremented. No test covers the sequence engine, `autoEnroll` or
`sendReminders`; CI runs only the scheduler guard.

### E. Pipeline, tasks, calendar, dashboard

**E1. Future dates render as time-only everywhere. High.**
`fmtDate` (`crm.js:609-624`) computes `diff = now - d` and returns
time-only when `diff < day`. A negative diff passes that test, so every
future due date and close date renders as "09:00 AM" with no day: task rows
(`tasks.js:35`), the card (`contact-page.js:448`, `:521`), dashboard drill
(`crm-dashboard.js:148`) and deal cards (`opportunities.js:43`). A rep cannot
tell when anything is due from any list view.

**E2. Winning a deal changes nothing else. High.**
`setOppStage` (`crm.js:783-802`) writes deal status and logs `deal_won`. It
does not move `contact.stage`, does not fire any sequence trigger (there is
no deal-won trigger in `SEQUENCE_TRIGGERS`, `crm.js:1757`), does not stop
enrollments, and creates no follow-up task. Dragging a contact to Customer
does nothing to its open deals. The dashboard's source conversion and funnel
key on `contact.stage` (`crm-dashboard.js:201`, `:248`), which nothing
sales-side updates, so a source can show "0 customers, $5,000 revenue".

**E3. Deals and tasks cannot be edited after creation. High.**
`updateTask`, `updateOpportunity`, `deleteOpportunity` (`crm.js:773-806`,
`:881-887`) have zero callers. `lostReason` is initialized and never set.
The board's only mutations are create and drag; the tasks page offers
complete, reopen and delete only.

**E4. No lead-facing appointment confirmation or reminder; no no-show
tracking. High.**
Reminders go to the assignee only (`:10403`). `noshow` is referenced
(`calendar.js:58`, `:9977`) and never written. This directly drives the
no-show rate on Alignment Audits.

**E5. Three copies of each modal with drifting defaults. Medium.**
Appointment creation exists in `calendar.js:113-215`,
`contact-page.js:1190-1241` and `dialer-page.js:491-548` with defaults of
now, +1h and +24h and different owners. Task creation exists three times with
the default assignee "me" on two of them and the contact owner on the third.
Deal creation exists twice; `opportunities.js:212` parses the close date as
local noon while `contact-page.js:1125` parses `YYYY-MM-DD` as UTC midnight,
which displays as the previous day in US time zones.

**E6. Google sync imports the entire personal calendar. Medium.**
`syncFromGoogle` (`:9787-9928`) has no filter: every personal event in the
window becomes an appointment with `ownerUid: connectedBy` and
`remindedAt: null`, so the owner gets a 24h reminder email for every dentist
appointment. Unknown attendees do not create contacts. Inbound sync resets
any status other than `completed` to `scheduled` (`:9860`). All-day events
pin to 09:00 UTC (`:9846-9847`). `calendarId` is hard-coded to `primary`.

**E7. Dashboard inconsistencies. Medium.**
Weighted forecast is a flat 0.4 on the dashboard (`crm-dashboard.js:367`)
and per-stage probability on the board (`opportunities.js:35`); the settings
probability editor affects only one. Headline widgets are plain divs; no
page accepts filter query params, so "Overdue: 14" cannot open the overdue
list. No date range, no export, no stage-to-stage conversion, no velocity,
no activity leaderboard.

**E8. Sales-suite rules have no shape validation. Medium.**
`firestore.rules:509-524` allow any admin to write any field on pipelines,
opportunities, tasks and appointments. A forged `googleEventId` on an
appointment makes `onAppointmentWritten` PATCH or DELETE that event on the
connected Google account with `sendUpdates: all` (`:9963`, `:9979`,
`:10022`).

**E9. Smaller items. Low.**
Tasks never appear on the calendar. Events (`events/`) are not on the CRM
calendar and attendees are tags only. Event registrants never get
`lastContactedAt`. `calendar.js:217-220` loads every appointment ever on each
render. Opportunities board throws on an empty pipeline
(`opportunities.js:59`). Drag-and-drop is mouse-only.

### F. Security rules

**F1. Admins can raise their own `seatCount`. High.**
`firestore.rules:392-395` requires only that `adminUids` is unchanged on a
company update. `seatCount` is meant to be owner-only (`owner.js:63/81`) and
`acceptInvite` enforces seats from it (`:911-915`).

**F2. Any signed-in user can self-insert into any company's roster. High.**
`rules:430-431` allow `create, update` on `companies/{cid}/members/{mUid}`
when `request.auth.uid == mUid` for any `cid`, with no check that the user
belongs to that company. That doc is what `listMembers` and
`listCompanyAdmins` read.

**F3. Opt-out fields are client-writable. High, TCPA.**
Only `smsConsent*` keys are frozen (`rules:445-450`). `smsOptedOut`,
`emailOptOut`, `doNotCall`, `emailUnreadCount`, `memberUid`, `ownerUid` are
free. An admin can un-STOP a contact from the console and
`smsSendBlockReason` (`:8225-8236`) will let the text through.

**F4. Enrollment create and delete are unconstrained. Low.**
`rules:585-592` block `currentStep` and `nextRunAt` on update, but `create`
accepts any values and `delete` is allowed, so delete-and-recreate re-fires a
step.

---

## 4. Redundancies

Consolidating these is the fastest way to stop the drift that causes half
the bugs above.

| What | Copies | Consolidate to |
|---|---|---|
| Contact stage list | 5 (`crm.js:16`, `:653`, `functions/index.js:1023`, `:11847`, `dialer-core.js:460`) | One shared module or one Firestore doc read by client and server |
| Contact upsert | 6 (`upsertCrmContact`, `upsertEventContact`, inbound SMS, inbound call, inbound email, client `createContact`) with different defaults | `upsertCrmContact`, with a phone lookup added |
| Lead-form scripts | 8 near-identical files (`book-lead`, `contact-lead`, `newsletter-lead`, `goal-planner-lead`, `book-bonus-lead`, `webinar-register`, `beta-lead`, `corporate`) | One `lead-form.js` driven by `data-form-type` |
| Email senders and opt-out policy | 3 (`sendContactEmail`, `sendCampaign`, sequence step), each with its own suppression rule and headers | One `sendMarketingEmail` seam that always applies `isEmailSuppressed`, footer, `List-Unsubscribe`, `reply+` routing and an `emails` doc |
| Merge-field renderers | 3 (`merge-fields.js`, `renderMergeServer`, ad-hoc in `sendCampaign`) with diverging token lists | One shared token list and a shared test |
| Consent recording | 3 (`recordFormConsent`, inline in `registerProductInterest` and `joinEarlyAccess`, inline in `submitOnboarding`) | `recordFormConsent` |
| Company resolution | 3 (`company-resolver.js`, inline `limit(1)` in `contact-page.js:100` and `tasks.js:205`, wrapper in `crm-page.js:811`) | `company-resolver.js` |
| Appointment, task and deal modals | 3 + 3 + 2 hand-built forms with drifting defaults | One modal module per object |
| Twilio path | `twilioInboundWebhook`, `twilioStatusWebhook`, `voiceOutboundTwiml`, `getTwilio`, `twilioSignatureOk`, the `twilio` npm dependency, STOP/START logic copy-pasted between Twilio and Telnyx webhooks | Delete once the Telnyx cutover is confirmed; keep one keyword handler |
| Freshness bands | `CONTACT_FRESHNESS`, `FRESHNESS_BANDS`, `CONTACTED_DISPOSITIONS` in three files | One |
| Source vocabulary | Client built-ins (4) vs 15+ server free-text values, including `Financial Services` vs `Financial services` in the same function (`:14013` vs `:14018`) | One enum, with `sourceDetail` for the story |
| Waitlist stores | `products/{id}/interests`, `users/{uid}/courseInterests`, plus tags on the contact | Tags on the contact plus one collection |
| Helpers | `deleteCollection` three times in functions; `escapeHtml` three times; timestamp-to-millis inline eight times in `crm.js`; owner-label lookup three times | Shared utils |
| Dead code | `updateTask`, `updateOpportunity`, `deleteOpportunity`, `lostReason`, `noshow`, `enrolledCount`, `lockedAt`, `hasUnresolved`, unused imports in `opportunities.js`, `calendar.js`, `crm-dashboard.js`, `crm-page.js` | Wire up or remove |
| Campaign vs one-step email sequence | Same feature, different plumbing and telemetry | Give sequences the campaign's telemetry, or model a campaign as a one-step sequence |

---

## 5. Disconnect map

What should connect and does not. Each row is a loop that is currently open.

| From | To | State |
|---|---|---|
| Book-a-call (Zoom) | Contact, appointment, task, deal | Not connected |
| Stripe purchase, free enroll, grant, beta approval | Contact tag, `stage: customer`, deal won column, purchases panel | Not connected except a `deal_won` activity when an open deal already exists |
| Subscription cancel or payment failure | Contact | Not connected |
| Alignment Audit form | `companyName`, budget, date | Organization lost |
| Academy member (`users`) | Contact card | Linked server-side both ways (`memberUid`, `crmContactId`); never read by the card, no link from members page |
| Course enrollment, progress, completion, points | Contact card | Completion and review only, as activity rows |
| Affiliate referral | Contact | Not attributed |
| Community activity, certification, chatbot transcripts | Contact | Not connected |
| Deal won | Contact stage, sequence exit, follow-up task | Not connected |
| Contact stage to Customer | Open deals | Not connected |
| Campaign send | Contact timeline, `lastContactedAt`, opens and clicks on the card | Not connected |
| Sequence email | Email thread, Conversations, reply routing | Not connected (activity row only) |
| Booked appointment | Sequence exit | Not connected (UI says it is) |
| Events (`events/`) | CRM calendar, contact attendee list | Tags and activity only |
| Tasks | Calendar | Not shown |
| Dashboard numbers | Filtered list pages | No drill-through |
| Smart lists | Contacts board | Not exposed; no create UI |
| Inbound SMS | Nav badge, owner notification | Not connected |
| Class funnel (`class.html`, separate backend) | CRM | Not connected; it is the only place UTM is captured |

---

## 6. Missing capabilities, prioritized for the annual-program goal

Ordered by what moves a corporate buyer from Alignment Audit to a signed Core
program. Items marked Buy are cheaper to integrate than to build.

**Must have for the corporate funnel**

1. Account (organization) object with multiple contacts, an account owner,
   notes and deals rolled up. Today `companyName` is a free-text string and
   B2B selling has no account view.
2. Native booking that creates the contact, the appointment, a deal and a
   task, sends the lead a confirmation and a reminder by email and SMS, and
   records no-shows. Buy: keep Zoom or Calendly for availability, but wire
   its webhook into the CRM. Build: the CRM already has appointments and
   reminder plumbing.
3. Corporate intake fields: organization, role, team size, budget range,
   program or event date, format, decision timeline, and an auto-created
   "send scorecard within 48 hours" task, since the brand's sales path
   promises exactly that.
4. Lifecycle stage separate from deal stage: subscriber, lead, MQL, SQL,
   opportunity, customer, evangelist. One axis today (`stage: new` on every
   create).
5. Deal edit, lost reasons, days in stage, a deal-won trigger, and a
   forecast by expected close month.
6. Lead routing and assignment. Every server-created lead is unowned.
7. UTM and first/last touch on every form, reported by source on the
   dashboard.

**Must have for trust in the data**

8. Duplicate detection and merge, by email, normalized phone and fuzzy name.
9. Bulk actions on the board: tag, stage, owner, enroll, delete, export
   selected.
10. Saved views on the board (the smart-list layer already exists).
11. Custom fields on the contact.
12. Purchases and enrollments panel on the card, driven by the existing
    `memberUid` link.

**Should have**

13. Reliable scheduler (Cloud Scheduler or Cloud Tasks) with send windows and
    contact-timezone sending.
14. Sequence branching on replied, opened, booked; goals that auto-exit;
    step-level analytics.
15. Unified inbox with email, SMS and calls in one thread, assignment and
    snooze.
16. Campaign personalization, SMS campaigns, resend to unopened, engagement
    written to the contact.
17. Reporting: date ranges, stage conversion, velocity, activity leaderboard,
    appointment set/held/no-show, export.
18. Outbound webhooks or Zapier for anything the CRM should push elsewhere.
19. Email sync (Gmail BCC-to-CRM at minimum) so the founder's own outreach
    lands on the card.

**Nice to have**

20. Lead scoring from engagement, call transcription and summary, local
    presence, MMS, WhatsApp, files on the contact, keyboard shortcuts,
    column chooser, pagination and snapshot listeners for scale.

---

## 7. What works well and should not be touched

- `lastContactedAt` vs `lastActivityAt` as a model, the definition at
  `functions/index.js:749-771`, the backfill script, and the assistant prompt
  all agree. Only campaigns are missing.
- SMS consent: server-frozen fields, `recordSmsConsent`, a single
  `smsSendBlockReason` gate used by manual and sequence sends, verbatim
  consent text stored with an activity trail, and tests pinning it.
- Telnyx webhook verification: Ed25519 over the raw body, replay window,
  fail-closed, real-keypair tests.
- Do-not-call enforced at four layers, including `authorizeCall` returning a
  structured `details.blocked` flag.
- 1-on-1 email: per-contact `reply+` routing, thread keys, monotonic delivery
  status, read-only `emails` collection, quoted-reply stripping.
- Campaign unsubscribe: per-contact tokens, footer, `List-Unsubscribe` and
  one-click headers, suppression on unsubscribe and spam events.
- The AI assistant's containment: no `companyId` in tool schemas, executors
  over a scope closure, no collection-group reads, exact counts via
  aggregations, staged plans server-written only, transactional apply,
  fail-closed daily cap, inverse-delta undo, sequence fan-out warning, and
  the shadowed stage-change evaluation set on the AI Activity page.
- Sequence claim transaction plus the workflow concurrency group prevents the
  classic overlapping-tick double send.
- Google Calendar sync: hash-based loop prevention, single-use CSRF states,
  refresh tokens in a rule-denied path, `invalid_grant` surfaced for
  reconnect, 410 sync-token recovery, opportunistic watch renewal.
- CSV import UX: header auto-map, binary sniffing, preview with in-file
  dupes, chunked callable with per-chunk failure isolation and a
  downloadable problem-rows file; the parser handles BOM, quoted newlines,
  CRLF and delimiter sniffing.
- Dialer dispositions drive stage advancement and follow-up modals, a
  genuinely GoHighLevel-like loop.
- Prev/Next through the exact filtered, sorted board order with
  call-in-progress and unsaved-edit guards.
- Company switcher design in `company-resolver.js`, just not adopted on two
  pages.
- The tick is honest: per-step error capture, a dry run that provably writes
  nothing, and a workflow that fails loudly when the secret is missing.

---

## 8. Recommended order of work

Three passes. Each pass is a set of small, independently shippable PRs.

**Pass 1, this week: stop the bleeding.** Compliance and data integrity.
Nothing here needs a design decision.

1. Sequence email: use `isEmailSuppressed`, add footer and
   `List-Unsubscribe`, use `replyAddressFor`, write the `emails` doc, add
   `customArgs`. (C1)
2. Normalize phone to E.164 in `createContact`, `updateContact`,
   `importContacts`, `submitLeadForm`, `upsertCrmContact`, and add a phone
   lookup to the upserter. Backfill existing contacts. (B1)
3. `deleteContact` cascade, and stop enrollments first. (B2)
4. Rules: freeze `seatCount` for non-owners, scope `members` self-writes to
   the user's own company, freeze `smsOptedOut`, `emailOptOut`, `doNotCall`
   to server writes, validate `googleEventId`. (F1 to F3, E8)
5. SendGrid webhook fail-closed when the key is unset. (C5)
6. App Check site key, `enforceAppCheck` on the public callables, rate limits
   on the four that lack them, honeypot field on every form. (A2)
7. `fmtDate` handles future dates. (E1)
8. Reminder query: add `remindedAt == null` to the query or auto-complete
   past appointments; format times in the company timezone. (D5)
9. Compute `nextRunAt` from the scheduled time; move the send before the
   post-send writes into a claim-then-write order that marks the step
   advanced before sending, or record a `sentAt` so a retry skips the send.
   (D1, D3)
10. Do not fire `stage_change` on create for import and sync paths; set
    `_automationSuppressed` from `importContacts` and `syncMemberToCrm`. (D2)
11. `contact.html` and `tasks.js` adopt `company-resolver.js`. (B3)
12. Newsletter and other forms stop overwriting an existing name. (A6)
13. Write `lastContactedAt: null` on every server create path. (A7)

**Pass 2, next two to four weeks: close the revenue loop.** This is what the
annual-program goal needs.

1. Stripe, `enrollFree`, `applyGrant`, `grantCourseAccess`, beta approval and
   subscription events all call one `recordCustomerEvent` that upserts the
   contact, tags it (`Customer`, `Purchased: <slug>`, `Enrolled: <slug>`),
   sets `stage: customer`, moves the deal to the won stage, and logs it.
   Lowercase the Stripe email. (A1)
2. Booking: replace or wrap the Zoom iframe with a flow that creates the
   contact, appointment, deal and a "send scorecard within 48h" task, sends
   the lead a confirmation and reminder, and records no-shows. (A4, E4)
3. Corporate form: write `companyName`, add budget, date, format and
   timeline, notify the owner, auto-assign. (A3, A8)
4. Deal won moves the contact, stops enrollments, fires a `deal_won`
   sequence trigger, and creates the next-step task. Deal edit, delete and
   lost reasons. (E2, E3)
5. Purchases and enrollments panel on the card via `memberUid`; link from
   the members page to the contact. (Disconnect map)
6. Campaign sends stamp `lastContactedAt`, log a `campaign` activity, carry
   `contactId` in `customArgs`, and merge fields in the body. (C6, C7)
7. UTM and referrer capture in the shared lead-form script, stored as
   `firstTouch` and `lastTouch` on the contact. (A5)
8. Smart lists on the contacts board with a create and edit UI; sort and
   filter on `lastContactedAt`. Bulk actions. (B8)
9. Softphone recording via a TeXML bridge, or an honest setting label. Build
   the WebRTC client on every CRM page so inbound rings, and give inbound
   calls a `callDoc`. (C2, C3)
10. Quiet hours enforced server-side for SMS, keyed to the contact's area
    code until a timezone field exists. (C4)

**Pass 3, next quarter: the account layer and reporting.**

1. Organizations collection with contacts, deals, notes and an owner. Account
   view. Target-account list for the corporate offer.
2. Lifecycle stage separate from deal stage.
3. Cloud Scheduler tick with send windows and contact timezone.
4. Sequence branching, goals, step analytics, `stopOnReply` honored, booked
   appointment and won/lost exits.
5. Unified inbox with calls and email threads, assignment, SMS unread on the
   badge, notification on inbound.
6. Dashboard: date ranges, stage conversion, velocity, activity leaderboard,
   appointment set/held/no-show, drill-through, export.
7. Duplicate detection and merge tool. Custom fields.
8. Consolidate the redundancies in section 4, delete the Twilio path, add
   engine tests to CI.

---

## 9. Method

Five parallel deep reads, one per area, each reading its files in full and
reporting only with file and line references, followed by direct verification
of every Critical and High finding against the working tree at commit
`580ac4b`. Files read: the CRM data layer and pages under `public/js/`, every
CRM HTML page, `functions/index.js` in full across the five slices,
`firestore.rules`, `firestore.indexes.json`, the workflows, the scripts, the
docs and the tests. Nothing in this report is inferred from documentation
alone; where docs and code disagree, the code is what is reported.
