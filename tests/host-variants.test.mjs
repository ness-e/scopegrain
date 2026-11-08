// Host variants: opencode V1/V2 dirs, antigravity app-cli/ide, emitAgents,
// selectionRequired metadata, no host-root writes, alias bridges.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderNativeAdapters } from '../src/hosts/native.mjs';
import { createConfig } from '../src/core/config.mjs';
import { KNOWN_HOSTS } from '../src/core/config.mjs';
import { DEFAULT_ANSWERS, cleanup, makeTempDir } from './helpers.mjs';

const CFG = '.tasksystem/config.json';

function cfg(hosts) {
  return createConfig(makeTempDir('h'),
    { ...DEFAULT_ANSWERS, hosts }, {});
}

test('opencode emits v1+v2 variant dirs with their own permission fm', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['opencode']), { configRel: CFG });
  const v1 = files.find((f) => f.rel.includes('/opencode/v1/'));
  const v2 = files.find((f) => f.rel.includes('/opencode/v2/'));
  assert.ok(v1 && v2);
  const v1agent = files.find((f) =>
    f.rel.includes('/opencode/v1/') && f.rel.endsWith('reviewer.md'));
  const v2agent = files.find((f) =>
    f.rel.includes('/opencode/v2/') && f.rel.endsWith('reviewer.md'));
  assert.ok(v1agent.content.toString('utf8').includes('bash: deny'));
  assert.ok(v2agent.content.toString('utf8').includes('effect: deny'));
  const ve = activationPlan.entries.filter((e) => e.host === 'opencode');
  assert.ok(ve.every((e) => e.selectionRequired === true));
  assert.ok(ve.some((e) => e.variant === 'v1')
    && ve.some((e) => e.variant === 'v2'));
  assert.ok(ve.every((e) => e.compatibility === 'documented-only'));
});

test('antigravity: app-cli emits agents, ide skills-only, mcp proposal', () => {
  const { files, activationPlan } = renderNativeAdapters(
    cfg(['antigravity']),
    { configRel: CFG, projectRoot: makeTempDir('ag') });
  assert.ok(KNOWN_HOSTS.includes('antigravity'));
  const cliAgent = files.find((f) =>
    f.rel.includes('/antigravity/app-cli/')
      && f.rel.endsWith('tasksystem-reviewer.md'));
  assert.ok(cliAgent, 'app-cli must emit agents');
  const fm = cliAgent.content.toString('utf8').split(/^---$/m)[1];
  assert.ok(fm.includes('view_file'));
  assert.ok(!files.some((f) =>
    f.rel.includes('/antigravity/ide/')
      && f.rel.includes('/agents/tasksystem-')),
    'ide variant must not emit agents');
  const mcp = files.find((f) =>
    f.rel.endsWith('/antigravity/.agents/mcp_config.json'));
  assert.ok(mcp);
  const mcpJson = JSON.parse(mcp.content.toString('utf8'));
  assert.equal(mcpJson.mcpServers.tasksystem.disabled, true);
  assert.ok(activationPlan.entries.some(
    (e) => e.destination === '.agents/mcp_config.json' && e.manualMerge));
});

test('codex TOML includes name; alias bridges exist per alias id', () => {
  const { files } = renderNativeAdapters(cfg(['codex', 'claude']),
    { configRel: CFG });
  const role = files.find((f) =>
    f.rel.endsWith('/codex/.codex/agents/tasksystem-reviewer.toml'));
  assert.ok(role.content.toString('utf8')
    .includes('name = "tasksystem-reviewer"'));
  const alias = files.find((f) =>
    f.rel.includes('/claude/') && f.rel.includes('tasksystem-pipeline'));
  assert.ok(alias, 'alias bridge for pipeline must exist');
  const ab = alias.content.toString('utf8');
  assert.ok(ab.split(/^---$/m)[1].includes('tasksystem-pipeline'));
});

test('all outputs confined to cfgDir; no host roots written', () => {
  const dir = makeTempDir('conf');
  const { files } = renderNativeAdapters(
    createConfig(dir, { ...DEFAULT_ANSWERS, hosts: KNOWN_HOSTS }, {}),
    { configRel: CFG, projectRoot: dir });
  for (const f of files) {
    assert.ok(f.rel.startsWith('.tasksystem/integrations/native/'),
      f.rel);
  }
  for (const root of ['.claude', '.codex', '.opencode', '.devin', '.agents']) {
    assert.ok(!fs.existsSync(`${dir}/${root}`));
  }
  cleanup(dir);
});
