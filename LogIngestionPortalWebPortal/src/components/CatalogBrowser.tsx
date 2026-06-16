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
    // Always present fields alphabetically by label so the list is predictable.
    // Identity is pinned first (the core device-identity columns); the remaining
    // categories follow A–Z. This is display-only; the generated column order is
    // driven by each field's `order`, not by this sort.
    for (const list of map.values()) {
      list.sort((a, b) => a.label.localeCompare(b.label));
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === b[0]) return 0;
      if (a[0] === 'Identity') return -1;
      if (b[0] === 'Identity') return 1;
      return a[0].localeCompare(b[0]);
    });
  }, [catalog.fields, query]);

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[13px] font-medium transition-all duration-200 active:scale-95 ${
      active
        ? 'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm hover:bg-emerald-200 dark:border-emerald-500/60 dark:bg-emerald-500/25 dark:text-emerald-100'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
    }`;


  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 mb-4 space-y-2 bg-slate-50/90 px-1 py-2 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fields (e.g. bitlocker, serial, network)…"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-base shadow-sm outline-none transition-shadow focus:border-indigo-500 focus:shadow-md focus:ring-2 focus:ring-indigo-500/30 dark:border-slate-700 dark:bg-slate-900"
        />
        <div className="flex items-center justify-between gap-3 text-sm text-slate-500">
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
            <span className="text-xs text-slate-500">
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
          <section key={category} className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow duration-200 hover:shadow-md dark:border-slate-700/70 dark:bg-slate-900/40">
            <div className="flex w-full items-center gap-2 px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
              {singleTable && (
                <input
                  type="checkbox"
                  className="h-5 w-5 shrink-0 accent-emerald-600"
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
                <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                  <span
                    className={`text-[10px] text-slate-400 transition-transform duration-200 ${collapsed.has(category) ? '' : 'rotate-90'}`}
                  >
                    ▶
                  </span>
                  {category}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {assignedCount}/{fields.length}
                </span>
              </button>
            </div>
            {!collapsed.has(category) && (
              <div className="space-y-0.5 px-2 pb-2 pt-1">
                {fields.map((f) => {
                const assigned = isAssigned(f);
                return (
                  <div
                    key={f.id}
                    title={f.column.description}
                    className={`group flex flex-col gap-1.5 rounded-lg px-2 py-2 transition-colors duration-150 ${
                      assigned
                        ? 'bg-emerald-50/60 dark:bg-emerald-500/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <label
                      className={`flex min-w-0 items-center gap-3 ${singleTable ? 'cursor-pointer' : ''}`}
                    >
                      {singleTable && (
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-emerald-600"
                          checked={inT0(f)}
                          onChange={() => onToggleAssignment(f.id, t0.id)}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span
                          className={`shrink-0 text-base ${
                            assigned
                              ? 'font-semibold text-slate-900 dark:text-slate-100'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {f.label}
                        </span>
                        <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">→</span>
                        <code
                          title="Log Analytics column name"
                          className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
                        >
                          {f.column.name}
                        </code>
                        <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {f.column.type}
                        </code>
                        <span className="truncate text-sm text-slate-600 dark:text-slate-400">
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
