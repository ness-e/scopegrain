// Adapter rendering cases: fragments parse, args stay separated, the
// --config token is the project-relative path resolveContext accepts.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renderAdapters } from '../src/adapters/render.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const ALL_HOSTS = ['claude', 'codex', 'opencode', 'devin'];

function setup(hosts) {
  const dir = makeTempDir('adapters');
  const config = createConfig(dir, { ...VALID_ANSWERS, hosts }, {});
  const projectRoot = path.resolve(dir);
  const serverPath = path.join(projectRoot, 'tool dir', 'server.mjs');
  const configAbs = path.join(projectRoot, '.tasksystem', 'config.json');
  const out = renderAdapters(config, {
    projectRoot, configPath: configAbs,
    instructionsPath: path.join(projectRoot, '.tasksystem', 'instructions.md'),
    serverPath,
  });
  return { dir, out, serverPath, projectRoot, configAbs };
}

// Extract the argument list from a JSON or TOML fragment. TOML's args array
// uses JSON.stringify quoting, so JSON.parse on the RHS is exact.
export function argsOf(content) {
  const parsed = content.trim().startsWith('{') ? JSON.parse(content) : null;
  if (parsed) {
    const node = parsed.mcpServers?.tasksystem
      ?? parsed.mcp?.servers?.tasksystem   // OpenCode V2
      ?? parsed.mcp?.tasksystem;           // OpenCode V1 proposal
    return node.args || node.command.slice(1);
  }
  const m = content.match(/^args\s*=\s*(\[.*\])\s*$/m);
  assert.ok(m, 'TOML fragment must contain an args array');
  return JSON.parse(m[1]);
}

test('all fragments carry abs server/root and RELATIVE --config', () => {
  const { dir, out, serverPath, projectRoot } = setup(ALL_HOSTS);
  try {
    for (const f of out.files) {
      const args = argsOf(f.content);
      assert.equal(args[0], serverPath, `${f.host} server path`);
      assert.equal(args[1], '--project');
      assert.equal(args[2], projectRoot);
      assert.ok(path.isAbsolute(args[2]), `${f.host} project absolute`);
      assert.equal(args[3], '--config');
      assert.equal(args[4], '.tasksystem/config.json');
      assert.ok(!path.isAbsolute(args[4]), `${f.host} config relative`);
    }
  } finally { cleanup(dir); }
});

test('rendered args of every host resolve via resolveContext', () => {
  const { dir, out, projectRoot } = setup(ALL_HOSTS);
  try {
    const config = createConfig(projectRoot, VALID_ANSWERS, {});
    writeJson(dir, '.tasksystem/config.json', config);
    for (const f of out.files) {
      const args = argsOf(f.content);
      const ctx = resolveContext({
        project: args[args.indexOf('--project') + 1],
        config: args[args.indexOf('--config') + 1],
      });
      assert.equal(ctx.configPath, '.tasksystem/config.json', f.host);
      assert.equal(ctx.projectRoot, projectRoot, f.host);
    }
  } finally { cleanup(dir); }
});

test('host-specific shapes match documented formats', () => {
  const { dir, out } = setup(ALL_HOSTS);
  try {
    const claude = JSON.parse(out.files.find((f) => f.host === 'claude').content);
    assert.equal(claude.mcpServers.tasksystem.type, 'stdio');
    const devin = JSON.parse(out.files.find((f) => f.host === 'devin').content);
    assert.ok(!('type' in devin.mcpServers.tasksystem));
    const ocFiles = out.files.filter((f) => f.host === 'opencode');
    assert.equal(ocFiles.length, 2, 'V2 primary + preserved V1 proposal');
    const oc = JSON.parse(
      ocFiles.find((f) => f.relativePath.endsWith('opencode-mcp.json')).content);
    assert.equal(oc.mcp.servers.tasksystem.type, 'local');
    assert.equal(oc.mcp.servers.tasksystem.disabled, true);
    assert.equal(oc.mcp.servers.tasksystem.command[0], 'node');
    const ocV1 = JSON.parse(
      ocFiles.find((f) => f.relativePath.endsWith('opencode-v1-mcp.json')).content);
    assert.equal(ocV1.mcp.tasksystem.type, 'local');
    assert.equal(ocV1.mcp.tasksystem.enabled, false);
    assert.equal(ocV1.mcp.tasksystem.command[0], 'node');
    const codex = out.files.find((f) => f.host === 'codex');
    assert.ok(codex.content.includes('[mcp_servers.tasksystem]'));
    assert.ok(codex.content.includes('command = "node"'));
  } finally { cleanup(dir); }
});

test('fragments are machine-local and absolute inputs are required', () => {
  const { dir, out } = setup(['claude']);
  try {
    assert.equal(out.metadata.machineLocal, true);
    assert.ok(out.files.every((f) => f.machineLocal === true));
    const config = createConfig(dir, VALID_ANSWERS, {});
    assert.throws(() => renderAdapters(config, {
      projectRoot: 'rel', configPath: '/abs/c', serverPath: '/abs/s',
    }), (e) => e.code === 'INVALID_ADAPTER_INPUT');
    assert.throws(() => renderAdapters(config, {
      projectRoot: path.resolve(dir),
      configPath: path.join(path.resolve(dir), '..', 'outside.json'),
      serverPath: path.join(path.resolve(dir), 's.mjs'),
    }), (e) => e.code === 'INVALID_ADAPTER_INPUT'
      || e.code === 'INVALID_PATH');
  } finally { cleanup(dir); }
});
