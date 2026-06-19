# Log Ingestion Portal Web App

Browser-only generator for the LogIngestionAPI deployment package.

It helps you pick telemetry fields and produces:
- schema/columns.json
- scripts/IntuneScript.ps1
- portal-config.json (portable app state for future import)
- README.txt (deploy instructions with your selected values)

## What it does

- Runs fully in browser (no backend).
- Uses catalog definitions to keep script and schema in sync.
- Downloads a ready-to-deploy LogIngestionAPI folder.
- Exports and imports portal configuration so users can resume later.

## Use

1. Open the hosted portal.
2. Select fields and deployment settings.
3. Click Download all (.zip).
4. Follow generated README.txt in the zip.

## Develop locally

```powershell
npm install
npm run dev
npm test
npm run build
```

## Main folders

- src/ - app UI and generators
- catalog/ - field and collector catalog
- test/ - unit tests
- scripts/ - helper scripts for catalog and collectors

## Contributing

Add or update fields through:
- In-app Contribute flow, or
- catalog/categories/*.json directly

See [Catalog authoring](docs/catalog-authoring.md) for the field/column schema,
shared setups, and validation steps. For the AppLocker dataset specifically
(row-source schema and incremental, watermark-based collection), see
[AppLocker collection](docs/applocker.md).

Validate before PR:

```powershell
npm run validate
pwsh ./scripts/Test-Collectors.ps1
npm test
```
