# DeviceJwtAuth.psm1
#
# Author : Sandy Zeng
#
# Version history:
#   1.0.0 (2026-06-19) Initial documented release; added author and version
#                      history header. Removed dead type-check branch in
#                      Get-X5cCertificates.
#   1.0.1 (2026-06-19) Added best-effort in-memory nonce replay protection for
#                      short-lived JWTs.
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
# is consulted by run.ps1 on every request, which always requires a valid
# device-signed JWT.
#
# NOTE: When JWT_REQUIRE_ENTRA_DEVICE is true (the default) the Function App's
# managed identity needs the Microsoft Graph application permission
# Device.Read.All. See README.md for the grant command.

# Module-scoped Graph token cache (keyed by resource URI).
$script:_tokenCache = @{}
# Module-scoped nonce replay cache (keyed by tid|did|nonce, value = UTC expiry).
$script:_nonceCache = @{}

# Best-effort replay guard for JWT nonces. Keeps a short in-memory cache per
# worker process and rejects duplicate tid+did+nonce tuples until expiry.
function Test-AndRememberJwtNonce {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$TenantId,
        [Parameter(Mandatory)][string]$DeviceId,
        [Parameter(Mandatory)][string]$Nonce,
        [int]$TtlSeconds = 600
    )

    $now = [DateTime]::UtcNow
    foreach ($k in @($script:_nonceCache.Keys)) {
        if ($script:_nonceCache[$k] -le $now) { $script:_nonceCache.Remove($k) }
    }

    $key = "$TenantId|$DeviceId|$Nonce"
    if ($script:_nonceCache.ContainsKey($key)) {
        return $false
    }

    $script:_nonceCache[$key] = $now.AddSeconds([Math]::Max(60, $TtlSeconds))
    return $true
}

# Writes a single structured log line to stdout (captured by Functions/App
# Insights). Renders as: [Level] DeviceJwtAuth <message> key=value ... and skips
# any context entries whose value is null/empty.
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

# Decodes a base64url string (JWT segments use '-'/'_' instead of '+'/'/' and
# omit '=' padding) into raw bytes, restoring the standard alphabet and padding
# first.
function ConvertFrom-Base64Url {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Value)
    $s = $Value.Replace('-', '+').Replace('_', '/')
    switch ($s.Length % 4) { 2 { $s += '==' } 3 { $s += '=' } }
    return [Convert]::FromBase64String($s)
}

# Parses a comma-separated thumbprint allow-list (from an app setting) into a
# normalized array: trimmed, with spaces/hyphens stripped and upper-cased so it
# can be compared directly against X509Certificate2.Thumbprint.
function Get-NormalizedThumbprints {
    [CmdletBinding()]
    param([string]$Csv)
    if (-not $Csv) { return @() }
    return @(
        $Csv.Split(',') |
        ForEach-Object { $_.Trim().Replace(' ', '').Replace('-', '').ToUpperInvariant() } |
        Where-Object { $_ }
    )
}

# Turns the JWT header 'x5c' value (a single base64 cert or an array of them)
# into X509Certificate2 objects. The leaf (client) cert is first; any remaining
# entries are chain/intermediate certs. Throws if nothing could be parsed.
function Get-X5cCertificates {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$X5cValue)

    $entries = @($X5cValue)

    $certificates = New-Object System.Collections.Generic.List[System.Security.Cryptography.X509Certificates.X509Certificate2]
    foreach ($entry in $entries) {
        if (-not $entry) { continue }
        try {
            $certBytes = [Convert]::FromBase64String([string]$entry)
            $certificates.Add([System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certBytes))
        }
        catch {
            throw "Could not parse x5c cert: $($_.Exception.Message)"
        }
    }

    if ($certificates.Count -eq 0) {
        throw 'JWT header x5c did not contain any certificates.'
    }

    return @($certificates)
}

# Builds and validates the X.509 trust chain for the client certificate.
# Optionally pins acceptable root/intermediate thumbprints and toggles online
# revocation (CRL/OCSP) checks. When no roots are pinned, an unknown/partial
# chain is tolerated (self-issued Entra device certs); returns an object with
# Valid plus a Reason describing the first blocking failure.
function Test-CertificateChainTrust {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [System.Security.Cryptography.X509Certificates.X509Certificate2[]]$AdditionalCertificates = @(),
        [string[]]$TrustedRootThumbprints = @(),
        [string[]]$TrustedIntermediateThumbprints = @(),
        [switch]$CheckRevocation
    )

    # An X509Chain walks upward from the leaf (client) cert through any
    # intermediates to a root, checking signatures, validity dates and
    # (optionally) revocation at each link. We configure its policy first, then
    # call Build().
    $chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $policy = $chain.ChainPolicy
        # Revocation (CRL/OCSP) is a network call, so it is OFF by default. When
        # enabled we still ExcludeRoot, because a trusted root never publishes a
        # CRL about itself.
        $policy.RevocationMode = if ($CheckRevocation) {
            [System.Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        }
        else {
            [System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
        }
        $policy.RevocationFlag = [System.Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
        # If the caller pinned specific root thumbprints we want the strictest
        # build (NoFlag) and we enforce the pin ourselves below. If no roots are
        # pinned, Entra device certs chain to a root the machine doesn't trust,
        # so we tell the chain engine to tolerate an unknown CA here and rely on
        # the signature + Entra checks elsewhere for trust.
        $policy.VerificationFlags = if ($TrustedRootThumbprints.Count -gt 0) {
            [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
        }
        else {
            [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::AllowUnknownCertificateAuthority
        }
        $policy.VerificationTime = [DateTime]::UtcNow
        $policy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(15)
        # The intermediates/root the client sent in the JWT 'x5c' aren't in any
        # local store, so add them to the ExtraStore. The chain engine pulls
        # missing links from here when building the path.
        foreach ($extraCert in $AdditionalCertificates) {
            if ($null -ne $extraCert) {
                [void]$policy.ExtraStore.Add($extraCert)
            }
        }

        # Build() returns $false if ANY status flag is set. A return of $false is
        # therefore not automatically fatal: when we aren't pinning roots we
        # expect UntrustedRoot/PartialChain and treat only OTHER problems
        # (expired, bad signature, revoked, ...) as real failures.
        $ok = $chain.Build($Certificate)
        if (-not $ok) {
            $allowedStatuses = @{}
            if ($TrustedRootThumbprints.Count -eq 0) {
                $allowedStatuses[[System.Security.Cryptography.X509Certificates.X509ChainStatusFlags]::UntrustedRoot] = $true
                $allowedStatuses[[System.Security.Cryptography.X509Certificates.X509ChainStatusFlags]::PartialChain] = $true
            }

            # Keep only the status flags that are NOT in our allow-list. If none
            # remain, the chain is acceptable for our purposes.
            $blockingStatuses = @(
                $chain.ChainStatus |
                Where-Object {
                    $_.Status -ne [System.Security.Cryptography.X509Certificates.X509ChainStatusFlags]::NoError -and
                    -not $allowedStatuses.ContainsKey($_.Status)
                }
            )
            if ($blockingStatuses.Count -eq 0) {
                $ok = $true
            }
        }

        # Still failing -> surface every status message the chain reported so the
        # caller (and logs) can see exactly why.
        if (-not $ok) {
            $details = @(
                $chain.ChainStatus |
                ForEach-Object { $_.StatusInformation.Trim() } |
                Where-Object { $_ }
            ) -join '; '
            if (-not $details) { $details = 'chain build failed' }
            return [pscustomobject]@{ Valid = $false; Reason = $details }
        }

        # ChainElements are ordered leaf-first, root-last. The last element is
        # therefore the root we resolved to.
        $certs = @($chain.ChainElements | ForEach-Object { $_.Certificate })
        if ($certs.Count -eq 0) {
            return [pscustomobject]@{ Valid = $false; Reason = 'empty certificate chain' }
        }

        # Root pinning: when an allow-list is configured, the resolved root's
        # thumbprint must be on it. This is what actually establishes trust when
        # AllowUnknownCertificateAuthority was used above.
        $rootThumb = $certs[-1].Thumbprint.ToUpperInvariant()
        if ($TrustedRootThumbprints.Count -gt 0 -and ($TrustedRootThumbprints -notcontains $rootThumb)) {
            return [pscustomobject]@{ Valid = $false; Reason = "untrusted root '$rootThumb'" }
        }

        # Intermediate pinning: at least one of the chain's intermediate certs
        # (everything between the leaf at [0] and the root at [-1]) must match the
        # configured allow-list. Guards against a valid-but-unexpected issuing CA.
        if ($TrustedIntermediateThumbprints.Count -gt 0) {
            $intermediateThumbs = @()
            if ($certs.Count -gt 2) {
                $intermediateThumbs = @(
                    $certs[1..($certs.Count - 2)] |
                    ForEach-Object { $_.Thumbprint.ToUpperInvariant() }
                )
            }
            $hasAllowedIntermediate = @(
                $intermediateThumbs |
                Where-Object { $TrustedIntermediateThumbprints -contains $_ }
            ).Count -gt 0
            if (-not $hasAllowedIntermediate) {
                return [pscustomobject]@{ Valid = $false; Reason = 'none of the configured intermediate certificates were present in the chain' }
            }
        }

        return [pscustomobject]@{ Valid = $true; Reason = $null }
    }
    finally {
        $chain.Dispose()
    }
}

# Acquires an access token for the given resource (default Microsoft Graph) from
# the Function App's managed identity endpoint. Results are cached per-resource
# in $script:_tokenCache until ~5 minutes before expiry. Supports both the
# current (IDENTITY_ENDPOINT) and legacy (MSI_ENDPOINT) identity contracts.
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

# Calls Microsoft Graph with a managed-identity bearer token, prefixing the
# base URL/api-version when a relative path is given. Retries transient failures
# (429/5xx) with exponential backoff; 404 and other 4xx errors are thrown
# immediately.
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

# Resolves an Entra (Azure AD) device object by its deviceId, selecting the
# fields needed for validation (including alternativeSecurityIds). Returns $null
# when the device does not exist (Graph 404); other errors are thrown.
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

# Confirms the presented certificate is registered to the Entra device by
# scanning the device's alternativeSecurityIds for an entry containing both the
# cert thumbprint and the SHA-256 hash of its public key. On a match, returns
# the cert's RSA public key (used to verify the JWT signature); otherwise $null.
function Get-DeviceCertPublicKey {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] $Device,
        [Parameter(Mandatory)] [System.Security.Cryptography.X509Certificates.X509Certificate2] $Certificate
    )
    if (-not $Device.alternativeSecurityIds) { return $null }

    # Compute the two fingerprints Entra stores for a registered cert: the cert
    # thumbprint (SHA-1, hex) and the SHA-256 hash of the public key (base64).
    $thumbHex = $Certificate.Thumbprint.ToUpperInvariant()
    $pubKeyBytes = $Certificate.GetPublicKey()
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { $pubHashB64 = [Convert]::ToBase64String($sha256.ComputeHash($pubKeyBytes)) }
    finally { $sha256.Dispose() }

    # alternativeSecurityIds holds the device's registered key credentials. Each
    # 'key' is base64 of a UTF-16 (Unicode) string that embeds the thumbprint and
    # public-key hash. We require BOTH to appear in the same entry so a cert is
    # only trusted if it exactly matches what Entra recorded for this device.
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
            # Match: this is the device's own cert, so its public key can be
            # trusted to verify the JWT signature.
            return [System.Security.Cryptography.X509Certificates.RSACertificateExtensions]::GetRSAPublicKey($Certificate)
        }
    }
    return $null
}

# Verifies a device JWT against a known RSA public key: checks the 3-segment
# shape, RS256 algorithm, required claims, iat/exp freshness (within the allowed
# clock skew), optional audience, and finally the RS256 signature. Returns an
# object with Valid, the decoded Claims, and a Reason on failure.
function Test-DeviceJwt {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Jwt,
        [Parameter(Mandatory)][System.Security.Cryptography.RSA]$PublicKey,
        [string]$ExpectedAudience,
        [int]$MaxClockSkewSeconds = 300
    )
    $fail = { param($r) [pscustomobject]@{ Valid = $false; Claims = $null; Reason = $r } }
    # A JWS compact token is exactly three base64url segments joined by dots:
    #   header '.' payload '.' signature
    $parts = $Jwt.Split('.')
    if ($parts.Count -ne 3) { return (& $fail 'Malformed JWT (expected 3 segments)') }

    try {
        # Decode each segment. Header and payload are JSON; the signature is raw
        # bytes over ASCII("header.payload").
        $payloadJson = [Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $parts[1]))
        $signature = ConvertFrom-Base64Url $parts[2]
        $header = ([Text.Encoding]::UTF8.GetString((ConvertFrom-Base64Url $parts[0]))) | ConvertFrom-Json
        $payload = $payloadJson | ConvertFrom-Json
    }
    catch { return (& $fail "Failed to decode JWT segments: $($_.Exception.Message)") }

    # Only accept RS256. Pinning the algorithm prevents 'alg' confusion attacks
    # (e.g. a forged token claiming alg=none or a symmetric algorithm).
    if ($header.alg -ne 'RS256') { return (& $fail "Unsupported alg '$($header.alg)'") }
    # Every claim we rely on for identity/replay must be present.
    foreach ($c in 'tid', 'did', 'nonce', 'iat', 'exp') {
        if (-not ($payload.PSObject.Properties.Name -contains $c)) { return (& $fail "Missing required claim '$c'") }
    }

    # Freshness window: reject tokens issued in the future, issued too long ago,
    # or already expired. The skew tolerance absorbs small clock differences
    # between the device and the Function host. This bounds how long a captured
    # token could be replayed.
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([int64]$payload.iat - $now -gt $MaxClockSkewSeconds) { return (& $fail 'iat is in the future') }
    if ($now - [int64]$payload.iat -gt $MaxClockSkewSeconds) { return (& $fail 'iat is too old') }
    if ($now -gt [int64]$payload.exp + $MaxClockSkewSeconds) { return (& $fail 'Token expired') }
    # Optional audience binding: ensures a token minted for this Function can't be
    # replayed against a different endpoint.
    if ($ExpectedAudience -and $payload.aud -ne $ExpectedAudience) { return (& $fail "Audience mismatch (got '$($payload.aud)')") }

    # Cryptographic proof: verify the RS256 signature over the EXACT signing
    # input (the first two segments, unchanged) using the device cert's public
    # key. Success proves the holder of the matching private key produced this
    # token and that header/payload were not tampered with.
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
    JWT_REQUIRE_CERT_CHAIN     - 'true' (default) enforces certificate chain validation
                        before Graph/signature checks. Set 'false' only for troubleshooting.
    JWT_TRUSTED_ROOT_THUMBPRINTS - optional comma-separated allow-list for acceptable root certs.
    JWT_TRUSTED_INTERMEDIATE_THUMBPRINTS - optional comma-separated allow-list for intermediates.
    JWT_CHECK_CERT_REVOCATION  - 'false' (default). Set 'true' to perform online CRL/OCSP checks.
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
    $requireCertChain = ($env:JWT_REQUIRE_CERT_CHAIN -ne 'false')
    $trustedRootThumbprints = Get-NormalizedThumbprints -Csv $env:JWT_TRUSTED_ROOT_THUMBPRINTS
    $trustedIntermediateThumbprints = Get-NormalizedThumbprints -Csv $env:JWT_TRUSTED_INTERMEDIATE_THUMBPRINTS
    $checkCertRevocation = ($env:JWT_CHECK_CERT_REVOCATION -eq 'true')
    $requireEntraDevice = ($env:JWT_REQUIRE_ENTRA_DEVICE -ne 'false')   # default true

    if (-not $AuthorizationHeader -or $AuthorizationHeader -notmatch '^Bearer\s+(.+)$') {
        return (& $result $false 'Missing or malformed Authorization header' $null $null)
    }
    $jwt = $Matches[1]
    $parts = $jwt.Split('.')
    if ($parts.Count -ne 3) { return (& $result $false 'Malformed JWT' $null $null) }

    # --- Peek at header + payload before verifying the signature -------------
    # We decode (NOT trust) the header/payload first so we can read the device id
    # and the certificate the client claims to be using. Nothing here is trusted
    # until the signature is checked at the end with the cert's public key.
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
    # x5c is the cert (and any chain) the device embedded in the JWT header. The
    # first entry is the leaf (client) cert whose private key signed the token.
    $presentedCerts = @()
    $clientCert = $null
    try {
        $presentedCerts = @(Get-X5cCertificates -X5cValue $peekHeader.x5c)
        $clientCert = $presentedCerts[0]
    }
    catch { return (& $result $false "Could not parse x5c cert: $($_.Exception.Message)" $null $null) }

    # Integrity: x5t is the base64url SHA-1 thumbprint of the cert. If present it
    # must match the leaf cert we just parsed, confirming header self-consistency
    # (x5t and x5c describe the same certificate).
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

    # Chain trust (optional): confirm the leaf cert builds a valid chain (dates,
    # signatures, optional root/intermediate pinning and revocation) using the
    # other x5c entries as intermediates. This rejects malformed or expired certs
    # before we do the more expensive Graph lookup and signature check.
    if ($requireCertChain) {
        $chainCheck = Test-CertificateChainTrust `
            -Certificate $clientCert `
            -AdditionalCertificates @($presentedCerts | Select-Object -Skip 1) `
            -TrustedRootThumbprints $trustedRootThumbprints `
            -TrustedIntermediateThumbprints $trustedIntermediateThumbprints `
            -CheckRevocation:$checkCertRevocation
        if (-not $chainCheck.Valid) {
            return (& $result $false ("Certificate chain validation failed: " + $chainCheck.Reason) $null $null)
        }
    }

    # --- Establish the RSA public key used to verify the signature ----------
    # The whole scheme hinges on choosing the RIGHT public key. We never trust a
    # key just because it was in the token; we bind it to a known device.
    $rsa = $null
    $device = $null
    if ($requireEntraDevice) {
        # Strong path: look the device up in Entra, then confirm THIS certificate
        # is registered to it (via alternativeSecurityIds). Only then do we use
        # the cert's public key. This ties the token to a real, enabled device.
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
    # Final gate: the JWT must be signed by the private key matching the public
    # key we just established, and pass all claim/time checks. Possession of that
    # private key (TPM-bound on the device) is the actual proof of identity.
    $check = Test-DeviceJwt -Jwt $jwt -PublicKey $rsa -ExpectedAudience $expectedAudience
    if (-not $check.Valid) { return (& $result $false ("JWT validation failed: " + $check.Reason) $null $device) }
    $claims = $check.Claims

    # Replay protection: nonce must be single-use for the token lifetime (+small
    # skew window). This cache is worker-local (best effort) and complements the
    # short token TTL.
    $nowUnix = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $ttl = [Math]::Min(900, [Math]::Max(60, ([int64]$claims.exp - $nowUnix) + 300))
    if (-not (Test-AndRememberJwtNonce -TenantId $claims.tid -DeviceId $claims.did -Nonce $claims.nonce -TtlSeconds $ttl)) {
        return (& $result $false 'Replay detected (nonce already used)' $null $device)
    }

    # Defense in depth: the signed 'did' claim must match the device we resolved,
    # so a valid token for device A can't be accepted as device B.
    if ($device -and $claims.did -ne $device.deviceId) {
        return (& $result $false 'Claim/device mismatch' $null $device)
    }

    return (& $result $true $null $claims $device)
}

Export-ModuleMember -Function Test-DeviceRequestJwt, Get-GraphToken, Get-EntraDevice, Get-DeviceCertPublicKey, Test-DeviceJwt
