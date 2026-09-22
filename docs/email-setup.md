# Email: sending, receiving, and the provider behind it

Every email in the platform comes from **anthonybrown@the1pnation.com** and
goes through one seam in `functions/index.js`: `sendEmail()` for a single
message and `sendEmailBatch()` for many. Which provider that seam uses is
decided by one environment variable.

| `EMAIL_PROVIDER` | Provider | Key |
| --- | --- | --- |
| unset or `sendgrid` | SendGrid (`@sendgrid/mail`) | `SENDGRID_API_KEY` (Secret Manager) |
| `telnyx` | Telnyx Email API (REST) | `TELNYX_API_KEY` (the same key the SMS path uses) |

Because it is one variable, the cutover is a config change and the rollback is
the same change in reverse. No code edit, no redeploy of logic.

**Inbound replies are still SendGrid Inbound Parse.** Outbound and inbound are
independent, and moving inbound means changing an MX record, so it is a
separate step. Section 5 covers it.

---

## What needs setup

| Capability | Needs |
| --- | --- |
| Sending at all | A key for the active provider |
| Landing in the inbox rather than spam | Domain authentication for `the1pnation.com` **at the active provider** |
| Receiving replies onto the contact card | `INBOUND_EMAIL_DOMAIN` + `INBOUND_EMAIL_TOKEN` + an MX record + an Inbound Parse host |

Authentication does not carry across providers. A domain verified in SendGrid
means nothing to Telnyx: each signs with its own DKIM keys, so the records must
exist for whichever one is sending. Both sets can coexist in DNS, which is what
makes the switch reversible.

> **Never send as `@gmail.com`.** Google publishes a strict DMARC policy for
> its own domain and no third party can DKIM-sign mail as `gmail.com`, so those
> sends fail alignment by design and land in spam or get rejected. That is why
> the from address is a `the1pnation.com` alias.

---

## 0. Switching to Telnyx

In order. Do not set `EMAIL_PROVIDER=telnyx` before the domain verifies, or
every send is rejected.

1. **Authenticate the domain.** Telnyx Mission Control → **Email → Domains →
   Add Domain**, enter `the1pnation.com`. Telnyx returns SPF, DKIM and DMARC
   records. Add them at your DNS host alongside the SendGrid records, which
   stay put so rollback works.
2. **Wait for verification.** The dashboard shows the domain verified once DNS
   propagates. Telnyx then watches for DNS drift, which is the failure mode
   nobody catches by hand.
3. **Confirm the key.** `TELNYX_API_KEY` is already a repository secret for
   SMS. The same bearer token covers the Email API, so there is nothing new to
   create.
4. **Flip the switch.** Add a repository secret `EMAIL_PROVIDER` with the value
   `telnyx`, then re-run *Deploy Firestore rules + Storage rules + Cloud
   Functions*. The workflow writes it into `functions/.env`.
5. **Send one real test.** Grant course access to an address you control, or
   send from a contact card, and confirm it arrives. Check Mission Control →
   Email for the delivery event.
6. **Warm up.** A new sending domain has no reputation. Send a few small,
   expected batches before a large campaign; a first send to 900 addresses is
   how a new domain gets throttled.

**Rollback:** set `EMAIL_PROVIDER` back to `sendgrid` and re-run the deploy.
Nothing else changes, because nothing else moved.

---

## 1. Authenticate the sending domain in SendGrid

Only needed while `EMAIL_PROVIDER` is `sendgrid` (the default). For Telnyx, see
section 0 above.

SendGrid → **Settings → Sender Authentication → Authenticate Your Domain**.

1. Choose your DNS host, enter `the1pnation.com`, and turn on *automated
   security* (SendGrid then manages the DKIM rotation).
2. SendGrid returns three CNAME records. Add them at your DNS host.
3. Click **Verify**.

Skipping this is the single most common reason CRM email goes to spam: mail
sent as `@the1pnation.com` without DKIM/SPF alignment fails DMARC at Gmail and
Outlook.

This does **not** touch your MX records, so the existing mailbox keeps working.

---

## 2. Set the sending identity in the CRM

**CRM → Settings → Email**:

- **From address** — `anthonybrown@the1pnation.com`
- **From name** — `Anthony Brown`
- **Reply-to** — the fallback used only when inbound parse is off
- **Forward inbound replies to** — optional; a copy of every reply to a real
  mailbox, so the CRM is not the only place it exists
- **Signature** — appended after a `--` separator

Blank fields fall back to the defaults compiled into the functions, so a
half-filled form never silently breaks sending.

---

## 3. Turn on receiving (Inbound Parse, SendGrid)

Replies route by address, not by guesswork: every outbound CRM email carries

```
Reply-To: reply+<companyId>.<contactId>@reply.the1pnation.com
```

so a reply lands on the exact contact card it came from, even when the lead
writes from a different address than the one on file.

### 3a. MX record

Add at your DNS host:

| Host | Type | Priority | Value |
| --- | --- | --- | --- |
| `reply` | MX | 10 | `mx.sendgrid.net` |

> **Use a subdomain.** Pointing the MX of `the1pnation.com` itself at SendGrid
> would take the real mailbox offline. `reply.the1pnation.com` is a separate
> mail host that only the CRM uses.

### 3b. Generate the webhook token

```bash
openssl rand -hex 32
```

Add it as a GitHub repository secret (**Settings → Secrets and variables →
Actions**):

- `INBOUND_EMAIL_TOKEN` — the value above
- `INBOUND_EMAIL_DOMAIN` — `reply.the1pnation.com`

Then re-run the *Deploy Firestore rules + Storage rules + Cloud Functions*
workflow so the functions pick them up.

### 3c. Point Inbound Parse at the webhook

SendGrid → **Settings → Inbound Parse → Add Host & URL**:

- **Receiving domain**: `reply.the1pnation.com`
- **Destination URL**:
  `https://us-central1-the-1p-leadership.cloudfunctions.net/inboundEmailWebhook?key=<INBOUND_EMAIL_TOKEN>`
- **POST the raw, full MIME message**: leave OFF (the parser reads the parsed
  fields)
- **Check incoming emails for spam**: ON (the score is stored on the message)

---

## 4. Verify

1. Open any contact with an email address, click **Email**, send a test to an
   address you control.
2. The message appears in the timeline immediately, and flips to `delivered`
   then `opened` as SendGrid reports back.
3. Reply from that address. Within a few seconds the reply appears in the same
   thread on the card, badged **New**.
4. Hit **Reply** on the thread to continue it.

If a reply does not arrive, in order:

- `dig MX reply.the1pnation.com` should return `mx.sendgrid.net`
- Cloud Functions logs for `inboundEmailWebhook` — a `403` means the `?key=`
  does not match `INBOUND_EMAIL_TOKEN`, and `inbound email not configured`
  means the token is not set on the deployed function at all
- SendGrid → Activity Feed confirms the mail reached SendGrid

---

## 5. What is still on SendGrid

Two things, both inbound, both independent of the outbound switch:

- **Reply capture.** `reply.the1pnation.com` has an MX record pointing at
  `mx.sendgrid.net`, and `inboundEmailWebhook` parses what SendGrid posts.
  Moving this to a Telnyx inbox means a new MX record and a new webhook
  handler, and while the MX is changing, replies can be lost. Do it on its own,
  not alongside the outbound cutover.
- **Delivery events.** `sendgridEventWebhook` records delivered, opened,
  clicked and bounced on the CRM timeline. Mail sent through Telnyx does not
  reach it, so while `EMAIL_PROVIDER=telnyx` those timelines show the send but
  not what happened next. A Telnyx email-events webhook is the fix; the
  metadata it needs (`companyId`, `contactId`) is already attached to every
  message.

Neither blocks sending. Both are the next piece of work.

---

## How it is wired

```
Contact card ──sendContactEmail──▶ SendGrid ──▶ lead's inbox
                    │                                 │
                    ▼                                 │ reply
   companies/{cid}/contacts/{id}/emails               ▼
                    ▲                    reply+cid.contactId@reply.the1pnation.com
                    │                                 │
                    └──inboundEmailWebhook◀── SendGrid Inbound Parse
```

- **`companies/{cid}/contacts/{id}/emails`** holds both directions, grouped by
  `threadKey`. Every document is written by a Cloud Function through the Admin
  SDK; Firestore rules make the collection **read-only to clients**, so a
  signed-in admin cannot forge a reply from a lead or edit what was sent.
- **Delivery state** (`delivered`, `opened`, `bounce`, `spam`) is patched onto
  each sent message by `sendgridEventWebhook` and never walks backwards, since
  SendGrid delivers events out of order.
- **Inbound HTML is stored but never rendered.** The timeline draws the plain
  text, escaped, so untrusted remote markup has no path into the page.
- **Attachments are dropped.** The parser reads the message text and skips any
  part with a filename, so a lead who replies with a PDF has their words
  captured but not the file. Set *forward inbound replies to* if attachments
  matter to you — the forwarded copy is not a workaround either, so treat this
  as a known limit.
- **Nothing badges an unread reply outside the card yet.** `emailUnreadCount`
  is written to the contact document, but the CRM contact list does not read
  it. Today a reply is discovered by opening the card or by the forwarded copy.
- **An inbound reply stops any running sequence** for that contact, the same
  rule as an inbound text: no automated cadence fires over a live conversation.
- **Unsubscribes are honored on 1-on-1 sends**, not just campaigns.

## Security notes

- Inbound Parse does not sign its requests. The shared token in the URL is the
  whole access control, so treat it like a password: rotate it by changing the
  GitHub secret and the Inbound Parse destination URL together.
- The webhook always answers `200`, even on an internal error. SendGrid retries
  hard, and a retry storm on a parse bug would replay the same message onto a
  card dozens of times.
- An inbound message from an unknown sender creates a new contact tagged with
  source `Email`. That is deliberate (a cold inbound lead is still a lead), but
  it means the parse address should not be published anywhere public.
