## What does this add?

<!-- New property in an existing category, or a new category? Briefly describe it
     and where the data comes from. -->

## Data point checklist

- [ ] Added/edited a file under `LogIngestionPortalWebPortal/catalog/categories/`.
- [ ] Used a self-contained **`collector`** (the actual PowerShell; its **last line
      returns the value**) with `"setups": []`. <!-- expression/setups is for maintainers only -->
- [ ] `id` is unique; `order` is `100+` for new fields.
- [ ] For a `dynamic` column, the collector returns a **small projected object**
      (`… | Select-Object Prop1, Prop2`), not a whole .NET object.
- [ ] The collector is **read-only** (no downloads, writes, deletes, service/process
      changes, or dynamic code execution).
- [ ] I ran the checks locally from the portal folder and they pass:
      ```powershell
      cd LogIngestionPortalWebPortal
      npm run validate                     # schema + uniqueness + read-only gate
      pwsh ./scripts/Test-Collectors.ps1   # PowerShell syntax check
      npm test                             # generator tests
      ```

> New here? The easiest way is the portal's **“+ Contribute a field”** button — it
> builds the JSON and opens this PR for you. See
> [CONTRIBUTING.md](../LogIngestionPortalWebPortal/CONTRIBUTING.md).

## Collector source / testing notes

<!-- Where does the data come from (cmdlet / CIM class / registry key)? How did you
     test it (which device/OS)? Paste a sample of the value if helpful. -->

