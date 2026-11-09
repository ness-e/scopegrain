// C2-E MCP: direct descriptors and real in-memory protocol transport only.
// No stdio startup, processes or external services. All fixture execution/
// identity claims remain synthetic declarations, not verified facts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getSpecification } from '../src/core/specifications.mjs';
import { getApproval } from '../src/core/approvals.mjs';
import { getArtifact, prepareArtifact } from '../src/core/artifacts.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { checkMethodology } from '../src/core/methodology.mjs';
import { taskFilePath } from '../src/core/tasks.mjs';
import { formalFixture, outcome, seedState } from './methodology-fixtures.mjs';
import { cleanup } from './helpers.mjs';

const MISSING = '00000000-0000-4000-8000-000000000000';
const OLD_NAMES = [
  'tasksystem_inspect', 'tasksystem_status', 'tasksystem_list_tasks',
  'tasksystem_get_task', 'tasksystem_check_action', 'tasksystem_catalog_list',
  'tasksystem_catalog_get', 'tasksystem_workflow_packet', 'tasksystem_plan_get',
  'tasksystem_plan_next', 'tasksystem_artifact_get', 'tasksystem_session_get',
  'tasksystem_session_resume', 'tasksystem_resource_search', 'tasksystem_resource_diagnose',
];
const NEW_NAMES = [
  'tasksystem_specification_get', 'tasksystem_approval_get', 'tasksystem_methodology_check',
];
function filesAndBytes(root) {
  const out = {};
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      out[rel] = st.isDirectory() ? 'directory'
        : st.isSymbolicLink() ? `link:${fs.readlinkSync(abs)}`
          : fs.readFileSync(abs);
      if (st.isDirectory()) walk(abs, rel);
    }
  }
  walk(root);
  return out;
}
async function readonly(f, operation) {
  const before = filesAndBytes(f.dir);
  try { return await operation(); }
  finally { assert.deepEqual(filesAndBytes(f.dir), before); }
}
function parsed(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}
function ownError(result, code) {
  assert.equal(result.isError, true);
  const payload = JSON.parse(result.content[0].text);
  assert.equal(payload.code, code);
  assert.equal(typeof payload.message, 'string');
  return payload;
}
async function descriptors(f) {
  const { z } = await import('zod');
  const { createMCPTools } = await import('../src/mcp/server.mjs');
  return createMCPTools(f.ctx, z);
}
async function withWire(f, body) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const { server } = await createMCPServer({ project: f.dir });
  const client = new Client({ name: 'c2e-test', version: '0.0.0' });
  try {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverT), client.connect(clientT)]);
    await body(client);
  } finally {
    try { await client.close(); }
    finally { await server.close(); }
  }
}
function namesContract(tools) {
  assert.equal(tools.length, 18);
  assert.equal(new Set(tools.map((t) => t.name)).size, 18);
  assert.deepEqual(tools.map((t) => t.name).sort(), [...OLD_NAMES, ...NEW_NAMES].sort());
  assert.deepEqual(tools.filter((t) => !OLD_NAMES.includes(t.name)).map((t) => t.name).sort(),
    [...NEW_NAMES].sort());
  for (const t of tools) {
    assert.doesNotMatch(t.name, /create|answer|apply|mutate|assess/);
    const annotations = t.config?.annotations ?? t.annotations;
    assert.deepEqual(annotations, {
      readOnlyHint: true, destructiveHint: false, openWorldHint: false,
    });
  }
}

test('server import remains lazy and cannot implicitly start stdio', async () => {
  // Static dependency/guard regression checks complement importing without
  // calling startMCPServer. No subprocess or hidden actual-server startup.
  const source = fs.readFileSync(new URL('../src/mcp/server.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import .*from ['"](?:@modelcontextprotocol|zod)/m);
  assert.match(source, /if \(invokedAs && invokedAs === fileURLToPath\(import\.meta\.url\)\)/);
  const mod = await import('../src/mcp/server.mjs');
  assert.equal(typeof mod.createMCPTools, 'function');
  assert.equal(typeof mod.createMCPServer, 'function');
  assert.equal(typeof mod.startMCPServer, 'function');
});

test('descriptors are exact18, only three additions with lead-authored literal metadata', async () => {
  const f = formalFixture();
  try {
    const tools = await descriptors(f);
    namesContract(tools);
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const [name, description, fields] of [
      ['tasksystem_specification_get',
        'Read a structured specification by UUID for the bound project.',
        { id: 'structured specification UUID' }],
      ['tasksystem_approval_get',
        'Read a stored content-bound approval by SHA-256 ID.',
        { id: 'approval SHA-256 ID' }],
      ['tasksystem_methodology_check',
        'Check declared methodology gates for ACT or ACCEPT without writing.',
        { taskId: 'task UUID', to: 'methodology gate to inspect; defaults to ACT',
          outcomeEvidenceId: 'optional outcome report UUID for an ACCEPT preview' }],
    ]) {
      const tool = byName.get(name);
      assert.equal(tool.config.description, description);
      assert.deepEqual(Object.keys(tool.config.inputSchema).sort(), Object.keys(fields).sort());
      for (const [key, label] of Object.entries(fields)) {
        assert.equal(tool.config.inputSchema[key].description, label);
      }
    }
  } finally { cleanup(f.dir); }
});

test('direct new handlers return core values and generic artifact_get reads actual typed design without writing', async () => {
  const f = formalFixture();
  try {
    const tools = new Map((await descriptors(f)).map((t) => [t.name, t]));
    const cases = [
      ['tasksystem_specification_get', { id: f.spec.artifact.id },
        getSpecification(f.ctx, f.spec.artifact.id)],
      ['tasksystem_approval_get', { id: f.approvals.spec.approval.id },
        getApproval(f.ctx, f.approvals.spec.approval.id)],
      ['tasksystem_methodology_check', { taskId: f.task.id },
        checkMethodology(f.ctx, { taskId: f.task.id })],
      ['tasksystem_artifact_get', { kind: 'design', id: f.design.artifact.id },
        getArtifact(f.ctx, 'design', f.design.artifact.id)],
    ];
    for (const [name, args, expected] of cases) {
      const result = await readonly(f, () => tools.get(name).handler(args));
      assert.deepEqual(parsed(result), expected);
    }
    // Explicitly labeled synthetic REVIEW state; the CLI suite covers actual
    // transitions. No assertion that fixture checks/reviewer were executed.
    f.task = seedState(f, f.task);
    const report = outcome(f);
    const opts = { taskId: f.task.id, to: 'ACCEPT', outcomeEvidenceId: report.artifact.id };
    const result = await readonly(f, () => tools.get('tasksystem_methodology_check').handler(opts));
    assert.deepEqual(parsed(result), checkMethodology(f.ctx, opts));
    assert.equal(parsed(result).allowed, true);
  } finally { cleanup(f.dir); }
});

test('structured specification MCP read rejects actual legacy V1 spec, direct and wire', async () => {
  const f = formalFixture();
  try {
    const legacy = prepareArtifact(f.ctx, 'spec', {
      title: 'Legacy generic spec', body: 'Unstructured V1 body',
    });
    applyPlan(f.dir, [legacy.file]);
    assert.equal(getArtifact(f.ctx, 'spec', legacy.artifact.id).schemaVersion, 1);
    const tools = await descriptors(f);
    const tool = tools.find((x) => x.name === 'tasksystem_specification_get');
    ownError(await readonly(f, () => tool.handler({ id: legacy.artifact.id })),
      'SPEC_STRUCTURED_REQUIRED');
    await withWire(f, async (client) => {
      ownError(await readonly(f, () => client.callTool({
        name: tool.name, arguments: { id: legacy.artifact.id },
      })), 'SPEC_STRUCTURED_REQUIRED');
    });
  } finally { cleanup(f.dir); }
});

test('direct tools reject redirect/extra keys and invalid core DTOs with existing JSON error shape', async () => {
  const f = formalFixture();
  const other = formalFixture();
  try {
    const tools = new Map((await descriptors(f)).map((t) => [t.name, t]));
    for (const [name, args] of [
      ['tasksystem_specification_get', { id: f.spec.artifact.id }],
      ['tasksystem_approval_get', { id: f.approvals.spec.approval.id }],
      ['tasksystem_methodology_check', { taskId: f.task.id }],
    ]) {
      for (const key of ['project', 'config', 'path', 'extra']) {
        ownError(await readonly(f, () => tools.get(name).handler({
          ...args, [key]: other.dir,
        })), 'INVALID_ARGS');
      }
    }
    for (const [name, args, code] of [
      ['tasksystem_specification_get', {}, 'INVALID_ID'],
      ['tasksystem_specification_get', { id: '../bad' }, 'INVALID_ID'],
      ['tasksystem_specification_get', { id: MISSING }, 'ARTIFACT_NOT_FOUND'],
      ['tasksystem_specification_get', { id: other.spec.artifact.id }, 'ARTIFACT_NOT_FOUND'],
      ['tasksystem_approval_get', {}, 'APPROVAL_INVALID'],
      ['tasksystem_approval_get', { id: 'invalid' }, 'APPROVAL_INVALID'],
      ['tasksystem_approval_get', { id: '0'.repeat(64) }, 'APPROVAL_NOT_FOUND'],
      ['tasksystem_methodology_check', {}, 'INVALID_ID'],
      ['tasksystem_methodology_check', { taskId: f.task.id, to: 'VERIFY' }, 'INVALID_STATE'],
      ['tasksystem_methodology_check', { taskId: MISSING }, 'TASK_NOT_FOUND'],
      ['tasksystem_methodology_check', { taskId: '../escape' }, 'INVALID_ID'],
      ['tasksystem_methodology_check', { taskId: f.task.id, outcomeEvidenceId: MISSING }, 'INVALID_ARGS'],
    ]) {
      ownError(await readonly(f, () => tools.get(name).handler(args)), code);
    }
    fs.writeFileSync(taskFilePath(f.ctx, f.task.id), '{malformed');
    ownError(await readonly(f, () =>
      tools.get('tasksystem_methodology_check').handler({ taskId: f.task.id })), 'TASK_MALFORMED');
  } finally { cleanup(other.dir); cleanup(f.dir); }
});

test('blocked methodology is an ordinary allowed:false response, direct and wire', async () => {
  const f = formalFixture({ approved: false });
  try {
    const tools = await descriptors(f);
    const tool = tools.find((t) => t.name === 'tasksystem_methodology_check');
    const args = { taskId: f.task.id };
    const direct = parsed(await readonly(f, () => tool.handler(args)));
    assert.equal(direct.allowed, false);
    assert.ok(direct.issues.some((i) => i.code === 'APPROVAL_NOT_FOUND'));
    await withWire(f, async (client) => {
      const result = await readonly(f, () => client.callTool({ name: tool.name, arguments: args }));
      assert.deepEqual(parsed(result), direct);
    });
  } finally { cleanup(f.dir); }
});

test('wire registers exact18 strict tools, reads bound records and ACCEPT locator without any writes', async () => {
  const f = formalFixture();
  try {
    f.task = seedState(f, f.task); // SYNTHETIC declared REVIEW fixture only
    const report = outcome(f);
    await withWire(f, async (client) => {
      const listed = await readonly(f, () => client.listTools());
      namesContract(listed.tools);
      for (const tool of listed.tools.filter((t) => NEW_NAMES.includes(t.name))) {
        assert.equal(tool.inputSchema.additionalProperties, false);
      }
      for (const [name, args, expected] of [
        ['tasksystem_specification_get', { id: f.spec.artifact.id },
          getSpecification(f.ctx, f.spec.artifact.id)],
        ['tasksystem_approval_get', { id: f.approvals.spec.approval.id },
          getApproval(f.ctx, f.approvals.spec.approval.id)],
        ['tasksystem_methodology_check', { taskId: f.task.id },
          checkMethodology(f.ctx, { taskId: f.task.id })],
        ['tasksystem_methodology_check', { taskId: f.task.id, to: 'ACCEPT',
          outcomeEvidenceId: report.artifact.id },
        checkMethodology(f.ctx, { taskId: f.task.id, to: 'ACCEPT',
          outcomeEvidenceId: report.artifact.id })],
        ['tasksystem_artifact_get', { kind: 'design', id: f.design.artifact.id },
          getArtifact(f.ctx, 'design', f.design.artifact.id)],
      ]) {
        const result = await readonly(f, () => client.callTool({ name, arguments: args }));
        assert.deepEqual(parsed(result), expected);
      }
    });
  } finally { cleanup(f.dir); }
});

test('wire rejects unknown path/config/project, invalid enums/missing keys and returns core errors unchanged', async () => {
  const f = formalFixture();
  try {
    await withWire(f, async (client) => {
      for (const [name, valid] of [
        ['tasksystem_specification_get', { id: f.spec.artifact.id }],
        ['tasksystem_approval_get', { id: f.approvals.spec.approval.id }],
        ['tasksystem_methodology_check', { taskId: f.task.id }],
      ]) {
        const cases = [{}, ...['project', 'config', 'path', 'extra'].map((k) => ({
          ...valid, [k]: 'untrusted-redirection',
        }))];
        if (name === 'tasksystem_methodology_check') cases.push({ ...valid, to: 'VERIFY' });
        for (const args of cases) {
          const result = await readonly(f, () => client.callTool({ name, arguments: args }));
          assert.equal(result.isError, true);
          // SDK validation text is NOT our JSON errorResult payload.
          assert.match(result.content[0].text, /Input validation error/);
        }
      }
      for (const [name, args, code] of [
        ['tasksystem_specification_get', { id: MISSING }, 'ARTIFACT_NOT_FOUND'],
        ['tasksystem_specification_get', { id: '../bad' }, 'INVALID_ID'],
        ['tasksystem_approval_get', { id: 'bad' }, 'APPROVAL_INVALID'],
        ['tasksystem_approval_get', { id: '0'.repeat(64) }, 'APPROVAL_NOT_FOUND'],
        ['tasksystem_methodology_check', { taskId: MISSING }, 'TASK_NOT_FOUND'],
        ['tasksystem_methodology_check', {
          taskId: f.task.id, to: 'ACCEPT', outcomeEvidenceId: '../bad',
        }, 'INVALID_ARGS'],
      ]) {
        ownError(await readonly(f, () => client.callTool({ name, arguments: args })), code);
      }
      fs.writeFileSync(taskFilePath(f.ctx, f.task.id), '{broken');
      ownError(await readonly(f, () => client.callTool({
        name: 'tasksystem_methodology_check', arguments: { taskId: f.task.id },
      })), 'TASK_MALFORMED');
    });
  } finally { cleanup(f.dir); }
});
