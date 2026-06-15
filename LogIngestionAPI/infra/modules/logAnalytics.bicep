// ---------------------------------------------------------------------------
// Log Analytics workspace + custom table (deployed into the workspace's RG).
// Creates a new workspace, or references an existing one, and (re)creates the
// custom table so the schema stays in sync with schema/columns.json.
// ---------------------------------------------------------------------------
@description('Create a new workspace (true) or reference an existing one (false).')
param createWorkspace bool

@description('Name for a new workspace.')
param lawName string

@description('Name of the existing workspace to reference when createWorkspace is false.')
param existingWorkspaceName string = ''

@description('Region for a new workspace.')
param location string

@description('Data retention in days.')
param retentionInDays int

@description('Custom table name (must end in _CL).')
param tableName string

@description('Custom table description.')
param tableDescription string

@description('Custom table columns ({ name, type }).')
param tableColumns array

resource newLaw 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (createWorkspace) {
  name: lawName
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

resource existingLaw 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = if (!createWorkspace) {
  name: existingWorkspaceName
}

var effectiveLawName = createWorkspace ? lawName : existingWorkspaceName
// The ternary guarantees only the resource that exists is read; the BCP318
// null-possibility warnings are therefore false positives here.
#disable-next-line BCP318
var lawId = createWorkspace ? newLaw.id : existingLaw.id
#disable-next-line BCP318
var lawLocation = createWorkspace ? location : existingLaw.location
#disable-next-line BCP318
var lawCustomerId = createWorkspace ? newLaw.properties.customerId : existingLaw.properties.customerId

resource customTable 'Microsoft.OperationalInsights/workspaces/tables@2023-09-01' = {
  name: '${effectiveLawName}/${tableName}'
  properties: {
    totalRetentionInDays: retentionInDays
    schema: {
      name: tableName
      description: tableDescription
      columns: tableColumns
    }
  }
  dependsOn: [
    newLaw
  ]
}

output workspaceId string = lawId
output workspaceLocation string = lawLocation
output workspaceCustomerId string = lawCustomerId
