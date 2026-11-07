// Plan cases: DAG validation, atomic creation, dependency readiness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  getPlan, listPlans, nextPlanTasks, preparePlan,
} from '../src/core/plans.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, writeJson,
} from './helpers.mjs';

const GOOD = {
  key: 'rel-1',
  title: 'Release 1',
  authorContext: 'ctx-a',
  tasks: [
    { key: 'base', title: 'Base', contract: 'c', scope: [], dependsOn: [] },
    { key: 'api', title: 'API', contract: 'c', scope: [], dependsOn: ['base'] },
    { key: 'docs', title: 'Docs', contract: 'c', scope: [], dependsOn: ['api'] },
  ],
};

function ctxFixture() {
  const dir = makeTempDir('plans');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  const ctx = resolveContext({ project: dir });
  return { dir, ctx };
}

test('preparePlan is read-only; apply creates plan+tasks atomically', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const prepared = preparePlan(ctx, GOOD);
    assert.equal(prepared.files.length, 4); // 3 tasks + plan doc
    assert.ok(!exists(dir, 'docs/agent/plans/rel-1.json'));
    assert.ok(!exists(dir, 'docs/agent/tasks'));
    const planned = preflightPlan(dir, prepared.files);
    const result = applyPlan(dir, planned);
    assert.equal(result.created, 4);
    const plan = getPlan(ctx, 'rel-1');
    assert.equal(plan.tasks.length, 3);
    for (const t of plan.tasks) {
      const task = getTask(ctx, t.id);
      assert.equal(task.state, 'PLAN');
      assert.equal(task.revision, 0);
    }
  } finally { cleanup(dir); }
});

test('input validation: keys, duplicates, cycles, missing deps, size', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const bad = [
      [{ ...GOOD, key: 'Bad Key' }],
      [{ ...GOOD, tasks: [] }],
      [{ ...GOOD, tasks: [...GOOD.tasks, GOOD.tasks[0]] }],
      [{ ...GOOD, tasks: [
        { key: 'a', title: 't', contract: 'c', dependsOn: ['b'] },
        { key: 'b', title: 't', contract: 'c', dependsOn: ['a'] },
      ] }],
      [{ ...GOOD, tasks: [
        { key: 'a', title: 't', contract: 'c', dependsOn: ['a'] },
      ] }],
      [{ ...GOOD, tasks: [
        { key: 'a', title: 't', contract: 'c', dependsOn: ['ghost'] },
      ] }],
      [{ ...GOOD, tasks: [
        { key: 'a', title: 't', contract: 'c', scope: ['../x'] },
      ] }],
      [{ ...GOOD, tasks: Array.from({ length: 101 }, (_, i) =>
        ({ key: `t${i}`, title: 't', contract: 'c' })) }],
      [{ ...GOOD, tasks: [undefined] }],
      [{ ...GOOD, tasks: [{ key: 'a', title: 't', contract: 'c', bogus: 1 }] }],
      [{ ...GOOD, bogus: true }],
    ];
    for (const [input] of bad) {
      assert.throws(() => preparePlan(ctx, input),
        (e) => e.code !== 'INTERNAL', JSON.stringify(input).slice(0, 80));
    }
  } finally { cleanup(dir); }
});

test('existing plan is a conflict; nothing is overwritten', () => {
  const { dir, ctx } = ctxFixture();
  try {
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, GOOD).files));
    const again = preparePlan(ctx, GOOD);
    assert.throws(() => preflightPlan(dir, again.files),
      (e) => e.code === 'PLAN_CONFLICT');
    assert.equal(listPlans(ctx).plans.length, 1);
  } finally { cleanup(dir); }
});

test('write failure rolls back plan and task files together', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const prepared = preparePlan(ctx, GOOD);
    const planned = preflightPlan(dir, prepared.files);
    const orig = fs.writeSync;
    fs.writeSync = () => 0;
    try {
      assert.throws(() => applyPlan(dir, planned));
    } finally {
      fs.writeSync = orig;
    }
    assert.ok(!exists(dir, 'docs/agent/plans/rel-1.json'));
    // Rollback removes created files only; parent dirs it made may remain.
    const tasksDir = `${dir}/docs/agent/tasks`;
    const leftovers = fs.existsSync(tasksDir)
      ? fs.readdirSync(tasksDir).filter((n) => n.endsWith('.json')) : [];
    assert.deepEqual(leftovers, []);
  } finally { cleanup(dir); }
});

test('nextPlanTasks reports ready/blocked/active/closed from real state', () => {
  const { dir, ctx } = ctxFixture();
  try {
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, GOOD).files));
    let next = nextPlanTasks(ctx, 'rel-1');
    const st = Object.fromEntries(next.map((t) => [t.key, t.status]));
    assert.equal(st.base, 'ready');
    assert.equal(st.api, 'blocked');
    assert.equal(st.docs, 'blocked');
    const plan = getPlan(ctx, 'rel-1');
    const base = plan.tasks.find((t) => t.key === 'base');
    transitionTask(ctx, { id: base.id, to: 'ACT', expectedRevision: 0 });
    next = nextPlanTasks(ctx, 'rel-1');
    assert.equal(next.find((t) => t.key === 'base').status, 'active');
    assert.throws(() => getTask(ctx, 'nonexistent'),
      (e) => e.code === 'INVALID_ID' || e.code === 'TASK_NOT_FOUND');
    // Corrupt a task file: readiness reports error, not empty success.
    const api = plan.tasks.find((t) => t.key === 'api');
    fs.writeFileSync(
      `${dir}/docs/agent/tasks/${api.id}.json`, '{broken');
    assert.throws(() => nextPlanTasks(ctx, 'rel-1'),
      (e) => e.code === 'TASK_MALFORMED');
  } finally { cleanup(dir); }
});

test('malformed stored plan surfaces in list', () => {
  const { dir, ctx } = ctxFixture();
  try {
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, GOOD).files));
    writeJson(dir, 'docs/agent/plans/broken-plan.json', { nope: 1 });
    const out = listPlans(ctx);
    assert.equal(out.plans.length, 1);
    assert.equal(out.malformed.length, 1);
  } finally { cleanup(dir); }
});
