import { useEffect, useMemo, useRef, useState } from 'react';
import { catalog } from './data/catalog';
import { apiFiles } from './data/apiFiles';
import type { CatalogField, MultiTableColumnsDocument, PortalConfig, TableConfig } from './types';
import type { ZipEntry } from './lib/zip';
import { CatalogBrowser } from './components/CatalogBrowser';
import { ConfigPanel } from './components/ConfigPanel';
import { TablesPanel } from './components/TablesPanel';
import { OutputTabs, type OutputTab } from './components/OutputTabs';
import { ContributeDialog } from './components/ContributeDialog';
import { SampleColumnsDialog } from './components/SampleColumnsDialog';
import { DeployHelp } from './components/DeployHelp';
import { applyTheme, DEFAULT_THEME_ID } from './lib/theme';
import {
  columnsToJson,
  generateColumns,
  generateDeployReadme,
  generateScripts,
  generateWorkflowYaml,
} from './lib/generators';
import { getRequiredFieldWarnings, validateColumns, validatePortalConfig } from './lib/validation';
import { colorTokenForIndex } from './lib/tableColors';

const STORAGE_KEY = 'logingestion-portal.v7';
const LEGACY_KEY = 'logingestion-portal.v6';

const defaultConfig = (): PortalConfig => ({
  functionUrl: 'https://<your-function-app>.azurewebsites.net/api/DCRLogIngestionAPI?code=<your-function-key>',
  scriptVersion: '1.0.0',
  action: 'deploy',
  resourceGroup: '',
  functionAppName: '',
  dcrResourceGroup: '',
  dcrName: '',
  workspaceResourceGroup: '',
  location: '',
  workspaceLocation: '',
  functionPlanType: 'Flex',
});

const newTableId = (): string => `t-${Math.random().toString(36).slice(2, 9)}`;

// Default script (schedule) group most tables belong to. Tables sharing a group
// are collected by one generated Intune script; different groups become separate
// scripts so they can run on different Proactive Remediation schedules.
const DEFAULT_SCRIPT_GROUP = 'DeviceDaily';

// Topic categories that get their own table; everything else (Identity aside)
// lands in Devices_CL.
const CATEGORY_TABLE: Record<string, string> = {
  'Windows Update': 'WindowsUpdate_CL',
  'Delivery Optimization': 'DeliveryOptimization_CL',
  'Secure Boot': 'SecureBoot_CL',
};
// Per-item datasets (fields with an element schema) each get a one-row-per-item
// table; map the field id to a friendly table name.
const PER_ITEM_TABLE: Record<string, string> = {
  Drivers: 'Drivers_CL',
  Hotfixes: 'Hotfixes_CL',
  DeliveryOptimizationContentStats: 'DeliveryOptimizationContentStats_CL',
  AppLockerEvents: 'AppLockerEvents_CL',
};
const TABLE_DESCRIPTION: Record<string, string> = {
  Devices_CL: 'Device hardware, operating system, security and inventory.',
  WindowsUpdate_CL: 'Windows Update settings, diagnostic data and telemetry upload status.',
  DeliveryOptimization_CL: 'Delivery Optimization settings, config and performance stats.',
  SecureBoot_CL: 'Secure Boot 2023 certificate update status.',
  Drivers_CL: 'Installed device drivers (non-Microsoft).',
  Hotfixes_CL: 'Installed Windows hotfixes (QFE).',
  DeliveryOptimizationContentStats_CL: 'Delivery Optimization content download status.',
  AppLockerEvents_CL: 'AppLocker audited (would-have-blocked) and denied execution events.',
};

// The portal starts with EVERY catalog field selected, auto-grouped into tables:
// the device-level fields are bucketed by topic (Identity columns added to every
// table so each can be correlated to the device), and each per-item dataset
// (drivers, hotfixes, DO content) gets its own one-row-per-item table.
const defaultTables = (): TableConfig[] => {
  const nonLocked = catalog.fields.filter((f) => !f.locked);
  const isPerItem = (f: CatalogField) => Boolean(f.element && f.element.length);

  // Bucket non-per-item fields by topic table. Identity columns are locked, so
  // they are added to every table automatically (no need to list them here).
  const buckets = new Map<string, string[]>();
  for (const f of nonLocked) {
    if (isPerItem(f)) continue;
    const name = CATEGORY_TABLE[f.category] ?? 'Devices_CL';
    buckets.set(name, [...(buckets.get(name) ?? []), f.id]);
  }

  const tables: TableConfig[] = [];
  for (const name of ['Devices_CL', 'WindowsUpdate_CL', 'DeliveryOptimization_CL', 'SecureBoot_CL']) {
    const ids = buckets.get(name);
    if (!ids?.length) continue;
    tables.push({
      id: newTableId(),
      name,
      description: TABLE_DESCRIPTION[name] ?? '',
      fieldIds: [...ids],
      scriptName: DEFAULT_SCRIPT_GROUP,
    });
  }
  // One row-per-item table per per-item dataset. AppLocker events are noisy and
  // get flushed quickly, so they default to their own (hourly) script group;
  // the rest join the daily device script.
  for (const f of nonLocked.filter(isPerItem)) {
    const name = PER_ITEM_TABLE[f.id] ?? `${f.id}_CL`;
    tables.push({
      id: newTableId(),
      name,
      description: TABLE_DESCRIPTION[name] ?? f.label,
      fieldIds: [f.id],
      scriptName: name === 'AppLockerEvents_CL' ? 'AppLockerHourly' : DEFAULT_SCRIPT_GROUP,
    });
  }
  // Give each table a distinct default color (cosmetic only) so the many tables
  // are easy to tell apart; users can override per table.
  return tables.map((t, i) => ({ ...t, color: colorTokenForIndex(i) }));
};

interface Persisted {
  tables?: TableConfig[];
  config?: PortalConfig;
  workspaceName?: string;
}

interface PortalConfigExportV1 {
  format: 'LogIngestionPortalConfig';
  version: 1;
  exportedAtUtc: string;
  workspaceName: string;
  config: PortalConfig;
  tables: TableConfig[];
}

function isPortalConfigExportV1(value: unknown): value is PortalConfigExportV1 {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PortalConfigExportV1>;
  return (
    v.format === 'LogIngestionPortalConfig' &&
    v.version === 1 &&
    typeof v.workspaceName === 'string' &&
    !!v.config &&
    !!v.tables &&
    Array.isArray(v.tables)
  );
}

function normalizeImportedTables(raw: TableConfig[]): TableConfig[] {
  // Ensure stable ids and required strings even when importing older exports.
  const seen = new Set<string>();
  const list = raw.map((t, i) => {
    const id = (t.id && !seen.has(t.id)) ? t.id : newTableId();
    seen.add(id);
    return {
      ...t,
      id,
      name: (t.name ?? '').trim(),
      description: t.description ?? '',
      fieldIds: Array.isArray(t.fieldIds) ? t.fieldIds : [],
      scriptName: t.scriptName ?? DEFAULT_SCRIPT_GROUP,
      color: t.color ?? colorTokenForIndex(i),
    };
  });
  return list.filter((t) => t.name.length > 0);
}

function loadPersisted(): Persisted {
  // Settings are kept in sessionStorage only, so they survive a page reload but
  // are cleared when the browser/tab is closed. Purge any values left in
  // localStorage by older builds so stale settings can't reappear.
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage unavailable — ignore */
  }
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved) as Persisted;
  } catch {
    /* storage unavailable — fall through to defaults */
  }
  return {};
}

export default function App() {
  const persisted = useMemo(loadPersisted, []);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [tables, setTables] = useState<TableConfig[]>(() =>
    persisted.tables && persisted.tables.length ? persisted.tables : defaultTables(),
  );
  const [workspaceName, setWorkspaceName] = useState(persisted.workspaceName ?? '');
  const [showContribute, setShowContribute] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [config, setConfig] = useState<PortalConfig>(() => ({ ...defaultConfig(), ...(persisted.config ?? {}) }));

  const knownCategories = useMemo(
    () => [...new Set(catalog.fields.filter((f) => !f.locked).map((f) => f.category))],
    [],
  );

  // Apply the fixed enterprise theme CSS variables to <html>.
  useEffect(() => {
    applyTheme(DEFAULT_THEME_ID);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ tables, config, workspaceName }),
      );
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  }, [tables, config, workspaceName]);

  const columnsDoc = useMemo<MultiTableColumnsDocument>(
    () => generateColumns(catalog, tables),
    [tables],
  );
  const errors = useMemo(() => {
    const schemaErrors = validateColumns(columnsDoc);
    const configErrors = validatePortalConfig(config);
    return [...schemaErrors, ...configErrors];
  }, [columnsDoc, config]);

  const requiredWarnings = useMemo(
    () => getRequiredFieldWarnings(config, tables, workspaceName),
    [config, tables, workspaceName],
  );
  const canDownloadZip = requiredWarnings.length === 0;

  // Distinct (non-locked) fields assigned to at least one table.
  const selectedCount = useMemo(() => new Set(tables.flatMap((t) => t.fieldIds)).size, [tables]);

  // One detection script per schedule group (tables sharing a scriptName). All
  // scripts post to the same Function and share the one DCR/columns.json.
  const scripts = useMemo(
    () => generateScripts(catalog, tables, config),
    [tables, config],
  );

  const exportedPortalConfig = useMemo<PortalConfigExportV1>(() => ({
    format: 'LogIngestionPortalConfig',
    version: 1,
    exportedAtUtc: new Date().toISOString(),
    workspaceName,
    config,
    tables,
  }), [workspaceName, config, tables]);

  const exportedPortalConfigJson = useMemo(
    () => JSON.stringify(exportedPortalConfig, null, 2) + '\n',
    [exportedPortalConfig],
  );

  const tabs = useMemo<OutputTab[]>(
    () => [
      {
        id: 'columns',
        label: 'columns.json',
        filename: 'columns.json',
        language: 'JSON · schema/columns.json',
        content: columnsToJson(columnsDoc),
      },
      ...scripts.map((s) => ({
        id: `script:${s.filename}`,
        label: scripts.length > 1 ? (s.scriptName || 'Default script') : 'Intune script',
        filename: s.filename,
        language: `PowerShell · Proactive Remediation detection script${
          s.scriptName ? ` · ${s.scriptName}` : ''
        }`,
        content: s.content,
      })),
      {
        id: 'deploy',
        label: 'README.txt',
        filename: 'README.txt',
        language: 'Text · how to deploy with these files',
        content: generateDeployReadme(
          config,
          tables,
          workspaceName.trim() || undefined,
        ),
      },
      {
        id: 'portal-config',
        label: 'portal-config.json',
        filename: 'portal-config.json',
        language: 'JSON · reusable portal configuration export',
        content: exportedPortalConfigJson,
      },
    ],
    [columnsDoc, scripts, tables, config, workspaceName, exportedPortalConfigJson],
  );

  // The full "Download all" bundle: the entire LogIngestionAPI backend plus the
  // user's generated files dropped into the exact paths deploy.ps1 expects, so
  // the unzipped folder is ready to deploy as-is. The portal writes its own
  // README.txt (deploy guide for this selection) into the folder, so the repo's
  // generic README.md is left out to avoid two competing readmes.
  const bundleFiles = useMemo<ZipEntry[]>(() => {
    const byId = Object.fromEntries(tabs.map((t) => [t.id, t.content]));
    const overrides: Record<string, string> = {
      'LogIngestionAPI/schema/columns.json': byId.columns,
      'LogIngestionAPI/portal-config.json': byId['portal-config'],
    };
    // Emit one detection script per schedule group at its own path. The stock
    // example scripts/IntuneScript.ps1 is excluded (below) unless a group maps
    // back to that exact name, so the bundle reflects the chosen grouping.
    const scriptPaths = new Set<string>();
    for (const s of scripts) {
      const path = `LogIngestionAPI/scripts/${s.filename}`;
      overrides[path] = s.content;
      scriptPaths.add(path);
    }
    // Only touch the workflow that matches the chosen action, and leave the
    // other one OUT of the bundle entirely. That way pushing an "update columns"
    // zip can't overwrite a deploy.yml you've already customized (and vice
    // versa). Pre-fill the active workflow's "Run workflow" defaults from the
    // portal selections so you don't have to retype them.
    const deployWorkflow = 'LogIngestionAPI/.github/workflows/deploy.yml';
    const updateWorkflow = 'LogIngestionAPI/.github/workflows/update-columns.yml';
    const activeWorkflow = config.action === 'updateColumns' ? updateWorkflow : deployWorkflow;
    const inactiveWorkflow = config.action === 'updateColumns' ? deployWorkflow : updateWorkflow;
    const baseWorkflow = apiFiles.find((f) => f.name === activeWorkflow)?.content;
    if (baseWorkflow) {
      overrides[activeWorkflow] = generateWorkflowYaml(baseWorkflow, config, workspaceName);
    }
    const exclude = new Set(['LogIngestionAPI/README.md', inactiveWorkflow]);
    // Drop the stock example script unless a generated group reuses that exact
    // file name (so we don't ship both the example and the generated scripts).
    if (!scriptPaths.has('LogIngestionAPI/scripts/IntuneScript.ps1')) {
      exclude.add('LogIngestionAPI/scripts/IntuneScript.ps1');
    }
    const files: ZipEntry[] = apiFiles
      .filter((f) => !exclude.has(f.name))
      .map((f) => ({ name: f.name, content: overrides[f.name] ?? f.content }));
    if (byId.deploy) files.push({ name: 'LogIngestionAPI/README.txt', content: byId.deploy });
    // Add generated script files that aren't already part of apiFiles (named
    // groups like IntuneScript-AppLockerHourly.ps1 are new paths).
    const known = new Set(files.map((f) => f.name));
    for (const path of scriptPaths) {
      if (!known.has(path)) files.push({ name: path, content: overrides[path] });
    }
    const portalConfigPath = 'LogIngestionAPI/portal-config.json';
    if (!known.has(portalConfigPath)) {
      files.push({ name: portalConfigPath, content: byId['portal-config'] });
    }
    return files;
  }, [tabs, scripts, config, workspaceName]);

  // --- Field <-> table assignment -------------------------------------------
  const toggleAssignment = (fieldId: string, tableId: string) =>
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== tableId) return t;
        const has = t.fieldIds.includes(fieldId);
        return {
          ...t,
          fieldIds: has ? t.fieldIds.filter((id) => id !== fieldId) : [...t.fieldIds, fieldId],
        };
      }),
    );

  const setManyForTable = (fieldIds: string[], tableId: string, select: boolean) =>
    setTables((prev) =>
      prev.map((t) => {
        if (t.id !== tableId) return t;
        const next = new Set(t.fieldIds);
        for (const id of fieldIds) {
          if (select) next.add(id);
          else next.delete(id);
        }
        return { ...t, fieldIds: [...next] };
      }),
    );

  const allNonLockedIds = useMemo(
    () => catalog.fields.filter((f) => !f.locked).map((f) => f.id),
    [],
  );
  const selectAll = () =>
    setTables((prev) => prev.map((t) => ({ ...t, fieldIds: [...allNonLockedIds] })));
  const clearAll = () => setTables((prev) => prev.map((t) => ({ ...t, fieldIds: [] })));
  const resetDefaults = () => setTables(defaultTables());

  const onImportPortalConfigClick = () => importFileRef.current?.click();

  const onImportPortalConfigFile: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      if (!isPortalConfigExportV1(parsed)) {
        throw new Error('File is not a valid portal configuration export (expected format/version).');
      }
      const importedTables = normalizeImportedTables(parsed.tables);
      if (importedTables.length === 0) {
        throw new Error('Imported configuration has no valid tables.');
      }
      const schemaErrors = validateColumns(generateColumns(catalog, importedTables));
      const configErrors = validatePortalConfig(parsed.config);
      const combined = [...schemaErrors, ...configErrors];
      if (combined.length > 0) {
        throw new Error(`Imported configuration is invalid: ${combined[0]}`);
      }
      setTables(importedTables);
      setConfig({ ...defaultConfig(), ...parsed.config });
      setWorkspaceName(parsed.workspaceName ?? '');
      window.alert('Configuration imported successfully.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown import error.';
      window.alert(`Import failed: ${msg}`);
    } finally {
      event.currentTarget.value = '';
    }
  };

  // --- Table (box) CRUD ------------------------------------------------------
  const addTable = () =>
    setTables((prev) => [
      ...prev,
      {
        id: newTableId(),
        name: `Table${prev.length + 1}_CL`,
        description: '',
        fieldIds: [],
        scriptName: DEFAULT_SCRIPT_GROUP,
        color: colorTokenForIndex(prev.length),
      },
    ]);
  const removeTable = (id: string) =>
    setTables((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev));
  const updateTable = (id: string, patch: Partial<TableConfig>) =>
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));


  return (
    <div className="min-h-screen app-shell text-slate-900">
      {/* Header */}
      <header className="app-header shadow-md">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4 px-4 sm:px-6 py-4">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                <span className="inline-block h-3 w-3 rounded-sm bg-accent" />
                Log Ingestion Portal
              </h1>
              <p className="app-subtitle mt-1 text-sm">
                Pick the device data you want · download columns.json, the Intune script, and a deploy
                README as one zip · runs entirely in your browser
              </p>
              <p className="app-subtitle mt-1 text-sm">
                <a
                  href="https://github.com/sandytsang/LogIngestionPortal"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium app-link"
                >
                  GitHub repo
                </a>
                {' · '}
                <a
                  href="https://github.com/sandytsang/LogIngestionPortal/blob/main/docs/README.md"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium app-link"
                >
                  Documentation
                </a>
                {' · '}
                <a
                  href="https://github.com/sandytsang/LogIngestionPortal/blob/main/LogIngestionAPI/docs/device-jwt-authentication.md"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium app-link"
                >
                  Device auth (JWT)
                </a>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onImportPortalConfigFile}
              />
              <button
                onClick={onImportPortalConfigClick}
                className="btn-header-outline rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              >
                Import config
              </button>
              <button
                onClick={() => setShowSample(true)}
                className="btn-header-outline rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
              >
                Build columns.json from data
              </button>
              <button
                onClick={() => setShowContribute(true)}
                className="btn-accent rounded-lg px-3 py-1.5 text-sm font-semibold shadow-sm transition-colors"
              >
                + Contribute a field
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 py-6">
          {/* 1. Azure Resource Configuration — full width */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-4 flex items-center gap-2 text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">
              <span className="h-4 w-1 rounded bg-accent" />
              Step 1: Azure Resource Configuration
            </h2>
            <ConfigPanel
              config={config}
              onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
              tables={tables}
              workspaceName={workspaceName}
              onWorkspaceChange={setWorkspaceName}
              errors={errors}
            />
          </section>

          {/* 2. Tables (1/3) + Categories (2/3) */}
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Left: tables (1/3, sticky) */}
            <div className="lg:col-span-1 lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
              <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-3 flex items-center gap-2 text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">
                  <span className="h-4 w-1 rounded bg-accent" />
                  Step 2: Create or Change Tables
                </h2>
                <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                  Build the table set, then place fields into the right tables.
                </p>
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
                  <TablesPanel
                    tables={tables}
                    onAddTable={addTable}
                    onRemoveTable={removeTable}
                    onUpdateTable={updateTable}
                  />
                </div>
              </div>
            </div>

            {/* Right: catalog (2/3) */}
            <div className="lg:col-span-2">
              <div className="mb-2">
                <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">
                  <span className="h-4 w-1 rounded bg-accent" />
                  Step 3: Select Category and properties to the table
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Pick the categories and properties you want each table to collect.
                </p>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="badge-accent rounded-full px-3 py-1 text-sm font-semibold">
                  {selectedCount} {selectedCount === 1 ? 'field' : 'fields'} selected · {tables.length}{' '}
                  {tables.length === 1 ? 'table' : 'tables'}
                </span>
                <button onClick={resetDefaults} className="text-sm text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
                  Reset to defaults
                </button>
                <button onClick={selectAll} className="text-sm text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
                  Select all
                </button>
                <button onClick={clearAll} className="text-sm text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
                  Clear
                </button>
              </div>
              <CatalogBrowser
                catalog={catalog}
                tables={tables}
                onToggleAssignment={toggleAssignment}
                onSetManyForTable={setManyForTable}
              />
            </div>
          </div>

          {/* 4. Review and download */}
          <div className="mt-6 flex h-128 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">
              <span className="h-4 w-1 rounded bg-accent" />
              Step 4: Review and Download the ready deploy Zip file
            </h2>
            <OutputTabs tabs={tabs} bundle={bundleFiles} downloadDisabled={!canDownloadZip} missingFields={requiredWarnings} />
          </div>

          {/* How-to-deploy guidance for the downloaded zip */}
          <DeployHelp />
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-8 text-center text-sm text-slate-400">
          100% client-side · no sign-in, no backend, no data leaves your browser · generates artifacts for the
          LogIngestionAPI solution.
          <br />
          <span className="inline-flex items-center gap-1.5">
            Author: Sandy Zeng
            <a
              href="https://www.linkedin.com/in/sandy-tsang/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Sandy Zeng on LinkedIn"
              title="Sandy Zeng | LinkedIn"
              className="text-[#0a66c2] transition-colors hover:text-[#004182]"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
              </svg>
            </a>
          </span>
        </footer>

        {showContribute && (
          <ContributeDialog knownCategories={knownCategories} onClose={() => setShowContribute(false)} />
        )}

        {showSample && (
          <SampleColumnsDialog
            tableName={tables[0]?.name ?? catalog.tableName}
            tableDescription={tables[0]?.description ?? catalog.description}
            onClose={() => setShowSample(false)}
          />
        )}
      </div>
  );
}
