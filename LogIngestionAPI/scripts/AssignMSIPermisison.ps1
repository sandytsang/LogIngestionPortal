<#
.SYNOPSIS
    Grants a Function App's managed identity Microsoft Graph Device.Read.All.

.DESCRIPTION
    Run this when deploy.ps1 could not assign the permission itself (it needs a
    Graph admin — Privileged Role Administrator / Global Administrator — which is
    often a different person than whoever ran the deployment). Idempotent.

.EXAMPLE
    ./AssignMSIPermisison.ps1 -ResourceGroup rg-log-ingestion-api -FunctionAppName func-logapi-dev-ab12c
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [Alias('rg')] [string]$ResourceGroup,
    [Parameter(Mandatory)] [Alias('func')] [string]$FunctionAppName
)

$ErrorActionPreference = 'Stop'

# Function App managed-identity object id
$miId = az functionapp identity show -g $ResourceGroup -n $FunctionAppName --query principalId -o tsv
if (-not $miId) { throw "Could not find a managed identity on '$FunctionAppName' in '$ResourceGroup'." }

# Microsoft Graph service principal + Device.Read.All app-role id
$graphId = az ad sp list --filter "appId eq '00000003-0000-0000-c000-000000000000'" --query '[0].id' -o tsv
$roleId  = '7438b122-aefc-4978-80ed-43db9fcc7715'   # Device.Read.All (application)

# Assign (skip if it already exists)
$exists = az rest --method GET `
  --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miId/appRoleAssignments" `
  --query "value[?appRoleId=='$roleId'] | [0].id" -o tsv
if ($exists) {
    Write-Host 'Device.Read.All already assigned.'
} else {
    # Pass the JSON body via a temp file (--body "@file"). Inline JSON to
    # `az rest` on Windows/PowerShell gets its quotes stripped, and Graph then
    # returns 'Unable to read JSON request payload'.
    $body = @{ principalId = $miId; resourceId = $graphId; appRoleId = $roleId } | ConvertTo-Json -Compress
    $bodyFile = New-TemporaryFile
    try {
        Set-Content -Path $bodyFile -Value $body -Encoding utf8
        az rest --method POST `
          --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miId/appRoleAssignments" `
          --headers 'Content-Type=application/json' --body "@$bodyFile"
    }
    finally {
        Remove-Item $bodyFile -ErrorAction SilentlyContinue
    }
    Write-Host 'Device.Read.All assigned (propagation can take a few minutes).'
}