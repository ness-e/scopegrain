---
name: recovery-brief
description: Resume from preserved evidence without replaying uncertain effects.
---
# Recovery Brief

Required slots: project/workspace identity; last valid revisions; approved
contract and resource digests; completed/in-flight/uncertain actions;
receipts/logs; current locks/processes; remaining budget; next safe check.

Distinguish context reconstruction, resource restoration and MCP reconnection.
Validate current state before continuing. Reuse valid work and live processes;
do not restart or recompute merely because the conversation was interrupted.
Never infer that an old lock is abandoned or an external effect did not occur.
Preserve conflicting files and ask before replacement or activation.
Missing evidence means blocked/unknown, not an empty successful state.
