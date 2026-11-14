---
title: 'Each shop gets its own token key, and the host step lives in the shops module with a stale-serve lookup'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 1, tokens: 3718 }
id: l-842d248f
scope: repo
status: active
src: agent
touches:
  - apps/api/src/modules/auth/token.service.ts
  - apps/web/src/local-db/session.ts
---

## Decided

- Sign access tokens with a key made for each shop (HKDF-SHA256 of the server secret, info text `fabric-shop/access-token/<shop id>`) and also put a `shop` claim in the token, compared with the bound shop after the signature check. Two layers, each with its own test: a wrong key fails the signature; the right key with another shop's id fails the claim check. Removing the claim check makes the second test fail.
- Do that comparison in `TokenService`, not in `AuthGuard`: the guard has no token logic, and `TokenService` already reads the binding from `database/` without importing the shops module.
- Register the host step in `ShopsModule.configure`, and import `ShopsModule` only when `MULTI_SHOP=true`: the module opens the control database, which a one-shop server must not have. `/health` is excluded; `/docs` is set up before the step.
- The host lookup keeps an answer 30 s, holds at most 1000 hosts (anybody can send any `Host`), and waits 5 s after a failed control read so requests do not queue behind a dead database. A host answered before keeps its last answer; a never-seen host gets 503 `service_unavailable`.
- Closed shops and released hosts answer exactly like unknown hosts (404, same body). Suspended is 403 `forbidden` with issue code `shop_suspended`.
- `SHOP_POOL_MAX` (default 5) sets the shop pool size, because only the operator knows `max_connections`: budget is shops in use x `SHOP_POOL_MAX` + 3.
- The web client keeps the first shop id it sees and refuses another with `WrongShopError` (sync state `wrong_shop`); it does not sign out.

## Tried and ruled out

- Choosing the shop from a path, a header of ours or the token. Only `request.hostname` may.

## Watch out

- The HKDF info text is part of the token format; changing it signs every device out once.
- A device that first signed in on a one-shop server has no shop id, so if its address later goes to another shop, the first id it sees becomes its own.
- In multi-shop mode `TransactionHost.db` throws outside a bound shop. Make pools only in `ShopPools`.

In the code: `apps/api/src/modules/auth/token.service.ts`, `apps/api/src/modules/shops/shop-lookup.ts`, `apps/api/src/modules/shops/shops.module.ts`, `apps/api/src/database/shop-pools.ts`, `apps/web/src/local-db/session.ts`.
