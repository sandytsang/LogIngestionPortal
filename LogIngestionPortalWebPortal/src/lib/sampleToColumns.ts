import type {
  ColumnType,
  MultiTableColumnsDocument,
  ColumnsDocument,
  CatalogColumn,
} from '../types';

/** ISO-8601 date/time, e.g. 2026-06-16T12:34:56Z or with offset/fraction. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const INT32_MAX = 2147483647;

/** Infers a Log Analytics column type from a sample value. */
export function inferType(value: unknown): ColumnType {
  if (value === null || value === undefined) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return Math.abs(value) > INT32_MAX ? 'long' : 'int';
    return 'real';
  }
  if (typeof value === 'string') {
    if (ISO_DATE.test(value)) return 'datetime';
    if (GUID.test(value)) return 'guid';
    return 'string';
  }
  // arrays and objects map to a dynamic (JSON) column
  return 'dynamic';
}

/** Sorts columns alphabetically by name, keeping TimeGenerated pinned first. */
export function sortColumns(columns: CatalogColumn[]): CatalogColumn[] {
  return [...columns].sort((a, b) => {
    if (a.name === b.name) return 0;
    if (a.name === 'TimeGenerated') return -1;
    if (b.name === 'TimeGenerated') return 1;
    return a.name.localeCompare(b.name);
  });
}

/** Returns the first record from a sample that may be a single object or array. */
function firstRecord(parsed: unknown): Record<string, unknown> {
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!obj || typeof obj !== 'object') {
    throw new Error('Sample must be a JSON object, or an array of objects.');
  }
  return obj as Record<string, unknown>;
}

/**
 * True when the sample is a table-keyed object — exactly what
 * `IntuneScript.ps1 -PreviewData` now emits, e.g.
 *   { "Table1_CL": [ { ... } ], "Table2_CL": [ { ... } ] }
 * (a plain object whose every value is an array of records). A single record is
 * never misclassified because it always has at least one scalar (TimeGenerated).
 */
function isTableKeyed(parsed: unknown): parsed is Record<string, unknown[]> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const values = Object.values(parsed as Record<string, unknown>);
  return values.length > 0 && values.every((v) => Array.isArray(v));
}

/** Builds one table's columns from a sample record (TimeGenerated always first). */
function tableFromRecord(
  tableName: string,
  description: string,
  record: Record<string, unknown>,
): ColumnsDocument {
  const columns: CatalogColumn[] = [];
  const seen = new Set<string>();

  // TimeGenerated first (mandatory).
  columns.push({
    name: 'TimeGenerated',
    type: 'datetime',
    description: 'Event timestamp (UTC). Required by Log Analytics.',
  });
  seen.add('TimeGenerated');

  for (const [key, value] of Object.entries(record)) {
    if (seen.has(key)) continue;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(
        `Property "${key}" is not a valid column name (start with a letter; letters, numbers, _ only).`,
      );
    }
    seen.add(key);
    columns.push({
      name: key,
      type: inferType(value),
      description: `Imported from sample data (inferred type).`,
    });
  }

  return { tableName, description, columns: sortColumns(columns) };
}

/**
 * Builds a columns.json document by inferring column names + types from sample
 * data (e.g. the output of `IntuneScript.ps1 -PreviewData`). Accepts either a
 * table-keyed object (multiple tables) or a single object/array of objects (one
 * table, using the supplied name + description). TimeGenerated is always added.
 */
export function columnsFromSample(
  sampleJson: string,
  tableName: string,
  description: string,
): MultiTableColumnsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sampleJson);
  } catch {
    throw new Error('That is not valid JSON.');
  }

  if (isTableKeyed(parsed)) {
    const tables = Object.entries(parsed).map(([name, records]) => {
      if (!records.length) {
        throw new Error(`Table "${name}" has no sample records to infer columns from.`);
      }
      return tableFromRecord(name, description, firstRecord(records));
    });
    return { tables };
  }

  return { tables: [tableFromRecord(tableName, description, firstRecord(parsed))] };
}
