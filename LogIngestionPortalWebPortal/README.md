# Log Ingestion Portal

A **100% client-side** web portal that generates everything you need to collect
Windows device data into Log Analytics — without hand-editing two files and
guessing at the schema.

Pick the data points you want from a curated catalog and the portal generates:

1. **`schema/columns.json`** — the Log Analytics table + DCR schema.
2. **`IntuneScript.ps1`** — the Intune Proactive Remediation **detection** script
   that collects exactly those fields.
3. **A `deploy.ps1` command** — to update the workspace, table and DCR.

It is the companion to the **[LogIngestionAPI](../LogIngestionAPI)** solution,
which lives in the same repository.

## Why it exists

In [`../LogIngestionAPI`](../LogIngestionAPI), adding a data point means editing a
collector in `scripts/IntuneScript.ps1` **and** a column in `schema/columns.json`,
then redeploying. This portal fixes that: every catalog entry bundles **both** the
column definition and its PowerShell collector, so a single selection keeps them
in sync and emits ready-to-use files.

## Privacy / safety

- Runs entirely in your browser. **No backend, no sign-in, no app registration,
  no consent, no telemetry.** Nothing runs in anyone's tenant.
- The portal only *generates text*. You deploy with your own `az` / `func` login,
  locally, when you choose to.

## Use it

1. Open the portal (GitHub Pages) and select the fields you want. The defaults
   reproduce the current `DeviceInventory_CL` schema.
2. Fill in the **Function URL**, the deployment options (resource group, region,
   plan), and — if reusing one — an existing workspace name.
3. Click **Download all (.zip)** to get the **complete `LogIngestionAPI`
   backend** (function code, Bicep/ARM infra, and scripts) with your generated
   `schema/columns.json` and `scripts/IntuneScript.ps1` already dropped into place,
   plus a top-level `README.txt` with the exact deploy command.
4. Unzip it and from the `LogIngestionAPI` folder:
   - run the deploy command from the bundled `README.txt`,
   - paste the generated `IntuneScript.ps1` into your Intune Proactive Remediation
     (detection script).

> Two extra tools in the portal: **“Update data columns only”** generates a
> lighter `deploy.ps1 -SchemaOnly` command (table + DCR only), and **“Build
> columns.json from data”** turns a `IntuneScript.ps1 -PreviewData` JSON sample into
> a matching schema.

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

## Contributing data points

The catalog is community-driven. Add a new property or category as a small JSON
entry (bundling the column **and** a read-only PowerShell collector) — either
with the in-portal **“+ Contribute a field”** button, which builds the entry and
opens a pre-filled GitHub PR, or by editing [`catalog/categories/`](catalog/categories)
directly. See [CONTRIBUTING.md](CONTRIBUTING.md).

Every submission is checked automatically before a maintainer merges it:

```powershell
npm run validate                     # JSON Schema + uniqueness + read-only security gate
pwsh ./scripts/Test-Collectors.ps1   # PowerShell syntax parse
npm test                             # generator + round-trip tests
```

The forbidden-pattern list lives in
[catalog/security-rules.json](catalog/security-rules.json) and is shared by the
portal and the CI validator, so the in-browser check matches CI exactly.

## Keeping in sync with LogIngestionAPI

The catalog under [`catalog/`](catalog) mirrors the collectors in
[`../LogIngestionAPI/scripts/IntuneScript.ps1`](../LogIngestionAPI/scripts/IntuneScript.ps1),
and [test/fixtures/columns.json](test/fixtures/columns.json) is a copy of
[`../LogIngestionAPI/schema/columns.json`](../LogIngestionAPI/schema/columns.json)
used to guarantee the default selection round-trips exactly. If you change the
schema in `LogIngestionAPI`, update those here.
