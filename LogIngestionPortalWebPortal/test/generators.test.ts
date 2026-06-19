import { describe, expect, it } from 'vitest';
import { catalog } from '../src/data/catalog';
import type { PortalConfig, TableConfig } from '../src/types';
import {
  generateColumns,
  generateDeployReadme,
  generateScript,
  generateScripts,
  groupTablesByScript,
  scriptFileName,
  generateWorkflowYaml,
  tableFields,
} from '../src/lib/generators';
import { getRequiredFieldWarnings, validateColumns, validatePortalConfig } from '../src/lib/validation';
import expectedColumns from './fixtures/columns.json';

const baseConfig: PortalConfig = {
  functionUrl: 'https://example.azurewebsites.net/api/DCRLogIngestionAPI?code=secret',
  scriptVersion: '1.0.0',
  action: 'deploy',
  resourceGroup: '',
  functionAppName: '',
  dcrResourceGroup: '',
  dcrName: '',
  workspaceResourceGroup: '',
  location: '',
  workspaceLocation: '',
  functionPlanType: 'Consumption',
};

function defaultFieldIds(): string[] {
  return catalog.fields.filter((f) => f.default && !f.locked).map((f) => f.id);
}

function defaultTables(): TableConfig[] {
  return [
    {
      id: 't-default',
      name: catalog.tableName,
      description: catalog.description,
      fieldIds: defaultFieldIds(),
    },
  ];
}

describe('generateColumns', () => {
  it('reproduces the original schema/columns.json with the default selection', () => {
    const doc = generateColumns(catalog, defaultTables());
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0]).toEqual(expectedColumns);
  });

  it('always includes TimeGenerated first, even with nothing selected', () => {
    const doc = generateColumns(catalog, [
      { id: 't1', name: 'Empty_CL', description: '', fieldIds: [] },
    ]);
    expect(doc.tables[0]?.columns[0]?.name).toBe('TimeGenerated');
  });

  it('builds one table document per configured table', () => {
    const tables: TableConfig[] = [
      { id: 't1', name: 'Table1_CL', description: 'one', fieldIds: [] },
      { id: 't2', name: 'Table2_CL', description: 'two', fieldIds: [] },
    ];
    const doc = generateColumns(catalog, tables);
    expect(doc.tables.map((t) => t.tableName)).toEqual(['Table1_CL', 'Table2_CL']);
  });

  it('passes deploy.ps1-equivalent validation for the default selection', () => {
    const doc = generateColumns(catalog, defaultTables());
    expect(validateColumns(doc)).toEqual([]);
  });

  it('flags a table name that does not end in _CL', () => {
    const doc = generateColumns(catalog, [{ ...defaultTables()[0], name: 'BadName' }]);
    expect(validateColumns(doc).some((e) => e.includes('_CL'))).toBe(true);
  });

  it('flags duplicate table names', () => {
    const doc = generateColumns(catalog, [
      { id: 't1', name: 'Dup_CL', description: '', fieldIds: defaultFieldIds() },
      { id: 't2', name: 'Dup_CL', description: '', fieldIds: defaultFieldIds() },
    ]);
    expect(validateColumns(doc).some((e) => e.toLowerCase().includes('duplicate table'))).toBe(true);
  });
});

describe('generateScript', () => {
  it('emits a payload property for every selected column', () => {
    const tables = defaultTables();
    const script = generateScript(catalog, tables, baseConfig);
    for (const f of tableFields(catalog, tables[0])) {
      expect(script).toContain(`${f.column.name} `);
    }
  });

  it('emits a keyed entry for each table name', () => {
    const tables: TableConfig[] = [
      { id: 't1', name: 'Table1_CL', description: '', fieldIds: defaultFieldIds() },
      { id: 't2', name: 'Table2_CL', description: '', fieldIds: [] },
    ];
    const script = generateScript(catalog, tables, baseConfig);
    expect(script).toContain("'Table1_CL' = @(");
    expect(script).toContain("'Table2_CL' = @(");
  });

  it('injects config values and always requires JWT', () => {
    const script = generateScript(catalog, defaultTables(), baseConfig);
    expect(script).toContain("$FunctionUrl = 'https://example.azurewebsites.net/api/DCRLogIngestionAPI?code=secret'");
    expect(script).toContain('$UseDeviceJwt = $true');
    expect(script).toContain("$ScriptVersion = '1.0.0'");
    expect(script).not.toContain('__GET_DEVICE_DATA_BODY__');
  });

  it('emits each shared setup snippet at most once even across tables', () => {
    const tables: TableConfig[] = [
      { id: 't1', name: 'Table1_CL', description: '', fieldIds: defaultFieldIds() },
      { id: 't2', name: 'Table2_CL', description: '', fieldIds: defaultFieldIds() },
    ];
    const script = generateScript(catalog, tables, baseConfig);
    const csMatches = script.match(/\$cs = Get-CimInstance/g) ?? [];
    expect(csMatches.length).toBe(1);
  });

  it('escapes single quotes in the script version', () => {
    const script = generateScript(catalog, defaultTables(), { ...baseConfig, scriptVersion: "O'Brien" });
    expect(script).toContain("$ScriptVersion = 'O''Brien'");
  });

  it('injects collectors containing $-replacement patterns literally (no String.replace corruption)', () => {
    // The w32tm collector regex ends with `(.*)$'`. A string-based replace would
    // treat `$'` as "text after the match" and truncate the body; a function
    // replacer keeps it literal. Guard against a regression.
    const tables: TableConfig[] = [
      { id: 't-time', name: 'Device_CL', description: '', fieldIds: ['TimeSyncStatus'] },
    ];
    const script = generateScript(catalog, tables, baseConfig);
    expect(script).toContain("$line -match '^\\s*([^:]+):\\s*(.*)$'");
    expect(script).toContain('[pscustomobject]$o');
    expect(script).not.toContain('__GET_DEVICE_DATA_BODY__');
  });
});

describe('row-source tables', () => {
  // A table becomes "one row per item" automatically when a per-item field
  // (one with an element schema, e.g. Drivers) is assigned to it.
  const driverTable: TableConfig[] = [
    {
      id: 't-drv',
      name: 'Drivers_CL',
      description: 'one row per driver',
      fieldIds: ['DeviceName', 'Drivers'],
    },
  ];

  it('columns.json has device columns + element columns, not the array column', () => {
    const doc = generateColumns(catalog, driverTable);
    const cols = doc.tables[0].columns.map((c) => c.name);
    expect(cols).toContain('TimeGenerated');
    expect(cols).toContain('DeviceName');
    expect(cols).toContain('DriverName');
    expect(cols).toContain('DriverVersion');
    // the array field itself is expanded, not emitted as a dynamic column
    expect(cols).not.toContain('Drivers');
  });

  it('script emits a foreach over the array with per-item expressions', () => {
    const script = generateScript(catalog, driverTable, baseConfig);
    expect(script).toContain("'Drivers_CL' = @(");
    expect(script).toContain('foreach ($item in @($Drivers))');
    expect(script).toMatch(/DriverName\s+= \$item\.DeviceName/);
    expect(script).toMatch(/DeviceName\s+= \$DeviceName/);
  });

  it('a normal table still emits a single record (no foreach)', () => {
    const script = generateScript(catalog, defaultTables(), baseConfig);
    expect(script).not.toContain('foreach ($item in');
  });
});

describe('generateScriptGroups', () => {
  const fids = defaultFieldIds();
  const groupedTables: TableConfig[] = [
    { id: 't1', name: 'Devices_CL', description: '', fieldIds: fids, scriptName: 'DeviceDaily' },
    { id: 't2', name: 'WindowsUpdate_CL', description: '', fieldIds: fids, scriptName: 'DeviceDaily' },
    { id: 't3', name: 'AppLockerEvents_CL', description: '', fieldIds: fids, scriptName: 'AppLockerHourly' },
  ];

  it('builds the IntuneScript-<name>.ps1 file name (and the default fallback)', () => {
    expect(scriptFileName('AppLockerHourly')).toBe('IntuneScript-AppLockerHourly.ps1');
    expect(scriptFileName('App Locker / Hourly')).toBe('IntuneScript-AppLockerHourly.ps1');
    expect(scriptFileName('')).toBe('IntuneScript.ps1');
    expect(scriptFileName(undefined)).toBe('IntuneScript.ps1');
  });

  it('groups tables by scriptName preserving first-seen order', () => {
    const groups = groupTablesByScript(groupedTables);
    expect(groups.map((g) => g.scriptName)).toEqual(['DeviceDaily', 'AppLockerHourly']);
    expect(groups[0].tables.map((t) => t.name)).toEqual(['Devices_CL', 'WindowsUpdate_CL']);
    expect(groups[1].tables.map((t) => t.name)).toEqual(['AppLockerEvents_CL']);
  });

  it('generates one script per group, each collecting only its own tables', () => {
    const scripts = generateScripts(catalog, groupedTables, baseConfig);
    expect(scripts.map((s) => s.filename)).toEqual([
      'IntuneScript-DeviceDaily.ps1',
      'IntuneScript-AppLockerHourly.ps1',
    ]);
    const daily = scripts[0].content;
    expect(daily).toContain("'Devices_CL' = @(");
    expect(daily).toContain("'WindowsUpdate_CL' = @(");
    expect(daily).not.toContain("'AppLockerEvents_CL' = @(");
    const hourly = scripts[1].content;
    expect(hourly).toContain("'AppLockerEvents_CL' = @(");
    expect(hourly).not.toContain("'Devices_CL' = @(");
  });

  it('lists every generated script in the deploy README', () => {
    const readme = generateDeployReadme(baseConfig, groupedTables);
    expect(readme).toContain('IntuneScript-DeviceDaily.ps1');
    expect(readme).toContain('IntuneScript-AppLockerHourly.ps1');
  });
});

describe('generateDeployReadme', () => {
  const tables = defaultTables();

  it('emits deploy commands without legacy A-E options', () => {
    const readme = generateDeployReadme(baseConfig, tables);
    const occurrences = readme.split('./scripts/deploy.ps1').length - 1;
    expect(occurrences).toBe(2);
    expect(readme).not.toContain('Use an EXISTING Log Analytics workspace');
  });

  it('describes the upsert behaviour and never mentions a random hash', () => {
    const readme = generateDeployReadme(baseConfig, tables);
    expect(readme).toContain('created if it is missing');
    expect(readme).toContain('no random hash');
    expect(readme).not.toContain('-ExistingWorkspaceName');
  });

  it('always includes the explicit workspace + DCR names in the deploy command', () => {
    const cfg = {
      ...baseConfig,
      resourceGroup: 'rg-logging',
      functionAppName: 'func-logging',
      dcrName: 'dcr-logging',
    };
    const readme = generateDeployReadme(cfg, tables, 'log-logging');
    expect(readme).toContain('-ResourceGroup rg-logging');
    expect(readme).toContain('-FunctionAppName func-logging');
    expect(readme).toContain('-WorkspaceName log-logging');
    expect(readme).toContain('-DcrName dcr-logging');
  });

  it('adds the optional workspace/DCR resource-group flags only when provided', () => {
    const withRgs = generateDeployReadme(
      { ...baseConfig, workspaceResourceGroup: 'rg-ws', dcrResourceGroup: 'rg-dcr' },
      tables,
      'my-law',
    );
    expect(withRgs).toContain('-WorkspaceResourceGroup rg-ws');
    expect(withRgs).toContain('-DcrResourceGroup rg-dcr');
    const without = generateDeployReadme(baseConfig, tables, 'my-law');
    expect(without).not.toContain('-WorkspaceResourceGroup');
    expect(without).not.toContain('-DcrResourceGroup');
  });

  it('adds the -WorkspaceLocation flag only when a workspace region is chosen', () => {
    const withLoc = generateDeployReadme(
      { ...baseConfig, workspaceLocation: 'westeurope' },
      tables,
      'my-law',
    );
    expect(withLoc).toContain('-WorkspaceLocation westeurope');
    expect(generateDeployReadme(baseConfig, tables, 'my-law')).not.toContain('-WorkspaceLocation');
  });

  it('explains where to copy columns.json', () => {
    expect(generateDeployReadme(baseConfig, tables)).toContain('schema/columns.json');
  });

  it('adds the Flex plan flag when Flex is selected', () => {
    const readme = generateDeployReadme({ ...baseConfig, functionPlanType: 'Flex' }, tables);
    expect(readme).toContain('-FunctionPlanType Flex');
  });

  it('omits the Flex plan flag for Consumption', () => {
    expect(generateDeployReadme(baseConfig, tables)).not.toContain('-FunctionPlanType Flex');
  });

  it('update-columns mode emits a -SchemaOnly command and no Function App flags', () => {
    const cfg = {
      ...baseConfig,
      action: 'updateColumns' as const,
      workspaceResourceGroup: 'rg-logs',
      dcrName: 'dcr-shared',
      dcrResourceGroup: 'rg-dcr',
    };
    const readme = generateDeployReadme(cfg, tables, 'log-shared');
    expect(readme).toContain('-SchemaOnly');
    expect(readme).toContain('-WorkspaceName log-shared');
    expect(readme).toContain('-WorkspaceResourceGroup rg-logs');
    expect(readme).toContain('-DcrName dcr-shared');
    expect(readme).toContain('-DcrResourceGroup rg-dcr');
    expect(readme).not.toContain('-FunctionAppName');
    expect(readme).not.toContain('-Location');
  });
});

describe('validatePortalConfig', () => {
  it('flags an invalid direct DCR name', () => {
    const errors = validatePortalConfig({ ...baseConfig, dcrName: 'dcr_invalid_' });
    expect(errors.some((e) => e.includes('DCR name is invalid'))).toBe(true);
  });

  it('accepts a valid direct DCR name', () => {
    const errors = validatePortalConfig({ ...baseConfig, dcrName: 'dcr-logingestion-dev' });
    expect(errors).toEqual([]);
  });
});

describe('getRequiredFieldWarnings', () => {
  it('returns the missing deploy fields for a full solution download', () => {
    const warnings = getRequiredFieldWarnings(
      { ...baseConfig, action: 'deploy', scriptVersion: '' },
      [{ id: 't1', name: '', description: '', fieldIds: [] }],
      '',
    );
    expect(warnings).toEqual([
      'Intune script version',
      'Table 1 name',
      'Resource group',
      'Function App name',
      'Region',
      'Workspace name',
      'DCR name',
    ]);
  });

  it('returns the missing schema-only fields for an update-columns download', () => {
    const warnings = getRequiredFieldWarnings(
      { ...baseConfig, action: 'updateColumns', scriptVersion: '' },
      [{ id: 't1', name: 'Devices_CL', description: '', fieldIds: [] }],
      '',
    );
    expect(warnings).toEqual([
      'Intune script version',
      'Workspace name',
      'Workspace resource group',
      'DCR name',
      'DCR resource group',
    ]);
  });
});

describe('generateWorkflowYaml', () => {
  const sampleYaml = [
    'on:',
    '  workflow_dispatch:',
    '    inputs:',
    '      method:',
    '        type: choice',
    '        options: [native, script]',
    '        default: native',
    '      resourceGroup:',
    '        type: string',
    '        default: rg-logingestion',
    '      location:',
    '        type: string',
    '        default: eastus',
    '      functionAppName:',
    '        type: string',
    '        default: func-logingestion',
    '      workspaceName:',
    '        type: string',
    '        default: log-logingestion',
    '      workspaceResourceGroup:',
    '        type: string',
    "        default: ''",
    '      dcrName:',
    '        type: string',
    "        default: ''",
    '      dcrResourceGroup:',
    '        type: string',
    "        default: ''",
    '      functionPlanType:',
    '        type: choice',
    '        options: [Consumption, Flex]',
    '        default: Consumption',
    '      requireEntraDevice:',
    '        type: boolean',
    '        default: true',
    '',
  ].join('\n');

  it('pre-fills input defaults from the portal selections', () => {
    const cfg: PortalConfig = {
      ...baseConfig,
      action: 'deploy',
      resourceGroup: 'rg-logingestion-prod',
      functionAppName: 'func-logingestion-prod',
      dcrResourceGroup: 'rg-log-demo',
      location: 'northeurope',
      functionPlanType: 'Flex',
    };
    const out = generateWorkflowYaml(sampleYaml, cfg);
    expect(out).toContain("        default: 'rg-logingestion-prod'");
    expect(out).toContain("        default: 'func-logingestion-prod'");
    expect(out).toContain("        default: 'rg-log-demo'");
    expect(out).toContain("        default: 'northeurope'");
    expect(out).toContain('        default: Flex');
    // method is not portal-controlled, so it keeps its file default.
    expect(out).toContain('        default: native');
    // requireEntraDevice is left untouched.
    expect(out).toContain('        default: true');
  });

  it('sets workspace + dcr name for a schema-only update', () => {
    const cfg: PortalConfig = {
      ...baseConfig,
      action: 'updateColumns',
      workspaceResourceGroup: 'rg-shared-logs',
      dcrName: 'dcr-logingestion-prod',
    };
    const out = generateWorkflowYaml(sampleYaml, cfg, 'log-shared-central');
    expect(out).toContain("        default: 'log-shared-central'");
    expect(out).toContain("        default: 'rg-shared-logs'");
    expect(out).toContain("        default: 'dcr-logingestion-prod'");
  });

  it('leaves blank optional inputs untouched when not provided', () => {
    const out = generateWorkflowYaml(sampleYaml, baseConfig);
    // dcrName stays empty for a blank config.
    expect(out).toContain("      dcrName:\n        type: string\n        default: ''");
    // resourceGroup keeps its file default because the portal field is blank.
    expect(out).toContain('        default: rg-logingestion');
  });
});
