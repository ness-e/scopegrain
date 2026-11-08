---
name: ship
description: Evaluate delivery readiness and recovery without implicit publication
---
# Ship Readiness

Inspect the project's actual release process, target environment,
acceptance evidence, independent review, compatibility and recovery plan.
Request specialist input only for relevant risks and available capabilities.

Produce GO or NO-GO with explicit blockers, untested surfaces and the
exact proposed delivery steps. An assessment is not a deployment.
Before any push, API side effect, publication, migration or privileged
operation, obtain authorization for that specific action.

Save the decision and proposed recovery inside the harness workspace.
Never alter versions, tags, changelogs or release tooling merely because
another project used them. Missing rollback feasibility is a blocker.
