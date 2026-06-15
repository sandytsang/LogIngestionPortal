import type { Catalog } from '../types';

// ---------------------------------------------------------------------------
// Curated catalog of Windows device data points.
//
// Each field bundles its Log Analytics column definition AND the PowerShell
// collector expression. Shared setup snippets (CIM queries, registry lookups)
// are defined once in `setups` and emitted at most once per generated script.
//
// The fields whose `default` is true reproduce the original
// LogIngestionAPI/schema/columns.json exactly (same order, names, types and
// descriptions) so importing an existing deployment round-trips cleanly.
// ---------------------------------------------------------------------------

const setups: Record<string, string> = {
  cs: `    $cs = Get-CimInstance -ClassName Win32_ComputerSystem`,
  os: `    $os = Get-CimInstance -ClassName Win32_OperatingSystem`,
  bios: `    $bios = Invoke-Safe 'BIOS' { Get-CimInstance -ClassName Win32_BIOS }`,
  mp: `    $mp = Invoke-Safe 'Defender' { Get-MpComputerStatus }`,
  tpm: `    $tpm = Invoke-Safe 'TPM' { Get-Tpm }`,
  secureBoot: `    $secureBoot = Invoke-Safe 'SecureBoot' { Confirm-SecureBootUEFI }`,
  net: `    $net = Invoke-Safe 'Network' { Get-NetIPConfiguration | Where-Object { $_.IPv4Address } | Select-Object -First 1 }`,
  disk: `    $sysDrive = Invoke-Safe 'Disk' { Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$env:SystemDrive'" }`,
  deviceId: `    $deviceId = ''
    try {
        $enrollKey = Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Enrollments' -ErrorAction SilentlyContinue |
            Where-Object { $_.GetValue('ProviderID') -eq 'MS DM Server' } | Select-Object -First 1
        if ($enrollKey) { $deviceId = $enrollKey.PSChildName }
    }
    catch { }`,
  bitLocker: `    $bitLocker = Invoke-Safe 'BitLocker' {
        Get-BitLockerVolume | ForEach-Object {
            [pscustomobject]@{
                Mount      = $_.MountPoint
                Protection = "$($_.ProtectionStatus)"
                Volume     = "$($_.VolumeStatus)"
                Percent    = $_.EncryptionPercentage
            }
        }
    }`,
};

const setupOrder = [
  'cs',
  'os',
  'bios',
  'deviceId',
  'disk',
  'net',
  'tpm',
  'secureBoot',
  'mp',
  'bitLocker',
];

export const catalog: Catalog = {
  tableName: 'DeviceRemediation_CL',
  description:
    'Custom telemetry collected by Intune Proactive Remediation scripts and ingested via the Logs Ingestion API.',
  setups,
  setupOrder,
  fields: [
    // --- Required -------------------------------------------------------
    {
      id: 'TimeGenerated',
      category: 'Required',
      label: 'Time generated',
      default: true,
      locked: true,
      setups: [],
      expression: `(Get-Date).ToUniversalTime().ToString('o')`,
      column: {
        name: 'TimeGenerated',
        type: 'datetime',
        description:
          'Event timestamp (UTC). REQUIRED by Log Analytics. Set by the device script.',
      },
    },
    // --- Identity -------------------------------------------------------
    {
      id: 'DeviceName',
      category: 'Identity',
      label: 'Device name',
      default: true,
      setups: [],
      expression: `$env:COMPUTERNAME`,
      column: { name: 'DeviceName', type: 'string', description: 'Hostname of the reporting device.' },
    },
    {
      id: 'DeviceId',
      category: 'Identity',
      label: 'Intune/Entra device id',
      default: true,
      setups: ['deviceId'],
      expression: `$deviceId`,
      column: { name: 'DeviceId', type: 'string', description: 'Intune/Entra device identifier.' },
    },
    {
      id: 'UserName',
      category: 'Identity',
      label: 'Logged-on user',
      default: true,
      setups: ['cs'],
      expression: `$cs.UserName`,
      column: {
        name: 'UserName',
        type: 'string',
        description: 'Currently logged-on user (UPN or sAMAccountName).',
      },
    },
    // --- Inventory metadata ---------------------------------------------
    {
      id: 'OSVersion',
      category: 'Operating system',
      label: 'OS version',
      default: true,
      setups: ['os'],
      expression: `"$($os.Caption) $($os.Version)"`,
      column: { name: 'OSVersion', type: 'string', description: 'Operating system build/version string.' },
    },
    {
      id: 'RemediationName',
      category: 'Inventory metadata',
      label: 'Remediation/package name',
      default: true,
      setups: [],
      expression: `$RemediationName`,
      column: {
        name: 'RemediationName',
        type: 'string',
        description: 'Name of the remediation package that produced this record.',
      },
    },
    {
      id: 'Status',
      category: 'Inventory metadata',
      label: 'Status',
      default: true,
      setups: [],
      expression: `'Remediated'`,
      column: {
        name: 'Status',
        type: 'string',
        description: 'Result status reported by the script (e.g. Compliant, Remediated, Failed).',
      },
    },
    {
      id: 'Details',
      category: 'Inventory metadata',
      label: 'Details',
      default: true,
      setups: ['cs'],
      expression: `"Manufacturer=$($cs.Manufacturer); Model=$($cs.Model)"`,
      column: {
        name: 'Details',
        type: 'string',
        description: 'Free-form details or JSON payload describing what was collected/changed.',
      },
    },
    // --- Hardware -------------------------------------------------------
    {
      id: 'Manufacturer',
      category: 'Hardware',
      label: 'Manufacturer',
      default: true,
      setups: ['cs'],
      expression: `$cs.Manufacturer`,
      column: {
        name: 'Manufacturer',
        type: 'string',
        description: 'System manufacturer (Win32_ComputerSystem.Manufacturer).',
      },
    },
    {
      id: 'Model',
      category: 'Hardware',
      label: 'Model',
      default: true,
      setups: ['cs'],
      expression: `$cs.Model`,
      column: { name: 'Model', type: 'string', description: 'System model (Win32_ComputerSystem.Model).' },
    },
    {
      id: 'SerialNumber',
      category: 'Hardware',
      label: 'Serial number',
      default: true,
      setups: ['bios'],
      expression: `$bios.SerialNumber`,
      column: {
        name: 'SerialNumber',
        type: 'string',
        description: 'BIOS/asset serial number (Win32_BIOS.SerialNumber).',
      },
    },
    {
      id: 'TotalMemoryGB',
      category: 'Hardware',
      label: 'Total memory (GB)',
      default: true,
      setups: ['cs'],
      expression: `if ($cs.TotalPhysicalMemory) { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } else { $null }`,
      column: { name: 'TotalMemoryGB', type: 'real', description: 'Installed physical memory in GB.' },
    },
    // --- Security -------------------------------------------------------
    {
      id: 'BitLockerStatus',
      category: 'Security',
      label: 'BitLocker status',
      default: true,
      needsSystem: true,
      setups: ['bitLocker'],
      expression: `$bitLocker`,
      column: {
        name: 'BitLockerStatus',
        type: 'dynamic',
        description:
          'Per-volume BitLocker protection/encryption status (array of objects from Get-BitLockerVolume).',
      },
    },
    {
      id: 'DefenderRealtimeEnabled',
      category: 'Security',
      label: 'Defender real-time enabled',
      default: true,
      setups: ['mp'],
      expression: `if ($mp) { [bool]$mp.RealTimeProtectionEnabled } else { $null }`,
      column: {
        name: 'DefenderRealtimeEnabled',
        type: 'boolean',
        description:
          'Microsoft Defender real-time protection enabled (Get-MpComputerStatus.RealTimeProtectionEnabled).',
      },
    },
    {
      id: 'DefenderSignatureVersion',
      category: 'Security',
      label: 'Defender signature version',
      default: true,
      setups: ['mp'],
      expression: `if ($mp) { $mp.AntivirusSignatureVersion } else { $null }`,
      column: {
        name: 'DefenderSignatureVersion',
        type: 'string',
        description:
          'Microsoft Defender antivirus signature version (Get-MpComputerStatus.AntivirusSignatureVersion).',
      },
    },
    // --- Extras (off by default) ---------------------------------------
    {
      id: 'OSBuildNumber',
      category: 'Operating system',
      label: 'OS build number',
      default: false,
      setups: ['os'],
      expression: `"$($os.BuildNumber)"`,
      column: {
        name: 'OSBuildNumber',
        type: 'string',
        description: 'Operating system build number (Win32_OperatingSystem.BuildNumber).',
      },
    },
    {
      id: 'OSArchitecture',
      category: 'Operating system',
      label: 'OS architecture',
      default: false,
      setups: ['os'],
      expression: `$os.OSArchitecture`,
      column: {
        name: 'OSArchitecture',
        type: 'string',
        description: 'Operating system architecture (e.g. 64-bit).',
      },
    },
    {
      id: 'LastBootTime',
      category: 'Operating system',
      label: 'Last boot time',
      default: false,
      setups: ['os'],
      expression: `if ($os.LastBootUpTime) { $os.LastBootUpTime.ToUniversalTime().ToString('o') } else { $null }`,
      column: { name: 'LastBootTime', type: 'datetime', description: 'Last system boot time (UTC).' },
    },
    {
      id: 'Domain',
      category: 'Operating system',
      label: 'Domain / workgroup',
      default: false,
      setups: ['cs'],
      expression: `$cs.Domain`,
      column: { name: 'Domain', type: 'string', description: 'AD domain or workgroup the device belongs to.' },
    },
    {
      id: 'PartOfDomain',
      category: 'Operating system',
      label: 'Domain joined',
      default: false,
      setups: ['cs'],
      expression: `[bool]$cs.PartOfDomain`,
      column: { name: 'PartOfDomain', type: 'boolean', description: 'Whether the device is joined to an AD domain.' },
    },
    {
      id: 'BiosVersion',
      category: 'Hardware',
      label: 'BIOS version',
      default: false,
      setups: ['bios'],
      expression: `$bios.SMBIOSBIOSVersion`,
      column: {
        name: 'BiosVersion',
        type: 'string',
        description: 'BIOS firmware version (Win32_BIOS.SMBIOSBIOSVersion).',
      },
    },
    {
      id: 'SystemDriveFreeGB',
      category: 'Storage',
      label: 'System drive free (GB)',
      default: false,
      setups: ['disk'],
      expression: `if ($sysDrive) { [math]::Round($sysDrive.FreeSpace / 1GB, 1) } else { $null }`,
      column: { name: 'SystemDriveFreeGB', type: 'real', description: 'Free space on the system drive in GB.' },
    },
    {
      id: 'SystemDriveSizeGB',
      category: 'Storage',
      label: 'System drive size (GB)',
      default: false,
      setups: ['disk'],
      expression: `if ($sysDrive) { [math]::Round($sysDrive.Size / 1GB, 1) } else { $null }`,
      column: { name: 'SystemDriveSizeGB', type: 'real', description: 'Total size of the system drive in GB.' },
    },
    {
      id: 'IPv4Address',
      category: 'Network',
      label: 'Primary IPv4 address',
      default: false,
      setups: ['net'],
      expression: `if ($net) { $net.IPv4Address.IPAddress } else { $null }`,
      column: { name: 'IPv4Address', type: 'string', description: 'Primary IPv4 address of the device.' },
    },
    {
      id: 'TpmPresent',
      category: 'Security',
      label: 'TPM present',
      default: false,
      needsSystem: true,
      setups: ['tpm'],
      expression: `[bool]$tpm.TpmPresent`,
      column: { name: 'TpmPresent', type: 'boolean', description: 'Whether a TPM is present on the device.' },
    },
    {
      id: 'TpmReady',
      category: 'Security',
      label: 'TPM ready',
      default: false,
      needsSystem: true,
      setups: ['tpm'],
      expression: `[bool]$tpm.TpmReady`,
      column: { name: 'TpmReady', type: 'boolean', description: 'Whether the TPM is ready for use.' },
    },
    {
      id: 'SecureBootEnabled',
      category: 'Security',
      label: 'Secure Boot enabled',
      default: false,
      needsSystem: true,
      setups: ['secureBoot'],
      expression: `[bool]$secureBoot`,
      column: { name: 'SecureBootEnabled', type: 'boolean', description: 'Whether UEFI Secure Boot is enabled.' },
    },
    {
      id: 'DefenderAntivirusEnabled',
      category: 'Security',
      label: 'Defender antivirus enabled',
      default: false,
      setups: ['mp'],
      expression: `if ($mp) { [bool]$mp.AntivirusEnabled } else { $null }`,
      column: {
        name: 'DefenderAntivirusEnabled',
        type: 'boolean',
        description: 'Microsoft Defender antivirus enabled (Get-MpComputerStatus.AntivirusEnabled).',
      },
    },
  ],
};
