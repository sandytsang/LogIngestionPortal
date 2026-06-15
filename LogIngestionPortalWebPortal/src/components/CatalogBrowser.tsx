import { useMemo, useState } from 'react';
import type { Catalog, CatalogField } from '../types';

interface Props {
  catalog: Catalog;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSetMany: (ids: string[], select: boolean) => void;
}

export function CatalogBrowser({ catalog, selected, onToggle, onSetMany }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const isChecked = (f: CatalogField) => Boolean(f.locked) || selected.has(f.id);
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
        // Locked fields (e.g. TimeGenerated) are always included in columns.json
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
        <div className="flex gap-3 text-xs text-slate-500">
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
      </div>

      <div className="space-y-6">
        {groups.map(([category, fields]) => {
          const toggleable = fields.filter((f) => !f.locked);
          const selectedCount = toggleable.filter((f) => selected.has(f.id)).length;
          const allSelected = toggleable.length > 0 && selectedCount === toggleable.length;
          const someSelected = selectedCount > 0 && !allSelected;
          return (
          <section key={category} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex w-full items-center gap-2 px-3 py-2 hover:bg-slate-50">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-indigo-600"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                disabled={toggleable.length === 0}
                onChange={() => onSetMany(toggleable.map((f) => f.id), !allSelected)}
                title={allSelected ? 'Clear all in this category' : 'Select all in this category'}
                aria-label={`Select all in ${category}`}
              />
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
                  {fields.filter(isChecked).length}/{fields.length}
                </span>
              </button>
            </div>
            {!collapsed.has(category) && (
              <div className="divide-y divide-slate-100 px-3 pb-2 dark:divide-slate-800">
                {fields.map((f) => {
                const checked = f.locked || selected.has(f.id);
                return (
                  <label
                    key={f.id}
                    title={f.column.description}
                    className={`group flex cursor-pointer items-center gap-3 py-1.5 transition ${
                      f.locked ? 'cursor-not-allowed opacity-90' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-indigo-600"
                      checked={checked}
                      disabled={f.locked}
                      onChange={() => onToggle(f.id)}
                    />
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span
                        className={`shrink-0 text-sm ${
                          checked
                            ? 'font-medium text-slate-900 dark:text-slate-100'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {f.label}
                      </span>
                      <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {f.column.type}
                      </code>
                      {f.locked && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                          required
                        </span>
                      )}
                      <span className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {f.column.description}
                      </span>
                    </span>
                  </label>
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
