import { useMemo, useState } from 'react';
import type { Catalog, CatalogField, TableConfig } from '../types';

interface Props {
  catalog: Catalog;
  tables: TableConfig[];
  onToggleAssignment: (fieldId: string, tableId: string) => void;
  onSetManyForTable: (fieldIds: string[], tableId: string, select: boolean) => void;
}

export function CatalogBrowser({ catalog, tables, onToggleAssignment, onSetManyForTable }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const singleTable = tables.length === 1;
  const isAssigned = (f: CatalogField) =>
    Boolean(f.locked) || tables.some((t) => t.fieldIds.includes(f.id));

  const toggleCat = (category: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = catalog.fields.filter(
      (f) =>
        // Locked fields (e.g. TimeGenerated) are always included in every table
        // automatically, so there's nothing to choose — hide them from the list.
        !f.locked &&
        (!q ||
          f.label.toLowerCase().includes(q) ||
          f.column.name.toLowerCase().includes(q) ||
          f.column.description.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q)),
    );
    const map = new Map<string, CatalogField[]>();
    for (const f of filtered) {
      const list = map.get(f.category) ?? [];
      list.push(f);
      map.set(f.category, list);
    }
    return [...map.entries()];
  }, [catalog.fields, query]);

  const chip = (active: boolean) =>
    `rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
      active
        ? 'border-indigo-500 bg-indigo-600 text-white hover:bg-indigo-500'
        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
    }`;


  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 mb-4 space-y-2 bg-slate-50/90 px-1 py-2 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fields (e.g. bitlocker, serial, network)…"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCollapsed(new Set(groups.map(([c]) => c)))}
              className="underline hover:text-slate-800"
            >
              Collapse all
            </button>
            <button
              type="button"
              onClick={() => setCollapsed(new Set())}
              className="underline hover:text-slate-800"
            >
              Expand all
            </button>
          </div>
          {!singleTable && (
            <span className="text-[11px] text-slate-400">
              Click a table chip to add/remove a field from that table.
            </span>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {groups.map(([category, fields]) => {
          const assignedCount = fields.filter(isAssigned).length;
          // Single-table convenience: a category-level select-all checkbox.
          const t0 = tables[0];
          const inT0 = (f: CatalogField) => t0.fieldIds.includes(f.id);
          const selectedInT0 = fields.filter(inT0).length;
          const allInT0 = fields.length > 0 && selectedInT0 === fields.length;
          const someInT0 = selectedInT0 > 0 && !allInT0;
          return (
          <section key={category} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50">
              {singleTable && (
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-indigo-600"
                  checked={allInT0}
                  ref={(el) => {
                    if (el) el.indeterminate = someInT0;
                  }}
                  disabled={fields.length === 0}
                  onChange={() => onSetManyForTable(fields.map((f) => f.id), t0.id, !allInT0)}
                  title={allInT0 ? 'Clear all in this category' : 'Select all in this category'}
                  aria-label={`Select all in ${category}`}
                />
              )}
              <button
                type="button"
                onClick={() => toggleCat(category)}
                className="flex flex-1 items-center justify-between text-left"
              >
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <span
                    className={`text-[9px] transition-transform ${collapsed.has(category) ? '' : 'rotate-90'}`}
                  >
                    ▶
                  </span>
                  {category}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  {assignedCount}/{fields.length}
                </span>
              </button>
            </div>
            {!collapsed.has(category) && (
              <div className="divide-y divide-slate-100 px-3 pb-2 dark:divide-slate-800">
                {fields.map((f) => {
                const assigned = isAssigned(f);
                return (
                  <div
                    key={f.id}
                    title={f.column.description}
                    className="group flex flex-col gap-1.5 py-2"
                  >
                    <label
                      className={`flex min-w-0 items-center gap-3 ${singleTable ? 'cursor-pointer' : ''}`}
                    >
                      {singleTable && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-indigo-600"
                          checked={inT0(f)}
                          onChange={() => onToggleAssignment(f.id, t0.id)}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span
                          className={`shrink-0 text-sm ${
                            assigned
                              ? 'font-medium text-slate-900 dark:text-slate-100'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {f.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-300 dark:text-slate-600">→</span>
                        <code
                          title="Log Analytics column name"
                          className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                        >
                          {f.column.name}
                        </code>
                        <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {f.column.type}
                        </code>
                        <span className="truncate text-xs text-slate-400 dark:text-slate-500">
                          {f.column.description}
                        </span>
                      </span>
                    </label>
                    {!singleTable && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {tables.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onToggleAssignment(f.id, t.id)}
                            className={chip(t.fieldIds.includes(f.id))}
                            title={
                              t.fieldIds.includes(f.id) ? `Remove from ${t.name}` : `Add to ${t.name}`
                            }
                          >
                            {t.name || 'Untitled'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            )}
          </section>
          );
        })}
        {groups.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">No fields match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
