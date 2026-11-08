import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { getArtifact, prepareArtifact } from '../src/core/artifacts.mjs';
import { describeApprovalTarget, getApproval, prepareApproval } from '../src/core/approvals.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { bootstrappedCtx, cleanup, writeJson } from './helpers.mjs';

test('actual artifact getter rejects array ID with ARTIFACT_MALFORMED', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const p = prepareArtifact(ctx, 'research', { title: 'Research', body: 'operator note' });
    applyPlan(dir, [p.file]);
    assert.deepEqual(getArtifact(ctx, 'research', p.artifact.id), p.artifact);
    writeJson(dir, p.file.rel, { ...p.artifact, id: [p.artifact.id] });
    assert.throws(() => getArtifact(ctx, 'research', p.artifact.id),
      (e) => e.code === 'ARTIFACT_MALFORMED');
  } finally { cleanup(dir); }
});

test('actual task approval getter rejects one typed field mutation at a time', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'Task', contract: 'C', authorContext: 'fixture', scope: ['src/a'] });
    const { target } = describeApprovalTarget(ctx, { kind: 'task', id: task.id });
    const p = prepareApproval(ctx, { target });
    applyPlan(dir, [p.file]);
    for (const mutate of [
      (a) => { a.target.digest = [a.target.digest]; },
      (a) => { a.target.id = [a.target.id]; },
      (a) => { a.id = [a.id]; },
    ]) {
      writeJson(dir, p.file.rel, p.approval);
      assert.deepEqual(getApproval(ctx, p.approval.id), p.approval);
      const bad = structuredClone(p.approval);
      mutate(bad);
      writeJson(dir, p.file.rel, bad);
      assert.throws(() => getApproval(ctx, p.approval.id),
        (e) => e.code === 'APPROVAL_MALFORMED');
    }
  } finally { cleanup(dir); }
});

test('actual manual plan approval rejects true, number and array target IDs', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const plan = preparePlan(ctx, {
      key: 'manual-plan', title: 'Manual plan', authorContext: 'fixture',
      tasks: [{ key: 'a', title: 'A', contract: 'C', scope: ['src/a'] }],
    });
    applyPlan(dir, plan.files);
    const { target } = describeApprovalTarget(ctx, { kind: 'plan', id: plan.plan.key });
    const p = prepareApproval(ctx, { target });
    applyPlan(dir, [p.file]);
    for (const id of [true, 1, [target.id]]) {
      writeJson(dir, p.file.rel, p.approval);
      assert.deepEqual(getApproval(ctx, p.approval.id), p.approval);
      const bad = structuredClone(p.approval);
      bad.target.id = id;
      writeJson(dir, p.file.rel, bad);
      assert.throws(() => getApproval(ctx, p.approval.id),
        (e) => e.code === 'APPROVAL_MALFORMED');
    }
  } finally { cleanup(dir); }
});

test('prepareApproval type guards reject before foreign lookup or writes', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'Task', contract: 'C', authorContext: 'fixture', scope: ['src/a'] });
    const artifact = prepareArtifact(ctx, 'research', { title: 'Research', body: 'note' });
    applyPlan(dir, [artifact.file]);
    const plan = preparePlan(ctx, {
      key: 'manual-plan', title: 'Plan', authorContext: 'fixture',
      tasks: [{ key: 'a', title: 'A', contract: 'C' }],
    });
    applyPlan(dir, plan.files);
    const inputs = [{ kind: 'task', id: task.id },
      { kind: 'artifact', artifactKind: 'research', id: artifact.artifact.id },
      { kind: 'plan', id: plan.plan.key }];
    const targets = inputs.map((i) => describeApprovalTarget(ctx, i).target);
    for (const target of targets) assert.ok(prepareApproval(ctx, { target }).file);
    // Removing real targets makes an accidental lookup observable by its
    // NOT_FOUND code. All mutated inputs differ from a valid target once.
    fs.unlinkSync(`${dir}/${ctx.config.paths.tasks}/${task.id}.json`);
    fs.unlinkSync(artifact.file.abs);
    fs.unlinkSync(`${dir}/${ctx.config.paths.plans}/${plan.plan.key}.json`);
    const before = fs.readdirSync(dir, { recursive: true }).sort();
    for (const target of targets) {
      for (const field of ['id', 'digest']) {
        for (const value of [[target[field]], true, 1]) {
          assert.throws(() => prepareApproval(ctx, {
            target: { ...target, [field]: value },
          }), (e) => e.code === 'APPROVAL_INVALID');
        }
      }
    }
    assert.deepEqual(fs.readdirSync(dir, { recursive: true }).sort(), before);
  } finally { cleanup(dir); }
});
