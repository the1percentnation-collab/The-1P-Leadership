# The One Percent Academy — Platform Overview

A plain-language guide to what the website and member portal do, written for
coworkers. It walks through the platform from three points of view: the
**Owner**, the **Admin**, and the **front-facing User (member)**.

> **The short version:** This is a leadership/coaching certification platform.
> The public website attracts and sells (book, courses, events, webinar). Once
> someone signs up, they enter a **member portal** where they take courses,
> join a community, track progress, and earn points. Behind the scenes, Owners
> and Admins run companies, manage seats, sell courses, email contacts, and run
> marketing campaigns.

---

## 1. The big picture

The product is built as a [Firebase](https://firebase.google.com/) web app:

- **Hosting** serves a set of static HTML pages (the `public/` folder).
- **Firestore** is the database (users, companies, courses, posts, contacts…).
- **Cloud Functions** (`functions/index.js`) do the secure server-side work:
  payments, sending email, invites, points/leaderboard, notifications.
- **Authentication** is email/password or "Sign in with Google."
- **Stripe** handles course payments. **SendGrid** sends transactional and
  marketing email.

There are **three roles**, and a person's role decides what they can see and do:

| Role  | Who they are                                   | Where they live          |
|-------|------------------------------------------------|--------------------------|
| Owner | The business owner (you). Full control.        | `/owner.html`            |
| Admin | A company's manager — runs their team/roster.  | `/admin.html`            |
| User  | A member / employee taking the program.        | `/dashboard.html` + rest |

Roles are enforced in two places that must agree: a Firebase **custom claim**
(owner only, set by a one-time bootstrap) and the **Firestore user record**
(`role` = `owner` / `admin` / `user`). See `public/js/roles.js`.

---

## 2. The front-facing website (anyone, logged out)

These are the public marketing pages — no account required. Their job is to
attract visitors and convert them into book buyers, course students, and
members.

| Page                    | What it's for                                            |
|-------------------------|----------------------------------------------------------|
| `index.html`            | Main landing page (the1pnation.com) — hero, pitch.       |
| `book.html`             | Sells the book ("I Can't: Is Not A Strategy").           |
| `book-bonus.html`       | Bonus content for book buyers.                           |
| `bundle.html`           | Bundle deal: book + course.                              |
| `courses.html`          | Course catalog — browse and buy/enroll.                  |
| `events.html`           | Upcoming events; visitors can register.                  |
| `webinar.html`          | Webinar registration landing page.                       |
| `goal-planning.html`    | Lead magnet: a custom goal planner.                      |
| `contact.html`          | Contact form.                                            |
| `signup.html` / `login.html` | Create an account / sign in.                        |
| `invite.html`           | Where an invited employee accepts and joins a company.   |

**Buying a course:** A visitor picks a course and checks out through Stripe
(`createCheckoutSession`). Free courses enroll instantly (`enrollFree`). When
payment succeeds, a Stripe webhook (`stripeWebhook`) confirms it and grants
access.

**Registering for an event/webinar:** Submitting the form calls
`registerForEvent`, which also adds the person as a contact and can email them.

---

## 3. The member portal (logged-in Users)

Once someone signs up — or accepts an invite — they land in the member portal.
This is the "front-facing user" experience after login. A shared top
navigation bar (`public/js/topbar.js`) appears on every page with search,
notifications, and the user's avatar.

### What a member can do

- **Dashboard / Hub** (`dashboard.html`) — "Welcome back" home screen showing
  their **course arc** (progress through the program), quick links, their
  enrolled courses, and the latest community activity.
- **Courses** (`courses.html`, `course-renderer.js`, `modules.js`) — work
  through course modules lesson by lesson. Progress is saved per user
  (completed lessons, notes, capstone reflection/recording submissions).
- **Community** (`community.html`) — a social feed: create posts, comment,
  like, and @mention other members. Members get **notifications** when someone
  replies, mentions, or likes them.
- **Members directory** (`members.html`) — find and view other members'
  profiles; search powered by `searchMembers`.
- **Profile** (`profile.html`) — edit their display name, avatar, and details.
- **Points & leaderboard** — activity earns points (`applyPointsDelta`,
  `getLeaderboard`, `recomputeUserStats`), creating a gamified, weekly-reset
  ranking.
- **Resources** (`resources.html`) — supporting downloads/materials.
- **Goal planning** (`goal-planning.html`) — personal goal planner.

Members belong to a **company** (their `companyId`) when they joined via an
admin invite, or they can be independent learners who bought a course directly.

---

## 4. The Admin view (`/admin.html`)

An Admin manages **one company** (their team). They get everything a regular
member has, **plus** admin-only tabs in the navigation. An Admin is assigned by
the Owner.

What an Admin can do:

- **Company dashboard** — see their company name, **seat usage** (seats used vs.
  seats available), and tier.
- **Roster** — see every member on their team and their progress.
- **Invite employees** — generate an invite. The system emails the invite
  (`onInviteCreated`) and, when the employee accepts (`acceptInvite`), they're
  added to the company and a seat is consumed.
- **Pending invites** — track invites that haven't been accepted yet.
- **CRM** (`crm.html`) — manage contacts/leads: add, view, and delete contacts
  (`deleteContact`). Contacts come from event registrations, the contact form,
  and manual entry.
- **Campaigns** (`campaigns.html`) — send marketing email blasts to filtered
  groups of contacts (`sendCampaign`), and share events to contacts
  (`shareEventToContacts`). Email delivery/opens/clicks are tracked via a
  SendGrid webhook (`sendgridEventWebhook`).
- **Manage Courses** (`manage-courses.html`) — create/edit course content and
  pricing, sync Stripe coupons (`syncCoupon`).
- **Manage Affiliates / Affiliates** (`manage-affiliates.html`,
  `affiliate.html`) — run an affiliate/referral program: track affiliate clicks
  (`recordAffiliateClick`) and mark affiliates as paid (`markAffiliatePaid`).
- **Manage their store** — storefront/product configuration.

Admin actions are protected server-side by `assertCompanyAdmin`, so an admin
can only act on **their own** company.

---

## 5. The Owner view (`/owner.html`)

The Owner is the top of the hierarchy — that's you (the
`the1percentnation@gmail.com` account). The Owner can do **everything an Admin
can**, across **all companies**, plus owner-only powers:

- **Bootstrap owner claim** — a one-time button that grants the owner role
  (`bootstrapOwner`). Only the designated owner email can run it.
- **Create companies** — set up a new company, give it a seat count and tier.
- **Assign admins** — attach an admin (by email) to a company so they can
  manage their own roster. (That person must have signed up first.)
- **View all companies** — a master list of every company on the platform with
  their seat usage and tier.
- **Manage the store** — full storefront/product control.
- **Delete users** — remove a user and all their data (`deleteUser`).

In short: **Owner manages companies and admins; admins manage members and
marketing; members learn, connect, and grow.**

---

## 6. How a typical flow works end-to-end

1. **Owner** creates a company ("Acme Corp", 25 seats) and assigns Jane as its
   admin.
2. **Jane (Admin)** signs in, opens `/admin.html`, and invites her teammates by
   email. Each invite is emailed automatically.
3. **An employee** clicks the invite link (`invite.html`), creates an account,
   and is auto-joined to Acme Corp. A seat is consumed.
4. **The employee (User)** lands on the dashboard, works through course modules,
   posts in the community, earns points, and climbs the leaderboard.
5. Meanwhile, the **public website** keeps attracting new leads via the book,
   webinar, and events — those leads flow into the **CRM**, and Admins reach
   them with **Campaigns**. Direct course sales run through **Stripe**.

---

## 7. Quick reference — who can see what

| Capability                          | User | Admin | Owner |
|-------------------------------------|:----:|:-----:|:-----:|
| Take courses, track progress        |  ✅  |  ✅   |  ✅   |
| Community, profile, leaderboard     |  ✅  |  ✅   |  ✅   |
| CRM (contacts)                      |  —   |  ✅   |  ✅   |
| Campaigns / email blasts            |  —   |  ✅   |  ✅   |
| Manage courses & pricing            |  —   |  ✅   |  ✅   |
| Affiliate program                   |  —   |  ✅   |  ✅   |
| Company roster & invite seats       |  —   |  ✅   |  ✅   |
| Create companies / assign admins    |  —   |  —    |  ✅   |
| View all companies                  |  —   |  —    |  ✅   |
| Delete users                        |  —   |  —    |  ✅   |

---

*For setup/deployment details (Firebase, Stripe, SendGrid, the one-time owner
bootstrap), see [`AUTH_SETUP.md`](./AUTH_SETUP.md).*
