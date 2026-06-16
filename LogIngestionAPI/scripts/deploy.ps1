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

.PARAMETER DcrName
    Exact name of the Data Collection Rule to create/update. Overrides the
    derived dcr-<baseName>-<environment>. For a schema-only update, set this to
    the existing DCR's name instead of passing -BaseName/-Environment.

.EXAMPLE
    ./deploy.ps1 -FunctionResourceGroup rg-logging-dev -Location eastus

.EXAMPLE
    ./deploy.ps1 -FunctionResourceGroup rg-fn -DcrResourceGroup rg-dcr -Location eastus

.EXAMPLE
    # Update data columns only (no Function App changes)
    ./deploy.ps1 -SchemaOnly -ExistingWorkspaceName log-shared -ExistingWorkspaceResourceGroup rg-logs -DcrResourceGroup rg-dcr -DcrName dcr-logingestion-prod
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
    [string]$DcrName,
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

    $dcrName = if ($DcrName) { $DcrName } else { "dcr-$BaseName-$Environment" }
    Write-Host "    Checking for DCR '$dcrName' in '$DcrResourceGroup'..." -ForegroundColor Gray
    $dcrFound = az resource show `
        --resource-group $DcrResourceGroup `
        --name $dcrName `
        --resource-type 'Microsoft.Insights/dataCollectionRules' `
        --query name --output tsv 2>$null
    if (-not $dcrFound) {
        Write-Warning "Data Collection Rule '$dcrName' not found in resource group '$DcrResourceGroup'."
        Write-Host "If your DCR uses a different name, pass -DcrName to match it exactly (or -BaseName/-Environment to derive dcr-<baseName>-<environment>)." -ForegroundColor Cyan
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
if ($DcrName) { $paramOverrides += "dcrName=$DcrName" }
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
            --resource-group $FunctionResourceGroup `
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
        throw "Infrastructure deployment failed after $maxDeployAttempts attempts. Review the Azure error above, or inspect the deployment in the portal (Resource group '$FunctionResourceGroup' > Deployments > '$deployName')."
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
        Write-Host ''
        Write-Host 'Azure Functions Core Tools (the `func` command) is not installed or not on PATH.' -ForegroundColor Yellow
        Write-Host 'It is required to upload the PowerShell function code to Azure.' -ForegroundColor Yellow
        Write-Host 'Install it (pick one), then rerun this script:' -ForegroundColor Cyan
        Write-Host '    winget install Microsoft.Azure.FunctionsCoreTools' -ForegroundColor White
        Write-Host '    npm  install -g azure-functions-core-tools@4 --unsafe-perm true' -ForegroundColor White
        Write-Host 'Or rerun with -SkipFunctionPublish and publish the code manually later (see README).' -ForegroundColor Cyan
        throw 'Azure Functions Core Tools (func) not found.'
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
            --resource-group $FunctionResourceGroup `
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
            Write-Host "        az functionapp show -g $FunctionResourceGroup -n $functionAppName --query state -o tsv" -ForegroundColor White
            Write-Host "        cd '$functionPath'; func azure functionapp publish $functionAppName --powershell" -ForegroundColor White
            throw "Function App '$functionAppName' did not become discoverable in time."
        }
        Start-Sleep -Seconds 15
    }

    Push-Location $functionPath
    try {
        $maxPublishAttempts = 5
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
        Write-Host ''
        Write-Warning "Could not read the Function App's managed identity (principalId)."
        Write-Host '    The system-assigned managed identity may not be enabled yet, or you may' -ForegroundColor Yellow
        Write-Host '    lack rights to read it. Without Device.Read.All every request returns 401.' -ForegroundColor Yellow
        Write-Host '    Fix it manually once the identity exists:' -ForegroundColor Cyan
        Write-Host "      az functionapp identity show -g $FunctionResourceGroup -n $functionAppName --query principalId -o tsv" -ForegroundColor White
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
