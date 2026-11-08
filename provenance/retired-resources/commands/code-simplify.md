---
name: code-simplify
description: Simplify a bounded change while preserving public behavior
---
# Simplify

Identify demonstrated complexity within the approved scope. Inspect
callers, tests, public behavior and project conventions.
Choose a smaller representation or remove actual duplication; do not
replace a working architecture because a generic style rule prefers it.

Define behavior-preservation checks before editing. Apply one coherent
change and inspect error, ownership and concurrency paths as applicable.
Verify with authorized checks and obtain review.
Report removed complexity and residual risk, not invented quality scores.
