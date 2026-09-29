/**
 * action.test.mjs -- workflow-action/stripe-utm-action.js
 * Author: Jibril Sulaiman · Created: 2026-09-28 · Run: npm test
 * Why: the action runs unattended on every payment; a wrong write is only visible in reports.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { read } from './helpers.mjs';

const SRC = read('workflow-action/stripe-utm-action.js');

async function runAction({ inputs = {}, session, sessions, env = {}, hubspotStatus = 200 }) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    const text = (body) => ({ status: 200, ok: true, text: async () => JSON.stringify(body) });
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions?')) return text({ data: sessions ?? (session ? [session] : []) });
    if (url.startsWith('https://api.stripe.com/v1/checkout/sessions/')) return text(session);
    if (url.startsWith('https://api.hubapi.com/')) return { status: hubspotStatus, ok: hubspotStatus < 300, text: async () => '{}' };
    throw new Error('unexpected ' + url);
  };
  const module = { exports: {} };
  const ctx = {
    module, exports: module.exports, fetch, URL, console: { log: () => {} }, setTimeout: (fn) => fn(),
    process: { env: { PAYMENT_UTM_WRITE_TOKEN: 'pat-test', STRIPE_READ_KEY: 'rk_live_test', ...env } },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const out = await new Promise((resolve, reject) => {
    module.exports.main({ object: { objectId: 42 }, inputFields: { stripe_payment_intent_id: 'pi_1', ...inputs } }, resolve).catch(reject);
  });
  const patch = calls.find((c) => c.method === 'PATCH');
  return { out: out.outputFields, patch: patch && patch.body.properties, patchUrl: patch && patch.url, calls };
}

const SESSION = {
  id: 'cs_live_1',
  success_url: 'https://www.example.com/thank-you?session_id={CHECKOUT_SESSION_ID}&utm_source=fb&utm_medium=paid_social&utm_campaign=Brand-Sep',
  payment_link: 'plink_1',
  discounts: [{ promotion_code: { id: 'promo_1', code: 'SAVE10' } }],
};

test('reads UTMs from success_url and stamps them, the promo code, ids and the capture method', async () => {
  const { out, patch, patchUrl } = await runAction({ session: SESSION });
  assert.equal(patchUrl, 'https://api.hubapi.com/crm/v3/objects/2-00000000/42');
  assert.deepEqual(patch, {
    stripe_utm_source: 'fb', stripe_utm_medium: 'paid_social', stripe_utm_campaign: 'Brand-Sep',
    redeemed_promo_code: 'SAVE10', checkout_session_id: 'cs_live_1', payment_link_id: 'plink_1',
    stripe_utm_capture_method: 'Success URL',
  });
  assert.equal(out.status, 'updated_from_success_url');
});

test('never overwrites a value that is already on the record', async () => {
  const { patch } = await runAction({ session: SESSION, inputs: { stripe_utm_source: 'email', checkout_session_id: 'cs_live_1' } });
  assert.equal(patch.stripe_utm_source, undefined);
  assert.equal(patch.stripe_utm_medium, 'paid_social');
  assert.equal(patch.checkout_session_id, undefined);
});

test('a re-enrollment reuses the stored session id instead of a list query', async () => {
  const { calls } = await runAction({ session: SESSION, inputs: { checkout_session_id: 'cs_live_1' } });
  assert.ok(calls.some((c) => c.url.includes('/checkout/sessions/cs_live_1?')));
  assert.ok(!calls.some((c) => c.url.includes('checkout/sessions?payment_intent')));
});

test('falls back to a packed client_reference_id when the link carried no UTMs', async () => {
  const { patch, out } = await runAction({ session: { id: 'cs_2', success_url: 'https://www.example.com/ty', client_reference_id: 'src-partner-a__med-sms' } });
  assert.equal(patch.stripe_utm_source, 'partner-a');
  assert.equal(patch.stripe_utm_medium, 'sms');
  assert.equal(patch.stripe_utm_capture_method, 'Client Reference ID');
  assert.equal(out.status, 'updated_from_client_reference_id');
});

test('a promo code alone is not attribution: no capture method is claimed', async () => {
  const { patch, out } = await runAction({ session: { id: 'cs_3', discounts: [{ promotion_code: { code: 'SAVE10' } }] } });
  assert.equal(patch.redeemed_promo_code, 'SAVE10');
  assert.equal(patch.stripe_utm_capture_method, undefined);
  assert.equal(out.status, 'updated_promo_only');
});

test('a link without redirect confirmation records ids only', async () => {
  const { patch, out } = await runAction({ session: { id: 'cs_4', payment_link: 'plink_4' } });
  assert.deepEqual(patch, { checkout_session_id: 'cs_4', payment_link_id: 'plink_4' });
  assert.equal(out.status, 'ids_only_no_attribution');
});

test('invoice or subscription payments (no session) write nothing', async () => {
  const { patch, out } = await runAction({ sessions: [] });
  assert.equal(patch, undefined);
  assert.equal(out.status, 'no_session');
});

test('a test-mode Stripe key is refused instead of silently blanking every field', async () => {
  await assert.rejects(runAction({ session: SESSION, env: { STRIPE_READ_KEY: 'sk_test_x' } }), /not a live Stripe key/);
});

test('only the five Stripe-supported UTMs are read (no utm_id)', async () => {
  const { patch } = await runAction({ session: { ...SESSION, success_url: SESSION.success_url + '&utm_id=12345' } });
  assert.equal(Object.keys(patch).some((k) => k.includes('utm_id')), false);
});
