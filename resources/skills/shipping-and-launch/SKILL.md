---
name: shipping-and-launch
description: Use to assess delivery readiness or plan recovery from a failed release
---
# Delivery and Recovery

Read the actual release process, target environment and acceptance evidence.
Identify blockers, compatibility, observability and recovery feasibility.
Produce a GO/NO-GO assessment separately from proposed executable steps.
Require action-specific approval for publication, push, deployment or data
migration; credentials must never enter reports.
For recovery inspect actual changed state; a Git revert may not undo
external side effects. Stop when a step fails and record what remains.
