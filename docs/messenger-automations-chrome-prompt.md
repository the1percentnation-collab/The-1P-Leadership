# Claude for Chrome prompt: Facebook Messenger automations

Sets up the Page inbox so every new conversation gets a clear next step
without anyone typing. Built in Meta Business Suite with its own automation
tools, so there is no code, no app review, and nothing to deploy.

## What it builds

| Piece | When it fires | What it does |
| --- | --- | --- |
| **4 conversation starters** (Business Suite calls them "Frequently asked questions") | Someone opens a new chat with the Page | Shows four tappable buttons: free assessment, services, courses and books, questions |
| **Instant reply** | Someone types a first message instead of tapping | Thanks them, links the assessment, lists one-word replies |
| **10 keyword replies** | A message contains a trigger word | Answers the question and links the right page |

Every link carries `utm_source=facebook&utm_medium=messenger`, so Messenger
traffic shows up as its own line in analytics. That tells you, within a month,
whether this inbox produces assessments, members, and Alignment Audits.

## Why the menu is built this way

The money path is the **AUDIT** keyword and the "See our services" button.
Both route leaders to the free Alignment Audit, which is the first step toward
an annual program. Individuals get pointed to the assessment, which feeds the
membership. Nobody gets a rate card in a DM; corporate pricing is always
"start with the Audit."

## Relationship to the existing Messenger webhook

The store's invoice feature (`docs/messenger-setup.md`) listens to the same
Page through the `metaMessengerWebhook` function. It only records who wrote
and never auto-replies, so it does not conflict with these automations. If
automations ever stop firing, check Meta's **Advanced messaging** settings: an
app set as the Page's primary receiver can take over the conversation from
Business Suite.

---

## The prompt

Copy everything inside the block into Claude for Chrome while logged in to
Facebook as the Page admin.

```
You are helping me set up automated replies for my Facebook Page's Messenger
inbox in Meta Business Suite. I am the Page admin and I am asking you to do
this in my browser, phase by phase, in order.

HARD RULES (these override everything else in this prompt):

1. Never send a message in any real customer conversation. Only use preview
   or test tools that Business Suite provides.
2. Never delete, turn off, or overwrite an existing automation without
   showing me what it says and getting a yes from me first.
3. Never change Page settings, ads, billing, roles, Instagram settings, or
   anything I do not name below. If an automation screen has a checkbox to
   also apply it to Instagram, leave it unchecked.
4. Do not turn on any Meta AI, "Business AI", or AI-generated reply feature.
   Every reply must be the exact text I give you.
5. Type the reply text exactly as written below, including line breaks and
   links. Do not rewrite, shorten, or add emojis.
6. If a page does not match what I describe (different menu names, a limit
   lower than what I need, a warning, a request for information I have not
   mentioned), stop and ask me instead of guessing.

After each phase, tell me what you found, what you did, and what is next.
Before you click the final Save or Turn on button in any phase, show me the
filled-in form and wait for me to say go.

────────────────────────────────────────────────────────────
PHASE 0: Find the right Page and read what exists (read only)
────────────────────────────────────────────────────────────

Go to https://business.facebook.com/latest/inbox/automations

1. Tell me which Page is selected in the top-left switcher and list every
   other Page I can switch to. Ask me which one is The One Percent before
   going further.
2. On the Automations page, list every automation that exists, whether it is
   on or off, and what its reply says. Change nothing.
3. Tell me the maximum number of "Frequently asked questions" Business Suite
   allows for Messenger. I need 4.

Wait for me before Phase 1.

────────────────────────────────────────────────────────────
PHASE 1: Conversation starters ("Frequently asked questions")
────────────────────────────────────────────────────────────

Open the "Frequently asked questions" automation for Messenger. If it already
has questions, show them to me and wait. Otherwise add these four, in this
order. Each one is a question (the button text) and an automated response.

--- Question 1 ---
Take the free assessment

--- Response 1 ---
Good place to start.

The Alignment Scorecard takes about 5 minutes. You get a score and a personal action plan that shows where you are aligned and where you are losing ground.

https://the1pnation.com/assessments/alignment-scorecard?utm_source=facebook&utm_medium=messenger

Want a different focus? There are free assessments on purpose, leadership, burnout, money mindset, and more:
https://the1pnation.com/assessments?utm_source=facebook&utm_medium=messenger

--- Question 2 ---
See our services

--- Response 2 ---
The One Percent helps people who are successful on paper but misaligned in practice. Here is how we work with you:

For leaders and teams: keynotes, workshops, intensives, retreats, and 12-month leadership programs. It starts with a free 45-minute Alignment Audit and a one-page written scorecard within 48 hours.
https://the1pnation.com/corporate?utm_source=facebook&utm_medium=messenger

Booking a speaker:
https://the1pnation.com/speaking?utm_source=facebook&utm_medium=messenger

For individuals: courses, live sessions, and coaching.
https://the1pnation.com/start?utm_source=facebook&utm_medium=messenger

Reply AUDIT and a person will follow up about your team.

--- Question 3 ---
Start a course or get the books

--- Response 3 ---
Courses: The One Percent Membership opens every self-paced course, The One Percent Brief, and the member toolkit. Founding rate is $29 a month, cancel anytime.
https://the1pnation.com/membership?utm_source=facebook&utm_medium=messenger

Books by Anthony Brown Sr., including I Can't and How to Work Less and Gain More:
https://the1pnation.com/books?utm_source=facebook&utm_medium=messenger

Read a free preview of I Can't:
https://the1pnation.com/icantpreview?utm_source=facebook&utm_medium=messenger

The I Can't audiobook, $9.99:
https://the1pnation.com/icantaudio?utm_source=facebook&utm_medium=messenger

--- Question 4 ---
I have a question

--- Response 4 ---
Ask away. A real person reads every message and will reply here.

For a quick answer now, reply with one word:

PRICE for what things cost
CANCEL for membership and cancellation
CERTIFY to become a certified coach
SPEAKING to book Anthony for an event
AUDIT for a free session with your team

Show me all four before saving.

────────────────────────────────────────────────────────────
PHASE 2: Instant reply
────────────────────────────────────────────────────────────

Open the "Instant reply" automation for Messenger. If it already exists, show
me its current text and wait. Otherwise set it to:

Thanks for reaching out to The One Percent. A real person reads every message and will reply here.

While you wait, most people start with the free 5-minute assessment:
https://the1pnation.com/assessments/alignment-scorecard?utm_source=facebook&utm_medium=messenger

Or reply with one word:
SERVICES for coaching, speaking, and team programs
COURSES for the membership
BOOKS for Anthony's books
QUESTION for quick answers

If there is a setting for when it fires, choose the option that sends it on a
person's first message (not every message). Show me the form, then wait.

────────────────────────────────────────────────────────────
PHASE 3: Keyword replies
────────────────────────────────────────────────────────────

Find the keyword automation (it may be called "Custom keywords", "Keywords",
or "Create custom automation" with a keyword trigger). Create one automation
per row below, for Messenger only. Name each one "1P - " plus the keyword
name, for example "1P - ASSESSMENT".

Add every trigger word listed. If Business Suite limits the number of trigger
words per automation, keep them in the order given and tell me which ones did
not fit.

Do them in batches: build the first two, show me, and wait for my go before
building the rest.

--- 1P - ASSESSMENT ---
Triggers: assessment, scorecard, quiz, free assessment
Reply:
Here is the free Alignment Scorecard. About 5 minutes, and you get a score plus a personal action plan.
https://the1pnation.com/assessments/alignment-scorecard?utm_source=facebook&utm_medium=messenger

--- 1P - SERVICES ---
Triggers: services, coaching, coach, work with you
Reply:
For leaders and teams: keynotes, workshops, intensives, retreats, and 12-month leadership programs, starting with a free Alignment Audit.
https://the1pnation.com/corporate?utm_source=facebook&utm_medium=messenger

For individuals: courses, live sessions, and coaching.
https://the1pnation.com/start?utm_source=facebook&utm_medium=messenger

--- 1P - COURSES ---
Triggers: courses, course, membership, member
Reply:
The One Percent Membership opens every self-paced course, The One Percent Brief, and the member toolkit. Founding rate is $29 a month or $290 a year, cancel anytime.
https://the1pnation.com/membership?utm_source=facebook&utm_medium=messenger

--- 1P - BOOKS ---
Triggers: books, audiobook, i can't, ebook, paperback
Reply:
Anthony's books, including I Can't and How to Work Less and Gain More:
https://the1pnation.com/books?utm_source=facebook&utm_medium=messenger

Free preview of I Can't:
https://the1pnation.com/icantpreview?utm_source=facebook&utm_medium=messenger

Audiobook, $9.99:
https://the1pnation.com/icantaudio?utm_source=facebook&utm_medium=messenger

--- 1P - QUESTION ---
Triggers: question, questions, faq
Reply:
Ask away. A real person reads every message and will reply here.

For a quick answer now, reply with one word: PRICE, CANCEL, CERTIFY, SPEAKING, or AUDIT.

--- 1P - PRICE ---
Triggers: price, pricing, cost, how much
Reply:
Membership: $29 a month or $290 a year at the founding rate (first 100 members), then $39 a month.
I Can't audiobook: $9.99.
Coach certification: tuition starts at $1,997, with payment plans.

Speaking and team programs are scoped to your goals. The first step is a free Alignment Audit:
https://the1pnation.com/corporate?utm_source=facebook&utm_medium=messenger

--- 1P - CANCEL ---
Triggers: cancel, cancellation, refund
Reply:
You can cancel your membership anytime from the membership page. It stays open until the end of the period you already paid for, and nothing renews after that. Courses and books you bought on their own stay yours.
https://the1pnation.com/membership?utm_source=facebook&utm_medium=messenger

Anything else, reply here and a person will help.

--- 1P - CERTIFY ---
Triggers: certification, certify, certified, clc, become a coach
Reply:
The 1P Certified Life Coach program trains you to coach with the A.L.I.G.N. client program, licensed workbook, and Alignment Assessment. Tuition starts at $1,997, with payment plans. Members get up to three months of dues credited toward it.
https://the1pnation.com/clc?utm_source=facebook&utm_medium=messenger

--- 1P - SPEAKING ---
Triggers: speaking, speaker, keynote, conference
Reply:
Anthony speaks at conferences, company kickoffs, retreats, and community events. Tell us the date, the audience, and what you want people to walk out with:
https://the1pnation.com/speaking?utm_source=facebook&utm_medium=messenger

--- 1P - AUDIT ---
Triggers: audit, alignment audit, my team, our team, my company, organization
Reply:
The Alignment Audit is a free 45-minute working session on Zoom, with your whole team or with you one-on-one. Within 48 hours you get a one-page written scorecard showing where your team is aligned and where it is losing ground, whether or not we work together.

Book it here:
https://the1pnation.com/corporate?utm_source=facebook&utm_medium=messenger

Or reply with your name, company, and team size and a person will reach out.

────────────────────────────────────────────────────────────
PHASE 4: Test (no real conversations)
────────────────────────────────────────────────────────────

1. If Business Suite offers a "Preview" or "Test" button on any of these
   automations, use it for Instant reply, one conversation starter, and the
   AUDIT keyword. Report what the preview shows.
2. Then tell me to test from my phone: open Messenger with my personal
   Facebook profile (not the Page), start a new chat with the Page, and
   check that:
   - the four buttons appear before I type anything
   - tapping "I have a question" shows the PRICE/CANCEL/... list
   - typing "price" returns the PRICE reply
   - a first message like "hi" returns the Instant reply exactly once
   I will tell you what happened.
3. If any reply fires twice (for example Instant reply plus a keyword on the
   same first message), tell me which ones and stop. Do not change anything.

────────────────────────────────────────────────────────────
PHASE 5: Report
────────────────────────────────────────────────────────────

Give me a final list:
- Every automation you created, its name, and whether it is on
- Any trigger words that did not fit
- Anything you skipped or that looked different from these instructions
- Anything that already existed before you started, and its state now
```

---

## After it is live

1. **Watch the numbers for 30 days.** In analytics, filter by
   `utm_medium=messenger`. Assessments started, memberships, and Audit
   bookings are the three that matter.
2. **Check the inbox daily.** Automations open the door; a person still
   closes it. Any reply to the AUDIT keyword is a lead toward an annual
   program and gets a same-day answer.
3. **Mirror to Instagram and add comment-to-message.** Once this is tested,
   run `docs/instagram-and-comments-chrome-prompt.md`. It copies these
   automations to Instagram DMs and sets up a Scorecard post where anyone who
   comments SCORECARD gets the assessment link by DM.
