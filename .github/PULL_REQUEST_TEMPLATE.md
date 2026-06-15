## What does this add?

<!-- New property in an existing category, or a new category? Briefly describe it. -->

## Data point checklist

- [ ] Added/edited a file under `catalog/categories/`.
- [ ] `id` is unique; `order` is `100+` for new fields.
- [ ] Exactly one of `collector` or `expression` is set.
- [ ] The collector is **read-only** (no downloads, writes, deletes, service/process
      changes, or dynamic code execution).
- [ ] I ran `npm run validate`, `pwsh ./scripts/Test-Collectors.ps1`, and `npm test`
      locally and they pass.

## Collector source / testing notes

<!-- Where does the data come from (cmdlet/CIM class/registry key)? How did you test it? -->
