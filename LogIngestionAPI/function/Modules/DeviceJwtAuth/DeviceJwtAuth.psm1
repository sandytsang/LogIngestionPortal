# DeviceJwtAuth.psm1
#
# Device-bound request authentication for the Log Ingestion Function.
#
# A device proves possession of its Entra-join (MS-Organization-Access) certificate
# by signing a short-lived RS256 JWT. The server:
#   1. Parses the JWT header (x5c client cert) and payload (tid/did/nonce/iat/exp).
#   2. Optionally pins the tenant (JWT_ALLOWED_TENANT_ID).
#   3. Optionally resolves the Entra device via Graph and validates the supplied
#      cert against the device's alternativeSecurityIds (JWT_REQUIRE_ENTRA_DEVICE).
#   4. Verifies the RS256 signature, audience, and iat/exp freshness.
#
# This mirrors the AutopilotCredentialPortal JWT method. It is schema-agnostic and
# is only consulted by run.ps1 when JWT_ENFORCE=true, so the function ships safely
# before any device certificates / Cloud PKI exist.
#
# NOTE: When JWT_REQUIRE_ENTRA_DEVICE is true (the default) the Function App's
# managed identity needs the Microsoft Graph application permission
# Device.Read.All. See README.md for the grant command.

# Module-scoped Graph token cache (keyed by resource URI).
$script:_tokenCache = @{}

function Write-JwtLog {
    [CmdletBinding()]
    param([string]$Level, [string]$Message, [hashtable]$Context = @{})
    $parts = @("[$Level]", "DeviceJwtAuth", $Message)
    foreach ($k in $Context.Keys) {
        $v = $Context[$k]
        if ($null -eq $v -or $v -eq '') { continue }
        $parts += ('{0}={1}' -f $k, $v)
    }
    Write-Host ($parts -join ' ')
}

function ConvertFrom-Base64Url {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Value)
    $s = $Value.Replace('-', '+').Replace('_', '/')
    switch ($s.Length % 4) { 2 { $s += '==' } 3 { $s += '=' } }
    return [Convert]::FromBase64String($s)
}

function Get-GraphToken {
    [CmdletBinding()]
    param([string]$Resource = 'https://graph.microsoft.com')

    if ($script:_tokenCache.ContainsKey($Resource)) {
        $cached = $script:_tokenCache[$Resource]
        if ([DateTime]::UtcNow -lt $cached.ExpiresOn) { return $cached.Token }
    }

    $token = $null; $expiresOn = $null
    if ($env:IDENTITY_ENDPOINT -and $env:IDENTITY_HEADER) {
        $uri = "$($env:IDENTITY_ENDPOINT)?resource=$([uri]::EscapeDataString($Resource))&api-version=2019-08-01"
        $resp = Invoke-RestMethod -Method GET -Uri $uri -Headers @{ 'X-IDENTITY-HEADER' = $env:IDENTITY_HEADER }
        $token = $resp.access_token
        if ($resp.expires_on) { $expiresOn = [DateTimeOffset]::FromUnixTimeSeconds([long]$resp.expires_on).UtcDateTime }
    }
    elseif ($env:MSI_ENDPOINT -and $env:MSI_SECRET) {
        $uri = "$($env:MSI_ENDPOINT)?resource=$([uri]::EscapeDataString($Resource))&api-version=2017-09-01"
        $resp = Invoke-RestMethod -Method GET -Uri $uri -Headers @{ Secret = $env:MSI_SECRET }
        $token = $resp.access_token
        if ($resp.expires_on) { $expiresOn = [DateTimeOffset]::FromUnixTimeSeconds([long]$resp.expires_on).UtcDateTime }
    }
    else {
        throw 'No managed identity endpoint available (IDENTITY_ENDPOINT / MSI_ENDPOINT not set).'
    }

    if ($token) {
        if (-not $expiresOn) { $expiresOn = [DateTime]::UtcNow.AddMinutes(55) }
        $script:_tokenCache[$Resource] = @{ Token = $token; ExpiresOn = $expiresOn.AddMinutes(-5) }
    }
    return $token
}

function Invoke-GraphRequest {
    [CmdletBinding()]
    param(
        [string]$Method = 'GET',
        [Parameter(Mandatory)][string]$Uri,
        [string]$ApiVersion = 'v1.0'
    )
    $tokenValue = Get-GraphToken
    if ($Uri -notmatch '^https?://') { $Uri = "https://graph.microsoft.com/$ApiVersion$Uri" }
    $headers = @{ Authorization = "Bearer $tokenValue"; 'Content-Type' = 'application/json' }

    $maxAttempts = 4
    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            return Invoke-RestMethod -Method $Method -Uri $Uri -Headers $headers -TimeoutSec 60
        }
        catch {
            $status = $null
            try { $status = $_.Exception.Response.StatusCode.value__ } catch { }
            if ($status -eq 404) { throw }
            $transient = $status -in 429, 500, 502, 503, 504
            if (-not $transient -or $attempt -ge $maxAttempts) { throw }
            Start-Sleep -Seconds ([Math]::Min(20, [Math]::Pow(2, $attempt)))
        }
    }
}

function Get-EntraDevice {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$DeviceId)
    $select = 'id,deviceId,displayName,accountEnabled,trustType,operatingSystem,alternativeSecurityIds'
    $uri = "/devices(deviceId='$DeviceId')?`$select=$select"
    try {
        return Invoke-GraphRequest -Method GET -Uri $uri
    }
    catch {
        $status = $null
        try { $status = $_.Exception.Response.StatusCode.value__ } catch { }
        if ($status -eq 404) { return $null }
        throw
    }
}

function Get-DeviceCertPublicKey {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Device,
        [Parameter(Mandatory)] [System.Security.Cryptography.X509Certificates.X509Certificate2] $Certificate
    )
    if (-not $Device.alternativeSecurityIds) { return $null }

    $thumbHex = $Certificate.Thumbprint.ToUpperInvariant()
    $pubKeyBytes = $Certificate.GetPublicKey()
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { $pubHashB64 = [Convert]::ToBase64String($sha256.ComputeHash($pubKeyBytes)) }
    finally { $sha256.Dispose() }

    foreach ($entry in $Device.alternativeSecurityIds) {
        if (-not $entry.key) { continue }
        $decoded = $null
        try {
            $raw = [Convert]::FromBase64String([string]$entry.key)
            $decoded = [System.Text.Encoding]::Unicode.GetString($raw)
        }
        catch { continue }
        if (-not $decoded) { continue }
        if ($decoded.Contains($thumbHex) -and $decoded.Contains($pubHashB64)) {
            return [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($Certificate)
        }
    }
    return $null
}

function Test-DeviceJwt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Jwt,
        [Parameter(Mandatory)][System.Security.Cryptography.RSA]$PublicKey,
        [string]$ExpectedAudience,
        [int]$MaxClockSkewSeconds = 300
    )
    $fail = { param($r) [pscustomobject]@{ Valid = $false; Claims = $null; Reason = $r } }
    $parts = $Jwt.Split('.')
    if ($parts.Count -ne 3) { return (& $fail 'Malformed JWT (expected 3 segments)') }

    try {
        $payloadJson = [Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $parts[1]))
        $signature = ConvertFrom-Base64Url $parts[2]
        $header = ([Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $parts[0]))) | ConvertFrom-Json
        $payload = $payloadJson | ConvertFrom-Json
    }
    catch { return (& $fail "Failed to decode JWT segments: $($_.Exception.Message)") }

    if ($header.alg -ne 'RS256') { return (& $fail "Unsupported alg '$($header.alg)'") }
    foreach ($c in 'tid', 'did', 'nonce', 'iat', 'exp') {
        if (-not ($payload.PSObject.Properties.Name -contains $c)) { return (& $fail "Missing required claim '$c'") }
    }

    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([int64]$payload.iat - $now -gt $MaxClockSkewSeconds) { return (& $fail 'iat is in the future') }
    if ($now - [int64]$payload.iat -gt $MaxClockSkewSeconds) { return (& $fail 'iat is too old') }
    if ($now -gt [int64]$payload.exp + $MaxClockSkewSeconds) { return (& $fail 'Token expired') }
    if ($ExpectedAudience -and $payload.aud -ne $ExpectedAudience) { return (& $fail "Audience mismatch (got '$($payload.aud)')") }

    $signingBytes = [Text.Encoding]::ASCII.GetBytes("$($parts[0]).$($parts[1])")
    $ok = $PublicKey.VerifyData($signingBytes, $signature,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256,
        [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    if (-not $ok) { return (& $fail 'Signature verification failed') }

    [pscustomobject]@{ Valid = $true; Claims = $payload; Reason = $null }
}

function Test-DeviceRequestJwt {
<#
.SYNOPSIS
    Authenticate an incoming request using its Authorization: Bearer <device-jwt> header.

.DESCRIPTION
    Orchestrates the full device-JWT check, reading configuration from app settings:
      JWT_EXPECTED_AUDIENCE      - optional; aud claim must equal this (e.g. https://<func>.azurewebsites.net)
      JWT_ALLOWED_TENANT_ID      - optional; tid claim must equal this
      JWT_REQUIRE_ENTRA_DEVICE   - 'true' (default) resolves the device in Entra and validates the
                                   cert against alternativeSecurityIds (needs Graph Device.Read.All).
                                   'false' validates signature + issuer + thumbprint only (no Graph).

.OUTPUTS
    PSCustomObject: Valid, Reason, Claims, Device.
#>
    [CmdletBinding()]
    param([string]$AuthorizationHeader)

    $result = { param($valid, $reason, $claims, $device)
        [pscustomobject]@{ Valid = $valid; Reason = $reason; Claims = $claims; Device = $device } }

    $expectedAudience = $env:JWT_EXPECTED_AUDIENCE
    $allowedTenantId = $env:JWT_ALLOWED_TENANT_ID
    $requireEntraDevice = ($env:JWT_REQUIRE_ENTRA_DEVICE -ne 'false')   # default true

    if (-not $AuthorizationHeader -or $AuthorizationHeader -notmatch '^Bearer\s+(.+)$') {
        return (& $result $false 'Missing or malformed Authorization header' $null $null)
    }
    $jwt = $Matches[1]
    $parts = $jwt.Split('.')
    if ($parts.Count -ne 3) { return (& $result $false 'Malformed JWT' $null $null) }

    # --- Peek at header + payload before verifying the signature -------------
    try {
        $peekHeader = ([Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $parts[0]))) | ConvertFrom-Json
        $peek = ([Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $parts[1]))) | ConvertFrom-Json
    }
    catch { return (& $result $false 'Cannot decode JWT' $null $null) }

    if (-not $peek.tid -or -not $peek.did -or -not $peek.nonce) {
        return (& $result $false 'JWT missing required claims' $null $null)
    }
    if ($allowedTenantId -and $peek.tid -ne $allowedTenantId) {
        return (& $result $false 'Tenant not allowed' $null $null)
    }
    if (-not $peekHeader -or -not $peekHeader.x5c) {
        return (& $result $false 'JWT header missing x5c (client cert)' $null $null)
    }

    # --- Parse the client certificate from x5c ------------------------------
    $clientCert = $null
    try {
        $certBytes = [Convert]::FromBase64String([string]$peekHeader.x5c)
        $clientCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certBytes)
    }
    catch { return (& $result $false "Could not parse x5c cert: $($_.Exception.Message)" $null $null) }

    # Integrity: x5t (if present) must match SHA-1(cert.RawData).
    if ($peekHeader.x5t) {
        try {
            $x5tBytes = ConvertFrom-Base64Url ([string]$peekHeader.x5t)
            $x5tHex = ([BitConverter]::ToString($x5tBytes)).Replace('-', '').ToUpperInvariant()
            if ($clientCert.Thumbprint -ne $x5tHex) {
                return (& $result $false 'x5t / cert thumbprint mismatch' $null $null)
            }
        }
        catch { return (& $result $false 'Invalid x5t' $null $null) }
    }

    # --- Establish the RSA public key used to verify the signature ----------
    $rsa = $null
    $device = $null
    if ($requireEntraDevice) {
        try { $device = Get-EntraDevice -DeviceId $peek.did }
        catch {
            Write-JwtLog 'ERROR' "Graph device lookup failed: $($_.Exception.Message)" @{ tid = $peek.tid; did = $peek.did }
            return (& $result $false 'Directory lookup failed' $null $null)
        }
        if (-not $device) { return (& $result $false 'Unknown device' $null $null) }
        if (-not $device.accountEnabled) { return (& $result $false 'Device is disabled' $null $device) }
        $rsa = Get-DeviceCertPublicKey -Device $device -Certificate $clientCert
        if (-not $rsa) { return (& $result $false 'Client cert not trusted by Entra device record' $null $device) }
    }
    else {
        # No Graph: require the cert to be an Entra device-registration cert and
        # trust its embedded public key (proof-of-possession via the signature).
        if ($clientCert.Issuer -notlike '*MS-Organization-Access*') {
            return (& $result $false 'Client cert is not an MS-Organization-Access (Entra device) certificate' $null $null)
        }
        $rsa = [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($clientCert)
        if (-not $rsa) { return (& $result $false 'Could not read public key from client cert' $null $null) }
    }

    # --- Verify signature + freshness + audience ----------------------------
    $check = Test-DeviceJwt -Jwt $jwt -PublicKey $rsa -ExpectedAudience $expectedAudience
    if (-not $check.Valid) { return (& $result $false ("JWT validation failed: " + $check.Reason) $null $device) }
    $claims = $check.Claims

    # Defense in depth: claim must match the resolved device.
    if ($device -and $claims.did -ne $device.deviceId) {
        return (& $result $false 'Claim/device mismatch' $null $device)
    }

    return (& $result $true $null $claims $device)
}

Export-ModuleMember -Function Test-DeviceRequestJwt, Get-GraphToken, Get-EntraDevice, Get-DeviceCertPublicKey, Test-DeviceJwt
