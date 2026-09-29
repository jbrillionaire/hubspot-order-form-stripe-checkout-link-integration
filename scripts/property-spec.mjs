/**
 * property-spec.mjs -- the payment-record properties the workflow action writes
 * ---------------------------------------------------------------------------
 * Author:  Jibril Sulaiman
 * Created: 2026-09-28
 * Deploy:  Local only; imported by create-properties.mjs and verify-properties.mjs.
 * What:    One list of internal names, types and dropdown values.
 * Why:     The action sends ONE PATCH per record. If a single name or dropdown
 *          value is wrong, HubSpot rejects the whole write, UTMs included, and
 *          the workflow log is the only place that says so. test/spec.test.mjs
 *          checks this file against the constants in the action.
 */

export const TEXT_PROPERTIES = [
  { name: 'stripe_utm_source', label: 'Stripe UTM Source', description: 'utm_source on the Stripe Payment Link the buyer used, recovered from the Checkout Session success_url.' },
  { name: 'stripe_utm_medium', label: 'Stripe UTM Medium', description: 'utm_medium from the Stripe Payment Link URL.' },
  { name: 'stripe_utm_campaign', label: 'Stripe UTM Campaign', description: 'utm_campaign from the Stripe Payment Link URL (cleaned to letters, digits, - and _).' },
  { name: 'stripe_utm_content', label: 'Stripe UTM Content', description: 'utm_content from the Stripe Payment Link URL.' },
  { name: 'stripe_utm_term', label: 'Stripe UTM Term', description: 'utm_term from the Stripe Payment Link URL.' },
  { name: 'checkout_session_id', label: 'Checkout Session ID', description: 'cs_live_... session that produced this payment. Join key back to Stripe.' },
  { name: 'payment_link_id', label: 'Payment Link ID', description: 'plink_... the buyer came through. Identifies the offer independently of line items.' },
  { name: 'redeemed_promo_code', label: 'Redeemed Promo Code', description: 'Promotion code used at checkout. Partner and affiliate codes often land here rather than in utm_source.' },
];

export const CAPTURE_METHOD = {
  name: 'stripe_utm_capture_method',
  label: 'Stripe UTM Capture Method',
  description: 'Where the UTM values on this record came from. Blank means no UTM was found; a promo code alone does not set it.',
  options: ['Success URL', 'Client Reference ID', 'Session Metadata'],
};

export const ALL_WRITTEN = [...TEXT_PROPERTIES.map((p) => p.name), CAPTURE_METHOD.name];
