#!/usr/bin/env node
/**
 * create-properties.mjs -- create the UTM properties on your payment-record object
 * ------------------------------------------------------------------------------
 * Author:  Jibril Sulaiman
 * Created: 2026-09-28 (from a production script first run 2026-09-03)
 * Deploy:  Run locally, once (PowerShell shown):
 *            $env:HUBSPOT_TOKEN = "pat-..."; $env:OBJECT_TYPE = "2-12345678"; $env:PROPERTY_GROUP = "your_group"
 *            node scripts/create-properties.mjs --dry-run
 *            node scripts/create-properties.mjs
 *            node scripts/create-properties.mjs --prune   (also remove dropdown options not in the spec)
 * What:    Creates every property in property-spec.mjs. Idempotent: existing
 *          properties are skipped, but an existing dropdown is reconciled
 *          (missing options added), because a hand-made option set that lacks
 *          one value fails every write.
 * Why the attribution lives on the payment record and not only the contact:
 *          the record IS the revenue. Reporting on a contact's UTMs needs a join,
 *          and contact UTMs get overwritten by every later form submission.
 * Token scopes: crm.schemas.custom.read + crm.schemas.custom.write (custom object).
 */
import { TEXT_PROPERTIES, CAPTURE_METHOD } from './property-spec.mjs';

const TOKEN = process.env.HUBSPOT_TOKEN;
const OBJECT_TYPE = process.env.OBJECT_TYPE;
const GROUP = process.env.PROPERTY_GROUP;
const DRY_RUN = process.argv.includes('--dry-run');
const PRUNE = process.argv.includes('--prune');   // removing an option doesn't clear stored values, so opt-in

for (const [k, v] of Object.entries({ HUBSPOT_TOKEN: TOKEN, OBJECT_TYPE, PROPERTY_GROUP: GROUP })) {
  if (!v) { console.error(`Missing ${k} in the environment.`); process.exit(1); }
}

const PROPERTIES = [
  ...TEXT_PROPERTIES.map((p, i) => ({ ...p, groupName: GROUP, type: 'string', fieldType: 'text', displayOrder: i })),
  {
    name: CAPTURE_METHOD.name, label: CAPTURE_METHOD.label, description: CAPTURE_METHOD.description,
    groupName: GROUP, type: 'enumeration', fieldType: 'select', displayOrder: TEXT_PROPERTIES.length,
    // label === value on purpose: the action writes the VALUE, and the UI only shows labels.
    options: CAPTURE_METHOD.options.map((o, i) => ({ label: o, value: o, displayOrder: i })),
  },
];

async function hubspot(method, path, body) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, raw: await res.text() };
}

// Fail once, loudly, on a bad token or object id, instead of once per property.
const probe = await hubspot('GET', `/crm/v3/schemas/${OBJECT_TYPE}`);
if (!probe.ok) {
  console.error(`Cannot read object ${OBJECT_TYPE} -> ${probe.status} ${probe.raw}`);
  process.exit(1);
}
const schema = JSON.parse(probe.raw);
console.log(`Object ${OBJECT_TYPE} = ${schema.name} ("${schema.labels?.singular}")\n`);

if (DRY_RUN) {
  for (const p of PROPERTIES) console.log(`would create  ${p.name.padEnd(28)} ${p.type}/${p.fieldType}`);
  process.exit(0);
}

async function reconcileOptions(property) {
  const current = await hubspot('GET', `/crm/v3/properties/${OBJECT_TYPE}/${property.name}`);
  if (!current.ok) { console.error(`  cannot read options -> ${current.status}`); return false; }
  const existing = JSON.parse(current.raw).options ?? [];
  const have = new Set(existing.map((o) => o.value));
  const want = new Set(property.options.map((o) => o.value));
  const missing = property.options.filter((o) => !have.has(o.value));
  const extra = existing.filter((o) => !want.has(o.value));
  if (!missing.length && (!extra.length || !PRUNE)) {
    if (extra.length) console.log(`  unused options left in place: ${extra.map((o) => o.value).join(', ')} (--prune removes them)`);
    return true;
  }
  const kept = PRUNE ? [] : extra.map((o, i) => ({ ...o, displayOrder: property.options.length + i }));
  const patch = await hubspot('PATCH', `/crm/v3/properties/${OBJECT_TYPE}/${property.name}`, { options: [...property.options, ...kept] });
  if (!patch.ok) { console.error(`  FAILED to update options -> ${patch.status} ${patch.raw}`); return false; }
  if (missing.length) console.log(`  added options: ${missing.map((o) => o.value).join(', ')}`);
  if (PRUNE && extra.length) console.log(`  removed options: ${extra.map((o) => o.value).join(', ')}`);
  return true;
}

for (const property of PROPERTIES) {
  const res = await hubspot('POST', `/crm/v3/properties/${OBJECT_TYPE}`, property);
  if (res.ok) console.log(`created  ${property.name}`);
  else if (res.status === 409) {
    console.log(`exists   ${property.name}`);
    if (property.options && !(await reconcileOptions(property))) process.exitCode = 1;
  } else {
    console.error(`FAILED   ${property.name} -> ${res.status} ${res.raw}`);
    process.exitCode = 1;
  }
}
