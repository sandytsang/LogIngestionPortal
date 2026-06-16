import { describe, expect, it } from 'vitest';
import { catalog } from '../src/data/catalog';
import type { PortalConfig, TableConfig } from '../src/types';
import {
  generateColumns,
  generateDeployReadme,
  generateScript,
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
