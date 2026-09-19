# Getting texting switched on

## The wall, stated plainly

There is no provider that will send business texts from a US local number
without registration. Since 1 February 2025 the carriers block **100% of
unregistered A2P 10DLC traffic** — not throttled, blocked — and bill sender
fees for the attempt. AT&T, T-Mobile and Verizon enforce this at the network,
through The Campaign Registry.

So Telnyx, Twilio, Plivo, SignalWire, Vonage, Bandwidth: identical requirement.
Changing vendor changes who hands you the same form. Anyone advertising
"no 10DLC needed" for US local-number business texting is either routing
person-to-person traffic that carriers actively filter, or about to have their
route shut off.

What *does* differ between vendors is who will register you without an EIN.
That is why this CRM is on Telnyx: its Sole Proprietor path takes the last four
digits of your SSN instead of a tax ID, which is the door that was closed
everywhere else.

**Voice is completely exempt.** No 10DLC, no verification, no registration. A
local number and the credentials in [`telnyx-setup.md`](telnyx-setup.md) and
the softphone works today.

## Two doors, pick one

| | Number | Verification | Limits |
|---|---|---|---|
| **Sole Proprietor 10DLC** *(recommended)* | Local area code | Name, address, mobile number, **last four of your SSN**, and a one-time code to that mobile. No EIN, no business documents. | 1 campaign, 1 number, ~1 msg/sec, ~1,000/day T-Mobile, 15/min AT&T |
| **Phone handoff** *(already live)* | Your own cell | None | No CRM capture at all |

**Sole Proprietor is the right default here**: it keeps a local area code, it
is the lightest identity check available without an EIN, and the throughput
ceiling is far above what one coach sends in a day. Expect a small Campaign
Registry brand fee plus a low monthly campaign fee; Telnyx shows the current
amounts at registration.

**Phone handoff** needs no setup and is what the Call and Text buttons already
do when no credentials exist. Your own number, your own carrier plan, nothing
to register. You lose message capture, inbound texts, and recordings; you keep
call logging and dispositions, because the CRM prompts you after the handoff.

---

## Sole Proprietor 10DLC — what you actually submit

Mission Control → Messaging → 10DLC → register a brand, entity type **Sole
Proprietor**. This path exists for individuals and small businesses with no
tax ID.

**No EIN and no business documents.** Identity is proved by the last four
digits of your SSN plus a one-time code. What it asks for:

- Business name (`The One Percent Nation`)
- Your first and last name
- Email address
- Physical address
- The **last four digits of your SSN**
- A mobile phone number, verified by **OTP**

Then one campaign: use case, sample messages, and the opt-in description — all
drafted for you under **Campaign content** below.

### The OTP gotchas

These are the details that waste a day if you miss them:

- **The mobile number must be a real mobile**, US or Canadian. It cannot be a
  number acquired from a CPaaS provider, Telnyx included — the carriers check.
  Use your personal cell.
- **Answer the code within 24 hours** or the registration expires and you start
  over.
- **That mobile number can be used at most 3 times** across Sole Proprietor
  brand registrations with The Campaign Registry.
- **The physical address can be used at most 10 times** across all brand
  registrations with TCR.

The verified mobile does not have to be, and generally should not be, the
number you send from. It is identity proof only; the sending number is the
10DLC number you attach to the campaign.

### What to expect after approval

A Sole Proprietor campaign takes **one 10DLC phone number**, and throughput is
throttled to roughly a message per second, with carrier-level daily caps around
1,000/day on T-Mobile and 15/minute on AT&T.

The CRM's sequence tick sends serially and the dialer is one-to-one, so neither
brushes that ceiling. What would hit it is a broadcast to hundreds of contacts
at once — if you ever need that, add a verified toll-free number as a second
sender and send campaigns from it while keeping the local number for
conversations.

## Campaign content

Paste this into the campaign form. The field names vary slightly between
providers but they all ask for the same things.

## The opt-in URL to submit

```
https://the1pnation.com/webinar
```

This is the page to give them, and it now satisfies the requirement — stated
as what was measured in a headless browser on a cold load, not as an
assumption, because an earlier version of this doc asserted it and was wrong:

- The phone input and both consent texts are visible together without any
  interaction. The consent block sits with the contact fields, above the quiz;
  only the submit button remains behind the quiz gate.
- The two consents are real `<input type="checkbox">` elements with labels,
  keyboard-toggleable. Neither is pre-checked. **Neither is required** —
  consent is not a condition of registering, which is what the campaign copy
  and the privacy policy both say.
- The checked state of each box and the exact wording shown are sent with the
  submission and stored per channel on the contact (`smsConsent`,
  `smsConsentText`, `smsConsentAt`; likewise `marketingConsent…`), with a
  `consent_updated` activity as the durable proof of what was agreed and when.
- A person who sees the SMS box and leaves it unticked is recorded as having
  declined, and the CRM refuses to text them until consent is recorded on
  their contact with a note naming who took it and how.

**Do not submit `/onboarding`.** Its consent language is the strongest on the
site, but the page redirects to login when nobody is signed in, so a reviewer
cannot see it. An unreachable opt-in URL is the most common rejection, and a
reachable page whose consent is hidden behind a quiz gate fails for the same
reason.

The two boxes on `/webinar`, quoted for the submission:

> By checking this box, you agree to receive text messages from The One Percent
> Nation related to your inquiry, bookings, or program updates. Message
> frequency may vary. Message and data rates may apply. Reply HELP for
> assistance or STOP to opt out. Consent is not a condition of purchase.

> By checking this box, you agree to receive marketing and promotional messages
> from The One Percent Nation, including special offers, discounts, and new
> program updates. Message frequency may vary. Message and data rates may
> apply. Reply STOP to opt out at any time.

Splitting transactional from marketing consent like this is exactly what
reviewers want to see, so say so in the workflow description below.

---

## Field-by-field

**Business type:** Sole Proprietorship

**Business registration number:** leave blank / select not available. Sole
proprietors are exempt from this field.

**Business name:** The One Percent Nation
**Website:** https://the1pnation.com
**Business address / contact:** your own name, address, email and mobile.
Use the same details your Telnyx account is registered under — a mismatch
between the account holder and the submission slows review. This is also what
sank the previous attempt on Twilio: the campaign was rejected because the
website did not match the registered brand, so keep the name and URL identical
across the account, the brand and the campaign.

**Use case category:** Customer Care
*(Account Notifications is the second choice. Avoid Marketing as the primary
category: the majority of this traffic is one-to-one follow-up with people who
asked to be contacted, and a Marketing category invites a stricter review.)*

### Use case summary

> The One Percent Nation is a leadership and life-coaching practice. We text
> people who have contacted us directly through a form on the1pnation.com —
> webinar and workshop registrants, coaching and speaking inquiries, and
> enrolled course and certification students.
>
> Messages are one-to-one conversations with a named coach: confirming and
> reminding people of scheduled calls, answering questions about a program they
> asked about, and following up on a request they submitted. Registrants also
> receive reminders for the live sessions they signed up for.
>
> Every recipient provides their phone number themselves on a web form and
> checks a separate consent box for text messages. We never purchase, rent or
> share lists, and we do not text anyone who has not submitted a form to us.
> Replies of STOP are honored automatically and immediately.

### Opt-in type

Web form

### Opt-in workflow description

> The visitor completes a form on the1pnation.com — most commonly the webinar
> registration page at https://the1pnation.com/webinar — entering their name,
> email and phone number.
>
> Below the phone field are two separate, unchecked consent checkboxes. The
> first covers transactional texts about their inquiry, bookings and program
> updates and states that message frequency may vary, that message and data
> rates may apply, and that they can reply HELP for assistance or STOP to opt
> out. The second, separately, covers marketing and promotional messages and
> repeats the STOP instruction. Neither box is pre-checked, and consent is not
> required to submit the form or to purchase anything.
>
> The checked state and the exact consent wording shown are stored with the
> contact record at the moment of submission, so we can evidence what each
> person agreed to and when. A reply of STOP sets an opt-out flag on that
> contact, and our system then refuses to send them any further message.

### Production message samples

Give all three. Each names the sender and carries an opt-out, which is what
reviewers check for.

> Hi Jordan, it's Anthony from The One Percent. Thanks for registering for
> Thursday's leadership workshop — here's your join link:
> https://the1pnation.com/webinar Reply STOP to opt out.

> Hi Jordan, Anthony from The One Percent. Confirming our strategy call for
> Thursday at 2:00 PM ET. Reply RESCHEDULE if another time works better, or
> STOP to opt out.

> Hi Jordan, Anthony from The One Percent following up on the coaching
> certification you asked about. Happy to answer any questions — just reply
> here. Reply STOP to opt out.

### Volume

**Estimated monthly message volume:** 1,000
*(Give an honest number for where you are starting. Under-stating is fine and
raises no concern; wildly over-stating invites scrutiny. It can be raised
later.)*

### Additional information

> Texting is sent from a CRM built into our own site and is used for one-to-one
> follow-up by a single coach, not bulk broadcast. STOP, STOPALL, UNSUBSCRIBE,
> CANCEL, END, QUIT and OPTOUT are all honored automatically and the contact is
> flagged so no further message can be sent to them; START, YES, UNSTOP and
> OPTIN re-subscribe. Our privacy policy is at https://the1pnation.com/privacy
> and terms at https://the1pnation.com/terms.

---

## After approval

1. Set `TELNYX_FROM_NUMBER` to the approved number as a **GitHub repository
   secret** (Settings → Secrets and variables → Actions), not in a local file —
   see [`telnyx-setup.md`](telnyx-setup.md) for why — and re-run the backend
   deploy workflow.
2. On the number's messaging profile, set the inbound webhook to
   `https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxInboundWebhook`
   and the delivery-receipt webhook to
   `https://us-central1-the-1p-leadership.cloudfunctions.net/telnyxStatusWebhook`,
   with webhook API version **v2**, so inbound texts and delivery receipts
   reach the contact timeline.
3. Confirm `TELNYX_PUBLIC_KEY` is set. Webhooks are verified with Ed25519
   against it, and with no key every webhook is rejected — deliberate, since an
   unverified webhook could create contacts and flip opt-out flags. The symptom
   of forgetting it is inbound texts silently never arriving, not an error.
4. Send one text to your own phone from a contact record and confirm it appears
   on the timeline with a delivery status. Reply STOP from that phone, then
   confirm the contact shows "Replied STOP — texting blocked", that sending is
   refused, and that any active sequence for that contact has stopped.

If you registered a *local* number for SMS and also bought a separate number
for voice, set `TELNYX_CALLER_ID` to the voice number so outbound calls show
the right caller ID.

## Staying approved

Carriers audit after the fact, and the weak link is the other forms that
collect a phone number with thinner consent wording than `/webinar`:
`/beta` and the homepage footer, `/corporate`, `/financial-services`, and
`/contact-us`, which takes a phone number with no consent checkbox at all.

The exposure is real but narrow: it is only a problem if you text someone who
came in through one of those. Bringing them up to the `/webinar` wording is a
small change and worth doing before volume grows.
