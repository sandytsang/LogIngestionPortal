// Bundles every file under the sibling LogIngestionAPI folder into the app at
// build time (as raw text) so the portal's "Download all (.zip)" can ship the
// complete, ready-to-deploy backend — function code, infra (Bicep/ARM), and
// scripts — alongside the user's generated columns.json and IntuneScript.ps1.
// This keeps the portal's "no backend, no runtime dependencies" guarantee:
// the files are baked into the static bundle, not fetched at runtime.

const modules = import.meta.glob('../../../LogIngestionAPI/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface BundledFile {
  /** Path inside the zip, e.g. "LogIngestionAPI/function/host.json". */
  name: string;
  content: string;
}

// Glob keys are relative to this module (e.g. "../../../LogIngestionAPI/..."),
// so strip the leading "../" segments to get a clean zip path.
export const apiFiles: BundledFile[] = Object.entries(modules)
  .map(([key, content]) => ({ name: key.replace(/^(\.\.\/)+/, ''), content }))
  .sort((a, b) => a.name.localeCompare(b.name));
