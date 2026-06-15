import type { ColumnType, ColumnsDocument, CatalogColumn } from '../types';

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

/** Returns the first record from a sample that may be a single object or array. */
function firstRecord(parsed: unknown): Record<string, unknown> {
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!obj || typeof obj !== 'object') {
    throw new Error('Sample must be a JSON object, or an array of objects.');
  }
  return obj as Record<string, unknown>;
}

/**
 * Builds a columns.json document by inferring column names + types from a sample
 * data object (e.g. the output of `remediate.ps1 -PreviewData`). TimeGenerated is
 * always included (required by Log Analytics).
 */
export function columnsFromSample(
  sampleJson: string,
  tableName: string,
  description: string,
): ColumnsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(sampleJson);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  const record = firstRecord(parsed);

  const columns: CatalogColumn[] = [];
  const seen = new Set<string>();

  // TimeGenerated first (mandatory). Use the sample's value if present.
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

  return { tableName, description, columns };
}
