using './main.bicep'

param baseName = 'logapi'
param environment = 'dev'
param location = 'eastus'
param retentionInDays = 90

// Function App hosting plan:
//   'Consumption' = Windows Y1 (classic serverless, pay-per-execution).
//   'Flex'        = Linux Flex Consumption (FC1), PowerShell 7.4, faster cold
//                   starts, VNet support. Note: Flex is not available in every
//                   region — check region support before choosing it.
param functionPlanType = 'Consumption'

// --- Resource groups --------------------------------------------------------
// This template is resource-group scoped: it deploys into the RG passed to
// `az deployment group create --resource-group <rg>` (the Function App RG, which
// also holds storage, App Insights, the plan and a new workspace). The DCR can
// optionally target a different RG; leave empty to co-locate with the Function
// App RG. deploy.ps1 sets this from -DcrResourceGroup.
param dcrResourceGroup = ''

// To reuse an existing Log Analytics workspace, set its name here. Leave empty
// to create a new workspace. If the workspace lives in a different resource
// group, also set existingWorkspaceResourceGroup.
param existingWorkspaceName = ''
param existingWorkspaceResourceGroup = ''

// --- Device authentication (JWT) --------------------------------------------
// Device-signed JWT authentication is always required; there is no toggle.
// Optional: the JWT audience is auto-bound to the Function App's own hostname.
// Override only for a custom domain, e.g.
//   'https://logs.contoso.com'
param jwtExpectedAudience = ''
// Optional: pin to a single Entra tenant id.
param jwtAllowedTenantId = ''
// true  = validate the cert against the Entra device record (needs Graph Device.Read.All).
// false = validate signature + MS-Organization-Access issuer only (no Graph permission).
param jwtRequireEntraDevice = true
