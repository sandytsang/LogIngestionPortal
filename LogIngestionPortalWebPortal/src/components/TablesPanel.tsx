import type { TableConfig } from '../types';
import { catalog } from '../data/catalog';
import { rowSourceField } from '../lib/generators';
import { tableColor } from '../lib/tableColors';

interface Props {
  tables: TableConfig[];
  onAddTable: () => void;
  onRemoveTable: (id: string) => void;
  onUpdateTable: (id: string, patch: Partial<TableConfig>) => void;
}

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus-accent dark:border-slate-700 dark:bg-slate-900';
const label = 'block text-sm font-medium text-slate-600 dark:text-slate-300';
const requiredRing =
  'border-rose-400 bg-rose-50/60 focus:border-rose-500 focus:ring-rose-500/30 dark:border-rose-500/60 dark:bg-rose-500/10';

const isBlank = (value?: string): boolean => (value ?? '').trim() === '';

/**
 * The table editor: create/rename/remove custom tables, assign each to a script
 * (schedule) group, and pick a color. Fields are assigned to tables from the
 * catalog on the left; locked columns (TimeGenerated, IntuneScriptVersion,
 * identity) are added to every table automatically.
 */
export function TablesPanel({ tables, onAddTable, onRemoveTable, onUpdateTable }: Props) {
  // Distinct script (schedule) group names, for the datalist suggestions.
  const scriptGroups = [
    ...new Set(tables.map((t) => (t.scriptName ?? '').trim()).filter(Boolean)),
  ];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className={label}>
          Tables <span className="text-slate-400">({tables.length})</span>
        </span>
        <button
          type="button"
          onClick={onAddTable}
          className="btn-accent-outline rounded-md px-2 py-1 text-sm font-medium"
        >
          + Add table
        </button>
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-300">
        Each table becomes its own custom Log Analytics table (must end in
        <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800">_CL</code>) and DCR
        stream. Assign fields to tables in the catalog on the left. TimeGenerated,
        IntuneScriptVersion and the device identity columns (DeviceName, Entra/Intune ids) are added
        to every table automatically.
      </p>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
        <span className="font-semibold">Script (schedule group):</span> tables that share a script
        name are collected by one generated Intune script, so they run on one schedule. Give a table
        a different script name to collect it separately — e.g. noisy AppLocker events hourly while
        everything else runs daily. All scripts share the single DCR.
      </p>
      <datalist id="script-groups">
        {scriptGroups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <div className="mt-2 space-y-2">
        {tables.map((t, i) => {
          // A table automatically becomes "one row per item" when a per-item
          // field (e.g. installed drivers/hotfixes) is assigned to it.
          const rs = rowSourceField(catalog, t);
          const perItemCount = t.fieldIds.filter((id) => {
            const f = catalog.fields.find((x) => x.id === id);
            return Boolean(f?.element && f.element.length);
          }).length;
          // Device-level (non per-item) fields assigned alongside a per-item row
          // source get duplicated onto EVERY item row. Identity columns are
          // locked and never stored in fieldIds, so anything here is a real
          // device-level field that bloats the table.
          const duplicatedFields = rs
            ? t.fieldIds
                .map((id) => catalog.fields.find((x) => x.id === id))
                .filter((f): f is NonNullable<typeof f> => Boolean(f) && f!.id !== rs.id)
                .filter((f) => !(f.element && f.element.length))
            : [];
          return (
            <div
              key={t.id}
              className={`rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40 ${tableColor(t.color, i).boxAccent}`}
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
                  className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700"
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
              <div className="mt-2">
                <label
                  className="block text-xs font-medium text-slate-600 dark:text-slate-300"
                  htmlFor={`scriptGroup-${t.id}`}
                >
                  Intune script (schedule group)
                </label>
                <input
                  id={`scriptGroup-${t.id}`}
                  className={`${field} mt-1`}
                  value={t.scriptName ?? ''}
                  onChange={(e) => onUpdateTable(t.id, { scriptName: e.target.value })}
                  placeholder="DeviceDaily"
                  list="script-groups"
                  aria-label={`Table ${i + 1} script group`}
                />
              </div>
              {rs && perItemCount > 1 && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Only one per-item dataset per table — using {rs.label}.
                </p>
              )}
              {rs && duplicatedFields.length > 0 && (
                <div
                  role="alert"
                  className="mt-2 flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <span aria-hidden className="text-base leading-none">⚠️</span>
                  <div>
                    <p className="font-semibold">
                      This table expands to one row per {rs.label}.
                    </p>
                    <p className="mt-1">
                      The {duplicatedFields.length} device-level{' '}
                      {duplicatedFields.length === 1 ? 'field' : 'fields'} you added (
                      {duplicatedFields.map((f) => f.label).join(', ')}) will be{' '}
                      <span className="font-semibold">copied onto every item row</span>, bloating the
                      table and making queries harder. Keep device-level fields in a separate device
                      table; per-item rows already include the device identity columns for
                      correlation.
                    </p>
                  </div>
                </div>
              )}
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                {t.fieldIds.length} {t.fieldIds.length === 1 ? 'field' : 'fields'} assigned.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
