# RBAC and permissions

Every identity the solution uses and the roles each one needs. There are three:
the **deployer**, the **Function App managed identity**, and (for CI) the
**GitHub OIDC identity**.

## 1. Deployer (whoever runs `deploy.ps1` or the workflow)

| Capability | Role | Scope | When needed |
|------------|------|-------|-------------|
| Create/update resources | **Contributor** | Target subscription or resource group(s) | Always. |
| Create the DCR role assignment | **User Access Administrator** (or Owner) | DCR resource group | Only if you let the deployment assign **Monitoring Metrics Publisher** (i.e. you do **not** pass `-SkipDcrRoleAssignment`). |
| Grant Graph Device.Read.All | Entra **Privileged Role Administrator** or **Global Administrator** | Tenant | Only to grant the app permission (often a different admin — use `scripts/AssignMSIPermisison.ps1`). |

If the deployer is Contributor-only, run with `-SkipDcrRoleAssignment` and have
an admin grant the DCR role and the Graph permission separately. The script
prints the exact commands.

## 2. Function App managed identity (system-assigned)

The Function authenticates outbound calls with its managed identity — no secrets
are stored.

| Permission | Type | Scope | Why |
|------------|------|-------|-----|
| **Monitoring Metrics Publisher** | Azure RBAC role | DCR resource group | Publish records to the DCR `logsIngestion` endpoint. Without it, ingestion returns `403`. |
| **Device.Read.All** | Microsoft Graph **application** permission | Tenant | Resolve the device in Entra and validate the cert against `alternativeSecurityIds`. Required when `JWT_REQUIRE_ENTRA_DEVICE=true` (default). Without it, every request returns `401`. |

### Granting Device.Read.All after deployment

If the deployer couldn't grant it (needs a Graph admin), run:

```powershell
./scripts/AssignMSIPermisison.ps1 -ResourceGroup <rg> -FunctionAppName <func>
```

This is idempotent. Propagation can take a few minutes. (Graph app-role id
`7438b122-aefc-4978-80ed-43db9fcc7715` = Device.Read.All.)

### If you don't want to grant Graph

Set `JWT_REQUIRE_ENTRA_DEVICE=false`. The Function then validates the signature,
the `MS-Organization-Access` issuer, and the cert thumbprint **without** a Graph
lookup. This is weaker (no live device-enabled/registered check) — see
[Security hardening](security-hardening.md).

## 3. GitHub OIDC identity (CI only)

For the `deploy.yml` / `update-columns.yml` workflows, authentication is
passwordless via OpenID Connect.

| Item | Value |
|------|-------|
| Entra app registration | With a **federated credential** for your repo + branch. |
| Repo secrets | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. |
| Workflow permission | `id-token: write`. |
| Service principal RBAC | **Contributor** (+ **User Access Administrator** if the workflow creates the DCR role assignment). |

```mermaid
flowchart LR
    A[GitHub repo] --> B[Actions workflow]
    B --> C[OIDC token]
    C --> D[Entra app + federated credential]
    D --> E[Azure login]
    E --> F[Subscription / resource group]
    F --> G[Function App + DCR + Log Analytics]
```

Microsoft references:
- GitHub Actions to Azure with OIDC:
  https://learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect
- Configure a federated identity credential:
  https://learn.microsoft.com/entra/workload-id/workload-identity-federation-create-trust?pivots=identity-wif-apps-methods-azp

## Least-privilege summary

- Deployer: **Contributor**, plus **User Access Administrator** only if
  assigning roles during deploy.
- Function identity: **Monitoring Metrics Publisher** (DCR RG) + **Device.Read.All**
  (Graph, unless `JWT_REQUIRE_ENTRA_DEVICE=false`).
- No client secrets or connection strings for outbound auth — managed identity
  and OIDC only.
