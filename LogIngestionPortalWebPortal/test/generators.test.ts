import { describe, expect, it } from 'vitest';
import { catalog } from '../src/data/catalog';
import type { PortalConfig } from '../src/types';
import {
  generateColumns,
  generateDeployReadme,
  generateScript,
  selectedFields,
} from '../src/lib/generators';
import { validateColumns } from '../src/lib/validation';
import expectedColumns from './fixtures/columns.json';

const baseConfig: PortalConfig = {
  functionUrl: 'https://example.azurewebsites.net/api/DCRLogIngestionAPI?code=secret',
  remediationName: 'DeviceInventory',
  tableName: catalog.tableName,
  tableDescription: catalog.description,
  action: 'deploy',
  scenario: 'new',
  baseName: 'logapi',
  environment: 'dev',
  functionResourceGroup: '',
  dcrResourceGroup: '',
  existingWorkspaceResourceGroup: '',
  location: '',
  functionPlanType: 'Consumption',
};

function defaultSelection(): Set<string> {
  return new Set(catalog.fields.filter((f) => f.default && !f.locked).map((f) => f.id));
}

describe('generateColumns', () => {
  it('reproduces the original schema/columns.json with the default selection', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const doc = generateColumns(fields, baseConfig);
    expect(doc).toEqual(expectedColumns);
  });

  it('always includes TimeGenerated first, even with nothing selected', () => {
    const fields = selectedFields(catalog, new Set());
    const doc = generateColumns(fields, baseConfig);
    expect(doc.columns[0]?.name).toBe('TimeGenerated');
  });

  it('passes deploy.ps1-equivalent validation for the default selection', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const doc = generateColumns(fields, baseConfig);
    expect(validateColumns(doc)).toEqual([]);
  });

  it('flags a table name that does not end in _CL', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const doc = generateColumns(fields, { ...baseConfig, tableName: 'BadName' });
    expect(validateColumns(doc).some((e) => e.includes('_CL'))).toBe(true);
  });
});

describe('generateScript', () => {
  it('emits a payload property for every selected column', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const script = generateScript(catalog, fields, baseConfig);
    for (const f of fields) {
      expect(script).toContain(`${f.column.name} `);
    }
  });

  it('injects config values and always requires JWT', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const script = generateScript(catalog, fields, baseConfig);
    expect(script).toContain("$FunctionUrl = 'https://example.azurewebsites.net/api/DCRLogIngestionAPI?code=secret'");
    expect(script).toContain('$UseDeviceJwt = $true');
    expect(script).toContain("$RemediationName = 'DeviceInventory'");
    expect(script).not.toContain('__GET_DEVICE_DATA_BODY__');
  });

  it('emits each shared setup snippet at most once', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const script = generateScript(catalog, fields, baseConfig);
    const csMatches = script.match(/\$cs = Get-CimInstance/g) ?? [];
    expect(csMatches.length).toBe(1);
  });

  it('escapes single quotes in the remediation name', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const script = generateScript(catalog, fields, { ...baseConfig, remediationName: "O'Brien" });
    expect(script).toContain("$RemediationName = 'O''Brien'");
  });
});

describe('generateDeployReadme', () => {
  it('emits a single deploy command (no A–E options)', () => {
    const readme = generateDeployReadme(baseConfig);
    const occurrences = readme.split('./scripts/deploy.ps1').length - 1;
    expect(occurrences).toBe(1);
    expect(readme).not.toContain('Use an EXISTING Log Analytics workspace');
  });

  it('start-from-zero command has no workspace flags', () => {
    const readme = generateDeployReadme(baseConfig);
    expect(readme).toContain('Scenario: start from zero');
    expect(readme).not.toContain('-ExistingWorkspaceName');
  });

  it('existing-workspace scenario includes the workspace flag', () => {
    const cfg = {
      ...baseConfig,
      scenario: 'existing' as const,
      existingWorkspaceResourceGroup: 'rg-mon',
    };
    const readme = generateDeployReadme(cfg, 'my-law');
    expect(readme).toContain('-ExistingWorkspaceName my-law');
    expect(readme).toContain('-ExistingWorkspaceResourceGroup rg-mon');
  });

  it('does not add the workspace flag for the new scenario even if a name is passed', () => {
    expect(generateDeployReadme(baseConfig, 'my-law')).not.toContain('-ExistingWorkspaceName');
  });

  it('explains where to copy columns.json', () => {
    expect(generateDeployReadme(baseConfig)).toContain('schema/columns.json');
  });

  it('adds the Flex plan flag when Flex is selected', () => {
    const readme = generateDeployReadme({ ...baseConfig, functionPlanType: 'Flex' });
    expect(readme).toContain('-FunctionPlanType Flex');
  });

  it('omits the Flex plan flag for Consumption', () => {
    expect(generateDeployReadme(baseConfig)).not.toContain('-FunctionPlanType Flex');
  });

  it('update-columns mode emits a -SchemaOnly command and no Function App flags', () => {
    const cfg = {
      ...baseConfig,
      action: 'updateColumns' as const,
      existingWorkspaceResourceGroup: 'rg-logs',
      dcrResourceGroup: 'rg-dcr',
    };
    const readme = generateDeployReadme(cfg, 'log-shared');
    expect(readme).toContain('-SchemaOnly');
    expect(readme).toContain('-ExistingWorkspaceName log-shared');
    expect(readme).toContain('-ExistingWorkspaceResourceGroup rg-logs');
    expect(readme).toContain('-DcrResourceGroup rg-dcr');
    expect(readme).not.toContain('-FunctionResourceGroup');
    expect(readme).not.toContain('-Location');
  });
});
