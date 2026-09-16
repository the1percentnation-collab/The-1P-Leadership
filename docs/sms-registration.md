# Getting texting switched on

## The wall, stated plainly

There is no provider that will send business texts from a US local number
without registration. Since 1 February 2025 the carriers block **100% of
unregistered A2P 10DLC traffic** — not throttled, blocked — and bill sender
fees for the attempt. AT&T, T-Mobile and Verizon enforce this at the network,
through The Campaign Registry.

So Twilio, Telnyx, Plivo, SignalWire, Vonage, Bandwidth: identical requirement.
Changing vendor changes who hands you the same form. Anyone advertising
"no 10DLC needed" for US local-number business texting is either routing
person-to-person traffic that carriers actively filter, or about to have their
route shut off.

**Voice is completely exempt.** No 10DLC, no verification, no registration. A
local number and the Twilio Voice credentials in
[`twilio-setup.md`](twilio-setup.md) and the softphone works today.

## Three doors, pick one

| | Number | Verification | Limits |
|---|---|---|---|
| **Sole Proprietor 10DLC** *(recommended)* | Local area code | Name, address, mobile, last 4 of SSN, one-time code. No EIN, no business documents. | 1 campaign, 1 number, ~1 msg/sec, ~1,000/day T-Mobile, 15/min AT&T |
| **Toll-free verification** | 800-style | Business details form, no EIN required for sole proprietors | Full throughput |
| **Phone handoff** *(already live)* | Your own cell | None | No CRM capture at all |

**Sole Proprietor is the right default here**: it is the local number, the
lightest identity check of the three, and the throughput ceiling is far above
what one coach sends in a day. Cost is about $4 once plus $2/month to The
Campaign Registry.

**Toll-free** is the fallback if you want unlimited throughput or a second
number. Its approval window is the one thing to watch — estimates range from
1-3 business days to 3-6 weeks depending on who you ask, so do not plan a
launch around it.

**Phone handoff** needs no setup and is what the Call and Text buttons already
do when no credentials exist. Your own number, your own carrier plan, nothing
to register. You lose message capture, inbound texts, and recordings; you keep
call logging and dispositions, because the CRM prompts you after the handoff.

---

## Sole Proprietor 10DLC — what you actually submit

Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC → register, and
choose the **Sole Proprietor** brand type.

What it asks for:

- Your legal name and personal address
- Your mobile phone number — a one-time code is texted to it to prove you
  control it
- The last four digits of your SSN
- Business name (`The One Percent Nation`) and website (`https://the1pnation.com`)
- One campaign: use case, sample messages, and the opt-in description

That is the whole identity check. No EIN, no incorporation documents, no
articles of organisation, no bank verification.

For the campaign itself — the use-case summary, the opt-in URL, the opt-in
workflow description and the message samples — use the content in the
**Campaign content** section below. It is written for either path; the same
wording works for a sole proprietor campaign and for toll-free verification.

### What to expect after approval

One number, one campaign, and throttling at roughly a message per second. The
CRM's sequence tick sends serially and the dialer is one-to-one, so neither
brushes the ceiling. What *would* hit it is a broadcast to hundreds of contacts
at once — if you ever want that, register toll-free as a second number and send
campaigns from it.

---

## Campaign content

Use this for a Sole Proprietor 10DLC campaign or for toll-free verification.
The fields are named slightly differently between the two flows but ask for the
same things.

---

## If you go the toll-free route instead

1. **Buy a toll-free number.** Twilio Console → Phone Numbers → Buy a number →
   tick *Toll-free*, with SMS and Voice capability.
2. **Start verification.** Messaging → Regulatory Compliance → Toll-Free
   Verification → the new number.
3. **Do not set `TWILIO_FROM_NUMBER` to it yet.** A toll-free number cannot
   send to the US or Canada until verification is approved, so every send would
   fail. Point the env var at it only after the approval email.

Twilio exempts sole proprietors from the business-registration-number
requirement on this flow, and states an EIN or Tax ID is not required for sole
proprietor registration.

## The opt-in URL to submit

```
https://the1pnation.com/webinar
```

This is the page to give them, and it is already built correctly: the phone
field and both consent checkboxes are in the same visible form, on a public
page with no login, and the wording carries everything a reviewer looks for —
named sender, message frequency, data rates, and HELP/STOP.

**Do not submit `/onboarding`.** Its consent language is the strongest on the
site, but the page redirects to login when nobody is signed in, so a reviewer
cannot see it. An unreachable opt-in URL is the most common rejection.

The two boxes on `/webinar`, quoted for the submission:

> By checking this box, you agree to receive text messages from The One Percent
> related to your inquiry, bookings, or program updates. Message frequency may
> vary. Message and data rates may apply. Reply HELP for assistance or STOP to
> opt out.

> By checking this box, you agree to receive marketing and promotional messages
> from The One Percent, including special offers, discounts, and new program
> updates. Reply STOP to opt out at any time.

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
Use the same details your Twilio account is registered under — a mismatch
between the account holder and the submission slows review.

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

1. Set `TWILIO_FROM_NUMBER` to the approved number as a **GitHub repository
   secret** (Settings → Secrets and variables → Actions), not in a local file —
   see [`twilio-setup.md`](twilio-setup.md) for why — and re-run the backend
   deploy workflow.
2. Set the number's **Messaging** webhook to
   `https://us-central1-the-1p-leadership.cloudfunctions.net/twilioInboundWebhook`
   (HTTP POST) and its status callback to
   `https://us-central1-the-1p-leadership.cloudfunctions.net/twilioStatusWebhook`,
   so inbound texts and delivery receipts reach the contact timeline.
3. Send one text to your own phone from a contact record and confirm it appears
   on the timeline. Reply STOP from that phone, then confirm the contact shows
   "Replied STOP — texting blocked" and that sending is refused.

If you registered a *local* number for SMS and also bought a separate number
for voice, set `TWILIO_CALLER_ID` to the voice number so outbound calls show
the right caller ID.

## Staying approved

Carriers audit after the fact, and the weak link is the other forms that
collect a phone number with thinner consent wording than `/webinar`:
`/beta` and the homepage footer, `/corporate`, `/financial-services`, and
`/contact-us`, which takes a phone number with no consent checkbox at all.

The exposure is real but narrow: it is only a problem if you text someone who
came in through one of those. Bringing them up to the `/webinar` wording is a
small change and worth doing before volume grows.
