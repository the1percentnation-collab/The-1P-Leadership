# Toll-free SMS verification — submission content

Everything needed to get the CRM's texting approved, without an EIN.

**Why toll-free and not 10DLC:** A2P 10DLC brand registration normally wants a
federal Tax ID. Toll-free verification runs under a different compliance model,
and Twilio exempts sole proprietors from the business-registration-number
requirement — their documentation states an EIN or Tax ID is not required for
sole proprietor registration. Approval is typically 1-3 business days, and
toll-free reaches every major US carrier plus most major Canadian ones.

Switching carriers does not avoid this. 10DLC is enforced by The Campaign
Registry on behalf of the carriers, so Telnyx, Plivo, SignalWire, Vonage and
Bandwidth all require the identical registration. Toll-free is the shortcut,
not a different vendor.

**Calling needs none of this.** Voice has no 10DLC or verification requirement.
The softphone, dialer queue, recordings and voicemail drop work as soon as the
Twilio Voice variables in `AUTH_SETUP.md` are set, whatever texting is doing.

---

## Before you submit

1. **Buy a toll-free number.** Twilio Console → Phone Numbers → Buy a number →
   check *Toll-free*, with SMS and Voice capability.
2. **Start verification.** Messaging → Regulatory Compliance → Toll-Free
   Verification → the new number.
3. **Do not set `TWILIO_FROM_NUMBER` to it yet.** A toll-free number cannot
   send to the US or Canada until verification is approved. Point the env var
   at it only after the approval email, or sends will fail.

---

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

1. Set `TWILIO_FROM_NUMBER` to the toll-free number on the functions runtime
   and redeploy.
2. Set the number's **Messaging** webhook to `twilioInboundWebhook` and its
   status callback to `twilioStatusWebhook`, so inbound texts and delivery
   receipts land on the contact timeline. Both URLs are in `AUTH_SETUP.md`.
3. Send one text to your own phone from a contact record and confirm it appears
   on the timeline. Reply STOP from that phone and confirm the contact shows
   "Replied STOP — texting blocked" and that sending is refused.

## Staying approved

Carriers audit after the fact, and the weak link is the other forms that
collect a phone number with thinner consent wording than `/webinar`:
`/beta` and the homepage footer, `/corporate`, `/financial-services`, and
`/contact-us`, which takes a phone number with no consent checkbox at all.

The exposure is real but narrow: it is only a problem if you text someone who
came in through one of those. Bringing them up to the `/webinar` wording is a
small change and worth doing before volume grows.
