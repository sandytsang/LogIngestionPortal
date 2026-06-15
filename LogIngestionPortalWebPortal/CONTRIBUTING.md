# Contributing a data point

The catalog is community-driven. You can add a **new property** to an existing
category, or a **whole new category**, by adding a small JSON entry — no app code
changes required. Each entry bundles the Log Analytics **column** and the
**PowerShell** that collects it, so the portal keeps the schema and the device
script in sync automatically.

> **Read-only rule.** Collectors run as **SYSTEM on managed devices**. They must
> only *read* device state. Anything that downloads, writes, deletes, executes
> dynamic code, or changes configuration is rejected automatically and will not
> be merged.

## 1. Where to add it

- Add a property to an existing category: edit the matching file in
  [`catalog/categories/`](catalog/categories) and append to its `fields` array.
- New category: add a new `catalog/categories/<your-category>.json` file.

## 2. Field format

```json
{
  "id": "ThermalState",
  "label": "Thermal state",
  "order": 100,
  "default": false,
  "needsSystem": false,
  "setups": [],
  "collector": "(Get-CimInstance -ClassName Win32_SystemEnclosure).ChassisTypes -join ','",
  "column": {
    "name": "ChassisTypes",
    "type": "string",
    "description": "Chassis type codes from Win32_SystemEnclosure."
  }
}
```

Rules:

- `id` — unique, letters/numbers only (used as a PowerShell variable).
- `order` — controls position; use **100+** for new fields so existing columns
  keep their order.
- `default` — `true` only for broadly useful, low-cost fields.
- `needsSystem` — `true` if the collector requires SYSTEM/admin.
- `column.type` — one of `string`, `int`, `long`, `real`, `boolean`, `datetime`,
  `dynamic`, `guid`.
- Provide **exactly one** of:
  - `collector` — a self-contained PowerShell snippet that returns the value. It
    is automatically wrapped in `Invoke-Safe` (failures won't break the upload).
  - `expression` — a one-line expression that uses a shared setup. Add the setup
    id to `setups` and define it in [`catalog/setups.json`](catalog/setups.json)
    (and to `setupOrder` in [`catalog/meta.json`](catalog/meta.json)).

Prefer `collector` unless you need to share an expensive query (e.g. a single
`Get-CimInstance`) across several fields.

## 3. Validate locally

```powershell
npm install
npm run validate            # schema + uniqueness + read-only security gate
pwsh ./scripts/Test-Collectors.ps1   # PowerShell syntax check
npm test                    # round-trip + generator tests
```

## 4. Open a pull request

CI runs the same checks. A maintainer then reviews the collector for safety and
correctness before merging. Once merged, your field appears in the portal and is
emitted into the generated Intune script.
