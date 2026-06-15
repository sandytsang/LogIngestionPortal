// ---------------------------------------------------------------------------
// Grants the Function's managed identity Monitoring Metrics Publisher on the
// DCR. Deployed into the DCR's RG (role assignment scope = the DCR resource).
// ---------------------------------------------------------------------------
@description('Name of the DCR to scope the role assignment to.')
param dcrName string

@description('Principal id of the Function App managed identity.')
param principalId string

@description('Role definition id (Monitoring Metrics Publisher).')
param roleDefinitionId string

resource dcr 'Microsoft.Insights/dataCollectionRules@2023-03-11' existing = {
  name: dcrName
}

resource dcrRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(dcr.id, principalId, roleDefinitionId)
  scope: dcr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
