---
name: systematic-debugging
description: Use when a test, command or observed behavior fails before proposing a code fix
---
# Causal Debugging

Capture the exact failure, inputs, environment and reproducible boundary.
Trace input and state through the executing path. Compare with a working
case and recent changes before ranking hypotheses.
Choose a discriminating check; agreement with a symptom is not proof.
Add a regression case and fix the smallest causal boundary.
If evidence contradicts the hypothesis, reassess rather than stacking fixes.
Report when reproduction or causal confirmation remains unavailable.
