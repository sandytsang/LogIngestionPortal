export type ColumnType =
  | 'string'
  | 'int'
  | 'long'
  | 'real'
  | 'boolean'
  | 'datetime'
  | 'dynamic'
  | 'guid';

export const ALLOWED_COLUMN_TYPES: ColumnType[] = [
  'string',
  'int',
  'long',
  'real',
  'boolean',
  'datetime',
  'dynamic',
  'guid',
];

/** A Log Analytics / DCR column definition (matches schema/columns.json shape). */
export interface CatalogColumn {
  name: string;
  type: ColumnType;
  description: string;
}

/**
 * A single selectable data point. Each entry bundles BOTH the column definition
 * and the PowerShell collector that produces its value, so adding a data point
 * never requires editing two files.
 */
export interface CatalogField {
  id: string;
  category: string;
  label: string;
  /** Pre-selected in the UI. The default set reproduces the original columns.json. */
  default: boolean;
  /** TimeGenerated is mandatory and cannot be deselected. */
  locked?: boolean;
  /** Collector needs SYSTEM/admin context (surfaced as a badge in the UI). */
  needsSystem?: boolean;
  /** Shared setup snippet ids (emitted once) this collector depends on. */
  setups: string[];
  /** PowerShell expression evaluated for this column's value. */
  expression: string;
  column: CatalogColumn;
}

export interface Catalog {
  tableName: string;
  description: string;
  /** id -> PowerShell setup snippet (emitted at most once per script). */
  setups: Record<string, string>;
  /** Stable emission order for setups. */
  setupOrder: string[];
  fields: CatalogField[];
}

export interface PortalConfig {
  functionUrl: string;
  useJwt: boolean;
  remediationName: string;
  tableName: string;
  tableDescription: string;
}

/** Serialized columns.json structure. */
export interface ColumnsDocument {
  tableName: string;
  description: string;
  columns: CatalogColumn[];
}
