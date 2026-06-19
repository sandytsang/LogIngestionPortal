// Full-UI theme system. Each theme is a set of CSS custom-property values that
// applyTheme() writes onto <html>, so every surface styled with the semantic
// utilities in index.css (.app-shell, .app-header, .btn-accent, .badge-accent,
// .focus-accent, etc.) re-themes at once.

export interface Theme {
  id: string;
  name: string;
  /** CSS custom-property values applied to document.documentElement. */
  vars: Record<string, string>;
}

const t = (
  id: string,
  name: string,
  v: {
    appBg: string;
    headerBg: string;
    headerFg: string;
    headerMuted: string;
    headerLink: string;
    headerBorder?: string;
    accent: string;
    accentHover: string;
    accentFg: string;
    accentSoft: string;
    accentSoftFg: string;
    accentRing: string;
  },
): Theme => ({
  id,
  name,
  vars: {
    '--app-bg': v.appBg,
    '--header-bg': v.headerBg,
    '--header-fg': v.headerFg,
    '--header-muted': v.headerMuted,
    '--header-link': v.headerLink,
    '--header-border': v.headerBorder ?? 'transparent',
    '--accent': v.accent,
    '--accent-hover': v.accentHover,
    '--accent-fg': v.accentFg,
    '--accent-soft': v.accentSoft,
    '--accent-soft-fg': v.accentSoftFg,
    '--accent-ring': v.accentRing,
  },
});

export const THEMES: Theme[] = [
  t('enterprise-slate', 'Enterprise Slate', {
    appBg: '#f3f6fa',
    headerBg: '#0f172a',
    headerFg: '#f8fafc',
    headerMuted: '#cbd5e1',
    headerLink: '#93c5fd',
    headerBorder: '#1e293b',
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    accentFg: '#ffffff',
    accentSoft: '#eff6ff',
    accentSoftFg: '#1e3a8a',
    accentRing: '#bfdbfe',
  }),
];

export const DEFAULT_THEME_ID = 'enterprise-slate';

/** Applies a theme's CSS variables to <html>. Falls back to the first theme. */
export function applyTheme(id: string): void {
  const theme = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) {
    root.style.setProperty(key, value);
  }
}
