# Documentation index

Detailed documentation for the Log Ingestion solution. Start here, then follow
the topic you need.

## Understand the solution

- [Architecture overview](architecture-overview.md) — end-to-end data flow from
  the portal to a Log Analytics custom table, and where each piece lives.
- [Device authentication: JWT + certificate chain](device-jwt-authentication.md)
  — how the device-signed JWT and certificate chain are created and validated.

## Build and operate

- [Deployment reference](deployment-reference.md) — `deploy.ps1` parameters,
  upsert behavior, split resource groups, Cloud Shell, and `-SchemaOnly`.
- [Schema and columns](schema-and-columns.md) — `schema/columns.json` as the
  source of truth, supported types, and the add/remove-a-column workflow.
- [RBAC and permissions](rbac-and-permissions.md) — every identity and role the
  solution needs (deployer, Function managed identity, GitHub OIDC).
- [Security hardening](security-hardening.md) — tightening the deployment beyond
  the secure defaults.
- [Testing and CI](testing-and-ci.md) — the GitHub workflows and local checks.

## Contribute to the portal catalog

- [Catalog authoring](../../LogIngestionPortalWebPortal/docs/catalog-authoring.md)
  — add or change telemetry fields/collectors in the web portal catalog.

## Related top-level READMEs

- Solution overview and quick start: [`../../README.md`](../../README.md)
- Deployment and operations: [`../README.md`](../README.md)
- Portal development: [`../../LogIngestionPortalWebPortal/README.md`](../../LogIngestionPortalWebPortal/README.md)
