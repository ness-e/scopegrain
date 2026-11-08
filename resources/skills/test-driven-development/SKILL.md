---
name: test-driven-development
description: Use to prove an intended behavior gap with a regression test before changing implementation
---
# Behavior-First Tests

Write the smallest observable failing case for the approved contract.
When authorized, run it and confirm it fails for the intended reason,
not a broken fixture, import or environment.
Implement the minimum causal change, rerun the scoped case and check
relevant boundaries. Refactor only with behavior protected.
Keep commands and expected versus actual results distinct.
If execution is not authorized, report the unexecuted status explicitly.
