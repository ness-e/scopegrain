// Workflow packet cases: resolution, modes, hosts, profiles, read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { checkAction, transitionTask } from '../src/core/transition.mjs';
import { checkMethodology } from '../src/core/methodology.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  formalFixture, lightFixture, reanswer, snapshot,
} from './methodology-fixtures.mjs';
import {
  bootstrappedCtx, cleanup,
} from './helpers.mjs';

function ctxFixture() {
  const { dir, ctx } = bootstrappedCtx();
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
    assert.deepEqual(p.methodology, {
      mode: 'manual', available: true, taskCheck: null,
      authenticatesEvidence: false, interceptsNativeTools: false,
    });
  } finally { cleanup(dir); }
});

test('one shared ACT evaluation supplies workflow envelope AND actions, without second approval lookup', (t) => {
  const f = formalFixture();
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const approvalFile = path.resolve(f.approvals.task.file.abs);
    const realOpen = fs.openSync;
    let reads = 0;
    t.mock.method(fs, 'openSync', (file, flags, ...rest) => {
      if (flags === 'r' && path.resolve(String(file)) === approvalFile) reads += 1;
      return realOpen(file, flags, ...rest);
    });
    const p = buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: f.task.id,
    });
    assert.equal(reads, 1);
    assert.equal(p.methodology.taskCheck.allowed, true);
    assert.ok(p.allowedActions.includes('edit'));
    reads = 0;
    assert.equal(checkAction(f.ctx, f.task.id, 'edit').allowed, true);
    assert.equal(reads, 1);
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});

test('no-task envelope uses selected mode; existing complete packet document cap remains enforced', () => {
  const f = ctxFixture();
  try {
    for (const mode of ['organic-sdd', 'sdd']) {
      f.ctx.config.methodology = mode;
      const p = buildWorkflowPacket(f.ctx, { command: 'status' });
      assert.equal(p.methodology.mode, mode);
      assert.equal(p.methodology.taskCheck, null);
      assert.equal(p.allowedActions, null);
    }
    f.ctx.config.methodology = 'manual';
    const base = buildWorkflowPacket(f.ctx, { command: 'pipeline', mode: 'task' });
    const limit = loadLimits().maxDocumentBytes;
    // Fits as a task document, but task + unchanged resource content exceeds
    // the packet cap. No policy/manifest/resource mutation is needed.
    const task = createTask(f.ctx, {
      title: 'Bounded large task', authorContext: 'a', scope: [],
      contract: 'x'.repeat(limit - Buffer.byteLength(JSON.stringify(base)) + 1024),
    });
    const before = snapshot(f.dir);
    assert.throws(() => buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: task.id,
    }), (e) => e.code === 'CONTEXT_TOO_LARGE');
    assert.deepEqual(snapshot(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('revoked approval filters BOTH workflow edit and five-field checkAction', () => {
  const f = formalFixture();
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const opts = { command: 'pipeline', mode: 'task', taskId: f.task.id };
    assert.ok(buildWorkflowPacket(f.ctx, opts).allowedActions.includes('edit'));
    reanswer(f, f.approvals.task, 'revoke');
    const before = snapshot(f.dir);
    const p = buildWorkflowPacket(f.ctx, opts);
    const check = checkAction(f.ctx, f.task.id, 'edit');
    assert.deepEqual(Object.keys(check).sort(),
      ['action', 'allowed', 'id', 'permitted', 'state']);
    assert.equal(check.allowed, false);
    assert.ok(!p.allowedActions.includes('edit'));
    assert.deepEqual(p.allowedActions, check.permitted);
    assert.deepEqual(p.methodology.taskCheck,
      checkMethodology(f.ctx, { taskId: f.task.id }));
    assert.equal(p.methodology.taskCheck.allowed, false);
    assert.equal(p.capabilities.authenticatesEvidence, false);
    assert.equal(p.capabilities.interceptsNativeTools, false);
    assert.equal(p.capabilities.callsModels, false);
    assert.deepEqual(snapshot(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('V2 empty scope permits ACT but removes edit; legacy V1 empty scope keeps edit', () => {
  const f = lightFixture({ scope: [] });
  try {
    transitionTask(f.ctx, { id: f.task.id, to: 'ACT', expectedRevision: 0 });
    const p = buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: f.task.id,
    });
    assert.equal(p.methodology.taskCheck.allowed, true);
    assert.ok(!p.allowedActions.includes('edit'));
    assert.deepEqual(p.allowedActions, checkAction(f.ctx, f.task.id, 'edit').permitted);
    const old = createTask(f.ctx, {
      title: 'V1', contract: 'C', authorContext: 'a', scope: [],
    });
    transitionTask(f.ctx, { id: old.id, to: 'ACT', expectedRevision: 0 });
    assert.equal(checkAction(f.ctx, old.id, 'edit').allowed, true);
    assert.ok(buildWorkflowPacket(f.ctx, {
      command: 'pipeline', mode: 'task', taskId: old.id,
    }).allowedActions.includes('edit'));
  } finally { cleanup(f.dir); }
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
