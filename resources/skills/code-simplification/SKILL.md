---
name: code-simplification
description: Use to remove demonstrated duplication or complexity from an approved change scope
---
# Simplification

Inspect the behavior, callers and project idioms before choosing a change.
Identify what is actually redundant and why removal is safe.
Protect observable behavior with scoped regression checks.
Prefer a smaller coherent representation over a new abstraction layer.
Do not chase arbitrary line-count goals, rewrite unrelated code or weaken
validation to make a design look simpler.
Report preserved behavior, changed boundaries and residual uncertainty.
