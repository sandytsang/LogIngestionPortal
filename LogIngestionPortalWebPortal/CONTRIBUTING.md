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

Each field is one column plus the **PowerShell that collects it**. The PowerShell
goes in `collector` — write the actual command, and make sure its **last line
returns the value**. That's it; you don't need to know anything else.

```json
{
  "id": "ChassisType",
  "label": "Chassis type",
  "order": 100,
  "default": false,
  "setups": [],
  "collector": "(Get-CimInstance -ClassName Win32_SystemEnclosure).ChassisTypes -join ','",
  "column": {
    "name": "ChassisType",
    "type": "string",
    "description": "Chassis type codes from Win32_SystemEnclosure."
  }
}
```

Multi-line collector? Join the lines with `\n` (the last line is the value):

```json
"collector": "$ci = Get-ComputerInfo\n$ci | Select-Object OsName, OsVersion, CsModel"
```

Rules:

- `collector` — your PowerShell. The **last line is the value** that gets stored.
  It runs as SYSTEM and is wrapped in `Invoke-Safe`, so a failure won't break the
  whole upload. Must be **read-only** (see the rule above).
- `setups` — leave it as `[]`. (It's an internal optimization; see §5.)
- `id` — unique, letters/numbers only.
- `label` — the friendly name shown in the portal (spaces OK).
- `order` — position in the list; use **100+** for new fields.
- `default` — `true` only for broadly useful, low-cost fields.
- `column.name` — the Log Analytics column / KQL field (letters, numbers, `_`).
- `column.type` — one of `string`, `int`, `long`, `real`, `boolean`, `datetime`,
  `dynamic`, `guid`. For `dynamic`, return a **small projected object**
  (`… | Select-Object Prop1, Prop2`), not a whole .NET object.

> 💡 The easiest path: open the portal, click **“+ Contribute a field”**, fill in
> the form, and it generates this exact JSON for you to paste here.

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

## 5. Advanced (maintainers): shared setups + `expression`

> Contributors can ignore this section — always use `collector`.

Some built-in fields use a second style to avoid running the **same** query many
times. Instead of `collector`, they use:

- A **`setups`** id, which emits a shared variable once at the top of the script
  (defined in [`catalog/setups.json`](catalog/setups.json)). For example `cs`
  emits `$cs = Get-CimInstance Win32_ComputerSystem`.
- An **`expression`** that reads that variable, e.g. `"$cs.Model"`.

```json
{ "id": "Model", "setups": ["cs"], "expression": "$cs.Model",
  "column": { "name": "Model", "type": "string", "description": "System model." } }
```

Rules for this style:

- A field has **exactly one** of `collector` or `expression` — never both.
- Any `$var` an `expression` uses **must** have its setup id listed in `setups`,
  or it's undefined at runtime (value comes out null). `npm run validate` enforces this.

| `setups` id | Variable | Source |
| --- | --- | --- |
| `cs` | `$cs` | `Win32_ComputerSystem` |
| `os` | `$os` | `Win32_OperatingSystem` |
| `bios` | `$bios` | `Win32_BIOS` |
| `mp` | `$mp` | `Get-MpComputerStatus` |
| `tpm` | `$tpm` | `Get-Tpm` |
| `secureBoot` | `$secureBoot` | `Confirm-SecureBootUEFI` |
| `net` | `$net` | `Get-NetIPConfiguration` (first IPv4) |
| `disk` | `$sysDrive` | `Win32_LogicalDisk` (system drive) |
| `bitLocker` | `$bitLocker` | `Get-BitLockerVolume` |
