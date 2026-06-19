import type { ReactNode } from 'react';
import type { PortalConfig, TableConfig } from '../types';

interface Props {
  config: PortalConfig;
  onChange: (patch: Partial<PortalConfig>) => void;
  tables: TableConfig[];
  workspaceName: string;
  onWorkspaceChange: (value: string) => void;
  errors: string[];
}

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus-accent dark:border-slate-700 dark:bg-slate-900';
const label = 'block text-sm font-medium text-slate-600 dark:text-slate-300';

// Applied to a required input whose value is still empty, so missing fields are
// obvious at a glance (rose border + faint rose fill) instead of relying on a
// small asterisk.
const requiredRing =
  'border-rose-400 bg-rose-50/60 focus:border-rose-500 focus:ring-rose-500/30 dark:border-rose-500/60 dark:bg-rose-500/10';

// A clearly visible "Required" pill shown next to a label while its field is
// empty. Disappears once the user fills the field in.
const reqPill = (show: boolean): ReactNode =>
  show ? (
    <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-rose-600 dark:bg-rose-500/20 dark:text-rose-300">
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
  workspaceName,
  onWorkspaceChange,
  errors,
}: Props) {
  const isUpdate = config.action === 'updateColumns';

  // Required-field check for the whole panel. Lists the mandatory inputs that
  // are still empty for the chosen action so the user gets one clear warning of
  // everything missing before they download the artifacts.
  const isBlank = (value?: string): boolean => (value ?? '').trim() === '';
  const requiredWarnings: string[] = [];
  if (isBlank(config.scriptVersion)) requiredWarnings.push('Intune script version');
  tables.forEach((t, i) => {
    if (isBlank(t.name)) requiredWarnings.push(`Table ${i + 1} name`);
  });
  if (isUpdate) {
    if (isBlank(workspaceName)) requiredWarnings.push('Workspace name');
    if (isBlank(config.workspaceResourceGroup)) requiredWarnings.push('Workspace resource group');
    if (isBlank(config.dcrName)) requiredWarnings.push('DCR name');
    if (isBlank(config.dcrResourceGroup)) requiredWarnings.push('DCR resource group');
  } else {
    if (isBlank(config.resourceGroup)) requiredWarnings.push('Resource group');
    if (isBlank(config.functionAppName)) requiredWarnings.push('Function App name');
    if (isBlank(config.location)) requiredWarnings.push('Region');
    if (isBlank(workspaceName)) requiredWarnings.push('Workspace name');
    if (isBlank(config.dcrName)) requiredWarnings.push('DCR name');
  }

  // A free-form text field with a one-click "suggested name". Names are NOT
  // forced into any convention: the suggestion is only a recommendation (the
  // Cloud Adoption Framework abbreviation) you can accept or ignore.
  const set = (key: keyof PortalConfig) => (v: string) =>
    onChange({ [key]: v } as Partial<PortalConfig>);

  const textField = (
    id: string,
    labelText: ReactNode,
    value: string,
    setValue: (v: string) => void,
    opts: {
      placeholder?: string;
      required?: boolean;
      suggested?: string;
      prefix?: string;
      suggestWhenEmpty?: boolean;
    } = {},
  ): ReactNode => {
    const { placeholder, required = true, suggested, prefix, suggestWhenEmpty = true } = opts;
    const empty = isBlank(value);
    const suggestion = empty
      ? suggestWhenEmpty
        ? suggested ?? null
        : null
      : prefix && !value.trim().toLowerCase().startsWith(prefix)
        ? prefix + value.trim()
        : null;
    return (
      <div>
        <label className={label} htmlFor={id}>
          {labelText}
          {required && reqPill(empty)}
        </label>
        <input
          id={id}
          className={`${field} mt-1 ${required && empty ? requiredRing : ''}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
        />
        {suggestion && (
          <button
            type="button"
            onClick={() => setValue(suggestion)}
            className="mt-1 text-sm text-accent underline"
            title="Suggested name — you can use any name your tenant prefers"
          >
            {empty ? `Use suggested: ${suggestion}` : `Suggested: ${suggestion} — click to use`}
          </button>
        )}
      </div>
    );
  };

  const regionSelect = (
    id: string,
    labelText: ReactNode,
    value: string,
    onPick: (v: string) => void,
    opts: { required?: boolean; placeholder?: string } = {},
  ) => {
    const { required = true, placeholder = 'Select a region…' } = opts;
    const empty = required && isBlank(value);
    return (
      <div>
        <label className={label} htmlFor={id}>
          {labelText}
          {required && reqPill(empty)}
        </label>
        <select
          id={id}
          className={`${field} mt-1 ${empty ? requiredRing : ''}`}
          value={value}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="">{placeholder}</option>
          {azureRegions.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} ({r.value})
            </option>
          ))}
        </select>
      </div>
    );
  };

  // A read-only region display for resources whose region is dictated by another
  // resource (the DCR always lives in the workspace's region).
  const regionReadOnly = (id: string, labelText: ReactNode, value: string, note: string) => (
    <div>
      <label className={label} htmlFor={id}>
        {labelText}
      </label>
      <input
        id={id}
        className={`${field} mt-1 cursor-not-allowed bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400`}
        value={value ? azureRegions.find((r) => r.value === value)?.label ?? value : ''}
        placeholder={note}
        readOnly
        disabled
      />
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{note}</p>
    </div>
  );

  // A bordered section grouping one resource's region / resource group / name.
  const section = (title: string, children: ReactNode) => (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      {requiredWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
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
            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
              !isUpdate
                ? 'selected-accent'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
            }`}
          >
            <span className="block font-semibold">Deploy the solution</span>
            <span className="block text-xs opacity-80">Create or update the full stack (Function App + table + DCR).</span>
          </button>
          <button
            type="button"
            onClick={() => onChange({ action: 'updateColumns' })}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
              isUpdate
                ? 'selected-accent'
                : 'border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
            }`}
          >
            <span className="block font-semibold">Update data columns only</span>
            <span className="block text-xs opacity-80">Change the table + DCR. Function App is untouched.</span>
          </button>
        </div>
      </div>

      {isUpdate ? (
        <>
          {/* Schema-only: identify the exact workspace + DCR to update. */}
          <div className="grid grid-cols-2 gap-3">
            {textField('workspaceName', 'Workspace name', workspaceName, onWorkspaceChange, {
              placeholder: 'log-logingestion',
              suggested: 'log-logingestion',
              prefix: 'log-',
            })}
            {textField(
              'workspaceResourceGroup',
              'Workspace resource group',
              config.workspaceResourceGroup,
              set('workspaceResourceGroup'),
              { placeholder: 'rg-logingestion', suggested: 'rg-logingestion', prefix: 'rg-' },
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {textField('dcrName', 'DCR name', config.dcrName, set('dcrName'), {
              placeholder: 'dcr-logingestion',
              suggested: 'dcr-logingestion',
              prefix: 'dcr-',
            })}
            {textField(
              'dcrResourceGroup',
              'DCR resource group',
              config.dcrResourceGroup,
              set('dcrResourceGroup'),
              { placeholder: 'rg-logingestion', suggested: 'rg-logingestion', prefix: 'rg-' },
            )}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Enter the exact names of the workspace and Data Collection Rule you deployed earlier.
            Only that table and DCR are updated from your selected columns; the region is taken from
            the workspace automatically and the Function App is never changed.
          </p>
        </>
      ) : (
        <>
          {/* Deploy: three resource sections, each with its own region /
              resource group / name. Everything is upserted (created if missing,
              updated in place if it exists). On wide screens they sit side by side. */}
          <div className="grid items-start gap-3 lg:grid-cols-3">
          {section(
            'Function App',
            <>
              <div className="grid grid-cols-2 gap-3">
                {regionSelect('location', 'Region', config.location, (v) => onChange({ location: v }))}
                {textField('resourceGroup', 'Resource group', config.resourceGroup, set('resourceGroup'), {
                  placeholder: 'rg-logingestion',
                  suggested: 'rg-logingestion',
                  prefix: 'rg-',
                })}
              </div>
              {textField('functionAppName', 'Name', config.functionAppName, set('functionAppName'), {
                placeholder: 'func-logingestion',
                prefix: 'func-',
                suggestWhenEmpty: false,
              })}
              <p className="text-xs text-slate-600 dark:text-slate-300">
                The name has no random hash and must be globally unique (it becomes{' '}
                <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">&lt;name&gt;.azurewebsites.net</code>).
                If an app with this name already exists in your subscription, the deploy updates it
                in place after a warning — a zip deploy replaces all functions in that app. If the
                name is taken in another tenant, the deploy stops and asks you to pick a different one.
              </p>
              <div>
                <label className={label} htmlFor="functionPlanType">
                  Hosting plan
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
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  {config.functionPlanType === 'Flex'
                    ? 'Flex: faster cold starts and VNet support, but not available in every region — verify region support.'
                    : 'Consumption: widely available, pay-per-execution. Pick Flex for VNet or reduced cold starts.'}
                </p>
              </div>
            </>,
          )}

          {section(
            'Log Analytics Workspace',
            <>
              <div className="grid grid-cols-2 gap-3">
                {regionSelect(
                  'workspaceLocation',
                  <>
                    Region <span className="text-slate-400">(optional)</span>
                  </>,
                  config.workspaceLocation,
                  (v) => onChange({ workspaceLocation: v }),
                  { required: false, placeholder: 'Same as Function App region' },
                )}
                {textField(
                  'workspaceResourceGroup',
                  <>
                    Resource group <span className="text-slate-400">(optional)</span>
                  </>,
                  config.workspaceResourceGroup,
                  set('workspaceResourceGroup'),
                  { placeholder: 'defaults to Function App RG', required: false, prefix: 'rg-' },
                )}
              </div>
              {textField('workspaceName', 'Name', workspaceName, onWorkspaceChange, {
                placeholder: 'log-logingestion',
                suggested: 'log-logingestion',
                prefix: 'log-',
              })}
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Leave the region blank to create the workspace in the Function App region. An
                existing workspace keeps its current region (it cannot be moved).
              </p>
            </>,
          )}

          {section(
            'Data Collection Rule',
            <>
              <div className="grid grid-cols-2 gap-3">
                {regionReadOnly(
                  'dcrLocation',
                  'Region',
                  config.workspaceLocation || config.location,
                  'Always matches the Log Analytics workspace region.',
                )}
                {textField(
                  'dcrResourceGroup',
                  <>
                    Resource group <span className="text-slate-400">(optional)</span>
                  </>,
                  config.dcrResourceGroup,
                  set('dcrResourceGroup'),
                  { placeholder: 'defaults to Function App RG', required: false, prefix: 'rg-' },
                )}
              </div>
              {textField('dcrName', 'Name', config.dcrName, set('dcrName'), {
                placeholder: 'dcr-logingestion',
                suggested: 'dcr-logingestion',
                prefix: 'dcr-',
              })}
            </>,
          )}
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300">
            Everything is created if missing or updated in place if it already exists. Storage,
            Application Insights and the App Service plan are created in the Function App resource
            group and named after the Function App.
          </p>
        </>
      )}

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
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
          Required. Stamped into the <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">IntuneScriptVersion</code>{' '}
          column (added to every table automatically) so you can tell whether data came from an older
          script or the current one (e.g.{' '}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">where IntuneScriptVersion == "{config.scriptVersion || '1.0.0'}"</code>).
          Bump it whenever you change the script.
        </p>
      </div>

      {errors.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
