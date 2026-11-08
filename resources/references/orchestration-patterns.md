# Orchestration Patterns

Specify goal, inputs, scope, acceptance cases and authority for each role.
Parallelize only independent work with settled inputs and disjoint writes.
At fan-in inspect actual artifacts, preserve partial success and report
which dependencies remain blocked. Resume valid work before retrying it.
Fresh-context review needs real independence, not only different names.
