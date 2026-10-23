# Facebook Page Messenger setup

Lets the store send invoices and reminders from your Facebook **Page**
straight from the order's send screen, with no copy and paste. Until this is
set up, the Page section on the send screen stays hidden and everything else
works as before.

## What it can and cannot do

- **Buyers have to message the Page.** A Page can only message someone who
  has written to it, and only through the conversation they started. Orders
  taken in your personal Messenger cannot be sent from here.
- **The 24-hour window.** Facebook lets a Page reply for 24 hours after the
  buyer's last message. With the **Human Agent** permission approved, a
  person (you, clicking Send) gets 7 days. Past that, the send screen says
  the window is closed and you use **Copy & open Messenger** as before. Any
  new message from the buyer reopens the window.
- **One link per buyer.** On an order's send screen you pick which Page
  conversation is the buyer, once. The link lives on their CRM contact, so
  their later orders are already linked.

## 1. Create the Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com/apps),
   create an app, and choose the **Business** type (or the "Engage with
   customers on Messenger" use case, depending on what the dashboard offers).
2. Add the **Messenger** product.
3. In **App settings → Basic**, copy the **App secret**. This is
   `META_APP_SECRET`.

## 2. Connect the Page and get a token

1. In **Messenger → Settings** (the Messenger API setup page), connect your
   Facebook Page.
2. Generate a **Page access token** for it. This is `META_PAGE_ACCESS_TOKEN`.
   - For a token that never expires, create a **System User** in Business
     Settings, give it the Page and the app, and generate the token there
     with `pages_messaging` and `pages_manage_metadata`.
   - A token generated from your own login can expire. If sends start failing
     with an authentication error, this is the first thing to check.

## 3. Add the secrets and deploy

Pick any random string for the webhook's verify token, for example the output
of `openssl rand -hex 16`. This is `META_VERIFY_TOKEN`.

Add these as **GitHub repository secrets** (Settings → Secrets and variables →
Actions), then re-run the backend deploy so `functions/.env` picks them up:

| Secret | Value |
| --- | --- |
| `META_PAGE_ACCESS_TOKEN` | Page token from step 2 |
| `META_APP_SECRET` | App secret from step 1 |
| `META_VERIFY_TOKEN` | Your random string |
| `META_HUMAN_AGENT` | Leave unset until step 5 is approved, then `1` |

## 4. Point the webhook at the store

Do this after the deploy, because Meta checks the URL immediately.

1. In **Messenger → Settings → Webhooks**, add a callback:
   - **Callback URL:**
     `https://us-central1-the-1p-leadership.cloudfunctions.net/metaMessengerWebhook`
   - **Verify token:** the same `META_VERIFY_TOKEN`
2. Subscribe your Page to the **`messages`** field.

Test it: message your Page from your personal Facebook account, then open any
unpaid order's **Send invoice** or **Remind** screen. Your name should be in
the **Link their Facebook Page conversation** list.

## 5. Go live (App Review)

While the app is in development mode, the Page can only message people who
have a role on the app (admins, developers, testers). That is enough to test
with your own account. To message buyers:

1. Request **Advanced Access** to `pages_messaging` in App Review. Meta wants
   a screencast of the feature in use and a short description. Use something
   like: "Customers order signed books by messaging our Page. We reply in the
   same conversation with their invoice link and, if needed, one payment
   reminder. Every message is sent by a person clicking Send."
2. Optional: request the **Human Agent** permission for 7-day replies, then
   set `META_HUMAN_AGENT=1` and redeploy.
3. Switch the app to **Live**.

## Troubleshooting

- **The Page section never appears:** `META_PAGE_ACCESS_TOKEN` or
  `META_APP_SECRET` did not reach the functions. Re-run the backend deploy
  and check its "Write functions runtime env" step lists both as set.
- **No one shows up in the conversation list:** the webhook is not
  subscribed to `messages`, or the app secret is wrong (deliveries are
  refused as unsigned). The function logs say `invalid signature` when it is
  the secret.
- **Names show as "Messenger user":** the token cannot read profile names.
  Linking still works; pick by the last message.
- **"Messenger refused it: …":** Meta's own error, passed through as-is.
  Common causes are an expired token or the buyer blocking the Page.
