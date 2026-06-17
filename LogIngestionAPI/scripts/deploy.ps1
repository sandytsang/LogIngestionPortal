<#
.SYNOPSIS
    One-command deploy/update for the Log Ingestion solution.

.DESCRIPTION
    Validates schema/columns.json, deploys (or updates) the infrastructure from
    infra/main.bicep, publishes the Function App code, and prints a ready-to-run
    test command plus the values needed by the device remediation script.

    You choose the exact name for every resource (Function App, Log Analytics
    workspace, Data Collection Rule and the resource group) — nothing is derived
    from a workload/environment convention and no random hash is appended to the
    Function App. Every resource is upserted: if it already exists it is updated
    in place, otherwise it is created. Run this same script whenever you add or
    remove a column in schema/columns.json to keep the table and DCR in sync.

.PARAMETER ResourceGroup
    Resource group for the Function App, its storage account, Application
    Insights, the App Service plan and (by default) the Log Analytics workspace
    and DCR. This is the deployment's resource group. If it does not exist the
    script tries to create it, and if that fails (no permission) it prints the
    command for you or your admin to run. Aliased as -FunctionResourceGroup.

.PARAMETER FunctionAppName
    Exact Function App name (no hash appended). It must be globally unique
    because it becomes <name>.azurewebsites.net. The script checks the name:
      - If an app with this name already exists in YOUR subscription, the script
        deploys this solution's code INTO it (after a confirmation, because zip
        deploy hides any other functions already in that app — see -Force).
      - If the name is taken in ANOTHER tenant, the script stops and tells you
        the name is not available so you can choose a different one.
      - Otherwise a new Function App is created with exactly this name.

.PARAMETER WorkspaceName
    Exact Log Analytics workspace name. Created if it does not exist, updated in
    place if it does. Lives in -WorkspaceResourceGroup (defaults to -ResourceGroup).

.PARAMETER WorkspaceResourceGroup
    Resource group of the Log Analytics workspace. Defaults to -ResourceGroup.

.PARAMETER DcrName
    Exact name of the Data Collection Rule to create/update. Lives in
    -DcrResourceGroup (defaults to -ResourceGroup).

.PARAMETER DcrResourceGroup
    Resource group for the Data Collection Rule. Defaults to -ResourceGroup.
    Created automatically if missing (falls back to a manual instruction when
    you lack permission).

.PARAMETER Location
    Azure region (e.g. eastus). Used when creating resource groups, the Function
    App and a new workspace. The DCR always follows the workspace's region. When
    the workspace already exists, its existing region is reused automatically.

.PARAMETER WorkspaceLocation
    Region for the Log Analytics workspace (e.g. westeurope). Defaults to
    -Location. The DCR always follows the workspace region. Ignored when the
    workspace already exists (its region cannot be changed in place).

.PARAMETER JwtAllowedTenantId
    Optional tenant id pin for device JWT requests. When omitted, the script
    auto-detects the current Azure tenant via `az account show` and sets
    JWT_ALLOWED_TENANT_ID to that value by default.

.PARAMETER Subscription
    Optional Azure subscription name or id to force for Azure CLI (`az`) commands.
    Use this when your Az PowerShell context differs from the Azure CLI context
    (Set-AzContext does not change `az` account selection).

.PARAMETER Force
    Skip the confirmation prompt shown when the chosen -FunctionAppName already
    exists in your subscription (deploying into it hides any other functions in
    that app). Use for unattended/automated runs.

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

.PARAMETER SkipDcrRoleAssignment
    Do not let the deployment create the DCR role assignment (Monitoring Metrics
    Publisher for the Function's managed identity). Use this when the deployer
    only has Contributor (which cannot create role assignments). The script then
    prints the exact 'az role assignment create' command to grant it separately.

.PARAMETER SchemaOnly
    Update ONLY the Log Analytics custom table + DCR from schema/columns.json.
    The Function App and its dependencies are left untouched, and the workspace
    is referenced (not modified). Requires an existing workspace and DCR (errors
    with guidance if either is missing). Needs -WorkspaceName, -DcrName and the
    matching resource groups; -FunctionAppName and -Location are not used.

.PARAMETER SchemaPath
    Optional path to a schema JSON file. Defaults to schema/columns.json under
    this repository. Use this when deploying from Cloud Shell with a generated
    columns file stored outside the repo clone.

.EXAMPLE
    ./deploy.ps1 -ResourceGroup rg-logging-dev -Location eastus `
        -FunctionAppName func-contoso-logs -WorkspaceName log-contoso -DcrName dcr-contoso

.EXAMPLE
    # Workspace and DCR in a shared RG, Function App in another
    ./deploy.ps1 -ResourceGroup rg-fn -Location eastus `
        -FunctionAppName func-contoso-logs `
        -WorkspaceName log-shared -WorkspaceResourceGroup rg-logs `
        -DcrName dcr-contoso -DcrResourceGroup rg-logs

.EXAMPLE
    # Update data columns only (no Function App changes)
    ./deploy.ps1 -SchemaOnly -WorkspaceName log-shared -WorkspaceResourceGroup rg-logs `
        -DcrResourceGroup rg-dcr -DcrName dcr-contoso
#>

[CmdletBinding()]
param(
    [Alias('FunctionResourceGroup')] [string]$ResourceGroup,
    [string]$Location,
    [string]$FunctionAppName,
    [string]$WorkspaceName,
    [string]$WorkspaceResourceGroup,
    [string]$WorkspaceLocation,
    [string]$DcrResourceGroup,
    [string]$DcrName,
    [string]$SchemaPath,
    [Alias('SubscriptionId')][string]$Subscription,
    [string]$JwtAllowedTenantId,
    [ValidateSet('Consumption', 'Flex')] [string]$FunctionPlanType,
    [switch]$SchemaOnly,
    # Skip the "an app with this name already exists — other functions will be
    # hidden" confirmation prompt (for unattended/automated runs).
    [switch]$Force,
    # Accepted for backward compatibility. The Graph Device.Read.All grant now
    # runs by default (device-JWT enforcement + Entra device check are on by
    # default); use -SkipDeviceGraphPermission to opt out.
    [switch]$EnableDeviceJwt,
    [switch]$SkipDeviceGraphPermission,
    [switch]$SkipDcrRoleAssignment,
    [switch]$SkipFunctionPublish
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$defaultSchemaPath = Join-Path $root 'schema\columns.json'
$schemaPath = if ($SchemaPath) {
    if ([System.IO.Path]::IsPathRooted($SchemaPath)) {
        $SchemaPath
    }
    else {
        Join-Path (Get-Location) $SchemaPath
    }
}
else {
    $defaultSchemaPath
}
if (-not (Test-Path -LiteralPath $schemaPath)) {
    throw "Schema file not found: '$schemaPath'. Pass -SchemaPath with the correct columns.json path."
}
# main.bicep uses loadJsonContent('../schema/columns.json'), so ensure that file
# matches the selected -SchemaPath before any deployment call.
if ($schemaPath -ne $defaultSchemaPath) {
    Copy-Item -LiteralPath $schemaPath -Destination $defaultSchemaPath -Force
    Write-Host "    OK - schema source synced to '$defaultSchemaPath' from '$schemaPath'." -ForegroundColor Green
}
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

# Azure Functions Core Tools (func) is optional. If it's not available, the
# script publishes with Azure CLI zip deploy instead.
if (-not $SkipFunctionPublish -and -not $SchemaOnly) {
    if (Get-Command func -ErrorAction SilentlyContinue) {
        Write-Host '    OK - Azure Functions Core Tools (func) found (preferred publish path).' -ForegroundColor Green
    }
    else {
        Write-Host '    INFO - Azure Functions Core Tools (func) not found; publish will use Azure CLI zip deploy.' -ForegroundColor Yellow
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

# Optional: force the Azure CLI subscription context used by all `az` commands.
if ($Subscription) {
    az account set --subscription $Subscription 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set Azure CLI subscription to '$Subscription'. Check the value with: az account list --output table"
    }
    Write-Host "    OK - Azure CLI subscription set to '$Subscription'." -ForegroundColor Green
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
Write-Host "==> Validating schema file '$schemaPath'" -ForegroundColor Cyan
$schema = Get-Content -LiteralPath $schemaPath -Raw | ConvertFrom-Json

# columns.json holds one or more tables ({ tables: [ { tableName, description,
# columns[] } ] }). A legacy single-table document ({ tableName, columns }) is
# auto-wrapped so older files keep working.
if ($schema.PSObject.Properties['tables']) {
    $tables = @($schema.tables)
}
elseif ($schema.PSObject.Properties['tableName']) {
    $tables = @($schema)
}
else {
    throw 'columns.json must define a "tables" array (or a legacy tableName/columns object).'
}
if ($tables.Count -eq 0) { throw 'columns.json must define at least one table.' }

$allowedTypes = @('string', 'int', 'long', 'real', 'boolean', 'datetime', 'dynamic', 'guid')
$tableNamesSeen = @{}
$totalColumns = 0
foreach ($table in $tables) {
    if (-not $table.tableName) { throw 'Every table in columns.json must define a tableName.' }
    if ($table.tableName -notmatch '_CL$') { throw "Custom table name must end with '_CL' (got '$($table.tableName)')." }
    if ($tableNamesSeen.ContainsKey($table.tableName.ToLower())) { throw "Duplicate table name '$($table.tableName)'." }
    $tableNamesSeen[$table.tableName.ToLower()] = $true
    if (-not $table.columns -or $table.columns.Count -eq 0) { throw "Table '$($table.tableName)' must define at least one column." }

    $names = @{}
    foreach ($col in $table.columns) {
        if (-not $col.name) { throw "Table '$($table.tableName)': every column must have a name." }
        if ($col.type -notin $allowedTypes) { throw "Table '$($table.tableName)', column '$($col.name)' has unsupported type '$($col.type)'. Allowed: $($allowedTypes -join ', ')." }
        if ($names.ContainsKey($col.name)) { throw "Table '$($table.tableName)': duplicate column name '$($col.name)'." }
        $names[$col.name] = $true
    }
    if (-not $names.ContainsKey('TimeGenerated')) { throw "Table '$($table.tableName)' must include a 'TimeGenerated' (datetime) column." }
    $totalColumns += $table.columns.Count
}
$tableSummary = ($tables | ForEach-Object { $_.tableName }) -join ', '
Write-Host "    OK - $($tables.Count) table(s) ($tableSummary), $totalColumns columns total." -ForegroundColor Green

# ===========================================================================
# SCHEMA-ONLY MODE — update the custom table + DCR only, no Function App.
# ===========================================================================
if ($SchemaOnly) {
    Write-Host '==> Schema-only update (table + DCR; Function App untouched)' -ForegroundColor Cyan

    # Required input. The DCR's RG defaults the workspace RG; the workspace and
    # DCR names must be given explicitly (no naming convention is assumed).
    if (-not $DcrResourceGroup) { throw '-SchemaOnly requires -DcrResourceGroup (the RG where the DCR lives).' }
    if (-not $WorkspaceName) { throw '-SchemaOnly requires -WorkspaceName (the exact workspace name).' }
    if (-not $DcrName) { throw '-SchemaOnly requires -DcrName (the exact Data Collection Rule name).' }
    if (-not $WorkspaceResourceGroup) {
        $WorkspaceResourceGroup = $DcrResourceGroup
        Write-Host "    No -WorkspaceResourceGroup given; using '$WorkspaceResourceGroup' (same as -DcrResourceGroup)." -ForegroundColor Yellow
    }

    # The workspace and DCR must already exist — schema-only never creates them.
    # Use `az resource show` (core, no extension needed) so the checks are robust.
    Write-Host "    Checking for workspace '$WorkspaceName' in '$WorkspaceResourceGroup'..." -ForegroundColor Gray
    $ws = az resource show `
        --resource-group $WorkspaceResourceGroup `
        --name $WorkspaceName `
        --resource-type 'Microsoft.OperationalInsights/workspaces' `
        --query name --output tsv 2>$null
    if (-not $ws) {
        Write-Warning "Log Analytics workspace '$WorkspaceName' not found in resource group '$WorkspaceResourceGroup'."
        $found = az resource list --resource-group $WorkspaceResourceGroup --resource-type 'Microsoft.OperationalInsights/workspaces' --query "[].name" --output tsv 2>$null
        if ($found) {
            Write-Host "    Workspaces in '$WorkspaceResourceGroup': $($found -join ', ')" -ForegroundColor Cyan
            Write-Host '    Pass the correct one with -WorkspaceName.' -ForegroundColor Cyan
        }
        else {
            Write-Host "    No Log Analytics workspaces found in '$WorkspaceResourceGroup'. Check the resource group, or run a FULL deployment first." -ForegroundColor Cyan
        }
        throw 'Workspace not found for schema-only update.'
    }

    $dcrName = $DcrName
    Write-Host "    Checking for DCR '$dcrName' in '$DcrResourceGroup'..." -ForegroundColor Gray
    $dcrFound = az resource show `
        --resource-group $DcrResourceGroup `
        --name $dcrName `
        --resource-type 'Microsoft.Insights/dataCollectionRules' `
        --query name --output tsv 2>$null
    if (-not $dcrFound) {
        Write-Warning "Data Collection Rule '$dcrName' not found in resource group '$DcrResourceGroup'."
        Write-Host 'If your DCR uses a different name, pass -DcrName to match it exactly.' -ForegroundColor Cyan
        Write-Host 'Or run a FULL deployment first, then use -SchemaOnly for later column updates.' -ForegroundColor Cyan
        throw 'DCR not found for schema-only update.'
    }
    Write-Host "    OK - found workspace '$WorkspaceName' and DCR '$dcrName'." -ForegroundColor Green

    # Deploy into the DCR's RG; the bicep skips the Function App when schemaOnly=true.
    $deploymentName = "loging-schema-$(Get-Date -Format 'yyyyMMddHHmmss')"
    $schemaOverrides = @(
        'schemaOnly=true'
        "workspaceName=$WorkspaceName"
        "workspaceResourceGroup=$WorkspaceResourceGroup"
        "dcrResourceGroup=$DcrResourceGroup"
        "dcrName=$dcrName"
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
    Write-Host "Table(s) '$tableSummary' and DCR '$dcrName' now match schema/columns.json."
    Write-Host 'The Function App was not changed (its code is schema-agnostic).'
    return
}

# ===========================================================================
# Full deploy: validate the required explicit names + region. Nothing is derived
# from a workload/environment convention — you name every resource yourself.
# ===========================================================================
if (-not $ResourceGroup) { throw 'A full deployment requires -ResourceGroup.' }
if (-not $Location) { throw 'A full deployment requires -Location.' }
if (-not $FunctionAppName) { throw 'A full deployment requires -FunctionAppName (the exact Function App name).' }
if (-not $WorkspaceName) { throw 'A full deployment requires -WorkspaceName (the exact Log Analytics workspace name).' }
if (-not $DcrName) { throw 'A full deployment requires -DcrName (the exact Data Collection Rule name).' }

# --- 2. Ensure the resource groups exist ------------------------------------
# The DCR and workspace default to the deployment (Function App) resource group.
$dcrRg = if ($DcrResourceGroup) { $DcrResourceGroup } else { $ResourceGroup }
$wsRg = if ($WorkspaceResourceGroup) { $WorkspaceResourceGroup } else { $ResourceGroup }

# Ensures one RG exists: if missing, try to create it; if that fails (usually a
# permissions issue) stop with a clear, copy-pasteable manual instruction.
function Confirm-ResourceGroup {
    param([string]$Name)
    $existsErrFile = New-TemporaryFile
    try {
        $existsRaw = az group exists --name $Name --output tsv 2>$existsErrFile
        $existsExit = $LASTEXITCODE
        $existsErr = (Get-Content -Path $existsErrFile -Raw -ErrorAction SilentlyContinue)
    }
    finally {
        Remove-Item $existsErrFile -ErrorAction SilentlyContinue
    }

    if ($existsExit -ne 0) {
        $subName = az account show --query name --output tsv 2>$null
        $subId = az account show --query id --output tsv 2>$null
        Write-Host ''
        Write-Warning "Could not verify whether resource group '$Name' exists."
        if ($existsErr) { Write-Host $existsErr.TrimEnd() -ForegroundColor DarkGray }
        Write-Host "Current Azure subscription context: '$subName' ($subId)" -ForegroundColor Yellow
        Write-Host 'If the resource group is in a different subscription, switch first:' -ForegroundColor Cyan
        Write-Host '    az account list --output table' -ForegroundColor White
        Write-Host '    az account set --subscription <name-or-id>' -ForegroundColor White
        throw "Failed to check resource group '$Name' due to Azure authorization/context error."
    }

    $exists = $existsRaw -eq 'true'
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
$rgsToEnsure = @($ResourceGroup, $dcrRg, $wsRg)
foreach ($rg in ($rgsToEnsure | Select-Object -Unique)) {
    Confirm-ResourceGroup -Name $rg
}

# --- 2b. Resolve how to handle the Function App name ------------------------
# The Function App is named exactly as requested (no hash). Three outcomes:
#   1. An app with this name already exists in YOUR subscription -> deploy this
#      solution's code INTO it (warn first: zip deploy hides other functions).
#   2. The name is taken in ANOTHER tenant (global DNS) -> stop; not available.
#   3. The name is free -> create a brand-new Function App with this name.
$useExistingFunctionApp = $false
$existingPrincipalId = $null
$existingFunctionHost = $null

Write-Host "==> Checking Function App name '$FunctionAppName'" -ForegroundColor Cyan
# The app could live in any RG, so search the whole subscription by name.
$ownAppRg = az functionapp list --query "[?name=='$FunctionAppName'].resourceGroup | [0]" --output tsv 2>$null
if ($ownAppRg) {
    # Case 1 — it's already in this subscription. Big warning + confirm.
    $useExistingFunctionApp = $true
    Write-Host ''
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host " A Function App named '$FunctionAppName' already exists" -ForegroundColor Yellow
    Write-Host "  in your subscription (resource group '$ownAppRg')." -ForegroundColor Yellow
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host 'Deploying this solution publishes its code with a zip/package deploy,' -ForegroundColor Yellow
    Write-Host 'which REPLACES the app contents — any OTHER functions currently in this' -ForegroundColor Yellow
    Write-Host 'app will stop being served. Its storage, plan and other apps are untouched.' -ForegroundColor Yellow
    Write-Host ''
    if (-not $Force) {
        $answer = Read-Host "Type 'yes' to deploy into '$FunctionAppName' (anything else cancels)"
        if ($answer -ne 'yes') { throw 'Cancelled by user (existing Function App not modified).' }
    }
    else {
        Write-Host '    -Force set; proceeding without prompting.' -ForegroundColor Yellow
    }

    $existingAppJson = az functionapp show --name $FunctionAppName --resource-group $ownAppRg --output json 2>$null
    if (-not $existingAppJson) { throw "Could not read the existing Function App '$FunctionAppName' in '$ownAppRg'." }
    $existingApp = $existingAppJson | ConvertFrom-Json
    $existingFunctionHost = $existingApp.defaultHostName

    # The function code is PowerShell; warn (don't block) if the runtime differs.
    $existingRuntime = az functionapp config appsettings list --name $FunctionAppName --resource-group $ownAppRg --query "[?name=='FUNCTIONS_WORKER_RUNTIME'].value | [0]" --output tsv 2>$null
    if ($existingRuntime -and $existingRuntime -ne 'powershell') {
        Write-Warning "    The app's FUNCTIONS_WORKER_RUNTIME is '$existingRuntime', not 'powershell'. This code is PowerShell and may not run correctly."
    }

    # Ensure a system-assigned managed identity exists (idempotent) and read it.
    $existingPrincipalId = $existingApp.identity.principalId
    if (-not $existingPrincipalId) {
        Write-Host '    Enabling system-assigned managed identity on the app...' -ForegroundColor Yellow
        $existingPrincipalId = az functionapp identity assign --name $FunctionAppName --resource-group $ownAppRg --query principalId --output tsv 2>$null
    }
    if (-not $existingPrincipalId) { throw "Could not enable/read the managed identity on '$FunctionAppName'." }
    Write-Host "    OK - will deploy into the existing app (identity '$existingPrincipalId')." -ForegroundColor Green
}
else {
    # Cases 2 & 3 — not in this subscription. Check global name availability.
    $subId = az account show --query id -o tsv
    $availJson = az rest --method POST `
        --url "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Web/checkNameAvailability?api-version=2023-12-01" `
        --headers 'Content-Type=application/json' `
        --body "{\""name\"":\""$FunctionAppName\"",\""type\"":\""Microsoft.Web/sites\""}" --output json 2>$null
    $avail = if ($availJson) { $availJson | ConvertFrom-Json } else { $null }
    if ($avail -and -not $avail.nameAvailable) {
        Write-Host ''
        Write-Host '------------------------------------------------------------' -ForegroundColor Red
        Write-Host " Function App name '$FunctionAppName' is not available" -ForegroundColor Red
        Write-Host '------------------------------------------------------------' -ForegroundColor Red
        if ($avail.message) { Write-Host "Reason: $($avail.message)" -ForegroundColor Yellow }
        Write-Host 'Function App names are globally unique across all Azure tenants (the app is' -ForegroundColor Yellow
        Write-Host 'served at <name>.azurewebsites.net), and this one is already taken by someone' -ForegroundColor Yellow
        Write-Host 'else. Choose a different -FunctionAppName and run again.' -ForegroundColor Cyan
        throw "Function App name '$FunctionAppName' is not available."
    }
    Write-Host "    OK - '$FunctionAppName' is available; a new Function App will be created." -ForegroundColor Green
}

# If the workspace already exists, reuse its region (a workspace's location can
# never be changed in place, so we must not pass a different one).
$wsLocation = az resource show --resource-group $wsRg --name $WorkspaceName --resource-type 'Microsoft.OperationalInsights/workspaces' --query location --output tsv 2>$null
if ($wsLocation) {
    Write-Host "    Workspace '$WorkspaceName' already exists in '$wsLocation' — it will be updated in place (its region cannot be changed)." -ForegroundColor Green
    if ($WorkspaceLocation -and $WorkspaceLocation -ne $wsLocation) {
        Write-Host "    Ignoring -WorkspaceLocation '$WorkspaceLocation'; the workspace stays in '$wsLocation'." -ForegroundColor Yellow
    }
}
elseif ($WorkspaceLocation) {
    $wsLocation = $WorkspaceLocation
    Write-Host "    Workspace '$WorkspaceName' will be created in '$wsLocation'." -ForegroundColor Green
}
else {
    Write-Host "    Workspace '$WorkspaceName' will be created in '$Location' (same as the Function App)." -ForegroundColor Green
}

# --- 3. Deploy infrastructure (resource-group scope) ------------------------
Write-Host '==> Deploying infrastructure (bicep)' -ForegroundColor Cyan
$deploymentName = "loging-$(Get-Date -Format 'yyyyMMddHHmmss')"

# By default, pin JWT requests to the signed-in Azure tenant. This keeps the
# deployment safe-by-default while still allowing an explicit override.
$effectiveJwtTenantId = $JwtAllowedTenantId
if (-not $effectiveJwtTenantId) {
    $effectiveJwtTenantId = az account show --query tenantId --output tsv 2>$null
    if (-not $effectiveJwtTenantId) {
        throw 'Could not determine tenant id from az account show; pass -JwtAllowedTenantId explicitly.'
    }
}

$paramOverrides = @(
    "location=$Location"
    "functionAppName=$FunctionAppName"
    "workspaceName=$WorkspaceName"
    "dcrName=$DcrName"
    "jwtAllowedTenantId=$effectiveJwtTenantId"
)
Write-Host "    Names: function='$FunctionAppName', workspace='$WorkspaceName', dcr='$DcrName'." -ForegroundColor Green
Write-Host "    JWT tenant pin: $effectiveJwtTenantId" -ForegroundColor Green
if ($DcrResourceGroup) { $paramOverrides += "dcrResourceGroup=$DcrResourceGroup" }
if ($WorkspaceResourceGroup) { $paramOverrides += "workspaceResourceGroup=$WorkspaceResourceGroup" }
if ($wsLocation) { $paramOverrides += "workspaceLocation=$wsLocation" }
if ($FunctionPlanType) {
    $paramOverrides += "functionPlanType=$FunctionPlanType"
    Write-Host "    Function App hosting plan: $FunctionPlanType." -ForegroundColor Green
}
if ($SkipDcrRoleAssignment) {
    $paramOverrides += 'assignDcrPublisherRole=false'
    Write-Host '    Skipping the DCR role assignment (Contributor-only deploy); grant it separately afterwards.' -ForegroundColor Yellow
}
if ($useExistingFunctionApp) {
    $paramOverrides += "existingFunctionPrincipalId=$existingPrincipalId"
    Write-Host "    Deploying into existing Function App '$FunctionAppName' (no new app created)." -ForegroundColor Green
}

# DCR deployments occasionally fail with a transient 'Data collection rule has
# been modified before operation completed' conflict. Retry a few times since the
# deployment is idempotent. Authorization failures (e.g. the operator only has
# Contributor) are NOT transient, so we detect them and fail fast with a clear,
# actionable message instead of retrying and printing a generic error.
$maxDeployAttempts = 3
$outputJson = $null
for ($deployAttempt = 1; $deployAttempt -le $maxDeployAttempts; $deployAttempt++) {
    $deployName = "$deploymentName-$deployAttempt"
    $deployErrFile = New-TemporaryFile
    try {
        $outputJson = az deployment group create `
            --resource-group $ResourceGroup `
            --name $deployName `
            --template-file $bicepPath `
            --parameters $paramPath $paramOverrides `
            --query properties.outputs `
            --output json 2>$deployErrFile
        $deployExit = $LASTEXITCODE
        $deployErr = (Get-Content -Path $deployErrFile -Raw -ErrorAction SilentlyContinue)
    }
    finally {
        Remove-Item $deployErrFile -ErrorAction SilentlyContinue
    }
    if ($deployExit -eq 0) { break }

    # Surface the raw Azure error so the operator can see exactly what failed.
    if ($deployErr) { Write-Host $deployErr.TrimEnd() -ForegroundColor DarkGray }

    # Detect the non-transient "you don't have rights to create the DCR role
    # assignment" case. Contributor lacks Microsoft.Authorization/*/write.
    $isAuthFailure = $deployErr -match 'AuthorizationFailed|RoleAssignmentUpdateNotPermitted|does not have authorization|Microsoft\.Authorization/roleAssignments/write'
    if ($isAuthFailure) {
        Write-Host ''
        Write-Host '------------------------------------------------------------' -ForegroundColor Red
        Write-Host ' Permission problem: cannot grant the Function access to the DCR' -ForegroundColor Red
        Write-Host '------------------------------------------------------------' -ForegroundColor Red
        Write-Host "The deployment tried to give the Function App's managed identity the" -ForegroundColor Yellow
        Write-Host "'Monitoring Metrics Publisher' role on the Data Collection Rule, but your" -ForegroundColor Yellow
        Write-Host 'account is not allowed to create role assignments.' -ForegroundColor Yellow
        Write-Host ''
        Write-Host 'Why: the Contributor role cannot create role assignments. You need one of:' -ForegroundColor Cyan
        Write-Host '    - Owner' -ForegroundColor White
        Write-Host '    - User Access Administrator' -ForegroundColor White
        Write-Host '    - Role Based Access Control Administrator' -ForegroundColor White
        Write-Host "on the DCR resource group ('$dcrRg') or the subscription." -ForegroundColor Cyan
        Write-Host ''
        Write-Host 'How to fix (pick one):' -ForegroundColor Cyan
        Write-Host '  1) Ask an admin to elevate your role, then rerun this script, OR' -ForegroundColor White
        Write-Host '  2) Ask an admin to assign the role manually once the resources exist:' -ForegroundColor White
        Write-Host "       az role assignment create ``" -ForegroundColor White
        Write-Host "         --assignee-object-id <FunctionApp-managed-identity-principalId> ``" -ForegroundColor White
        Write-Host '         --assignee-principal-type ServicePrincipal `' -ForegroundColor White
        Write-Host "         --role 'Monitoring Metrics Publisher' ``" -ForegroundColor White
        Write-Host "         --scope <DCR-resource-id>" -ForegroundColor White
        Write-Host ''
        throw "Infrastructure deployment failed: insufficient permission to create the DCR role assignment (need Owner / User Access Administrator / RBAC Administrator)."
    }

    if ($deployAttempt -lt $maxDeployAttempts) {
        Write-Host "    Deployment attempt $deployAttempt failed (often a transient DCR conflict); retrying in 15s..." -ForegroundColor Yellow
        Start-Sleep -Seconds 15
    }
    else {
        throw "Infrastructure deployment failed after $maxDeployAttempts attempts. Review the Azure error above, or inspect the deployment in the portal (Resource group '$ResourceGroup' > Deployments > '$deployName')."
    }
}

$outputs = $outputJson | ConvertFrom-Json
if ($useExistingFunctionApp) {
    $functionAppName = $FunctionAppName
    $functionAppRg = $ownAppRg
    $functionHost = $existingFunctionHost
}
else {
    $functionAppName = $outputs.functionAppName.value
    $functionAppRg = $ResourceGroup
    $functionHost = $outputs.functionAppHostName.value
}
Write-Host "    OK - Function App '$functionAppName'." -ForegroundColor Green

# In existing-app mode, write the app settings the function code needs (additive;
# other settings on the app are preserved). A new app already has these baked in
# by the bicep, so this only runs for an existing app.
if ($useExistingFunctionApp) {
    Write-Host '==> Configuring app settings on the existing Function App' -ForegroundColor Cyan
    $dcrEndpointOut = $outputs.dcrIngestionEndpoint.value
    $dcrImmutableIdOut = $outputs.dcrImmutableId.value
    $expectedAudience = "https://$functionHost"
    $appSettings = @(
        "DCR_ENDPOINT=$dcrEndpointOut"
        "DCR_IMMUTABLE_ID=$dcrImmutableIdOut"
        'JWT_ENFORCE=true'
        "JWT_EXPECTED_AUDIENCE=$expectedAudience"
        "JWT_ALLOWED_TENANT_ID=$effectiveJwtTenantId"
        'JWT_REQUIRE_CERT_CHAIN=true'
        'JWT_REQUIRE_ENTRA_DEVICE=true'
    )
    az functionapp config appsettings set `
        --name $functionAppName `
        --resource-group $functionAppRg `
        --settings $appSettings `
        --output none 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "    Could not set app settings on '$functionAppName'. Set DCR_ENDPOINT/DCR_IMMUTABLE_ID and the JWT_* values manually (see README)."
    }
    else {
        Write-Host "    OK - app settings written (JWT audience bound to https://$functionHost)." -ForegroundColor Green
    }
}

# When the deployment was told NOT to create the DCR role assignment (Contributor-
# only deploy), the Function cannot push logs until someone with role-assignment
# rights grants it. Print the exact command so an admin can run it once.
if ($SkipDcrRoleAssignment) {
    $subId = az account show --query id -o tsv
    $dcrRgOut = $outputs.dcrResourceGroup.value
    $dcrNameOut = $outputs.dcrName.value
    $miPrincipalId = $outputs.functionPrincipalId.value
    $dcrScope = "/subscriptions/$subId/resourceGroups/$dcrRgOut/providers/Microsoft.Insights/dataCollectionRules/$dcrNameOut"
    Write-Host ''
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host ' Action needed: grant the Function access to the DCR' -ForegroundColor Yellow
    Write-Host '------------------------------------------------------------' -ForegroundColor Yellow
    Write-Host 'You deployed with -SkipDcrRoleAssignment, so the role was NOT created.' -ForegroundColor Yellow
    Write-Host "Until it is, the Function returns errors when pushing logs. Have someone with" -ForegroundColor Yellow
    Write-Host 'Owner / User Access Administrator / RBAC Administrator run this once:' -ForegroundColor Yellow
    Write-Host ''
    Write-Host "  az role assignment create ``" -ForegroundColor White
    Write-Host "    --assignee-object-id $miPrincipalId ``" -ForegroundColor White
    Write-Host '    --assignee-principal-type ServicePrincipal `' -ForegroundColor White
    Write-Host "    --role 'Monitoring Metrics Publisher' ``" -ForegroundColor White
    Write-Host "    --scope $dcrScope" -ForegroundColor White
    Write-Host ''
}

# --- 4. Publish the Function App code ---------------------------------------
if (-not $SkipFunctionPublish) {
    Write-Host '==> Publishing Function App code' -ForegroundColor Cyan
    $hasFunc = [bool](Get-Command func -ErrorAction SilentlyContinue)
    if (-not $hasFunc) {
        Write-Host '    Functions Core Tools not found; using Azure CLI zip deploy.' -ForegroundColor Yellow
    }
    # The ARM deployment returns before the Function App is fully propagated to
    # the management plane, so 'func ... publish' can fail with
    # "Can't find app with name ...". Wait until the app is queryable, then
    # retry the publish a few times to absorb any remaining propagation lag.
    Write-Host "    Waiting for Function App '$functionAppName' to be discoverable..." -ForegroundColor Yellow
    $maxReadyAttempts = 20
    for ($readyAttempt = 1; $readyAttempt -le $maxReadyAttempts; $readyAttempt++) {
        $appState = az functionapp show `
            --name $functionAppName `
            --resource-group $functionAppRg `
            --query state `
            --output tsv 2>$null
        # A zero exit code means the app is queryable (discoverable) on the
        # management plane, which is all we need before publishing. Don't also
        # require a non-empty 'state': Flex Consumption (FC1) apps often report
        # an empty/null state for a while after provisioning, which would
        # otherwise spin this loop until it times out even though the app is up.
        if ($LASTEXITCODE -eq 0) {
            $stateLabel = if ($appState) { $appState } else { 'provisioning' }
            Write-Host "    OK - Function App is available (state: $stateLabel)." -ForegroundColor Green
            break
        }
        if ($readyAttempt -eq $maxReadyAttempts) {
            Write-Host ''
            Write-Host "The Function App '$functionAppName' is still not visible to the management API" -ForegroundColor Yellow
            Write-Host 'after several minutes. This is usually slow propagation, not a real failure.' -ForegroundColor Yellow
            Write-Host 'What to do:' -ForegroundColor Cyan
            Write-Host '    - Wait a couple of minutes and rerun this script (it is idempotent), OR' -ForegroundColor White
            Write-Host '    - Confirm it exists, then publish manually:' -ForegroundColor White
            Write-Host "        az functionapp show -g $functionAppRg -n $functionAppName --query state -o tsv" -ForegroundColor White
            Write-Host "        cd '$functionPath'; func azure functionapp publish $functionAppName --powershell" -ForegroundColor White
            throw "Function App '$functionAppName' did not become discoverable in time."
        }
        Start-Sleep -Seconds 15
    }

    $maxPublishAttempts = 5
    if ($hasFunc) {
        Push-Location $functionPath
        try {
            for ($publishAttempt = 1; $publishAttempt -le $maxPublishAttempts; $publishAttempt++) {
                func azure functionapp publish $functionAppName --powershell
                if ($LASTEXITCODE -eq 0) { break }
                if ($publishAttempt -eq $maxPublishAttempts) {
                    Write-Host ''
                    Write-Host "Publishing the function code failed after $maxPublishAttempts attempts." -ForegroundColor Yellow
                    Write-Host 'Things to check:' -ForegroundColor Cyan
                    Write-Host '    - You are signed in with `az login` and have Contributor on the Function App.' -ForegroundColor White
                    Write-Host '    - The Function App is running (not stopped) and finished provisioning.' -ForegroundColor White
                    Write-Host '    - Network/proxy is not blocking the SCM (Kudu) publish endpoint.' -ForegroundColor White
                    Write-Host 'Retry the publish manually to see the full error:' -ForegroundColor Cyan
                    Write-Host "    cd '$functionPath'; func azure functionapp publish $functionAppName --powershell" -ForegroundColor White
                    throw 'Function publish failed.'
                }
                Write-Host "    Publish attempt $publishAttempt failed (often propagation lag); retrying in 20s..." -ForegroundColor Yellow
                Start-Sleep -Seconds 20
            }
        }
        finally {
            Pop-Location
        }
    }
    else {
        $zipPath = Join-Path ([System.IO.Path]::GetTempPath()) ("loging-func-" + [Guid]::NewGuid().ToString('N') + '.zip')
        try {
            Compress-Archive -Path (Join-Path $functionPath '*') -DestinationPath $zipPath -Force
            for ($publishAttempt = 1; $publishAttempt -le $maxPublishAttempts; $publishAttempt++) {
                az functionapp deployment source config-zip `
                    --resource-group $functionAppRg `
                    --name $functionAppName `
                    --src $zipPath `
                    --output none
                if ($LASTEXITCODE -eq 0) { break }
                if ($publishAttempt -eq $maxPublishAttempts) {
                    Write-Host ''
                    Write-Host "Publishing the function code with Azure CLI zip deploy failed after $maxPublishAttempts attempts." -ForegroundColor Yellow
                    Write-Host 'Things to check:' -ForegroundColor Cyan
                    Write-Host '    - You are signed in with `az login` and have Contributor on the Function App.' -ForegroundColor White
                    Write-Host '    - The Function App is running (not stopped) and finished provisioning.' -ForegroundColor White
                    Write-Host '    - Network/proxy is not blocking the SCM (Kudu) publish endpoint.' -ForegroundColor White
                    Write-Host 'Retry manually:' -ForegroundColor Cyan
                    Write-Host "    az functionapp deployment source config-zip -g $functionAppRg -n $functionAppName --src $zipPath" -ForegroundColor White
                    throw 'Function publish failed (zip deploy).' 
                }
                Write-Host "    Zip publish attempt $publishAttempt failed (often propagation lag); retrying in 20s..." -ForegroundColor Yellow
                Start-Sleep -Seconds 20
            }
        }
        finally {
            Remove-Item -Path $zipPath -ErrorAction SilentlyContinue
        }
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
    $miPrincipalId = az functionapp identity show --resource-group $functionAppRg --name $functionAppName --query principalId --output tsv 2>$null
    if (-not $miPrincipalId) {
        Write-Host ''
        Write-Warning "Could not read the Function App's managed identity (principalId)."
        Write-Host '    The system-assigned managed identity may not be enabled yet, or you may' -ForegroundColor Yellow
        Write-Host '    lack rights to read it. Without Device.Read.All every request returns 401.' -ForegroundColor Yellow
        Write-Host '    Fix it manually once the identity exists:' -ForegroundColor Cyan
        Write-Host "      az functionapp identity show -g $functionAppRg -n $functionAppName --query principalId -o tsv" -ForegroundColor White
        Write-Host '    Then grant Graph Device.Read.All to that principalId (see README), or rerun' -ForegroundColor Cyan
        Write-Host '    with -jwtRequireEntraDevice false if you do not need Entra device validation.' -ForegroundColor Cyan
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
            $graphErrFile = New-TemporaryFile
            try {
                Set-Content -Path $bodyFile -Value $body -Encoding utf8
                az rest --method POST `
                    --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miPrincipalId/appRoleAssignments" `
                    --headers 'Content-Type=application/json' `
                    --body "@$bodyFile" --output none 2>$graphErrFile
                $graphExit = $LASTEXITCODE
                $graphErr = (Get-Content -Path $graphErrFile -Raw -ErrorAction SilentlyContinue)
            }
            finally {
                Remove-Item $bodyFile -ErrorAction SilentlyContinue
                Remove-Item $graphErrFile -ErrorAction SilentlyContinue
            }
            if ($graphExit -ne 0) {
                if ($graphErr) { Write-Host $graphErr.TrimEnd() -ForegroundColor DarkGray }
                Write-Host ''
                Write-Host '------------------------------------------------------------' -ForegroundColor Red
                Write-Host ' Could not grant Graph Device.Read.All to the Function identity' -ForegroundColor Red
                Write-Host '------------------------------------------------------------' -ForegroundColor Red
                Write-Host 'Why this matters: device-JWT validation is ON by default, so the Function' -ForegroundColor Yellow
                Write-Host 'must read device records from Microsoft Graph. Without this app role, EVERY' -ForegroundColor Yellow
                Write-Host 'request to the API returns HTTP 401.' -ForegroundColor Yellow
                Write-Host ''
                Write-Host 'Likely cause: granting an application Graph permission requires a directory' -ForegroundColor Cyan
                Write-Host 'admin. You need one of:' -ForegroundColor Cyan
                Write-Host '    - Global Administrator' -ForegroundColor White
                Write-Host '    - Privileged Role Administrator' -ForegroundColor White
                Write-Host '    - Application Administrator (with admin consent rights)' -ForegroundColor White
                Write-Host ''
                Write-Host 'How to fix (pick one):' -ForegroundColor Cyan
                Write-Host '  1) Ask a directory admin to run this once (principalId already resolved):' -ForegroundColor White
                Write-Host "       `$mi   = '$miPrincipalId'" -ForegroundColor White
                Write-Host "       `$graph = az ad sp list --filter \"appId eq '$graphAppId'\" --query '[0].id' -o tsv" -ForegroundColor White
                Write-Host "       az rest --method POST ``" -ForegroundColor White
                Write-Host "         --uri https://graph.microsoft.com/v1.0/servicePrincipals/`$mi/appRoleAssignments ``" -ForegroundColor White
                Write-Host "         --headers 'Content-Type=application/json' ``" -ForegroundColor White
                Write-Host "         --body '{\"principalId\":\"`$mi\",\"resourceId\":\"`$graph\",\"appRoleId\":\"$deviceReadAllRoleId\"}'" -ForegroundColor White
                Write-Host '  2) Or, if you do not need Entra device validation, redeploy with' -ForegroundColor White
                Write-Host '     jwtRequireEntraDevice=false and rerun with -SkipDeviceGraphPermission.' -ForegroundColor White
                Write-Host ''
                Write-Warning 'Deployment will continue, but the API will reject requests until Device.Read.All is granted.'
            }
            else {
                Write-Host '    OK - Device.Read.All assigned (propagation may take a few minutes).' -ForegroundColor Green
            }
        }
    }
}

# --- 6. Print next steps ---------------------------------------------------
$ingestUrl = "https://$functionHost/api/DCRLogIngestionAPI"

Write-Host ''
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host ' Deployment complete' -ForegroundColor Yellow
Write-Host '============================================================' -ForegroundColor Yellow
Write-Host "Function URL : $ingestUrl"
Write-Host ''
Write-Host 'Get the function key from the Azure portal:' -ForegroundColor Cyan
Write-Host "    Function App '$functionAppName' -> Functions -> DCRLogIngestionAPI ->" -ForegroundColor White
Write-Host "    Function Keys -> copy 'default' (or use an App key under 'App keys')." -ForegroundColor White
Write-Host '    (Right after a deploy the key may take a minute to appear, and on Flex' -ForegroundColor White
Write-Host '    Consumption the CLI can return null while the portal shows it.)' -ForegroundColor White
Write-Host ''
Write-Host 'Paste that key and the URL above into scripts/IntuneScript.ps1 before packaging for Intune.' -ForegroundColor White
Write-Host ''
Write-Host 'Quick test once you have the key (PowerShell):' -ForegroundColor Cyan
$sample = '[{ \"TimeGenerated\": \"' + (Get-Date).ToUniversalTime().ToString('o') + '\", \"DeviceName\": \"test-host\", \"Status\": \"Remediated\", \"Details\": \"manual test\" }]'
Write-Host "Invoke-RestMethod -Method Post -Uri '$ingestUrl?code=<FUNCTION_KEY>' -ContentType 'application/json' -Body '$sample'"
Write-Host ''
Write-Host "Query results in Log Analytics:  $(($tables | ForEach-Object { "$($_.tableName) | take 20" }) -join '   /   ')"
