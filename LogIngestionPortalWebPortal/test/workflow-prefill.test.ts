import { describe, expect, it } from 'vitest';
import type { PortalConfig } from '../src/types';
import { generateWorkflowYaml } from '../src/lib/generators';

// Mirrors the update-columns.yml input block, but with CRLF line endings — the
// case that broke pre-fill on Windows checkouts (a trailing \r stopped the
// default-line regex from matching, so no override was applied).
const crlfYaml = [
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      environment:',
  '        type: choice',
  '        options: [dev, test, prod]',
  '        default: dev',
  '      existingWorkspaceName:',
  '        type: string',
  "        default: ''",
  '      existingWorkspaceResourceGroup:',
  '        type: string',
  "        default: ''",
  '      dcrName:',
  '        type: string',
  "        default: ''",
  '      dcrResourceGroup:',
  '        type: string',
  "        default: ''",
  '',
].join('\r\n');

const updateConfig: PortalConfig = {
  functionUrl: '',
  scriptVersion: '1.0.0',
  action: 'updateColumns',
  scenario: 'existing',
  baseName: '',
  environment: 'prod',
  functionResourceGroup: '',
  dcrResourceGroup: 'rg-logingestion-prod',
  dcrName: 'dcr-logingestion-prod',
  existingWorkspaceResourceGroup: 'rg-shared-logs',
  location: '',
  functionPlanType: 'Consumption',
};

describe('update-columns workflow pre-fill (CRLF-tolerant)', () => {
  it('writes the portal config into the input defaults even with CRLF line endings', () => {
    const out = generateWorkflowYaml(crlfYaml, updateConfig, 'log-shared-central');
    expect(out).toContain("        default: 'log-shared-central'");
    expect(out).toContain("        default: 'rg-shared-logs'");
    expect(out).toContain("        default: 'dcr-logingestion-prod'");
    expect(out).toContain("        default: 'rg-logingestion-prod'");
    expect(out).toContain('        default: prod');
  });
});

// deploy.yml input block (CRLF) — a brand-new full deploy.
const deployCrlfYaml = [
  'on:',
  '  workflow_dispatch:',
  '    inputs:',
  '      resourceGroup:',
  '        type: string',
  '        default: rg-logingestion',
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
  '',
].join('\r\n');

describe('deploy workflow pre-fill (brand-new deploy)', () => {
  it('keeps the web UI values: resource group, region, workload name, environment, plan', () => {
    const cfg: PortalConfig = {
      ...updateConfig,
      action: 'deploy',
      scenario: 'new',
      baseName: 'logingestion',
      environment: 'prod',
      functionResourceGroup: 'rg-logingestion-prod',
      location: 'northeurope',
      functionPlanType: 'Flex',
    };
    const out = generateWorkflowYaml(deployCrlfYaml, cfg);
    expect(out).toContain("        default: 'rg-logingestion-prod'");
    expect(out).toContain("        default: 'northeurope'");
    expect(out).toContain("        default: 'logingestion'");
    expect(out).toContain('        default: prod');
    expect(out).toContain('        default: Flex');
    // A new deploy creates a new workspace, so this stays blank.
    expect(out).toContain("      existingWorkspaceName:\n        type: string\n        default: ''");
  });
});
