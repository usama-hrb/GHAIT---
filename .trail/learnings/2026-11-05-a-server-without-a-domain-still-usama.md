---
title: "A server without a domain still needs HTTPS, so the bare IP gets Caddy's own certificate"
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 10, tokens: 110331 }
id: l-2ead9f34
scope: repo
status: active
src: agent
touches:
  - apps/api/drizzle/0032_partner_exit.sql
  - apps/api/drizzle/meta/0032_snapshot.json
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/database/schema/partners.ts
  - apps/api/src/modules/partners/partners.controller.ts
  - apps/api/src/modules/partners/partners.repositories.ts
  - apps/api/src/modules/partners/partners.service.ts
  - apps/api/src/modules/settlements/settlements.repositories.ts
  - apps/api/test/partner-exit.e2e-spec.ts
  - apps/api/test/partners.e2e-spec.ts
---

## Decided

- A production server reached by a bare IP address is served over HTTPS with a certificate from Caddy's local authority, not over plain HTTP. The web app makes every record id with `crypto.randomUUID`, which browsers offer only on a secure page, and the refresh cookie is marked Secure, which a browser drops over plain HTTP. Over HTTP the owner could neither sign in nor save. Making HTTP work would have meant a random-id fallback in about forty call sites plus a cookie switch, and it still could not register the service worker, so the app could never be installed or reloaded offline.
- The Caddyfile names the certificate with `default_sni {$DOMAIN}`. A browser sends no server name for a bare IP, and inside Docker Caddy sees the container's address instead of the server's, so without it every handshake failed with a TLS "internal error" even though the certificate had been issued. With a domain the browser sends the name and the setting changes nothing.
- The Makefile reads `STACK` from a `STACK=prod` line in `.env`, so the server's plain `make up` runs production while a development machine without that line stays on dev.

## Tried and ruled out

- Plain HTTP on the IP with a random-id fallback: still no service worker, no install, no offline reload, and more code in a path the accounting data depends on.
- A Let's Encrypt certificate for the IP: Caddy's own documentation does not describe it, and it could not be tried without a public server, so it is not the temporary setup.

## Watch out

- Caddy's automatic redirect from HTTP always points at port 443. With other host ports, open `https://<IP>:<HTTPS_PORT>` directly.
- A browser keeps its local database per address. Moving from the IP to a domain starts each device empty, so everything must be synced first.
- To test a production stack on a development machine, run it under its own project name (`docker compose -p <name>`) with a separate env file and other host ports, or it shares the development stack's volumes.

In the code: `infra/docker/caddy/Caddyfile`, `Makefile`, `.env.example`, `docs/runbooks/deploy.md` (section "Temporary: by IP address").
