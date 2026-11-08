---
name: plan-recovery
description: Prepare a recovery plan from observed state without applying it.
---
# Plan Recovery

Identify the incident, desired safe state, actual completed effects and
available receipts/backups. Do not infer external state from local progress.
Inspect which data, registries or deployments a source revert would not undo.

Propose bounded steps, prerequisites, backup preservation, verification,
abort conditions and actions that need explicit permission.
Reconcile uncertain effects before retrying. Never delete a stale lock
or restore over existing content merely because its age looks suspicious.

Present exact destinations and consequences for approval. This command
only prepares a plan; execution, deletion and external rollback require
separate action-specific authorization.
