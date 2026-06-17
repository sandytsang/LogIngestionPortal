import {
  ALLOWED_COLUMN_TYPES,
  type ColumnsDocument,
  type MultiTableColumnsDocument,
  type PortalConfig,
} from '../types';

const DIRECT_DCR_NAME_REGEX = /^[A-Za-z0-9](?:[A-Za-z0-9-]{1,28}[A-Za-z0-9])?$/;

/**
 * Matches the Direct DCR naming rule enforced by Azure:
 * 3-30 chars, letters/numbers/hyphens only, cannot start/end with hyphen.
 */
export function isValidDirectDcrName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 30) return false;
  return DIRECT_DCR_NAME_REGEX.test(trimmed);
}

/**
 * Portal config validation that mirrors deploy.ps1 checks for early UI feedback.
 */
export function validatePortalConfig(config: PortalConfig): string[] {
  const errors: string[] = [];
  const dcrName = config.dcrName?.trim() ?? '';

  // Keep "required" and "format" concerns separate: empty is handled by
  // the required-field warning in the config panel, while this catches invalid
  // non-empty values before deployment.
  if (dcrName && !isValidDirectDcrName(dcrName)) {
    errors.push(
      "DCR name is invalid for kind 'Direct': use 3-30 characters, letters/numbers/hyphens only, and do not start or end with '-'.",
    );
  }

  return errors;
}

/**
 * Validates a single table the same way LogIngestionAPI/scripts/deploy.ps1 does,
 * so the generated columns.json is guaranteed to pass a real deployment.
 */
export function validateTable(doc: ColumnsDocument): string[] {
  const errors: string[] = [];

  if (!doc.tableName) {
    errors.push('Table name is required.');
  } else if (!/_CL$/.test(doc.tableName)) {
    errors.push(`Custom table name must end with '_CL' (got '${doc.tableName}').`);
  }

  if (!doc.columns || doc.columns.length === 0) {
    errors.push(`Table '${doc.tableName || '(unnamed)'}' must have at least one column.`);
    return errors;
  }

  const seen = new Set<string>();
  for (const col of doc.columns) {
    if (!col.name) {
      errors.push(`Table '${doc.tableName}': every column must have a name.`);
      continue;
    }
    if (!ALLOWED_COLUMN_TYPES.includes(col.type)) {
      errors.push(
        `Table '${doc.tableName}', column '${col.name}' has unsupported type '${col.type}'. Allowed: ${ALLOWED_COLUMN_TYPES.join(', ')}.`,
      );
    }
    if (seen.has(col.name)) {
      errors.push(`Table '${doc.tableName}': duplicate column name '${col.name}'.`);
    }
    seen.add(col.name);
  }

  if (!seen.has('TimeGenerated')) {
    errors.push(`Table '${doc.tableName}' must include a 'TimeGenerated' (datetime) column.`);
  }

  // TimeGenerated and IntuneScriptVersion are added to every table automatically;
  // a table with only those carries no real data — require at least one more.
  const dataColumns = doc.columns.filter(
    (c) => c.name !== 'TimeGenerated' && c.name !== 'IntuneScriptVersion',
  );
  if (dataColumns.length === 0) {
    errors.push(
      `Table '${doc.tableName}' needs at least one column besides TimeGenerated and IntuneScriptVersion.`,
    );
  }

  return errors;
}

/**
 * Validates the whole multi-table document: each table individually, plus that
 * there is at least one table and that table names are unique.
 */
export function validateColumns(doc: MultiTableColumnsDocument): string[] {
  const errors: string[] = [];

  if (!doc.tables || doc.tables.length === 0) {
    errors.push('At least one table is required.');
    return errors;
  }

  const seenNames = new Set<string>();
  for (const table of doc.tables) {
    errors.push(...validateTable(table));
    const key = table.tableName?.toLowerCase();
    if (key) {
      if (seenNames.has(key)) {
        errors.push(`Duplicate table name '${table.tableName}'.`);
      }
      seenNames.add(key);
    }
  }

  return errors;
}
