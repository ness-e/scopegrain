---
name: rollback
description: Prepare recovery from observed delivery state with action-specific consent
---
# Recovery of Delivery

Identify what actually changed, the last known-good state, affected data
and the original delivery plan. Do not assume that reverting Git reverses
external state, database writes or published artifacts.

Propose exact reversible steps, preconditions, backups and postchecks.
Explicitly identify irreversible data loss or incompatible migrations.
Obtain action-specific approval before executing recovery operations.
If a step fails, stop and report completed versus pending operations.
Record the outcome without overwriting historical evidence.
