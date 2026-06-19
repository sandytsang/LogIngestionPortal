# Security hardening

The solution ships secure-by-default (device-signed JWT always required, cert
chain validation on, Entra device binding on). This document lists the optional
controls you can tighten further, and the trade-offs.

For how the auth actually works, see
[Device authentication: JWT + certificate chain](device-jwt-authentication.md).

## Secure defaults (already on)

| Control | Default | Effect |
|---------|---------|--------|
| `JWT_ENFORCE` | `true` | Every request needs a valid device JWT. |
| `JWT_REQUIRE_CERT_CHAIN` | `true` | The client cert must build a valid chain. |
| `JWT_REQUIRE_ENTRA_DEVICE` | `true` | The cert must be registered to the Entra device (Graph lookup). |
| Token lifetime | 5 min + nonce | Bounds replay. |
| Outbound auth | Managed identity / OIDC | No stored secrets. |

## Optional hardening

### Pin the certificate root / intermediates

Restrict which CA chains are accepted:

- `JWT_TRUSTED_ROOT_THUMBPRINTS` — comma-separated allow-list of root
  thumbprints. The resolved root must match.
- `JWT_TRUSTED_INTERMEDIATE_THUMBPRINTS` — comma-separated allow-list; at least
  one chain intermediate must match.

When roots are pinned, chain validation is strict (no `AllowUnknownCertificateAuthority`).

### Enable revocation checking

- `JWT_CHECK_CERT_REVOCATION=true` performs online CRL/OCSP checks during chain
  validation. Off by default because it adds a network call per request.

### Pin the tenant

- `JWT_ALLOWED_TENANT_ID=<guid>` rejects tokens whose `tid` claim differs.
  `deploy.ps1` sets this to the current tenant automatically.

### Bind the audience

- `JWT_EXPECTED_AUDIENCE=https://<func>.azurewebsites.net` ensures a token minted
  for this Function can't be replayed against another endpoint. Set by deploy.

### Protect the Function key

The function URL contains `?code=<key>` and must be treated as a secret:

- Store the full URL as a secret (Intune script config, Key Vault, etc.).
- Rotate the key periodically: Function App → App keys.
- Note the device JWT is the real authN gate; the key is defense in depth.

## Trade-off: disabling the Entra device check

Setting `JWT_REQUIRE_ENTRA_DEVICE=false` removes the Graph dependency
(no Device.Read.All needed), but the Function then trusts any cert that:

- is issued by `MS-Organization-Access`, **and**
- builds a valid chain (if `JWT_REQUIRE_CERT_CHAIN=true`), **and**
- signs the JWT.

It no longer verifies the device is **registered and enabled** in your tenant.
Prefer leaving it `true` in production; use `false` only when you cannot grant
Graph permission, and compensate by pinning roots/intermediates and the tenant.

## Recommended production profile

| Setting | Value |
|---------|-------|
| `JWT_REQUIRE_ENTRA_DEVICE` | `true` |
| `JWT_REQUIRE_CERT_CHAIN` | `true` |
| `JWT_ALLOWED_TENANT_ID` | your tenant id |
| `JWT_EXPECTED_AUDIENCE` | your Function URL |
| `JWT_TRUSTED_ROOT_THUMBPRINTS` | your Entra device CA root(s) |
| `JWT_CHECK_CERT_REVOCATION` | `true` if your CA publishes CRL/OCSP |
| Function key | rotated, stored as a secret |
