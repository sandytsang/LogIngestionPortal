// ---------------------------------------------------------------------------
// Log Ingestion API solution
// Deploys: Log Analytics workspace, custom table, DCR (kind=Direct, NO DCE),
//          PowerShell Function App + storage + App Insights, and the role
//          assignment that lets the Function publish to the DCR.
//
// The table schema and DCR stream are BOTH generated from schema/columns.json
// so a single redeploy keeps everything in sync. Add/remove a column there and
// redeploy - no Function code changes required.
// ---------------------------------------------------------------------------

@description('Base name used to derive all resource names. 3-17 lowercase chars.')
@minLength(3)
@maxLength(17)
param baseName string = 'loging'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Environment short name, appended to resource names.')
@allowed([ 'dev', 'test', 'prod' ])
param environment string = 'dev'

@description('Log Analytics data retention in days.')
@minValue(30)
@maxValue(730)
param retentionInDays int = 90

@description('Name of an existing Log Analytics workspace to reuse. Leave empty to create a new one.')
param existingWorkspaceName string = ''

@description('Resource group of the existing Log Analytics workspace. Leave empty to use this deployment\'s resource group.')
param existingWorkspaceResourceGroup string = ''

// ---------------------------------------------------------------------------
// Device authentication (JWT) - all values are app settings, nothing hardcoded
// in the function code or device scripts. Toggle/scope auth purely from here.
// ---------------------------------------------------------------------------
@description('Require a device-signed JWT (Authorization: Bearer) on each request. Set to true once devices are sending JWTs.')
param jwtEnforce bool = false

@description('Optional. The JWT aud claim must equal this value. Leave empty to auto-bind to this Function App\'s own hostname (https://<func>.azurewebsites.net). Set explicitly only for a custom domain / front door.')
param jwtExpectedAudience string = ''

@description('Optional. Pin requests to a single Entra tenant id (the JWT tid claim). Leave empty to allow any tenant.')
param jwtAllowedTenantId string = ''

@description('When true, resolve the device in Entra and validate its certificate against the device record (needs Graph Device.Read.All). When false, validate signature + MS-Organization-Access issuer only (no Graph permission required).')
param jwtRequireEntraDevice bool = true

// ---------------------------------------------------------------------------
// Schema - single source of truth
// ---------------------------------------------------------------------------
var schema = loadJsonContent('../schema/columns.json')
var tableName = schema.tableName
var streamName = 'Custom-${tableName}'

// All declared columns (used for the DCR stream declaration).
var streamColumns = [for col in schema.columns: {
  name: col.name
  type: col.type
}]

// Table columns: the custom table schema must include 'TimeGenerated' (it is a
// mandatory column for DCR-based ingestion and is NOT added automatically), so
// every declared column is used as-is.
var tableColumns = [for col in schema.columns: {
  name: col.name
  type: col.type
}]

// Build "source | project Col1, Col2, ..." so the DCR maps every declared column.
var projectedColumns = join(map(schema.columns, c => c.name), ', ')
var transformKql = 'source | project ${projectedColumns}'

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
var suffix = uniqueString(resourceGroup().id, baseName, environment)
var lawName = '${baseName}-law-${environment}'
var dcrName = '${baseName}-dcr-${environment}'
var funcName = '${baseName}-func-${environment}-${substring(suffix, 0, 5)}'
var planName = '${baseName}-plan-${environment}'
var aiName = '${baseName}-ai-${environment}'
var storageName = toLower(take('${baseName}st${suffix}', 24))

// JWT audience: default to this Function App's own hostname so it is bound
// automatically. Override jwtExpectedAudience only when the device calls the
// function through a custom domain / front door.
var defaultAudience = 'https://${funcName}.azurewebsites.net'
var effectiveAudience = empty(jwtExpectedAudience) ? defaultAudience : jwtExpectedAudience

var monitoringMetricsPublisherRoleId = '3913510d-42f4-4e42-8a64-420c390055eb'

// ---------------------------------------------------------------------------
// Log Analytics workspace + custom table
//
// When existingWorkspaceName is provided the workspace is reused (and must live
// in the same resource group as this deployment); otherwise a new one is
// created. The custom table is (re)created either way so the schema stays in
// sync with schema/columns.json.
// ---------------------------------------------------------------------------
var createWorkspace = empty(existingWorkspaceName)
var effectiveLawName = createWorkspace ? lawName : existingWorkspaceName
var workspaceRg = empty(existingWorkspaceResourceGroup) ? resourceGroup().name : existingWorkspaceResourceGroup

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
  scope: resourceGroup(workspaceRg)
}

var lawId = createWorkspace ? newLaw.id : existingLaw.id
// The ternary guarantees only the resource that exists is read; the BCP318
// null-possibility warning is therefore a false positive here.
#disable-next-line BCP318
var workspaceCustomerId = createWorkspace ? newLaw.properties.customerId : existingLaw.properties.customerId

resource customTable 'Microsoft.OperationalInsights/workspaces/tables@2023-09-01' = {
  name: '${effectiveLawName}/${tableName}'
  properties: {
    totalRetentionInDays: retentionInDays
    schema: {
      name: tableName
      description: schema.description
      columns: tableColumns
    }
  }
  dependsOn: [
    newLaw
  ]
}

// ---------------------------------------------------------------------------
// Data Collection Rule - kind 'Direct' exposes its own logsIngestion endpoint
// so NO Data Collection Endpoint (DCE) is required.
// ---------------------------------------------------------------------------
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
          workspaceResourceId: lawId
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
  dependsOn: [
    customTable
  ]
}

// ---------------------------------------------------------------------------
// Storage account (required by Functions runtime)
// ---------------------------------------------------------------------------
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

// ---------------------------------------------------------------------------
// Application Insights
// ---------------------------------------------------------------------------
resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: lawId
  }
}

// ---------------------------------------------------------------------------
// Function App (PowerShell, Windows consumption plan)
// ---------------------------------------------------------------------------
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: funcName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    // --- Future option: mutual TLS (client certificate) with Cloud PKI -------
    // Device-JWT (above) is the active auth method. To ALSO require a client
    // certificate at the platform edge once Cloud PKI / SCEP / PKCS is in place,
    // uncomment the next line and validate the issuer in run.ps1 via the
    // X-ARR-ClientCert header (App Service only checks that *a* cert is present).
    //   clientCertMode: 'Required'        // or 'OptionalInteractiveUser'
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      powerShellVersion: '7.4'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(funcName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'powershell'
        }
        {
          // Owned by the template so an infra-only redeploy never strips the
          // setting that `func publish` relies on (otherwise the deployed
          // package is unmounted and the function disappears). Value 1 keeps the
          // package already uploaded by `func azure functionapp publish`.
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'DCR_ENDPOINT'
          value: dcr.properties.endpoints.logsIngestion
        }
        {
          name: 'DCR_IMMUTABLE_ID'
          value: dcr.properties.immutableId
        }
        {
          name: 'DCR_STREAM'
          value: streamName
        }
        {
          // Device-JWT authentication switch. When 'true', run.ps1 requires a
          // valid device-signed JWT (see function/Modules/DeviceJwtAuth).
          name: 'JWT_ENFORCE'
          value: toLower(string(jwtEnforce))
        }
        {
          // Defaults to this Function App's own hostname (effectiveAudience);
          // set jwtExpectedAudience to override for a custom domain.
          name: 'JWT_EXPECTED_AUDIENCE'
          value: effectiveAudience
        }
        {
          name: 'JWT_ALLOWED_TENANT_ID'
          value: jwtAllowedTenantId
        }
        {
          name: 'JWT_REQUIRE_ENTRA_DEVICE'
          value: toLower(string(jwtRequireEntraDevice))
        }
      ]
    }
  }
}

// Allow the Function's managed identity to publish data to the DCR.
resource dcrRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(dcr.id, functionApp.id, monitoringMetricsPublisherRoleId)
  scope: dcr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisherRoleId)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
output functionAppName string = functionApp.name
output functionAppHostName string = functionApp.properties.defaultHostName
output dcrImmutableId string = dcr.properties.immutableId
output dcrIngestionEndpoint string = dcr.properties.endpoints.logsIngestion
output dcrStreamName string = streamName
output logAnalyticsWorkspaceId string = workspaceCustomerId
output customTableName string = tableName
