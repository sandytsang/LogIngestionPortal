# Run from the LogIngestionAPI repo after replacing schema/columns.json
# with the generated file. Requires Azure CLI (az) + Functions Core Tools (func)
# signed in to your own tenant. Nothing runs outside your session.
./scripts/deploy.ps1 `
  -ResourceGroup <your-resource-group> `
  -Location <your-region> `
  -ExistingWorkspaceName log-shared-central
