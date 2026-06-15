import { useEffect, useMemo, useState } from 'react';
import { catalog } from './data/catalog';
import type { ColumnsDocument, PortalConfig } from './types';
import { CatalogBrowser } from './components/CatalogBrowser';
import { ConfigPanel } from './components/ConfigPanel';
import { OutputTabs, type OutputTab } from './components/OutputTabs';
import { ContributeDialog } from './components/ContributeDialog';
import {
  columnsToJson,
  generateColumns,
  generateDeployCommand,
  generateScript,
  selectedFields,
} from './lib/generators';
import { validateColumns } from './lib/validation';

const STORAGE_KEY = 'logingestion-portal.v1';

const defaultConfig = (): PortalConfig => ({
  functionUrl: 'https://<your-function-app>.azurewebsites.net/api/Ingest?code=<your-function-key>',
  useJwt: true,
  remediationName: 'DeviceInventory',
  tableName: catalog.tableName,
  tableDescription: catalog.description,
});

const defaultSelected = (): Set<string> =>
  new Set(catalog.fields.filter((f) => f.default && !f.locked).map((f) => f.id));

interface Persisted {
  selected?: string[];
  config?: PortalConfig;
  workspaceName?: string;
}

function loadPersisted(): Persisted {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Persisted;
  } catch {
    return {};
  }
}

export default function App() {
  const persisted = useMemo(loadPersisted, []);
  const [selected, setSelected] = useState<Set<string>>(() =>
    persisted.selected ? new Set(persisted.selected) : defaultSelected(),
  );
  const [workspaceName, setWorkspaceName] = useState(persisted.workspaceName ?? '');
  const [importNote, setImportNote] = useState<string | null>(null);
  const [showContribute, setShowContribute] = useState(false);
  const [config, setConfig] = useState<PortalConfig>(() => persisted.config ?? defaultConfig());

  const knownCategories = useMemo(() => [...new Set(catalog.fields.map((f) => f.category))], []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selected: [...selected], config, workspaceName }),
      );
    } catch {
      /* storage unavailable (private mode) — non-fatal */
    }
  }, [selected, config, workspaceName]);


  const fields = useMemo(() => selectedFields(catalog, selected), [selected]);
  const columnsDoc = useMemo<ColumnsDocument>(() => generateColumns(fields, config), [fields, config]);
  const errors = useMemo(() => validateColumns(columnsDoc), [columnsDoc]);

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
        filename: 'remediate.ps1',
        language: 'PowerShell · Proactive Remediation detection script',
        content: generateScript(catalog, fields, config),
      },
      {
        id: 'deploy',
        label: 'Deploy command',
        filename: 'deploy-command.ps1',
        language: 'PowerShell · run locally with your own az/func login',
        content: generateDeployCommand(workspaceName.trim() || undefined),
      },
    ],
    [columnsDoc, fields, config, workspaceName],
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(catalog.fields.filter((f) => !f.locked).map((f) => f.id)));
  const resetDefaults = () => setSelected(defaultSelected());
  const clearAll = () => setSelected(new Set());

  const importColumns = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text()) as ColumnsDocument;
      const names = new Set((doc.columns ?? []).map((c) => c.name));
      const matched = catalog.fields.filter((f) => names.has(f.column.name) && !f.locked);
      const unknown = [...names].filter(
        (n) => n !== 'TimeGenerated' && !catalog.fields.some((f) => f.column.name === n),
      );
      setSelected(new Set(matched.map((f) => f.id)));
      if (doc.tableName) setConfig((c) => ({ ...c, tableName: doc.tableName }));
      if (doc.description) setConfig((c) => ({ ...c, tableDescription: doc.description }));
      setImportNote(
        `Imported ${matched.length} field(s).` +
          (unknown.length ? ` ${unknown.length} column(s) not in the catalog were ignored: ${unknown.join(', ')}.` : ''),
      );
    } catch {
      setImportNote('Could not parse that file as columns.json.');
    }
  };

  const azureButtonUrl =
    'https://portal.azure.com/#blade/Microsoft_Azure_Marketplace_PortalQuickStart/AnonymousCreateBlade';

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
                Pick the device data you want · generate columns.json, the Intune script, and the deploy
                command · runs entirely in your browser
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowContribute(true)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                + Contribute a field
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          {/* Left: catalog */}
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                {columnsDoc.columns.length} columns selected
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
              <label className="ml-auto cursor-pointer text-xs text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
                Import existing columns.json
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && importColumns(e.target.files[0])}
                />
              </label>
            </div>
            {importNote && (
              <p className="mb-4 rounded-lg border border-sky-300 bg-sky-50 p-2 text-xs text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-300">
                {importNote}
              </p>
            )}
            <CatalogBrowser catalog={catalog} selected={selected} onToggle={toggle} />
          </div>

          {/* Right: config + output (sticky) */}
          <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]">
            <div className="flex h-full flex-col gap-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <h2 className="mb-3 text-sm font-semibold">Configuration</h2>
                <ConfigPanel
                  config={config}
                  onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
                  workspaceName={workspaceName}
                  onWorkspaceChange={setWorkspaceName}
                  errors={errors}
                />
              </div>

              <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <OutputTabs tabs={tabs} />
              </div>

              <a
                href={azureButtonUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-500 shadow-sm hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                title="Opens the Azure portal in your own tenant. Deploys infrastructure only — publish the Function code locally with func."
              >
                Optional: open Azure portal to deploy infrastructure in <strong>your</strong> tenant ↗
              </a>
            </div>
          </div>
        </main>

        <footer className="mx-auto max-w-7xl px-4 pb-8 text-center text-xs text-slate-400">
          100% client-side · no sign-in, no backend, no data leaves your browser · generates artifacts for the
          LogIngestionAPI solution.
        </footer>

        {showContribute && (
          <ContributeDialog knownCategories={knownCategories} onClose={() => setShowContribute(false)} />
        )}
      </div>
  );
}
