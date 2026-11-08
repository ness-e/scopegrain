---
name: incremental-implementation
description: Use for changes that can be delivered as small vertical slices without broad unrelated churn
---
# Incremental Implementation

Choose the smallest end-to-end behavior that advances the approved goal.
Identify its interface, storage and verification boundary.
Reproduce the gap, implement one coherent slice and inspect the diff.
Run the narrow authorized checks, recording limitations and collateral risk.
Do not refactor unrelated modules or re-run unchanged long jobs by default.
Carry settled results into the next slice instead of recomputing them.
