import { useEffect, useMemo, useState } from 'react';
import { catalog } from './data/catalog';
import { apiFiles } from './data/apiFiles';
import type { MultiTableColumnsDocument, PortalConfig, TableConfig } from './types';
import type { ZipEntry } from './lib/zip';
import { CatalogBrowser } from './components/CatalogBrowser';
import { ConfigPanel } from './components/ConfigPanel';
import { OutputTabs, type OutputTab } from './components/OutputTabs';
import { ContributeDialog } from './components/ContributeDialog';
import { SampleColumnsDialog } from './components/SampleColumnsDialog';
import { DeployHelp } from './components/DeployHelp';
import {
  columnsToJson,
  generateColumns,
  generateDeployReadme,
  generateScript,
  generateWorkflowYaml,
} from './lib/generators';
import { validateColumns } from './lib/validation';

const STORAGE_KEY = 'logingestion-portal.v5';
const LEGACY_KEY = 'logingestion-portal.v4';

const defaultConfig = (): PortalConfig => ({
  functionUrl: 'https://<your-function-app>.azurewebsites.net/api/DCRLogIngestionAPI?code=<your-function-key>',
  scriptVersion: '1.0.0',
  action: 'deploy',
  scenario: 'new',
  baseName: '',
  environment: 'dev',
  functionResourceGroup: '',
  dcrResourceGroup: '',
  dcrName: '',
  existingWorkspaceResourceGroup: '',
  location: '',
  functionPlanType: 'Consumption',
});

const newTableId = (): string => `t-${Math.random().toString(36).slice(2, 9)}`;

const defaultFieldIds = (): string[] =>
  catalog.fields.filter((f) => f.default && !f.locked).map((f) => f.id);

/** Non-locked catalog field ids belonging to any of the given categories. */
const categoryFieldIds = (categories: string[]): string[] =>
  catalog.fields
    .filter((f) => !f.locked && categories.includes(f.category))
    .map((f) => f.id);

// The portal starts with three tables: the standard device-inventory table (the
// catalog defaults), plus dedicated WindowsUpdate_CL and SecureBoot_CL tables
// preselected with their category fields (and Identity) so each topic lands in
// its own table while still carrying the device-identity columns to correlate on.
const defaultTables = (): TableConfig[] => [
  {
    id: newTableId(),
    name: catalog.tableName,
    description: catalog.description,
    fieldIds: defaultFieldIds(),
  },
  {
    id: newTableId(),
    name: 'WindowsUpdate_CL',
    description: 'Windows Update, diagnostic data and telemetry upload status, with device identity.',
    fieldIds: categoryFieldIds(['Identity', 'Windows Update']),
  },
  {
    id: newTableId(),
    name: 'SecureBoot_CL',
    description: 'Secure Boot 2023 certificate update status, with device identity.',
    fieldIds: categoryFieldIds(['Identity', 'Secure Boot']),
  },
];

interface Persisted {
  tables?: TableConfig[];
  config?: PortalConfig;
  workspaceName?: string;
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
  const [tables, setTables] = useState<TableConfig[]>(() =>
    persisted.tables && persisted.tables.length ? persisted.tables : defaultTables(),
  );
  const [workspaceName, setWorkspaceName] = useState(persisted.workspaceName ?? '');
  const [showContribute, setShowContribute] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [config, setConfig] = useState<PortalConfig>(() => persisted.config ?? defaultConfig());

  const knownCategories = useMemo(
    () => [...new Set(catalog.fields.filter((f) => !f.locked).map((f) => f.category))],
    [],
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tables, config, workspaceName }));
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  }, [tables, config, workspaceName]);

  const columnsDoc = useMemo<MultiTableColumnsDocument>(
    () => generateColumns(catalog, tables),
    [tables],
  );
  const errors = useMemo(() => validateColumns(columnsDoc), [columnsDoc]);

  // Distinct (non-locked) fields assigned to at least one table.
  const selectedCount = useMemo(() => new Set(tables.flatMap((t) => t.fieldIds)).size, [tables]);

  const tabs = useMemo<OutputTab[]>(
    () => [
      {
        id: 'columns',
        label: 'columns.json',
        filename: 'columns.json',
        language: 'JSON · schema/columns.json',
        content: columnsToJson(columnsDoc),
      },
      {
        id: 'script',
        label: 'Intune script',
        filename: 'IntuneScript.ps1',
        language: 'PowerShell · Proactive Remediation detection script',
        content: generateScript(catalog, tables, config),
      },
      {
        id: 'deploy',
        label: 'README.txt',
        filename: 'README.txt',
        language: 'Text · how to deploy with these files',
        content: generateDeployReadme(
          config,
          tables,
          config.action === 'updateColumns' || config.scenario === 'existing'
            ? workspaceName.trim() || undefined
            : undefined,
        ),
      },
    ],
    [columnsDoc, tables, config, workspaceName],
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
      'LogIngestionAPI/scripts/IntuneScript.ps1': byId.script,
    };
    // Pre-fill the GitHub Actions "Run workflow" form with the portal selections
    // so users who push the zip to their own repo don't have to retype them.
    // Both workflows ship in the bundle (full deploy + schema-only), so pre-fill
    // whichever one the user ends up running.
    const workflowPaths = [
      'LogIngestionAPI/.github/workflows/deploy.yml',
      'LogIngestionAPI/.github/workflows/update-columns.yml',
    ];
    for (const workflowPath of workflowPaths) {
      const baseWorkflow = apiFiles.find((f) => f.name === workflowPath)?.content;
      if (baseWorkflow) {
        overrides[workflowPath] = generateWorkflowYaml(baseWorkflow, config, workspaceName);
      }
    }
    const exclude = new Set(['LogIngestionAPI/README.md']);
    const files: ZipEntry[] = apiFiles
      .filter((f) => !exclude.has(f.name))
      .map((f) => ({ name: f.name, content: overrides[f.name] ?? f.content }));
    if (byId.deploy) files.push({ name: 'LogIngestionAPI/README.txt', content: byId.deploy });
    return files;
  }, [tabs, config, workspaceName]);

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

  // --- Table (box) CRUD ------------------------------------------------------
  const addTable = () =>
    setTables((prev) => [
      ...prev,
      { id: newTableId(), name: `Table${prev.length + 1}_CL`, description: '', fieldIds: [] },
    ]);
  const removeTable = (id: string) =>
    setTables((prev) => (prev.length > 1 ? prev.filter((t) => t.id !== id) : prev));
  const updateTable = (id: string, patch: Partial<TableConfig>) =>
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));


  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
            <div>
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                Log Ingestion Portal
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pick the device data you want · download columns.json, the Intune script, and a deploy
                README as one zip · runs entirely in your browser
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSample(true)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Build columns.json from data
              </button>
              <button
                onClick={() => setShowContribute(true)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                + Contribute a field
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
            {/* Left: catalog */}
            <div>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                  {selectedCount} {selectedCount === 1 ? 'field' : 'fields'} selected · {tables.length}{' '}
                  {tables.length === 1 ? 'table' : 'tables'}
                </span>
                <button onClick={resetDefaults} className="text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
                  Reset to defaults
                </button>
                <button onClick={selectAll} className="text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
                  Select all
                </button>
                <button onClick={clearAll} className="text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
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

            {/* Right: configuration (sticky, full column height) */}
            <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
              <div className="flex h-full min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-3 shrink-0 text-sm font-semibold">Configuration</h2>
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
                  <ConfigPanel
                    config={config}
                    onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
                    tables={tables}
                    onAddTable={addTable}
                    onRemoveTable={removeTable}
                    onUpdateTable={updateTable}
                    workspaceName={workspaceName}
                    onWorkspaceChange={setWorkspaceName}
                    errors={errors}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Output: full width under the catalog + configuration */}
          <div className="mt-6 flex h-128 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <OutputTabs tabs={tabs} bundle={bundleFiles} />
          </div>

          {/* How-to-deploy guidance for the downloaded zip */}
          <DeployHelp />
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-8 text-center text-xs text-slate-400">
          100% client-side · no sign-in, no backend, no data leaves your browser · generates artifacts for the
          LogIngestionAPI solution.
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
