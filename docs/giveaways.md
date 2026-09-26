# Instagram giveaways

CRM → **Giveaways** (`/giveaways.html`). Runs comment-and-tag giveaways on your
own Instagram posts: one entry for commenting, bonus entries for each friend
tagged, then a weighted random draw recorded on the server.

## Why Instagram comments and tags, not shares

- Meta's APIs report how many times a post was shared, but never who shared
  it. A share-based tally can't be built on the official API.
- Comments come back with the commenter's handle, and a tag is an `@handle`
  in the comment text, so both can be counted exactly.
- Facebook is left out on purpose. Facebook's Page terms ban "tag your
  friends to enter", so the tag rule would put the Page at risk. Instagram
  allows it.

## One-time setup (about 15 minutes)

1. **Switch the account.** Set the Instagram account to **Professional**
   (Business or Creator).
2. **Create the Meta app.** At [developers.facebook.com](https://developers.facebook.com),
   go to My Apps → Create app → **Other** → **Business**.
3. **Add Instagram.** Add the **Instagram** product and choose **API setup
   with Instagram login**.
4. **Generate the token.** Under **Generate access tokens**, add your
   Instagram account and click **Generate token**. Approve
   `instagram_business_basic` and `instagram_business_manage_comments`.
5. **Connect.** Open `/giveaways.html`, paste the token and click
   **Connect**.

**No app review.** Because the app only reads the account of someone who has
a role on the app (you), it runs on Standard Access. The app can stay in
Development mode.

**Where the token lives.** It's stored at `companies/{cid}/private/instagram`,
which no browser can read, owner included. It refreshes itself once it's a
week old, so it won't expire as long as the tool is used at least once every
60 days. If it does expire, the page asks you to paste a new one.

## Running a giveaway

1. **Post it.** Publish the giveaway on Instagram. Suggested copy: "Comment
   to enter. Tag up to 5 friends for a bonus entry each."
2. **Set it up.** Click **New giveaway**, pick the post and set the rules.
   The defaults are 1 entry for commenting, +1 per friend and 5 friends max.
   Set **Entries close** to the deadline in your post.
3. **Sync.** Click **Sync comments** any time to update the leaderboard.
4. **Draw.** After entries close, sync once more, then click **Draw winner**.
   If the winner doesn't respond, use **Draw an alternate**. Earlier winners
   are excluded automatically.
5. **Keep a record.** Click **Export CSV** for an audit trail of every
   entrant, their tags and their odds.

## Rules the tally enforces

- **One base entry per person**, however many times they comment.
- **One bonus per unique friend.** Tagging the same friend in several
  comments counts once. Only the first N friends count, in the order they
  were tagged.
- **Nothing for bad tags.** Tagging yourself, the host account or an
  excluded handle earns nothing.
- **Host and excluded handles can't enter.**
- **Deadline.** Comments outside the entry window are ignored. A late
  comment can't add tags after the deadline.
- **Deleted comments.** If someone deletes their comment, they drop off at
  the next sync.
- **Optional:** require at least one tag to enter, and ignore replies.

The rules live in `functions/index.js` (search "Giveaway: pure helpers").
They're pinned by `tests/giveaway-tally.test.cjs`, and the full flow runs on
the emulators in `tests/giveaway-e2e.test.mjs` (`npm run e2e:giveaway` in
`tests/`).

## Limits

- **API can't verify tagged friends.** It confirms a handle was typed, not
  that it's a real, active person. Look over the winner before announcing.
- **Up to 20,000 comments per sync.** Beyond that the page shows a warning
  and tallies the first 20,000.
- **Spam-filtered comments.** Comments Instagram hides as spam may not be
  returned.

## Legal basics (US)

- **Free entry.** No purchase necessary.
- **Official rules.** Publish rules covering eligibility, dates, how the
  winner is picked and the prize.
- **Meta disclaimer.** State that the promotion isn't sponsored or endorsed
  by Instagram.
- **Big prizes.** If the total prize value is over $5,000, New York and
  Florida require registration and bonding.
