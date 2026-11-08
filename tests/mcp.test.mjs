// MCP cases: importing never connects; descriptors are read-only and share
// the same bound context as the CLI. Skipped with reason without the SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../src/core/config.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  VALID_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

const EXPECTED_TOOLS = [
  'tasksystem_inspect', 'tasksystem_status', 'tasksystem_list_tasks',
  'tasksystem_get_task', 'tasksystem_check_action',
  'tasksystem_catalog_list', 'tasksystem_catalog_get',
  'tasksystem_workflow_packet', 'tasksystem_plan_get',
  'tasksystem_plan_next', 'tasksystem_artifact_get',
  'tasksystem_session_get', 'tasksystem_session_resume',
  'tasksystem_resource_search', 'tasksystem_resource_diagnose',
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

test('descriptors are exactly 13 read-only tools bound to ctx', async (t) => {
  if (!(await depsAvailable())) {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  const { resolveContext } = await import('../src/core/context.mjs');
  const { dir, ctx } = bootstrappedCtx();
  try {
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
    // Unknown args are rejected outright, never silently redirected.
    const rejected = await get.handler({ id: task.id, project: '/etc' });
    assert.equal(rejected.isError, true);
    const res = await get.handler({ id: task.id });
    const parsed = JSON.parse(res.content[0].text);
    assert.equal(parsed.id, task.id);
    const bad = await get.handler({ id: '../escape' });
    assert.equal(bad.isError, true);
    const check = tools.find((x) => x.name === 'tasksystem_check_action');
    const ok = await check.handler({ taskId: task.id, action: 'read' });
    assert.equal(JSON.parse(ok.content[0].text).allowed, true);
  } finally { cleanup(dir); }
});

test('in-memory transport round-trip lists and calls tools', async (t) => {
  if (!(await depsAvailable())) {
    t.skip('optional MCP dependencies are not installed');
    return;
  }
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const dir = makeTempDir('mcp-transport');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const { server } = await createMCPServer({ project: dir });
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await Promise.all([
      server.connect(serverT), client.connect(clientT),
    ]);
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 13);
    assert.ok(tools.every((x) => x.annotations?.readOnlyHint === true));
    const res = await client.callTool({
      name: 'tasksystem_check_action',
      arguments: { taskId: '00000000-0000-4000-8000-000000000000', action: 'read' },
    });
    assert.equal(res.isError, true); // task does not exist -> isError, not crash
    await client.close();
    await server.close();
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
