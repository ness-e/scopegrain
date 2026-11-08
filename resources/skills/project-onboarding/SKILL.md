---
name: project-onboarding
description: Investigate an unfamiliar repository and configure TaskSystem with explicit owner consent before generating artifacts.
---

# Project onboarding

1. Confirm the authorized project root and inspect existing instructions.
2. Run read-only discovery only when local command execution is authorized.
   Otherwise inspect the manifests directly and report that limitation.
3. Check architecture, package boundaries, tests, tooling, existing workflows
   and whether the requested feature already exists. Cite file evidence.
4. Separate observed facts, inferred conventions and unanswered questions.
5. Ask for the project name, documentation language and coding-agent hosts.
6. Ask separately for configuration, plans, tasks, reports, research, decisions,
   memory and runtime locations. Never assume docs/dev or a hidden directory.
7. Propose verification commands with their directory and source; do not
   execute them or copy secrets into the configuration.
8. Preview every generated file. If an instruction or host configuration
   already exists, stop and propose a reviewed merge.
9. Ask permission to create the new files. Save approved preferences for
   reuse; if configuration changes are needed later, ask again.
10. Explain what was detected automatically, what still needs semantic
    investigation and which integrations remain unverified.
