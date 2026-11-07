// Workflow packet cases: resolution, modes, hosts, profiles, read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeJson,
} from './helpers.mjs';

function ctxFixture() {
  const dir = makeTempDir('wf');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  return { dir, ctx };
}

test('command packet resolves declared resources and modes', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const p = buildWorkflowPacket(ctx, { command: 'pipeline' });
    assert.equal(p.command.id, 'pipeline');
    assert.equal(p.command.mode, 'plan'); // first declared mode
    for (const group of ['agents', 'skills', 'rules', 'references']) {
      assert.ok(p.resources[group].length > 0, group);
      for (const r of p.resources[group]) {
        assert.ok(!r.path.startsWith('templates/'),
          'paths are generated config-relative');
        assert.ok(typeof r.content === 'string' && r.content.length > 0);
      }
    }
    assert.equal(p.capabilities.executesProjectCommands, false);
    assert.equal(p.capabilities.executesAgent, false);
    assert.equal(p.task, null);
  } finally { cleanup(dir); }
});

test('mode/host/profile validation happens before writes', () => {
  const { dir, ctx } = ctxFixture();
  try {
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'nope',
    }), (e) => e.code === 'INVALID_MODE');
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', host: 'ghost',
    }), (e) => e.code === 'INVALID_HOST');
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: 'status', profile: 'bogus',
    }), (e) => e.code === 'CATALOG_UNKNOWN_ID');
    assert.throws(() => buildWorkflowPacket(ctx, {
      command: '../etc',
    }), (e) => e.code === 'CATALOG_UNKNOWN_ID'
      || e.code === 'INVALID_PATH');
    const ok = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', host: 'claude', profile: 'web',
    });
    assert.equal(ok.profile.id, 'web');
    assert.equal(ok.host, 'claude');
  } finally { cleanup(dir); }
});

test('core profile dependencies always supplement the selected profile', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const core = buildWorkflowPacket(ctx, {
      command: 'status', profile: 'core',
    });
    const web = buildWorkflowPacket(ctx, {
      command: 'status', profile: 'web',
    });
    const coreSkills = new Set(core.resources.skills.map((r) => r.id));
    const webSkills = new Set(web.resources.skills.map((r) => r.id));
    for (const id of coreSkills) {
      assert.ok(webSkills.has(id),
        `core skill ${id} must survive in web packet`);
    }
  } finally { cleanup(dir); }
});

test('task context supplies state and allowed actions', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const p = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    });
    assert.equal(p.task.id, task.id);
    assert.equal(p.task.state, 'PLAN');
    assert.ok(p.allowedActions.includes('read'));
    transitionTask(ctx, { id: task.id, to: 'ACT', expectedRevision: 0 });
    const p2 = buildWorkflowPacket(ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    });
    assert.ok(p2.allowedActions.includes('edit'));
  } finally { cleanup(dir); }
});
