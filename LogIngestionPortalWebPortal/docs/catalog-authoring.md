# Catalog authoring

How to add or change telemetry fields in the web portal catalog. The catalog is
what keeps the generated device script and `schema/columns.json` in sync, so
every field is defined once and drives both.

## Where the catalog lives

```
catalog/
  meta.json                  # catalog metadata
  setups.json                # shared setup snippets (reusable PowerShell)
  security-rules.json        # security guidance/rules
  categories/                # one JSON file per category
    hardware.json
    operating-system.json
    ...
  schema/
    category.schema.json     # JSON Schema the category files must satisfy
```

## Two ways to contribute

1. **In-app Contribute flow** — use the portal's Contribute dialog (validates as
   you go).
2. **Edit `catalog/categories/*.json` directly** — then validate locally.

## Category file shape

A category file declares a display `category` and a list of `fields`:

```json
{
  "category": "Hardware",
  "fields": [
    {
      "id": "Manufacturer",
      "label": "Manufacturer",
      "order": 10,
      "default": true,
      "setups": ["computerSystem"],
      "expression": "$cs.Manufacturer",
      "column": {
        "name": "Manufacturer",
        "type": "string",
        "description": "System manufacturer (Win32_ComputerSystem.Manufacturer)."
      }
    }
  ]
}
```

### Field properties

| Property | Required | Notes |
|----------|----------|-------|
| `id` | Yes | Unique; `^[A-Za-z][A-Za-z0-9]*$` (valid PowerShell variable fragment), max 60. |
| `label` | Yes | Display name (1–60 chars). |
| `order` | Yes | Sort order (0–100000). |
| `default` | Yes | Whether the field is pre-selected. |
| `locked` | No | If true, can't be deselected (e.g. required fields). |
| `setups` | Yes | Names of shared snippets from `setups.json` this field depends on. |
| `expression` | One of `expression`/`collector` | A single PowerShell expression producing the value. |
| `collector` | One of `expression`/`collector` | A multi-line PowerShell block (up to 4000 chars) for complex collection. |
| `element` | No | Array of `{ expression, column }` for a field that yields several columns. |
| `column` | Yes | The Log Analytics column this field maps to. |

> A field must have **either** `expression` **or** `collector`, not both
> (enforced by the schema's `oneOf`).

### Column object

| Property | Notes |
|----------|-------|
| `name` | `^[A-Za-z][A-Za-z0-9_]*$`, max 60. The Log Analytics column name. |
| `type` | One of `string`, `int`, `long`, `real`, `boolean`, `datetime`, `dynamic`, `guid`. |
| `description` | 1–300 chars. |

See [Schema and columns](../../LogIngestionAPI/docs/schema-and-columns.md) for how
columns become the deployed table and DCR.

## Shared setups

`setups.json` holds reusable PowerShell snippets (e.g. fetching a CIM instance
once) keyed by name. A field references them via `setups: ["name"]`; the
generator emits each needed setup once and reuses the variable across fields.
This avoids querying the same WMI/CIM class multiple times.

## Validate before a PR

```powershell
npm run validate                     # catalog JSON vs category.schema.json
pwsh ./scripts/Test-Collectors.ps1   # parse every expression/collector for syntax errors
npm test                             # generator + mapping unit tests
```

`Test-Collectors.ps1` parses every `expression`, `collector`, `element`
expression, and each `setups` snippet with the PowerShell language parser, so a
typo in a collector is caught before it ships.

## Row-source datasets (many rows per device)

A field becomes a *row-source* when its `collector` returns an array and it
defines an `element[]` schema, so each array item becomes its own row. Use this
pattern for any "many rows per device" inventory (events, drivers, hotfixes):
`collector` returns the array, `element[]` defines the per-row columns, and
deploying (or `-SchemaOnly`) creates the table and DCR stream automatically — no
Function or Bicep change.

The **AppLocker** category
([`catalog/categories/applocker.json`](../catalog/categories/applocker.json)) is
the reference example, including its incremental, watermark-based collection.
See [AppLocker collection](applocker.md).

## Tips

- Keep `expression` fields simple; use `collector` only when you need branching
  or multiple statements.
- Reuse `setups` rather than re-querying the same source.
- Match the `column.name` to the value your expression returns, and pick the
  narrowest `type` that fits (`dynamic` only for arrays/objects).
- Use a clear `description` — it appears in `columns.json` and helps consumers.
