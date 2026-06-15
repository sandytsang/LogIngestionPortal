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
  // never breaks the whole upload; the result is captured in $<id>.
  const collectorBlock = fields
    .filter((f) => f.collector)
    .map((f) => wrapCollector(f))
    .join('\n');

  const setupSection = [sharedBlock, collectorBlock].filter(Boolean).join('\n');

  // Align the '=' for readability.
  const pad = Math.max(...fields.map((f) => f.column.name.length));
  const objectLines = fields
    .map((f) => {
      const value = f.expression ?? `$${f.id}`;
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
    .replace('__USE_JWT__', '$true')
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
  return `    $${field.id} = Invoke-Safe '${escapePsSingleQuote(field.label)}' {\n${inner}\n    }`;
}

/**
 * Builds the README.txt with ONE ready-to-run deploy command tailored to the
 * chosen scenario. Pass workspaceName only for the "existing workspace" path.
 */
export function generateDeployReadme(config: PortalConfig, workspaceName?: string): string {
  const fnRg = config.functionResourceGroup?.trim() || 'rg-loging-prod';
  const loc = config.location?.trim() || 'eastus';
  const dcrRg = config.dcrResourceGroup?.trim();
  const wsRg = config.existingWorkspaceResourceGroup?.trim();
  const isFlex = config.functionPlanType === 'Flex';
  const useExisting = config.scenario === 'existing' && !!workspaceName;
  const baseName = config.baseName?.trim() || 'logapi';
  const env = config.environment || 'dev';
  // Only emit naming flags when they differ from the script defaults.
  const namingFlags = [
    ...(baseName !== 'logapi' ? [`-BaseName ${baseName}`] : []),
    ...(env !== 'dev' ? [`-Environment ${env}`] : []),
  ];

  // --- Update-columns (schema-only) — a single -SchemaOnly command. ---------
  if (config.action === 'updateColumns') {
    const ws = workspaceName?.trim() || '<workspace-name>';
    const updFlags = [
      '-SchemaOnly',
      `-ExistingWorkspaceName ${ws}`,
      `-ExistingWorkspaceResourceGroup ${wsRg || '<workspace-resource-group>'}`,
      `-DcrResourceGroup ${dcrRg || '<dcr-resource-group>'}`,
      ...namingFlags,
    ];
    const updCommand = [
      '  ./scripts/deploy.ps1 `',
      ...updFlags.map((f, i) => `    ${f}${i < updFlags.length - 1 ? ' `' : ''}`),
    ];
    return [
      'Log Ingestion Portal — update data columns',
      '==========================================',
      '',
      'This archive contains:',
      '  - columns.json   The updated Log Analytics table schema you selected.',
      '  - remediate.ps1  The matching Intune detection script.',
      '  - README.txt     This file.',
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
      'Step 1 — Get the LogIngestionAPI solution',
      '-----------------------------------------',
      '  git clone https://github.com/sandytsang/LogIngestionPortal.git',
      '  cd LogIngestionPortal/LogIngestionAPI',
      '',
      'Step 2 — Drop in your schema',
      '----------------------------',
      '  LogIngestionAPI/schema/columns.json   <-- replace this file',
      '',
      'Step 3 — Update (run this)',
      '--------------------------',
      ...updCommand,
      '',
      'If your DCR was deployed with a non-default name, also pass -BaseName and',
      '-Environment so the script can find it (DCR = dcr-<baseName>-<environment>).',
      '',
      'No Intune changes are needed for a column update — re-upload remediate.ps1',
      'only if you want devices to start sending the new columns.',
      '',
    ].join('\n');
  }

  // Single deploy command built from the chosen scenario's flags.
  const flags = [
    `-FunctionResourceGroup ${fnRg}`,
    `-Location ${loc}`,
    ...(dcrRg ? [`-DcrResourceGroup ${dcrRg}`] : []),
    ...(useExisting ? [`-ExistingWorkspaceName ${workspaceName}`] : []),
    ...(useExisting && wsRg ? [`-ExistingWorkspaceResourceGroup ${wsRg}`] : []),
    ...(isFlex ? ['-FunctionPlanType Flex'] : []),
    ...namingFlags,
  ];
  const command = [
    '  ./scripts/deploy.ps1 `',
    ...flags.map((f, i) => `    ${f}${i < flags.length - 1 ? ' `' : ''}`),
  ];

  const scenarioSummary = useExisting
    ? [
        `Scenario: send data to your existing workspace "${workspaceName}".`,
        '  A new Function App (+ storage, App Insights, plan) is created in the',
        '  Function App resource group. The Data Collection Rule is created in your',
        "  workspace's region automatically.",
      ]
    : [
        'Scenario: start from zero — create everything new.',
        '  The Function App (+ storage, App Insights, plan), a new Log Analytics',
        '  workspace, and the Data Collection Rule are all created together in the',
        '  resource group and region below.',
      ];

  return [
    'Log Ingestion Portal — deployment instructions',
    '==============================================',
    '',
    'This archive contains:',
    '  - columns.json   The Log Analytics table schema you selected.',
    '  - remediate.ps1  The Intune Proactive Remediation detection script that',
    `                   collects the data and posts it to your "${config.tableName}" table.`,
    '  - README.txt     This file.',
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
    'Step 1 — Get the LogIngestionAPI solution',
    '-----------------------------------------',
    '  git clone https://github.com/sandytsang/LogIngestionPortal.git',
    '  cd LogIngestionPortal/LogIngestionAPI',
    '',
    'Step 2 — Drop in your schema',
    '----------------------------',
    'Copy the columns.json from this archive over the repo copy:',
    '',
    '  LogIngestionAPI/schema/columns.json   <-- replace this file',
    '',
    'Step 3 — Deploy (run this)',
    '--------------------------',
    ...command,
    '',
    'It is idempotent — safe to re-run to redeploy the full solution. Missing',
    'resource groups are created for you; if you lack permission the script prints',
    'the exact "az group create" command to run or hand to an admin.',
    '',
    'Later, to change ONLY the data columns (no Function App changes), use the',
    "portal's \"Update data columns only\" action — it generates a lighter",
    '-SchemaOnly command that updates just the table + DCR.',
    '',
    'Step 4 — Grant the Function its Graph permission (often a different admin)',
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
    'Step 5 — Wire up Intune',
    '-----------------------',
    'The deploy prints the Function URL and key. Set $FunctionUrl at the top of',
    'remediate.ps1 to that URL (including ?code=<function-key>), then upload',
    'remediate.ps1 as an Intune Proactive Remediation detection script. Device-',
    'signed JWT authentication is always required, so the targeted devices must be',
    'Entra-joined.',
    '',
  ].join('\n');
}

function escapePsSingleQuote(value: string): string {
  // In a single-quoted PowerShell string a literal single quote is doubled.
  return value.replace(/'/g, "''");
}
