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

.PARAMETER FunctionResourceGroup
    Resource group for the Function App, its storage account, Application
    Insights, the App Service plan and (for a new deployment) the Log Analytics
    workspace. This is the deployment's resource group. If it does not exist the
    script tries to create it, and if that fails (no permission) it prints the
    command for you or your admin to run.

.PARAMETER DcrResourceGroup
    Resource group for the Data Collection Rule. Defaults to the Function App
    RG. Created automatically if missing (falls back to a manual instruction
    when you lack permission).

.PARAMETER Location
    Azure region (e.g. eastus). Used when creating resource groups and the
    Function App resources. A new workspace also uses this region; the DCR always
    follows the workspace's region automatically.

.PARAMETER SkipFunctionPublish
    Only deploy infrastructure; skip publishing the Function App code.

.PARAMETER FunctionPlanType
    Function App hosting plan: 'Consumption' (Windows Y1, default) or 'Flex'
    (Linux Flex Consumption FC1, PowerShell 7.4). Flex is not available in every
    region — verify region support before choosing it.

.PARAMETER EnableDeviceJwt
    Deprecated / no longer required. The Graph Device.Read.All grant now runs by
    default because device-JWT enforcement (with the Entra device check) is always
    on. Accepted for backward compatibility but has no extra effect.

.PARAMETER SkipDeviceGraphPermission
    Skip granting the Function's managed identity Microsoft Graph Device.Read.All.
    Only use this if you set jwtRequireEntraDevice=false (so no Graph lookup is
    needed) or you grant the permission separately. Note: with the default
    jwtRequireEntraDevice=true, skipping this makes every request return 401.

.PARAMETER ExistingWorkspaceName
    Name of an existing Log Analytics workspace to reuse instead of creating a
    new one. If the workspace is in a different resource group, also pass
    -ExistingWorkspaceResourceGroup.

.PARAMETER ExistingWorkspaceResourceGroup
    Resource group of the existing Log Analytics workspace (defaults to the
    Function App resource group).

.PARAMETER SchemaOnly
    Update ONLY the Log Analytics custom table + DCR from schema/columns.json.
    The Function App and its dependencies are left untouched. Requires an
    existing workspace and DCR (errors with guidance if either is missing).
    Needs -ExistingWorkspaceName, -ExistingWorkspaceResourceGroup and
    -DcrResourceGroup; -FunctionResourceGroup and -Location are not used.

.PARAMETER BaseName
    Base name used to derive resource names (e.g. func-<baseName>-<environment>).
    Defaults to 'logapi'. Use the SAME value for later updates so names match.

.PARAMETER Environment
    Environment short name: dev (default), test or prod. Appended to every
    resource name (e.g. dcr-logapi-prod). Use the SAME value for later updates.

.EXAMPLE
    ./deploy.ps1 -FunctionResourceGroup rg-loging-dev -Location eastus

.EXAMPLE
    ./deploy.ps1 -FunctionResourceGroup rg-fn -DcrResourceGroup rg-dcr -Location eastus

.EXAMPLE
    # Update data columns only (no Function App changes)
    ./deploy.ps1 -SchemaOnly -ExistingWorkspaceName log-shared -ExistingWorkspaceResourceGroup rg-logs -DcrResourceGroup rg-dcr
#>

[CmdletBinding()]
param(
    [Alias('ResourceGroup')] [string]$FunctionResourceGroup,
    [string]$Location,
    [string]$DcrResourceGroup,
    [string]$ExistingWorkspaceName,
    [string]$ExistingWorkspaceResourceGroup,
    [ValidateSet('Consumption', 'Flex')] [string]$FunctionPlanType,
    [switch]$SchemaOnly,
    [string]$BaseName = 'logapi',
    [ValidateSet('dev', 'test', 'prod')] [string]$Environment = 'dev',
    # Accepted for backward compatibility. The Graph Device.Read.All grant now
    # runs by default (device-JWT enforcement + Entra device check are on by
    # default); use -SkipDeviceGraphPermission to opt out.
    [switch]$EnableDeviceJwt,
    [switch]$SkipDeviceGraphPermission,
    [switch]$SkipFunctionPublish
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$schemaPath = Join-Path $root 'schema\columns.json'
$bicepPath = Join-Path $root 'infra\main.bicep'
$paramPath = Join-Path $root 'infra\main.bicepparam'
$functionPath = Join-Path $root 'function'

# --- 0. Preflight: required tooling -----------------------------------------
# Assumes a clean machine. Checks the CLIs this script needs and prints how to
# install whatever is missing, then stops so nothing fails halfway through.
Write-Host '==> Checking prerequisites' -ForegroundColor Cyan
$missing = @()

# PowerShell 7+ is recommended (the script also parses on 5.1, but 7 is the target).
if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Warning "    PowerShell 7+ recommended (running $($PSVersionTable.PSVersion)). Install: winget install Microsoft.PowerShell"
}

# Azure CLI (az) — always required.
if (Get-Command az -ErrorAction SilentlyContinue) {
    Write-Host '    OK - Azure CLI (az) found.' -ForegroundColor Green
}
else {
    $missing += 'Azure CLI (az)   ->  winget install Microsoft.AzureCLI    (or: https://aka.ms/installazurecli)'
}

# Azure Functions Core Tools (func) — only needed to publish the code (full
# deploy). Never needed for -SchemaOnly (the Function App is not touched).
if (-not $SkipFunctionPublish -and -not $SchemaOnly) {
    if (Get-Command func -ErrorAction SilentlyContinue) {
        Write-Host '    OK - Azure Functions Core Tools (func) found.' -ForegroundColor Green
    }
    else {
        $missing += 'Functions Core Tools v4 (func)   ->  winget install Microsoft.Azure.FunctionsCoreTools    (or: npm i -g azure-functions-core-tools@4 --unsafe-perm true)'
    }
}

if ($missing.Count -gt 0) {
    Write-Host ''
    Write-Warning 'Missing required tools:'
    foreach ($m in $missing) { Write-Host "    - $m" -ForegroundColor White }
    Write-Host ''
    Write-Host 'Install the above (open a new terminal afterwards so PATH refreshes), then re-run this script.' -ForegroundColor Cyan
    throw 'Prerequisites are missing.'
}

# Must be signed in to Azure. (az auto-installs the Bicep CLI on first compile.)
$account = az account show --query name --output tsv 2>$null
if (-not $account) {
    Write-Host ''
    Write-Warning 'Not signed in to Azure.'
    Write-Host '    Run:  az login        (and: az account set --subscription <name-or-id>)' -ForegroundColor Cyan
    throw 'Azure CLI is not authenticated.'
}
Write-Host "    OK - signed in to Azure subscription '$account'." -ForegroundColor Green

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

# ===========================================================================
# SCHEMA-ONLY MODE — update the custom table + DCR only, no Function App.
# ===========================================================================
if ($SchemaOnly) {
    Write-Host '==> Schema-only update (table + DCR; Function App untouched)' -ForegroundColor Cyan

    # Required input. The workspace name/RG can be derived for a "start from
    # zero" deployment (workspace = log-<baseName>-<environment> in the same RG).
    if (-not $DcrResourceGroup) { throw '-SchemaOnly requires -DcrResourceGroup (the RG where the DCR lives).' }
    if (-not $ExistingWorkspaceName) {
        $ExistingWorkspaceName = "log-$BaseName-$Environment"
        Write-Host "    No -ExistingWorkspaceName given; using derived name '$ExistingWorkspaceName' (from -BaseName/-Environment)." -ForegroundColor Yellow
    }
    if (-not $ExistingWorkspaceResourceGroup) {
        $ExistingWorkspaceResourceGroup = $DcrResourceGroup
        Write-Host "    No -ExistingWorkspaceResourceGroup given; using '$ExistingWorkspaceResourceGroup' (same as -DcrResourceGroup)." -ForegroundColor Yellow
    }

    # The workspace and DCR must already exist — schema-only never creates them.
    # Use `az resource show` (core, no extension needed) so the checks are robust.
    Write-Host "    Checking for workspace '$ExistingWorkspaceName' in '$ExistingWorkspaceResourceGroup'..." -ForegroundColor Gray
    $ws = az resource show `
        --resource-group $ExistingWorkspaceResourceGroup `
        --name $ExistingWorkspaceName `
        --resource-type 'Microsoft.OperationalInsights/workspaces' `
        --query name --output tsv 2>$null
    if (-not $ws) {
        Write-Warning "Log Analytics workspace '$ExistingWorkspaceName' not found in resource group '$ExistingWorkspaceResourceGroup'."
        $found = az resource list --resource-group $ExistingWorkspaceResourceGroup --resource-type 'Microsoft.OperationalInsights/workspaces' --query "[].name" --output tsv 2>$null
        if ($found) {
            Write-Host "    Workspaces in '$ExistingWorkspaceResourceGroup': $($found -join ', ')" -ForegroundColor Cyan
            Write-Host '    Pass the correct one with -ExistingWorkspaceName.' -ForegroundColor Cyan
        }
        else {
            Write-Host "    No Log Analytics workspaces found in '$ExistingWorkspaceResourceGroup'. Check the resource group, or run a FULL deployment first." -ForegroundColor Cyan
        }
        throw 'Workspace not found for schema-only update.'
    }

    $dcrName = "dcr-$BaseName-$Environment"
    Write-Host "    Checking for DCR '$dcrName' in '$DcrResourceGroup'..." -ForegroundColor Gray
    $dcrFound = az resource show `
        --resource-group $DcrResourceGroup `
        --name $dcrName `
        --resource-type 'Microsoft.Insights/dataCollectionRules' `
        --query name --output tsv 2>$null
    if (-not $dcrFound) {
        Write-Warning "Data Collection Rule '$dcrName' not found in resource group '$DcrResourceGroup'."
        Write-Host "If your DCR uses a different name, pass -BaseName/-Environment to match (DCR = dcr-<baseName>-<environment>)." -ForegroundColor Cyan
        Write-Host 'Or run a FULL deployment first, then use -SchemaOnly for later column updates.' -ForegroundColor Cyan
        throw 'DCR not found for schema-only update.'
    }
    Write-Host "    OK - found workspace '$ExistingWorkspaceName' and DCR '$dcrName'." -ForegroundColor Green

    # Deploy into the DCR's RG; the bicep skips the Function App when schemaOnly=true.
    $deploymentName = "loging-schema-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $schemaOverrides = @(
        'schemaOnly=true'
        "existingWorkspaceName=$ExistingWorkspaceName"
        "existingWorkspaceResourceGroup=$ExistingWorkspaceResourceGroup"
        "dcrResourceGroup=$DcrResourceGroup"
        "baseName=$BaseName"
        "environment=$Environment"
    )
    Write-Host "==> Deploying schema (table + DCR) to resource group '$DcrResourceGroup'" -ForegroundColor Cyan
    $schemaOutJson = az deployment group create `
        --resource-group $DcrResourceGroup `
        --name $deploymentName `
        --template-file $bicepPath `
        --parameters $paramPath $schemaOverrides `
        --query 'properties.provisioningState' --output tsv
    if ($LASTEXITCODE -ne 0 -or $schemaOutJson -ne 'Succeeded') {
        throw "Schema-only deployment failed (state: $schemaOutJson). Re-run with '--output json' or check the resource group's Deployments blade for details."
    }
    Write-Host "    OK - deployment '$deploymentName' $schemaOutJson." -ForegroundColor Green

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Yellow
    Write-Host ' Schema update complete' -ForegroundColor Yellow
    Write-Host '============================================================' -ForegroundColor Yellow
    Write-Host "Table '$($schema.tableName)' and DCR '$dcrName' now match schema/columns.json."
    Write-Host 'The Function App was not changed (its code is schema-agnostic).'
    return
}

# Non-schema-only (full deploy) requires the Function App RG + region.
if (-not $FunctionResourceGroup) { throw 'A full deployment requires -FunctionResourceGroup.' }
if (-not $Location) { throw 'A full deployment requires -Location.' }

# --- 2. Ensure the resource groups exist ------------------------------------
# The DCR defaults to the Function App RG. When reusing an existing workspace we
# never create its RG (it already holds the workspace).
$dcrRg = if ($DcrResourceGroup) { $DcrResourceGroup } else { $FunctionResourceGroup }

# Ensures one RG exists: if missing, try to create it; if that fails (usually a
# permissions issue) stop with a clear, copy-pasteable manual instruction.
function Confirm-ResourceGroup {
    param([string]$Name)
    $exists = (az group exists --name $Name) -eq 'true'
    if ($exists) {
        Write-Host "    OK - resource group '$Name' exists." -ForegroundColor Green
        return
    }
    Write-Host "    Resource group '$Name' not found; attempting to create it..." -ForegroundColor Yellow
    az group create --name $Name --location $Location --output none 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "    OK - created resource group '$Name'." -ForegroundColor Green
        return
    }
    Write-Host ''
    Write-Warning "Could not create resource group '$Name' (you may lack permission)."
    Write-Host 'Ask an administrator to create it, or run this yourself once you have rights:' -ForegroundColor Cyan
    Write-Host "    az group create --name $Name --location $Location" -ForegroundColor White
    throw "Resource group '$Name' is missing and could not be created."
}

Write-Host '==> Ensuring resource groups exist' -ForegroundColor Cyan
$rgsToEnsure = @($FunctionResourceGroup, $dcrRg)
foreach ($rg in ($rgsToEnsure | Select-Object -Unique)) {
    Confirm-ResourceGroup -Name $rg
}

# --- 3. Deploy infrastructure (resource-group scope) ------------------------
Write-Host '==> Deploying infrastructure (bicep)' -ForegroundColor Cyan
$deploymentName = "loging-$(Get-Date -Format 'yyyyMMddHHmmss')"
$paramOverrides = @("location=$Location", "baseName=$BaseName", "environment=$Environment")
Write-Host "    Naming: baseName='$BaseName', environment='$Environment' (e.g. func-$BaseName-$Environment, dcr-$BaseName-$Environment)." -ForegroundColor Green
if ($DcrResourceGroup) { $paramOverrides += "dcrResourceGroup=$DcrResourceGroup" }
if ($ExistingWorkspaceName) { $paramOverrides += "existingWorkspaceName=$ExistingWorkspaceName" }
if ($ExistingWorkspaceResourceGroup) { $paramOverrides += "existingWorkspaceResourceGroup=$ExistingWorkspaceResourceGroup" }
if ($FunctionPlanType) {
    $paramOverrides += "functionPlanType=$FunctionPlanType"
    Write-Host "    Function App hosting plan: $FunctionPlanType." -ForegroundColor Green
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
        --resource-group $FunctionResourceGroup `
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
# Device-JWT enforcement is always on and validates the device against its Entra
# record by default (jwtRequireEntraDevice=true), which requires the Function's
# managed identity to hold Graph Device.Read.All. Without it EVERY request 401s.
# So this runs by default (idempotent); skip only if you set
# jwtRequireEntraDevice=false or will grant it another way.
if (-not $SkipDeviceGraphPermission) {
    Write-Host '==> Granting Graph Device.Read.All to the Function managed identity' -ForegroundColor Cyan
    $miPrincipalId = az functionapp identity show --resource-group $FunctionResourceGroup --name $functionAppName --query principalId --output tsv 2>$null
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
            # Pass the JSON body via a temp file (--body "@file"). Passing inline
            # JSON to `az rest` on Windows/PowerShell mangles the quotes and Graph
            # rejects it with 'Unable to read JSON request payload'.
            $body = @{ principalId = $miPrincipalId; resourceId = $graphSpId; appRoleId = $deviceReadAllRoleId } | ConvertTo-Json -Compress
            $bodyFile = New-TemporaryFile
            try {
                Set-Content -Path $bodyFile -Value $body -Encoding utf8
                az rest --method POST `
                    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miPrincipalId/appRoleAssignments" `
                    --headers 'Content-Type=application/json' `
                    --body "@$bodyFile" --output none
            }
            finally {
                Remove-Item $bodyFile -ErrorAction SilentlyContinue
            }
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
    --resource-group $FunctionResourceGroup `
    --name $functionAppName `
    --function-name DCRLogIngestionAPI `
    --query default --output tsv 2>$null

$ingestUrl = "https://$functionHost/api/DCRLogIngestionAPI"

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
    Write-Host "az functionapp function keys list -g $FunctionResourceGroup -n $functionAppName --function-name DCRLogIngestionAPI --query default -o tsv"
}
Write-Host ''
Write-Host "Query results in Log Analytics:  $($schema.tableName) | take 20"
