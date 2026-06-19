# Testing and CI

How the solution is validated locally and in GitHub Actions.

## Local checks

### Deployment package (`LogIngestionAPI/`)

- **Validate the schema + Bicep** before deploying — `deploy.ps1` validates
  `schema/columns.json` and the Bicep template as its first step.
- **Preview device data** without uploading (run as SYSTEM):

  ```powershell
  # psexec -s -i powershell.exe, then:
  ./scripts/IntuneScript.ps1 -PreviewData
  ```

### Web portal (`LogIngestionPortalWebPortal/`)

```powershell
npm install
npm run dev        # local portal
npm test           # unit tests (generators, contribution, schema mapping)
npm run validate   # validate catalog JSON against the schema
pwsh ./scripts/Test-Collectors.ps1   # parse every catalog collector/expression
npm run build      # production build
```

`Test-Collectors.ps1` uses the built-in PowerShell parser (no PSScriptAnalyzer
install) to catch syntax errors in catalog field expressions and collectors.

## GitHub workflows

### Repository root (`.github/workflows/`)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `validate.yml` | push / PR | Validate the catalog and run portal checks. |
| `pages.yml` | push to `main` | Build and publish the portal to GitHub Pages. |

### Deployment package (`LogIngestionAPI/.github/workflows/`)

These run from a repository whose **root is the `LogIngestionAPI` folder** (e.g.
the folder you get from the portal's download bundle, pushed as your own repo).

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `validate.yml` | push / PR | Validate schema + Bicep. |
| `deploy.yml` | `workflow_dispatch` | Full stack deploy (Function App + table + DCR). |
| `update-columns.yml` | `workflow_dispatch` | Schema-only update (table + DCR; Function App untouched). |

### Deploy/update inputs

Both `deploy.yml` and `update-columns.yml` offer a **method** input:

- `native` — Bicep + `Azure/functions-action` only (no PowerShell script).
- `script` — run `scripts/deploy.ps1` in CI (same path as a local deploy).

`deploy.yml` exposes resource names, region, plan type, `requireEntraDevice`,
and `skipRoleAssignment` as inputs (sensible defaults provided).

## Authentication for CI

All deployment workflows use passwordless **OIDC** login. See
[RBAC and permissions](rbac-and-permissions.md) for the one-time setup
(Entra app + federated credential + repo secrets `AZURE_CLIENT_ID`,
`AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and `id-token: write`).

## Before opening a PR

For portal/catalog changes:

```powershell
npm run validate
pwsh ./scripts/Test-Collectors.ps1
npm test
```

For deployment changes: run `deploy.ps1` against a throwaway resource group, or
trigger `validate.yml`.
