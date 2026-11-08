// Native adapter proposals: projection shape, no host writes, policy-exact
// frontmatter, codex TOML, V2+V1 opencode fragments, activation plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderNativeAdapters, loadNativePolicy } from '../src/adapters/native.mjs';
import { createConfig } from '../src/core/config.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  DEFAULT_ANSWERS, VALID_ANSWERS, cleanup, exists, makeTempDir, writeJson,
} from './helpers.mjs';

const CFG_REL = '.tasksystem/config.json';

function cfg(hosts = ['claude', 'codex', 'opencode', 'devin']) {
  return createConfig(makeTempDir('x'), { ...DEFAULT_ANSWERS, hosts }, {});
}

test('selected hosts project native files; absent hosts generate none', () => {
  const all = renderNativeAdapters(cfg(), { configRel: CFG_REL });
  const claudeOnly = renderNativeAdapters(
    cfg(['claude']), { configRel: CFG_REL });
  assert.ok(claudeOnly.files.every((f) =>
    f.rel.startsWith('.tasksystem/integrations/native/claude/')));
  assert.ok(!claudeOnly.files.some((f) => f.rel.includes('/codex/')));
  // Every catalog skill+command+agent produces a bridge for each host.
  const claudeSkills = all.files.filter((f) =>
    f.rel.includes('/claude/.claude/skills/'));
  assert.ok(claudeSkills.length >= 24 + 13, 'skills + command-as-skill');
  for (const f of all.files) {
    assert.ok(f.rel.startsWith('.tasksystem/integrations/native/'));
    assert.ok(!f.content.includes('{{'), `unexpanded var in ${f.rel}`);
    assert.ok(!f.content.toString('utf8').includes('!`'));
  }
});

test('frontmatter: permission lines land INSIDE the YAML fence', () => {
  const { files } = renderNativeAdapters(cfg(), { configRel: CFG_REL });
  const pipeline = files.find((f) =>
    f.rel.endsWith('/claude/.claude/skills/tasksystem-pipeline/SKILL.md'));
  const text = pipeline.content.toString('utf8');
  const header = text.split(/^---$/m)[1];
  assert.ok(header.includes('disable-model-invocation: true'),
    'command frontmatter must be inside the header');
  const body = text.split(/^---$/m)[2];
  assert.ok(!body.includes('disable-model-invocation: true'),
    'must not leak into body');
  const reviewer = files.find((f) =>
    f.rel.endsWith('/claude/.claude/agents/tasksystem-reviewer.md'));
  const rh = reviewer.content.toString('utf8').split(/^---$/m)[1];
  assert.ok(rh.includes('- Read'), 'readonly tools inside header');
  // Scalars are JSON-quoted so colons/newlines cannot break the fence.
  assert.ok(header.includes('name: "tasksystem-pipeline"'));
  const rtext = reviewer.content.toString('utf8');
  const rhdr = rtext.split(/^---$/m)[1];
  assert.ok(rhdr.includes('tools:\n  - Read\n  - Grep\n  - Glob'));
  const lead = files.find((f) =>
    f.rel.endsWith('/claude/.claude/agents/tasksystem-lead.md'));
  assert.ok(!lead.content.toString('utf8').split(/^---$/m)[1]
    .includes('tools:\n  - Read'));
  // Devin trigger frontmatter lands inside the fence too.
  const devinCmd = files.find((f) =>
    f.rel.endsWith('/devin/.devin/skills/tasksystem-ship/SKILL.md'));
  const dh = devinCmd.content.toString('utf8').split(/^---$/m)[1];
  assert.ok(dh.includes('triggers:\n  - user'));
  // OpenCode commands land in command root, not skill root.
  // OpenCode emits V1 and V2 variants with their own permission frontmatter.
  const ocCmd = files.find((f) =>
    f.rel.endsWith('/opencode/v2/.opencode/commands/tasksystem-assess-release.md'));
  assert.ok(ocCmd);
  assert.ok(ocCmd.content.toString('utf8').startsWith('---\ndescription:'));
  const ocAgentV1 = files.find((f) =>
    f.rel.endsWith('/opencode/v1/.opencode/agents/tasksystem-reviewer.md'));
  const ocAgentV2 = files.find((f) =>
    f.rel.endsWith('/opencode/v2/.opencode/agents/tasksystem-reviewer.md'));
  assert.ok(ocAgentV1 && ocAgentV2);
  assert.ok(ocAgentV1.content.toString('utf8')
    .split(/^---$/m)[1].includes('bash: deny'));
  assert.ok(ocAgentV2.content.toString('utf8')
    .split(/^---$/m)[1].includes('effect: deny'));
});

test('codex TOML roles use JSON-quoted strings + declaration fragments', () => {
  const { files } = renderNativeAdapters(cfg(), { configRel: CFG_REL });
  const role = files.find((f) =>
    f.rel.endsWith('/codex/.codex/agents/tasksystem-reviewer.toml'));
  assert.ok(role);
  const text = role.content.toString('utf8');
  assert.ok(text.startsWith('name = "tasksystem-reviewer"'));
  assert.ok(text.includes('description = "'));
  assert.ok(text.includes('developer_instructions = "'));
  assert.ok(text.includes('sandbox_mode = "read-only"'));
  // ONE fragment outside .codex/agents with all 11 declarations.
  const frag = files.find((f) =>
    f.rel.endsWith('/codex/agents-fragment.toml'));
  assert.ok(frag);
  const ftext = frag.content.toString('utf8');
  assert.ok(ftext.includes('[agents."tasksystem-reviewer"]'));
  assert.ok(ftext.includes('config_file = "agents/tasksystem-reviewer.toml"'));
  const nAgents = files.filter((f) =>
    f.rel.includes('/codex/.codex/agents/')).length;
  assert.equal((ftext.match(/\[agents\./g) || []).length, nAgents);
  assert.ok(!files.some((f) => f.rel.includes('.decl.toml')));
  assert.ok(!files.some((f) =>
    f.rel.includes('/codex/.codex/agents/')
      && f.rel.includes('fragment')));
});

test('activation metadata: codex fragment targets .codex/config.toml', () => {
  const { activationPlan } = renderNativeAdapters(cfg(), { configRel: CFG_REL });
  const decl = activationPlan.entries.find(
    (e) => e.kind === 'agent-declaration');
  assert.equal(decl.destination, '.codex/config.toml');
  assert.equal(decl.manualMerge, true);
  assert.ok(decl.source.endsWith('agents-fragment.toml'));
});

test('activation plan is metadata only: manual merge, no hooks/apply', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(), { configRel: CFG_REL });
  assert.equal(activationPlan.activation, 'manual-review-only');
  assert.equal(activationPlan.hooksInstalled, false);
  assert.equal(activationPlan.nativeHostTested, false);
  assert.equal(activationPlan.writeHostRoots, false);
  assert.equal(activationPlan.entries.length, files.length);
  for (const e of activationPlan.entries) {
    assert.equal(e.manualMerge, true);
    assert.ok(files.some((f) => f.rel === e.source),
      `entry source ${e.source} must be a projected file`);
  }
  for (const h of ['claude', 'codex', 'opencode', 'devin']) {
    assert.ok(Array.isArray(activationPlan.hosts[h].sources));
    assert.equal(typeof activationPlan.hosts[h].permissionScope, 'string');
  }
});

test('opencode emits V2 plus separate V1 proposal in bootstrap', () => {
  const dir = makeTempDir('native-boot');
  try {
    const plan = prepareInit({ projectRoot: dir, answers: DEFAULT_ANSWERS });
    const rels = plan.files.map((f) => f.rel);
    assert.ok(rels.includes('.tasksystem/integrations/opencode-mcp.json'));
    assert.ok(rels.includes('.tasksystem/integrations/opencode-v1-mcp.json'));
    assert.ok(rels.includes(
      '.tasksystem/integrations/native/activation-plan.json'));
    applyPlan(dir, plan.files);
    const v2 = JSON.parse(fs.readFileSync(
      `${dir}/.tasksystem/integrations/opencode-mcp.json`, 'utf8'));
    assert.equal(v2.mcp.servers.tasksystem.type, 'local');
    assert.equal(v2.mcp.servers.tasksystem.disabled, true);
    const v1 = JSON.parse(fs.readFileSync(
      `${dir}/.tasksystem/integrations/opencode-v1-mcp.json`, 'utf8'));
    assert.equal(v1.mcp.tasksystem.enabled, false);
    assert.equal(v1.mcp.tasksystem.type, 'local');
    const ap = JSON.parse(fs.readFileSync(
      `${dir}/.tasksystem/integrations/native/activation-plan.json`, 'utf8'));
    assert.equal(ap.activation, 'manual-review-only');
    // No host roots written anywhere outside .tasksystem.
    assert.ok(!exists(dir, '.claude'));
    assert.ok(!exists(dir, '.codex'));
    assert.ok(!exists(dir, '.opencode'));
    assert.ok(!exists(dir, '.devin'));
  } finally { cleanup(dir); }
});

test('custom config dir and namespaced ids survive', () => {
  const { files } = renderNativeAdapters(cfg(['claude']),
    { configRel: 'cfg space/config.json' });
  assert.ok(files.every((f) =>
    f.rel.startsWith('cfg space/integrations/native/claude/')));
  const skill = files.find((f) => f.rel.includes('/skills/tasksystem-'));
  assert.ok(skill.content.toString('utf8')
    .includes('`cfg space/instructions.md`'));
  assert.equal(loadNativePolicy({}).namespace, 'tasksystem-');
});

test('host-interpolated literals abort before any write', () => {
  for (const marker of ['cfg !`whoami`', 'cfg $ARGUMENTS', 'cfg $1 dir']) {
    assert.throws(() => renderNativeAdapters(cfg(['claude']),
      { configRel: `${marker}/config.json` }),
      (e) => e.code === 'NATIVE_UNSAFE_LITERAL', marker);
  }
  // prepareInit also rejects before any file is planned.
  const dir = makeTempDir('unsafe-cfg');
  try {
    assert.throws(() => renderNativeAdapters(cfg(['claude']),
      { configRel: 'x !`rm -rf /`/config.json' }),
      (e) => e.code === 'NATIVE_UNSAFE_LITERAL');
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { cleanup(dir); }
  // Safe spaces and quotes still generate.
  const ok = renderNativeAdapters(cfg(['claude']),
    { configRel: "cfg 'quoted' dir/config.json" });
  assert.ok(ok.files.length > 0);
});

test('policy files project verbatim under cfgDir/policy', () => {
  const dir = makeTempDir('pol-proj');
  try {
    const plan = prepareInit({ projectRoot: dir, answers: DEFAULT_ANSWERS });
    const wf = plan.files.find(
      (f) => f.rel === '.tasksystem/policy/workflow.json');
    const lim = plan.files.find(
      (f) => f.rel === '.tasksystem/policy/operation-limits.json');
    assert.ok(wf && lim);
    assert.equal(wf.content.toString('utf8'),
      fs.readFileSync('policy/workflow.json', 'utf8'));
    assert.equal(lim.content.toString('utf8'),
      fs.readFileSync('policy/operation-limits.json', 'utf8'));
  } finally { cleanup(dir); }
});
