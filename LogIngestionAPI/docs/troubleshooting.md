# Troubleshooting

Common failures, what causes them, and how to fix them. Grouped by where the
symptom appears.

## Where to look first

| Source | What it shows | How to access |
|--------|---------------|---------------|
| Intune **IME log** | The device script's own diagnostics. | On device: `C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\LogIngestion-Remediate.log` |
| Intune **Output column** | The last stdout line + exit code from the detection script. | Intune admin center → Remediations. |
| **Function App logs / App Insights** | Auth rejections, DCR errors, exceptions. | Azure portal → Function App → Log stream, or Application Insights. |
| **Log Analytics (KQL)** | Whether rows actually landed. | `MyTable_CL | take 20` |

## Authentication (HTTP 401)

The Function rejects any request without a valid device JWT. The response body
includes a `reason`. Match it below.

| Reason / symptom | Cause | Fix |
|------------------|-------|-----|
| `Device JWT signing requires SYSTEM context` (script-side error) | The Entra-join cert private key is TPM-bound and only readable as SYSTEM. | Run via Intune Proactive Remediation with **Run this script using the logged-on credentials = No**, or locally with `psexec -s -i powershell.exe`. |
| `Directory lookup failed` / `Unknown device` | `JWT_REQUIRE_ENTRA_DEVICE=true` but the Function managed identity lacks Graph **Device.Read.All**, or the device isn't in Entra. | Grant the permission with `scripts/AssignMSIPermisison.ps1`, or set `JWT_REQUIRE_ENTRA_DEVICE=false` (see [Security hardening](security-hardening.md)). |
| `Tenant not allowed` | `JWT_ALLOWED_TENANT_ID` doesn't match the device's tenant. | Correct the app setting (or clear it to disable the pin). |
| `Certificate chain validation failed` | Chain couldn't build, or root/intermediate pin didn't match. | Verify the device cert; check `JWT_TRUSTED_ROOT_THUMBPRINTS` / `JWT_TRUSTED_INTERMEDIATE_THUMBPRINTS`. For troubleshooting only, temporarily set `JWT_REQUIRE_CERT_CHAIN=false`. |
| `Client cert not trusted by Entra device record` | The presented cert isn't registered in the device's `alternativeSecurityIds`. | Ensure the device is properly Entra-joined and re-registered. |
| `Token expired` / `iat is in the future` | Device clock skew beyond the allowed window (300s). | Fix device time sync. |

## Ingestion (HTTP 502 / records missing)

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502` returned by the Function | The DCR returned an error (stream missing, `transformKql` mismatch). | Confirm the `Custom-<table>` stream exists in the DCR and that the table name in the body matches. Re-run the schema update. |
| `403` from the DCR endpoint | The Function managed identity lacks **Monitoring Metrics Publisher** on the DCR's resource group. | Assign the role (deploy without `-SkipDcrRoleAssignment`, or run the printed `az role assignment create`). See [RBAC](rbac-and-permissions.md). |
| `200` but no rows appear | Column name mismatch (properties not in `columns.json` are dropped by the DCR), or normal ingestion latency. | Align property names to `columns.json`; allow a few minutes; then query again. |
| Large payload partly missing | Records over the ~950 KB batch limit are skipped. | Reduce per-record size, or split telemetry across multiple records/tables. |
| `MissingDefaultStream` (400) | A bare array/object was sent but no `DCR_STREAMS` default table is configured. | Send a table-keyed body `{ "MyTable_CL": [ ... ] }`, or set `DCR_STREAMS`. |

## Deployment

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Failed to check resource group ... authorization/context error` | `az` is pointed at a different subscription/tenant than expected. | `az account set --subscription <name-or-id>`, or pass `-Subscription`. |
| Function App name prompt / "other functions will be hidden" | The chosen name already exists in your subscription; zip deploy replaces its content. | Confirm, choose another name, or pass `-Force` for unattended runs. |
| `Invalid -DcrName` | Direct DCR names must be 3–30 chars, letters/numbers/hyphens, not start/end with `-`. | Pick a compliant name (e.g. `dcr-logingestion-dev`). |
| Role assignment step fails | Deployer has only Contributor (cannot create role assignments). | Use `-SkipDcrRoleAssignment` and grant the role separately, or add **User Access Administrator**. |
| Flex plan deploy fails | Flex Consumption isn't available in the chosen region. | Use `-FunctionPlanType Consumption`, or choose a supported region. |

## Quick verification KQL

```kusto
// Did anything arrive in the last hour?
Devices_CL
| where TimeGenerated > ago(1h)
| summarize count() by DeviceName
| order by count_ desc
```

```kusto
// Inspect the most recent records
Devices_CL
| top 20 by TimeGenerated desc
```
