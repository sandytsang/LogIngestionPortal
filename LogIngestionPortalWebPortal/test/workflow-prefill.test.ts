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
