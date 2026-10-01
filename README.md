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
| [`site-header/utm-capture.html`](site-header/utm-capture.html) | Captures UTMs and click ids on every page | HubSpot **Site header HTML**, all domains |
| [`module/order-form-stripe.module/`](module/order-form-stripe.module/) | The two-step order form: [`module.html`](module/order-form-stripe.module/module.html) · [`module.css`](module/order-form-stripe.module/module.css) · [`module.js`](module/order-form-stripe.module/module.js) · [`fields.json`](module/order-form-stripe.module/fields.json) · [`meta.json`](module/order-form-stripe.module/meta.json) | HubSpot **Design Manager** module |
| [`workflow-action/stripe-utm-action.js`](workflow-action/stripe-utm-action.js) | Writes the UTMs onto the payment record | HubSpot **workflow custom code** action |
| [`scripts/audit-payment-links.mjs`](scripts/audit-payment-links.mjs) | Lists which Stripe links can capture UTMs, and builds tagged URLs | Run locally (read-only) |
| [`scripts/create-properties.mjs`](scripts/create-properties.mjs) | Creates the properties the action writes | Run locally, once |
| [`scripts/verify-properties.mjs`](scripts/verify-properties.mjs) | Confirms internal names and dropdown values match | Run locally |
| [`test/`](test/) | 30 tests; the browser scripts run unchanged against a fake page | `npm test` |

Zero dependencies. Node 20+ for the scripts and tests.

---

## Table of contents

1. [Requirements](#1-requirements)
2. [Setup, step by step](#2-setup-step-by-step)
   - [Step 1: Set every Stripe Payment Link to redirect](#step-1-set-every-stripe-payment-link-to-redirect)
   - [Step 2: Audit your links with the script](#step-2-audit-your-links-with-the-script)
   - [Step 3: Install the site header script on every domain](#step-3-install-the-site-header-script-on-every-domain)
   - [Step 4: Build the Order Form (Stripe) module](#step-4-build-the-order-form-stripe-module)
   - [Step 5: Put the module on your order page](#step-5-put-the-module-on-your-order-page)
   - [Step 6: Create the payment-record properties](#step-6-create-the-payment-record-properties)
   - [Step 7: Build the Stripe UTM workflow](#step-7-build-the-stripe-utm-workflow)
   - [Step 8: Test end to end](#step-8-test-end-to-end)
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
| HubSpot with **custom code workflow actions** (Data Hub, formerly Operations Hub, Professional or Enterprise) | Step 7 runs code |
| Stripe **Payment Links** | The whole flow is built around them |
| Your Stripe payments in HubSpot as records, one per PaymentIntent, with the `pi_...` id in a property | The workflow runs on those records. Commonly HubSpot's **Stripe Data Sync** app mapped to a custom object. |
| Your pages on one registrable domain (`www.example.com`, `offer.example.com`) | The cookie is shared across subdomains, not across different domains |

---

## 2. Setup, step by step

Do the steps in order. Each one ends with a ✅ **Check**. Don't move on until it
passes. Almost every failure in this build is silent: Stripe drops a UTM without
an error, a link on the wrong setting captures nothing, and a workflow with a
typo in an input name "succeeds" with blank fields. The checks are the only
place you'll see those failures.

> **About the labels:** names in **bold** or *"quotes"* were checked against
> screenshots of the live HubSpot and Stripe apps from August and September
> 2026. Three screens were never captured: Stripe's Payment Link **After
> payment** settings, the permission rows for *Promotion Codes* and *Payment
> Links* in Stripe's key editor, and HubSpot's re-enrollment toggle. Those
> steps are marked *(wording may differ)*. Both vendors move menus now and
> then. If a path doesn't match, search for the setting by name.

**Before you start, have these ready:**

| You need | Where it comes from |
|---|---|
| This repo on your computer, and Node.js 20 or newer | `node --version` should print `v20` or higher |
| Your registrable domain, e.g. `example.com` | Every page in the funnel must be on it or on one of its subdomains |
| A thank-you page on your site, e.g. `https://www.example.com/thank-you` | Any published HubSpot page. Stripe sends buyers here after they pay. |
| The payment object your Stripe payments sync into, and its property holding the `pi_...` id | With HubSpot's Stripe Data Sync app this is usually an object like **Stripe Payment Transactions**, with a property like **Stripe Payment Transaction ID** |

The scripts below use PowerShell syntax (`$env:NAME = "..."`). On macOS or Linux,
use `export NAME="..."` instead.

---

### Step 1: Set every Stripe Payment Link to redirect

*About 5 minutes per link.*

Stripe only writes a link's UTMs somewhere the API can read when the link
**redirects** after payment. It copies them onto the redirect URL, which the API
returns as the Checkout Session's `success_url`. A link that shows Stripe's own
confirmation message has no redirect URL, so it captures nothing, and tagging it
changes nothing.

**1a. Open the link.**
1. Sign in to the Stripe Dashboard. Check the top of the page: if you see a
   **Sandbox** / **Test mode** banner (*"You are testing in a sandbox. No real
   transactions will be processed."*), switch to your live account first.
2. In the left menu, under **Shortcuts** or **Product catalog**, click **Payment
   Links**.
3. Click the link you sell through.

**1b. Set the after-payment behavior.** *(wording may differ)*
1. Open the link's editor (**Edit**, or the **⋯** menu on the link's page).
2. Open the **After payment** tab.
3. Under **Confirmation page**, choose **Don't show confirmation page**, then
   **Redirect customers to your website**.
4. Enter your thank-you page, e.g. `https://www.example.com/thank-you`.
5. Save the link (**Update link** or **Save**).

> ⚠️ **Never put `?utm_...` on the redirect URL.** Stripe uses it as the base and
> adds the buyer's UTMs on top. A `utm_source` baked into it is reported on
> **every** sale through that link, whatever the buyer's real source was, and the
> API can't tell the two apart. Step 2 lists any link with this problem.

> ⚠️ **Switching a link changes what the buyer sees after paying.** Point it at
> a real, published thank-you page for that product before you switch it. Don't
> batch-switch old links you no longer sell through; check whether they still
> take money first.

**1c. Copy the link's buyer-facing URL.**
1. On the link's page, click **Copy link** (next to *"Copy and share to start
   accepting payments with this link"*).
2. Keep it for Step 5. It looks like `https://buy.stripe.com/abc123...`, or your
   custom checkout domain (`https://pay.example.com/b/abc123...`) if you set one
   up in Stripe.

> ⚠️ **Don't copy the address bar.** `https://dashboard.stripe.com/acct_...` is
> Stripe's admin console. Pasted into the order form, it sends buyers to a
> Stripe login page. In the original build this URL ended up in a form field
> and had to be caught by eye.

✅ **Check:** the link's **After payment** setting shows the redirect to your
thank-you page, and the URL you copied starts with `https://buy.stripe.com/` or
your checkout domain, not `dashboard.stripe.com`.

---

### Step 2: Audit your links with the script

*About 10 minutes.*

Checking links one at a time misses some. The audit script reads every Payment
Link in your account and sorts them. It's read-only.

**2a. Create a Stripe restricted key for the audit.**
1. Stripe Dashboard > **Developers** > **API keys**. Under **Restricted keys**,
   click **+ Create restricted key**.
2. *"How will you be using this key?"*: choose **Powering an integration you
   built**, then **Continue**.
3. *"Choose a permission template"*: click **Choose your own →** at the bottom.
4. In **Create restricted API key**, set **Key name** to `Payment link audit`.
5. Type `Payment Links` in the resource search box and set its row to **Read**.
   Leave every other resource on **None**. *(row wording may differ)*
6. Click **Create key**, then copy the key. It starts with `rk_live_`.

> ⚠️ **Use a restricted key, never your full secret key.** In the original build
> a full `sk_live_` key was pasted into a terminal to run this. It then sat in the
> shell history and had to be rotated. If that happens to you: Stripe >
> **Developers** > **API keys** > roll the secret key, then run `Clear-History`
> in PowerShell.

**2b. Run the audit.** In PowerShell, from the repo folder:

```powershell
$env:STRIPE_LIVE_KEY = "rk_live_..."     # the key from 2a
node scripts/audit-payment-links.mjs
```

Add `--all` to include inactive links. The script refuses to run with a test key
(`Refusing to run: STRIPE_LIVE_KEY is not a live key`), because test mode has
different links.

> ⚠️ **In PowerShell, `curl` isn't curl.** It's an alias for `Invoke-WebRequest`,
> which rejects `-u` (*"parameter name 'u' is ambiguous"*). That's why this repo
> ships Node scripts instead of curl one-liners.

**2c. Read the output.** It prints up to three groups, then a summary line:

| Group | What it means | What to do |
|---|---|---|
| **HARD-CODED UTMs - these report the same source on every sale** | The redirect URL itself contains `utm_*` | Fix these first: remove the `?utm_...` from the link's redirect URL (Step 1b). They actively corrupt reports. |
| **CANNOT CAPTURE UTMs - no redirect confirmation, so tagging the URL does nothing** | The link shows Stripe's confirmation message (`after_completion: hosted_confirmation`) | Switch it to redirect (Step 1b) if you still sell through it |
| **READY TO TAG - redirect set, no baked-in UTMs** | Working. Each entry shows `share:` (the URL buyers click) and `lands on:` (the redirect) | Nothing. The order form (Step 5) adds UTMs to these automatically. |

The last line reads like `12 ready, 0 with baked-in UTMs, 3 unable to capture.`
In the account this was built for, nearly half the active links were in
**CANNOT CAPTURE**, although everyone believed every link redirected.

**2d. Optional: build tagged URLs for links you share by hand.** For links pasted
into emails, DMs or partner posts (not through the order form):

```powershell
node scripts/audit-payment-links.mjs --tag "utm_source=newsletter&utm_medium=email"
```

Each **READY TO TAG** entry's `share:` line then has your parameters added, ready
to copy. The script checks them first and stops with `Invalid --tag value:` if a
value has characters Stripe would drop silently (anything but letters, digits,
`-` and `_`) or is longer than 150 characters.

> ⚠️ **The UTM has to be on the URL the buyer clicks.** Adding it anywhere in the
> Stripe Dashboard does nothing. If you share through a link shortener, put the
> UTMs on the shortener's *destination*, so they survive the hop.

✅ **Check:** every link you sell through is under **READY TO TAG**, and the
summary shows `0 with baked-in UTMs`.

---

### Step 3: Install the site header script on every domain

*About 10 minutes.*

HubSpot form redirects rebuild the URL and drop the UTMs, so the order page never
sees the campaign. This script runs on every page and saves the campaign in a
first-party cookie the moment the buyer lands.

**3a. Set your domain in the file.**
1. Open [`site-header/utm-capture.html`](site-header/utm-capture.html) in a text editor.
2. Find `var COOKIE_DOMAIN = '.example.com';` and change it to your registrable
   domain **with the leading dot**, e.g. `'.example.com'` for
   `www.example.com`, `offer.example.com` and so on.
3. Leave `var COOKIE = 'site_attr';` as it is. The module reads the same name in
   Step 4. If you change it here, change `COOKIE_NAME` in `module.js` to match.
4. Save the file.

**3b. Open the site header setting.**
1. In HubSpot, click the **Settings** gear (top right).
2. In the left menu, go to **Content** > **Pages**. *(Older portals: **Website** >
   **Pages**.)*
3. At the top, *"Choose a domain to edit its settings:"* shows **Default settings
   for all domains**. Leave it there for now.
4. Stay on the **Templates** tab and scroll to **HTML** > **Site header HTML**
   (*"Add custom code snippets to the HTML head section across all of your
   pages."*).

**3c. Paste the script.**
1. Click at the **end** of whatever is already in **Site header HTML** (a Google
   Tag Manager snippet, for example), and add a blank line. Don't delete what's
   there.
2. Paste the **whole** of [`site-header/utm-capture.html`](site-header/utm-capture.html):
   everything from the opening `<script>` to the closing `</script>`.
3. Click **Save** at the bottom of the page (the bar reads *"You've changed 1 web
   page setting."*).

> ⚠️ **If HubSpot says *"There is invalid HTML or HubL in the Head HTML"*,** it's
> usually a `<!-- ... -->` comment containing `--`. The first version of this
> script had its description in an HTML comment and HubSpot rejected it. The
> file in this repo keeps its description inside the `<script>` as a `/* */`
> comment, so paste it exactly as it is. Don't wrap it in an HTML comment.

**3d. Repeat for every domain.**
1. Open *"Choose a domain to edit its settings:"* and pick each domain in turn.
2. If a domain shows its **own** Site header HTML (not the default), paste the
   script there too and **Save**.

> ⚠️ **A domain with its own header silently ignores the default.** It keeps the
> old behavior with no error, and every sale that passes through that domain
> comes out with no source. Check every domain in the dropdown, not just the
> ones you think you use.

✅ **Check:** in a private (incognito) window, open
`https://www.example.com/?utm_source=test&utm_campaign=proof`, open the browser
console (F12 > **Console**) and run:

```js
document.cookie.split('; ').filter(function (c) { return c.indexOf('site_attr') === 0 })
```

You should see one `site_attr=...` entry. Then open a page on a **different**
subdomain (e.g. `https://offer.example.com/`) and run the same line. The same
cookie should be there. That's the cross-subdomain hop the whole build depends on.

If it's empty, check in this order:
- `location.search` is empty or has no `utm_`: the script only writes on a tagged
  page view, so an untagged URL correctly writes nothing.
- `document.documentElement.innerHTML.includes('site_attr')` is `false`: the
  script isn't on the page. It's the wrong domain in the dropdown, or it went
  into **Site footer HTML** instead.
- The console is full of errors from browser extensions (password managers are
  common): retest in a private window with extensions off.

> 🧹 **Clear your test cookie** when you're done, or your own browser stays pinned
> to `test/proof` for 90 days:
> `document.cookie = 'site_attr=; domain=.example.com; path=/; max-age=0'`

---

### Step 4: Build the Order Form (Stripe) module

*About 20 minutes by hand, 5 with the CLI.*

Before either path: open [`module/order-form-stripe.module/module.js`](module/order-form-stripe.module/module.js) and check
that `var COOKIE_NAME = 'site_attr';` matches the `COOKIE` name in the header
script (Step 3a).

#### 4A. By hand in Design Manager

**4a. Create the module file.**
1. In HubSpot, go to **Content** > **Design Manager**.
2. Click **File** > **New file**, and choose **Module**. The panel titled **Set up
   your new module** opens.
3. *"Where would you like to use this module?"*: tick **Landing pages** and **Site
   pages**. Leave the rest unticked.
4. **Module content scope:** leave **Local module** selected.
5. **File name:** `Order Form (Stripe)`.
6. **File location:** leave it, or click **Change** to put it in your own folder.
7. Click **Create**.

> ⚠️ **Tick both page types.** In the original build a module scoped to **Site
> pages** only didn't appear in the landing page editor at all, and time was lost
> hunting for a template problem. You can fix this later in the right sidebar
> under **Content types**.

**4b. Name it.** In the right sidebar, set **Label** to `Order Form (Stripe)`.
This is the name editors see when they add a module to a page. Under it,
**Content types** should read *Landing pages, Site pages*.

**4c. Paste the code.** The editor has three panes, top to bottom. In each one,
select everything and delete the sample code, then paste in the **whole** file:

| Pane | Paste all of |
|---|---|
| **module.html (HTML + HubL)** | [`module/order-form-stripe.module/module.html`](module/order-form-stripe.module/module.html) |
| **module.css** | [`module/order-form-stripe.module/module.css`](module/order-form-stripe.module/module.css) |
| **module.js** | [`module/order-form-stripe.module/module.js`](module/order-form-stripe.module/module.js) |

The status bar at the bottom left should read **No errors found**.

**4d. Add the nine fields.** In the right sidebar, under **Fields**, click **Add
field** and pick the type. When the field opens:
1. Type the **Label**.
2. Check the **HubL variable name** under it. HubSpot builds one from the label,
   and it's usually wrong for this module. Correct it to the exact value in the
   table.
3. Set the default and help text from the table.
4. Click the **✕** next to the field's name at the top of the panel to go back to
   the Fields list, then add the next one.

| # | Field type | Label | HubL variable name | Default | Help text (optional) |
|---|---|---|---|---|---|
| 1 | **Form** | `Form (step 1)` | `step_form` | Your step-1 form, if it exists yet. Keep *"Supported form versions"* on **Forms and legacy forms**. Mark it required. | The HubSpot form buyers fill in before paying. Its email field is passed to Stripe as prefilled_email. |
| 2 | **Text** | `Step 1 tab label` | `tab_1_label` | `YOUR INFO` | |
| 3 | **Text** | `Step 2 tab label` | `tab_2_label` | `CHECKOUT` | |
| 4 | **Text** | `Stripe Link` | `stripe_link` | *(empty)* | The live Stripe Payment Link. Its confirmation behavior must be 'redirect' or no UTMs are captured. |
| 5 | **Text** | `Submit button label` | `button_label` | `Continue to Payment` | Replaces the form's own submit text. |
| 6 | **Boolean** | `Prefill email on Stripe` | `prefill_email` | **On** | Adds prefilled_email so the payment matches the HubSpot contact. |
| 7 | **Boolean** | `Open checkout in a new tab` | `open_new_tab` | **Off** | Usually leave off. |
| 8 | **Boolean** | `Test mode` | `test_mode` | **Off** | Uses Test Stripe Link and shows a TEST MODE banner to everyone. |
| 9 | **Text** | `Test Stripe Link` | `test_stripe_link` | *(empty)* | Stripe test-mode payment link. Only used when Test mode is on. |

For the three Boolean fields, set the display to a toggle if HubSpot offers the
choice *(wording may differ)*. It only changes how the switch looks in the page
editor.

The Fields list shows each one as *Label (Type)* over the variable name, e.g.
*Stripe Link (Text)* / `stripe_link`. Compare every variable name against the
table before you publish.

> ⚠️ **The variable name is what the code reads. The label is only for people.**
> In the original build the field was labelled *Stripe Link* with the variable
> `stripe_link`, while the first draft of `module.html` read `module.stripe_url`.
> The page rendered fine and checkout silently had no link. Don't rename a
> variable once pages use the module, either: HubSpot stores each page's value
> under the variable name, so a rename blanks the field on every page.

> ⚠️ **If you cloned an existing module instead of creating a new file,** delete
> the fields it brought along (the original build inherited a leftover CRM object
> field) and change the **Label**, which still carries the old module's name.

**4e. Add the editor reminder.** In the right sidebar, below **Style Fields**,
expand **Editor options** and paste this into **Inline help text** (400-character
limit):

```
Paste the Stripe Payment Link (buy.stripe.com/... or your checkout domain), not a dashboard.stripe.com URL. The link's confirmation behavior must be 'redirect'.
```

If you're inside a field's settings and can't see **Editor options**, click the
**✕** next to the field's name to get back to the module level.

**4f. Publish.**
1. Check **Make available in templates and pages** (top right) is switched on.
2. Click **Publish changes**. When it's done the button greys out, meaning
   nothing is left unpublished.

#### 4B. With the HubSpot CLI

Instead of 4a–4f, if you use the
[HubSpot CLI](https://developers.hubspot.com/docs/cms/developer-reference/local-development-cli):

```powershell
npm install -g @hubspot/cli
hs init                                   # first time only: connects the CLI to your portal
hs upload module/order-form-stripe.module order-form-stripe.module
```

That uploads all five files, including `fields.json` (the nine fields) and
`meta.json` (label, content types and inline help text). Then open **Content** >
**Design Manager**, find **order-form-stripe.module**, and check the nine fields
are there.

✅ **Check:** open the module in Design Manager and click **Preview**. You should
see the two tabs (*YOUR INFO* / *CHECKOUT*) and your default form. The **No
errors found** line is showing and **Publish changes** is greyed out.

---

### Step 5: Put the module on your order page

*About 15 minutes.*

**5a. Get the step-1 form ready.**
1. **Marketing** > **Forms**. Open the form buyers will fill in, or create one with
   **First name**, **Last name**, **Email** (required) and **Phone number**.
2. Set what happens after submit to a **thank-you message**, not a redirect. In
   the legacy form editor it's **Options** > *"What should happen after someone
   submits?"* > **Display a thank you message**. In the new editor it's **On
   submission** > **Show thank you message**. Leave the default message text.
3. Set the form's own **Button text** to the same words as the module's
   **Submit button label** (`Continue to Payment`).
4. **Publish** the form.

> ⚠️ **A form that redirects breaks the order form, and can charge the wrong
> price.** The module detects submission by watching the form's fields disappear.
> A redirect navigates away before that happens. In the original build a page
> whose form redirected to a different payment link sold the full-price product
> instead of the cheaper plan the page advertised. The module's HubL tag already forces an inline
> response, but set the form correctly anyway, so the same form is safe
> anywhere else it's used.

> ⚠️ **Why match the button text:** HubSpot resets the submit button's text
> behind the module's back, so a mismatch makes it flash from *Continue to
> Payment* back to *Submit* on click. The module re-applies its label for 3
> seconds after a click, and matching the form removes the flash entirely.

> ⚠️ **If the form shows its thank-you message instead of fields, even in a
> private window,** the form itself is broken, not your browser. Open the form's
> share link on its own to confirm. In the original build a form made in the new
> form editor always served its thank-you state; rebuilding it in the **legacy
> form editor** fixed it.

**5b. Add the module to the page.**
1. Open the order page in the page editor (**Content** > **Landing pages** or
   **Website pages** > hover the page > **Edit**).
2. Click **+** (**Add**) in the left toolbar, search `Order Form (Stripe)`, and drag
   it into the section where the order form goes.
3. Remove anything else that sends buyers to checkout: a separate form module
   pointing at the same form, a HubSpot **Payment** module, a Stripe buy button, or
   a redirect module. Use the **Contents** tree in the left toolbar to find them.

**5c. Fill in the module settings.** Click the module. Its panel opens on the
**Content** tab.
1. **Form (step 1):** pick the form from 5a. Its fields appear under **Form
   fields**, editable in place.
2. **Stripe Link:** paste the URL you copied in Step 1c.
3. **Submit button label:** `Continue to Payment`, or your own wording.
4. **Prefill email on Stripe:** on. Stripe shows a prefilled email read-only,
   which is what ties the payment to the contact.
5. **Open checkout in a new tab:** off. The redirect runs after the form's
   asynchronous submit, so most browsers block a new tab. The module then falls
   back to the same tab anyway.
6. **Test mode:** off for now.

**5d. Preview in test mode first.** *Optional, but it's the safe way to click
through checkout.*
1. In Stripe, switch to test mode, create a copy of your Payment Link there with
   the same **After payment** redirect (Step 1b), and **Copy link**.
2. In the module, paste it into **Test Stripe Link** and turn **Test mode** on.
   An amber banner appears: *"TEST MODE — this form points at a Stripe test
   payment link. No real payment will be taken. Turn Test mode off before
   publishing."*
3. Click **Preview**, fill in the form and submit. You land on the Stripe **test**
   checkout. Pay with card `4242 4242 4242 4242`, any future expiry, any CVC.
4. Turn **Test mode** off again before publishing.

> ⚠️ **Test mode never falls back to the live link.** If Test mode is on and
> **Test Stripe Link** is empty, checkout is disabled and the checkout panel says
> *"Test mode is on but no test link is set."* That's deliberate: a test page must
> not be able to take real money. The banner shows to **every** visitor, also on
> purpose, so a page published in test mode is noticed straight away.

**5e. Publish.** Click **Publish** (or **Update** for a page that's already live).

✅ **Check:** in a private window, open the **published** page with
`?utm_source=test&utm_campaign=Brand%20|%20Fall` on the end, fill in the form and
submit. The *CHECKOUT* tab turns current, *"Redirecting you to secure
checkout…"* shows for a moment, and you land on Stripe with
`utm_source=test&utm_campaign=Brand-Fall` and `prefilled_email=...` in the URL,
and your email already filled in. The pipe and spaces became `-` because Stripe
drops UTM values with any other characters.

If instead the *CHECKOUT* tab shows *"No Stripe payment link set. Open this
module's settings and paste the Stripe Payment Link URL into Stripe Link."*, the
**Stripe Link** field is empty on this page (or the variable name isn't
`stripe_link`). If you press **Back** from Stripe, the page shows a **Continue to
Payment** button instead of redirecting again. That's intended.

---

### Step 6: Create the payment-record properties

*About 10 minutes with the script, 20 by hand.*

The workflow in Step 7 writes the campaign onto your payment records. These are
the properties it writes. The `stripe_` prefix on the UTM fields is deliberate:
contacts already have `utm_source`, and it means something different there (see
[section 4](#4-the-attribution-rules)).

| Internal name | Label | Field type |
|---|---|---|
| `stripe_utm_source` | Stripe UTM Source | Single-line text |
| `stripe_utm_medium` | Stripe UTM Medium | Single-line text |
| `stripe_utm_campaign` | Stripe UTM Campaign | Single-line text |
| `stripe_utm_content` | Stripe UTM Content | Single-line text |
| `stripe_utm_term` | Stripe UTM Term | Single-line text |
| `checkout_session_id` | Checkout Session ID | Single-line text |
| `payment_link_id` | Payment Link ID | Single-line text |
| `redeemed_promo_code` | Redeemed Promo Code | Single-line text |
| `stripe_utm_capture_method` | Stripe UTM Capture Method | Dropdown select, options `Success URL`, `Client Reference ID`, `Session Metadata` |

Your PaymentIntent property (the one holding `pi_...`) already exists. Your sync
owns it. Don't create or change it.

> ⚠️ **Create all nine, even if you only care about the source.** The action
> sends one update per record. If a single property in it doesn't exist, or a
> dropdown value isn't an option, HubSpot rejects the **whole** update, UTMs
> included, and only the workflow log says so.

**6a. Find the object type id and property group.**
1. Open your payment object's records (**CRM** > your object). The URL contains
   the object type id, e.g. `.../objects/2-12345678/...`. Write down `2-12345678`.
2. **Settings** > **Data Management** > **Properties**, and switch the object
   selector to your payment object. Pick the group the new properties should go
   in. The script needs the group's **internal** name, which is usually the object
   name plus `_information` (e.g. `stripe_payment_transaction_information`).
   *(If unsure, open the **Groups** view and check it. Wording may differ.)*

**6b. Create a HubSpot key for the scripts.** Settings > **Integrations** >
**Service Keys** (older portals: **Private Apps**) > create a key named
`Payment property setup` with scopes `crm.schemas.custom.read` and
`crm.schemas.custom.write`. Copy it (starts with `pat-`). This key is for your
computer only. The workflow gets its own key in Step 7a.

**6c. Run the scripts.**

```powershell
$env:HUBSPOT_TOKEN  = "pat-..."            # the key from 6b
$env:OBJECT_TYPE    = "2-12345678"         # from 6a
$env:PROPERTY_GROUP = "your_group_name"    # from 6a
node scripts/create-properties.mjs --dry-run
node scripts/create-properties.mjs
$env:PI_PROPERTY = "stripe_payment_intent_id"   # the internal name of YOUR pi_... property
node scripts/verify-properties.mjs
```

- `--dry-run` first prints the object it found (`Object 2-12345678 = ...`) and a
  `would create` line for each property, and writes nothing.
- The real run prints `created` or `exists` for each. It's safe to re-run:
  existing properties are skipped, and an existing dropdown only gets its
  **missing** options added. Add `--prune` to also remove options that aren't in
  the list.
- `verify-properties.mjs` prints `ok` or `FAIL` per property, a list of
  **Similar names** if it spots near-misses, and ends with **All good.** or
  **FAILED: fix the names above before building the workflow.**

**6d. Or create them by hand.** Settings > **Data Management** > **Properties** >
your object > **Create property**. In **Create new property**, stay on **Create
manually**:
1. Type the **Property label** from the table.
2. Click the **`</>`** icon next to the label to see the internal name. Make it
   match the table exactly.
3. **Field type:** **Single-line text**, or **Dropdown select** for the capture
   method. For the dropdown, add the three options with each option's label and
   internal value **identical**: `Success URL`, `Client Reference ID`, `Session
   Metadata`.
4. Pick your group, then **Create**.

Then run `verify-properties.mjs` from 6c anyway. **Don't** run
`create-properties.mjs` over properties you made by hand until verify passes: if
a hand-made internal name differs, the script creates a second property instead
of telling you.

> ⚠️ **A trailing space breaks everything and looks perfect.** A label typed as
> `Checkout Session ID ` becomes the internal name `checkout_session_id_`. The UI
> looks right and every write fails. `verify-properties.mjs` lists it under
> **Similar names**.

> ⚠️ **Dropdown values are invisible in the UI.** HubSpot shows option *labels*,
> but the action writes option *values*. An option that reads `Success URL` but
> stores `success_url` rejects every update. The verify script prints any option
> whose label and value differ. In the original build, the dropdown was created
> by hand from an early option list and had to be fixed with `--prune`.

✅ **Check:** `verify-properties.mjs` ends with **All good.** In **Properties**,
searching `stripe` shows the six *Stripe UTM ...* properties in your group, with
*Stripe UTM Capture Method* as a **Dropdown select**.

---

### Step 7: Build the Stripe UTM workflow

*About 30 minutes.*

For each payment record, the workflow finds the Stripe Checkout Session that
produced it, reads the UTMs out of the session's `success_url`, and writes them
onto the record together with the promo code, session id and link id.

**7a. Create the two credentials.**

1. **HubSpot key for the workflow.** Settings > **Integrations** > **Service
   Keys** > create a key named `Payment UTM write`. Click **+ Add new scope** and
   add `crm.objects.custom.write`. HubSpot pairs it with
   `crm.objects.custom.read`. Nothing else: the action makes exactly one HubSpot
   call, an update to the enrolled record. Create, then copy the key.

   > ⚠️ **Use a key dedicated to this workflow.** In the original build the
   > action reused another workflow's key because it already had the right
   > scope. That works, but rotating or deleting the key over there silently breaks
   > this action too, and the log only shows a `401` with no hint of the other
   > workflow.

2. **Stripe key for the workflow.** Stripe > **Developers** > **API keys** > **+
   Create restricted key** > **Powering an integration you built** > **Continue**
   > **Choose your own →**. Name it `HubSpot payment UTM`, and set:

   | Resource | Permission | Why |
   |---|---|---|
   | **Checkout Sessions** | **Read** | Finds the session and its `success_url` |
   | **Promotion Codes** *(wording may differ)* | **Read** | Turns `promo_...` into the code people typed (`SAVE10`) |

   **Create key** and copy it (`rk_live_...`). Make sure you're in **live** mode,
   not a sandbox.

   > ⚠️ **Without Promotion Codes read, the promo code silently stays blank.** The
   > session lookup still works, so nothing errors. Partner and affiliate codes
   > are often the only attribution a sale has, so this matters.

**7b. Create the workflow.**
1. **Automation** > **Workflows** > **Create workflow** > **From scratch**.
2. Choose your payment object as the workflow's object (e.g. **Stripe Payment
   Transaction**-based) *(wording may differ)*.
3. Name it `Stripe UTM Tracking` (click the pencil next to *Unnamed workflow* at
   the top).

**7c. Set the trigger.**
1. Click the trigger card (*"Trigger enrollment for [your object]"*). The
   **Triggers** panel opens on **Start triggers**.
2. Under *"Only enroll [your object] that meet these conditions"*, in **Group 1**,
   pick your PaymentIntent property (e.g. **Stripe Payment Transaction ID**) and
   choose **is known**.
3. Click **Done**, then **Save**. The card now reads *"[Your PaymentIntent
   property] is known"*.
4. **Turn on re-enrollment.** The trigger card's footer shows **Re-enroll off**.
   Click it (or the panel's **Settings** tab) and switch re-enrollment on for
   this trigger, then **Save** *(wording may differ)*. The footer should now read
   **Re-enroll on**.

> ⚠️ **Re-enrollment off means one attempt per payment.** In the original build it
> was off at first. A run that fails once (a Stripe outage, an expired key) is
> then never retried, and that sale stays blank forever. The action is safe to
> re-run: it never overwrites a value that's already set.

**7d. Add the custom code action.**
1. Click **+** under the trigger and choose **Custom code** (in the **Data ops**
   group, or search `code`). The panel opens titled **Custom code**, with
   **Cancel** and **Save**.
2. **Language:** **Node.js 20.x**.
3. **Secrets** (*"Choose one or multiple secrets to use in this action."*): open
   the dropdown and add two new secrets *(the "add secret" wording may differ)*.
   The **name** must be exact, because the code reads the secret by name:

   | Secret name | Value |
   |---|---|
   | `PAYMENT_UTM_WRITE_TOKEN` | The HubSpot key from 7a.1 (`pat-...`) |
   | `STRIPE_READ_KEY` | The Stripe key from 7a.2 (`rk_live_...`) |

   Tick both in the dropdown's list, so both show as chips in the field. If you
   use different names, change `TOKEN_SECRET_NAME` / `STRIPE_SECRET_NAME` at the
   top of the code to match.

   > ⚠️ **A test key "works" and blanks everything.** An `sk_test_` or `rk_test_`
   > key authenticates, then gets a 404 on every live session, which would look
   > like "no attribution found". The action refuses test keys with *"not a live
   > Stripe key"* instead.

4. **Code:** delete the sample code and paste in **all** of
   [`workflow-action/stripe-utm-action.js`](workflow-action/stripe-utm-action.js) (the **Full screen** button makes this
   easier). Then edit the settings block at the top:

   | Setting | Set it to |
   |---|---|
   | `OBJECT_TYPE` | Your object type id from Step 6a, e.g. `'2-12345678'` |
   | `PI_PROPERTY` | The internal name of your PaymentIntent property, e.g. `'stripe_payment_intent_id'` |

   Leave the other constants alone unless you renamed the secrets or properties.

5. **Property to include in code** (*"Each property needs to be defined in your
   code."*): for each row, click **Add property**, type the **input name** in the
   left box exactly, then click **Select a property** on the right. That opens
   the **All data tokens** panel. Pick the property from your enrolled payment
   object's own properties.

   | Input name | Value (property on the enrolled payment record) |
   |---|---|
   | *your `PI_PROPERTY` value*, e.g. `stripe_payment_intent_id` | Your PaymentIntent property, e.g. *Stripe Payment Transaction ID* |
   | `stripe_utm_source` | *Stripe UTM Source* |
   | `stripe_utm_medium` | *Stripe UTM Medium* |
   | `stripe_utm_campaign` | *Stripe UTM Campaign* |
   | `stripe_utm_content` | *Stripe UTM Content* |
   | `stripe_utm_term` | *Stripe UTM Term* |
   | `checkout_session_id` | *Checkout Session ID* |
   | `payment_link_id` | *Payment Link ID* |
   | `redeemed_promo_code` | *Redeemed Promo Code* |

   That's nine rows. The eight properties the action writes are inputs so it can
   see what's already set and skip it. `stripe_utm_capture_method` isn't read by
   the code, so it doesn't need a row.

   > ⚠️ **The left box is the literal key the code looks up.** The boxes are narrow,
   > so long names display cut off (`stripe_payment_tran`, `redeemed_promo_c`).
   > Click into each box and check the full text. If the PaymentIntent input is
   > really misspelled, every record exits as `no_pi_id` with no error, which is
   > easy to misread as "Stripe has no data".

   > ⚠️ **Don't add rows for properties you don't have.** An input with no
   > property shows *"Property selection is required"* and blocks **Save**. In
   > the original build a row was added for Stripe's `order_reference`, but the
   > sync didn't map that field, so there was nothing to select. The code finds
   > the session without it.

6. **Data outputs** (*"Define the data type and name of outputs from your code."*):
   click **Add output** for each row. You only need these to branch on the result
   later; the log shows everything regardless. HubSpot also adds a built-in
   `hs_execution_state` (Enumeration) output. Leave it alone.

   | Output | Type |
   |---|---|
   | `utmSource` | String |
   | `promoCode` | String |
   | `status` | String |

7. Click **Save** at the top of the panel.

**7e. Test the action.**
1. In the same panel, scroll to the bottom. Below **Configure rate limit**, expand
   **Test action**. HubSpot warns *"Changes will be applied to your [object]..."*.
   This is a real run, not a simulation: it updates the record you pick. That's
   safe here, because the action never overwrites values already set.
2. In the object dropdown under the warning, pick a recent payment that came
   through a Payment Link. The picker searches by the record's display name, so if
   searching by `pi_...` finds nothing, find the record in the object's list view
   first (filter on your PaymentIntent property) and search by its name.
3. Click **Test**.

✅ **Check:** **Status** reads **Success**. The **Data outputs** table shows
`hs_execution_state` = `SUCCESS` and a `status` value from the table below. An
output reading *"Not defined in output field"* means it's returned by the code
but missing from **Data outputs** (harmless, or a typo in the output name).
**Logs** shows one line like this, then Memory and Runtime:

```
INFO  record 12345678901: session cs_live_a1B2c3... -> {"stripe_utm_source":"newsletter","checkout_session_id":"cs_live_a1B2c3...","payment_link_id":"plink_1AbC...","stripe_utm_capture_method":"Success URL"} (updated_from_success_url)
Memory: 111/2048 MB
Runtime: 552.43 ms
```

Expect about half a second and about 110 MB, far inside HubSpot's limits.

| `status` | What it means | What to do |
|---|---|---|
| `updated_from_success_url` | UTMs found and written. The good path. | Nothing |
| `updated_promo_only` | No UTM on the link, but a promo code was used and written | Normal for untagged links |
| `ids_only_no_attribution` + *[redirect set, but the link was not tagged with UTMs]* | Only the session and link ids were written | The buyer's link had no UTMs: check Steps 3 and 5 cover that path |
| `ids_only_no_attribution` + *[no redirect confirmation on this link: Stripe cannot capture UTMs at all]* | The link shows Stripe's confirmation page | Step 1b |
| `updated_from_client_reference_id` | No UTMs; the link's `client_reference_id` was used | Tag the link with UTMs instead |
| `no_session` | An invoice or subscription payment, which has no Checkout Session | Expected |
| `nothing_found` | Everything was already set (a second test of the same record) | Expected |
| `no_pi_id` | The PaymentIntent input was empty | The input name doesn't match `PI_PROPERTY` (7d.5), or that record has no `pi_...` |

If the log shows an error instead:

| Error | Fix |
|---|---|
| `No secret named PAYMENT_UTM_WRITE_TOKEN` / `STRIPE_READ_KEY` | The secret isn't attached as a chip, or its name differs (7d.3) |
| `... is not a live Stripe key` | Use the `rk_live_` key (7a.2) |
| `-> 401` or `-> 403. Check the credential and its scopes.` | HubSpot key missing `crm.objects.custom.write`, or Stripe key missing **Checkout Sessions: Read** or **Promotion Codes: Read** |
| `PATCH ... -> 400` | A property name or dropdown value doesn't exist. Run `verify-properties.mjs` (Step 6c). |

A real UTM result needs a paid sale through a link that was tagged at the time.
If none of your existing records has one, you'll see `ids_only_no_attribution` or
`updated_promo_only` here. That's correct. Step 8 creates a tagged one.

**7f. Turn it on.**
1. Click **Review and publish** (top right) *(wording may differ)*.
2. When asked about records that already meet the trigger, **don't enroll
   existing records**. With tens of thousands of past payments, that's one
   Stripe call each, almost all returning `no_session` or no attribution.
3. Turn the workflow on. The header shows **ON**.

✅ **Check:** the workflow header reads **ON**, the trigger footer reads **Re-enroll
on**, and the action card reads *"1. Custom code — Defined by custom code."*
After your next sale, open the workflow's **Action logs** tab, click the event,
and the **Event details** panel shows the **Return value** and **Logs** from
that run.

---

### Step 8: Test end to end

*About 20 minutes, plus a few minutes for the sync.*

Stripe test mode can check the page and the redirect, but not the workflow.
Most Stripe-to-HubSpot syncs, including HubSpot's Stripe Data Sync, only read
**live** mode, so a test payment never creates a record for the workflow to run
on. So the test has two passes.

**8a. Test-mode pass: the page and Stripe's redirect.**
1. Clear your test cookie on any page of your site (browser console):
   `document.cookie = 'site_attr=; domain=.example.com; path=/; max-age=0'`
2. In a private window, open a **landing page** (not the order page) with a
   realistic ad-style URL, pipes and spaces included:
   `https://www.example.com/landing?utm_source=test&utm_medium=qa&utm_campaign=Launch%20|%20Test`
3. In the console, check the cookie holds the **raw** values:
   `JSON.parse(decodeURIComponent(document.cookie.match(/site_attr=([^;]*)/)[1]))`
   You should see `utm_campaign: "Launch | Test"`. Cleaning happens only on the
   way out to Stripe.
4. Go through your funnel to the order page the normal way (form redirects and
   all). The order page's URL will usually have no UTMs. That's the case this
   build exists for.
5. Turn on **Test mode** in the module (Step 5d) and submit the order form. On the
   Stripe checkout, the address bar shows
   `utm_source=test&utm_medium=qa&utm_campaign=Launch-Test&prefilled_email=...`.
6. Pay with `4242 4242 4242 4242`. Stripe redirects you to your thank-you page,
   and **its** URL carries `utm_source=test&utm_medium=qa&utm_campaign=Launch-Test`.
   That's the value the workflow will read back from `success_url`.
7. Turn **Test mode** off and republish the page.

> ⚠️ **Test purchases can still trigger other things connected to Stripe**
> (accounting, community platforms, automation tools). Check before running
> many. And a real purchase on the live link fires real conversion events into
> your ad platforms, so use test mode for everything you can.

**8b. Live pass: the workflow.**
1. Repeat 8a steps 1–4 with Test mode **off**, and complete a small real purchase
   (a low-priced product, or a partial-discount code you then refund). A
   100%-off code **won't** work: a $0 order has no PaymentIntent, so most syncs
   create no record and the workflow never runs (see
   [section 6](#6-what-this-cant-capture)).
2. Wait for the sync to create the payment record (usually a few minutes).
3. Open the workflow's **Action logs** tab and click the new event.
4. Refund the purchase in Stripe (**Payments** > the payment > **Refund**).
5. Clear your test cookie again.

✅ **Check:** the event's **Logs** end with `(updated_from_success_url)`, and the
payment record shows **Stripe UTM Source** = `test`, **Stripe UTM Campaign** =
`Launch-Test` and **Stripe UTM Capture Method** = `Success URL`. After a few days
of real sales, group your payment records by **Payment Link ID** and filter to
records with no **Stripe UTM Source**: that's your list of links and paths still
losing attribution, ranked by revenue.

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
  the workflow ([Step 8](#step-8-test-end-to-end)).
- Stripe test purchases can still trigger anything else you've connected to
  Stripe (accounting, community, Zapier). Check before running many.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Most payments have no source | Header script missing on some domains, or the order page is reached through a domain that isn't covered | Step 3, every domain |
| `utm_campaign` missing but `utm_source` present | The value had spaces or pipes and the module isn't the one on the page | Check the page uses this module (view source for `eof`) |
| Every sale through a link shows the same source | UTMs hard-coded on the link's redirect URL | `audit-payment-links.mjs` HARD-CODED list |
| Form submits but nothing happens | Form set to redirect instead of inline, or Stripe Link empty | Step 5 |
| Stuck on "Redirecting you to secure checkout..." | Navigation blocked | The module shows a pay button after 3 s; check for a popup blocker if **Open in new tab** is on |
| Payment not linked to the contact | `prefill_email` off, or the payment never completed | Turn prefill on. Stripe only creates the customer, and most syncs only link the contact, once a payment **succeeds**. |
| Workflow error `... -> 400` on PATCH | A property name or dropdown value doesn't exist | `verify-properties.mjs` |
| Workflow error `not a live Stripe key` | Test key in `STRIPE_READ_KEY` | Use a live restricted key |
| Workflow `-> 401/403` | Token scopes | Step 7a |
| Values on the record look truncated at 150 | Stripe's limit | Shorten campaign names at the source |

**Debugging in the browser:** on any page, `document.cookie` shows `site_attr`
(the stored campaign) and `site_entry` (this visit's platform). On the order page,
`document.querySelector('.eof').dataset.stripeUrl` is the link being used.

---

## 9. Security and privacy

- **Secrets stay in HubSpot's secret store.** Never paste a token into the code; the
  action reads them from environment variables and never logs them.
- **Use a restricted Stripe key** with Checkout Sessions: read and Promotion Codes: read, nothing more.
- **The email travels in the Stripe URL** as `prefilled_email`. That's Stripe's
  documented mechanism, but the URL can appear in browser history and analytics.
  Turn prefill off if that matters more than contact matching.
- **The cookies are first-party and hold campaign parameters only**, no personal
  data. If your site uses a consent banner that gates non-essential cookies, put the
  header script behind it.
- Don't put secrets or personal data in `client_reference_id`; Stripe shows it in
  places you might not expect.
