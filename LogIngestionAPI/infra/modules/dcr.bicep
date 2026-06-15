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

@description('Stream name (Custom-<tableName>).')
param streamName string

@description('Stream column declarations ({ name, type }).')
param streamColumns array

@description('transformKql applied to the incoming stream.')
param transformKql string

resource dcr 'Microsoft.Insights/dataCollectionRules@2023-03-11' = {
  name: dcrName
  location: location
  kind: 'Direct'
  properties: {
    streamDeclarations: {
      '${streamName}': {
        columns: streamColumns
      }
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: workspaceResourceId
          name: 'lawDestination'
        }
      ]
    }
    dataFlows: [
      {
        streams: [ streamName ]
        destinations: [ 'lawDestination' ]
        transformKql: transformKql
        outputStream: streamName
      }
    ]
  }
}

output dcrName string = dcr.name
output immutableId string = dcr.properties.immutableId
output logsIngestionEndpoint string = dcr.properties.endpoints.logsIngestion
