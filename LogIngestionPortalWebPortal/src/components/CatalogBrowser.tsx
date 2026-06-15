import { useMemo, useState } from 'react';
import type { Catalog, CatalogField } from '../types';

interface Props {
  catalog: Catalog;
  selected: Set<string>;
  onToggle: (id: string) => void;
}

export function CatalogBrowser({ catalog, selected, onToggle }: Props) {
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
        !q ||
        f.label.toLowerCase().includes(q) ||
        f.column.name.toLowerCase().includes(q) ||
        f.column.description.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q),
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
        {groups.map(([category, fields]) => (
          <section key={category} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => toggleCat(category)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
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
            {!collapsed.has(category) && (
              <div className="grid gap-2 px-3 pb-3 sm:grid-cols-2">
                {fields.map((f) => {
                const checked = f.locked || selected.has(f.id);
                return (
                  <label
                    key={f.id}
                    className={`group flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                      checked
                        ? 'border-indigo-400 bg-indigo-50/60 dark:border-indigo-500/60 dark:bg-indigo-500/10'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
                    } ${f.locked ? 'cursor-not-allowed opacity-90' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-indigo-600"
                      checked={checked}
                      disabled={f.locked}
                      onChange={() => onToggle(f.id)}
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{f.label}</span>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {f.column.type}
                        </code>
                        {f.locked && (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                            required
                          </span>
                        )}
                        {f.needsSystem && (
                          <span
                            title="Collector needs SYSTEM/admin context (runs fine via Intune Proactive Remediation)."
                            className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
                          >
                            SYSTEM
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                        {f.column.description}
                      </span>
                    </span>
                  </label>
                );
              })}
              </div>
            )}
          </section>
        ))}
        {groups.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">No fields match “{query}”.</p>
        )}
      </div>
    </div>
  );
}
