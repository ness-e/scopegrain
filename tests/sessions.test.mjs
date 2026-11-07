// Session cases: opt-in writes, budget, CAS, policy gating, resume.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  getSession, prepareSession, recordSession, resumeSession,
  sessionFileAbs,
} from '../src/core/sessions.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, writeJson,
} from './helpers.mjs';

function fixture() {
  const dir = makeTempDir('sess');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  const task = createTask(ctx, {
    title: 'T', contract: 'C', authorContext: 'a', scope: [],
  });
  return { dir, ctx, task };
}

function makeSession(ctx, task, limit = 3) {
  const prepared = prepareSession(ctx, { taskId: task.id, limit });
  applyPlan(ctx.projectRoot, preflightPlan(ctx.projectRoot, [prepared.file]));
  return prepared.session;
}

test('create is opt-in; limit required and bounded', () => {
  const { dir, ctx, task } = fixture();
  try {
    const p = prepareSession(ctx, { taskId: task.id, limit: 5 });
    assert.ok(!exists(dir, '.tasksystem/state/sessions'));
    for (const bad of [{ taskId: task.id }, { taskId: task.id, limit: 0 },
      { taskId: task.id, limit: 10001 }, { taskId: task.id, limit: 'x' },
      { taskId: 'nope', limit: 3 }, { taskId: task.id, limit: 3, bogus: 1 }]) {
      assert.throws(() => prepareSession(ctx, bad),
        (e) => e.code !== 'INTERNAL');
    }
    applyPlan(dir, preflightPlan(dir, [p.file]));
    const s = getSession(ctx, p.session.id);
    assert.equal(s.limit, 5);
    assert.equal(s.revision, 0);
  } finally { cleanup(dir); }
});

test('record honors policy state, budget, CAS and atomic writes', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 2);
    const file = sessionFileAbs(ctx, s.id);
    const before = fs.readFileSync(file);
    // 'edit' in PLAN is denied: bytes and revision unchanged.
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'edit', evidence: 'e',
    }), (e) => e.code === 'SESSION_ACTION_DENIED');
    assert.ok(fs.readFileSync(file).equals(before));
    // Allowed action in PLAN.
    const s1 = recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    });
    assert.equal(s1.used, 1);
    assert.equal(s1.revision, 1);
    // Stale revision.
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    }), (e) => e.code === 'REVISION_MISMATCH');
    // Exhaustion after limit.
    recordSession(ctx, {
      id: s.id, expectedRevision: 1, action: 'read', evidence: 'y',
    });
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 2, action: 'read', evidence: 'z',
    }), (e) => e.code === 'SESSION_LIMIT_EXHAUSTED');
  } finally { cleanup(dir); }
});

test('accepted edit event lands in ACT', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 5);
    transitionTask(ctx, { id: task.id, to: 'ACT', expectedRevision: 0 });
    const s1 = recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'edit',
      evidence: 'diff', context: 'slice-1',
    });
    assert.equal(s1.events[0].action, 'edit');
  } finally { cleanup(dir); }
});

test('lock conflict, malformed stored data and resume integrity', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 3);
    const file = sessionFileAbs(ctx, s.id);
    fs.writeFileSync(`${file}.lock`, 'held', { flag: 'wx' });
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    }), (e) => e.code === 'SESSION_LOCKED');
    fs.rmSync(`${file}.lock`);
    // Malformed stored session.
    fs.writeFileSync(file, '{broken');
    assert.throws(() => getSession(ctx, s.id),
      (e) => e.code === 'SESSION_MALFORMED');
    assert.throws(() => recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    }), (e) => e.code === 'SESSION_MALFORMED');
  } finally { cleanup(dir); }
});

test('resume returns actual state and remaining budget without mutation', () => {
  const { dir, ctx, task } = fixture();
  try {
    const s = makeSession(ctx, task, 4);
    recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    });
    const before = fs.readFileSync(sessionFileAbs(ctx, s.id));
    const r = resumeSession(ctx, s.id);
    assert.equal(r.task.state, 'PLAN');
    assert.equal(r.usage.used, 1);
    assert.equal(r.usage.remaining, 3);
    assert.equal(r.usage.measures, 'explicitly-recorded-operations-only');
    assert.equal(r.recovery.reference, 'references/task-system.md');
    assert.ok(fs.readFileSync(sessionFileAbs(ctx, s.id)).equals(before));
  } finally { cleanup(dir); }
});
