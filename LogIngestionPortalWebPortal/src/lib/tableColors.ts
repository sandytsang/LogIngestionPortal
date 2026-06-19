// A small, fixed palette for visually distinguishing tables in the UI.
//
// Tailwind only ships CSS classes it can see literally in the source, so every
// class string here is written out in full (no `bg-${color}-100` interpolation,
// which would be purged). Colors are purely cosmetic — they are NOT written to
// columns.json, the scripts, or any deployed artifact.

export interface TableColor {
  /** Stable token stored on TableConfig.color. */
  token: string;
  /** Human label for the picker tooltip. */
  label: string;
  /** Solid swatch used for the color-picker button. */
  swatch: string;
  /** Small indicator dot (used inside catalog table chips). */
  dot: string;
  /** Classes for an active/selected table chip. */
  chipActive: string;
  /** Left-edge accent for a table box in the Configuration panel. */
  boxAccent: string;
}

export const TABLE_COLORS: TableColor[] = [
  {
    token: 'slate',
    label: 'Slate',
    swatch: 'bg-slate-500',
    dot: 'bg-slate-500',
    chipActive:
      'border-slate-300 bg-slate-100 text-slate-800 shadow-sm hover:bg-slate-200 dark:border-slate-500/60 dark:bg-slate-500/25 dark:text-slate-100',
    boxAccent: 'border-l-4 border-l-slate-500',
  },
  {
    token: 'steel',
    label: 'Steel',
    swatch: 'bg-slate-600',
    dot: 'bg-slate-600',
    chipActive:
      'border-slate-400 bg-slate-100 text-slate-800 shadow-sm hover:bg-slate-200 dark:border-slate-500/60 dark:bg-slate-500/25 dark:text-slate-100',
    boxAccent: 'border-l-4 border-l-slate-600',
  },
  {
    token: 'navy',
    label: 'Navy',
    swatch: 'bg-slate-700',
    dot: 'bg-slate-700',
    chipActive:
      'border-slate-500 bg-slate-100 text-slate-800 shadow-sm hover:bg-slate-200 dark:border-slate-500/60 dark:bg-slate-500/25 dark:text-slate-100',
    boxAccent: 'border-l-4 border-l-slate-700',
  },
  {
    token: 'blue',
    label: 'Blue',
    swatch: 'bg-blue-500',
    dot: 'bg-blue-500',
    chipActive:
      'border-blue-300 bg-blue-100 text-blue-800 shadow-sm hover:bg-blue-200 dark:border-blue-500/60 dark:bg-blue-500/25 dark:text-blue-100',
    boxAccent: 'border-l-4 border-l-blue-500',
  },
  {
    token: 'azure',
    label: 'Azure',
    swatch: 'bg-sky-500',
    dot: 'bg-sky-500',
    chipActive:
      'border-sky-300 bg-sky-100 text-sky-800 shadow-sm hover:bg-sky-200 dark:border-sky-500/60 dark:bg-sky-500/25 dark:text-sky-100',
    boxAccent: 'border-l-4 border-l-sky-500',
  },
  {
    token: 'indigo',
    label: 'Indigo',
    swatch: 'bg-indigo-500',
    dot: 'bg-indigo-500',
    chipActive:
      'border-indigo-300 bg-indigo-100 text-indigo-800 shadow-sm hover:bg-indigo-200 dark:border-indigo-500/60 dark:bg-indigo-500/25 dark:text-indigo-100',
    boxAccent: 'border-l-4 border-l-indigo-500',
  },
  {
    token: 'cool-gray',
    label: 'Cool Gray',
    swatch: 'bg-zinc-500',
    dot: 'bg-zinc-500',
    chipActive:
      'border-zinc-300 bg-zinc-100 text-zinc-800 shadow-sm hover:bg-zinc-200 dark:border-zinc-500/60 dark:bg-zinc-500/25 dark:text-zinc-100',
    boxAccent: 'border-l-4 border-l-zinc-500',
  },
];

export const TABLE_COLOR_TOKENS = TABLE_COLORS.map((c) => c.token);

const byToken: Record<string, TableColor> = Object.fromEntries(
  TABLE_COLORS.map((c) => [c.token, c]),
);

/** Deterministic default color for the Nth table (cycles through the palette). */
export function colorTokenForIndex(index: number): string {
  return TABLE_COLOR_TOKENS[index % TABLE_COLOR_TOKENS.length];
}

/**
 * Resolves a color token (or a missing one, for older saved sessions) to its
 * class set, falling back to the deterministic color for the given index.
 */
export function tableColor(token: string | undefined, fallbackIndex = 0): TableColor {
  return (token ? byToken[token] : undefined) ?? byToken[colorTokenForIndex(fallbackIndex)];
}
