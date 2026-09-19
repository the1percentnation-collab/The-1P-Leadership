# Two-way email in the CRM

Send from a lead's contact card and have their reply come back onto the same
card. Outbound uses SendGrid; inbound uses SendGrid Inbound Parse on a
dedicated subdomain.

The mailbox this is built around is **anthonybrown@the1pnation.com**.

---

## What already works vs. what needs setup

| Capability | Needs |
| --- | --- |
| Sending from a contact card | `SENDGRID_API_KEY` (already set) |
| Sending as anthonybrown@the1pnation.com without landing in spam | Domain authentication on `the1pnation.com` |
| Receiving replies onto the contact card | `INBOUND_EMAIL_DOMAIN` + `INBOUND_EMAIL_TOKEN` + an MX record + an Inbound Parse host |

Outbound works the moment domain authentication is done. Inbound is a separate
switch and is **fail-closed**: until the token is set, the webhook rejects
everything rather than accepting unverified mail.

---

## 1. Authenticate the sending domain (required)

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

## 3. Turn on receiving (Inbound Parse)

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
