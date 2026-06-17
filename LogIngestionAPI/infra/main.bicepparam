using './main.bicep'

// Exact resource names. Pick whatever fits your tenant's naming standard; the
// portal/deploy script suggest defaults but you can use anything valid. The
// Function App name has NO hash and must be globally unique (it becomes
// <name>.azurewebsites.net).
param functionAppName = 'func-logapi-dev'
param workspaceName = 'log-logapi-dev'
param dcrName = 'dcr-logapi-dev'
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
// also holds storage, App Insights and the plan). The DCR and the workspace can
// optionally live in different RGs; leave empty to co-locate with the deployment
// RG. deploy.ps1 sets these from -DcrResourceGroup / -WorkspaceResourceGroup.
param dcrResourceGroup = ''
param workspaceResourceGroup = ''

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
