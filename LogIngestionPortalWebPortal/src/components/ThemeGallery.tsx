// Clickable gallery of the full-UI themes. Each card is a live mockup drawn in
// that theme's ACTUAL colors (via inline styles from the theme variables);
// clicking a card applies that theme across the whole app instantly.
import { THEMES, type Theme } from '../lib/theme';

function ThemeCard({
  index,
  theme,
  current,
  onSelect,
}: {
  index: number;
  theme: Theme;
  current: string;
  onSelect: (id: string) => void;
}) {
  const v = theme.vars;
  const selected = current === theme.id;
  return (
    <button
      type="button"
      onClick={() => onSelect(theme.id)}
      className={`overflow-hidden rounded-xl border text-left shadow-sm transition hover:shadow-md ${
        selected ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-300'
      }`}
    >
      {/* mock header */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-2"
        style={{ background: v['--header-bg'], color: v['--header-fg'] }}
      >
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: v['--accent'] }} />
        <span className="text-xs font-bold">Log Ingestion Portal</span>
        <span
          className="ml-auto rounded px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: v['--accent'], color: v['--accent-fg'] }}
        >
          Contribute
        </span>
      </div>
      {/* mock body */}
      <div className="space-y-2 p-2.5" style={{ background: v['--app-bg'] }}>
        <div className="flex items-center gap-1.5">
          <span className="h-4 w-1 rounded" style={{ background: v['--accent'] }} />
          <span className="text-xs font-bold text-slate-700">Azure Resource Configuration</span>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-2">
          <div className="flex flex-wrap items-center gap-1">
            <span
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: v['--accent-soft'], color: v['--accent-soft-fg'] }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: v['--accent'] }} />
              Devices_CL
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
              WindowsUpdate_CL
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700">
        <span>
          {index}. {theme.name}
        </span>
        {selected && <span className="text-[10px] font-bold text-emerald-600">● Active</span>}
      </div>
    </button>
  );
}

export function ThemeGallery({
  current,
  onSelect,
  onClose,
}: {
  current: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-5xl rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Theme gallery</h2>
            <p className="mt-1 text-sm text-slate-600">
              Click a theme to apply it across the whole app instantly (header, background, accents,
              buttons, badges). Your choice is remembered for this session.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Close
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {THEMES.map((th, i) => (
            <ThemeCard key={th.id} index={i + 1} theme={th} current={current} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </div>
  );
}
