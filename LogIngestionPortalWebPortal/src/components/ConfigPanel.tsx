import type { ReactNode } from 'react';
import type { PortalConfig, TableConfig } from '../types';
import { catalog } from '../data/catalog';
import { rowSourceField } from '../lib/generators';

interface Props {
  config: PortalConfig;
  onChange: (patch: Partial<PortalConfig>) => void;
  tables: TableConfig[];
  onAddTable: () => void;
  onRemoveTable: (id: string) => void;
  onUpdateTable: (id: string, patch: Partial<TableConfig>) => void;
  workspaceName: string;
  onWorkspaceChange: (value: string) => void;
  errors: string[];
}

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900';
const label = 'block text-xs font-medium text-slate-600 dark:text-slate-300';

// Applied to a required input whose value is still empty, so missing fields are
// obvious at a glance (rose border + faint rose fill) instead of relying on a
// small asterisk.
const requiredRing =
  'border-rose-400 bg-rose-50/60 focus:border-rose-500 focus:ring-rose-500/30 dark:border-rose-500/60 dark:bg-rose-500/10';

// A clearly visible "Required" pill shown next to a label while its field is
// empty. Disappears once the user fills the field in.
const reqPill = (show: boolean): ReactNode =>
  show ? (
    <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
      Required
    </span>
  ) : null;

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

export function ConfigPanel({
  config,
  onChange,
  tables,
  onAddTable,
  onRemoveTable,
  onUpdateTable,
  workspaceName,
  onWorkspaceChange,
  errors,
}: Props) {
  const isUpdate = config.action === 'updateColumns';
  const isNew = config.scenario === 'new';

  // Required-field check for the whole panel. Lists the mandatory inputs that
  // are still empty for the chosen action/scenario so the user gets one clear
  // warning of everything missing before they download the artifacts.
  const isBlank = (value?: string): boolean => (value ?? '').trim() === '';
  const requiredWarnings: string[] = [];
  if (isBlank(config.scriptVersion)) requiredWarnings.push('Intune script version');
  tables.forEach((t, i) => {
    if (isBlank(t.name)) requiredWarnings.push(`Table ${i + 1} name`);
  });
  if (isUpdate) {
    if (isBlank(config.dcrName)) requiredWarnings.push('DCR name');
    if (isBlank(config.dcrResourceGroup)) requiredWarnings.push('DCR resource group');
    if (isBlank(workspaceName)) requiredWarnings.push('Existing workspace name');
    if (isBlank(config.existingWorkspaceResourceGroup)) requiredWarnings.push('Workspace resource group');
  } else {
    if (isBlank(config.baseName)) requiredWarnings.push('Workload name');
    if (isBlank(config.functionResourceGroup)) {
      requiredWarnings.push(isNew ? 'Resource group' : 'Function App resource group');
    }
    if (isBlank(config.location)) requiredWarnings.push(isNew ? 'Region' : 'Function App region');
    if (!isNew) {
      if (isBlank(workspaceName)) requiredWarnings.push('Existing workspace name');
      if (isBlank(config.existingWorkspaceResourceGroup)) requiredWarnings.push('Workspace resource group');
    }
  }

  // Cloud Adoption Framework abbreviation suggestion: if a name doesn't start
  // with the recommended prefix, offer a one-click corrected value.
  const cafSuggest = (value: string, prefix: string): string | null => {
    const v = value.trim();
    return v && !v.toLowerCase().startsWith(prefix) ? prefix + v : null;
  };

  type RgKey = 'functionResourceGroup' | 'dcrResourceGroup' | 'existingWorkspaceResourceGroup';
  const rgField = (id: string, labelText: ReactNode, key: RgKey, placeholder: string, required = true) => {
    const suggestion = cafSuggest(config[key], 'rg-');
    const empty = required && isBlank(config[key]);
    return (
      <div>
        <label className={label} htmlFor={id}>
          {labelText}
          {reqPill(empty)}
        </label>
        <input
          id={id}
          className={`${field} mt-1 ${empty ? requiredRing : ''}`}
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

  const regionSelect = (id: string, labelText: string) => {
    const empty = isBlank(config.location);
    return (
      <div>
        <label className={label} htmlFor={id}>
          {labelText}
          {reqPill(empty)}
        </label>
        <select
          id={id}
          className={`${field} mt-1 ${empty ? requiredRing : ''}`}
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
  };

  return (
    <div className="space-y-4">
      {requiredWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <p className="font-semibold">Required fields missing</p>
          <ul className="mt-1 space-y-0.5">
            {requiredWarnings.map((w) => (
              <li key={w}>• {w}</li>
            ))}
          </ul>
        </div>
      )}

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

      {/* Naming: workload name + environment drive all resource names (deploy only). */}
      {!isUpdate && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="baseName">
                Workload name
                {reqPill(isBlank(config.baseName))}
              </label>
              <input
                id="baseName"
                className={`${field} mt-1 ${isBlank(config.baseName) ? requiredRing : ''}`}
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
            Used for resource names, e.g. dcr-{config.baseName || 'logapi'}-{config.environment} and
            log-{config.baseName || 'logapi'}-{config.environment}. The Function App also gets a short
            unique hash, e.g. func-{config.baseName || 'logapi'}-{config.environment}-x1y2z (required
            because its name must be globally unique). Use the same workload + environment when you
            update later.
          </p>
        </>
      )}

      {isUpdate ? (
        <>
          {/* Schema-only: identify the exact DCR + its workspace to update. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="dcrName">
                DCR name
                {reqPill(isBlank(config.dcrName))}
              </label>
              <input
                id="dcrName"
                className={`${field} mt-1 ${isBlank(config.dcrName) ? requiredRing : ''}`}
                value={config.dcrName}
                onChange={(e) => onChange({ dcrName: e.target.value })}
                placeholder="dcr-logingestion-prod"
              />
              {cafSuggest(config.dcrName, 'dcr-') && (
                <button
                  type="button"
                  onClick={() => onChange({ dcrName: cafSuggest(config.dcrName, 'dcr-') as string })}
                  className="mt-1 text-[11px] text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-300"
                  title="Azure naming best practice (Cloud Adoption Framework)"
                >
                  Suggested name: {cafSuggest(config.dcrName, 'dcr-')} — click to use
                </button>
              )}
            </div>
            {rgField('dcrResourceGroup', 'DCR resource group', 'dcrResourceGroup', 'rg-logging-prod')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="workspaceName">
                Existing workspace name
                {reqPill(isBlank(workspaceName))}
              </label>
              <input
                id="workspaceName"
                className={`${field} mt-1 ${isBlank(workspaceName) ? requiredRing : ''}`}
                value={workspaceName}
                onChange={(e) => onWorkspaceChange(e.target.value)}
                placeholder="log-shared-central"
              />
            </div>
            {rgField('existingWorkspaceResourceGroup', 'Workspace resource group', 'existingWorkspaceResourceGroup', 'rg-shared-logs')}
          </div>
          <p className="text-[11px] text-slate-400">
            Enter the exact name of the Data Collection Rule you deployed earlier (it
            is not derived from the workload name). Updates only that table and DCR
            from your selected columns. The region is taken from the workspace
            automatically, and the Function App is never changed.
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
            {rgField('functionResourceGroup', 'Resource group', 'functionResourceGroup', 'rg-logging-prod')}
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
                {reqPill(isBlank(workspaceName))}
              </label>
              <input
                id="workspaceName"
                className={`${field} mt-1 ${isBlank(workspaceName) ? requiredRing : ''}`}
                value={workspaceName}
                onChange={(e) => onWorkspaceChange(e.target.value)}
                placeholder="log-shared-central"
              />
            </div>
            {rgField('existingWorkspaceResourceGroup', 'Workspace resource group', 'existingWorkspaceResourceGroup', 'rg-shared-logs')}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {rgField('functionResourceGroup', 'Function App resource group', 'functionResourceGroup', 'rg-logging-prod')}
            {regionSelect('location', 'Function App region')}
          </div>
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            The DCR is created automatically in your workspace's region (it must match).
            The Function App region above can differ. Storage, Application Insights and
            the plan are created in the Function App resource group.
          </p>
          <div>
            {rgField('dcrResourceGroup', <>DCR resource group <span className="text-slate-400">(optional)</span></>, 'dcrResourceGroup', 'defaults to Function App RG', false)}
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Leave blank to create the DCR in the Function App resource group.
            </p>
          </div>
        </>
      )}

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

      <details open className="rounded-lg border border-slate-200 dark:border-slate-700">
        <summary className="flex cursor-pointer select-none items-center justify-between px-3 py-2">
          <span className={label}>
            Tables <span className="text-slate-400">({tables.length})</span>
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onAddTable();
            }}
            className="rounded-md border border-indigo-300 px-2 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50 dark:border-indigo-500/40 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
          >
            + Add table
          </button>
        </summary>
        <div className="border-t border-slate-200 px-3 pb-3 pt-2 dark:border-slate-700">
          <p className="text-[11px] text-slate-400">
            Each table becomes its own custom Log Analytics table (must end in
            <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800">_CL</code>) and DCR
            stream. Assign fields to tables in the catalog on the left. TimeGenerated and
            IntuneScriptVersion are added to every table automatically.
          </p>
          <div className="mt-2 space-y-2">
            {tables.map((t, i) => {
              // A table automatically becomes "one row per item" when a per-item
              // field (e.g. installed drivers/hotfixes) is assigned to it.
              const rs = rowSourceField(catalog, t);
              const perItemCount = t.fieldIds.filter((id) => {
                const f = catalog.fields.find((x) => x.id === id);
                return Boolean(f?.element && f.element.length);
              }).length;
              return (
              <div
                key={t.id}
                className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"
              >
                <div className="flex items-center gap-2">
                  <input
                    className={`${field} ${isBlank(t.name) ? requiredRing : ''}`}
                    value={t.name}
                    onChange={(e) => onUpdateTable(t.id, { name: e.target.value })}
                    placeholder={`Table${i + 1}_CL`}
                    aria-label={`Table ${i + 1} name`}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveTable(t.id)}
                    disabled={tables.length <= 1}
                    className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
                    title={tables.length <= 1 ? 'At least one table is required' : 'Remove this table'}
                  >
                    Remove
                  </button>
                </div>
                <input
                  className={`${field} mt-2`}
                  value={t.description}
                  onChange={(e) => onUpdateTable(t.id, { description: e.target.value })}
                  placeholder="Table description (optional)"
                  aria-label={`Table ${i + 1} description`}
                />
                {rs && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
                      One row per {rs.label}
                    </span>
                    {perItemCount > 1 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        Only one per-item dataset per table — using {rs.label}.
                      </span>
                    )}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-slate-400">
                  {t.fieldIds.length} {t.fieldIds.length === 1 ? 'field' : 'fields'} assigned (plus
                  TimeGenerated &amp; IntuneScriptVersion).
                </p>
              </div>
              );
            })}
          </div>
        </div>
      </details>

      <div>
        <label className={label} htmlFor="scriptVersion">
          Intune script version
          {reqPill(isBlank(config.scriptVersion))}
        </label>
        <input
          id="scriptVersion"
          className={`${field} mt-1 ${isBlank(config.scriptVersion) ? requiredRing : ''}`}
          value={config.scriptVersion}
          onChange={(e) => onChange({ scriptVersion: e.target.value })}
          placeholder="1.0.0"
        />
        <p className="mt-1 text-[11px] text-slate-400">
          Required. Stamped into the <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">IntuneScriptVersion</code>{' '}
          column (added to every table automatically) so you can tell whether data came from an older
          script or the current one (e.g.{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">where IntuneScriptVersion == "{config.scriptVersion || '1.0.0'}"</code>).
          Bump it whenever you change the script.
        </p>
      </div>

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
