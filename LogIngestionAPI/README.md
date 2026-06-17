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

Starting from a clean machine you need these tools (the deploy script checks for
them and prints hints if anything is missing):

- **PowerShell 7+** — `winget install Microsoft.PowerShell`
- **Azure CLI (`az`)** — `winget install Microsoft.AzureCLI` (or <https://aka.ms/installazurecli>).
  The Bicep CLI is installed automatically by `az` the first time it compiles a template.
- **Azure Functions Core Tools v4 (`func`)** — optional. If installed, `deploy.ps1`
  uses it as the preferred publish path. If not installed, `deploy.ps1` falls back to
  Azure CLI zip deploy automatically.

Then sign in: `az login` (and `az account set --subscription <name-or-id>`). You
need permission to create resources and role assignments. Granting the device
check's Graph `Device.Read.All` also needs an admin who can consent to Graph app
roles (see below).

## No-admin local machine option (Azure Cloud Shell)

If users cannot install tools locally because they do not have local admin rights,
run the deployment from **Azure Cloud Shell** in a browser. Cloud Shell already has
Azure CLI + Bicep and does not require local installation.

1. Open Cloud Shell: <https://shell.azure.com>.
2. Upload your generated `columns.json` to Cloud Shell (Upload/Download in the Cloud Shell toolbar), then use the exact uploaded path shown in your shell. Most commonly this is `/home/<your-user>/columns.json` (and in some setups it may be under `/home/<your-user>/clouddrive/`).
3. Clone this repo and run the script with `-SchemaPath`:

```bash
git clone https://github.com/sandytsang/LogIngestionPortal.git
cd LogIngestionPortal/LogIngestionAPI/scripts
pwsh ./deploy.ps1 \
  -Subscription <subscription-name-or-id> \
  -ResourceGroup rg-logging-dev \
  -Location eastus \
  -FunctionAppName func-logingestion-dev \
  -WorkspaceName log-logingestion-dev \
  -DcrName dcr-logingestion-dev \
  -SchemaPath /home/<your-user>/columns.json
```

If you do not pass `-SchemaPath`, the script uses the repo file at
`LogIngestionAPI/schema/columns.json`.
Use `-Subscription` so deployment runs in the intended Azure CLI context.

Notes:

- Cloud Shell solves the **local install/admin** problem only.
- You still need the correct **Azure RBAC / Entra admin permissions** for resource creation,
  role assignments, and Graph `Device.Read.All` consent.

## Deploy

```powershell
cd scripts
./deploy.ps1 -ResourceGroup rg-logging-dev -Location eastus `
  -FunctionAppName func-logingestion-dev `
  -WorkspaceName log-logingestion-dev `
  -DcrName dcr-logingestion-dev
```

The script prints the **Function URL** and **function key**. Paste the full
invoke URL into the top of [scripts/IntuneScript.ps1](scripts/IntuneScript.ps1), then
upload it as the **detection** script of an Intune Proactive Remediation and
schedule it (no remediation script is needed - the script does the work and
reports compliant).

> Missing resource groups are created automatically. If you lack permission to
> create one, the script stops and prints the exact `az group create` command to
> run (or hand to an admin). Existing resource groups are reused unchanged.

Every resource is **upserted**: created if missing, updated in place if it
already exists. The Function App name has no random hash. If an app with your
chosen name already exists in your subscription, `deploy.ps1` shows a warning
and confirmation prompt before publishing into it (because zip deploy replaces
all functions in that app). If the name is globally unavailable in another
tenant, the deployment stops and asks for a different name.

### Put workspace / DCR in different resource groups (and workspace region)

The Function App (plus storage, Application Insights, and App Service plan) is
always in `-ResourceGroup`. By default the workspace and DCR are also in that RG,
but you can place them elsewhere:

```powershell
./deploy.ps1 -ResourceGroup rg-fn -Location eastus `
  -FunctionAppName func-logingestion-dev `
  -WorkspaceName log-shared-monitoring `
  -DcrName dcr-logingestion-dev `
  -WorkspaceResourceGroup rg-shared-monitoring `
  -WorkspaceLocation westeurope `
  -DcrResourceGroup rg-dcr
```

If the workspace already exists, its current region is reused automatically
(workspace location cannot be changed in place).

## Deploy from your own GitHub (Actions)

Prefer a pipeline over running the script by hand? This folder ships two
ready-to-use GitHub Actions workflows in
[.github/workflows](.github/workflows). When you push **this `LogIngestionAPI`
folder as the root of your own repository** (for example, the folder you get
from the portal's download bundle), GitHub picks them up automatically:

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [validate.yml](.github/workflows/validate.yml) | PR / push | Compiles the Bicep and sanity-checks `schema/columns.json`. No Azure login needed. |
| [deploy.yml](.github/workflows/deploy.yml) | Manual (**Run workflow**) | Deploys the full stack (Function App + table + DCR). Pick `method: native` (Bicep + `functions-action`) or `method: script` (runs `scripts/deploy.ps1`). |
| [update-columns.yml](.github/workflows/update-columns.yml) | Manual (**Run workflow**) | Schema-only update — refreshes just the table + DCR after a `columns.json` change; the Function App is left untouched. Requires the target workspace + DCR names/resource groups. Pick `method: native` or `method: script`. |

You choose how to deploy — the **same `deploy.ps1`** you'd run locally, or a
fully native pipeline. Both authenticate to Azure with **OIDC (passwordless)**,
so no secrets/keys are stored.

### One-time setup

1. **Create an Entra app registration** (or reuse one) and add a **federated
   credential** for your repo. In the app registration → *Certificates &
   secrets* → *Federated credentials* → *Add*, choose **GitHub Actions** and set:
   - Organization/owner = your GitHub user/org, Repository = your repo
   - Entity type = **Branch**, value = your default branch (e.g. `main`).

   > **Use Branch (default).** Both workflows run with branch-based OIDC, so the
   > token subject is `repo:<owner>/<repo>:ref:refs/heads/<branch>` (e.g.
   > `repo:sandytsang/LogIngestionAPI:ref:refs/heads/main`). One **Branch**
   > credential covers both `deploy.yml` and `update-columns.yml`. Keep
   > **Audience** = `api://AzureADTokenExchange` (the default).
   >
   > If `AADSTS700213: No matching federated identity record found …
   > ref:refs/heads/main` appears, the credential's subject doesn't match — make
   > sure it's a **Branch** credential for the branch you run from.
   >
   > **Want per-environment approval gates?** Add
   > `environment: ${{ inputs.environment }}` back to the job in `deploy.yml`;
   > the subject then becomes `…:environment:<env>` and you register one
   > **Environment** credential per environment (`dev`, `test`, `prod`) instead.

   New to this? Microsoft's step-by-step guide:
   [Configure a federated identity credential on an app](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation-create-trust?pivots=identity-wif-apps-methods-azp#configure-a-federated-identity-credential-on-an-app).
2. **Assign Azure roles** to that app registration's service principal on the
   target subscription or resource group. These are **Azure RBAC roles** — the
   app registration needs **no Microsoft Graph / API permissions** of its own:
   - **Contributor** — create the Function App, storage, workspace and DCR.
   - **User Access Administrator** (or **Owner**, which already includes it) —
     the Bicep assigns the Function's managed identity *Monitoring Metrics
     Publisher* on the DCR, and creating a role assignment needs this. Contributor
     alone cannot create role assignments.
     *Contributor-only option:* if you can't grant this, set the
     **`skipRoleAssignment`** input to `true` when you run the workflow — the
     deploy then needs only **Contributor**, and you grant *Monitoring Metrics
     Publisher* on the DCR separately afterwards (the run log / `deploy.ps1`
     prints the exact `az role assignment create` command).

   > **Grant the roles on *every* resource group the deploy touches, not just
   > the target RG.** Contributor on the target RG only covers resources created
   > there. If you **reuse an existing workspace** in another RG, or put the
   > **DCR in its own RG**, the deploy writes into those RGs too and needs
   > **Contributor** on each — otherwise you get `Authorization failed … does not
   > have permission to perform action 'Microsoft.OperationalInsights/workspaces/tables/write'`
   > (or `Microsoft.Resources/deployments/write`). Roles to assign:
   >
   > | Resource group | Role |
   > | --- | --- |
   > | Target / Function RG | Contributor |
   > | Existing workspace RG (only when reusing a workspace in another RG) | Contributor |
   > | DCR RG (only when the DCR is in its own RG) | Contributor |
   > | DCR scope — for the publisher role assignment | User Access Administrator / Owner, or use `skipRoleAssignment` |
   >
   > Simplest option: assign **Contributor** (plus **User Access Administrator**)
   > once at the **subscription** scope — it covers every RG automatically.

   > The device check's Graph **Device.Read.All** is granted to the Function
   > App's **managed identity** (a separate identity created at deploy time), not
   > to this app registration — so don't add any Graph application permissions to
   > the app registration itself. See [After it runs](#after-it-runs) below.
3. **Add three repo secrets** (Settings → Secrets and variables → Actions):
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
   Need help? Microsoft's guide:
   [Create GitHub secrets](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect#create-github-secrets).
4. Run **Actions → Deploy LogIngestionAPI → Run workflow** and fill in the
  resource group, function app/workspace/DCR names, regions, and plan.

### After it runs

- If you left `requireEntraDevice` on (the default), grant the Function's
  managed identity Graph **Device.Read.All** once — CI usually can't because that
  needs an Entra admin. Run [scripts/AssignMSIPermisison.ps1](scripts/AssignMSIPermisison.ps1)
  (or set `requireEntraDevice: false` to skip device-record validation).
- Copy the **function key** and **URL** from the Azure portal (Function App →
  Functions → `DCRLogIngestionAPI` → *Function Keys*) into your Intune script.

> Tip: to require manual approval before a `prod` deploy, create a GitHub
> **Environment** named `prod` with a required reviewer — the `deploy.yml` job
> already binds to the selected `environment`.

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
  ./deploy.ps1 -ResourceGroup rg-logging-dev -Location eastus `
    -FunctionAppName func-logingestion-dev `
    -WorkspaceName log-logingestion-dev `
    -DcrName dcr-logingestion-dev
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
$rg   = 'rg-logging-dev'
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
`az functionapp deployment source config-zip` (Entra), or temporarily re-enable
SCM basic auth just for that publish.

## Add or remove a collected field

1. Edit [schema/columns.json](schema/columns.json) (add/remove a column).
2. Update `Get-DeviceData` in [scripts/IntuneScript.ps1](scripts/IntuneScript.ps1) so
   the uploaded object includes/excludes that property.
3. Redeploy — either a full deploy, or a lighter **schema-only** update that
   touches just the table + DCR (the Function App is left untouched):
   ```powershell
   # Schema-only update (recommended for column changes)
   ./deploy.ps1 -SchemaOnly `
     -WorkspaceName log-logingestion-dev `
     -WorkspaceResourceGroup rg-logging-dev `
     -DcrName dcr-logingestion-dev `
     -DcrResourceGroup rg-logging-dev

   # Or a full redeploy without republishing the Function code
   ./deploy.ps1 -ResourceGroup rg-logging-dev -Location eastus `
     -FunctionAppName func-logingestion-dev `
     -WorkspaceName log-logingestion-dev `
     -DcrName dcr-logingestion-dev `
     -SkipFunctionPublish
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
