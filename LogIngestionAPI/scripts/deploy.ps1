<#
.SYNOPSIS
    One-command deploy/update for the Log Ingestion solution.

.DESCRIPTION
    Validates schema/columns.json, deploys (or updates) the infrastructure from
    infra/main.bicep, publishes the Function App code, and prints a ready-to-run
    test command plus the values needed by the device remediation script.

    Run this same script whenever you add or remove a column in
    schema/columns.json - the table and DCR are regenerated from that file, so a
    single redeploy keeps everything in sync. The Function code never changes.

.PARAMETER ResourceGroup
    Target resource group. Created if it does not exist.

.PARAMETER Location
    Azure region (e.g. eastus). Used when creating the resource group.

.PARAMETER SkipFunctionPublish
    Only deploy infrastructure; skip publishing the Function App code.

.PARAMETER EnableDeviceJwt
    Turn on device-signed JWT enforcement (sets jwtEnforce=true) and grant the
    Function's managed identity the Microsoft Graph Device.Read.All permission.
    Also set $UseDeviceJwt = $true in scripts/remediate.ps1 before packaging.

.PARAMETER ExistingWorkspaceName
    Name of an existing Log Analytics workspace to reuse instead of creating a
    new one. If the workspace is in a different resource group, also pass
    -ExistingWorkspaceResourceGroup.

.PARAMETER ExistingWorkspaceResourceGroup
    Resource group of the existing Log Analytics workspace (defaults to the
    deployment resource group).

.EXAMPLE
    ./deploy.ps1 -ResourceGroup rg-loging-dev -Location eastus

.EXAMPLE
    ./deploy.ps1 -ResourceGroup rg-loging-dev -Location eastus -ExistingWorkspaceName my-law
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$ResourceGroup,
    [Parameter(Mandatory)] [string]$Location,
    [string]$ExistingWorkspaceName,
    [string]$ExistingWorkspaceResourceGroup,
    [switch]$EnableDeviceJwt,
    [switch]$SkipFunctionPublish
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$schemaPath = Join-Path $root 'schema\columns.json'
$bicepPath = Join-Path $root 'infra\main.bicep'
$paramPath = Join-Path $root 'infra\main.bicepparam'
$functionPath = Join-Path $root 'function'

# --- 1. Validate the schema -------------------------------------------------
Write-Host '==> Validating schema/columns.json' -ForegroundColor Cyan
$schema = Get-Content $schemaPath -Raw | ConvertFrom-Json

if (-not $schema.tableName) { throw 'columns.json must define a tableName.' }
if ($schema.tableName -notmatch '_CL$') { throw "Custom table name must end with '_CL' (got '$($schema.tableName)')." }
if (-not $schema.columns -or $schema.columns.Count -eq 0) { throw 'columns.json must define at least one column.' }

$allowedTypes = @('string', 'int', 'long', 'real', 'boolean', 'datetime', 'dynamic', 'guid')
$names = @{}
foreach ($col in $schema.columns) {
    if (-not $col.name) { throw 'Every column must have a name.' }
    if ($col.type -notin $allowedTypes) { throw "Column '$($col.name)' has unsupported type '$($col.type)'. Allowed: $($allowedTypes -join ', ')." }
    if ($names.ContainsKey($col.name)) { throw "Duplicate column name '$($col.name)'." }
    $names[$col.name] = $true
}
if (-not $names.ContainsKey('TimeGenerated')) { throw "columns.json must include a 'TimeGenerated' (datetime) column." }
Write-Host "    OK - $($schema.columns.Count) columns, table '$($schema.tableName)'." -ForegroundColor Green

# --- 2. Ensure the resource group exists ------------------------------------
Write-Host "==> Ensuring resource group '$ResourceGroup'" -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location --output none

# --- 3. Deploy infrastructure -----------------------------------------------
Write-Host '==> Deploying infrastructure (bicep)' -ForegroundColor Cyan
$deploymentName = "loging-$(Get-Date -Format 'yyyyMMddHHmmss')"
$paramOverrides = @("location=$Location")
if ($ExistingWorkspaceName) { $paramOverrides += "existingWorkspaceName=$ExistingWorkspaceName" }
if ($ExistingWorkspaceResourceGroup) { $paramOverrides += "existingWorkspaceResourceGroup=$ExistingWorkspaceResourceGroup" }
if ($EnableDeviceJwt) {
    $paramOverrides += 'jwtEnforce=true'
    Write-Host '    Device-JWT enforcement will be enabled (jwtEnforce=true).' -ForegroundColor Green
}
if ($ExistingWorkspaceName) {
    Write-Host "    Reusing existing Log Analytics workspace '$ExistingWorkspaceName'." -ForegroundColor Green
}

# DCR deployments occasionally fail with a transient 'Data collection rule has
# been modified before operation completed' conflict. Retry a few times since the
# deployment is idempotent.
$maxDeployAttempts = 3
$outputJson = $null
for ($deployAttempt = 1; $deployAttempt -le $maxDeployAttempts; $deployAttempt++) {
    $deployName = "$deploymentName-$deployAttempt"
    $outputJson = az deployment group create `
        --resource-group $ResourceGroup `
        --name $deployName `
        --template-file $bicepPath `
        --parameters $paramPath $paramOverrides `
        --query properties.outputs `
        --output json
    if ($LASTEXITCODE -eq 0) { break }
    if ($deployAttempt -lt $maxDeployAttempts) {
        Write-Host "    Deployment attempt $deployAttempt failed (often a transient DCR conflict); retrying..." -ForegroundColor Yellow
        Start-Sleep -Seconds 15
    }
    else {
        throw 'Infrastructure deployment failed.'
    }
}

$outputs = $outputJson | ConvertFrom-Json
$functionAppName = $outputs.functionAppName.value
$functionHost = $outputs.functionAppHostName.value
Write-Host "    OK - Function App '$functionAppName'." -ForegroundColor Green

# --- 4. Publish the Function App code ---------------------------------------
if (-not $SkipFunctionPublish) {
    Write-Host '==> Publishing Function App code' -ForegroundColor Cyan
    if (-not (Get-Command func -ErrorAction SilentlyContinue)) {
        throw 'Azure Functions Core Tools (func) not found. Install it or rerun with -SkipFunctionPublish and deploy the code manually.'
    }
    Push-Location $functionPath
    try {
        func azure functionapp publish $functionAppName --powershell
        if ($LASTEXITCODE -ne 0) { throw 'Function publish failed.' }
    }
    finally {
        Pop-Location
    }
    Write-Host '    OK - Function code published.' -ForegroundColor Green
}

# --- 5. Grant the Function's managed identity Graph Device.Read.All ---------
# Only needed when device-JWT enforcement validates against the Entra device
# record (jwtRequireEntraDevice=true, the default). Idempotent.
if ($EnableDeviceJwt) {
    Write-Host '==> Granting Graph Device.Read.All to the Function managed identity' -ForegroundColor Cyan
    $miPrincipalId = az functionapp identity show --resource-group $ResourceGroup --name $functionAppName --query principalId --output tsv 2>$null
    if (-not $miPrincipalId) {
        Write-Warning '    Could not resolve the Function managed identity principalId. Grant Device.Read.All manually (see README).'
    }
    else {
        $graphAppId = '00000003-0000-0000-c000-000000000000'
        $deviceReadAllRoleId = '7438b122-aefc-4978-80ed-43db9fcc7715'
        $graphSpId = az ad sp list --filter "appId eq '$graphAppId'" --query '[0].id' --output tsv
        $existing = az rest --method GET `
            --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miPrincipalId/appRoleAssignments" `
            --query "value[?appRoleId=='$deviceReadAllRoleId'] | [0].id" --output tsv 2>$null
        if ($existing) {
            Write-Host '    OK - Device.Read.All already assigned.' -ForegroundColor Green
        }
        else {
            $body = @{ principalId = $miPrincipalId; resourceId = $graphSpId; appRoleId = $deviceReadAllRoleId } | ConvertTo-Json -Compress
            az rest --method POST `
                --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miPrincipalId/appRoleAssignments" `
                --headers 'Content-Type=application/json' `
                --body $body --output none
            if ($LASTEXITCODE -ne 0) {
                Write-Warning '    Failed to assign Device.Read.All (you may lack Graph admin rights). Grant it manually (see README) or set jwtRequireEntraDevice=false.'
            }
            else {
                Write-Host '    OK - Device.Read.All assigned (propagation may take a few minutes).' -ForegroundColor Green
            }
        }
    }
}

# --- 6. Retrieve the function key and print next steps ----------------------
Write-Host '==> Retrieving function key' -ForegroundColor Cyan
$functionKey = az functionapp function keys list `
    --resource-group $ResourceGroup `
    --name $functionAppName `
    --function-name Ingest `
    --query default --output tsv 2>$null

$ingestUrl = "https://$functionHost/api/Ingest"

Write-Host ''
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host ' Deployment complete' -ForegroundColor Yellow
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host "Function URL : $ingestUrl"
if ($functionKey) {
    Write-Host "Function key : $functionKey"
    Write-Host ''
    Write-Host 'Set these two values at the top of scripts/remediate.ps1 before packaging for Intune.'
    Write-Host ''
    Write-Host 'Quick test (PowerShell):' -ForegroundColor Cyan
    $sample = '[{ \"TimeGenerated\": \"' + (Get-Date).ToUniversalTime().ToString('o') + '\", \"DeviceName\": \"test-host\", \"Status\": \"Remediated\", \"Details\": \"manual test\" }]'
    Write-Host "Invoke-RestMethod -Method Post -Uri '$ingestUrl?code=$functionKey' -ContentType 'application/json' -Body '$sample'"
} else {
    Write-Host 'Function key not available yet (code may still be deploying). Retrieve it later with:'
    Write-Host "az functionapp function keys list -g $ResourceGroup -n $functionAppName --function-name Ingest --query default -o tsv"
}
Write-Host ''
Write-Host "Query results in Log Analytics:  $($schema.tableName) | take 20"
