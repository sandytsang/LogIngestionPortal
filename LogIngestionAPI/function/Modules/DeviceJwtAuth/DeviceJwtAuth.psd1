# DeviceJwtAuth.psd1 - module manifest for the device-JWT authentication module.
#
# Author : Sandy Zeng
#
# Version history:
#   1.0.0 (2026-06-19) Initial documented release; ModuleVersion 1.0.0.
@{
    RootModule        = 'DeviceJwtAuth.psm1'
    ModuleVersion     = '1.0.0'
    GUID              = 'b8e0c2a4-9f3d-4f7a-8c21-2a1d6f4e9b70'
    Author            = 'Sandy Zeng'
    Description       = 'Device-bound JWT request authentication for the Log Ingestion Function (MS-Organization-Access certificate proof-of-possession).'
    PowerShellVersion = '7.4'
    FunctionsToExport = @('Test-DeviceRequestJwt', 'Get-GraphToken', 'Get-EntraDevice', 'Get-DeviceCertPublicKey', 'Test-DeviceJwt')
    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
}
