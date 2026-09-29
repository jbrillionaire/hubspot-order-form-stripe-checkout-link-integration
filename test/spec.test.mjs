/**
 * spec.test.mjs -- the action, the property scripts and the two browser scripts agree
 * Author: Jibril Sulaiman · Created: 2026-09-28 · Run: npm test
 * Why: these files are pasted into different places (a workflow, Design Manager,
 *      Site header HTML). Nothing but this test notices when they drift apart.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers.mjs';
import { ALL_WRITTEN, CAPTURE_METHOD } from '../scripts/property-spec.mjs';

const action = read('workflow-action/stripe-utm-action.js');

test('every property the action can write is in the property spec, and vice versa', () => {
  const constant = (name) => action.match(new RegExp(`const ${name} = '([^']+)'`))[1];
  const prefix = constant('UTM_PREFIX');
  const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].map((k) => prefix + k);
  const written = [...utm, constant('PROMO_PROPERTY'), constant('SESSION_PROPERTY'), constant('LINK_PROPERTY'), prefix + 'utm_capture_method'];
  assert.deepEqual([...written].sort(), [...ALL_WRITTEN].sort());
});

test('every capture method the action writes is a dropdown option in the spec', () => {
  const block = action.slice(action.indexOf('const CAPTURE_METHODS'), action.indexOf('};', action.indexOf('const CAPTURE_METHODS')));
  const values = [...block.matchAll(/: '([^']+)'/g)].map((m) => m[1]);
  for (const v of new Set(values)) assert.ok(CAPTURE_METHOD.options.includes(v), `"${v}" missing from the spec`);
});

test('the header script and the module use the same cookie name', () => {
  const header = read('site-header/utm-capture.html').match(/var COOKIE = '([^']+)'/)[1];
  const moduleName = read('module/order-form-stripe.module/module.js').match(/var COOKIE_NAME = '([^']+)'/)[1];
  assert.equal(header, moduleName);
});

test('fields.json declares every module field the HubL reads', () => {
  const fields = JSON.parse(read('module/order-form-stripe.module/fields.json')).map((f) => f.name);
  const hubl = read('module/order-form-stripe.module/module.html').replace(/\{#[\s\S]*?#\}/g, '');   // drop HubL comments
  const used = [...hubl.matchAll(/module\.([a-z_0-9]+)/g)].map((m) => m[1]);
  for (const name of new Set(used)) assert.ok(fields.includes(name), `${name} missing from fields.json`);
});
