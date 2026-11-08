---
name: planning-and-task-breakdown
description: Use when substantial settled work needs dependency-aware tasks and explicit scenario ownership.
---
# Planning

Inspect existing implementation, plans and decisions first. State the actual
gap, scope, acceptance checks, risks and recovery needs.
Use Organic to avoid a multi-task planning pipeline for genuinely light work.

For formal work, reference the structured specification and approved design.
Split coherent deliverables with stable keys, bounded scopes, prerequisite
keys and scenarioRefs. Every assigned scenario belongs to that specification;
the union must cover it completely. Do not require unrelated future scenarios
to pass before the first dependency-ready task can close.
Every formal task must own at least one verifiable scenario. If preparation
has none, ask to agree a technical scenario or regroup the task; do not invent
requirements or accept an empty assignment.

Keep the DAG acyclic and parallel writes disjoint. Present the complete plan
and destinations for approval. Dry-run before apply; persisted PLAN is not
authorization to implement. Choose next work from current task records, not a
stale summary. A scheduler does not demonstrate actual agent execution.
