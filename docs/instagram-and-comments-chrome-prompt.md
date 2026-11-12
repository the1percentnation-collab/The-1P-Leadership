# Claude for Chrome prompt: Instagram DMs and comment-to-message

Part two of the inbox automation. Run it **after** the Messenger prompt
(`docs/messenger-automations-chrome-prompt.md`) is live and tested, because it
copies those automations instead of retyping them.

## What it builds

| Piece | Where | What it does |
| --- | --- | --- |
| **Instagram DM mirror** | Instagram DMs | The same 4 conversation starters, instant reply, and 10 keyword replies as Messenger, with links tagged `utm_source=instagram` |
| **Scorecard post** | Facebook Page and Instagram | One post that asks people to comment SCORECARD |
| **Comment-to-message** | That post, on both platforms | Anyone who comments SCORECARD gets a public "check your DMs" reply and a private message with the assessment link |

## Why this is the leverage move

A post reaches people who would never open a chat with the Page. Comment-to-
message turns each comment into a private conversation, and that conversation
lands inside the menu you already built. One post becomes a lead source that
runs without you, and every person it captures sees the assessment, the
membership, and the Alignment Audit.

Comments also signal engagement to the feed, so the post reaches more people
the more it works.

## Tracking

| Source | `utm_source` | `utm_medium` | `utm_campaign` |
| --- | --- | --- | --- |
| Instagram DM menu | instagram | dm | |
| Facebook comment | facebook | comment | scorecard |
| Instagram comment | instagram | comment | scorecard |

---

## The prompt

Copy everything inside the block into Claude for Chrome while logged in to
Facebook as the Page admin.

```
You are helping me extend my Facebook Page's inbox automations in Meta
Business Suite. The Messenger automations are already built and tested. Now I
want the same automations on Instagram DMs, plus a comment-to-message
automation on one post. I am the Page admin and I am asking you to do this in
my browser, phase by phase, in order.

HARD RULES (these override everything else in this prompt):

1. Never send a message in any real customer conversation and never reply to
   a real comment yourself. Only use preview or test tools Business Suite
   provides.
2. Never change, turn off, or delete any existing Messenger automation. You
   only read them.
3. Never publish a post, boost a post, or spend money. When a post is ready
   to publish, show it to me and I will click Publish myself.
4. Never change Page settings, Instagram account settings, ads, billing,
   roles, or anything I do not name below.
5. Do not turn on any Meta AI, "Business AI", or AI-generated reply feature.
   Every reply must be the exact text I give you or the exact text copied
   from the Messenger automations.
6. Copy text exactly. Do not rewrite, shorten, or add emojis. The only change
   allowed when copying from Messenger is the link tracking swap in Phase 2.
7. If a page does not match what I describe (different menu names, a limit,
   a warning, a request for information I have not mentioned), stop and ask
   me instead of guessing.

After each phase, tell me what you found, what you did, and what is next.
Before you click the final Save or Turn on button in any phase, show me the
filled-in form and wait for me to say go.

────────────────────────────────────────────────────────────
PHASE 0: Check the setup (read only)
────────────────────────────────────────────────────────────

Go to https://business.facebook.com/latest/inbox/automations

1. Confirm the selected Page is The One Percent. If you are not sure, list the
   Pages in the switcher and ask me.
2. Tell me whether an Instagram account is connected to this Page, and its
   @handle. If none is connected, STOP and tell me. Do not connect one.
3. List every Messenger automation and whether it is on. I expect:
   - Frequently asked questions (4 questions)
   - Instant reply
   - 10 keyword automations named "1P - ASSESSMENT", "1P - SERVICES",
     "1P - COURSES", "1P - BOOKS", "1P - QUESTION", "1P - PRICE",
     "1P - CANCEL", "1P - CERTIFY", "1P - SPEAKING", "1P - AUDIT"
   Tell me anything missing or off.
4. List every Instagram automation that already exists, and what it says.
   Change nothing.
5. Tell me whether Business Suite offers a comment automation (it may be
   called "Comment to message", "Private reply to comments", or a custom
   automation with a "comments on post" trigger), and whether it works on
   Facebook, Instagram, or both.

Wait for me before Phase 1.

────────────────────────────────────────────────────────────
PHASE 1: Can the Messenger ones just switch on for Instagram?
────────────────────────────────────────────────────────────

Open each Messenger automation and check whether it has a platform toggle or
checkbox for Instagram.

Do not turn it on. Report which ones have the option.

I do NOT want to simply tick Instagram on the Messenger versions, because the
links need different tracking. Phase 2 builds separate Instagram copies. Only
if Business Suite has no way to create separate Instagram automations, stop
and ask me.

────────────────────────────────────────────────────────────
PHASE 2: Build the Instagram copies
────────────────────────────────────────────────────────────

For each Messenger automation, create the Instagram version:

- Same question text, trigger words, and reply text, copied exactly.
- In every link, replace
    utm_source=facebook&utm_medium=messenger
  with
    utm_source=instagram&utm_medium=dm
  Change nothing else in the link.
- Name keyword automations "1P IG - " plus the keyword, for example
  "1P IG - AUDIT".
- If an automation screen has a Messenger checkbox, leave it unchecked on the
  Instagram copy so nothing fires twice.

Order:
1. Frequently asked questions (the 4 conversation starters). Show me, wait.
2. Instant reply. Show me, wait.
3. Keyword automations, two at a time. Show me each pair, wait for go.

If Instagram limits the number of questions, trigger words, or reply length
below what Messenger allowed, stop and tell me exactly what does not fit.

────────────────────────────────────────────────────────────
PHASE 3: Draft the Scorecard post (I publish it myself)
────────────────────────────────────────────────────────────

Open the post composer in Business Suite (Create post). Select BOTH the
Facebook Page and the connected Instagram account. Paste this caption
exactly:

Successful on paper. Misaligned in practice.

Most people can list what they have achieved. Fewer can say whether it lines up with who they are.

The Alignment Scorecard takes about 5 minutes. You get a score and a personal action plan showing where you are aligned and where you are losing ground.

Comment SCORECARD and I will send you the link.

Redefining Success. Realigning Purpose. Releasing Potential.

Do not add media. Instagram requires an image, so tell me when the caption is
in and I will attach the image myself.

Then STOP. Do not click Publish or Schedule. Tell me the post is ready and
wait. I will publish it and tell you when it is live.

────────────────────────────────────────────────────────────
PHASE 4: Comment-to-message on the Scorecard post
────────────────────────────────────────────────────────────

Only after I tell you the post is live.

Open the comment automation from Phase 0. Build one for Facebook and one for
Instagram. Use these settings for both:

  Name:      1P - SCORECARD comments (Facebook)
             1P IG - SCORECARD comments (Instagram)
  Post:      the Scorecard post I just published. Select that specific
             post, not all posts. If you cannot tell which post it is,
             show me the most recent posts and ask.
  Trigger:   comment contains: scorecard
  Public reply to the comment (if the option exists):
             Sent you a message. Check your DMs.

  Private message, Facebook version:
Here is your Alignment Scorecard. About 5 minutes, and you get a score plus a personal action plan.

https://the1pnation.com/assessments/alignment-scorecard?utm_source=facebook&utm_medium=comment&utm_campaign=scorecard

Reply here anytime. A real person reads every message.

  Private message, Instagram version:
Here is your Alignment Scorecard. About 5 minutes, and you get a score plus a personal action plan.

https://the1pnation.com/assessments/alignment-scorecard?utm_source=instagram&utm_medium=comment&utm_campaign=scorecard

Reply here anytime. A real person reads every message.

If Business Suite only allows the trigger "any comment" instead of a
keyword, stop and ask me. If it offers a button on the private message
instead of a plain link, add a button labeled "Take the Scorecard" with the
same link, and keep the text.

Show me each form before saving.

────────────────────────────────────────────────────────────
PHASE 5: Test (no real conversations)
────────────────────────────────────────────────────────────

1. Use any Preview or Test button Business Suite offers on the Instagram
   Instant reply and on one comment automation. Report what it shows.
2. Then tell me to test from my phone with my personal accounts:
   - Instagram: open a new DM with the business account. The 4 buttons
     should appear. Type "price" and check the PRICE reply and that its link
     says utm_source=instagram.
   - Facebook: comment "Scorecard" on the post. I should get a public reply
     and a private message.
   - Instagram: comment "scorecard" on the post. Same check.
   - Comment something without the keyword. Nothing should fire.
   I will tell you what happened.
3. If anything fires twice or not at all, tell me which and stop. Do not
   change anything.

────────────────────────────────────────────────────────────
PHASE 6: Report
────────────────────────────────────────────────────────────

Give me a final list:
- Every automation you created, its platform, name, and whether it is on
- Anything that did not fit Instagram's limits
- Anything you skipped or that looked different from these instructions
- The Messenger automations' state, confirming none were changed
```

---

## After it is live

1. **Pin the post** on both the Page and the Instagram grid so it keeps
   collecting comments after the feed moves on.
2. **Reuse the pattern.** Every future post can carry its own keyword: AUDIT
   on a leadership post, CHAPTER on an I Can't excerpt, COACH on a
   certification post. Add one comment automation per post and you have a
   content library that produces leads on its own.
3. **Answer human replies the same day.** Anyone who writes back after the
   automated message is a warm lead. Leaders and anyone who mentions a team
   get pointed to the Alignment Audit.
