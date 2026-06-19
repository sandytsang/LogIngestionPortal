# AppLocker events: querying and dedup

The `AppLockerEvents_CL` table holds one row per AppLocker **Audited**
(would-have-blocked) or **Denied** (blocked) execution event collected from
devices.

## Incremental collection and why dedup is needed

The device collector ships AppLocker events **incrementally** — it tracks a
per-channel `EventRecordId` high-watermark on each device and uploads only new
events, so a frequent (e.g. hourly) schedule does not re-ingest the rolling 24h
window every run. The watermark is committed only after a successful upload, so
the failure mode is **at-least-once**: a failed upload (or a log clear/wrap) can
occasionally cause the same event to be uploaded twice. Use `EventRecordId`
(`AppLockerEventRecordId`) together with `DeviceName` as the stable event
identity to deduplicate at query time.

For how the watermark works and where it is stored on the device, see the portal
doc: [../../LogIngestionPortalWebPortal/docs/applocker.md](../../LogIngestionPortalWebPortal/docs/applocker.md).

## Deduplicated query helper

```kusto
// Create/update a helper function that returns deduplicated AppLocker rows.
// Uses DeviceName + AppLockerEventRecordId as the stable event identity and
// keeps the newest row when the same event was uploaded more than once.
.create-or-alter function with (
	folder = "LogIngestion",
	docstring = "Deduplicated AppLocker events by DeviceName + AppLockerEventRecordId"
) AppLockerEvents_Deduped() {
	AppLockerEvents_CL
	| summarize arg_max(TimeGenerated, *) by DeviceName, AppLockerEventRecordId
}
```

```kusto
// Example usage: deduplicated events in the last 24h
AppLockerEvents_Deduped()
| where TimeGenerated > ago(24h)
| project TimeGenerated, DeviceName, AppLockerEventType, AppLockerFilePath, AppLockerRuleName
| order by TimeGenerated desc
```
