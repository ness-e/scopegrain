import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { canonicalDigest, taskStaticProjection } from '../src/core/digests.mjs';
import { collectFormalBindings } from '../src/core/formal-bindings.mjs';
import { describeApprovalTarget } from '../src/core/approvals.mjs';
import { prepareDesign, prepareSpecification } from '../src/core/specifications.mjs';
import { getTask, prepareTask } from '../src/core/tasks.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import { bootstrappedCtx, cleanup, writeJson } from './helpers.mjs';

const refs = (id) => [{ requirementId: 'R1', scenarioId: id }];

function fixture({ mini = false } = {}) {
  const f = bootstrappedCtx();
  const s = prepareSpecification(f.ctx, {
    originalRequest: 'synthetic formal bindings fixture', title: 'Spec',
    outcome: { statement: 'fixture outcome', evidencePlan: 'declared checks' },
    requirements: [{ id: 'R1', statement: 'requirement',
      scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' },
        { id: 'S2', given: 'g', when: 'w', then: 't' }] }],
    scope: ['src/a', 'src/b'],
  });
  applyPlan(f.dir, [s.file]);
  const d = prepareDesign(f.ctx, { specId: s.artifact.id.toUpperCase(),
    title: 'Design', body: 'fixture design' });
  applyPlan(f.dir, [d.file]);
  const input = { title: 'Task', contract: 'C', scope: ['src/a'],
    authorContext: 'fixture', specId: s.artifact.id, designId: d.artifact.id };
  const p = mini ? null : preparePlan(f.ctx, {
    key: 'p1', title: 'Plan', authorContext: input.authorContext,
    specId: input.specId, designId: input.designId, tasks: [
      { key: 'a', title: 'A', contract: 'C', scope: ['src/a'], scenarioRefs: refs('S1') },
      { key: 'b', title: 'B', contract: 'C', scope: ['src/b'],
        scenarioRefs: refs('S2'), dependsOn: ['a'] },
    ],
  });
  const t = mini ? prepareTask(f.ctx, input) : null;
  applyPlan(f.dir, mini ? [t.file] : p.files);
  return { ...f, spec: s, design: d, plan: p?.plan,
    task: getTask(f.ctx, mini ? t.task.id : p.plan.tasks[0].id) };
}

function taskRel(f, id) {
  return `${f.ctx.config.paths.tasks}/${id.toLowerCase()}.json`;
}

function assertInvalid(f, task, code) {
  const b = collectFormalBindings(f.ctx, task);
  assert.ok(b.issues.some((i) => i.code === code), JSON.stringify(b.issues));
  assert.equal(b.planDigest, null);
  for (const i of b.issues) assert.deepEqual(Object.keys(i).sort(), ['code', 'message']);
  return b;
}

test('formal mini-plan uses frozen full artifact and static task digests', () => {
  const f = fixture({ mini: true });
  try {
    const b = collectFormalBindings(f.ctx, f.task);
    assert.deepEqual(b.issues, []);
    assert.equal(b.plan, null);
    assert.deepEqual(b.planTasks, []);
    assert.equal(b.planDigest, null);
    assert.equal(b.taskDigest, canonicalDigest(taskStaticProjection(f.task)));
    assert.equal(b.specDigest, canonicalDigest(f.spec.artifact));
    assert.equal(b.designDigest, canonicalDigest(f.design.artifact));
    assert.deepEqual(b.scenarioRefs, [...refs('S1'), ...refs('S2')]);
    assert.throws(() => collectFormalBindings(f.ctx, { ...f.task, specId: [f.task.specId] }),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
  } finally { cleanup(f.dir); }
});

test('ordered plan digest equals approval target and ignores progress/evidence', () => {
  const f = fixture();
  try {
    const before = collectFormalBindings(f.ctx, f.task);
    assert.deepEqual(before.issues, []);
    assert.deepEqual(before.planTasks.map((t) => t.id), f.plan.tasks.map((t) => t.id));
    assert.equal(before.planDigest,
      describeApprovalTarget(f.ctx, { kind: 'plan', id: f.plan.key }).target.digest);
    const candidate = { ...f.task, state: 'ACT', revision: 1,
      verification: { checks: [{ command: 'fixture', cwd: '.',
        status: 'pass', evidence: 'declared fixture pass' }] }, review: null };
    assert.equal(collectFormalBindings(f.ctx, candidate).planDigest, before.planDigest);
    candidate.title = 'candidate static projection must be used';
    const changed = collectFormalBindings(f.ctx, candidate);
    assert.equal(changed.planTasks[0], candidate);
    assert.notEqual(changed.planDigest, before.planDigest);
  } finally { cleanup(f.dir); }
});

test('uppercase current member UUID matches semantically and preserves approval digest', () => {
  const f = fixture();
  try {
    const plan = structuredClone(f.plan);
    plan.tasks[0].id = plan.tasks[0].id.toUpperCase();
    writeJson(f.dir, `${f.ctx.config.paths.plans}/p1.json`, plan);
    const b = collectFormalBindings(f.ctx, f.task);
    assert.deepEqual(b.issues, []);
    assert.equal(b.planTasks[0], f.task);
    assert.equal(b.planDigest,
      describeApprovalTarget(f.ctx, { kind: 'plan', id: 'p1' }).target.digest);
  } finally { cleanup(f.dir); }
});

test('new task pointing at healthy plan without membership cannot produce digest', () => {
  const f = fixture();
  try {
    const p = prepareTask(f.ctx, { title: 'Not a member', contract: 'C',
      authorContext: 'fixture', scope: ['src/a'], specId: f.task.specId,
      designId: f.task.designId, planKey: 'p1', scenarioRefs: refs('S1') });
    applyPlan(f.dir, [p.file]);
    assertInvalid(f, getTask(f.ctx, p.task.id), 'PLAN_MEMBERSHIP_INVALID');
  } finally { cleanup(f.dir); }
});

for (const field of ['specId', 'designId', 'planKey']) {
  test(`sibling mismatched ${field} invalidates whole plan`, () => {
    const f = fixture();
    try {
      const sibling = getTask(f.ctx, f.plan.tasks[1].id);
      if (field === 'designId') {
        const d = prepareDesign(f.ctx, { specId: f.task.specId, title: 'Other',
          body: 'another valid design for same spec' });
        applyPlan(f.dir, [d.file]);
        sibling.designId = d.artifact.id;
      } else {
        sibling[field] = field === 'specId' ? f.design.artifact.id : 'another-plan';
      }
      writeJson(f.dir, taskRel(f, sibling.id), sibling);
      assertInvalid(f, f.task, 'PLAN_MEMBERSHIP_INVALID');
    } finally { cleanup(f.dir); }
  });
}

for (const [label, change, code] of [
  ['parent', (t, f) => { t.designId = f.spec.artifact.id; }, 'FORMAL_BINDING_MISMATCH'],
  ['scope', (t) => { t.scope = ['src/ab']; }, 'SCOPE_OUTSIDE_SPEC'],
  ['scope case', (t) => { t.scope = ['SRC/a']; }, 'SCOPE_OUTSIDE_SPEC'],
  ['scenario case', (t) => { t.scenarioRefs = refs('s1'); }, 'FORMAL_BINDING_MISMATCH'],
  ['unknown scenario', (t) => { t.scenarioRefs = refs('S3'); }, 'FORMAL_BINDING_MISMATCH'],
]) {
  test(`current candidate ${label} is validated and digest withheld`, () => {
    const f = fixture();
    try {
      const candidate = structuredClone(f.task);
      change(candidate, f);
      assertInvalid(f, candidate, code);
    } finally { cleanup(f.dir); }
  });
}

test('full union gap with every member readable invalidates plan digest', () => {
  const f = fixture();
  try {
    const sibling = getTask(f.ctx, f.plan.tasks[1].id);
    sibling.scenarioRefs = refs('S1');
    writeJson(f.dir, taskRel(f, sibling.id), sibling);
    const b = assertInvalid(f, f.task, 'PLAN_SCENARIO_GAP');
    assert.equal(b.planTasks.length, 2);
    assert.ok(b.issues.some((i) => i.message.includes('S2')));
  } finally { cleanup(f.dir); }
});

test('missing spec, design and plan preserve separate leaf codes and context', () => {
  const f = fixture();
  try {
    fs.unlinkSync(f.spec.file.abs);
    fs.unlinkSync(f.design.file.abs);
    fs.unlinkSync(path.join(f.dir, f.ctx.config.paths.plans, 'p1.json'));
    const b = collectFormalBindings(f.ctx, f.task);
    for (const label of ['spec ', 'design ', 'plan ']) {
      assert.ok(b.issues.some((i) => i.message.startsWith(label)
        && i.code === (label === 'plan ' ? 'PLAN_NOT_FOUND' : 'ARTIFACT_NOT_FOUND')),
      JSON.stringify(b.issues));
    }
    assert.equal(b.planDigest, null);
  } finally { cleanup(f.dir); }
});

for (const corrupt of [false, true]) {
  test(`missing spec plus ${corrupt ? 'corrupt' : 'missing'} sibling accumulate without TypeError`, () => {
    const f = fixture();
    try {
      fs.unlinkSync(f.spec.file.abs);
      const siblingRel = taskRel(f, f.plan.tasks[1].id);
      if (corrupt) writeJson(f.dir, siblingRel, { invalid: true });
      else fs.unlinkSync(path.join(f.dir, siblingRel));
      const b = collectFormalBindings(f.ctx, f.task);
      assert.equal(b.planDigest, null);
      assert.ok(b.issues.some((i) => i.code === 'ARTIFACT_NOT_FOUND'
        && i.message.startsWith('spec ')), JSON.stringify(b.issues));
      assert.ok(b.issues.some((i) => i.code === (corrupt ? 'TASK_MALFORMED' : 'TASK_NOT_FOUND')
        && i.message.includes("member 'b'")), JSON.stringify(b.issues));
      assert.ok(b.issues.every((i) => !/TypeError|reading 'id'/.test(i.message)));
      assert.deepEqual(b.planTasks.map((t) => t.id), [f.task.id]);
    } finally { cleanup(f.dir); }
  });
}

test('all failed members are read independently in declaration order', () => {
  const f = fixture();
  try {
    const p = prepareTask(f.ctx, { title: 'Nonmember', contract: 'C',
      authorContext: 'fixture', specId: f.task.specId, designId: f.task.designId,
      planKey: 'p1', scope: ['src/a'], scenarioRefs: refs('S1') });
    applyPlan(f.dir, [p.file]);
    fs.unlinkSync(f.spec.file.abs);
    fs.unlinkSync(path.join(f.dir, taskRel(f, f.task.id)));
    writeJson(f.dir, taskRel(f, f.plan.tasks[1].id), {});
    const b = assertInvalid(f, p.task, 'PLAN_MEMBERSHIP_INVALID');
    assert.ok(b.issues.some((i) => i.code === 'TASK_NOT_FOUND' && i.message.includes("member 'a'")));
    assert.ok(b.issues.some((i) => i.code === 'TASK_MALFORMED' && i.message.includes("member 'b'")));
    assert.deepEqual(b.planTasks, []);
  } finally { cleanup(f.dir); }
});

test('missing spec with readable siblings never dereferences null or invents a digest', () => {
  const f = fixture();
  try {
    fs.unlinkSync(f.spec.file.abs);
    const b = collectFormalBindings(f.ctx, f.task);
    assert.equal(b.planDigest, null);
    assert.deepEqual(b.planTasks.map((t) => t.id), f.plan.tasks.map((r) => r.id));
    assert.ok(b.issues.some((i) => i.code === 'ARTIFACT_NOT_FOUND'
      && i.message.startsWith('spec ')));
    assert.ok(b.issues.every((i) => i.code && !/reading 'id'|TypeError/.test(i.message)));
  } finally { cleanup(f.dir); }
});

for (const field of ['scope', 'scenarioRefs']) {
  test(`readable sibling invalid ${field} withholds digest but remains in ordered planTasks`, () => {
    const f = fixture();
    try {
      const sibling = getTask(f.ctx, f.plan.tasks[1].id);
      sibling[field] = field === 'scope' ? ['src/bad'] : refs('s2');
      writeJson(f.dir, taskRel(f, sibling.id), sibling);
      const b = assertInvalid(f, f.task,
        field === 'scope' ? 'SCOPE_OUTSIDE_SPEC' : 'PLAN_MEMBERSHIP_INVALID');
      assert.deepEqual(b.planTasks.map((t) => t.id), f.plan.tasks.map((r) => r.id));
    } finally { cleanup(f.dir); }
  });
}

test('semantic duplicate current member UUID is rejected by actual plan getter', () => {
  const f = fixture();
  try {
    const plan = structuredClone(f.plan);
    plan.tasks[1].id = plan.tasks[0].id.toUpperCase();
    writeJson(f.dir, `${f.ctx.config.paths.plans}/p1.json`, plan);
    assertInvalid(f, f.task, 'PLAN_MALFORMED');
  } finally { cleanup(f.dir); }
});

for (const missingSpec of [false, true]) {
  test(`actual junction scope rejected even with spec ${missingSpec ? 'missing' : 'present'}`, (t) => {
    const f = fixture();
    try {
      const parent = path.join(f.dir, 'src');
      const target = path.join(f.dir, 'real-target');
      fs.mkdirSync(parent);
      fs.mkdirSync(target);
      assert.ok(fs.lstatSync(parent).isDirectory());
      const link = path.join(parent, 'a');
      try { fs.symlinkSync(target, link, 'junction'); }
      catch (e) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) {
          t.skip(`junction creation denied: ${e.code}`);
          return;
        }
        throw e;
      }
      assert.ok(fs.lstatSync(link).isSymbolicLink());
      if (missingSpec) fs.unlinkSync(f.spec.file.abs);
      assertInvalid(f, f.task, 'SCOPE_OUTSIDE_SPEC');
    } finally { cleanup(f.dir); }
  });
}
