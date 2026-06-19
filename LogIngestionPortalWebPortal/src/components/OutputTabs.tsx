import { useState } from 'react';
import { createZip, downloadBlob, type ZipEntry } from '../lib/zip';

export interface OutputTab {
  id: string;
  label: string;
  filename: string;
  language: string;
  content: string;
}

interface Props {
  tabs: OutputTab[];
  /**
   * Optional full set of files for "Download all" (e.g. the whole LogIngestionAPI
   * backend plus the generated files). Falls back to the visible tabs when omitted.
   */
  bundle?: ZipEntry[];
  downloadDisabled?: boolean;
  /** Labels of the still-missing required fields, shown next to a disabled button. */
  missingFields?: string[];
}

export function OutputTabs({ tabs, bundle, downloadDisabled = false, missingFields = [] }: Props) {
  const [active, setActive] = useState(tabs[0]?.id ?? '');
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  if (!current) return null;

  const onDownloadZip = () => {
    const entries = bundle ?? tabs.map((t) => ({ name: t.filename, content: t.content }));
    const zip = createZip(entries);
    downloadBlob('logingestion-bundle.zip', zip);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800">
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`rounded-t-lg px-3 py-2 text-sm font-medium transition ${
                t.id === current.id
                  ? 'btn-accent'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pb-1">
          {downloadDisabled && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {missingFields.length > 0
                ? `Fill required: ${missingFields.join(', ')}`
                : 'Fill all required fields before downloading.'}
            </span>
          )}
          <button
            type="button"
            disabled={downloadDisabled}
            onClick={onDownloadZip}
            title={downloadDisabled ? 'Fill all required fields before downloading the zip.' : undefined}
            className={`rounded-md px-2.5 py-1 text-sm font-medium transition ${
              downloadDisabled
                ? 'cursor-not-allowed border border-slate-300 bg-slate-200 text-slate-400 opacity-80 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                : 'btn-accent'
            }`}
          >
            Download all (.zip)
          </button>
        </div>
      </div>
      <pre className="scroll-thin min-h-0 flex-1 overflow-auto rounded-b-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
        <code>{current.content}</code>
      </pre>
      <p className="mt-1 text-xs text-slate-400">
        {current.filename} · {current.language}
      </p>
    </div>
  );
}
