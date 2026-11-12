---
title: 'A host build of the API empties the folder the dev container runs from, and the dev API stays down'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 9, tokens: 44252 }
id: l-a0ab3703
scope: repo
status: active
src: agent
touches:
  - apps/api/nest-cli.json
  - infra/docker/compose.dev.yml
  - Makefile
---

## Decided

- Before any host build of the API (`pnpm turbo run build --filter=@fabric/api`, which `make e2e` runs first), know that the dev container sees the same files. It bind-mounts the checkout at `/repo` and runs `nest start --watch`, which executes `node dist/main` from `apps/api/dist`.
- `apps/api/nest-cli.json` sets `deleteOutDir: true`, so every `nest build` empties `apps/api/dist` before it rewrites it. If the dev watcher recompiles in that window, `node` starts without a `dist/main` and the API exits with "Cannot find module '/repo/apps/api/dist/main'". The container then sits in "Waiting for file changes" and reports unhealthy, even though the host build finished and `dist` is complete again.

## Tried and ruled out

- Waking the watcher by touching `apps/api/src/main.ts`, then by rewriting it with identical content: neither produced a recompile, so the dev API stayed down. A real source edit, or `docker restart fabric-shop-dev-api-1`, is what brings it back.

## Watch out

- Running e2e or an API build while the dev stack is up can silently take the dev API down. The web container stays healthy and proxies `/api` to nothing. After such a run, check `docker ps` for `fabric-shop-dev-api-1` and restart it, or stop the dev API first.

In the code: `apps/api/nest-cli.json` (`deleteOutDir`), `infra/docker/compose.dev.yml` (the `/repo` bind mount), `Makefile` (`e2e` target).
