<!--
  README.md -- HubSpot order form + Stripe checkout link integration
  Author:  Jibril Sulaiman
  Created: 2026-09-28 (from a production build first shipped 2026-09-04)
  What:    What this is for, how it works, and every setup step with a check.
  Why:     Nearly every failure in this flow is silent: Stripe drops UTM values
           it doesn't like without an error, links with the wrong setting never
           capture anything, and reports just show "no source".
-->

# HubSpot order form + Stripe checkout link integration

A **two-step order form for HubSpot pages** that hands buyers to a **Stripe
Payment Link** instead of HubSpot's own checkout, and still records which
campaign made each sale.

Step 1 is a normal HubSpot form, so every buyer becomes a contact before they pay.
Step 2 sends them straight to your Stripe Payment Link with their email prefilled
and their campaign attached. After they pay, a HubSpot workflow reads that
campaign back from Stripe and writes it onto the payment record, next to the amount.

## Why it exists

**HubSpot has no native order form.** A form and a payment are separate things in
HubSpot: you place a form module and a payment button on a page and hope buyers
use both. There's no step 1 "your details", step 2 "pay" flow, no order summary or
coupon field inline with the form, and nothing that moves the buyer from one to
the other.

**HubSpot's native Stripe checkout holds back much of what Stripe can do.** With
Stripe connected as HubSpot's payment processor, checkout runs on HubSpot's own
payment domain, in a sliding overlay, not on Stripe's checkout. In the portal this
was built for (Aug–Sep 2026), that meant:

| | HubSpot checkout (Stripe as processor) | Stripe Payment Link |
|---|---|---|
| Payment methods offered | Card and US bank account | Everything enabled in Stripe: Apple Pay, Google Pay, Klarna, Afterpay, Cash App, Link... |
| Apple Pay | Didn't render. The checkout is served from HubSpot's domain, which you can't register with Stripe for Apple Pay, inside a cross-origin overlay. | Works on your own checkout domain once registered with Stripe |
| Email from the form | Not carried into checkout for new visitors | `prefilled_email` on the link |
| Order bump / add-on | Needed two payment links, two payment modules and a checkbox to switch between them | Built in: an optional "Add to your order" item |
| Order summary and coupon field | Only inside the overlay, not beside the form | On Stripe's checkout page, with Stripe's promotion codes |

Capabilities change, so check your own portal. But if any of these matter to you,
the answer is to take payment on Stripe and keep HubSpot for the CRM.

**Moving checkout to Stripe breaks attribution, though.** The moment a buyer leaves
your site for Stripe:

- **The campaign is gone before checkout.** Ads land on a landing page with UTMs
  in the URL. HubSpot form redirects rebuild the URL and drop them, so the order
  page, and the Stripe link on it, never see where the buyer came from.
- **Stripe hides what it does keep.** There's no UTM field on the Checkout
  Session and none in the payment webhook. And Stripe **silently drops** any UTM
  value that isn't plain letters, digits, `-` or `_`. That's most ad-platform
  campaign names ("Brand | Fall | Prospecting").
- **HubSpot's commerce reports don't see it.** Payments taken on Stripe aren't
  HubSpot payments, so the source has to be written onto whatever record your
  Stripe payments sync into.
- **The payment and the contact drift apart** unless the buyer's email travels
  with the link.

This repo is the whole bridge: the order form, the capture that survives the
redirects, and the workflow that puts the campaign on the payment.

**What you give up:** HubSpot's native payment records, commerce reporting and
payment-based workflows (like HubSpot's abandoned-cart flows). Step 1 still
creates the contact before checkout, so you can build abandoned-checkout
follow-up on "submitted the order form but no payment".

## How it works

```text
 Ad / email / SMS link  ?utm_source=fb&utm_campaign=Brand | Fall
        │
        ▼
 1. Any page on your site ─ site-header/utm-capture.html
        stores the UTMs and click ids in a first-party cookie (90 days)
        │   ...buyer browses, fills in a form, lands on the order page
        ▼
 2. Order page ─ Order Form (Stripe) module
        step 1: HubSpot form  ──submit──►  step 2: redirect to the Stripe link
        https://buy.stripe.com/abc?utm_source=fb&utm_campaign=Brand-Fall
                                   &prefilled_email=...&gclid=...&fbc=...
        │
        ▼
 3. Stripe checkout ─ Payment Link with confirmation behavior = "redirect"
        Stripe copies the five UTMs onto the redirect: the Checkout Session's success_url
        │
        ▼
 4. HubSpot workflow ─ workflow-action/stripe-utm-action.js
        finds the session for the payment, parses success_url, and writes
        stripe_utm_source / medium / campaign / content / term, the promo code,
        the session and link ids, and where the UTM came from
```

## What's in this repo

| Path | What it is | Where it goes |
|---|---|---|
| `site-header/utm-capture.html` | Captures UTMs and click ids on every page | HubSpot **Site header HTML**, all domains |
| `module/order-form-stripe.module/` | The two-step order form (`module.html`, `module.css`, `module.js`, `fields.json`, `meta.json`) | HubSpot **Design Manager** module |
| `workflow-action/stripe-utm-action.js` | Writes the UTMs onto the payment record | HubSpot **workflow custom code** action |
| `scripts/audit-payment-links.mjs` | Lists which Stripe links can capture UTMs, and builds tagged URLs | Run locally (read-only) |
| `scripts/create-properties.mjs` | Creates the properties the action writes | Run locally, once |
| `scripts/verify-properties.mjs` | Confirms internal names and dropdown values match | Run locally |
| `test/` | 30 tests; the browser scripts run unchanged against a fake page | `npm test` |

Zero dependencies. Node 20+ for the scripts and tests.

---

## Table of contents

1. [Requirements](#1-requirements)
2. [Setup, step by step](#2-setup-step-by-step)
   - [Step 1: Set every Stripe Payment Link to redirect](#step-1-set-every-stripe-payment-link-to-redirect)
   - [Step 2: Install the site header script](#step-2-install-the-site-header-script)
   - [Step 3: Build the Order Form (Stripe) module](#step-3-build-the-order-form-stripe-module)
   - [Step 4: Put the module on your order page](#step-4-put-the-module-on-your-order-page)
   - [Step 5: Create the payment-record properties](#step-5-create-the-payment-record-properties)
   - [Step 6: Build the workflow](#step-6-build-the-workflow)
   - [Step 7: Test end to end](#step-7-test-end-to-end)
3. [What Stripe passes through, exactly](#3-what-stripe-passes-through-exactly)
4. [The attribution rules](#4-the-attribution-rules)
5. [Reading the results](#5-reading-the-results)
6. [What this can't capture](#6-what-this-cant-capture)
7. [Test mode](#7-test-mode)
8. [Troubleshooting](#8-troubleshooting)
9. [Security and privacy](#9-security-and-privacy)

---

## 1. Requirements

| You need | Why |
|---|---|
| HubSpot with **custom code workflow actions** (Data Hub, formerly Operations Hub, Professional or Enterprise) | Step 6 runs code |
| Stripe **Payment Links** | The whole flow is built around them |
| Your Stripe payments in HubSpot as records, one per PaymentIntent, with the `pi_...` id in a property | The workflow runs on those records. Commonly HubSpot's **Stripe Data Sync** app mapped to a custom object. |
| Your pages on one registrable domain (`www.example.com`, `offer.example.com`) | The cookie is shared across subdomains, not across different domains |

---

## 2. Setup, step by step

### Step 1: Set every Stripe Payment Link to redirect

Stripe only puts UTMs somewhere readable when the link **redirects** after payment.
A link showing Stripe's own confirmation message captures nothing, and tagging
it changes nothing.

1. Stripe Dashboard > **Payment Links** > open a link > **After payment**.
2. Choose **Don't show confirmation page > Redirect customers to your website**.
3. Enter your thank-you page, e.g. `https://www.example.com/thank-you`.
   **Don't put `?utm_...` on this URL.** Stripe uses it as the base, so a baked-in
   `utm_source` is reported on every sale regardless of the real source.

Then audit them all at once:

```powershell
$env:STRIPE_LIVE_KEY = "rk_live_..."   # restricted key: Payment Links read
node scripts/audit-payment-links.mjs
```

> **Check:** every link you sell through appears under **READY TO TAG**. Anything
> under **CANNOT CAPTURE** needs step 2 above; anything under **HARD-CODED** needs
> the UTMs removed from its redirect URL.

### Step 2: Install the site header script

1. Open `site-header/utm-capture.html` and set `COOKIE_DOMAIN` to your domain
   **with a leading dot**: `.example.com`.
2. HubSpot > **Settings > Content > Pages** > **Site header HTML**. Paste the whole
   file. **Do it for every domain** in the domain dropdown, not just the default.
   A domain with its own header silently keeps the old behavior.

> **Check:** open `https://www.example.com/?utm_source=test&utm_campaign=proof`,
> then in the browser console run `document.cookie`. You should see `site_attr=`.

### Step 3: Build the Order Form (Stripe) module

First, in `module.js`, check `COOKIE_NAME` matches the header script (`site_attr`).
Then either:

- **With the [HubSpot CLI](https://developers.hubspot.com/docs/cms/developer-reference/local-development-cli):**
  `hs upload module/order-form-stripe.module order-form-stripe.module` uploads all
  five files, fields included.
- **By hand:**
  1. HubSpot > **Content > Design Manager** > **File > New file > Module**. Name it
     **Order Form (Stripe)**. Content types: Landing pages and Site pages.
  2. Paste `module.html`, `module.css` and `module.js` into their three panes.
  3. Add the fields in the module's Fields panel. The **HubL variable names must
     match exactly**:

     | Field type | HubL variable name | Default | Purpose |
     |---|---|---|---|
     | Form | `step_form` | | The step-1 HubSpot form |
     | Text | `tab_1_label` | `YOUR INFO` | Step 1 tab |
     | Text | `tab_2_label` | `CHECKOUT` | Step 2 tab |
     | Text | `stripe_link` | | Live Payment Link URL |
     | Text | `button_label` | `Continue to Payment` | Replaces the form's submit text |
     | Boolean | `prefill_email` | on | Adds `prefilled_email` so the payment matches the contact |
     | Boolean | `open_new_tab` | off | Leave off: browsers block tabs opened after an async submit |
     | Boolean | `test_mode` | off | Uses the test link and shows a TEST MODE banner |
     | Text | `test_stripe_link` | | Stripe test-mode link, used only in test mode |

  4. **Publish changes.**

> **Check:** the module preview shows two tabs and, with no link set, a yellow
> "No Stripe payment link set" warning. That warning is for editors; it tells you
> the link field is empty.

### Step 4: Put the module on your order page

1. Edit the order page, add **Order Form (Stripe)**.
2. Pick the step-1 form. It needs an **email** field. Set the form to **show an
   inline message** (not redirect): the module waits for the form's fields to
   disappear, which is what an inline submit does.
3. Paste the Stripe Payment Link into **Stripe Link**. Use the link itself
   (`https://buy.stripe.com/...` or your custom checkout domain), not a
   `dashboard.stripe.com` URL.
4. Remove any other redirect or payment module from the page.

> **Check:** open the published page with `?utm_source=test&utm_campaign=Brand%20|%20Fall`,
> submit the form. You land on Stripe with `utm_source=test&utm_campaign=Brand-Fall`
> and your email already filled in.

### Step 5: Create the payment-record properties

Find the **object type id** of your payment records (it looks like `2-12345678`:
it's in the URL when you open the object's records or its settings) and a
property group on it.

```powershell
$env:HUBSPOT_TOKEN = "pat-..."          # crm.schemas.custom.read + write
$env:OBJECT_TYPE = "2-12345678"
$env:PROPERTY_GROUP = "your_group_name"
node scripts/create-properties.mjs --dry-run
node scripts/create-properties.mjs
node scripts/verify-properties.mjs
```

This creates `stripe_utm_source`, `stripe_utm_medium`, `stripe_utm_campaign`,
`stripe_utm_content`, `stripe_utm_term`, `checkout_session_id`, `payment_link_id`,
`redeemed_promo_code` and the dropdown `stripe_utm_capture_method`.

The `stripe_` prefix is deliberate. Contacts already have `utm_source`, and it
means something different there (see [section 4](#4-the-attribution-rules)).

> **Check:** `verify-properties.mjs` ends with **All good**. If you made any property
> by hand, it catches the classic trap: a label like `Checkout Session ID ` with a
> trailing space becomes the internal name `checkout_session_id_`, which rejects
> every write while looking perfect in the UI.

### Step 6: Build the workflow

1. **Secrets** (Automation > Workflows > any custom code action > Secrets, or
   Settings > Integrations > Private apps > Secrets):
   - `PAYMENT_UTM_WRITE_TOKEN`: a HubSpot service key or private app token with
     write access to the payment object (`crm.objects.custom.write` for a custom
     object). Use a key dedicated to this; rotating a shared key breaks the other
     integrations silently.
   - `STRIPE_READ_KEY`: a Stripe **live restricted** key with **Checkout
     Sessions: read** only. The action refuses test keys: they authenticate and
     then 404 on every live session, which would blank every field.
2. **Workflow:** Automation > Workflows > Create > **from scratch** on your payment
   object. Trigger: your PaymentIntent id property **is known**. Turn on
   **re-enrollment** for that trigger.
3. **Action:** Custom code, Node.js 20.x. Attach both secrets. Paste
   `workflow-action/stripe-utm-action.js`. At the top set:
   - `OBJECT_TYPE` to your object type id
   - `PI_PROPERTY` to the property holding `pi_...`
4. **Property to include in code:** add `PI_PROPERTY` and every property the action
   writes (the nine from step 5). The action reads them to avoid overwriting
   values already set.
5. **Data outputs** (optional, for branching): `utmSource`, `promoCode`, `status`,
   all strings.
6. Turn the workflow on.

> **Check:** open **Test** on the action with a recent payment record. The log line
> ends with a status (see [section 5](#5-reading-the-results)), and the record
> shows the new values.

### Step 7: Test end to end

Stripe test mode doesn't help here: most Stripe-to-HubSpot syncs, including
HubSpot's Stripe Data Sync, only read **live** mode, so a test payment never
creates a record for the workflow to run on. Test with a small real purchase you
refund, or a 100%-off promo code **only if** your sync creates records for $0
orders (most don't; see [section 6](#6-what-this-cant-capture)).

1. In a private window, open a page on your site with
   `?utm_source=test&utm_medium=qa&utm_campaign=Launch | Test`.
2. Browse to the order page, submit the form, pay.
3. Stripe redirects you to your thank-you page. The URL carries
   `utm_source=test&utm_medium=qa&utm_campaign=Launch-Test`.
4. Within a few minutes the payment record shows `stripe_utm_source = test` and
   `stripe_utm_capture_method = Success URL`.

---

## 3. What Stripe passes through, exactly

From [Stripe's docs](https://docs.stripe.com/payment-links/url-parameters) and
checked against production data:

| Parameter on the Payment Link | Reaches the success URL? | Notes |
|---|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | **Yes**, when the link redirects | Letters, digits, `-`, `_` only; max 150 characters. Anything else is **dropped without an error.** The module cleans values so they survive. |
| `utm_id`, `utm_*` anything else | No | Not documented, and never observed on a success URL |
| `prefilled_email` | n/a | Prefills checkout (read-only for the buyer). This is what links the payment to the contact. |
| `client_reference_id` | n/a | Stored on the session and sent in `checkout.session.completed`. Letters, digits, `-`, `_`, max 200. The action reads it as a fallback source. |
| `gclid`, `fbc`, `fbp`, other click ids | **Not documented** | The module forwards them so they're on the checkout URL, for anything that reads it. Don't build on them reaching the success URL without testing it yourself. |

Cleaning example: `Brand | Fall 2026 | Prospecting` is sent as
`Brand-Fall-2026-Prospecting`. The cookie keeps the original.

---

## 4. The attribution rules

**The Stripe UTM is last touch at checkout.** It records the link the buyer used
to reach the order page in this visit: often an email or SMS reminder, even for a
buyer an ad found first. That's correct, not a bug. Don't overwrite it with the
contact's first-touch source. Keep first touch in its own fields and report both:
"purchases *influenced* by paid social" and "purchases *closed* by email" are
different, true numbers.

**The cookie follows three write rules** (the header script and the module agree):

1. Only a page view that carries campaign parameters writes. Browsing untagged
   pages never erases attribution.
2. A new tagged view **replaces** the stored campaign; it never merges.
   Merging would pair one campaign's `utm_source` with another's click id.
3. A view whose parameters all equal what's stored is a **repeat**, not a new
   touch. This is the return trip from Stripe: the thank-you page URL carries only
   the five UTMs, and without this rule it would erase the stored click ids.

**`utm_medium` is inferred** when a link has a source but no medium
(`?utm_source=partner-a`). Order of evidence: ad click id, external referrer, the
visit's entry platform, else `direct`. An explicit `utm_medium` always wins.

**Underscore keys never leave the browser.** The cookie also keeps `_t` (capture
time), `_ref` (referrer), `_lp` (landing page) and `_inferred` for debugging. The
module never sends them to Stripe.

---

## 5. Reading the results

`stripe_utm_capture_method` says how far to trust a record's source:

| Value | Meaning |
|---|---|
| `Success URL` | A real Payment Link UTM. The good path. |
| `Client Reference ID` | No UTMs; someone packed a source into the link's `client_reference_id` (`src-partner__med-sms`) |
| `Session Metadata` | Set on the session by Stripe or another integration |
| *(blank)* | No UTM was found. A promo code alone doesn't set this. |

Workflow log statuses:

| Status | Meaning | Fix |
|---|---|---|
| `updated_from_success_url` | UTMs recovered | None |
| `updated_from_client_reference_id` | Fallback source used | Tag the link with UTMs instead |
| `updated_promo_only` | Only a promo code | Normal for untagged links |
| `ids_only_no_attribution` ... `redirect set, but the link was not tagged` | The buyer's link had no UTMs | Check the site header and module are on that path |
| `ids_only_no_attribution` ... `no redirect confirmation` | The link can't capture | Step 1 |
| `no_session` | Invoice or subscription payment | Expected |
| `nothing_found` | Already stamped | Expected on re-enrollment |

**Reporting tips:**

- **Normalize sources before grouping.** `email`, `Email` and `hs_email` are one
  channel; `fb`, `facebook` and `ig` often are too.
- **Watch for payment-method referrals.** Some buy-now-pay-later flows (Klarna's
  merchant referral links, for example) can arrive with their own `utm_source`.
  Exclude them from channel reports instead of treating them as a channel.
- **Promo codes are attribution.** Partner and affiliate codes land in
  `redeemed_promo_code`, not `utm_source`. Report them side by side.
- **Filter to paid.** If your payment object also holds unpaid attempts, filter to
  succeeded payments before summing revenue.

---

## 6. What this can't capture

| Case | Why | What to do |
|---|---|---|
| **$0 orders** (100%-off codes) | Stripe creates no PaymentIntent, so most syncs create no record and the workflow never runs | Listen for `checkout.session.completed` with `amount_total = 0` separately, keyed on the `cs_...` id |
| **Links without redirect** | No success URL for Stripe to write to | Step 1 |
| **Invoices and subscription renewals** | No Checkout Session, so no Payment Link | Attribute the first purchase; renewals inherit it in reporting |
| **Organic taps inside Instagram and TikTok apps** | They often send neither a referrer nor a click id | Nothing; that's the ceiling. Tag your bio links with UTMs. |
| **Different registrable domains** (`example.com` to `othersite.com`) | Cookies don't cross them | Forward the UTMs in the URL on that hop |
| **Direct links to Stripe** shared untagged | Nothing to capture | Tag every shared Payment Link URL (`audit-payment-links.mjs --tag`) |

---

## 7. Test mode

- Turn on **Test mode** in the module and paste a Stripe **test** link into **Test
  Stripe Link**. Checkout then uses the test link and a bright TEST MODE banner
  shows to every visitor, so a page published by mistake is noticed at once.
- With Test mode on and no test link, checkout is **disabled**. It never falls back
  to the live link, so a test page can't take real money.
- Test payments won't reach HubSpot through a live-only sync. Use test mode to
  check the page and the Stripe URL; use a small refunded live purchase to check
  the workflow ([Step 7](#step-7-test-end-to-end)).
- Stripe test purchases can still trigger anything else you've connected to
  Stripe (accounting, community, Zapier). Check before running many.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Most payments have no source | Header script missing on some domains, or the order page is reached through a domain that isn't covered | Step 2, every domain |
| `utm_campaign` missing but `utm_source` present | The value had spaces or pipes and the module isn't the one on the page | Check the page uses this module (view source for `eof`) |
| Every sale through a link shows the same source | UTMs hard-coded on the link's redirect URL | `audit-payment-links.mjs` HARD-CODED list |
| Form submits but nothing happens | Form set to redirect instead of inline, or Stripe Link empty | Step 4 |
| Stuck on "Redirecting you to secure checkout..." | Navigation blocked | The module shows a pay button after 3 s; check for a popup blocker if **Open in new tab** is on |
| Payment not linked to the contact | `prefill_email` off, or the payment never completed | Turn prefill on. Stripe only creates the customer, and most syncs only link the contact, once a payment **succeeds**. |
| Workflow error `... -> 400` on PATCH | A property name or dropdown value doesn't exist | `verify-properties.mjs` |
| Workflow error `not a live Stripe key` | Test key in `STRIPE_READ_KEY` | Use a live restricted key |
| Workflow `-> 401/403` | Token scopes | Step 6 secrets |
| Values on the record look truncated at 150 | Stripe's limit | Shorten campaign names at the source |

**Debugging in the browser:** on any page, `document.cookie` shows `site_attr`
(the stored campaign) and `site_entry` (this visit's platform). On the order page,
`document.querySelector('.eof').dataset.stripeUrl` is the link being used.

---

## 9. Security and privacy

- **Secrets stay in HubSpot's secret store.** Never paste a token into the code; the
  action reads them from environment variables and never logs them.
- **Use a restricted Stripe key** with Checkout Sessions: read, nothing more.
- **The email travels in the Stripe URL** as `prefilled_email`. That's Stripe's
  documented mechanism, but the URL can appear in browser history and analytics.
  Turn prefill off if that matters more than contact matching.
- **The cookies are first-party and hold campaign parameters only**, no personal
  data. If your site uses a consent banner that gates non-essential cookies, put the
  header script behind it.
- Don't put secrets or personal data in `client_reference_id`; Stripe shows it in
  places you might not expect.
