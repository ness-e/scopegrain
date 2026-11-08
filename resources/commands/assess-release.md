---
name: assess-release
description: Assess release readiness without publishing or deploying.
---
# Assess Release Readiness

Discover the actual release target, procedure, approvals and recovery needs.
Inspect relevant verification, independent review, compatibility, provenance
and configuration prerequisites without disclosing secret values.

Distinguish evidence of authentication from evidence of publication scope.
An unexecuted publish cannot be marked verified. A successful test is not
an approved release, and a prepared branch is not a merged pull request.

Return GO, NO-GO or blocked with reasons and the remaining authorized steps.
Prepare recovery evidence and identify irreversible effects.
Do not push, tag, publish, deploy, send notifications or change production.
