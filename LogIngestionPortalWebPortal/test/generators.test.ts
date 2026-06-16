import { describe, expect, it } from 'vitest';
import { catalog } from '../src/data/catalog';
import type { PortalConfig, TableConfig } from '../src/types';
import {
  generateColumns,
  generateDeployReadme,
  generateScript,
  generateWorkflowYaml,
  tableFields,
} from '../src/lib/generators';
import { validateColumns } from '../src/lib/validation';
import expectedColumns from './fixtures/columns.json';

const baseConfig: PortalConfig = {
  functionUrl: 'https://example.azurewebsites.net/api/DCRLogIngestionAPI?code=secret',
  scriptVersion: '1.0.0',
  action: 'deploy',
  scenario: 'new',
  baseName: 'logapi',
  environment: 'dev',
  functionResourceGroup: '',
  dcrResourceGroup: '',
  dcrName: '',
  existingWorkspaceResourceGroup: '',
  location: '',
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
});

describe('row-source tables', () => {
  const driverTable: TableConfig[] = [
    {
      id: 't-drv',
      name: 'Drivers_CL',
      description: 'one row per driver',
      fieldIds: ['DeviceName'],
      rowSourceFieldId: 'Drivers',
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

describe('generateDeployReadme', () => {
  const tables = defaultTables();

  it('emits a single deploy command (no A–E options)', () => {
    const readme = generateDeployReadme(baseConfig, tables);
    const occurrences = readme.split('./scripts/deploy.ps1').length - 1;
    expect(occurrences).toBe(1);
    expect(readme).not.toContain('Use an EXISTING Log Analytics workspace');
  });

  it('start-from-zero command has no workspace flags', () => {
    const readme = generateDeployReadme(baseConfig, tables);
    expect(readme).toContain('Scenario: start from zero');
    expect(readme).not.toContain('-ExistingWorkspaceName');
  });

  it('existing-workspace scenario includes the workspace flag', () => {
    const cfg = {
      ...baseConfig,
      scenario: 'existing' as const,
      existingWorkspaceResourceGroup: 'rg-mon',
    };
    const readme = generateDeployReadme(cfg, tables, 'my-law');
    expect(readme).toContain('-ExistingWorkspaceName my-law');
    expect(readme).toContain('-ExistingWorkspaceResourceGroup rg-mon');
  });

  it('does not add the workspace flag for the new scenario even if a name is passed', () => {
    expect(generateDeployReadme(baseConfig, tables, 'my-law')).not.toContain('-ExistingWorkspaceName');
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
      existingWorkspaceResourceGroup: 'rg-logs',
      dcrResourceGroup: 'rg-dcr',
    };
    const readme = generateDeployReadme(cfg, tables, 'log-shared');
    expect(readme).toContain('-SchemaOnly');
    expect(readme).toContain('-ExistingWorkspaceName log-shared');
    expect(readme).toContain('-ExistingWorkspaceResourceGroup rg-logs');
    expect(readme).toContain('-DcrResourceGroup rg-dcr');
    expect(readme).not.toContain('-FunctionResourceGroup');
    expect(readme).not.toContain('-Location');
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
    '      dcrResourceGroup:',
    '        type: string',
    "        default: ''",
    '      location:',
    '        type: string',
    '        default: eastus',
    '      baseName:',
    '        type: string',
    '        default: logapi',
    '      environment:',
    '        type: choice',
    '        options: [dev, test, prod]',
    '        default: dev',
    '      functionPlanType:',
    '        type: choice',
    '        options: [Consumption, Flex]',
    '        default: Consumption',
    '      existingWorkspaceName:',
    '        type: string',
    "        default: ''",
    '      existingWorkspaceResourceGroup:',
    '        type: string',
    "        default: ''",
    '      dcrName:',
    '        type: string',
    "        default: ''",
    '      requireEntraDevice:',
    '        type: boolean',
    '        default: true',
    '',
  ].join('\n');

  it('pre-fills input defaults from the portal selections', () => {
    const cfg: PortalConfig = {
      ...baseConfig,
      action: 'deploy',
      scenario: 'new',
      baseName: 'logingestion',
      environment: 'prod',
      functionResourceGroup: 'rg-logingestion-prod',
      dcrResourceGroup: 'rg-log-demo',
      location: 'northeurope',
      functionPlanType: 'Flex',
    };
    const out = generateWorkflowYaml(sampleYaml, cfg);
    expect(out).toContain("        default: 'rg-logingestion-prod'");
    expect(out).toContain("        default: 'rg-log-demo'");
    expect(out).toContain("        default: 'northeurope'");
    expect(out).toContain("        default: 'logingestion'");
    expect(out).toContain('        default: prod');
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
      scenario: 'existing',
      existingWorkspaceResourceGroup: 'rg-shared-logs',
      dcrName: 'dcr-logingestion-prod',
    };
    const out = generateWorkflowYaml(sampleYaml, cfg, 'log-shared-central');
    expect(out).toContain("        default: 'log-shared-central'");
    expect(out).toContain("        default: 'rg-shared-logs'");
    expect(out).toContain("        default: 'dcr-logingestion-prod'");
  });

  it('leaves blank optional inputs untouched when not provided', () => {
    const out = generateWorkflowYaml(sampleYaml, baseConfig);
    // existingWorkspaceName stays empty for a new-from-zero deploy.
    expect(out).toContain("      existingWorkspaceName:\n        type: string\n        default: ''");
    // resourceGroup keeps its file default because the portal field is blank.
    expect(out).toContain('        default: rg-logingestion');
  });
});
