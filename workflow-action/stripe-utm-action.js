/**
 * stripe-utm-action.js -- HubSpot custom code action: stamp Stripe UTMs on a payment record
 * -----------------------------------------------------------------------------------------
 * Author:  Jibril Sulaiman
 * Created: 2026-09-28 (from a production build first shipped 2026-09-03)
 *
 * Deploy:  HubSpot > Automation > Workflows > a workflow on the object your Stripe
 *          payments land in > "Custom code" action, Node.js 20.x. Paste the whole
 *          file. Settings to change are the constants in the first block.
 *          Never put this in a page or Design Manager: it holds two secrets.
 *
 * What it does:
 *   For one payment record (a Stripe PaymentIntent), finds the Checkout Session
 *   that produced it and writes onto the record, without overwriting anything
 *   already set:
 *     - utm_source / medium / campaign / content / term, parsed from the
 *       session's success_url (then session metadata, then client_reference_id)
 *     - the human promo code the buyer redeemed (expanded from promo_...)
 *     - the Checkout Session id and Payment Link id (join keys back to Stripe)
 *     - where the UTM came from (capture method), so you know how far to trust it
 *
 * Why it reads success_url:
 *   Stripe has no UTM field on the Checkout Session and none in the
 *   payment_intent.succeeded webhook. But when a Payment Link's confirmation
 *   behavior is "redirect", Stripe copies the UTM params from the link URL onto
 *   the redirect, i.e. into the session's success_url, which the API returns:
 *     "success_url": "https://www.example.com/thank-you?utm_source=newsletter"
 *   So attribution needs no thank-you-page script and no external server.
 *
 * Caveat: if the link's configured redirect URL itself contains ?utm_source=...,
 *   every sale through it reports that value, whether or not the buyer arrived
 *   with one. The API can't tell them apart. Run scripts/audit-payment-links.mjs.
 *
 * Doesn't reach: $0 checkouts (no PaymentIntent, so no record), links set to
 *   Stripe's hosted confirmation message (no success_url), and invoice or
 *   subscription-renewal payments (no Checkout Session).
 */

// ---- settings -----------------------------------------------------------------
const OBJECT_TYPE = '2-00000000';                 // object type id of the payment records this workflow runs on
const PI_PROPERTY = 'stripe_payment_intent_id';   // property holding the pi_... id (workflow input)
const TOKEN_SECRET_NAME = 'PAYMENT_UTM_WRITE_TOKEN';  // secret: HubSpot service key/private app token with write on OBJECT_TYPE
const STRIPE_SECRET_NAME = 'STRIPE_READ_KEY';         // secret: Stripe live restricted key, Checkout Sessions: read + Promotion Codes: read
// Properties written (create them with scripts/create-properties.mjs).
const UTM_PREFIX = 'stripe_';                     // utm_source in the URL -> stripe_utm_source on the record
const PROMO_PROPERTY = 'redeemed_promo_code';
const SESSION_PROPERTY = 'checkout_session_id';
const LINK_PROPERTY = 'payment_link_id';
// -------------------------------------------------------------------------------

const BASE = 'https://api.hubapi.com';
// The only UTM keys Stripe carries into success_url (docs.stripe.com/payment-links/url-parameters).
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const prop = (key) => UTM_PREFIX + key;
const CAPTURE_METHOD_PROPERTY = prop('utm_capture_method');

// Where the value came from, not which script wrote it. Must match the dropdown
// options exactly, or HubSpot rejects the whole PATCH.
const CAPTURE_METHODS = {
  success_url: 'Success URL',
  session_field: 'Session Metadata',
  metadata: 'Session Metadata',
  client_reference_id: 'Client Reference ID',
};

const WRITABLE = [...UTM_KEYS.map(prop), PROMO_PROPERTY, SESSION_PROPERTY, LINK_PROPERTY];

function getToken() {
  const value = (process.env[TOKEN_SECRET_NAME] || '').trim();
  if (!value) {
    throw new Error(`No secret named ${TOKEN_SECRET_NAME}. Attach a HubSpot token with write access to ${OBJECT_TYPE}.`);
  }
  // Never log the value: action logs are widely readable.
  if (/^https?:\/\//i.test(value) || /\s/.test(value)) {
    throw new Error(`Secret ${TOKEN_SECRET_NAME} looks like a URL or contains whitespace; attach the token itself.`);
  }
  return value;
}

function getStripeKey() {
  const value = (process.env[STRIPE_SECRET_NAME] || '').trim();
  if (!value) throw new Error(`No secret named ${STRIPE_SECRET_NAME}. Add a live restricted key with Checkout Sessions: read and Promotion Codes: read.`);
  // A test key authenticates, then 404s on every live session: that reads as
  // "no attribution found" rather than a bad secret, so refuse it up front.
  if (!/^(sk|rk)_live_/.test(value)) {
    throw new Error(`${STRIPE_SECRET_NAME} is not a live Stripe key; a test key would silently blank every field.`);
  }
  return value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, options, label) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`${label} -> ${res.status}`);
      await sleep(400 * 2 ** attempt);   // stays inside the 20 s action timeout
      continue;
    }
    const text = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error(`${label} -> ${res.status}. Check the credential and its scopes.`);
    if (!res.ok) throw new Error(`${label} -> ${res.status} ${text}`);
    return text ? JSON.parse(text) : {};
  }
  throw lastErr;
}

const hubspot = (token, path, method = 'GET', body) =>
  request(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }, `${method} ${path}`);

const stripe = (key, path, label) =>
  request('https://api.stripe.com/v1/' + path, { headers: { Authorization: `Bearer ${key}` } }, label);

// Expand the promotion code so the record gets the code people share (SAVE10),
// not a promo_... id. Retrieve and list use different expand paths.
const EXPAND_PROMO = 'expand[]=discounts.promotion_code';
const EXPAND_PROMO_LIST = 'expand[]=data.discounts.promotion_code';

const sessionById = (key, id) =>
  stripe(key, `checkout/sessions/${encodeURIComponent(id)}?${EXPAND_PROMO}`, `GET /v1/checkout/sessions/${id}`);

async function sessionByPaymentIntent(key, piId) {
  const list = await stripe(key,
    `checkout/sessions?payment_intent=${encodeURIComponent(piId)}&limit=1&${EXPAND_PROMO_LIST}`,
    `GET /v1/checkout/sessions?payment_intent=${piId}`);
  return (list.data || [])[0] || null;
}

function readUtm(session) {
  const found = {};
  let origin = '';
  const take = (key, value, from) => {
    const v = String(value == null ? '' : value).trim();
    if (!v || found[key]) return;
    found[key] = v;
    if (!origin) origin = from;
  };
  try {
    // success_url often still holds the literal {CHECKOUT_SESSION_ID}; it parses fine.
    if (session.success_url) {
      const params = new URL(session.success_url).searchParams;
      for (const key of UTM_KEYS) take(key, params.get(key), 'success_url');
    }
  } catch (err) {
    console.log(`could not parse success_url: ${err.message}`);
  }
  for (const key of UTM_KEYS) {   // defensive: in case Stripe or an integration adds them later
    take(key, session[key], 'session_field');
    take(key, (session.utm || {})[key], 'session_field');
    take(key, (session.metadata || {})[key], 'metadata');
    take(key, (session.metadata || {})[key.replace('utm_', '')], 'metadata');
  }
  return { values: found, origin };
}

// client_reference_id IS on the session and in the checkout.session.completed
// webhook, so it's the fallback for links shared without UTMs. Accepts a bare
// value ("partner-a") or packed pairs ("src-partner-a__med-sms__cmp-fall").
function readClientReference(session) {
  const raw = (session.client_reference_id || '').trim();
  if (!raw) return {};
  const NAMES = { src: 'utm_source', med: 'utm_medium', cmp: 'utm_campaign' };
  const found = {};
  for (const part of raw.split('__')) {
    const m = part.match(/^(src|med|cmp)-(.+)$/);
    if (m) found[NAMES[m[1]]] = m[2];
  }
  return Object.keys(found).length ? found : { utm_source: raw };
}

function readPromoCode(session) {
  for (const d of session.discounts || []) {
    const promo = d.promotion_code;
    if (promo && typeof promo === 'object' && promo.code) return String(promo.code).trim();
  }
  return '';
}

exports.main = async (event, callback) => {
  const token = getToken();
  const stripeKey = getStripeKey();
  const recordId = String(event.object.objectId);
  const piId = (event.inputFields[PI_PROPERTY] || '').trim();

  const existing = {};
  for (const name of WRITABLE) existing[name] = (event.inputFields[name] || '').trim();

  if (!piId) {
    console.log(`record ${recordId}: no PaymentIntent id in ${PI_PROPERTY}`);
    return callback({ outputFields: { utmSource: '', promoCode: '', status: 'no_pi_id' } });
  }

  // Re-enrollment: reuse the session id found last time instead of a list query.
  const known = existing[SESSION_PROPERTY];
  const session = known.startsWith('cs_')
    ? await sessionById(stripeKey, known)
    : await sessionByPaymentIntent(stripeKey, piId);

  if (!session) {
    console.log(`record ${recordId}: ${piId} has no checkout session (invoice or subscription payment)`);
    return callback({ outputFields: { utmSource: '', promoCode: '', status: 'no_session' } });
  }

  const utm = readUtm(session);
  const fallback = utm.origin ? {} : readClientReference(session);
  const attribution = utm.origin ? utm.values : fallback;
  const promoCode = readPromoCode(session);

  const properties = {};
  for (const [key, value] of Object.entries(attribution)) {
    if (!existing[prop(key)]) properties[prop(key)] = value;
  }
  if (promoCode && !existing[PROMO_PROPERTY]) properties[PROMO_PROPERTY] = promoCode;
  const foundAttribution = Object.keys(properties).length > 0;

  if (!existing[SESSION_PROPERTY]) properties[SESSION_PROPERTY] = session.id;
  const linkId = typeof session.payment_link === 'string' ? session.payment_link : (session.payment_link || {}).id;
  if (linkId && !existing[LINK_PROPERTY]) properties[LINK_PROPERTY] = linkId;

  if (Object.keys(properties).length === 0) {
    console.log(`record ${recordId}: session ${session.id} carried nothing new`);
    return callback({ outputFields: { utmSource: '', promoCode: '', status: 'nothing_found' } });
  }

  // A promo code alone is not a UTM, so it sets no capture method.
  const origin = utm.origin || (Object.keys(fallback).length ? 'client_reference_id' : '');
  const utmWritten = UTM_KEYS.some((k) => properties[prop(k)]);
  if (origin && utmWritten) properties[CAPTURE_METHOD_PROPERTY] = CAPTURE_METHODS[origin];

  await hubspot(token, `/crm/v3/objects/${OBJECT_TYPE}/${recordId}`, 'PATCH', { properties });

  const status = !foundAttribution ? 'ids_only_no_attribution'
    : utmWritten ? `updated_from_${origin}` : 'updated_promo_only';

  // "No attribution" has two causes with opposite fixes; say which.
  const diagnosis = foundAttribution ? ''
    : session.success_url ? ' [redirect set, but the link was not tagged with UTMs]'
    : ' [no redirect confirmation on this link: Stripe cannot capture UTMs at all]';

  console.log(`record ${recordId}: session ${session.id} -> ${JSON.stringify(properties)} (${status})${diagnosis}`);
  callback({ outputFields: { utmSource: properties[prop('utm_source')] || '', promoCode: properties[PROMO_PROPERTY] || '', status } });
};
