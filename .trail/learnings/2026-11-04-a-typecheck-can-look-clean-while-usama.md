---
title: 'A typecheck can look clean while hiding errors, because syntax errors in one file stop deeper checks'
author: Usama
date: 2026-11-04
standing: true
id: l-6547c6c9
scope: repo
status: active
src: init-sessions
---

## Watch out

- A half-edited screen had syntax errors. The compiler skipped meaningful type checks across the project, so errors in new files could be masked.
- In the code: If `tsc` reports syntax errors in any file, type-check your own files with a scoped tsconfig that excludes the broken one. Do not trust an error count from the full run.

_From past Claude sessions here, Nov 3._
