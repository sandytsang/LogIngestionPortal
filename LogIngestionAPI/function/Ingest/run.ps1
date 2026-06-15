using namespace System.Net

# Generic Logs Ingestion forwarder.
#
# Accepts a JSON body (a single object or an array of objects), obtains a token
# from the Function's managed identity, and POSTs the records to the DCR's
# direct logsIngestion endpoint. The function is schema-agnostic: the DCR's
# transformKql decides which columns land in the table, so adding/removing a
# column in schema/columns.json never requires changing this code.

param($Request, $TriggerMetadata)

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

# --- Read configuration injected by the Bicep deployment --------------------
$dcrEndpoint   = $env:DCR_ENDPOINT
$dcrImmutableId = $env:DCR_IMMUTABLE_ID
$dcrStream     = $env:DCR_STREAM

if (-not $dcrEndpoint -or -not $dcrImmutableId -or -not $dcrStream) {
    Write-Error 'DCR_ENDPOINT, DCR_IMMUTABLE_ID and DCR_STREAM app settings must be configured.'
    Write-HttpResponse -StatusCode ([HttpStatusCode]::InternalServerError) -Body @{ error = 'Server not configured.' }
    return
}

# --- Device authentication (optional, env-var gated) ------------------------
# When JWT_ENFORCE=true the caller must present a device-signed JWT
# (Authorization: Bearer <jwt>) proving possession of its Entra-join
# (MS-Organization-Access) certificate. See function/Modules/DeviceJwtAuth and
# README.md. When unset/false the function behaves as before (function key only),
# so it is safe to deploy this code before any device certificates exist.
if ($env:JWT_ENFORCE -eq 'true') {
    $authHeader = $Request.Headers.Authorization
    if (-not $authHeader) { $authHeader = $Request.Headers.authorization }

    $auth = Test-DeviceRequestJwt -AuthorizationHeader $authHeader
    if (-not $auth.Valid) {
        Write-Warning "Device JWT rejected: $($auth.Reason)"
        Write-HttpResponse -StatusCode ([HttpStatusCode]::Unauthorized) -Body @{ error = 'Authentication failed.' }
        return
    }
    Write-Information "Device authenticated (did=$($auth.Claims.did) tid=$($auth.Claims.tid))."
}

# --- Validate payload -------------------------------------------------------
$payload = $Request.Body
if (-not $payload) {
    Write-HttpResponse -StatusCode ([HttpStatusCode]::BadRequest) -Body @{ error = 'Request body is empty.' }
    return
}

# Normalise to an array of records (the Logs Ingestion API expects an array).
if ($payload -isnot [System.Array]) {
    $payload = @($payload)
}

if ($payload.Count -eq 0) {
    Write-HttpResponse -StatusCode ([HttpStatusCode]::BadRequest) -Body @{ error = 'No records to ingest.' }
    return
}

# Ensure every record has a TimeGenerated value (required by Log Analytics).
$nowUtc = (Get-Date).ToUniversalTime().ToString('o')
foreach ($record in $payload) {
    if (-not $record.PSObject.Properties['TimeGenerated'] -or [string]::IsNullOrWhiteSpace($record.TimeGenerated)) {
        $record | Add-Member -NotePropertyName 'TimeGenerated' -NotePropertyValue $nowUtc -Force
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

# --- Forward to the DCR direct ingestion endpoint (batched, <1 MB per call) -
$ingestUri = "$dcrEndpoint/dataCollectionRules/$dcrImmutableId/streams/$($dcrStream)?api-version=2023-01-01"
$ingestHeaders = @{
    'Authorization' = "Bearer $accessToken"
    'Content-Type'  = 'application/json'
}

$oversized = New-Object System.Collections.Generic.List[object]
$batches = Get-RecordBatches -Records $payload -Oversized ([ref]$oversized)

if ($oversized.Count -gt 0) {
    Write-Warning "$($oversized.Count) record(s) exceed the 1 MB per-call limit and were skipped."
}

$ingested = 0
$batchIndex = 0
foreach ($batch in $batches) {
    $batchIndex++
    # Compact JSON: matches the size estimate in Get-RecordBatches and minimizes
    # the payload so each call stays under the 1 MB Logs Ingestion limit.
    $body = $batch | ConvertTo-Json -Depth 10 -AsArray -Compress
    try {
        Invoke-RestMethod -Method Post -Uri $ingestUri -Body $body -Headers $ingestHeaders
        $ingested += $batch.Count
    }
    catch {
        $statusCode = $null
        try { $statusCode = $_.Exception.Response.StatusCode.value__ } catch { }
        Write-Error "Ingestion failed for batch $batchIndex/$($batches.Count) (HTTP $statusCode): $($_.Exception.Message)"
        Write-HttpResponse -StatusCode ([HttpStatusCode]::BadGateway) -Body @{
            error      = 'Ingestion endpoint rejected the request.'
            statusCode = $statusCode
            ingested   = $ingested
            total      = $payload.Count
        }
        return
    }
}

Write-Information "Ingested $ingested record(s) to stream $dcrStream in $($batches.Count) batch(es)."
$responseBody = @{
    status  = 'accepted'
    records = $ingested
    batches = $batches.Count
}
if ($oversized.Count -gt 0) {
    $responseBody.skipped = $oversized.Count
    $responseBody.status = 'partial'
}
$statusOut = if ($oversized.Count -gt 0) { [HttpStatusCode]::MultiStatus } else { [HttpStatusCode]::OK }
Write-HttpResponse -StatusCode $statusOut -Body $responseBody

