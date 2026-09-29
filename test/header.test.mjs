/**
 * header.test.mjs -- site-header/utm-capture.html
 * Author: Jibril Sulaiman · Created: 2026-09-28 · Run: npm test
 * Why: each write rule in the header comment is a way attribution silently breaks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { read, runBrowserScript, enc, dec } from './helpers.mjs';

const SRC = read('site-header/utm-capture.html');
const run = (opts) => runBrowserScript(SRC, opts);

test('a tagged landing page stores its campaign params on the shared domain', () => {
  const { jar } = run({ url: 'https://www.example.com/lp?utm_source=newsletter&utm_medium=email&utm_campaign=fall&gclid=G1&other=x' });
  const stash = dec(jar, 'site_attr');
  assert.equal(stash.utm_source, 'newsletter');
  assert.equal(stash.gclid, 'G1');
  assert.equal(stash.other, undefined, 'non-tracking params are ignored');
  assert.equal(stash._lp, 'https://www.example.com/lp');
  assert.match(jar.writes.find((w) => w.startsWith('site_attr=')), /;domain=\.example\.com;path=\/;max-age=7776000;samesite=lax;secure/);
});

test('browsing an untagged page never erases the stored campaign', () => {
  const cookies = { site_attr: enc({ utm_source: 'newsletter', gclid: 'G1' }) };
  const { jar } = run({ url: 'https://shop.example.com/order', cookies });
  assert.deepEqual(dec(jar, 'site_attr'), { utm_source: 'newsletter', gclid: 'G1' });
});

test('a new campaign REPLACES the stash; it never blends in the old click id', () => {
  const cookies = { site_attr: enc({ utm_source: 'old', gclid: 'G1' }) };
  const { jar } = run({ url: 'https://www.example.com/lp?utm_source=new&utm_medium=cpc', cookies });
  const stash = dec(jar, 'site_attr');
  assert.equal(stash.utm_source, 'new');
  assert.equal(stash.gclid, undefined);
});

test('the return trip from Stripe (a subset of the same UTMs) keeps the full stash', () => {
  const stored = { utm_source: 'fb', utm_medium: 'paid', utm_campaign: 'fall', fbclid: 'F1', gclid: 'G1' };
  const { jar } = run({ url: 'https://www.example.com/thank-you?utm_source=fb&utm_medium=paid&utm_campaign=fall', cookies: { site_attr: enc(stored) } });
  assert.deepEqual(dec(jar, 'site_attr'), stored);
});

test('the return trip keeps the stash even when Stripe hands back CLEANED values', () => {
  const stored = { utm_source: 'fb', utm_campaign: 'Brand | Sep 2026 | Prospecting', fbclid: 'F1', gclid: 'G1' };
  const { jar } = run({ url: 'https://www.example.com/thank-you?utm_source=fb&utm_campaign=Brand-Sep-2026-Prospecting', cookies: { site_attr: enc(stored) } });
  assert.deepEqual(dec(jar, 'site_attr'), stored);
});

test('utm_medium is inferred when a link has a source but no medium', () => {
  const byClick = dec(run({ url: 'https://www.example.com/?utm_source=partner-a&fbclid=F1' }).jar, 'site_attr');
  assert.equal(byClick.utm_medium, 'meta');
  assert.equal(byClick._inferred, 'utm_medium');
  const byRef = dec(run({ url: 'https://www.example.com/?utm_source=partner-a', referrer: 'https://l.instagram.com/' }).jar, 'site_attr');
  assert.equal(byRef.utm_medium, 'instagram');
  const nothing = dec(run({ url: 'https://www.example.com/?utm_source=partner-a' }).jar, 'site_attr');
  assert.equal(nothing.utm_medium, 'direct');
  const explicit = dec(run({ url: 'https://www.example.com/?utm_source=a&utm_medium=sms&fbclid=F' }).jar, 'site_attr');
  assert.equal(explicit.utm_medium, 'sms', 'an explicit medium always wins');
});

test('the entry cookie remembers an external platform for a later untagged hop', () => {
  const first = run({ url: 'https://go.example.com/partner', referrer: 'https://www.tiktok.com/@someone' });
  assert.equal(dec(first.jar, 'site_entry').p, 'tiktok');
  // One hop later the referrer is our own domain; the entry cookie supplies the platform.
  const cookies = { site_entry: first.jar.jar.get('site_entry') };
  const second = run({ url: 'https://www.example.com/lp?utm_source=partner-a', referrer: 'https://go.example.com/partner', cookies, clock: first.clock });
  assert.equal(dec(second.jar, 'site_attr').utm_medium, 'tiktok');
});

test('internal navigation is never recorded as an entry platform', () => {
  const { jar } = run({ url: 'https://www.example.com/b', referrer: 'https://shop.example.com/a' });
  assert.equal(jar.jar.has('site_entry'), false);
});
