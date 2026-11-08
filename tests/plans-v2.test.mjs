// Plan V2: formal refs pair, per-task scenarioRefs, union coverage,
// inherited fields, V1 preservation, DAG unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { preparePlan, getPlan } from '../src/core/plans.mjs';
import {
  prepareDesign, prepareSpecification,
} from '../src/core/specifications.mjs';
import { bootstrappedCtx, cleanup, writeJson } from './helpers.mjs';

const SPEC = {
  originalRequest: 'plan v2 fixture spec',
  title: 'Spec',
  outcome: { statement: 'o', evidencePlan: 'e' },
  requirements: [{
    id: 'R1', statement: 's',
    scenarios: [
      { id: 'S1', given: 'g', when: 'w', then: 't' },
      { id: 'S2', given: 'g2', when: 'w2', then: 't2' }],
  }],
  scope: ['src/a', 'src/b'],
};

function makePair(ctx, dir) {
  const spec = prepareSpecification(ctx, SPEC);
  applyPlan(dir, [spec.file]);
  const des = prepareDesign(ctx, {
    specId: spec.artifact.id, title: 'd', body: 'b' });
  applyPlan(dir, [des.file]);
  return { spec: spec.artifact, design: des.artifact };
}

const T1 = { key: 't1', title: 'T1', contract: 'C', scope: ['src/a'],
  scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }] };
const T2 = { key: 't2', title: 'T2', contract: 'C', scope: ['src/b'],
  dependsOn: ['t1'],
  scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S2' }] };

test('V2 plan: two disjoint tasks cover the spec; tasks inherit refs', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { plan, files } = preparePlan(ctx, {
      key: 'p1', title: 'P', authorContext: 'a',
      specId: spec.id, designId: design.id,
      tasks: [T1, T2],
    });
    assert.equal(plan.schemaVersion, 2);
    assert.equal(plan.specId, spec.id);
    assert.equal(plan.designId, design.id);
    assert.equal(plan.tasks.length, 2);
    applyPlan(dir, files);
    const t1 = getTask(ctx, plan.tasks[0].id);
    const t2 = getTask(ctx, plan.tasks[1].id);
    assert.equal(t1.schemaVersion, 2);
    assert.equal(t1.methodology, null);
    assert.equal(t1.planKey, 'p1');
    assert.equal(t1.specId, spec.id);
    assert.deepEqual(t1.scenarioRefs,
      [{ requirementId: 'R1', scenarioId: 'S1' }]);
    assert.deepEqual(t2.scenarioRefs,
      [{ requirementId: 'R1', scenarioId: 'S2' }]);
    // Union coverage is complete across the two tasks.
    const union = new Set([...t1.scenarioRefs, ...t2.scenarioRefs]
      .map((r) => `${r.requirementId}/${r.scenarioId}`));
    assert.equal(union.size, 2);
  } finally { cleanup(dir); }
});

test('union gap / empty assignment fail; V1 unchanged; DAG enforced', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const f = { specId: spec.id, designId: design.id };
    // Only S1 assigned -> S2 uncovered -> union gap.
    assert.throws(() => preparePlan(ctx, {
      key: 'p', title: 'P', authorContext: 'a', ...f,
      tasks: [T1] }), (e) => e.code === 'INVALID_PLAN'
        && e.message.includes('S2'));
    // Explicit empty assignment -> scenarioRefs contract failure.
    assert.throws(() => preparePlan(ctx, {
      key: 'p', title: 'P', authorContext: 'a', ...f,
      tasks: [{ ...T1, scenarioRefs: [] }] }),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    // Half-pair inputs reject.
    assert.throws(() => preparePlan(ctx, {
      key: 'p', title: 'P', authorContext: 'a',
      specId: spec.id, tasks: [T1] }),
      (e) => e.code === 'INVALID_ID');
    // Cycle still rejected.
    assert.throws(() => preparePlan(ctx, {
      key: 'p', title: 'P', authorContext: 'a', ...f,
      tasks: [{ ...T1, dependsOn: ['t2'] },
        { ...T2, dependsOn: ['t1'] }] }),
      (e) => e.code === 'INVALID_PLAN');
    // V1 plan without refs stays original.
    const v1 = preparePlan(ctx, {
      key: 'v1', title: 'V', authorContext: 'a',
      tasks: [{ key: 'x', title: 'X', contract: 'C' }] });
    assert.equal(v1.plan.schemaVersion, 1);
    assert.equal(v1.plan.specId, undefined);
    // noRefs plan + child scenarioRefs -> METHODOLOGY_REQUIRED early.
    assert.throws(() => preparePlan(ctx, {
      key: 'p', title: 'P', authorContext: 'a',
      tasks: [{ key: 'x', title: 'X', contract: 'C',
        scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }] }] }),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
  } finally { cleanup(dir); }
});

test('stored V2 plan requires refs; V1 forbids them; prepare is read-only', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { plan, files } = preparePlan(ctx, {
      key: 'p1', title: 'P', authorContext: 'a',
      specId: spec.id, designId: design.id, tasks: [T1, T2] });
    applyPlan(dir, files);
    const rel = '.tasksystem/plans/p1.json';
    const good = JSON.parse(fs.readFileSync(`${dir}/${rel}`, 'utf8'));
    const m = JSON.parse(JSON.stringify(good));
    delete m.specId; delete m.designId;
    writeJson(dir, rel, m);
    assert.throws(() => getPlan(ctx, 'p1'),
      (e) => e.code === 'PLAN_MALFORMED');
    const v = JSON.parse(JSON.stringify(good));
    v.schemaVersion = 1;
    writeJson(dir, rel, v);
    assert.throws(() => getPlan(ctx, 'p1'),
      (e) => e.code === 'PLAN_MALFORMED');
    const m2 = JSON.parse(JSON.stringify(good));
    m2.tasks[0].id = [m2.tasks[0].id]; // array id coercion -> malformed
    writeJson(dir, rel, m2);
    assert.throws(() => getPlan(ctx, 'p1'),
      (e) => e.code === 'PLAN_MALFORMED');
    writeJson(dir, rel, good);
    // preparePlan read-only: file paths absent before apply, present after.
    const { plan: p2, files: f2 } = preparePlan(ctx, {
      key: 'p2', title: 'P2', authorContext: 'a',
      specId: spec.id, designId: design.id, tasks: [T1, T2] });
    for (const f of f2) assert.equal(fs.existsSync(f.abs), false);
    applyPlan(dir, f2);
    for (const f of f2) assert.equal(fs.existsSync(f.abs), true);
    // Invalid prepare writes no files or dirs.
    const plansDir = `${dir}/.tasksystem/plans`;
    const before = fs.readdirSync(plansDir).sort();
    assert.throws(() => preparePlan(ctx, {
      key: 'bad', title: 'P', authorContext: 'a',
      specId: spec.id, designId: design.id, tasks: [T1] }),
      (e) => e.code === 'INVALID_PLAN');
    assert.deepEqual(fs.readdirSync(plansDir).sort(), before);
  } finally { cleanup(dir); }
});
