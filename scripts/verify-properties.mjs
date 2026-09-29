#!/usr/bin/env node
/**
 * verify-properties.mjs -- check the live schema matches what the action writes
 * ---------------------------------------------------------------------------
 * Author:  Jibril Sulaiman
 * Created: 2026-09-28 (from a production script first run 2026-09-03)
 * Deploy:  Run locally before building the workflow, and after any hand edit:
 *            $env:HUBSPOT_TOKEN = "pat-..."; $env:OBJECT_TYPE = "2-12345678"
 *            $env:PI_PROPERTY = "stripe_payment_intent_id"   (optional)
 *            node scripts/verify-properties.mjs
 * What:    Confirms every internal name and every dropdown VALUE exists.
 * Why:     HubSpot derives internal names from labels ("Checkout Session ID "
 *          becomes checkout_session_id_), and the UI only ever shows labels,
 *          so a property can look right and still reject every write.
 * Token scopes: crm.schemas.custom.read.
 */
import { TEXT_PROPERTIES, CAPTURE_METHOD, ALL_WRITTEN } from './property-spec.mjs';

const TOKEN = process.env.HUBSPOT_TOKEN;
const OBJECT_TYPE = process.env.OBJECT_TYPE;
const PI_PROPERTY = process.env.PI_PROPERTY || 'stripe_payment_intent_id';
if (!TOKEN || !OBJECT_TYPE) { console.error('Set HUBSPOT_TOKEN and OBJECT_TYPE.'); process.exit(1); }

const res = await fetch(`https://api.hubapi.com/crm/v3/properties/${OBJECT_TYPE}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
if (!res.ok) { console.error(`Cannot read properties -> ${res.status} ${await res.text()}`); process.exit(1); }
const all = (await res.json()).results ?? [];
const byName = new Map(all.map((p) => [p.name, p]));

let failed = false;
const report = (ok, name, detail) => {
  if (!ok) failed = true;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name.padEnd(30)} ${detail}`);
};

console.log(`Object ${OBJECT_TYPE}: ${all.length} properties\n`);
report(byName.has(PI_PROPERTY), PI_PROPERTY,
  byName.has(PI_PROPERTY) ? 'input (read only)' : 'MISSING: set PI_PROPERTY to the property holding pi_... ids');
for (const { name } of TEXT_PROPERTIES) {
  const p = byName.get(name);
  report(!!p, name, p ? `${p.type}/${p.fieldType}` : 'MISSING');
}
const e = byName.get(CAPTURE_METHOD.name);
if (!e) report(false, CAPTURE_METHOD.name, 'MISSING');
else {
  report(e.type === 'enumeration', CAPTURE_METHOD.name, `${e.type}/${e.fieldType}`);
  const values = new Set((e.options ?? []).map((o) => o.value));
  for (const v of CAPTURE_METHOD.options) report(values.has(v), `  option "${v}"`, values.has(v) ? 'present' : 'NOT A VALID VALUE');
  for (const o of e.options ?? []) {
    if (o.label !== o.value) console.log(`  note: option "${o.label}" has internal value "${o.value}"; the action writes the value`);
  }
}
const expected = new Set([PI_PROPERTY, ...ALL_WRITTEN]);
const suspects = all.filter((p) => !expected.has(p.name) && /utm|checkout|payment_link|promo|session/i.test(p.name));
if (suspects.length) {
  console.log('\nSimilar names (possible typos or duplicates):');
  for (const p of suspects) console.log(`  ${p.name.padEnd(34)} "${p.label}"`);
}
console.log(failed ? '\nFAILED: fix the names above before building the workflow.' : '\nAll good.');
process.exit(failed ? 1 : 0);
