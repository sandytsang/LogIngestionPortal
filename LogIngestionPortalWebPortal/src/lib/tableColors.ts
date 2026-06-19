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
    token: 'emerald',
    label: 'Emerald',
    swatch: 'bg-emerald-500',
    dot: 'bg-emerald-400',
    chipActive:
      'border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm hover:bg-emerald-200 dark:border-emerald-500/60 dark:bg-emerald-500/25 dark:text-emerald-100',
    boxAccent: 'border-l-4 border-l-emerald-400',
  },
  {
    token: 'sky',
    label: 'Sky',
    swatch: 'bg-sky-500',
    dot: 'bg-sky-400',
    chipActive:
      'border-sky-300 bg-sky-100 text-sky-800 shadow-sm hover:bg-sky-200 dark:border-sky-500/60 dark:bg-sky-500/25 dark:text-sky-100',
    boxAccent: 'border-l-4 border-l-sky-400',
  },
  {
    token: 'violet',
    label: 'Violet',
    swatch: 'bg-violet-500',
    dot: 'bg-violet-400',
    chipActive:
      'border-violet-300 bg-violet-100 text-violet-800 shadow-sm hover:bg-violet-200 dark:border-violet-500/60 dark:bg-violet-500/25 dark:text-violet-100',
    boxAccent: 'border-l-4 border-l-violet-400',
  },
  {
    token: 'amber',
    label: 'Amber',
    swatch: 'bg-amber-500',
    dot: 'bg-amber-400',
    chipActive:
      'border-amber-300 bg-amber-100 text-amber-800 shadow-sm hover:bg-amber-200 dark:border-amber-500/60 dark:bg-amber-500/25 dark:text-amber-100',
    boxAccent: 'border-l-4 border-l-amber-400',
  },
  {
    token: 'rose',
    label: 'Rose',
    swatch: 'bg-rose-500',
    dot: 'bg-rose-400',
    chipActive:
      'border-rose-300 bg-rose-100 text-rose-800 shadow-sm hover:bg-rose-200 dark:border-rose-500/60 dark:bg-rose-500/25 dark:text-rose-100',
    boxAccent: 'border-l-4 border-l-rose-400',
  },
  {
    token: 'teal',
    label: 'Teal',
    swatch: 'bg-teal-500',
    dot: 'bg-teal-400',
    chipActive:
      'border-teal-300 bg-teal-100 text-teal-800 shadow-sm hover:bg-teal-200 dark:border-teal-500/60 dark:bg-teal-500/25 dark:text-teal-100',
    boxAccent: 'border-l-4 border-l-teal-400',
  },
  {
    token: 'indigo',
    label: 'Indigo',
    swatch: 'bg-indigo-500',
    dot: 'bg-indigo-400',
    chipActive:
      'border-indigo-300 bg-indigo-100 text-indigo-800 shadow-sm hover:bg-indigo-200 dark:border-indigo-500/60 dark:bg-indigo-500/25 dark:text-indigo-100',
    boxAccent: 'border-l-4 border-l-indigo-400',
  },
  {
    token: 'lime',
    label: 'Lime',
    swatch: 'bg-lime-500',
    dot: 'bg-lime-400',
    chipActive:
      'border-lime-300 bg-lime-100 text-lime-800 shadow-sm hover:bg-lime-200 dark:border-lime-500/60 dark:bg-lime-500/25 dark:text-lime-100',
    boxAccent: 'border-l-4 border-l-lime-400',
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
