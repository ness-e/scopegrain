// MCP cases: importing never connects; descriptors are read-only and share
// the same bound context as the CLI. Skipped with reason without the SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const EXPECTED_TOOLS = [
  'tasksystem_inspect', 'tasksystem_status', 'tasksystem_list_tasks',
  'tasksystem_get_task', 'tasksystem_check_action',
];

async function depsAvailable() {
  try {
    await import('@modelcontextprotocol/sdk/server/mcp.js');
    await import('zod');
    return true;
  } catch {
    return false;
  }
}

test('importing server.mjs does not start a server or require deps', async () => {
  const mod = await import('../src/mcp/server.mjs');
  assert.equal(typeof mod.startMCPServer, 'function');
  assert.equal(typeof mod.createMCPServer, 'function');
  assert.equal(typeof mod.createMCPTools, 'function');
});

test('descriptors are exactly five read-only tools bound to ctx', async (t) => {
  if (!(await depsAvailable())) {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { resolveContext } = await import('../src/core/context.mjs');
  const dir = makeTempDir('mcp-tools');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const ctx = resolveContext({ project: dir });
    const tools = createMCPTools(ctx, z);
    assert.deepEqual(tools.map((x) => x.name).sort(), [...EXPECTED_TOOLS].sort());
    for (const tool of tools) {
      assert.equal(tool.config.annotations.readOnlyHint, true);
      assert.equal(tool.config.annotations.destructiveHint, false);
    }
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const get = tools.find((x) => x.name === 'tasksystem_get_task');
    const res = await get.handler({ id: task.id, project: '/etc' });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.id, task.id); // extra path arg cannot redirect
    const bad = await get.handler({ id: '../escape' });
    assert.equal(bad.isError, true);
    const check = tools.find((x) => x.name === 'tasksystem_check_action');
    const ok = await check.handler({ taskId: task.id, action: 'read' });
    assert.equal(JSON.parse(ok.content[0].text).allowed, true);
  } finally { cleanup(dir); }
});

test('createMCPServer registers all tools without connecting', async (t) => {
  if (!(await depsAvailable())) {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const dir = makeTempDir('mcp-server');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const { server, ctx } = await createMCPServer({ project: dir });
    assert.ok(server);
    assert.equal(ctx.projectRoot, dir);
  } finally { cleanup(dir); }
});
