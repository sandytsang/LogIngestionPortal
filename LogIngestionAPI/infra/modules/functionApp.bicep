// ---------------------------------------------------------------------------
// Function App + its co-located dependencies (storage, App Insights, plan).
// Deployed into the Function App's RG. Storage, App Insights and the App
// Service plan always live with the Function App. Supports Consumption (Windows
// Y1) or Flex Consumption (Linux FC1); both run PowerShell 7.4.
// ---------------------------------------------------------------------------
@description('Base name used to derive resource names.')
param baseName string

@description('Environment short name.')
param environment string

@description('Region for the Function App and its dependencies.')
param location string

@description('Hosting plan: Consumption or Flex.')
@allowed([ 'Consumption', 'Flex' ])
param functionPlanType string

@description('Resource id of the Log Analytics workspace (for App Insights).')
param workspaceResourceId string

@description('DCR logsIngestion endpoint.')
param dcrEndpoint string

@description('DCR immutable id.')
param dcrImmutableId string

@description('Comma-separated custom table names. The Function derives each DCR stream as Custom-<tableName>.')
param dcrStreams string

@description('Optional JWT audience override. Empty = bind to this app hostname.')
param jwtExpectedAudience string = ''

@description('Optional Entra tenant id to pin requests to.')
param jwtAllowedTenantId string = ''

@description('Validate the device against its Entra record (needs Graph Device.Read.All).')
param jwtRequireEntraDevice bool = true

// Names follow the Cloud Adoption Framework resource abbreviations
// (https://aka.ms/CAF/abbreviations): func- (Function App), asp- (App Service
// plan), appi- (Application Insights), st (storage account, no hyphens).
var suffix = uniqueString(resourceGroup().id, baseName, environment)
var funcName = 'func-${baseName}-${environment}-${substring(suffix, 0, 5)}'
var planName = 'asp-${baseName}-${environment}'
var aiName = 'appi-${baseName}-${environment}'
var storageName = toLower(take('st${baseName}${suffix}', 24))

var defaultAudience = 'https://${funcName}.azurewebsites.net'
var effectiveAudience = empty(jwtExpectedAudience) ? defaultAudience : jwtExpectedAudience

var isFlex = functionPlanType == 'Flex'
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'

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

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: aiName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspaceResourceId
  }
}

// Settings shared by both hosting plans.
var commonAppSettings = [
  {
    name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
    value: appInsights.properties.ConnectionString
  }
  {
    name: 'DCR_ENDPOINT'
    value: dcrEndpoint
  }
  {
    name: 'DCR_IMMUTABLE_ID'
    value: dcrImmutableId
  }
  {
    name: 'DCR_STREAMS'
    value: dcrStreams
  }
  {
    // Device-JWT authentication is always required. run.ps1 rejects any request
    // without a valid device-signed JWT (see function/Modules/DeviceJwtAuth).
    name: 'JWT_ENFORCE'
    value: 'true'
  }
  {
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

var consumptionAppSettings = concat([
  {
    name: 'AzureWebJobsStorage'
    value: storageConnectionString
  }
  {
    name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
    value: storageConnectionString
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
    name: 'WEBSITE_RUN_FROM_PACKAGE'
    value: '1'
  }
], commonAppSettings)

var flexAppSettings = concat([
  {
    name: 'AzureWebJobsStorage'
    value: storageConnectionString
  }
], commonAppSettings)

// Blob container Flex uses to store the deployed application package.
resource flexDeploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = if (isFlex) {
  name: '${storage.name}/default/${funcName}-pkg'
}

// --- Consumption plan (Windows Y1) ------------------------------------------
resource consumptionPlan 'Microsoft.Web/serverfarms@2023-12-01' = if (!isFlex) {
  name: planName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

resource functionAppConsumption 'Microsoft.Web/sites@2023-12-01' = if (!isFlex) {
  name: funcName
  location: location
  kind: 'functionapp'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: consumptionPlan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      powerShellVersion: '7.4'
      appSettings: consumptionAppSettings
    }
  }
}

// --- Flex Consumption plan (Linux FC1) --------------------------------------
resource flexPlan 'Microsoft.Web/serverfarms@2023-12-01' = if (isFlex) {
  name: planName
  location: location
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource functionAppFlex 'Microsoft.Web/sites@2023-12-01' = if (isFlex) {
  name: funcName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: flexPlan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${funcName}-pkg'
          authentication: {
            type: 'StorageAccountConnectionString'
            storageAccountConnectionStringName: 'AzureWebJobsStorage'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 100
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'powershell'
        version: '7.4'
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: flexAppSettings
    }
  }
  dependsOn: [
    flexDeploymentContainer
  ]
}

#disable-next-line BCP318
output functionAppName string = isFlex ? functionAppFlex.name : functionAppConsumption.name
#disable-next-line BCP318
output functionAppHostName string = isFlex ? functionAppFlex.properties.defaultHostName : functionAppConsumption.properties.defaultHostName
#disable-next-line BCP318
output principalId string = isFlex ? functionAppFlex.identity.principalId : functionAppConsumption.identity.principalId
