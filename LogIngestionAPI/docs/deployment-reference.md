# Deployment reference

Reference for [`scripts/deploy.ps1`](../scripts/deploy.ps1): what it does, every
parameter, and common scenarios. For role/permission details see
[RBAC and permissions](rbac-and-permissions.md).

## What `deploy.ps1` does

1. Validates `schema/columns.json`.
2. Deploys/updates infrastructure from `infra/main.bicep` (Log Analytics
   workspace + custom tables, Data Collection Rule, Function App, storage,
   Application Insights, plan).
3. Publishes the Function App code (Core Tools if present, else zip deploy).
4. Optionally grants the Function managed identity Graph **Device.Read.All** and
   **Monitoring Metrics Publisher** on the DCR resource group.
5. Prints a ready-to-run test command and the values the device script needs.

Every resource is **upserted**: created if missing, updated in place if present.
You choose the exact name for every resource (no random hash, no naming
convention is imposed).

## Parameters

| Parameter | Required | Default | Purpose |
|-----------|----------|---------|---------|
| `-ResourceGroup` (alias `-FunctionResourceGroup`) | Yes (full deploy) | — | RG for the Function App, storage, App Insights, plan, and (by default) workspace + DCR. Created if missing. |
| `-Location` | Yes (full deploy) | — | Azure region for new resource groups, the Function App, and a new workspace. |
| `-FunctionAppName` | Yes (full deploy) | — | Exact, globally-unique Function App name (`<name>.azurewebsites.net`). |
| `-WorkspaceName` | Yes | — | Exact Log Analytics workspace name. |
| `-WorkspaceResourceGroup` | No | `-ResourceGroup` | RG of the workspace. |
| `-WorkspaceLocation` | No | `-Location` | Region for a **new** workspace (ignored if it already exists). The DCR always follows the workspace region. |
| `-DcrName` | Yes | — | Exact DCR name (Direct kind: 3–30 chars, letters/numbers/hyphens, no leading/trailing `-`). |
| `-DcrResourceGroup` | No | `-ResourceGroup` | RG for the DCR. Created if missing. |
| `-SchemaPath` | No | `schema/columns.json` | Path to the schema file (useful from Cloud Shell). |
| `-Subscription` (alias `-SubscriptionId`) | No | current `az` context | Force a subscription for `az` commands. |
| `-JwtAllowedTenantId` | No | auto-detected tenant | Sets `JWT_ALLOWED_TENANT_ID`. |
| `-FunctionPlanType` | No | `Consumption` | `Consumption` (Windows Y1) or `Flex` (Linux FC1, PowerShell 7.4). Flex isn't in every region. |
| `-SchemaOnly` | No | off | Update **only** the table + DCR; leave the Function App untouched. |
| `-Force` | No | off | Skip the "Function App name already exists" confirmation (unattended runs). |
| `-SkipDeviceGraphPermission` | No | off | Don't grant Graph Device.Read.All. Only safe with `jwtRequireEntraDevice=false`. |
| `-SkipDcrRoleAssignment` | No | off | Don't create the DCR role assignment (use when deployer is Contributor-only). |
| `-SkipFunctionPublish` | No | off | Deploy infra only; skip publishing Function code. |
| `-EnableDeviceJwt` | No | — | Deprecated/no-op (device JWT is always enforced). |

## Common scenarios

### Standard deploy

```powershell
cd scripts
./deploy.ps1 -ResourceGroup rg-logging-dev -Location eastus `
  -FunctionAppName func-logingestion-dev `
  -WorkspaceName log-logingestion-dev `
  -DcrName dcr-logingestion-dev
```

### Split resource groups (shared workspace/DCR)

```powershell
./deploy.ps1 -ResourceGroup rg-fn -Location eastus `
  -FunctionAppName func-logingestion-dev `
  -WorkspaceName log-shared-monitoring -WorkspaceResourceGroup rg-shared-monitoring `
  -WorkspaceLocation westeurope `
  -DcrName dcr-logingestion-dev -DcrResourceGroup rg-dcr
```

### Contributor-only deploy (no role assignments)

```powershell
./deploy.ps1 -ResourceGroup rg-logging-dev -Location eastus `
  -FunctionAppName func-logingestion-dev `
  -WorkspaceName log-logingestion-dev `
  -DcrName dcr-logingestion-dev `
  -SkipDcrRoleAssignment
```

Then grant **Monitoring Metrics Publisher** separately (the script prints the
exact command).

### Schema-only update (after a `columns.json` change)

```powershell
./deploy.ps1 -SchemaOnly `
  -WorkspaceName log-logingestion-dev -WorkspaceResourceGroup rg-logging-dev `
  -DcrName dcr-logingestion-dev -DcrResourceGroup rg-logging-dev
```

### Cloud Shell (no local install)

```bash
git clone https://github.com/sandytsang/LogIngestionPortal.git
cd LogIngestionPortal/LogIngestionAPI/scripts
pwsh ./deploy.ps1 \
  -Subscription <subscription-name-or-id> \
  -ResourceGroup rg-logging-dev -Location eastus \
  -FunctionAppName func-logingestion-dev \
  -WorkspaceName log-logingestion-dev \
  -DcrName dcr-logingestion-dev \
  -SchemaPath /home/<your-user>/columns.json
```

## Function App settings set by deployment

| Setting | Value | Notes |
|---------|-------|-------|
| `DCR_ENDPOINT` | DCR logs-ingestion endpoint | From the deployed DCR. |
| `DCR_IMMUTABLE_ID` | DCR immutable id | From the deployed DCR. |
| `JWT_ENFORCE` | `true` | Device JWT always required. |
| `JWT_EXPECTED_AUDIENCE` | Function URL | Audience binding. |
| `JWT_ALLOWED_TENANT_ID` | tenant id | From `-JwtAllowedTenantId` or auto-detected. |
| `JWT_REQUIRE_CERT_CHAIN` | `true` | Enforce chain validation. |
| `JWT_REQUIRE_ENTRA_DEVICE` | `true`/`false` | Entra device binding via Graph. |

Optional settings (`JWT_TRUSTED_ROOT_THUMBPRINTS`,
`JWT_TRUSTED_INTERMEDIATE_THUMBPRINTS`, `JWT_CHECK_CERT_REVOCATION`,
`DCR_STREAMS`) are read if present — see [Security hardening](security-hardening.md)
and [Device authentication](device-jwt-authentication.md).

## CI alternative

The same operations are available as GitHub workflows (`deploy.yml`,
`update-columns.yml`). See [Testing and CI](testing-and-ci.md).
