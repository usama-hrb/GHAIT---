---
title: 'Stock lives in one place only: product batches, old fabric rolls kept as read-only history'
author: Usama
date: 2026-11-04
standing: true
id: l-9e11444c
scope: repo
status: active
src: init-sessions
---

## Decided

- Running the old roll model beside the new product model risked two sources of truth for stock. Team picked a full cut-over. Old tables stay for history and are not dropped.
- In the code: Do not write stock to Fabric/Colour/Roll tables or add dual writes. Use product batches and moves. Migrations 0028-0030 copy rolls, moves and sale lines into batches with the same ids. Legacy inventory module in apps/api is read-only history handlers.

_From past Claude sessions here, Nov 3._
