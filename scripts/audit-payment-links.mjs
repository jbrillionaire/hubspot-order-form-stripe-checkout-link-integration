#!/usr/bin/env node
/**
 * audit-payment-links.mjs -- which Stripe Payment Links can capture UTMs at all
 * ---------------------------------------------------------------------------
 * Author:  Jibril Sulaiman
 * Created: 2026-09-28 (from a production script first run 2026-09-03)
 * Deploy:  Run locally. Read-only: makes no changes to Stripe or HubSpot.
 *            $env:STRIPE_LIVE_KEY = "rk_live_..."   (restricted key, Payment Links: read)
 *            node scripts/audit-payment-links.mjs
 *            node scripts/audit-payment-links.mjs --all                      include inactive links
 *            node scripts/audit-payment-links.mjs --tag "utm_source=newsletter&utm_medium=email"
 * What:    Sorts every link into three groups:
 *            1. CANNOT CAPTURE: confirmation behavior isn't "redirect", so Stripe
 *               has nowhere to put UTMs. Tagging these URLs does nothing.
 *            2. HARD-CODED: the redirect URL itself contains utm_* params, so
 *               every sale reports that value no matter where the buyer came from.
 *            3. READY TO TAG: redirect set, no baked-in UTMs. With --tag it prints
 *               each share URL with your params appended, after checking them
 *               against Stripe's rule (letters, digits, - and _, max 150).
 * Why:     Both failure groups look exactly like "no one clicked a tagged link"
 *          in reports. This is the only place they show up.
 */

const STRIPE_KEY = process.env.STRIPE_LIVE_KEY;
const INCLUDE_INACTIVE = process.argv.includes('--all');

// --tag "utm_source=partner-a&utm_medium=sms" prints each share URL with those
// params already appended, ready to copy. Stripe silently drops values that are
// not alphanumeric/dash/underscore or run past 150 chars, so they are validated
// here rather than failing invisibly at checkout.
const tagIndex = process.argv.indexOf('--tag');
const TAG = tagIndex === -1 ? '' : (process.argv[tagIndex + 1] || '').replace(/^\?/, '');

if (TAG) {
  const bad = [];
  for (const pair of TAG.split('&')) {
    const [key, value = ''] = pair.split('=');
    if (!/^utm_(source|medium|campaign|content|term)$/.test(key)) bad.push(`${key}: not a UTM key Stripe tracks`);
    else if (!/^[A-Za-z0-9_-]+$/.test(value)) bad.push(`${key}: "${value}" has characters Stripe will drop`);
    else if (value.length > 150) bad.push(`${key}: longer than Stripe's 150-char limit`);
  }
  if (bad.length > 0) {
    console.error('Invalid --tag value:');
    for (const b of bad) console.error(`  ${b}`);
    process.exit(1);
  }
}

if (!STRIPE_KEY) {
  console.error('Missing STRIPE_LIVE_KEY in the environment.');
  process.exit(1);
}
if (!/^(sk|rk)_live_/.test(STRIPE_KEY)) {
  console.error(`Refusing to run: STRIPE_LIVE_KEY is not a live key (${STRIPE_KEY.slice(0, 8)}...).`);
  process.exit(1);
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

async function stripeGet(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_KEY}` },
  });
  if (!res.ok) throw new Error(`Stripe ${res.status} on ${path}: ${await res.text()}`);
  return res.json();
}

const links = [];
let startingAfter;
do {
  const page = await stripeGet(
    `payment_links?limit=100${startingAfter ? `&starting_after=${startingAfter}` : ''}`
  );
  links.push(...page.data);
  startingAfter = page.has_more ? page.data[page.data.length - 1].id : undefined;
} while (startingAfter);

const scoped = INCLUDE_INACTIVE ? links : links.filter((l) => l.active);
console.log(`${links.length} payment link(s); showing ${scoped.length}\n`);

const canCapture = [];
const cannotCapture = [];
const hardCoded = [];

for (const link of scoped) {
  const completion = link.after_completion || {};
  const redirectUrl = completion.redirect?.url;

  if (completion.type !== 'redirect' || !redirectUrl) {
    cannotCapture.push(link);
    continue;
  }

  let baked = [];
  try {
    const params = new URL(redirectUrl).searchParams;
    baked = UTM_KEYS.filter((k) => params.get(k));
  } catch {
    // A malformed configured URL is worth seeing rather than swallowing.
    baked = ['(unparseable redirect URL)'];
  }

  if (baked.length > 0) hardCoded.push({ link, redirectUrl, baked });
  else canCapture.push({ link, redirectUrl });
}

if (hardCoded.length > 0) {
  console.log('HARD-CODED UTMs - these report the same source on every sale:');
  for (const { link, redirectUrl, baked } of hardCoded) {
    console.log(`  ${link.id}  ${baked.join(', ')}`);
    console.log(`    ${redirectUrl}`);
  }
  console.log('');
}

if (cannotCapture.length > 0) {
  console.log('CANNOT CAPTURE UTMs - no redirect confirmation, so tagging the URL does nothing:');
  for (const link of cannotCapture) {
    console.log(`  ${link.id}  (after_completion: ${link.after_completion?.type ?? 'none'})`);
  }
  console.log('');
}

// The buy URL is what gets tagged - the UTM has to be on the link the buyer
// clicks, not on the redirect. Printed here so tagged URLs can be built directly.
console.log(`READY TO TAG - redirect set, no baked-in UTMs (${canCapture.length}):`);
for (const { link, redirectUrl } of canCapture) {
  console.log(`  ${link.id}`);
  console.log(`    share:    ${link.url}${TAG ? `?${TAG}` : ''}`);
  console.log(`    lands on: ${redirectUrl}`);
}

console.log(
  `\n${canCapture.length} ready, ${hardCoded.length} with baked-in UTMs, `
    + `${cannotCapture.length} unable to capture.`
);
