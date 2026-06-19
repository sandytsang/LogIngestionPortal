# Schema and columns

`schema/columns.json` is the **source of truth** for the custom tables and their
columns. The deployed Log Analytics table, the DCR stream/transform, and the
generated device script are all derived from it.

## File shape

```json
{
  "tables": [
    {
      "tableName": "Devices_CL",
      "description": "Custom telemetry collected by Intune Proactive Remediation scripts.",
      "columns": [
        { "name": "TimeGenerated", "type": "datetime", "description": "Event timestamp (UTC). REQUIRED." },
        { "name": "DeviceName",    "type": "string",   "description": "Hostname of the reporting device." }
      ]
    }
  ]
}
```

- **`tableName`** — must end in `_CL` (custom log). Becomes a `Custom-<tableName>`
  DCR stream.
- **`description`** — table description.
- **`columns[]`** — each has `name`, `type`, `description`.

### Rules

- Every table must include a **`TimeGenerated`** (`datetime`) column — Log
  Analytics requires it. The Function also stamps it if the device omits it.
- Column `name` must match `^[A-Za-z][A-Za-z0-9_]*$` (max 60 chars).
- Property names produced by the device script must match column names exactly;
  unmatched properties are silently dropped by the DCR.

## Supported column types

| Type | Use for |
|------|---------|
| `string` | Text. |
| `int` | 32-bit integer. |
| `long` | 64-bit integer. |
| `real` | Floating point. |
| `boolean` | True/false. |
| `datetime` | UTC timestamps (e.g. `TimeGenerated`). |
| `dynamic` | Arrays/objects (e.g. per-volume BitLocker status). |
| `guid` | GUID values. |

## How columns become a table

The DCR ([dcr.bicep](../infra/modules/dcr.bicep)) builds, per table:

- a **stream declaration** `Custom-<tableName>` whose columns are the
  `name`/`type` pairs from `columns.json`;
- a **data flow** with
  `transformKql: 'source | project <col1>, <col2>, ...'` and
  `outputStream: Custom-<tableName>`.

So the `project` list is exactly the columns you declared — any field the device
sends that is not projected never reaches the table.

## Add, change, or remove a column

1. **Regenerate** `schema/columns.json` (re-run the portal) or edit it directly.
2. If you changed what the device collects, also update the device script
   ([`Get-DeviceData`](../scripts/IntuneScript.ps1)) so the property names match.
3. **Apply the schema** — you do **not** need a full redeploy:

   ```powershell
   ./deploy.ps1 -SchemaOnly `
     -WorkspaceName  <workspace> -WorkspaceResourceGroup <rg> `
     -DcrName        <dcr>       -DcrResourceGroup       <rg>
   ```

   Or run the **Update data columns (schema-only)** GitHub workflow.

> Removing a column from `columns.json` stops new data for it; existing data in
> the table is unaffected. Renaming is an add + remove (history stays under the
> old name).

## Build columns from sample data

Run the device script with `-PreviewData` (as SYSTEM) to print the exact JSON it
would send, then paste that into the portal's "Build columns.json from sample
data" tool to generate a matching schema.
