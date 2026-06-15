# Log Ingestion Portal

A **100% client-side** web portal that generates everything you need to collect
Windows device data into Log Analytics — without hand-editing two files and
guessing at the schema.

Pick the data points you want from a curated catalog and the portal generates:

1. **`schema/columns.json`** — the Log Analytics table + DCR schema.
2. **`remediate.ps1`** — the Intune Proactive Remediation **detection** script
   that collects exactly those fields.
3. **A `deploy.ps1` command** — to update the workspace, table and DCR.

It is the companion to the **[LogIngestionAPI](https://github.com/sandytsang/LogIngestionAPI)**
solution.

## Why it exists

In the API repo, adding a data point means editing a collector in
`scripts/remediate.ps1` **and** a column in `schema/columns.json`, then
redeploying. This portal fixes that: every catalog entry bundles **both** the
column definition and its PowerShell collector, so a single selection keeps them
in sync and emits ready-to-use files.

## Privacy / safety

- Runs entirely in your browser. **No backend, no sign-in, no app registration,
  no consent, no telemetry.** Nothing runs in anyone's tenant.
- The portal only *generates text*. You deploy with your own `az` / `func` login,
  locally, when you choose to.

## Use it

1. Open the portal (GitHub Pages) and select the fields you want. The defaults
   reproduce the current `DeviceRemediation_CL` schema.
2. Fill in the **Function URL** (and optionally an existing workspace name).
3. Copy/download the three outputs.
4. In your `LogIngestionAPI` checkout:
   - replace `schema/columns.json` with the generated file,
   - run the generated `deploy.ps1` command,
   - paste the generated `remediate.ps1` into your Intune Proactive Remediation
     (detection script).

> The optional **"open Azure portal"** link deploys *infrastructure only* in your
> own tenant; the Function code is still published locally with `func`.

## Develop

```powershell
npm install
npm run dev      # local dev server
npm test         # generator unit tests (incl. round-trip vs columns.json)
npm run build    # type-check + production build to dist/
```

Deployment to GitHub Pages is automated by
[.github/workflows/pages.yml](.github/workflows/pages.yml). Enable Pages with
**Settings → Pages → Build and deployment → GitHub Actions**.

> The Vite `base` in [vite.config.ts](vite.config.ts) is `/LogIngestionPortal/`.
> Update it if you rename the repository or use a custom domain.

## Keeping in sync with LogIngestionAPI

The catalog ([src/data/catalog.ts](src/data/catalog.ts)) mirrors the collectors
in the API repo's `scripts/remediate.ps1`, and
[test/fixtures/columns.json](test/fixtures/columns.json) is a copy of that repo's
`schema/columns.json` used to guarantee the default selection round-trips
exactly. If you change the schema in the API repo, update those two here.
