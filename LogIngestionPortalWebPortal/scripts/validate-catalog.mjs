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

    if (field.expression) scanSecurity(`${where} expression`, field.expression);
    if (field.collector) scanSecurity(`${where} collector`, field.collector);
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
