---
title: 'Shop certificates come from a wildcard site under PLATFORM_DOMAIN, not a catch-all on-demand site'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 30, tokens: 411111 }
id: l-886f3744
scope: repo
status: active
src: agent
touches:
  - apps/api/test/known-host.e2e-spec.ts
  - infra/docker/compose.prod.yml
  - '.env.example'
  - Makefile
  - docs/runbooks/deploy.md
  - docs/runbooks/shops.md
  - docs/adr/0029-multi-shop-database-isolation.md
  - docs/MULTI_SHOP_PLAN.md
---

## Decided

- The shop-address certificates come from a wildcard site block, `*.{$PLATFORM_DOMAIN}` with `tls { on_demand }`, not from a catch-all `https://` on-demand site. Caddy asks the API `GET /internal/known-host?domain=<host>` before it makes a certificate; the API answers 200 only for a name that belongs to a shop that is not closed, and 404 for everything else, IP addresses included.
- `PLATFORM_DOMAIN` has two jobs: it is the Caddy site, and it is the default address `make shop-new` gives a shop (`<slug>.<PLATFORM_DOMAIN>`, an underscore becomes a hyphen). `HOST=` still wins.
- The ask route is closed twice, and each layer is proven alone: the Caddy site answers 404 for `/api/internal/*`, and the route itself refuses any request that carries `X-Forwarded-For` (Caddy adds one to every proxied request; its own ask call goes straight to `api:4000` and has none).
- No cache in the route: a shop made a moment ago must get its certificate on the first visit, and one closed a moment ago must stop at once.

## Tried and ruled out

- A catch-all `https:// { tls { on_demand } }` site. A visit to the bare IP has no SNI, so certmagic runs the permission check for the default name before it falls back to the default certificate. Caddy asked the API about `127.0.0.1`, got 404, and the TLS handshake failed (`tlsv1 alert internal error`). Shop 1 on a bare IP would have lost its certificate.

## Watch out

- Caddy logs nothing at the default level when it refuses a name. The proof that a random name gets no certificate is the 404 the API logs for the ask call, not a line in `make logs SERVICE=proxy`.
- The API port must never be published in `compose.prod.yml`. Without a proxy in front, the `X-Forwarded-For` check is the only thing between the outside and the route.
- Not run for real until Step 10: Let's Encrypt, real DNS. Locally it was proven with Caddy's own CA (`local_certs`). The Caddyfile is not validated in CI.

In the code: `apps/api/src/modules/shops/known-host.controller.ts`, `ShopsService.hasOpenShopAt` in `shops.service.ts`, `infra/docker/caddy/Caddyfile`, `Makefile` (`NEW_SHOP_HOST`), `apps/api/test/known-host.e2e-spec.ts`, "Many shops" in `docs/runbooks/deploy.md`.
