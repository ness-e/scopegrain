# Task and Continuation Data

The task lifecycle is defined by the harness policy at
`../policy/workflow.json` relative to this reference. Mutations need the
expected revision; ACT invalidates old acceptance evidence.
Plans map stable keys to task UUIDs and explicit dependencies.
Artifacts preserve decisions, research, reports and handoffs.
Sessions preserve registered operations and an explicit operation budget.
None of these records intercept native host calls or authenticate evidence.
