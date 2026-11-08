# Regression and Boundary Cases

Useful cases exercise the original failure, empty/invalid inputs, duplicate
operations, stale revisions, links, partial writes and concurrent ownership
where relevant. Negative cases should assert no unauthorized side effects.
Use owned disposable fixtures and deterministic expectations.
Do not weaken product behavior to compensate for a broken test fixture.
