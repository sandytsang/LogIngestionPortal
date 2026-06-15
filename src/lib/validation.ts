import { ALLOWED_COLUMN_TYPES, type ColumnsDocument } from '../types';

/**
 * Mirrors the validation performed by LogIngestionAPI/scripts/deploy.ps1 so the
 * generated columns.json is guaranteed to pass a real deployment.
 */
export function validateColumns(doc: ColumnsDocument): string[] {
  const errors: string[] = [];

  if (!doc.tableName) {
    errors.push('Table name is required.');
  } else if (!/_CL$/.test(doc.tableName)) {
    errors.push(`Custom table name must end with '_CL' (got '${doc.tableName}').`);
  }

  if (!doc.columns || doc.columns.length === 0) {
    errors.push('At least one column must be selected.');
    return errors;
  }

  const seen = new Set<string>();
  for (const col of doc.columns) {
    if (!col.name) {
      errors.push('Every column must have a name.');
      continue;
    }
    if (!ALLOWED_COLUMN_TYPES.includes(col.type)) {
      errors.push(
        `Column '${col.name}' has unsupported type '${col.type}'. Allowed: ${ALLOWED_COLUMN_TYPES.join(', ')}.`,
      );
    }
    if (seen.has(col.name)) {
      errors.push(`Duplicate column name '${col.name}'.`);
    }
    seen.add(col.name);
  }

  if (!seen.has('TimeGenerated')) {
    errors.push("columns.json must include a 'TimeGenerated' (datetime) column.");
  }

  return errors;
}
