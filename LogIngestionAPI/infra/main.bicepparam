using './main.bicep'

param baseName = 'logapi'
param environment = 'dev'
param location = 'eastus'
param retentionInDays = 90

// To reuse an existing Log Analytics workspace, set its name here. Leave empty
// to create a new workspace. If the workspace lives in a different resource
// group, also set existingWorkspaceResourceGroup.
param existingWorkspaceName = ''
param existingWorkspaceResourceGroup = ''

// --- Device authentication (JWT) --------------------------------------------
// Leave jwtEnforce = false to ship the function before devices send JWTs.
// Flip to true once scripts/remediate.ps1 is sending Authorization: Bearer.
param jwtEnforce = false
// Optional: the JWT audience is auto-bound to the Function App's own hostname.
// Override only for a custom domain, e.g.
//   'https://logs.contoso.com'
param jwtExpectedAudience = ''
// Optional: pin to a single Entra tenant id.
param jwtAllowedTenantId = ''
// true  = validate the cert against the Entra device record (needs Graph Device.Read.All).
// false = validate signature + MS-Organization-Access issuer only (no Graph permission).
param jwtRequireEntraDevice = true
