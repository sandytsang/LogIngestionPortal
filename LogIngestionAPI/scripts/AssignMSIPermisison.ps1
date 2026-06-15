$rg   = '<resource-group>'
$func = '<function-app-name>'

# Function App managed-identity object id
$miId = az functionapp identity show -g $rg -n $func --query principalId -o tsv

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
    $body = @{ principalId = $miId; resourceId = $graphId; appRoleId = $roleId } | ConvertTo-Json -Compress
    az rest --method POST `
      --uri "https://graph.microsoft.com/v1.0/servicePrincipals/$miId/appRoleAssignments" `
      --headers 'Content-Type=application/json' --body $body
    Write-Host 'Device.Read.All assigned (propagation can take a few minutes).'
}