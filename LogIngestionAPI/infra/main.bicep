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

@description('Azure region for resources created/updated in this RG (Function App + workspace when it is created here). The DCR follows the workspace region automatically.')
param location string = resourceGroup().location

@description('Exact Function App name (no hash appended). Globally unique across Azure. Required for a full deploy; ignored for a schema-only update or when deploying into an existing app by principal id.')
param functionAppName string = ''

@description('Function App hosting plan. Consumption = Windows Y1. Flex = Linux Flex Consumption (FC1) with PowerShell 7.4.')
@allowed([ 'Consumption', 'Flex' ])
param functionPlanType string = 'Consumption'

@description('When true, deploy ONLY the Log Analytics custom table + DCR (schema update). The Function App and its dependencies are not deployed, and the workspace is referenced (not managed). Requires an existing workspace.')
param schemaOnly bool = false

@description('Resource group for the Data Collection Rule. Defaults to this deployment\'s RG when empty.')
param dcrResourceGroup string = ''

@description('Exact name of the Data Collection Rule to create/update.')
param dcrName string = ''

@description('Log Analytics data retention in days.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 90

@description('Exact Log Analytics workspace name. Created if it does not exist, updated in place if it does.')
param workspaceName string = ''

@description('Region for the workspace. Defaults to location. Pass the workspace\'s existing region when it already exists (a workspace location cannot be changed in place).')
param workspaceLocation string = ''

@description('Resource group of the Log Analytics workspace. Defaults to this deployment\'s RG when empty.')
param workspaceResourceGroup string = ''

// ---------------------------------------------------------------------------
// Device authentication (JWT) - all values become Function app settings.
// ---------------------------------------------------------------------------
@description('Optional. The JWT aud claim must equal this value. Leave empty to auto-bind to the Function App\'s own hostname. Set explicitly only for a custom domain / front door.')
param jwtExpectedAudience string = ''

@description('Optional. Pin requests to a single Entra tenant id (the JWT tid claim). Leave empty to allow any tenant.')
param jwtAllowedTenantId string = ''

@description('When true, resolve the device in Entra and validate its certificate against the device record (needs Graph Device.Read.All). When false, validate signature + MS-Organization-Access issuer only.')
param jwtRequireEntraDevice bool = true

@description('When true, the deployment grants the Function App\'s managed identity Monitoring Metrics Publisher on the DCR. Set false when the deployer only has Contributor (no rights to create role assignments); the role must then be granted separately.')
param assignDcrPublisherRole bool = true

@description('Principal id of an existing Function App\'s managed identity to deploy against instead of creating a new Function App. When set, the Function App and its storage/plan/App Insights are NOT created; only the table, DCR and the DCR role assignment (for this principal) are deployed. deploy.ps1 sets this from -ExistingFunctionAppName and configures the existing app\'s settings + code separately.')
param existingFunctionPrincipalId string = ''

// ---------------------------------------------------------------------------
// Schema - single source of truth
//
// columns.json holds one or more custom tables. Each table becomes its own
// Log Analytics custom table and DCR stream (Custom-<tableName>). TimeGenerated
// is part of every table's column list.
// ---------------------------------------------------------------------------
var schema = loadJsonContent('../schema/columns.json')
var tables = schema.tables
// Comma-separated list of table names; the Function derives the stream name
// (Custom-<tableName>) for each and routes the matching payload group to it.

// ---------------------------------------------------------------------------
// Resource group resolution
// ---------------------------------------------------------------------------
// The workspace is managed (created or updated in place) on a full deploy, and
// only referenced (not managed) during a schema-only update.
var manageWorkspace = !schemaOnly
// Skip creating the Function App (and its storage/plan/App Insights) when an
// existing app's managed-identity principal id was supplied.
var createFunctionApp = !schemaOnly && empty(existingFunctionPrincipalId)
var primaryRg = resourceGroup().name
var dcrRg = empty(dcrResourceGroup) ? primaryRg : dcrResourceGroup
var laRg = empty(workspaceResourceGroup) ? primaryRg : workspaceResourceGroup

var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
module logAnalytics 'modules/logAnalytics.bicep' = {
  name: 'logAnalytics'
  scope: resourceGroup(laRg)
  params: {
    manageWorkspace: manageWorkspace
    workspaceName: workspaceName
    location: empty(workspaceLocation) ? location : workspaceLocation
    retentionInDays: retentionInDays
    tables: tables
  }
}

module dcr 'modules/dcr.bicep' = {
  name: 'dcr'
  scope: resourceGroup(dcrRg)
  params: {
    dcrName: dcrName
    location: logAnalytics.outputs.workspaceLocation
    workspaceResourceId: logAnalytics.outputs.workspaceId
    tables: tables
  }
}

module functionApp 'modules/functionApp.bicep' = if (createFunctionApp) {
  name: 'functionApp'
  params: {
    functionAppName: functionAppName
    location: location
    functionPlanType: functionPlanType
    workspaceResourceId: logAnalytics.outputs.workspaceId
    dcrEndpoint: dcr.outputs.logsIngestionEndpoint
    dcrImmutableId: dcr.outputs.immutableId
    jwtExpectedAudience: jwtExpectedAudience
    jwtAllowedTenantId: jwtAllowedTenantId
    jwtRequireEntraDevice: jwtRequireEntraDevice
  }
}

module dcrRoleAssignment 'modules/dcrRoleAssignment.bicep' = if (!schemaOnly && assignDcrPublisherRole) {
  name: 'dcrRoleAssignment'
  scope: resourceGroup(dcrRg)
  params: {
    dcrName: dcr.outputs.dcrName
    #disable-next-line BCP318
    principalId: createFunctionApp ? functionApp.outputs.principalId : existingFunctionPrincipalId
    roleDefinitionId: monitoringMetricsPublisherRoleId
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
#disable-next-line BCP318
output functionAppName string = createFunctionApp ? functionApp.outputs.functionAppName : ''
#disable-next-line BCP318
output functionAppHostName string = createFunctionApp ? functionApp.outputs.functionAppHostName : ''
#disable-next-line BCP318
output functionPrincipalId string = createFunctionApp ? functionApp.outputs.principalId : existingFunctionPrincipalId
output functionResourceGroup string = primaryRg
output dcrResourceGroup string = dcrRg
output dcrName string = dcr.outputs.dcrName
output logAnalyticsResourceGroup string = laRg
output dcrImmutableId string = dcr.outputs.immutableId
output dcrIngestionEndpoint string = dcr.outputs.logsIngestionEndpoint
output dcrStreamNames array = map(tables, t => 'Custom-${t.tableName}')
output logAnalyticsWorkspaceId string = logAnalytics.outputs.workspaceCustomerId
output customTableNames array = map(tables, t => t.tableName)
output functionPlanType string = functionPlanType
output schemaOnly bool = schemaOnly
// True when the deployment created the DCR role assignment itself. When false
// (Contributor-only deploy), grant Monitoring Metrics Publisher separately.
output dcrRoleAssigned bool = !schemaOnly && assignDcrPublisherRole
output monitoringMetricsPublisherRoleId string = monitoringMetricsPublisherRoleId
