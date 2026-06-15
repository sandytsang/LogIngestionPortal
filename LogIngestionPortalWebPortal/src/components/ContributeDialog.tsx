import { useMemo, useState } from 'react';
import { ALLOWED_COLUMN_TYPES, type ColumnType } from '../types';
import { copyText } from '../lib/browser';
import {
  categoriesFolderUrl,
  draftToFieldJson,
  emptyDraft,
  newCategoryPrUrl,
  validateDraft,
  type FieldDraft,
} from '../lib/contribution';

interface Props {
  knownCategories: string[];
  onClose: () => void;
}

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900';
const label = 'block text-xs font-medium text-slate-600 dark:text-slate-300';

export function ContributeDialog({ knownCategories, onClose }: Props) {
  const [draft, setDraft] = useState<FieldDraft>(emptyDraft);
  const [copied, setCopied] = useState(false);
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const valid = errors.length === 0;
  const fieldJson = useMemo(() => (valid ? draftToFieldJson(draft) : ''), [draft, valid]);

  const set = (patch: Partial<FieldDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const categoryExists = knownCategories.some(
    (c) => c.toLowerCase() === draft.category.trim().toLowerCase(),
  );

  const copyJson = async () => {
    if (await copyText(fieldJson)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="my-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold">Contribute a data point</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Share a property and its read-only PowerShell collector with the community.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label} htmlFor="c-category">
                Category
              </label>
              <input
                id="c-category"
                list="known-categories"
                className={`${input} mt-1`}
                value={draft.category}
                onChange={(e) => set({ category: e.target.value })}
                placeholder="Hardware, Network, …"
              />
              <datalist id="known-categories">
                {knownCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={label} htmlFor="c-label">
                Label
              </label>
              <input
                id="c-label"
                className={`${input} mt-1`}
                value={draft.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder="Chassis type"
              />
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div>
              <label className={label} htmlFor="c-colname">
                Column name
              </label>
              <input
                id="c-colname"
                className={`${input} mt-1`}
                value={draft.columnName}
                onChange={(e) => set({ columnName: e.target.value })}
                placeholder="ChassisType"
              />
            </div>
            <div>
              <label className={label} htmlFor="c-type">
                Type
              </label>
              <select
                id="c-type"
                className={`${input} mt-1`}
                value={draft.columnType}
                onChange={(e) => set({ columnType: e.target.value as ColumnType })}
              >
                {ALLOWED_COLUMN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={label} htmlFor="c-desc">
              Description
            </label>
            <input
              id="c-desc"
              className={`${input} mt-1`}
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
              placeholder="What this column holds and where it comes from."
            />
          </div>

          <div>
            <label className={label} htmlFor="c-collector">
              PowerShell collector <span className="text-slate-400">(read-only; returns the value)</span>
            </label>
            <textarea
              id="c-collector"
              rows={4}
              className={`${input} mt-1 font-mono text-xs`}
              value={draft.collector}
              onChange={(e) => set({ collector: e.target.value })}
              placeholder="(Get-CimInstance -ClassName Win32_SystemEnclosure).ChassisTypes -join ','"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={draft.needsSystem}
              onChange={(e) => set({ needsSystem: e.target.checked })}
            />
            Requires SYSTEM/admin context
          </label>

          {errors.length > 0 ? (
            <ul className="space-y-1 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              {errors.map((e) => (
                <li key={e}>• {e}</li>
              ))}
            </ul>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ Passes the read-only security checks
                </span>
                <button
                  onClick={copyJson}
                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {copied ? 'Copied!' : 'Copy field JSON'}
                </button>
              </div>
              <pre className="scroll-thin max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-800">
                <code>{fieldJson}</code>
              </pre>
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-5 py-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
          {categoryExists ? (
            <p>
              <strong>“{draft.category.trim()}” already exists.</strong> Copy the field JSON above and add it
              to that category file, then open a pull request.{' '}
              <a
                className="text-indigo-600 underline dark:text-indigo-400"
                href={categoriesFolderUrl()}
                target="_blank"
                rel="noreferrer"
              >
                Open category files ↗
              </a>
            </p>
          ) : (
            <p>
              New category — you can create the file directly on GitHub (a maintainer reviews it before
              merging).
            </p>
          )}
          <a
            href={valid ? newCategoryPrUrl(draft) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!valid}
            className={`inline-block rounded-lg px-4 py-2 text-sm font-medium text-white ${
              valid ? 'bg-indigo-600 hover:bg-indigo-500' : 'pointer-events-none bg-slate-400'
            }`}
          >
            Create on GitHub ↗
          </a>
        </div>
      </div>
    </div>
  );
}
