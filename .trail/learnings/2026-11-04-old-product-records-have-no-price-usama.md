---
title: 'Old product records have no price fields, so missing prices crashed the inventory list'
author: Usama
date: 2026-11-04
standing: true
id: l-d1f1c713
scope: repo
status: active
src: init-sessions
---

## Watch out

- Records from before prices existed lack the keys. The value was undefined, not null, and it reached the money formatter and threw.
- In the code: In apps/web local-db `product-inventory.ts`, normalise missing normal/minimum prices (per metre and per piece) to null. Screens (inventory list, product detail, POS line dialog) treat undefined and null alike. Stored products must still parse during sync, so the price-presence rule lives on the input schema only.

_From past Claude sessions here, Nov 3._
