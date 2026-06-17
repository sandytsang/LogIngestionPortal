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

## License

MIT (see LICENSE).
