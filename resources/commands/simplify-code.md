---
name: simplify-code
description: Simplify demonstrated complexity while preserving observable behavior.
---
# Simplify Code

Inspect the target, callers, contracts and existing tests. Identify concrete
complexity or duplication and the behavior that must remain equivalent.
Do not expand scope into an aesthetic rewrite or delete apparently unused
code without checking external/generated/dynamic consumers.

Agree scope and acceptance. Add missing behavioral characterization before
changing code, then make small causal edits and run authorized narrow checks.
Preserve errors, compatibility, concurrency and performance obligations.

Inspect the complete diff and obtain independent review where required.
Record verified effects and gaps. Do not claim faster execution without
measurement or include unrelated cleanup/publication.
