<#
.SYNOPSIS
    Grants a Function App's managed identity Monitoring Metrics Publisher on a DCR resource group.

.DESCRIPTION
    Resolves the Function App managed identity object id from the Function App name,
    then assigns the Monitoring Metrics Publisher role on the resource group that
    contains the DCR. Idempotent.

.EXAMPLE
    ./AssignDcrPublisherPermission.ps1 -FunctionResourceGroup rg-logingestion -FunctionAppName func-logingestion -DcrResourceGroup rg-logingestion

.NOTES
    Author : Sandy Zeng

    Version history:
        1.0.0 (2026-06-19) Initial release.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [Alias('frg')] [string]$FunctionResourceGroup,
    [Parameter(Mandatory)] [Alias('func')] [string]$FunctionAppName,
    [Parameter(Mandatory)] [Alias('dcrrg')] [string]$DcrRg,
    [string]$Subscription
)

$ErrorActionPreference = 'Stop'

$didLogin = $false

$account = az account show --query name --output tsv 2>$null
if (-not $account) {
    Write-Host '==> Signing in to Azure CLI (az login)' -ForegroundColor Cyan
    az login --only-show-errors
    if ($LASTEXITCODE -ne 0) {
        throw 'Azure CLI login failed.'
    }
    $didLogin = $true
}

try {
    if ($Subscription) {
        az account set --subscription $Subscription 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to set Azure CLI subscription to '$Subscription'."
        }
    }

    $subId = az account show --query id --output tsv 2>$null
    if (-not $subId) {
        throw 'Could not determine Azure subscription id from Azure CLI context.'
    }

    $miId = az functionapp identity show -g $FunctionResourceGroup -n $FunctionAppName --query principalId -o tsv 2>$null
    if (-not $miId) {
        throw "Could not find a managed identity on '$FunctionAppName' in '$FunctionResourceGroup'."
    }

    $roleId = '3913510d-42f4-4e42-8a64-420c390055eb' # Monitoring Metrics Publisher
    $scope = "/subscriptions/$subId/resourceGroups/$DcrRg"
    $roleDefinitionId = "/subscriptions/$subId/providers/Microsoft.Authorization/roleDefinitions/$roleId"

    $existing = az role assignment list `
      --assignee-object-id $miId `
      --scope $scope `
      --query "[?roleDefinitionId=='$roleDefinitionId'] | [0].id" `
      --output tsv 2>$null

    if ($existing) {
        Write-Host 'Monitoring Metrics Publisher already assigned on the DCR resource group.'
    }
    else {
        az role assignment create `
          --assignee-object-id $miId `
          --assignee-principal-type ServicePrincipal `
          --role $roleId `
          --scope $scope `
          --output none
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to assign Monitoring Metrics Publisher on the DCR resource group.'
        }
        Write-Host 'Monitoring Metrics Publisher assigned on the DCR resource group.'
    }
}
finally {
    if ($didLogin) {
        az logout --only-show-errors 2>$null | Out-Null
        az account clear --only-show-errors 2>$null | Out-Null
        Write-Host '==> Azure CLI session disconnected.' -ForegroundColor Green
    }
}
