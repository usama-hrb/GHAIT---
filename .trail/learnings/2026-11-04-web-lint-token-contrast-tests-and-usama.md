---
title: 'Web lint, token-contrast tests and the language e2e spec were already failing before this work'
author: Usama
date: 2026-11-04
standing: true
id: l-dff6b5ec
scope: repo
status: active
src: init-sessions
---

## Watch out

- Several agents spent time proving these were not caused by their changes. They are known red baseline, not new regressions.
- In the code: Known red: `@fabric/web#lint` (5 errors in 4 shared files), 11 failures in `tokens.contrast.test.ts` (globals.css design tokens), and a stale `language.spec` e2e. Compare against this before chasing failures. `make deps` also showed 3 old violations.

_From past Claude sessions here, Nov 3._
