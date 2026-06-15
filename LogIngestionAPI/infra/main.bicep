// ---------------------------------------------------------------------------
// Log Ingestion API solution (resource-group-scoped)
//
// Deploys into the deployment's resource group (the "primary" RG = Function App
// RG), which always holds the Function App, its storage account, Application
// Insights and the App Service plan. When creating a new Log Analytics
// workspace, it is created in this same RG.
//
// The Data Collection Rule defaults to the primary RG but can target a different
// RG via dcrResourceGroup. An existing Log Analytics workspace can be reused
// from any RG via existingWorkspaceName + existingWorkspaceResourceGroup.
//
// RG-scoped on purpose: the caller only needs Contributor on the resource
// group(s) involved. scripts/deploy.ps1 ensures the RGs exist first.
//
// The table schema and DCR stream are BOTH generated from schema/columns.json so
// a single redeploy keeps everything in sync.
// ---------------------------------------------------------------------------
targetScope = 'resourceGroup'

@description('Base name used to derive all resource names. 3-17 lowercase chars.')
@minLength(3)
@maxLength(17)
param baseName string = 'loging'

@description('Azure region for resources created in this RG (Function App + a new workspace). The DCR follows the workspace region automatically.')
param location string = resourceGroup().location

@description('Environment short name, appended to resource names.')
@allowed([ 'dev', 'test', 'prod' ])
param environment string = 'dev'

@description('Function App hosting plan. Consumption = Windows Y1. Flex = Linux Flex Consumption (FC1) with PowerShell 7.4.')
@allowed([ 'Consumption', 'Flex' ])
param functionPlanType string = 'Consumption'

@description('When true, deploy ONLY the Log Analytics custom table + DCR (schema update). The Function App and its dependencies are not deployed. Requires an existing workspace.')
param schemaOnly bool = false

@description('Resource group for the Data Collection Rule. Defaults to this deployment\'s RG when empty.')
param dcrResourceGroup string = ''

@description('Log Analytics data retention in days.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 90

@description('Name of an existing Log Analytics workspace to reuse. Leave empty to create a new one in this RG.')
param existingWorkspaceName string = ''

@description('Resource group of the existing Log Analytics workspace. Defaults to this deployment\'s RG when empty.')
param existingWorkspaceResourceGroup string = ''

// ---------------------------------------------------------------------------
// Device authentication (JWT) - all values become Function app settings.
// ---------------------------------------------------------------------------
@description('Optional. The JWT aud claim must equal this value. Leave empty to auto-bind to the Function App\'s own hostname. Set explicitly only for a custom domain / front door.')
param jwtExpectedAudience string = ''

@description('Optional. Pin requests to a single Entra tenant id (the JWT tid claim). Leave empty to allow any tenant.')
param jwtAllowedTenantId string = ''

@description('When true, resolve the device in Entra and validate its certificate against the device record (needs Graph Device.Read.All). When false, validate signature + MS-Organization-Access issuer only.')
param jwtRequireEntraDevice bool = true

// ---------------------------------------------------------------------------
// Schema - single source of truth
// ---------------------------------------------------------------------------
var schema = loadJsonContent('../schema/columns.json')
var tableName = schema.tableName
var streamName = 'Custom-${tableName}'

var streamColumns = [for col in schema.columns: {
  name: col.name
  type: col.type
}]
var tableColumns = [for col in schema.columns: {
  name: col.name
  type: col.type
}]
var projectedColumns = join(map(schema.columns, c => c.name), ', ')
var transformKql = 'source | project ${projectedColumns}'

// ---------------------------------------------------------------------------
// Resource group resolution
// ---------------------------------------------------------------------------
var createWorkspace = empty(existingWorkspaceName)
var primaryRg = resourceGroup().name
var dcrRg = empty(dcrResourceGroup) ? primaryRg : dcrResourceGroup
var laRg = createWorkspace
  ? primaryRg
  : (empty(existingWorkspaceResourceGroup) ? primaryRg : existingWorkspaceResourceGroup)

// ---------------------------------------------------------------------------
// Naming (RG-unique names; the Function App computes its own globally-unique
// names inside its module where resourceGroup() is in scope).
// Names follow the Cloud Adoption Framework resource abbreviations
// (https://aka.ms/CAF/abbreviations): log- (workspace), dcr- (data collection rule).
// ---------------------------------------------------------------------------
var lawName = 'log-${baseName}-${environment}'
var dcrName = 'dcr-${baseName}-${environment}'

var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
module logAnalytics 'modules/logAnalytics.bicep' = {
  name: 'logAnalytics'
  scope: resourceGroup(laRg)
  params: {
    createWorkspace: createWorkspace
    lawName: lawName
    existingWorkspaceName: existingWorkspaceName
    location: location
    retentionInDays: retentionInDays
    tableName: tableName
    tableDescription: schema.description
    tableColumns: tableColumns
  }
}

module dcr 'modules/dcr.bicep' = {
  name: 'dcr'
  scope: resourceGroup(dcrRg)
  params: {
    dcrName: dcrName
    location: logAnalytics.outputs.workspaceLocation
    workspaceResourceId: logAnalytics.outputs.workspaceId
    streamName: streamName
    streamColumns: streamColumns
    transformKql: transformKql
  }
}

module functionApp 'modules/functionApp.bicep' = if (!schemaOnly) {
  name: 'functionApp'
  params: {
    baseName: baseName
    environment: environment
    location: location
    functionPlanType: functionPlanType
    workspaceResourceId: logAnalytics.outputs.workspaceId
    dcrEndpoint: dcr.outputs.logsIngestionEndpoint
    dcrImmutableId: dcr.outputs.immutableId
    dcrStream: streamName
    jwtExpectedAudience: jwtExpectedAudience
    jwtAllowedTenantId: jwtAllowedTenantId
    jwtRequireEntraDevice: jwtRequireEntraDevice
  }
}

module dcrRoleAssignment 'modules/dcrRoleAssignment.bicep' = if (!schemaOnly) {
  name: 'dcrRoleAssignment'
  scope: resourceGroup(dcrRg)
  params: {
    dcrName: dcr.outputs.dcrName
    #disable-next-line BCP318
    principalId: functionApp.outputs.principalId
    roleDefinitionId: monitoringMetricsPublisherRoleId
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
#disable-next-line BCP318
output functionAppName string = schemaOnly ? '' : functionApp.outputs.functionAppName
#disable-next-line BCP318
output functionAppHostName string = schemaOnly ? '' : functionApp.outputs.functionAppHostName
output functionResourceGroup string = primaryRg
output dcrResourceGroup string = dcrRg
output logAnalyticsResourceGroup string = laRg
output dcrImmutableId string = dcr.outputs.immutableId
output dcrIngestionEndpoint string = dcr.outputs.logsIngestionEndpoint
output dcrStreamName string = streamName
output logAnalyticsWorkspaceId string = logAnalytics.outputs.workspaceCustomerId
output customTableName string = tableName
output functionPlanType string = functionPlanType
output schemaOnly bool = schemaOnly
