// ---------------------------------------------------------------------------
// Data Collection Rule (kind 'Direct', no DCE). Deployed into the DCR's RG.
// MUST be in the same region as its destination Log Analytics workspace, so the
// caller passes the workspace's region as 'location'.
// ---------------------------------------------------------------------------
@description('DCR name.')
param dcrName string

@description('Region — must match the destination workspace region.')
param location string

@description('Resource id of the destination Log Analytics workspace.')
param workspaceResourceId string

@description('Custom tables ({ tableName, description, columns[] }). Each becomes a Custom-<tableName> stream.')
param tables array

// One stream declaration per table, keyed by Custom-<tableName>.
var streamDeclarations = toObject(
  tables,
  t => 'Custom-${t.tableName}',
  t => {
    columns: map(t.columns, c => {
      name: c.name
      type: c.type
    })
  }
)

// One data flow per table: pass the stream through (projecting its columns) into
// the matching custom table.
var dataFlows = [for t in tables: {
  streams: [ 'Custom-${t.tableName}' ]
  destinations: [ 'lawDestination' ]
  transformKql: 'source | project ${join(map(t.columns, c => c.name), ', ')}'
  outputStream: 'Custom-${t.tableName}'
}]

resource dcr 'Microsoft.Insights/dataCollectionRules@2023-03-11' = {
  name: dcrName
  location: location
  kind: 'Direct'
  properties: {
    streamDeclarations: streamDeclarations
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: workspaceResourceId
          name: 'lawDestination'
        }
      ]
    }
    dataFlows: dataFlows
  }
}

output dcrName string = dcr.name
output immutableId string = dcr.properties.immutableId
output logsIngestionEndpoint string = dcr.properties.endpoints.logsIngestion
