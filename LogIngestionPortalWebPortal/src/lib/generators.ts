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
  // Collect the shared setup snippets actually needed, de-duplicated. Emit those
  // listed in setupOrder first (stable order), then any others a contributed
  // field references (so new shared setups still work without editing meta.json).
  const needed = new Set<string>();
  for (const f of fields) {
    for (const s of f.setups) needed.add(s);
  }
  const orderedSetupIds = [
    ...catalog.setupOrder.filter((id) => needed.has(id)),
    ...[...needed].filter((id) => !catalog.setupOrder.includes(id)).sort(),
  ];
  const sharedBlock = orderedSetupIds
    .map((id) => catalog.setups[id])
    .filter(Boolean)
    .join('\n');

  // Self-contained community collectors are wrapped in Invoke-Safe so a failure
  // never breaks the whole upload; the result is captured in $__<id>.
  const collectorBlock = fields
    .filter((f) => f.collector)
    .map((f) => wrapCollector(f))
    .join('\n');

  const setupSection = [sharedBlock, collectorBlock].filter(Boolean).join('\n');

  // Align the '=' for readability.
  const pad = Math.max(...fields.map((f) => f.column.name.length));
  const objectLines = fields
    .map((f) => {
      const value = f.expression ?? `$__${f.id}`;
      return `        ${f.column.name.padEnd(pad)} = ${value}`;
    })
    .join('\n');

  const body =
    (setupSection ? setupSection + '\n\n' : '') +
    '    [pscustomobject]@{\n' +
    objectLines +
    '\n    }';

  return scriptTemplate
    .replace('__FUNCTION_URL__', config.functionUrl)
    .replace('__USE_JWT__', config.useJwt ? '$true' : '$false')
    .replace('__REMEDIATION_NAME__', escapePsSingleQuote(config.remediationName))
    .replace('__GET_DEVICE_DATA_BODY__', body);
}

/** Wraps a self-contained collector body in Invoke-Safe, indented for the script. */
function wrapCollector(field: CatalogField): string {
  const inner = (field.collector ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `        ${line}` : ''))
    .join('\n');
  return `    $__${field.id} = Invoke-Safe '${escapePsSingleQuote(field.label)}' {\n${inner}\n    }`;
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
