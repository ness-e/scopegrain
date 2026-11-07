---
title: Native host projections and their limits
kind: guide
---
# Native Host Projections

TaskSystem keeps canonical procedures in its own workspace. Native
integrations are thin, generated bridges, not four manually maintained
copies. The namespace `tasksystem-` avoids overriding built-in commands.

## Confirmed formats

Official documentation and repository sources were consulted during this
migration. This confirms documented formats, not in-product certification.

| Host | Command bridge | Skills | Roles |
| --- | --- | --- | --- |
| Claude Code | `/tasksystem-NAME` skill | `.claude/skills/<name>/SKILL.md` | `.claude/agents/<name>.md` |
| Codex | `$tasksystem-NAME` skill | `.agents/skills/<name>/SKILL.md` | `.codex/agents/*.toml` with an explicit configuration declaration |
| OpenCode V2 | `/tasksystem-NAME` | `.opencode/skills/<name>/SKILL.md` | `.opencode/agents/<name>.md` |
| Devin CLI/Local | `/tasksystem-NAME` skill | `.devin/skills/<name>/SKILL.md` | `.devin/agents/<name>.md` |

Sources:

- [Claude skills](https://code.claude.com/docs/en/skills) and
  [subagents](https://code.claude.com/docs/en/sub-agents).
- Codex official implementation:
  [skill discovery](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/host_roots.rs),
  [role loading](https://github.com/openai/codex/blob/main/codex-rs/agent-roles/src/loader.rs)
  and [role tests](https://github.com/openai/codex/blob/main/codex-rs/core/src/agent/role_tests.rs).
  The public skills documentation returned HTTP 403 during this check;
  the official repository was used instead.
- OpenCode [commands](https://opencode.ai/docs/commands/),
  [agents](https://opencode.ai/docs/agents/) and
  [MCP](https://opencode.ai/docs/mcp-servers/).
- Devin [skills](https://docs.devin.ai/cli/extensibility/skills/creating-skills.md),
  [subagents](https://docs.devin.ai/cli/subagents.md) and
  [MCP configuration](https://docs.devin.ai/cli/extensibility/mcp/configuration.md).

## Activation boundary

Initialization creates proposals below its own configuration directory,
not active host roots. The activation plan identifies source, intended
destination, resource and any manual merge requirement. Review the
installed host version and existing definitions before copying or merging.
TaskSystem does not auto-merge host settings, install hooks or plugins,
grant tool approval, start services, or register external servers.

Codex role declarations are grouped in `agents-fragment.toml`, outside
the proposed `.codex/agents/` directory. Its activation destination is
`.codex/config.toml` and requires a manual merge; the fragment is not
another discoverable role.

Keep the canonical configuration/catalog/resources available wherever
bridges are activated. Copying a bridge alone is insufficient.
The same procedures remain available through the portable CLI without
native registration.

## Permission differences

Selected read-only roles receive tool restrictions in Claude/Devin,
filesystem sandbox configuration in Codex, or edit/shell denial in
OpenCode V2. These are distinct scopes, not equivalent security guarantees.
Other roles inherit the owner's native policy; no approval bypass is added.

Devin skill `allowed-tools` auto-approves tools rather than restricting
them. Only custom subagent `allowed-tools` is an availability restriction.
The generated inline skills therefore do not set it.
Devin custom subagent format is documented as experimental.

OpenCode V2 uses `permissions` lists, `mcp.servers` and `disabled`;
V1 used different fields. A V1 MCP fragment is retained separately as a
legacy proposal; never merge both variants blindly. The V2 proposal is
disabled until the owner chooses to activate it.

No shell interpolation blocks, provider/model pins, global hooks,
credentials or personal configuration are copied into native bridges.
Namespaced wrappers intentionally do not replace the original slash names.
Configuration paths with known host-interpolated markers are rejected
before writes instead of guessing an escaping scheme.
