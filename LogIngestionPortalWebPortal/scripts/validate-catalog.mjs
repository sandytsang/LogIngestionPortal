#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Validates the contributed catalog data files before they can be merged.
//
//   node scripts/validate-catalog.mjs
//
// Checks performed:
//   1. JSON Schema (catalog/schema/category.schema.json) for every category file.
//   2. Cross-file rules mirroring LogIngestionAPI/scripts/deploy.ps1:
//        - unique field ids and column names
//        - a TimeGenerated (datetime) column exists
//        - referenced shared setups exist in catalog/setups.json
//   3. Security gate: collectors/expressions must be READ-ONLY. State-changing,
//      download, and code-execution cmdlets are rejected (collectors run as
//      SYSTEM on managed devices).
//
// This is an automated first pass. A human maintainer review is still required.
// ---------------------------------------------------------------------------
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv from 'ajv';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const catalogDir = join(root, 'catalog');
const categoriesDir = join(catalogDir, 'categories');

const errors = [];
const fail = (msg) => errors.push(msg);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

// --- Security gate ---------------------------------------------------------
// Collectors must only READ device state. The rejected patterns live in
// catalog/security-rules.json so the portal and this validator stay in sync.
const FORBIDDEN_PATTERNS = readJson(join(catalogDir, 'security-rules.json')).map((r) => ({
  re: new RegExp(r.pattern, 'i'),
  why: r.why,
}));

function scanSecurity(label, code) {
  for (const { re, why } of FORBIDDEN_PATTERNS) {
    if (re.test(code)) {
      fail(`Security: ${label} uses a forbidden pattern (${why}). Collectors must be read-only.`);
    }
  }
}

// --- Load schema + shared data --------------------------------------------
const ajv = new Ajv({ allErrors: true });
const schema = readJson(join(catalogDir, 'schema', 'category.schema.json'));
const validateCategory = ajv.compile(schema);

const setups = readJson(join(catalogDir, 'setups.json'));
const setupIds = new Set(Object.keys(setups));

// Map each shared setup's variable name (the leading `$x = …`) back to its id,
// so we can verify an expression that uses `$cs` actually lists the `cs` setup.
// Note: the variable name can differ from the id (e.g. 'disk' defines $sysDrive).
const setupVarToId = new Map();
for (const [id, code] of Object.entries(setups)) {
  const m = /\$(\w+)\s*=/.exec(code);
  if (m) setupVarToId.set(m[1], id);
}

const allowedTypes = ['string', 'int', 'long', 'real', 'boolean', 'datetime', 'dynamic', 'guid'];

// --- Walk category files ---------------------------------------------------
const files = readdirSync(categoriesDir).filter((f) => f.endsWith('.json'));
if (files.length === 0) fail('No category files found under catalog/categories.');

const seenIds = new Map();
const seenColumns = new Map();
let timeGenerated = null;
let fieldCount = 0;

for (const file of files) {
  const rel = `catalog/categories/${file}`;
  let data;
  try {
    data = readJson(join(categoriesDir, file));
  } catch (e) {
    fail(`${rel}: not valid JSON (${e.message}).`);
    continue;
  }

  if (!validateCategory(data)) {
    for (const err of validateCategory.errors ?? []) {
      fail(`${rel}${err.instancePath} ${err.message}.`);
    }
    continue;
  }

  for (const field of data.fields) {
    fieldCount++;
    const where = `${rel} field '${field.id}'`;

    if (seenIds.has(field.id)) {
      fail(`${where}: duplicate field id (also in ${seenIds.get(field.id)}).`);
    }
    seenIds.set(field.id, rel);

    const colName = field.column.name;
    if (seenColumns.has(colName)) {
      fail(`${where}: duplicate column name '${colName}' (also in ${seenColumns.get(colName)}).`);
    }
    seenColumns.set(colName, rel);

    if (!allowedTypes.includes(field.column.type)) {
      fail(`${where}: unsupported column type '${field.column.type}'.`);
    }

    if (colName === 'TimeGenerated') {
      timeGenerated = field;
      if (field.column.type !== 'datetime') {
        fail(`${where}: TimeGenerated must be of type 'datetime'.`);
      }
    }

    for (const s of field.setups ?? []) {
      if (!setupIds.has(s)) {
        fail(`${where}: references unknown shared setup '${s}' (add it to catalog/setups.json).`);
      }
    }

    // An expression that uses a shared variable (e.g. $cs) must list its setup,
    // otherwise the variable is undefined at runtime and the value is silently
    // null. This is the easy mistake when hand-copying an example field.
    if (field.expression) {
      const listed = new Set(field.setups ?? []);
      const used = new Set([...field.expression.matchAll(/\$(\w+)/g)].map((m) => m[1]));
      for (const v of used) {
        const id = setupVarToId.get(v);
        if (id && !listed.has(id)) {
          fail(`${where}: expression uses $${v} but does not list its shared setup in "setups". Add "${id}" to "setups": [...].`);
        }
      }
    }

    if (field.expression) scanSecurity(`${where} expression`, field.expression);
    if (field.collector) scanSecurity(`${where} collector`, field.collector);

    // Element columns (row-source fields): unique names within the field, valid
    // types, and read-only expressions like any other collector code.
    if (field.element) {
      const elemSeen = new Set();
      for (const el of field.element) {
        if (!allowedTypes.includes(el.column.type)) {
          fail(`${where}: element column '${el.column.name}' has unsupported type '${el.column.type}'.`);
        }
        if (elemSeen.has(el.column.name)) {
          fail(`${where}: duplicate element column name '${el.column.name}'.`);
        }
        elemSeen.add(el.column.name);
        scanSecurity(`${where} element '${el.column.name}'`, el.expression);
      }
    }
  }
}

if (!timeGenerated) {
  fail("No 'TimeGenerated' (datetime) column found. Exactly one category must declare it.");
}

// --- Report ----------------------------------------------------------------
if (errors.length > 0) {
  console.error(`\u2716 Catalog validation failed (${errors.length} issue(s)):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`\u2714 Catalog valid: ${fieldCount} fields across ${files.length} categories.`);
