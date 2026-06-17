// ---------------------------------------------------------------------------
// Log Analytics workspace + custom table (deployed into the workspace's RG).
// Declares (creates or updates) the workspace by name, or references it without
// managing it during a schema-only update, then (re)creates the custom tables so
// the schema stays in sync with schema/columns.json.
// ---------------------------------------------------------------------------
@description('When true, declare/upsert the workspace (create it or update it in place). When false, reference the existing workspace without managing its top-level properties (schema-only updates).')
param manageWorkspace bool

@description('Exact Log Analytics workspace name.')
param workspaceName string

@description('Region for the workspace when it is being created/updated.')
param location string

@description('Data retention in days.')
param retentionInDays int

@description('Custom tables ({ tableName, description, columns[] }). Each (re)created so the schema stays in sync with schema/columns.json.')
param tables array

resource managedLaw 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (manageWorkspace) {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource referencedLaw 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = if (!manageWorkspace) {
  name: workspaceName
}

// The ternary guarantees only the resource that exists is read; the BCP318
// null-possibility warnings are therefore false positives here.
#disable-next-line BCP318
var lawId = manageWorkspace ? managedLaw.id : referencedLaw.id
#disable-next-line BCP318
var lawLocation = manageWorkspace ? location : referencedLaw.location
#disable-next-line BCP318
var lawCustomerId = manageWorkspace ? managedLaw.properties.customerId : referencedLaw.properties.customerId

resource customTablesManaged 'Microsoft.OperationalInsights/workspaces/tables@2023-09-01' = [for t in tables: if (manageWorkspace) {
  name: t.tableName
  parent: managedLaw
  properties: {
    totalRetentionInDays: retentionInDays
    schema: {
      name: t.tableName
      description: t.description
      columns: map(t.columns, c => {
        name: c.name
        type: c.type
      })
    }
  }
}]

resource customTablesReferenced 'Microsoft.OperationalInsights/workspaces/tables@2023-09-01' = [for t in tables: if (!manageWorkspace) {
  parent: referencedLaw
  name: t.tableName
  properties: {
    totalRetentionInDays: retentionInDays
    schema: {
      name: t.tableName
      description: t.description
      columns: map(t.columns, c => {
        name: c.name
        type: c.type
      })
    }
  }
}]

output workspaceId string = lawId
output workspaceLocation string = lawLocation
output workspaceCustomerId string = lawCustomerId
