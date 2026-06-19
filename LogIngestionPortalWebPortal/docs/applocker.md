# AppLocker collection

How the **AppLocker** dataset is collected, why it is incremental, and how the
generated detection script avoids re-uploading the same events on a frequent
schedule.

## A row-source dataset

The AppLocker category
([`catalog/categories/applocker.json`](../catalog/categories/applocker.json)) is
the reference example of a *row-source* field — a `collector` that returns an
array plus an `element[]` schema, so each array item becomes its own row.

- The collector reads AppLocker events from the Windows AppLocker event logs and
  classifies each as **Audited** (would have been blocked) or **Denied**
  (blocked), using the structured event XML (`UserData.RuleAndFileData`) rather
  than parsing message text.
- Its `element[]` columns (`AppLockerEventTime`, `AppLockerEventType`,
  `AppLockerFilePath`, `AppLockerFileHash`, `AppLockerPublisher`, …) make it a
  one-row-per-event table, mapped to `AppLockerEvents_CL`.
- Because it is schema-driven like every other field, deploying (or
  `-SchemaOnly`) creates the table and DCR stream automatically — no Function or
  Bicep change.

Use this pattern for any "many rows per device" inventory (events, drivers,
hotfixes): `collector` returns the array, `element[]` defines the per-row
columns.

## Incremental collection (the watermark)

AppLocker is typically scheduled to run often (e.g. hourly). If every run shipped
the full rolling 24h window, the same events would be ingested ~24× per day — on
a large fleet that multiplies Log Analytics ingestion (and cost) with duplicate
rows. To avoid that, the collector ships only **new** events each run using a
per-channel high-watermark.

**Where it lives** — a small state file on each device:

```
C:\ProgramData\LogIngestionPortal\AppLockerWatermark.json
```

Its contents are the highest `EventRecordId` already uploaded for each AppLocker
channel (`EventRecordId` is the monotonically increasing record counter Windows
assigns within an event log channel, which makes a perfect cursor):

```json
{"Microsoft-Windows-AppLocker/EXE and DLL":120345,"Microsoft-Windows-AppLocker/MSI and Script":6789}
```

**How each run works**

1. **Read** the watermark file (missing → treat each channel as `0`).
2. **Query** the last 24h from each channel — the bounded fallback window.
3. **Rollover check** — if a channel's newest `EventRecordId` is *below* the
   stored watermark, the log was cleared or wrapped, so that channel's watermark
   resets to `0`.
4. **Filter** — skip any event whose `EventRecordId` is ≤ the watermark; only
   genuinely new events are enriched and emitted.
5. **Advance** the watermark to the newest record seen (including ones skipped
   because their on-disk file is gone, so they are never re-examined).
6. **Queue** the new watermark — the collector itself writes nothing
   (collectors are read-only by design and the security gate forbids writes).
7. **Commit after a successful upload** — the host script writes the watermark
   file only after `Send-Telemetry` succeeds. If the upload fails, the old
   watermark stays in place and the next run re-reads the same events
   (**at-least-once**).

**First run / after a log clear** ship up to 24h of backfill (the fallback
window); every later run ships only what is new since the last successful upload.

Because the failure mode is at-least-once, a rare overlap (e.g. a retry after a
partial failure) can produce duplicate rows — deduplicate at query time on
`AppLockerEventRecordId + DeviceName`. See the KQL in
[../../LogIngestionAPI/docs/applocker.md](../../LogIngestionAPI/docs/applocker.md).

> The mechanism is generic: any collector can register a
> `@{ Path = <file>; Json = <text> }` entry in `$script:PendingState` and the
> host script will persist it post-send. AppLocker is the first user.
