# Documentation

Central index for the Log Ingestion solution documentation. The detailed guides
live next to the code they describe (so they ship with each distributable
folder); this page just points you to them.

## Solution overview

- [Solution README](../README.md) — what the solution does and quick start.
- [Architecture overview](../LogIngestionAPI/docs/architecture-overview.md) —
  end-to-end data flow from the portal to a Log Analytics custom table.

## Deploy and operate (LogIngestionAPI)

- [Deployment package README](../LogIngestionAPI/README.md)
- [Deployment reference](../LogIngestionAPI/docs/deployment-reference.md)
- [Schema and columns](../LogIngestionAPI/docs/schema-and-columns.md)
- [RBAC and permissions](../LogIngestionAPI/docs/rbac-and-permissions.md)
- [Testing and CI](../LogIngestionAPI/docs/testing-and-ci.md)
- [Troubleshooting](../LogIngestionAPI/docs/troubleshooting.md)

## Security

- [Device authentication: JWT + certificate chain](../LogIngestionAPI/docs/device-jwt-authentication.md)
- [Security hardening](../LogIngestionAPI/docs/security-hardening.md)

## Web portal

- [Portal README](../LogIngestionPortalWebPortal/README.md)
- [Catalog authoring](../LogIngestionPortalWebPortal/docs/catalog-authoring.md)

---

> The full content is intentionally kept under `LogIngestionAPI/docs/` and
> `LogIngestionPortalWebPortal/docs/` so each folder stays self-contained when
> distributed on its own. This page is only an index.
