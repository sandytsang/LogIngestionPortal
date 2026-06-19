# Log Ingestion Portal

Collect Windows device telemetry with Intune Proactive Remediations and send it
to Log Analytics custom tables through Azure Functions and Logs Ingestion API.

Portal URL:
https://sandytsang.github.io/LogIngestionPortal/

## What this solution does

1. You pick fields in the web portal.
2. The portal generates:
   - schema/columns.json
   - scripts/IntuneScript.ps1
  - portal-config.json (for import/export of portal configuration)
   - README.txt with deploy commands
3. You run deploy.ps1 to create or update Azure resources.
4. Devices run IntuneScript.ps1 and send data to your Function App.

## Repository layout

- LogIngestionPortalWebPortal/
  - Browser-only generator app (React + Vite)
- LogIngestionAPI/
  - Azure deployment (Bicep + PowerShell Function + scripts)

## Quick start

1. Open the portal and click Download all (.zip).
2. Unzip and open LogIngestionAPI.
3. Run the command from README.txt (generated for your selections).
4. Upload IntuneScript.ps1 as your Intune detection script.

## Which README to use

- This README: overall solution and quick start.
- LogIngestionAPI/README.md: deployment and operations details.
- LogIngestionPortalWebPortal/README.md: portal development and contribution.

## Detailed documentation

In-depth guides are listed below (and in [LogIngestionAPI/README.md](LogIngestionAPI/README.md)):

- [Architecture overview](LogIngestionAPI/docs/architecture-overview.md)
- [Device authentication: JWT + certificate chain](LogIngestionAPI/docs/device-jwt-authentication.md)
- [Deployment reference](LogIngestionAPI/docs/deployment-reference.md)
- [Schema and columns](LogIngestionAPI/docs/schema-and-columns.md)
- [RBAC and permissions](LogIngestionAPI/docs/rbac-and-permissions.md)
- [Security hardening](LogIngestionAPI/docs/security-hardening.md)
- [Testing and CI](LogIngestionAPI/docs/testing-and-ci.md)
- [Troubleshooting](LogIngestionAPI/docs/troubleshooting.md)
- [Manual permission fallback runbook](LogIngestionAPI/docs/manual-permission-fallback-runbook.md)
- [Catalog authoring](LogIngestionPortalWebPortal/docs/catalog-authoring.md)

## License

MIT (see LICENSE).
