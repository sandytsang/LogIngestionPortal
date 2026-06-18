// ---------------------------------------------------------------------------
// Grants the Function's managed identity Monitoring Metrics Publisher on the
// DCR's resource group (role assignment scope = the resource group this module
// is deployed into). Resource-group scope covers the DCR and any other DCRs in
// the same RG, so a schema redeploy that recreates the DCR keeps working without
// re-granting the role.
// ---------------------------------------------------------------------------
@description('Principal id of the Function App managed identity.')
param principalId string

@description('Role definition id (Monitoring Metrics Publisher).')
param roleDefinitionId string

resource rgRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, principalId, roleDefinitionId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
