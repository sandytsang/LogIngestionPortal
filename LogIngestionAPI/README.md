# Log Ingestion API Solution

A user-friendly, maintainable pipeline for collecting data from Windows devices
and storing it in Log Analytics:

```
Intune Proactive Remediation (PowerShell)
        │  HTTPS POST (+ function key + device-signed JWT)
        ▼
Azure Function App (PowerShell)
        │  Managed identity token + DCR direct endpoint
        ▼
Data Collection Rule  (kind = Direct, no DCE)
        │  transformKql (one stream per table)
        ▼
Log Analytics custom table(s)  (*_CL)
```

## Why this is easy to maintain

- **One schema file.** [schema/columns.json](schema/columns.json) is the single
  source of truth. It defines one or more custom tables (`tables: [ { tableName,
  description, columns } ]`); the Bicep template generates **both** each Log
  Analytics table and its DCR stream (`Custom-<tableName>`) from it, so a single
  redeploy keeps everything in sync.
- **Multiple tables in one DCR.** Each table becomes its own stream and data
  flow. The device script sends a table-keyed payload
  (`{ "Table1_CL": [ … ], "Table2_CL": [ … ] }`) and the Function routes each
  group to the matching stream. A bare array/object is still accepted and routed
  to the first table for backward compatibility.
- **Add/remove columns or tables without touching code.** The Function forwards
  raw JSON and each DCR stream's `transformKql` maps columns into its table.
  Changing the schema only requires editing the JSON and redeploying.
- **No Data Collection Endpoint (DCE).** The DCR uses `kind: Direct`, which
  exposes its own ingestion endpoint — fewer resources to manage.
- **One command to deploy or update.** [scripts/deploy.ps1](scripts/deploy.ps1)
  validates the schema, deploys infra, publishes the Function, and prints a test
  command.

## Prerequisites

Starting from a clean machine you need three things (the deploy script checks for
them and prints these hints if any are missing):

- **PowerShell 7+** — `winget install Microsoft.PowerShell`
- **Azure CLI (`az`)** — `winget install Microsoft.AzureCLI` (or <https://aka.ms/installazurecli>).
  The Bicep CLI is installed automatically by `az` the first time it compiles a template.
- **Azure Functions Core Tools v4 (`func`)** — `winget install Microsoft.Azure.FunctionsCoreTools`
  (or `npm i -g azure-functions-core-tools@4 --unsafe-perm true`). Only needed to
  publish the Function code; skip with `-SkipFunctionPublish`.

Then sign in: `az login` (and `az account set --subscription <name-or-id>`). You
need permission to create resources and role assignments. Granting the device
check's Graph `Device.Read.All` also needs an admin who can consent to Graph app
roles (see below).

## Deploy

```powershell
cd scripts
./deploy.ps1 -FunctionResourceGroup rg-loging-dev -Location eastus
```

The script prints the **Function URL** and **function key**. Paste the full
invoke URL into the top of [scripts/IntuneScript.ps1](scripts/IntuneScript.ps1), then
upload it as the **detection** script of an Intune Proactive Remediation and
schedule it (no remediation script is needed - the script does the work and
reports compliant).

> Missing resource groups are created automatically. If you lack permission to
> create one, the script stops and prints the exact `az group create` command to
> run (or hand to an admin). Existing resource groups are reused unchanged.

### Put the DCR in a different resource group

The Function App (with its storage account, Application Insights, App Service
plan and — for a new deployment — the Log Analytics workspace) is created in the
`-FunctionResourceGroup`. The Data Collection Rule defaults to that same RG but
can target another one:

```powershell
./deploy.ps1 -FunctionResourceGroup rg-fn -Location eastus `
  -DcrResourceGroup rg-dcr
```

### Reuse an existing Log Analytics workspace

By default the deployment creates a new workspace. To send data to a workspace
you already have, pass `-ExistingWorkspaceName`:

```powershell
# Workspace in the same resource group as the Function App
./deploy.ps1 -FunctionResourceGroup rg-loging-dev -Location eastus -ExistingWorkspaceName my-law

# Workspace in a different resource group
./deploy.ps1 -FunctionResourceGroup rg-loging-dev -Location eastus `
  -ExistingWorkspaceName my-law `
  -ExistingWorkspaceResourceGroup rg-shared-monitoring
```

The custom `*_CL` table is created in the existing workspace (other tables are
left untouched). You can also set `existingWorkspaceName` /
`existingWorkspaceResourceGroup` directly in
[infra/main.bicepparam](infra/main.bicepparam) instead of passing them on the
command line.

## Device authentication (device-signed JWT)

Every request must prove possession of the device's **Entra-join
(MS-Organization-Access) certificate** by signing a short-lived JWT, exactly like
the Autopilot Credential Portal. The **function key** stays in place as a cheap
second gate.

Device-signed JWT authentication is **always required** — every request must
carry a valid device JWT. The remaining behaviour (audience, tenant pinning,
Entra device validation) is driven by Function App settings.

### How it works

1. The device signs a 5-minute RS256 JWT with its MS-Organization-Access cert and
   sends it as `Authorization: Bearer <jwt>` (`x5c` carries the cert).
2. `function/Modules/DeviceJwtAuth` decodes it, optionally resolves the device in
   Entra, validates the cert against the device record, then verifies the
   signature, audience, and freshness.
3. Invalid/missing JWT → `401`. Valid → the payload is forwarded as usual.

### Configuration (all Function App settings — nothing hardcoded)

| App setting | Default | Purpose |
| --- | --- | --- |
| `JWT_EXPECTED_AUDIENCE` | *(auto)* | The JWT `aud` must equal this. Defaults automatically to this Function App's own hostname (`https://<func>.azurewebsites.net`); set it only to override for a custom domain. |
| `JWT_ALLOWED_TENANT_ID` | *(empty)* | If set, pins requests to one Entra tenant (`tid` claim). |
| `JWT_REQUIRE_ENTRA_DEVICE` | `true` | `true` validates the cert against the Entra device record (needs Graph `Device.Read.All`). `false` validates signature + `MS-Organization-Access` issuer only (no Graph permission). |

Set them via Bicep params (`jwtExpectedAudience`,
`jwtAllowedTenantId`, `jwtRequireEntraDevice`) or directly on the Function App.

### Deploy

1. **Deploy.** The script auto-grants the Graph permission the device check needs
   (see below), so a normal deploy is enough:
   ```powershell
   ./deploy.ps1 -FunctionResourceGroup rg-loging-dev -Location eastus
   ```
2. **Client side** in [scripts/IntuneScript.ps1](scripts/IntuneScript.ps1): keep
   `$UseDeviceJwt = $true` (the default) and package the Proactive Remediation.

> Because enforcement is always on, ensure devices are Entra-joined and sending
> valid JWTs before targeting them — otherwise their requests are rejected with `401`.

### Managed identity & Graph permission (automatic)

The Function App is deployed with a **system-assigned managed identity** (enabled
by the Bicep — nothing to turn on). With the default `JWT_REQUIRE_ENTRA_DEVICE=true`,
the function resolves each device in Entra to validate its certificate, which
requires that identity to hold Microsoft Graph **`Device.Read.All`** (application).

`deploy.ps1` **grants this automatically by default** (idempotent). It needs a
caller who can consent to Graph app roles (Privileged Role Administrator / Global
Administrator). If you lack that, the script warns and continues; grant it
manually afterwards:

```powershell
$rg   = 'rg-loging-dev'
$func = '<function-app-name>'
$miId = az functionapp identity show -g $rg -n $func --query principalId -o tsv
$graphId = az ad sp list --filter "appId eq '00000003-0000-0000-c000-000000000000'" --query '[0].id' -o tsv
$body = @{ principalId = $miId; resourceId = $graphId; appRoleId = '7438b122-aefc-4978-80ed-43db9fcc7715' } | ConvertTo-Json -Compress
# Pass the body via a temp file — inline JSON to `az rest` on Windows/PowerShell
# is mangled and Graph returns "Unable to read JSON request payload".
$bodyFile = New-TemporaryFile
Set-Content -Path $bodyFile -Value $body -Encoding utf8
az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miId/appRoleAssignments" --headers 'Content-Type=application/json' --body "@$bodyFile"
Remove-Item $bodyFile
```

If you cannot grant Graph permissions, set `JWT_REQUIRE_ENTRA_DEVICE=false`: the
function still enforces proof-of-possession of a valid MS-Organization-Access
certificate, but does not confirm the device is registered/enabled in Entra.

### Future option: mutual TLS (client certificate) with Cloud PKI

Device-JWT is the active method. If you later stand up **Intune Cloud PKI /
SCEP / PKCS**, you can *additionally* require a client certificate at the App
Service edge:

- In [infra/main.bicep](infra/main.bicep) uncomment `clientCertMode: 'Required'`
  on the Function App.
- Validate the cert in `run.ps1` from the `X-ARR-ClientCert` header (App Service
  only checks that *a* cert is present — you must verify it chains to your Cloud
  PKI issuing CA).

Because JWT already gives per-device proof-of-possession, mTLS mainly adds a
network-edge gate (DoS/surface reduction). It is documented here as an optional
hardening, not enabled by default.

## Function App hardening

The Bicep applies a security baseline to the Function App: 64-bit worker,
HTTP/2, TLS 1.2 floor (site **and** SCM), HTTPS-only, FTP disabled, and ARR
affinity off. It also **disables basic (username/password) auth on the SCM
(Kudu) and FTP publishing endpoints** — a surface commonly flagged by security
scanners.

With basic-auth publishing disabled, deployments authenticate with **Entra
(`az login`)** instead of publishing credentials. `deploy.ps1` /
`func azure functionapp publish` handle this automatically with current Azure
Functions Core Tools v4. If a publish ever returns `401`, update Core Tools
(`winget upgrade Microsoft.Azure.FunctionsCoreTools`), publish the zip via
`az functionapp deployment source config-zip` (AAD), or temporarily re-enable
SCM basic auth just for that publish.

## Add or remove a collected field

1. Edit [schema/columns.json](schema/columns.json) (add/remove a column).
2. Update `Get-DeviceData` in [scripts/IntuneScript.ps1](scripts/IntuneScript.ps1) so
   the uploaded object includes/excludes that property.
3. Redeploy — either a full deploy, or a lighter **schema-only** update that
   touches just the table + DCR (the Function App is left untouched):
   ```powershell
   # Schema-only update (recommended for column changes)
   ./deploy.ps1 -SchemaOnly -DcrResourceGroup rg-loging-dev

   # Or a full redeploy without republishing the Function code
   ./deploy.ps1 -FunctionResourceGroup rg-loging-dev -Location eastus -SkipFunctionPublish
   ```
   The table and DCR are regenerated; existing data is preserved and the Function
   code is unchanged.

> Column types allowed in `columns.json`: `string`, `int`, `long`, `real`,
> `boolean`, `datetime`, `dynamic`, `guid`. A `TimeGenerated` (`datetime`)
> column is required.

## Test

```powershell
Invoke-RestMethod -Method Post `
  -Uri 'https://<func>.azurewebsites.net/api/DCRLogIngestionAPI?code=<key>' `
  -ContentType 'application/json' `
  -Body '[{ "TimeGenerated": "2026-06-11T00:00:00Z", "DeviceName": "test", "Status": "Remediated" }]'
```

Then query in Log Analytics (data appears within ~5–10 minutes):

```kusto
DeviceInventory_CL
| sort by TimeGenerated desc
| take 20
```

## Project layout

| Path | Purpose |
| --- | --- |
| `schema/columns.json` | Single source of truth for the table + DCR schema |
| `infra/main.bicep` | RG-scoped orchestrator: deploys the modules below |
| `infra/modules/` | Log Analytics + table, DCR (Direct), Function App, DCR role assignment |
| `infra/main.bicepparam` | Deployment parameters |
| `function/DCRLogIngestionAPI/run.ps1` | Schema-agnostic forwarder to the DCR endpoint |
| `function/Modules/DeviceJwtAuth/` | Device-JWT request authentication (proof-of-possession) |
| `scripts/IntuneScript.ps1` | Intune detection-slot script (collects + uploads) |
| `scripts/deploy.ps1` | Validate schema, deploy infra, publish function |

## Troubleshooting

- **403 from the ingestion endpoint** — the Function's managed identity needs the
  *Monitoring Metrics Publisher* role on the DCR (assigned by the Bicep). Role
  propagation can take a few minutes after first deployment.
- **No data in the table** — confirm the column names in the uploaded JSON match
  `columns.json` exactly (case-sensitive) and that `transformKql` projects them.
- **Large payloads** — the Logs Ingestion API rejects calls over 1 MB. The
  function automatically splits an incoming array into sub-1 MB batches and posts
  each one; a single record that alone exceeds 1 MB is skipped and reported in
  the response (`status: partial`, `skipped: <n>`).
- **401 from the Function** — the device request is missing the `?code=<key>`
  query string or the key was rotated. A `401` also means the
  `Authorization: Bearer <jwt>` header is missing/invalid. The most common cause
  on a fresh deploy is that the Function's managed identity does **not** have
  Graph `Device.Read.All`, so the default Entra device lookup fails. Re-run
  `deploy.ps1` (it grants this by default), grant it manually (see "Managed
  identity & Graph permission"), or set `JWT_REQUIRE_ENTRA_DEVICE=false` to skip
  the Graph lookup. Also confirm the device is Entra-joined and
  `$UseDeviceJwt = $true` in `IntuneScript.ps1`. To see the exact rejection reason,
  check the Function's log stream / Application Insights for `DeviceJwtAuth`
  entries (e.g. audience mismatch, expired token, device not found).
