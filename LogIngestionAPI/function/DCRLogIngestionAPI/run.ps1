# =============================================================================
# DCRLogIngestionAPI / run.ps1
# Author : Sandy Zeng
#
# Version history:
#   1.0.0 (2026-06-19) Initial documented release; added author and version
#                      history header.
#   1.1.0 (2026-06-19) Hardened auth failure responses to return a generic 401
#                      body (no reason leakage) while preserving structured
#                      diagnostics in server-side logs.
# =============================================================================

using namespace System.Net

# Generic Logs Ingestion forwarder (multi-table).
#
# Accepts a JSON body that is either:
#   - a table-keyed object  { "Table1_CL": [ {...} ], "Table2_CL": [ {...} ] }
#   - a bare array / single object (routed to the first configured table)
# obtains a token from the Function's managed identity, and POSTs each table's
# records to its DCR stream (Custom-<tableName>) on the direct logsIngestion
# endpoint. The function is schema-agnostic: each DCR stream's transformKql
# decides which columns land in its table, so adding/removing a column (or a
# whole table) in schema/columns.json never requires changing this code.

param($Request, $TriggerMetadata)

# Writes the HTTP response back to the Functions host: sets the status code,
# JSON content type, and serializes the body (deep enough for nested records).
function Write-HttpResponse {
    param(
        [HttpStatusCode]$StatusCode,
        $Body
    )
    Push-OutputBinding -Name Response -Value ([HttpResponseContext]@{
        StatusCode  = $StatusCode
        Headers     = @{ 'Content-Type' = 'application/json' }
        Body        = ($Body | ConvertTo-Json -Depth 10)
    })
}

# Emits a 400 Bad Request with a machine-readable error code plus optional
# context, and logs the same detail as a warning for diagnostics.
function Write-BadRequestResponse {
    param(
        [Parameter(Mandatory)][string]$Code,
        [Parameter(Mandatory)][string]$Error,
        [hashtable]$Context = @{}
    )

    $parts = @("Bad request [$Code]", $Error)
    foreach ($key in $Context.Keys) {
        $value = $Context[$key]
        if ($null -eq $value -or $value -eq '') { continue }
        $parts += ('{0}={1}' -f $key, $value)
    }
    Write-Warning ($parts -join ' ')

    $body = [ordered]@{ code = $Code; error = $Error }
    foreach ($key in $Context.Keys) {
        $body[$key] = $Context[$key]
    }

    Write-HttpResponse -StatusCode ([HttpStatusCode]::BadRequest) -Body $body
}

# Returns the member name/value pairs of an object, transparently handling both
# PSCustomObject (the usual JSON deserialization) and Hashtable/dictionary.
function Get-Members {
    param($Obj)
    if ($Obj -is [System.Collections.IDictionary]) {
        return @($Obj.Keys | ForEach-Object { [pscustomobject]@{ Name = $_; Value = $Obj[$_] } })
    }
    return @($Obj.PSObject.Properties | ForEach-Object { [pscustomobject]@{ Name = $_.Name; Value = $_.Value } })
}

# True when the body is a table-keyed object (an object whose every value is an
# array). A single record never matches because it always has scalar members
# such as TimeGenerated.
function Test-TableKeyed {
    param($Body)
    if ($null -eq $Body -or $Body -is [System.Array]) { return $false }
    $members = Get-Members $Body
    if ($members.Count -eq 0) { return $false }
    foreach ($m in $members) { if ($m.Value -isnot [System.Array]) { return $false } }
    return $true
}

function Get-RecordBatches {
    # The Logs Ingestion API rejects any single call larger than 1 MB
    # (uncompressed). Split the records into batches whose serialized JSON array
    # stays under $MaxBytes (kept below 1 MB for header/encoding headroom).
    # Records that on their own exceed the limit are returned via -Oversized so
    # the caller can skip them instead of failing the whole request.
    param(
        [object[]]$Records,
        [int]$MaxBytes = 950000,
        [ref]$Oversized
    )
    $batches = New-Object System.Collections.Generic.List[object]
    $current = New-Object System.Collections.Generic.List[object]
    $currentSize = 2  # opening/closing array brackets

    foreach ($r in $Records) {
        $json = $r | ConvertTo-Json -Depth 10 -Compress
        $size = [Text.Encoding]::UTF8.GetByteCount($json) + 1  # +1 for the comma separator

        if ($size + 2 -gt $MaxBytes) {
            if ($Oversized) { $Oversized.Value.Add($r) }
            continue
        }
        if ($current.Count -gt 0 -and ($currentSize + $size) -gt $MaxBytes) {
            $batches.Add($current.ToArray())
            $current = New-Object System.Collections.Generic.List[object]
            $currentSize = 2
        }
        $current.Add($r)
        $currentSize += $size
    }
    if ($current.Count -gt 0) { $batches.Add($current.ToArray()) }
    return $batches
}

# Pulls an HTTP status code from a failed Invoke-RestMethod exception when
# available. Returns $null for network/transport failures with no response.
function Get-HttpStatusCode {
    param($Exception)

    try {
        if ($Exception.Response -and $Exception.Response.StatusCode) {
            if ($Exception.Response.StatusCode.value__) {
                return [int]$Exception.Response.StatusCode.value__
            }
            return [int]$Exception.Response.StatusCode
        }
    }
    catch { }
    return $null
}

# True for failures that are typically transient and worth retrying.
function Test-IsRetriableIngestionFailure {
    param(
        [Nullable[int]]$StatusCode,
        [string]$Message
    )

    if ($null -eq $StatusCode) { return $true }
    if ($StatusCode -in @(408, 429, 500, 502, 503, 504)) { return $true }

    if ($Message -match '(?i)timed out|timeout|temporarily unavailable|connection reset|name resolution|dns') {
        return $true
    }
    return $false
}

# Normalizes text that may contain encoding/rendering artifacts before it lands
# in Log Analytics. Keeps normal Unicode while stripping problematic controls.
function Normalize-DisplayString {
    param([string]$Value)

    if ($null -eq $Value) { return $null }
    $s = [string]$Value
    $s = $s -replace [char]0xFFFD, ''
    $s = $s -replace '[\u0000-\u001F\u007F]', ''
    $s = $s -replace '[\u200B-\u200D\uFEFF]', ''
    $s = $s -replace '[\u202A-\u202E\u2066-\u2069]', ''
    $s = $s -replace '[\s\u00A0]+', ' '
    return $s.Trim()
}

# Posts one ingestion batch with retry/backoff for transient network/API errors.
function Invoke-IngestionPostWithRetry {
    param(
        [Parameter(Mandatory)][string]$Uri,
        [Parameter(Mandatory)][string]$Body,
        [Parameter(Mandatory)][hashtable]$Headers,
        [Parameter(Mandatory)][string]$Table,
        [Parameter(Mandatory)][int]$BatchIndex,
        [Parameter(Mandatory)][int]$BatchCount
    )

    $maxAttempts = if ($env:INGEST_RETRY_ATTEMPTS) { [int]$env:INGEST_RETRY_ATTEMPTS } else { 4 }
    if ($maxAttempts -lt 1) { $maxAttempts = 1 }
    $timeoutSec = if ($env:INGEST_TIMEOUT_SEC) { [int]$env:INGEST_TIMEOUT_SEC } else { 120 }
    if ($timeoutSec -lt 10) { $timeoutSec = 10 }

    for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
        try {
            $null = Invoke-RestMethod -Method Post -Uri $Uri -Body $Body -Headers $Headers -TimeoutSec $timeoutSec
            return
        }
        catch {
            $statusCode = Get-HttpStatusCode -Exception $_.Exception
            $message = $_.Exception.Message
            $canRetry = ($attempt -lt $maxAttempts) -and (Test-IsRetriableIngestionFailure -StatusCode $statusCode -Message $message)

            if (-not $canRetry) { throw }

            $delaySeconds = [Math]::Min(30, [Math]::Pow(2, $attempt))
            Write-Warning "Transient ingestion failure for table $Table batch $BatchIndex/$BatchCount (attempt $attempt/$maxAttempts, HTTP $statusCode): $message. Retrying in $delaySeconds second(s)."
            Start-Sleep -Seconds $delaySeconds
        }
    }
}

# --- Read configuration injected by the Bicep deployment --------------------
$dcrEndpoint    = $env:DCR_ENDPOINT
$dcrImmutableId = $env:DCR_IMMUTABLE_ID
# DCR_STREAMS is OPTIONAL. Table-keyed bodies route each key to its
# Custom-<table> stream directly, so the only thing DCR_STREAMS does is pick a
# default table for a bare array / single-object body. The single-value
# DCR_STREAM app setting is still honoured for backward compatibility.
$dcrStreamsRaw  = $env:DCR_STREAMS
if (-not $dcrStreamsRaw) { $dcrStreamsRaw = $env:DCR_STREAM }

if (-not $dcrEndpoint -or -not $dcrImmutableId) {
    Write-Error 'DCR_ENDPOINT and DCR_IMMUTABLE_ID app settings must be configured.'
    Write-HttpResponse -StatusCode ([HttpStatusCode]::InternalServerError) -Body @{ error = 'Server not configured.' }
    return
}

# Map any configured table to its DCR stream (Custom-<tableName>). Entries may be
# given as a bare table name or an explicit Custom-* stream name. When
# DCR_STREAMS is absent the map is simply empty (no default table).
$streamByTable = [ordered]@{}
foreach ($entry in ($dcrStreamsRaw -split ',')) {
    $name = $entry.Trim()
    if (-not $name) { continue }
    $stream = if ($name -like 'Custom-*') { $name } else { "Custom-$name" }
    $table  = $stream -replace '^Custom-', ''
    $streamByTable[$table] = $stream
}
$defaultTable = if ($streamByTable.Count -gt 0) { @($streamByTable.Keys)[0] } else { $null }

# --- Device authentication (always required) --------------------------------
# Every caller must present a device-signed JWT (Authorization: Bearer <jwt>)
# proving possession of its Entra-join (MS-Organization-Access) certificate.
# See function/Modules/DeviceJwtAuth and README.md.
$authHeader = $Request.Headers.Authorization
if (-not $authHeader) { $authHeader = $Request.Headers.authorization }

$auth = Test-DeviceRequestJwt -AuthorizationHeader $authHeader
if (-not $auth.Valid) {
    Write-Warning "Device JWT rejected: $($auth.Reason)"
    Write-HttpResponse -StatusCode ([HttpStatusCode]::Unauthorized) -Body @{ error = 'Authentication failed.' }
    return
}
Write-Information "Device authenticated (did=$($auth.Claims.did) tid=$($auth.Claims.tid))."

# --- Validate payload -------------------------------------------------------
$payload = $Request.Body
if (-not $payload) {
    Write-BadRequestResponse -Code 'EmptyBody' -Error 'Request body is empty.'
    return
}

# Build per-table groups from the body. A table-keyed object routes each key to
# the matching stream; anything else goes to the default (first) table.
$groups = New-Object System.Collections.Generic.List[object]
if (Test-TableKeyed $payload) {
    foreach ($m in (Get-Members $payload)) {
        $table = [string]$m.Name
        # Prefer the configured stream, but fall back to Custom-<table> for tables
        # not listed in DCR_STREAMS. A schema-only update adds the DCR stream
        # without redeploying the Function (so this app setting can lag); routing
        # by name lets new tables ingest as soon as their DCR stream exists. If
        # the stream truly doesn't exist, the ingestion call below returns the
        # DCR's own error (relayed as 502) rather than a blanket 400 here.
        $stream = if ($streamByTable.Contains($table)) { $streamByTable[$table] } else { "Custom-$table" }
        $records = @($m.Value)
        if ($records.Count -eq 0) { continue }
        $groups.Add([pscustomobject]@{ Table = $table; Stream = $stream; Records = $records })
    }
}
else {
    if (-not $defaultTable) {
        Write-BadRequestResponse -Code 'MissingDefaultStream' -Error "Send a table-keyed body, e.g. { 'MyTable_CL': [ { ... } ] }. No DCR_STREAMS default table is configured for a bare array." -Context @{
            payloadType = $payload.GetType().FullName
            configuredTables = ($streamByTable.Keys -join ',')
        }
        return
    }
    $records = @($payload)
    $groups.Add([pscustomobject]@{ Table = $defaultTable; Stream = $streamByTable[$defaultTable]; Records = $records })
}

$totalRecords = 0
foreach ($g in $groups) { $totalRecords += $g.Records.Count }
if ($groups.Count -eq 0 -or $totalRecords -eq 0) {
    Write-BadRequestResponse -Code 'NoRecords' -Error 'No records to ingest.' -Context @{
        groupCount = $groups.Count
        totalRecords = $totalRecords
    }
    return
}

# Ensure every record has a TimeGenerated value (required by Log Analytics).
$nowUtc = (Get-Date).ToUniversalTime().ToString('o')
foreach ($group in $groups) {
    foreach ($record in $group.Records) {
        if ($record -is [System.Collections.IDictionary]) {
            if (-not $record.Contains('TimeGenerated') -or [string]::IsNullOrWhiteSpace([string]$record['TimeGenerated'])) {
                $record['TimeGenerated'] = $nowUtc
            }
            if ($record.Contains('AppLockerPublisher')) {
                $record['AppLockerPublisher'] = Normalize-DisplayString -Value ([string]$record['AppLockerPublisher'])
            }
            elseif ($record.Contains('Publisher')) {
                # Backward compatibility with any payloads that still use "Publisher".
                $record['Publisher'] = Normalize-DisplayString -Value ([string]$record['Publisher'])
            }
        }
        else {
            if (-not $record.PSObject.Properties['TimeGenerated'] -or [string]::IsNullOrWhiteSpace($record.TimeGenerated)) {
                $record | Add-Member -NotePropertyName 'TimeGenerated' -NotePropertyValue $nowUtc -Force
            }
            if ($record.PSObject.Properties['AppLockerPublisher']) {
                $record.AppLockerPublisher = Normalize-DisplayString -Value ([string]$record.AppLockerPublisher)
            }
            elseif ($record.PSObject.Properties['Publisher']) {
                $record.Publisher = Normalize-DisplayString -Value ([string]$record.Publisher)
            }
        }
    }
}

# --- Acquire a managed identity token for the ingestion endpoint ------------
try {
    $resourceUri = 'https://monitor.azure.com'
    $tokenUri = "$($env:IDENTITY_ENDPOINT)?resource=$resourceUri&api-version=2019-08-01"
    $tokenResponse = Invoke-RestMethod -Method Get -Uri $tokenUri -Headers @{ 'X-IDENTITY-HEADER' = $env:IDENTITY_HEADER }
    $accessToken = $tokenResponse.access_token
}
catch {
    Write-Error "Failed to acquire managed identity token: $($_.Exception.Message)"
    Write-HttpResponse -StatusCode ([HttpStatusCode]::InternalServerError) -Body @{ error = 'Could not authenticate to the ingestion endpoint.' }
    return
}

$ingestHeaders = @{
    'Authorization' = "Bearer $accessToken"
    'Content-Type'  = 'application/json'
}

# --- Forward each table group to its DCR stream (batched, <1 MB per call) ----
$ingested = 0
$batchTotal = 0
$oversizedTotal = 0
$perTable = [ordered]@{}

foreach ($group in $groups) {
    $ingestUri = "$dcrEndpoint/dataCollectionRules/$dcrImmutableId/streams/$($group.Stream)?api-version=2023-01-01"

    $oversized = New-Object System.Collections.Generic.List[object]
    $batches = Get-RecordBatches -Records $group.Records -Oversized ([ref]$oversized)
    $oversizedTotal += $oversized.Count
    if ($oversized.Count -gt 0) {
        Write-Warning "$($oversized.Count) record(s) for table $($group.Table) exceed the 1 MB per-call limit and were skipped."
    }

    $tableIngested = 0
    $batchIndex = 0
    foreach ($batch in $batches) {
        $batchIndex++
        # Compact JSON: matches the size estimate in Get-RecordBatches and minimizes
        # the payload so each call stays under the 1 MB Logs Ingestion limit.
        $body = $batch | ConvertTo-Json -Depth 10 -AsArray -Compress
        try {
            # Suppress pipeline output so the Functions host doesn't emit empty
            # "OUTPUT:" log lines for each successful ingestion call.
            Invoke-IngestionPostWithRetry -Uri $ingestUri -Body $body -Headers $ingestHeaders -Table $group.Table -BatchIndex $batchIndex -BatchCount $batches.Count
            $tableIngested += $batch.Count
        }
        catch {
            $statusCode = $null
            try { $statusCode = Get-HttpStatusCode -Exception $_.Exception } catch { }
            Write-Error "Ingestion failed for table $($group.Table) batch $batchIndex/$($batches.Count) (HTTP $statusCode): $($_.Exception.Message)"
            Write-HttpResponse -StatusCode ([HttpStatusCode]::BadGateway) -Body @{
                error      = 'Ingestion endpoint rejected the request.'
                table      = $group.Table
                statusCode = $statusCode
                ingested   = $ingested + $tableIngested
                total      = $totalRecords
            }
            return
        }
    }

    $ingested += $tableIngested
    $batchTotal += $batches.Count
    $perTable[$group.Table] = $tableIngested
    Write-Information "Ingested $tableIngested record(s) to stream $($group.Stream) in $($batches.Count) batch(es)."
}

$responseBody = @{
    status  = 'accepted'
    records = $ingested
    batches = $batchTotal
    tables  = $perTable
}
if ($oversizedTotal -gt 0) {
    $responseBody.skipped = $oversizedTotal
    $responseBody.status = 'partial'
}
$statusOut = if ($oversizedTotal -gt 0) { [HttpStatusCode]::MultiStatus } else { [HttpStatusCode]::OK }
Write-HttpResponse -StatusCode $statusOut -Body $responseBody

