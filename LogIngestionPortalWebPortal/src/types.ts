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
  /** Global ordering; also fixes the column order in the generated columns.json. */
  order: number;
  /** Pre-selected in the UI. The default set reproduces the original columns.json. */
  default: boolean;
  /** TimeGenerated is mandatory and cannot be deselected. */
  locked?: boolean;
  /** Shared setup snippet ids (emitted once) this field's value depends on. */
  setups: string[];
  /**
   * A PowerShell expression evaluated for this column's value (built-in fields).
   * Exactly one of `expression` or `collector` is set.
   */
  expression?: string;
  /**
   * A self-contained PowerShell collector body (community fields). It is wrapped
   * in Invoke-Safe and its result becomes this column's value. Exactly one of
   * `expression` or `collector` is set.
   */
  collector?: string;
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
  remediationName: string;
  tableName: string;
  tableDescription: string;
  action: 'deploy' | 'updateColumns';
  scenario: 'new' | 'existing';
  baseName: string;
  environment: 'dev' | 'test' | 'prod';
  functionResourceGroup: string;
  dcrResourceGroup: string;
  existingWorkspaceResourceGroup: string;
  location: string;
  functionPlanType: 'Consumption' | 'Flex';
}

/** Serialized columns.json structure. */
export interface ColumnsDocument {
  tableName: string;
  description: string;
  columns: CatalogColumn[];
}
