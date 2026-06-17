// ---------------------------------------------------------------------------
// Function App + its co-located dependencies (storage, App Insights, plan).
// Deployed into the Function App's RG. Storage, App Insights and the App
// Service plan always live with the Function App. Supports Consumption (Windows
// Y1) or Flex Consumption (Linux FC1); both run PowerShell 7.4.
// ---------------------------------------------------------------------------
@description('Exact Function App name (no hash appended). Must be globally unique across Azure because it becomes <name>.azurewebsites.net.')
param functionAppName string

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

@description('Optional JWT audience override. Empty = bind to this app hostname.')
param jwtExpectedAudience string = ''

@description('Optional Entra tenant id to pin requests to.')
param jwtAllowedTenantId string = ''

@description('Validate the device against its Entra record (needs Graph Device.Read.All).')
param jwtRequireEntraDevice bool = true

// The Function App name is supplied verbatim (no hash). Its co-located
// dependencies derive their names from it: asp- (plan), appi- (App Insights)
// and a storage account (st<sanitized><hash>, since storage names must be
// 3-24 lowercase alphanumerics and globally unique). Only the Function App
// itself is hash-free; the storage hash is an internal, non-user-facing detail.
var funcName = functionAppName
var sanitized = toLower(replace(replace(functionAppName, '-', ''), '_', ''))
var suffix = uniqueString(resourceGroup().id, functionAppName)
var planName = 'asp-${functionAppName}'
var aiName = 'appi-${functionAppName}'
var storageName = toLower(take('st${sanitized}${suffix}', 24))

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
    // Enforce certificate chain validation by default. Graph device lookup is
    // controlled separately by JWT_REQUIRE_ENTRA_DEVICE.
    name: 'JWT_REQUIRE_CERT_CHAIN'
    value: 'true'
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
    clientAffinityEnabled: false
    siteConfig: {
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      use32BitWorkerProcess: false
      powerShellVersion: '7.4'
      appSettings: consumptionAppSettings
    }
  }
}

// Disable basic (username/password) auth on the SCM (Kudu) and FTP publishing
// endpoints. Deployments authenticate with Entra tokens (az login / func
// publish), so the legacy publishing credentials are unnecessary and are a
// common attack surface flagged by security baselines.
resource consumptionScmBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = if (!isFlex) {
  parent: functionAppConsumption
  name: 'scm'
  properties: {
    allow: false
  }
}

resource consumptionFtpBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = if (!isFlex) {
  parent: functionAppConsumption
  name: 'ftp'
  properties: {
    allow: false
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
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: flexAppSettings
    }
  }
  dependsOn: [
    flexDeploymentContainer
  ]
}

// Disable basic-auth publishing on the Flex app too (see note above).
resource flexScmBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = if (isFlex) {
  parent: functionAppFlex
  name: 'scm'
  properties: {
    allow: false
  }
}

resource flexFtpBasicAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = if (isFlex) {
  parent: functionAppFlex
  name: 'ftp'
  properties: {
    allow: false
  }
}

#disable-next-line BCP318
output functionAppName string = isFlex ? functionAppFlex.name : functionAppConsumption.name
#disable-next-line BCP318
output functionAppHostName string = isFlex ? functionAppFlex.properties.defaultHostName : functionAppConsumption.properties.defaultHostName
#disable-next-line BCP318
output principalId string = isFlex ? functionAppFlex.identity.principalId : functionAppConsumption.identity.principalId
