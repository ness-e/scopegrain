---
name: codeGraph
description: Investigate structure and impact with explicit graph capability fallback
---
# Structural Investigation

State the symbol, module or architectural question. If an available,
current graph can answer it, use it and record scope/freshness.
If not, use source search, imports, callers and tests; label the fallback.

Inspect public interfaces, dependency direction, cycles and change impact.
Do not install graph tools or re-index remote systems without permission.
Do not call a symbol dead merely because one search found no caller:
dynamic registration, reflection, generated code and external consumers
may be outside the inspected surface. Report uncertainty.
