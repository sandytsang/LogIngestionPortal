import type { ReactNode } from 'react';
import type { PortalConfig } from '../types';

interface Props {
  config: PortalConfig;
  onChange: (patch: Partial<PortalConfig>) => void;
  workspaceName: string;
  onWorkspaceChange: (value: string) => void;
  errors: string[];
}

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900';
const label = 'block text-xs font-medium text-slate-600 dark:text-slate-300';

// Common Azure regions that support Log Analytics + Data Collection Rules.
const azureRegions: { value: string; label: string }[] = [
  { value: 'eastus', label: 'East US' },
  { value: 'eastus2', label: 'East US 2' },
  { value: 'centralus', label: 'Central US' },
  { value: 'southcentralus', label: 'South Central US' },
  { value: 'westus', label: 'West US' },
  { value: 'westus2', label: 'West US 2' },
  { value: 'westus3', label: 'West US 3' },
  { value: 'canadacentral', label: 'Canada Central' },
  { value: 'northeurope', label: 'North Europe' },
  { value: 'westeurope', label: 'West Europe' },
  { value: 'uksouth', label: 'UK South' },
  { value: 'ukwest', label: 'UK West' },
  { value: 'francecentral', label: 'France Central' },
  { value: 'germanywestcentral', label: 'Germany West Central' },
  { value: 'switzerlandnorth', label: 'Switzerland North' },
  { value: 'swedencentral', label: 'Sweden Central' },
  { value: 'norwayeast', label: 'Norway East' },
  { value: 'uaenorth', label: 'UAE North' },
  { value: 'southafricanorth', label: 'South Africa North' },
  { value: 'centralindia', label: 'Central India' },
  { value: 'southeastasia', label: 'Southeast Asia' },
  { value: 'eastasia', label: 'East Asia' },
  { value: 'japaneast', label: 'Japan East' },
  { value: 'koreacentral', label: 'Korea Central' },
  { value: 'australiaeast', label: 'Australia East' },
  { value: 'australiasoutheast', label: 'Australia Southeast' },
  { value: 'brazilsouth', label: 'Brazil South' },
];

export function ConfigPanel({ config, onChange, workspaceName, onWorkspaceChange, errors }: Props) {
  const isUpdate = config.action === 'updateColumns';
  const isNew = config.scenario === 'new';

  // Cloud Adoption Framework abbreviation suggestion: if a name doesn't start
  // with the recommended prefix, offer a one-click corrected value.
  const cafSuggest = (value: string, prefix: string): string | null => {
    const v = value.trim();
    return v && !v.toLowerCase().startsWith(prefix) ? prefix + v : null;
  };

  type RgKey = 'functionResourceGroup' | 'dcrResourceGroup' | 'existingWorkspaceResourceGroup';
  const rgField = (id: string, labelText: ReactNode, key: RgKey, placeholder: string) => {
    const suggestion = cafSuggest(config[key], 'rg-');
    return (
      <div>
        <label className={label} htmlFor={id}>
          {labelText}
        </label>
        <input
          id={id}
          className={`${field} mt-1`}
          value={config[key]}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<PortalConfig>)}
          placeholder={placeholder}
        />
        {suggestion && (
          <button
            type="button"
            onClick={() => onChange({ [key]: suggestion } as Partial<PortalConfig>)}
            className="mt-1 text-[11px] text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-300"
            title="Azure naming best practice (Cloud Adoption Framework)"
          >
            Suggested name: {suggestion} — click to use
          </button>
        )}
      </div>
    );
  };

  const regionSelect = (id: string, labelText: string) => (
    <div>
      <label className={label} htmlFor={id}>
        {labelText}
      </label>
      <select
        id={id}
        className={`${field} mt-1`}
        value={config.location}
        onChange={(e) => onChange({ location: e.target.value })}
      >
        <option value="">Select a region…</option>
        {azureRegions.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label} ({r.value})
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Action selector: full deploy vs schema-only column update. */}
      <div>
        <span className={label}>What do you want to do?</span>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange({ action: 'deploy' })}
            className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
              !isUpdate
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
            }`}
          >
            <span className="block font-semibold">Deploy the solution</span>
            <span className="block text-[11px] opacity-80">Create or update the full stack (Function App + table + DCR).</span>
          </button>
          <button
            type="button"
            onClick={() => onChange({ action: 'updateColumns' })}
            className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
              isUpdate
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
            }`}
          >
            <span className="block font-semibold">Update data columns only</span>
            <span className="block text-[11px] opacity-80">Change the table + DCR. Function App is untouched.</span>
          </button>
        </div>
      </div>

      {/* Naming: workload name + environment drive all resource names. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="baseName">
            Workload name
          </label>
          <input
            id="baseName"
            className={`${field} mt-1`}
            value={config.baseName}
            onChange={(e) => onChange({ baseName: e.target.value })}
            placeholder="logapi"
          />
        </div>
        <div>
          <label className={label} htmlFor="environment">
            Environment
          </label>
          <select
            id="environment"
            className={`${field} mt-1`}
            value={config.environment}
            onChange={(e) => onChange({ environment: e.target.value as 'dev' | 'test' | 'prod' })}
          >
            <option value="dev">dev</option>
            <option value="test">test</option>
            <option value="prod">prod</option>
          </select>
        </div>
      </div>
      <p className="text-[11px] text-slate-400">
        Used for resource names, e.g. func-{config.baseName || 'logapi'}-{config.environment},
        dcr-{config.baseName || 'logapi'}-{config.environment}. Use the same values when you update later.
      </p>

      {isUpdate ? (
        <>
          {/* Schema-only: just locate the existing workspace + DCR. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="workspaceName">
                Existing workspace name
              </label>
              <input
                id="workspaceName"
                className={`${field} mt-1`}
                value={workspaceName}
                onChange={(e) => onWorkspaceChange(e.target.value)}
                placeholder="log-shared-central"
              />
            </div>
            {rgField('existingWorkspaceResourceGroup', 'Workspace resource group', 'existingWorkspaceResourceGroup', 'rg-shared-logs')}
          </div>
          {rgField('dcrResourceGroup', 'DCR resource group', 'dcrResourceGroup', 'rg-loging-prod')}
          <p className="text-[11px] text-slate-400">
            Updates only the custom table and Data Collection Rule from your
            selected columns. The region is taken from the workspace automatically,
            and the Function App is never changed (its code is schema-agnostic).
          </p>
        </>
      ) : isNew ? (
        <>
          {/* Scenario selector (deploy only). */}
          <div>
            <span className={label}>What are you setting up?</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChange({ scenario: 'new' })}
                className="rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-2 text-left text-xs text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
              >
                <span className="block font-semibold">Start from zero</span>
                <span className="block text-[11px] opacity-80">Create everything new in one resource group &amp; region.</span>
              </button>
              <button
                type="button"
                onClick={() => onChange({ scenario: 'existing' })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <span className="block font-semibold">Use existing Log Analytics</span>
                <span className="block text-[11px] opacity-80">Send data to a workspace you already have.</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {rgField('functionResourceGroup', 'Resource group', 'functionResourceGroup', 'rg-loging-prod')}
            {regionSelect('location', 'Region')}
          </div>
          <p className="text-[11px] text-slate-400">
            Everything — Function App, storage, Application Insights, the App Service
            plan, a new Log Analytics workspace and the DCR — is created together in
            this resource group and region.
          </p>
        </>
      ) : (
        <>
          {/* Scenario selector (deploy only). */}
          <div>
            <span className={label}>What are you setting up?</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onChange({ scenario: 'new' })}
                className="rounded-lg border border-slate-300 px-3 py-2 text-left text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <span className="block font-semibold">Start from zero</span>
                <span className="block text-[11px] opacity-80">Create everything new in one resource group &amp; region.</span>
              </button>
              <button
                type="button"
                onClick={() => onChange({ scenario: 'existing' })}
                className="rounded-lg border border-indigo-500 bg-indigo-50 px-3 py-2 text-left text-xs text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200"
              >
                <span className="block font-semibold">Use existing Log Analytics</span>
                <span className="block text-[11px] opacity-80">Send data to a workspace you already have.</span>
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="workspaceName">
                Existing workspace name
              </label>
              <input
                id="workspaceName"
                className={`${field} mt-1`}
                value={workspaceName}
                onChange={(e) => onWorkspaceChange(e.target.value)}
                placeholder="log-shared-central"
              />
            </div>
            {rgField('existingWorkspaceResourceGroup', 'Workspace resource group', 'existingWorkspaceResourceGroup', 'rg-shared-logs')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {rgField('functionResourceGroup', 'Function App resource group', 'functionResourceGroup', 'rg-loging-prod')}
            {regionSelect('location', 'Function App region')}
          </div>
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            The DCR is created automatically in your workspace's region (it must match).
            The Function App region above can differ. Storage, Application Insights and
            the plan are created in the Function App resource group.
          </p>
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer select-none">Advanced: separate DCR resource group</summary>
            <div className="mt-2">
              {rgField('dcrResourceGroup', <>DCR resource group <span className="text-slate-400">(optional)</span></>, 'dcrResourceGroup', 'defaults to Function App RG')}
            </div>
          </details>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="tableName">
            Table name
          </label>
          <input
            id="tableName"
            className={`${field} mt-1`}
            value={config.tableName}
            onChange={(e) => onChange({ tableName: e.target.value })}
          />
        </div>
        <div>
          <label className={label} htmlFor="remediationName">
            Remediation name
          </label>
          <input
            id="remediationName"
            className={`${field} mt-1`}
            value={config.remediationName}
            onChange={(e) => onChange({ remediationName: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="tableDescription">
          Table description
        </label>
        <input
          id="tableDescription"
          className={`${field} mt-1`}
          value={config.tableDescription}
          onChange={(e) => onChange({ tableDescription: e.target.value })}
        />
      </div>

      {!isUpdate && (
        <div>
          <label className={label} htmlFor="functionPlanType">
            Function App hosting plan
          </label>
          <select
            id="functionPlanType"
            className={`${field} mt-1`}
            value={config.functionPlanType}
            onChange={(e) => onChange({ functionPlanType: e.target.value as 'Consumption' | 'Flex' })}
          >
            <option value="Consumption">Consumption (Windows Y1 · classic serverless)</option>
            <option value="Flex">Flex Consumption (Linux FC1 · PowerShell 7.4)</option>
          </select>
          <p className="mt-1 text-[11px] text-slate-400">
            {config.functionPlanType === 'Flex'
              ? 'Flex: faster cold starts and VNet support, but not available in every region — verify region support.'
              : 'Consumption: widely available, pay-per-execution. Pick Flex for VNet or reduced cold starts.'}
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
