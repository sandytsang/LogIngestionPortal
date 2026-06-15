import { describe, expect, it } from 'vitest';
import { catalog } from '../src/data/catalog';
import type { PortalConfig } from '../src/types';
import {
  generateColumns,
  generateDeployCommand,
  generateScript,
  selectedFields,
} from '../src/lib/generators';
import { validateColumns } from '../src/lib/validation';
import expectedColumns from './fixtures/columns.json';

const baseConfig: PortalConfig = {
  functionUrl: 'https://example.azurewebsites.net/api/Ingest?code=secret',
  useJwt: true,
  remediationName: 'DeviceInventory',
  tableName: catalog.tableName,
  tableDescription: catalog.description,
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

  it('injects config values and toggles JWT', () => {
    const fields = selectedFields(catalog, defaultSelection());
    const script = generateScript(catalog, fields, { ...baseConfig, useJwt: false });
    expect(script).toContain("$FunctionUrl = 'https://example.azurewebsites.net/api/Ingest?code=secret'");
    expect(script).toContain('$UseDeviceJwt = $false');
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

describe('generateDeployCommand', () => {
  it('includes the existing workspace switch when provided', () => {
    expect(generateDeployCommand('my-law')).toContain('-ExistingWorkspaceName my-law');
  });

  it('omits the workspace switch when not provided', () => {
    expect(generateDeployCommand()).not.toContain('-ExistingWorkspaceName');
  });
});
