/**
 * module.test.mjs -- module/order-form-stripe.module/module.js
 * Author: Jibril Sulaiman · Created: 2026-09-28 · Run: npm test
 * Why: the module's output is a URL nobody reads until attribution is missing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, runBrowserScript, orderDom, enc, timers } from './helpers.mjs';

const SRC = read('module/order-form-stripe.module/module.js');
const LINK = 'https://buy.stripe.com/test_abc123';
const ATTRS = { 'data-stripe-url': LINK, 'data-prefill': 'true', 'data-new-tab': 'false', 'data-button-label': 'Complete Your Order' };

function submitAndGo({ url = 'https://shop.example.com/order', cookies = {}, attrs = ATTRS, dom } = {}) {
  dom = dom || orderDom(attrs);
  const clock = timers();
  const page = runBrowserScript(SRC, { url, cookies, dom, clock });
  clock.advance(10);
  dom.panel.fields = false;   // HubSpot removes the fields once the inline submit succeeds
  clock.advance(1000);
  const href = page.window.location.href;
  return { dom, page, href, params: href.startsWith(LINK) ? new URL(href).searchParams : null };
}

test('after submit it goes to the Stripe link with UTMs, click ids, fbc/fbp and the email', () => {
  const stored = {
    utm_source: 'fb', utm_medium: 'paid_social', utm_campaign: 'Brand | Sep 2026 | Prospecting',
    gclid: 'Cj0K_abc-123', fbclid: 'IwAR0xyz', _t: '2026-09-28T14:00:00.000Z',
    _ref: 'https://l.facebook.com/', _lp: 'https://www.example.com/lp', _inferred: 'utm_medium',
  };
  const { params, dom } = submitAndGo({ cookies: { site_attr: enc(stored), _fbp: 'fb.1.1788000000000.12345' } });
  assert.ok(params, 'navigated to the Stripe link');
  assert.equal(params.get('utm_campaign'), 'Brand-Sep-2026-Prospecting', 'flattened to Stripe-safe characters');
  assert.equal(params.get('utm_source'), 'fb');
  assert.equal(params.get('gclid'), 'Cj0K_abc-123', 'click ids pass unaltered');
  assert.equal(params.get('fbc'), `fb.1.${Date.parse(stored._t)}.IwAR0xyz`);
  assert.equal(params.get('fbp'), 'fb.1.1788000000000.12345');
  assert.equal(params.get('prefilled_email'), 'buyer@example.com');
  for (const k of ['fbclid', '_t', '_ref', '_lp', '_inferred']) assert.equal(params.get(k), null, `${k} is never sent to Stripe`);
  assert.ok(dom.classes.has('eof--step2'));
});

test("the Meta pixel's own _fbc cookie is preferred over a rebuilt one", () => {
  const { params } = submitAndGo({ cookies: { site_attr: enc({ fbclid: 'IwAR0xyz' }), _fbc: 'fb.1.1700000000000.IwAR0xyz' } });
  assert.equal(params.get('fbc'), 'fb.1.1700000000000.IwAR0xyz');
});

test('UTM values follow Stripe: max 150 characters, dropped if nothing valid is left', () => {
  const { params } = submitAndGo({ cookies: { site_attr: enc({ utm_content: 'x'.repeat(200), utm_term: '|||' }) } });
  assert.equal(params.get('utm_content').length, 150);
  assert.equal(params.get('utm_term'), null);
});

test("tracking params on the order page's own URL beat an older stash; the two never blend", () => {
  const { params } = submitAndGo({
    url: 'https://shop.example.com/order?utm_source=sms&utm_medium=text',
    cookies: { site_attr: enc({ utm_source: 'fb', gclid: 'G1' }) },
  });
  assert.equal(params.get('utm_source'), 'sms');
  assert.equal(params.get('gclid'), null);
});

test('an order URL that only repeats stored values keeps the full stash, click ids included', () => {
  const { params } = submitAndGo({
    url: 'https://shop.example.com/order?utm_source=fb',
    cookies: { site_attr: enc({ utm_source: 'fb', utm_campaign: 'fall', gclid: 'G1' }) },
  });
  assert.equal(params.get('gclid'), 'G1');
  assert.equal(params.get('utm_campaign'), 'fall');
});

test('no email is sent when prefill is off', () => {
  const { params } = submitAndGo({ attrs: { ...ATTRS, 'data-prefill': 'false' } });
  assert.equal(params.get('prefilled_email'), null);
});

test('with no Stripe link (e.g. test mode without a test link) it never navigates', () => {
  const { href } = submitAndGo({ attrs: { ...ATTRS, 'data-stripe-url': '' } });
  assert.equal(href, 'https://shop.example.com/order');
});

test('opened on an already-submitted form, it shows the pay button instead of hanging', () => {
  const dom = orderDom(ATTRS, { fieldsPresent: false });
  const clock = timers();
  runBrowserScript(SRC, { url: 'https://shop.example.com/order', cookies: { site_attr: enc({ utm_source: 'fb' }) }, dom, clock });
  clock.advance(3000);
  assert.equal(dom.payBtn.hidden, false);
  assert.ok(dom.payBtn.href.startsWith(LINK) && dom.payBtn.href.includes('utm_source=fb'));
  assert.equal(dom.notice.hidden, true);
});

test('the submit button shows the configured label', () => {
  const dom = orderDom(ATTRS);
  const clock = timers();
  runBrowserScript(SRC, { url: 'https://shop.example.com/order', dom, clock });
  clock.advance(400);
  assert.equal(dom.submit.value, 'Complete Your Order');
});
