---
title: Native host projections and limits
kind: guide
---
# Native Host Projections

TaskSystem shares canonical procedures and project snapshots across five
hosts. Native files are thin bridges, not five independently maintained
implementations. The `tasksystem-` namespace avoids replacing built-ins.

## Status

Documented formats and local fixture tests are not native certification.
No host was activated by these changes. Initialization creates proposals
under the selected configuration directory, normally
`.tasksystem/integrations/`; intended active paths below are NOT written
automatically.

| Host | Invocation proposal | Intended skill path | Intended role path |
| --- | --- | --- | --- |
| Claude Code | `/tasksystem-NAME` | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| Codex | `$tasksystem-NAME` | `.agents/skills/<name>/SKILL.md` | `.codex/agents/*.toml` plus declarations |
| OpenCode V1/V2 | `/tasksystem-NAME` | `.opencode/skills/<name>/SKILL.md` | `.opencode/agents/<name>.md`, variant-specific |
| Devin CLI/Local | `/tasksystem-NAME` | `.devin/skills/<name>/SKILL.md` | `.devin/agents/<name>.md` |
| Antigravity App/CLI | `/tasksystem-NAME` | `.agents/skills/<name>/SKILL.md` | `.agents/agents/<name>.md` |
| Antigravity IDE | `/tasksystem-NAME` | `.agents/skills/<name>/SKILL.md` | None assumed; skills-only proposal |

OpenCode native command bridges additionally target `.opencode/commands/`.
Commands, skills and roles still refer to the same configured canonical
resources and runtime. Copying a bridge without its project configuration
and snapshot is insufficient.

## Explicit Variants

OpenCode V1 and V2 are separate proposals. V1 uses `permission` and its
own MCP shape; V2 uses `permissions`, `mcp.servers` and `disabled`.
Select from the installed version and inspect the corresponding activation
plan. Never merge both formats or assume a V2 example works on V1.

Antigravity App/CLI and IDE are separate surfaces. The App/CLI proposal
includes documented custom agents; the IDE proposal does not infer that
capability. MCP remains disabled in the generated `mcp_config.json`
proposal, with actual selected installation/project values, pending manual
review. No automatic agent, workflow or MCP installation occurs.

Codex role declarations are collected outside discoverable role files in
`agents-fragment.toml`; the proposed `.codex/config.toml` destination needs
a manual merge. Role loading and discovery depend on the installed version.

The `.agents/` convention is shared by products. A namespaced file there
can still be discovered by more than one host; it is not product isolation.

## Permissions And Models

Selected read-only roles receive host-specific restrictions:

- Claude: requested read-tool list.
- Codex: requested read-only filesystem sandbox.
- OpenCode: V1 edit/bash/task denial or V2 edit/shell/subagent denial.
- Devin: custom subagent tool allowlist.
- Antigravity App/CLI: requested documented read-tool list; IDE has no
  custom-agent restriction proposal because agents are not assumed there.

These scopes are not equivalent guarantees. Validate actual tool names,
effective denial, MCP side effects and organization policy inside the host.
Other roles inherit the owner's native policy; model prompts are not a
sandbox or a substitute for native permission enforcement.

Devin inline skill `allowed-tools` grants auto-approval rather than
restricting availability. Generated inline skills deliberately omit it.
Only the documented custom subagent field is treated as an availability
allowlist, and that custom-agent interface is experimental. A child that
cannot ask the user must return a blocker to the lead, not fabricate consent.
Devin Cloud behavior is not certified by CLI/Local fixtures.

Models remain under host policy or an explicit owner choice. No universal
provider, model identifier, cost estimate or paid call is selected by
TaskSystem. Availability, router behavior and billing are host-dependent.

## Activation And Recovery

Inspect the complete generated activation plan, source, destination,
version/surface and existing settings. Activation requires specific approval
for that fixture/project and any associated tools, models, network or cost.
Initialization does not install hooks/plugins, alter active host roots,
grant auto-approval, register external servers or start MCP.

MCP configuration is machine-local. Relocation can leave absolute paths
pointing to the old project or installation; `doctor` reports that condition.
Rebinding requires review of the new destination, not silent replacement.
Resource restoration only recovers compatible missing canonical bytes; it
does not overwrite divergent files or reconnect a remote MCP service.

The portable CLI works without native registration. Its project-bound MCP
server is an optional stdio query surface, not a mutating remote executor.
See [onboarding](onboarding.md), [security](security.md) and
[verification](verification.md).

## Native Pilot Still Required

For each selected version/surface, separately approve an isolated pilot:
verify discovery and invocation, actual role tools and write denials,
unapproved MCP/network effects, delegation, interruption/resumption,
recovery without repeating effects and cleanup of only approved owned
configuration. Keep transcripts, actual versions, logs and full diffs.
Success on one host or surface does not certify another.

## Sources

The implementation contracts are
[native adapters](../policy/native-adapters.json) and
[native variants](../policy/native-variants.json).
Official sources consulted during the migration:

- Claude [skills](https://code.claude.com/docs/en/skills) and
  [subagents](https://code.claude.com/docs/en/sub-agents).
- Codex official [skill discovery](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs)
  and [role loader](https://github.com/openai/codex/blob/main/codex-rs/agent-roles/src/loader.rs).
- OpenCode [commands](https://opencode.ai/docs/commands/),
  [agents](https://opencode.ai/docs/agents/),
  [MCP](https://opencode.ai/docs/mcp-servers/) and
  [versioned migration source](https://github.com/anomalyco/opencode/blob/v2.1.2/services/www/src/docs/content/migrate-v1.mdx).
- Devin [skills](https://docs.devin.ai/cli/extensibility/skills/creating-skills.md),
  [subagents](https://docs.devin.ai/cli/subagents.md) and
  [MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration.md).
- Antigravity [skills](https://antigravity.google/docs/skills),
  [subagents](https://antigravity.google/docs/subagents),
  [MCP](https://antigravity.google/docs/mcp) and
  [IDE workflows](https://antigravity.google/docs/ide/workflows).
