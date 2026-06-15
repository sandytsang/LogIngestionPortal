import type { Catalog, CatalogField, ColumnsDocument, PortalConfig } from '../types';
import scriptTemplate from './scriptTemplate.ps1?raw';

/** Returns the catalog fields that are selected, preserving catalog order. */
export function selectedFields(catalog: Catalog, selectedIds: Set<string>): CatalogField[] {
  return catalog.fields.filter((f) => f.locked || selectedIds.has(f.id));
}

/** Builds the columns.json document from the selected fields. */
export function generateColumns(fields: CatalogField[], config: PortalConfig): ColumnsDocument {
  return {
    tableName: config.tableName,
    description: config.tableDescription,
    columns: fields.map((f) => ({ ...f.column })),
  };
}

/** Pretty-prints the columns document the same way the repo stores it (2-space indent). */
export function columnsToJson(doc: ColumnsDocument): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * Generates the Intune detection script: emits each required setup snippet once
 * (in catalog order) followed by the [pscustomobject] payload mapping every
 * selected column name to its collector expression.
 */
export function generateScript(
  catalog: Catalog,
  fields: CatalogField[],
  config: PortalConfig,
): string {
  // Collect the setup snippets actually needed, de-duplicated, in catalog order.
  const needed = new Set<string>();
  for (const f of fields) {
    for (const s of f.setups) needed.add(s);
  }
  const setupBlock = catalog.setupOrder
    .filter((id) => needed.has(id))
    .map((id) => catalog.setups[id])
    .join('\n');

  // Align the '=' for readability.
  const pad = Math.max(...fields.map((f) => f.column.name.length));
  const objectLines = fields
    .map((f) => `        ${f.column.name.padEnd(pad)} = ${f.expression}`)
    .join('\n');

  const body =
    (setupBlock ? setupBlock + '\n\n' : '') +
    '    [pscustomobject]@{\n' +
    objectLines +
    '\n    }';

  return scriptTemplate
    .replace('__FUNCTION_URL__', config.functionUrl)
    .replace('__USE_JWT__', config.useJwt ? '$true' : '$false')
    .replace('__REMEDIATION_NAME__', escapePsSingleQuote(config.remediationName))
    .replace('__GET_DEVICE_DATA_BODY__', body);
}

/** Builds the deploy.ps1 command that updates the workspace, table and DCR. */
export function generateDeployCommand(workspaceName?: string): string {
  const lines = [
    '# Run from the LogIngestionAPI repo after replacing schema/columns.json',
    '# with the generated file. Requires Azure CLI (az) + Functions Core Tools (func)',
    '# signed in to your own tenant. Nothing runs outside your session.',
    './scripts/deploy.ps1 `',
    '  -ResourceGroup <your-resource-group> `',
    '  -Location <your-region>' + (workspaceName ? ' `' : ''),
  ];
  if (workspaceName) {
    lines.push(`  -ExistingWorkspaceName ${workspaceName}`);
  }
  return lines.join('\n') + '\n';
}

function escapePsSingleQuote(value: string): string {
  // In a single-quoted PowerShell string a literal single quote is doubled.
  return value.replace(/'/g, "''");
}
