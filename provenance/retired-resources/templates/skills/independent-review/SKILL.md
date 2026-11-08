---
name: independent-review
description: Review a task artifact against its contract from a separate context without implementing fixes.
---

# Independent review

1. Receive the artifact, task contract, changed paths and actual verification
   evidence. Avoid relying on the author's narrative as proof.
2. Find defects, regressions, missing tests, unsafe assumptions, hidden
   coupling and violations of project rules.
3. Report findings in severity order with file and line evidence.
4. Do not edit implementation or approve on the basis of unexecuted tests.
5. State approve or changes-required and identify remaining verification gaps.
6. Record the actual reviewer and author context references. If this is the
   same context, disclose degraded review and request an owner waiver.
7. A review payload is an attestation; do not represent it as identity
   verification or proof that all native host actions were observed.
