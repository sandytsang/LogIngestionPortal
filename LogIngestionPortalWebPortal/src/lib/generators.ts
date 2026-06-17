import type {
  Catalog,
  CatalogField,
  MultiTableColumnsDocument,
  PortalConfig,
  TableConfig,
} from '../types';
import scriptTemplate from './scriptTemplate.ps1?raw';
import { sortColumns } from './sampleToColumns';

/** Returns the catalog fields that are selected, preserving catalog order. */
export function selectedFields(catalog: Catalog, selectedIds: Set<string>): CatalogField[] {
  return catalog.fields.filter((f) => f.locked || selectedIds.has(f.id));
}

/**
 * The catalog fields that belong to a single table: every locked field (e.g.
 * TimeGenerated, implicitly in every table) plus the fields assigned to it,
 * returned in catalog order so the column order is stable.
 */
export function tableFields(catalog: Catalog, table: TableConfig): CatalogField[] {
  const ids = new Set(table.fieldIds);
  return catalog.fields.filter((f) => f.locked || ids.has(f.id));
}

/**
 * The array field a table expands into rows, or undefined for a normal table.
 * Derived automatically: a table becomes "one row per item" as soon as a field
 * that carries a per-item (`element`) schema is assigned to it. The first such
 * field by catalog order wins (assigning more than one is flagged in the UI).
 */
export function rowSourceField(catalog: Catalog, table: TableConfig): CatalogField | undefined {
  const ids = new Set(table.fieldIds);
  return catalog.fields.find((f) => f.element && f.element.length > 0 && ids.has(f.id));
}

/** Builds the multi-table columns.json document from the configured tables. */
export function generateColumns(
  catalog: Catalog,
  tables: TableConfig[],
): MultiTableColumnsDocument {
  return {
    tables: tables.map((t) => {
      const src = rowSourceField(catalog, t);
      if (src) {
        // Row-source table: device-level columns (minus the array field itself)
        // followed by the field's per-item element columns.
        const deviceCols = tableFields(catalog, t)
          .filter((f) => f.id !== src.id)
          .map((f) => ({ ...f.column }));
        const elementCols = (src.element ?? []).map((e) => ({ ...e.column }));
        return {
          tableName: t.name,
          description: t.description,
          columns: sortColumns([...deviceCols, ...elementCols]),
        };
      }
      return {
        tableName: t.name,
        description: t.description,
        columns: sortColumns(tableFields(catalog, t).map((f) => ({ ...f.column }))),
      };
    }),
  };
}

/** Pretty-prints the columns document the same way the repo stores it (2-space indent). */
export function columnsToJson(doc: MultiTableColumnsDocument): string {
  return JSON.stringify(doc, null, 2) + '\n';
}

/**
 * Generates the Intune detection script. Each selected field's value is computed
 * ONCE into a `$<id>` variable (built-in expressions and community collectors
 * alike), then Get-DeviceData returns a table-keyed object
 *   [ordered]@{ 'Table1_CL' = @( [pscustomobject]@{...} ); 'Table2_CL' = @( ... ) }
 * so a field assigned to several tables is never collected twice and the payload
 * routes each record to the right table.
 */
export function generateScript(
  catalog: Catalog,
  tables: TableConfig[],
  config: PortalConfig,
): string {
  // The union of fields needed across every table (locked fields are always in).
  const assigned = new Set<string>();
  for (const t of tables) for (const id of t.fieldIds) assigned.add(id);
  const usedFields = catalog.fields.filter((f) => f.locked || assigned.has(f.id));

  // Collect the shared setup snippets actually needed, de-duplicated. Emit those
  // listed in setupOrder first (stable order), then any others a contributed
  // field references (so new shared setups still work without editing meta.json).
  const needed = new Set<string>();
  for (const f of usedFields) {
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
  // never breaks the whole upload; the result is captured in $<id>.
  const collectorBlock = usedFields
    .filter((f) => f.collector)
    .map((f) => wrapCollector(f))
    .join('\n');

  // Built-in fields: compute each expression once into $<id> (reused by every
  // table the field is assigned to).
  const exprBlock = usedFields
    .filter((f) => f.expression)
    .map((f) => `    $${f.id} = ${f.expression}`)
    .join('\n');

  const setupSection = [sharedBlock, collectorBlock, exprBlock].filter(Boolean).join('\n\n');

  // The table-keyed payload. Each table gets TimeGenerated + its assigned columns,
  // every property value referencing the pre-computed $<id> variable. A row-source
  // table instead expands its array field into one record per item.
  const tableBlocks = tables
    .map((t) => {
      const src = rowSourceField(catalog, t);
      if (src) return rowSourceTableBlock(catalog, t, src);
      const fields = tableFields(catalog, t);
      const pad = Math.max(0, ...fields.map((f) => f.column.name.length));
      const lines = fields
        .map((f) => `                ${f.column.name.padEnd(pad)} = $${f.id}`)
        .join('\n');
      return (
        `        '${escapePsSingleQuote(t.name)}' = @(\n` +
        `            [pscustomobject]@{\n${lines}\n            }\n` +
        `        )`
      );
    })
    .join('\n');

  const body =
    (setupSection ? setupSection + '\n\n' : '') +
    '    [ordered]@{\n' +
    tableBlocks +
    '\n    }';

  // Use replacer FUNCTIONS so `$` sequences in the injected values (e.g. a regex
  // ending in `(.*)$'` inside a collector) are inserted literally. A string
  // replacement would treat `$'`, `$&`, `$1`, `$$` etc. as special patterns and
  // corrupt the output.
  return scriptTemplate
    .replace('__FUNCTION_URL__', () => config.functionUrl)
    .replace('__USE_JWT__', () => '$true')
    .replace('__SCRIPT_VERSION__', () => escapePsSingleQuote(config.scriptVersion))
    .replace('__GET_DEVICE_DATA_BODY__', () => body);
}

/**
 * Emits a row-source table block: a foreach over the field's pre-computed array
 * ($<id>) producing one [pscustomobject] per item. Device-level fields reference
 * their $<id> variable; element columns reference the loop item via $item.
 */
function rowSourceTableBlock(catalog: Catalog, table: TableConfig, src: CatalogField): string {
  const deviceFields = tableFields(catalog, table).filter((f) => f.id !== src.id);
  const entries = [
    ...deviceFields.map((f) => ({ name: f.column.name, value: `$${f.id}` })),
    ...(src.element ?? []).map((e) => ({ name: e.column.name, value: e.expression })),
  ];
  const pad = Math.max(0, ...entries.map((e) => e.name.length));
  const lines = entries
    .map((e) => `                    ${e.name.padEnd(pad)} = ${e.value}`)
    .join('\n');
  return (
    `        '${escapePsSingleQuote(table.name)}' = @(\n` +
    `            foreach ($item in @($${src.id})) {\n` +
    `                [pscustomobject]@{\n${lines}\n                }\n` +
    `            }\n` +
    `        )`
  );
}

/** Wraps a self-contained collector body in Invoke-Safe, indented for the script. */
function wrapCollector(field: CatalogField): string {
  const inner = (field.collector ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split('\n')
    .map((line) => (line.trim() ? `        ${line}` : ''))
    .join('\n');
  return `    $${field.id} = Invoke-Safe '${escapePsSingleQuote(field.label)}' {\n${inner}\n    }`;
}

/**
 * Builds the README.txt with ONE ready-to-run deploy command tailored to the
 * chosen scenario. Pass workspaceName only for the "existing workspace" path.
 */
export function generateDeployReadme(
  config: PortalConfig,
  tables: TableConfig[],
  workspaceName?: string,
): string {
  const tableList =
    tables.length === 0
      ? '<table>'
      : tables.map((t) => `"${t.name}"`).join(', ');
  const tableWord = tables.length > 1 ? 'tables' : 'table';
  const rg = config.resourceGroup?.trim() || 'rg-logingestion';
  const loc = config.location?.trim() || 'eastus';
  const funcName = config.functionAppName?.trim() || '<function-app-name>';
  const wsName = workspaceName?.trim() || '<workspace-name>';
  const dcrName = config.dcrName?.trim() || '<dcr-name>';
  const dcrRg = config.dcrResourceGroup?.trim();
  const wsRg = config.workspaceResourceGroup?.trim();
  const wsLoc = config.workspaceLocation?.trim();
  const isFlex = config.functionPlanType === 'Flex';

  // --- Update-columns (schema-only) — a single -SchemaOnly command. ---------
  if (config.action === 'updateColumns') {
    const updFlags = [
      '-Subscription <subscription-name-or-id>',
      '-SchemaOnly',
      `-WorkspaceName ${wsName}`,
      `-WorkspaceResourceGroup ${wsRg || '<workspace-resource-group>'}`,
      `-DcrName ${dcrName}`,
      `-DcrResourceGroup ${dcrRg || '<dcr-resource-group>'}`,
    ];
    const updCommand = [
      '  ./scripts/deploy.ps1 `',
      ...updFlags.map((f, i) => `    ${f}${i < updFlags.length - 1 ? ' `' : ''}`),
    ];
    return [
      'Log Ingestion Portal — update data columns',
      '==========================================',
      '',
      'This archive is a ready-to-deploy copy of the LogIngestionAPI backend with',
      'your updated schema already applied:',
      '  - schema/columns.json       The updated Log Analytics table schema you selected.',
      '  - scripts/IntuneScript.ps1  The matching Intune detection script.',
      '  - README.txt                This file.',
      '',
      'This updates ONLY the custom table and Data Collection Rule from your new',
      'columns. The Function App is not touched (its code is schema-agnostic), and',
      'the DCR follows the workspace region automatically.',
      '',
      'Prerequisites: PowerShell 7+ and Azure CLI (az login). The Function Core',
      'Tools are NOT needed for a schema-only update.',
      '',
      'The existing workspace and DCR must already exist — if either is missing the',
      'script stops and tells you to run a full deployment first.',
      '',
      'Step 1 — Unzip and open the folder',
      '----------------------------------',
      '  Extract this archive, then open a PowerShell prompt in the LogIngestionAPI',
      '  folder (the one containing this README.txt and the scripts/ folder):',
      '',
      '  cd LogIngestionAPI',
      '',
      'Step 2 — Update (run this)',
      '--------------------------',
      ...updCommand,
      '',
      'The DCR name above must match the Data Collection Rule you deployed earlier',
      '(it is the exact resource name, not derived from the workload name).',
      '',
      'No Intune changes are needed for a column update — re-upload IntuneScript.ps1',
      'only if you want devices to start sending the new columns.',
      '',
    ].join('\n');
  }

  // Single deploy command built from the explicit resource names.
  const flags = [
    '-Subscription <subscription-name-or-id>',
    `-ResourceGroup ${rg}`,
    `-Location ${loc}`,
    `-FunctionAppName ${funcName}`,
    `-WorkspaceName ${wsName}`,
    `-DcrName ${dcrName}`,
    ...(wsRg ? [`-WorkspaceResourceGroup ${wsRg}`] : []),
    ...(wsLoc ? [`-WorkspaceLocation ${wsLoc}`] : []),
    ...(dcrRg ? [`-DcrResourceGroup ${dcrRg}`] : []),
    ...(isFlex ? ['-FunctionPlanType Flex'] : []),
  ];
  const command = [
    '  ./scripts/deploy.ps1 `',
    ...flags.map((f, i) => `    ${f}${i < flags.length - 1 ? ' `' : ''}`),
  ];
  const cloudShellFlags = [...flags, '-Subscription <subscription-name-or-id>', '-SchemaPath /home/<your-user>/columns.json'];
  const cloudShellCommand = [
    '  pwsh ./scripts/deploy.ps1 `',
    ...cloudShellFlags.map((f, i) => `    ${f}${i < cloudShellFlags.length - 1 ? ' `' : ''}`),
  ];

  const scenarioSummary = [
    'Every resource is created if it is missing, or updated in place if it',
    'already exists — pick whatever names match your tenant\'s standard. The',
    'Function App is named exactly as you chose (no random hash). If an app with',
    'that name already exists in your subscription the script warns you before',
    'deploying into it (a zip deploy hides any other functions in that app); if',
    'the name is taken in another tenant it tells you to pick a different one.',
  ];

  return [
    'Log Ingestion Portal — deployment instructions',
    '==============================================',
    '',
    'This archive is a ready-to-deploy copy of the LogIngestionAPI backend',
    '(Function App code, Bicep/ARM infra, and deploy scripts) with your selections',
    'already applied:',
    '  - schema/columns.json       The Log Analytics table schema you selected.',
    '  - scripts/IntuneScript.ps1  The Intune Proactive Remediation detection script',
    `                              that collects the data and posts it to your ${tableList} ${tableWord}.`,
    '  - README.txt                This file.',
    '',
    'Everything is already in place — nothing to clone or copy.',
    '',
    ...scenarioSummary,
    '',
    `Function App hosting plan: ${config.functionPlanType}${
      isFlex ? ' (Linux FC1, PowerShell 7.4)' : ' (Windows Y1, classic serverless)'
    }`,
    ...(isFlex ? ['  Flex is not available in every region — verify region support first.'] : []),
    '',
    'What you need:',
    '  - PowerShell 7+',
    '  - Azure CLI (az) signed in to your tenant:  az login',
    '  - Azure Functions Core Tools (func)',
    '',
    'Step 1 — Unzip and open the folder',
    '----------------------------------',
    '  Extract this archive, then open a PowerShell prompt in the LogIngestionAPI',
    '  folder (the one containing this README.txt and the scripts/ folder):',
    '',
    '  cd LogIngestionAPI',
    '',
    'Step 2 — Deploy (run this)',
    '--------------------------',
    ...command,
    '',
    'It is idempotent — safe to re-run to redeploy the full solution. Missing',
    'resource groups are created for you; if you lack permission the script prints',
    'the exact "az group create" command to run or hand to an admin.',
    '',
    '## No-admin local machine option (Azure Cloud Shell)',
    '',
    'If you cannot install tools locally, run the same deployment in Azure Cloud',
    'Shell. Use the uploaded file path shown by Cloud Shell for -SchemaPath',
    '(commonly /home/<your-user>/columns.json).',
    '',
    '  1) Open https://shell.azure.com',
    '  2) Upload your generated columns.json file',
    '  3) Run:',
    ...cloudShellCommand,
    '',
    'Later, to change ONLY the data columns (no Function App changes), use the',
    "portal's \"Update data columns only\" action — it generates a lighter",
    '-SchemaOnly command that updates just the table + DCR.',
    '',
    'Step 3 — Grant the Function its Graph permission (often a different admin)',
    '------------------------------------------------------------------------',
    'Device authentication looks each device up in Entra, so the Function App\'s',
    'managed identity needs Microsoft Graph "Device.Read.All" (application). Without',
    'it EVERY request returns 401.',
    '',
    'deploy.ps1 tries to grant this automatically, but assigning a Graph app role',
    'requires a Graph admin (Privileged Role Administrator / Global Administrator) —',
    'which in most companies is a DIFFERENT person than whoever runs the deploy. If',
    'the deploy prints a warning that it could not assign Device.Read.All, have that',
    'admin run the helper with the resource group + Function App name the deploy printed:',
    '',
    '  ./scripts/AssignMSIPermisison.ps1 -ResourceGroup <func-rg> -FunctionAppName <func-name>',
    '',
    'Propagation can take a few minutes. Until it is assigned, devices get 401.',
    '',
    'Step 4 — Wire up Intune',
    '-----------------------',
    'The deploy prints the Function URL and key. Set $FunctionUrl at the top of',
    'IntuneScript.ps1 to that URL (including ?code=<function-key>), then upload',
    'IntuneScript.ps1 as an Intune Proactive Remediation detection script. Device-',
    'signed JWT authentication is always required, so the targeted devices must be',
    'Entra-joined.',
    '',
  ].join('\n');
}

function escapePsSingleQuote(value: string): string {
  // In a single-quoted PowerShell string a literal single quote is doubled.
  return value.replace(/'/g, "''");
}

/**
 * Rewrites the `workflow_dispatch` input defaults in a bundled workflow file
 * (deploy.yml or update-columns.yml) so the GitHub Actions "Run workflow" form
 * is pre-filled with exactly what the user picked in the portal. Only inputs the
 * portal controls are touched; the rest (method, requireEntraDevice,
 * skipRoleAssignment) keep their file defaults. Inputs not present in the given
 * file are simply ignored, so the same overrides work for both workflows.
 * Returns the YAML unchanged if its shape isn't what we expect.
 */
export function generateWorkflowYaml(
  baseYaml: string,
  config: PortalConfig,
  workspaceName?: string,
): string {
  const trimmed = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  // Single-quoted YAML scalar (a literal single quote is doubled).
  const yamlStr = (v: string) => `'${v.replace(/'/g, "''")}'`;

  const ws = trimmed(workspaceName);
  // Map each workflow input name to its new default. `undefined` = leave as-is.
  // Keys that don't exist in the given file are ignored, so the same overrides
  // work for both the deploy and the schema-only workflow.
  const overrides: Record<string, string | undefined> = {
    functionPlanType: config.functionPlanType,
    resourceGroup: trimmed(config.resourceGroup) && yamlStr(config.resourceGroup.trim()),
    functionAppName: trimmed(config.functionAppName) && yamlStr(config.functionAppName.trim()),
    workspaceName: ws && yamlStr(ws),
    workspaceResourceGroup:
      trimmed(config.workspaceResourceGroup) && yamlStr(config.workspaceResourceGroup.trim()),
    workspaceLocation:
      trimmed(config.workspaceLocation) && yamlStr(config.workspaceLocation.trim()),
    dcrResourceGroup: trimmed(config.dcrResourceGroup) && yamlStr(config.dcrResourceGroup.trim()),
    location: trimmed(config.location) && yamlStr(config.location.trim()),
    dcrName: trimmed(config.dcrName) && yamlStr(config.dcrName.trim()),
  };

  // Input keys are indented 6 spaces; their properties (incl. `default:`) 8.
  const inputKeyRe = /^ {6}([A-Za-z][A-Za-z0-9]*):\s*$/;
  const defaultRe = /^( {8}default:).*$/;
  let currentKey: string | null = null;
  // Normalize CRLF -> LF first: on Windows checkouts the bundled YAML has \r\n,
  // and a trailing \r stops the `.*$` default-line regex from matching (so no
  // override would ever apply). Emitting LF is fine for GitHub Actions.
  return baseYaml
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const keyMatch = line.match(inputKeyRe);
      if (keyMatch) {
        currentKey = keyMatch[1];
        return line;
      }
      if (currentKey && defaultRe.test(line)) {
        const next = overrides[currentKey];
        currentKey = null; // each input has a single default line
        if (next !== undefined) return line.replace(defaultRe, `$1 ${next}`);
        return line;
      }
      return line;
    })
    .join('\n');
}

