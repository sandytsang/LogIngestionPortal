# Log Ingestion API Solution

A user-friendly, maintainable pipeline for collecting data from Windows devices
and storing it in Log Analytics:

```
Intune Proactive Remediation (PowerShell)
        │  HTTPS POST (+ function key, + optional device JWT)
        ▼
Azure Function App (PowerShell)
        │  Managed identity token + DCR direct endpoint
        ▼
Data Collection Rule  (kind = Direct, no DCE)
        │  transformKql
        ▼
Log Analytics custom table  (*_CL)
```

## Why this is easy to maintain

- **One schema file.** [schema/columns.json](schema/columns.json) is the single
  source of truth. The Bicep template generates **both** the Log Analytics table
  and the DCR stream from it, so a single redeploy keeps them in sync.
- **Add/remove columns without touching code.** The Function forwards raw JSON
  and the DCR's `transformKql` maps columns into the table. Changing the schema
  only requires editing the JSON and redeploying.
- **No Data Collection Endpoint (DCE).** The DCR uses `kind: Direct`, which
  exposes its own ingestion endpoint — fewer resources to manage.
- **One command to deploy or update.** [scripts/deploy.ps1](scripts/deploy.ps1)
  validates the schema, deploys infra, publishes the Function, and prints a test
  command.

## Prerequisites

- Azure CLI (`az`) with the Bicep extension
- Azure Functions Core Tools (`func`) — for publishing the Function code
- An Azure subscription and permission to create resources + role assignments

## Deploy

```powershell
cd scripts
./deploy.ps1 -ResourceGroup rg-loging-dev -Location eastus
```

The script prints the **Function URL** and **function key**. Paste the full
invoke URL into the top of [scripts/remediate.ps1](scripts/remediate.ps1), then
upload it as the **detection** script of an Intune Proactive Remediation and
schedule it (no remediation script is needed - the script does the work and
reports compliant).

> The target resource group is created if it does not exist; if it already
> exists it is reused unchanged.

### Reuse an existing Log Analytics workspace

By default the deployment creates a new workspace. To send data to a workspace
you already have, pass `-ExistingWorkspaceName`:

```powershell
# Workspace in the same resource group as the deployment
./deploy.ps1 -ResourceGroup rg-loging-dev -Location eastus -ExistingWorkspaceName my-law

# Workspace in a different resource group
./deploy.ps1 -ResourceGroup rg-loging-dev -Location eastus `
  -ExistingWorkspaceName my-law `
  -ExistingWorkspaceResourceGroup rg-shared-monitoring
```

The custom `*_CL` table is created in the existing workspace (other tables are
left untouched). You can also set `existingWorkspaceName` /
`existingWorkspaceResourceGroup` directly in
[infra/main.bicepparam](infra/main.bicepparam) instead of passing them on the
command line.

## Device authentication (device-signed JWT)

By default the endpoint is protected only by the **function key** — a shared
secret copied to every device. You can optionally require each device to prove
possession of its **Entra-join (MS-Organization-Access) certificate** by signing
a short-lived JWT, exactly like the Autopilot Credential Portal. The function key
stays in place as a cheap second gate.

This is **off by default**, so you can deploy the code before any device is ready
and turn it on later with **no code changes** — everything is driven by Function
App settings.

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
| `JWT_ENFORCE` | `false` | Master switch. `true` requires a valid device JWT on every request. |
| `JWT_EXPECTED_AUDIENCE` | *(auto)* | The JWT `aud` must equal this. Defaults automatically to this Function App's own hostname (`https://<func>.azurewebsites.net`); set it only to override for a custom domain. |
| `JWT_ALLOWED_TENANT_ID` | *(empty)* | If set, pins requests to one Entra tenant (`tid` claim). |
| `JWT_REQUIRE_ENTRA_DEVICE` | `true` | `true` validates the cert against the Entra device record (needs Graph `Device.Read.All`). `false` validates signature + `MS-Organization-Access` issuer only (no Graph permission). |

Set them via Bicep params (`jwtEnforce`, `jwtExpectedAudience`,
`jwtAllowedTenantId`, `jwtRequireEntraDevice`) or directly on the Function App.

### Enable it

1. **Deploy with enforcement on** (also grants the Graph permission):
   ```powershell
   ./deploy.ps1 -ResourceGroup rg-loging-dev -Location eastus -EnableDeviceJwt
   ```
2. **Turn on the client side** in [scripts/remediate.ps1](scripts/remediate.ps1):
   set `$UseDeviceJwt = $true` and repackage the Proactive Remediation.

> Roll it out in this order: deploy the code (enforcement off) → set
> `$UseDeviceJwt = $true` and confirm devices send valid JWTs → flip
> `JWT_ENFORCE` to `true`. This avoids locking out devices mid-rollout.

### Graph permission (only when `JWT_REQUIRE_ENTRA_DEVICE=true`)

The Function's managed identity needs Microsoft Graph **`Device.Read.All`**
(application). `deploy.ps1 -EnableDeviceJwt` assigns it automatically. To grant it
manually:

```powershell
$rg   = 'rg-loging-dev'
$func = '<function-app-name>'
$miId = az functionapp identity show -g $rg -n $func --query principalId -o tsv
$graphId = az ad sp list --filter "appId eq '00000003-0000-0000-c000-000000000000'" --query '[0].id' -o tsv
$body = @{ principalId = $miId; resourceId = $graphId; appRoleId = '7438b122-aefc-4978-80ed-43db9fcc7715' } | ConvertTo-Json -Compress
az rest --method POST --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miId/appRoleAssignments" --headers 'Content-Type=application/json' --body $body
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

## Add or remove a collected field

1. Edit [schema/columns.json](schema/columns.json) (add/remove a column).
2. Update `Get-DeviceData` in [scripts/remediate.ps1](scripts/remediate.ps1) so
   the uploaded object includes/excludes that property.
3. Redeploy:
   ```powershell
   ./deploy.ps1 -ResourceGroup rg-loging-dev -Location eastus -SkipFunctionPublish
   ```
   The table and DCR are regenerated; existing data is preserved and the Function
   code is unchanged.

> Column types allowed in `columns.json`: `string`, `int`, `long`, `real`,
> `boolean`, `datetime`, `dynamic`, `guid`. A `TimeGenerated` (`datetime`)
> column is required.

## Test

```powershell
Invoke-RestMethod -Method Post `
  -Uri 'https://<func>.azurewebsites.net/api/Ingest?code=<key>' `
  -ContentType 'application/json' `
  -Body '[{ "TimeGenerated": "2026-06-11T00:00:00Z", "DeviceName": "test", "Status": "Remediated" }]'
```

Then query in Log Analytics (data appears within ~5–10 minutes):

```kusto
DeviceRemediation_CL
| sort by TimeGenerated desc
| take 20
```

## Project layout

| Path | Purpose |
| --- | --- |
| `schema/columns.json` | Single source of truth for the table + DCR schema |
| `infra/main.bicep` | LAW (new or existing), custom table, DCR (Direct), Function App, role assignment |
| `infra/main.bicepparam` | Deployment parameters |
| `function/Ingest/run.ps1` | Schema-agnostic forwarder to the DCR endpoint |
| `function/Modules/DeviceJwtAuth/` | Device-JWT request authentication (proof-of-possession) |
| `scripts/remediate.ps1` | Intune detection-slot script (collects + uploads) |
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
  query string or the key was rotated. If `JWT_ENFORCE=true`, a `401` also means
  the `Authorization: Bearer <jwt>` header is missing/invalid — check the device
  is Entra-joined, `$UseDeviceJwt = $true` in `remediate.ps1`, and (when
  `JWT_REQUIRE_ENTRA_DEVICE=true`) that the managed identity has Graph
  `Device.Read.All`.
