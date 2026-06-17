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
 * One per-item column for a field that returns an array (a "row source"). When a
 * table is built from this field, each array item becomes a row and each element
 * column is emitted from `expression`, evaluated with the item bound to `$item`.
 */
export interface CatalogElementColumn {
  /** PowerShell expression for this column, evaluated per item (item = $item). */
  expression: string;
  column: CatalogColumn;
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
  /**
   * Optional per-item schema for an array-returning collector. Its presence marks
   * the field as usable as a table "row source" (one row per array item). The
   * field can still be selected as a single `dynamic` column in normal tables.
   */
  element?: CatalogElementColumn[];
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
  scriptVersion: string;
  action: 'deploy' | 'updateColumns';
  /** Resource group for the Function App and (by default) the workspace + DCR. */
  resourceGroup: string;
  /** Exact Function App name (no hash). Globally unique; upserted if it exists. */
  functionAppName: string;
  /** Resource group of the Data Collection Rule. Empty = same as resourceGroup. */
  dcrResourceGroup: string;
  /** Exact DCR name to create/update. */
  dcrName: string;
  /** Resource group of the Log Analytics workspace. Empty = same as resourceGroup. */
  workspaceResourceGroup: string;
  /** Region for the Function App (and its storage/App Insights/plan). */
  location: string;
  /** Region for the Log Analytics workspace. Empty = same as the Function App
   *  region. The Data Collection Rule always follows the workspace region. */
  workspaceLocation: string;
  functionPlanType: 'Consumption' | 'Flex';
}

/**
 * One custom table ("box") the user is building. A field may be assigned to
 * several tables (many-to-many); the locked TimeGenerated column is implicitly
 * part of every table and is never stored here.
 */
export interface TableConfig {
  /** Stable internal id (independent of the editable table name). */
  id: string;
  /** Custom table name, must end in _CL, e.g. "DeviceInventory_CL". */
  name: string;
  description: string;
  /** Ids of the non-locked catalog fields assigned to this table. */
  fieldIds: string[];
}

/** One table's serialized schema (a single entry in columns.json's tables[]). */
export interface ColumnsDocument {
  tableName: string;
  description: string;
  columns: CatalogColumn[];
}

/**
 * Serialized columns.json structure. Supports multiple custom tables in one DCR;
 * a single-table deployment is just `tables` with one entry.
 */
export interface MultiTableColumnsDocument {
  tables: ColumnsDocument[];
}
