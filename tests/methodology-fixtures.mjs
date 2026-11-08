// D2 fixtures use real factories/approval APIs. Seeded task states are
// explicitly SYNTHETIC attestations, not evidence of execution or identity.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyPlan } from '../src/core/bootstrap.mjs';
import {
  answerApproval, describeApprovalTarget, getApproval, prepareApproval,
} from '../src/core/approvals.mjs';
import { prepareDesign, prepareSpecification } from '../src/core/specifications.mjs';
import { getTask, createTask, taskFilePath } from '../src/core/tasks.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import { prepareOutcomeEvidence } from '../src/core/outcomes.mjs';
import { bootstrappedCtx, writeJson } from './helpers.mjs';

export const assessment = (overrides = {}) => ({
  schemaVersion: 1, request: 'declared D2 fixture change', intent: 'change',
  authorization: { status: 'authorized', actor: 'fixture-owner',
    reference: 'explicit fixture authorization' },
  understanding: 'sufficient', uncertainty: 'resolved', risk: 'contained',
  riskCategories: [], continuity: 'diff-sufficient',
  evidence: ['fixture attestation only'], preferredRoute: 'auto',
  ...overrides,
});
export const refs = (scenarioId) => [{ requirementId: 'R1', scenarioId }];
export const verification = (ids = ['S1']) => ({
  checks: [{ command: 'declared-fixture-check', cwd: '.', status: 'pass',
    evidence: 'synthetic declared passing result, not execution' }],
  coverage: ids.map((id) => ({ ...refs(id)[0], checkIndexes: [0] })),
});
export const fresh = (task) => ({
  mode: 'fresh', reviewer: 'declared fixture reviewer',
  authorContext: task.authorContext, reviewerContext: 'different-fixture-context',
  verdict: 'approve',
});
export const waiver = () => ({
  mode: 'waived', owner: 'declared fixture owner',
  reference: 'explicit fixture waiver', reason: 'scoped fixture waiver',
  verdict: 'approve',
});
export function saveTask(f, task) {
  fs.writeFileSync(taskFilePath(f.ctx, task.id), JSON.stringify(task, null, 2) + '\n');
  return getTask(f.ctx, task.id);
}
export function seedState(f, task, state = 'REVIEW', evidence = verification()) {
  // SYNTHETIC foreign/current state; equal creation times avoid future clocks.
  const states = ['PLAN', 'ACT', 'VERIFY', 'EVALUATE', 'REVIEW', 'ACCEPT', 'CLOSE'];
  const through = states.slice(1, states.indexOf(state) + 1);
  const next = { ...task, state, revision: through.length,
    updatedAt: task.createdAt, verification: evidence,
    review: evidence ? fresh(task) : null,
    history: [task.history[0], ...through.map((to, i) => ({
      at: task.createdAt, event: 'transition', from: states[i], to, revision: i + 1,
    }))] };
  return saveTask(f, next);
}
export function approvalTarget(kind, id) {
  return ['spec', 'design', 'report'].includes(kind)
    ? { kind: 'artifact', artifactKind: kind, id } : { kind, id };
}
export function approve(f, kind, id, answer = 'approve') {
  const desc = describeApprovalTarget(f.ctx, approvalTarget(kind, id));
  const p = prepareApproval(f.ctx, { target: desc.target });
  applyPlan(f.dir, [p.file]);
  if (answer !== 'pending') {
    answerApproval(f.ctx, { id: p.approval.id, expectedRevision: 0,
      expectedTargetDigest: desc.target.digest, answer, actor: 'fixture-owner',
      comment: 'declared fixture answer' });
  }
  return { file: p.file, approval: getApproval(f.ctx, p.approval.id), desc };
}
export function reanswer(f, a, answer) {
  const current = getApproval(f.ctx, a.approval.id);
  return answerApproval(f.ctx, { id: current.id, expectedRevision: current.revision,
    expectedTargetDigest: current.target.digest, answer, actor: 'fixture-owner',
    comment: 'explicit changed fixture answer' });
}
export function formalFixture({ mini = true, three = false, approved = true,
    methodology, openQuestions = [] } = {}) {
  const f = bootstrappedCtx();
  const s = prepareSpecification(f.ctx, {
    originalRequest: 'D2 synthetic specification', title: 'Fixture spec',
    outcome: { statement: 'assigned outcomes', evidencePlan: 'declared checks' },
    requirements: [{ id: 'R1', statement: 'requirement',
      scenarios: ['S1', 'S2'].map((id) => ({
        id, given: 'fixture', when: 'declared check', then: 'assigned result',
      })) }],
    scope: ['src/a', 'src/b'], openQuestions,
  });
  applyPlan(f.dir, [s.file]);
  const d = prepareDesign(f.ctx, { specId: s.artifact.id,
    title: 'Fixture design', body: 'declared design' });
  applyPlan(f.dir, [d.file]);
  const common = { authorContext: 'fixture-author', specId: s.artifact.id,
    designId: d.artifact.id, ...(methodology === undefined ? {} : { methodology }) };
  let task;
  let plan = null;
  if (mini) {
    task = createTask(f.ctx, { title: 'Mini-plan', contract: 'C',
      scope: ['src/a'], scenarioRefs: refs('S1'), ...common });
  } else {
    const p = preparePlan(f.ctx, { key: 'd2-plan', title: 'Fixture plan',
      ...common, tasks: [
        { key: 'a', title: 'A', contract: 'C', scope: ['src/a'],
          scenarioRefs: refs('S1') },
        { key: 'b', title: 'B', contract: 'C', scope: ['src/b'],
          scenarioRefs: refs('S2'), dependsOn: ['a'] },
        ...(three ? [{ key: 'c', title: 'C', contract: 'C', scope: ['src/b'],
          scenarioRefs: refs('S2'), dependsOn: ['b'] }] : []),
      ] });
    applyPlan(f.dir, p.files);
    plan = p.plan;
    task = getTask(f.ctx, plan.tasks[0].id);
  }
  Object.assign(f, { spec: s, design: d, task, formalPlan: plan, approvals: {} });
  if (approved) approveFormal(f);
  return f;
}
export function approveFormal(f) {
  f.approvals.spec = approve(f, 'spec', f.spec.artifact.id);
  f.approvals.design = approve(f, 'design', f.design.artifact.id);
  f.approvals[f.formalPlan ? 'plan' : 'task'] = approve(f,
    f.formalPlan ? 'plan' : 'task', f.formalPlan?.key ?? f.task.id);
}
export function lightFixture({ scope = ['src/a'], mode = 'manual' } = {}) {
  const f = bootstrappedCtx();
  f.ctx.config.methodology = mode;
  f.task = createTask(f.ctx, { title: 'Light change', contract: 'C',
    authorContext: 'fixture-author', scope, methodology: assessment() });
  return f;
}
export function outcome(f, task = getTask(f.ctx, f.task.id), approved = true) {
  const p = prepareOutcomeEvidence(f.ctx, { taskId: task.id,
    title: 'Declared outcome', body: 'fixture outcome attestation' });
  applyPlan(f.dir, [p.file]);
  const a = approved ? approve(f, 'report', p.artifact.id) : null;
  return { ...p, approval: a };
}
export function snapshot(root) {
  const out = {};
  function walk(dir, rel = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const file = path.join(dir, name);
      const st = fs.lstatSync(file);
      out[r] = st.isDirectory() ? 'directory'
        : st.isSymbolicLink() ? `link:${fs.readlinkSync(file)}`
          : `${st.size}:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
      if (st.isDirectory()) walk(file, r);
    }
  }
  walk(root);
  return out;
}
export function saveApproval(f, a, change) {
  const record = structuredClone(a.approval);
  change(record);
  fs.writeFileSync(a.file.abs, JSON.stringify(record, null, 2) + '\n');
}
export function savePlan(f, plan) {
  writeJson(f.dir, `${f.ctx.config.paths.plans}/${plan.key}.json`, plan);
}
