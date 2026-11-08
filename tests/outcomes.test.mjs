import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { getArtifact } from '../src/core/artifacts.mjs';
import { canonicalDigest, taskStaticProjection } from '../src/core/digests.mjs';
import { prepareOutcomeEvidence } from '../src/core/outcomes.mjs';
import { prepareDesign, prepareSpecification } from '../src/core/specifications.mjs';
import { getTask, prepareTask } from '../src/core/tasks.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import { bootstrappedCtx, cleanup, writeJson } from './helpers.mjs';

const pair = (id) => [{ requirementId: 'R1', scenarioId: id }];
const body = '  Operator report, verbatim.\nDeclared fixture evidence only.\n';

function fixture({ mini = false, v1 = false, state = 'REVIEW' } = {}) {
  const f = bootstrappedCtx();
  const s = prepareSpecification(f.ctx, {
    originalRequest: 'synthetic outcome fixture', title: 'Spec',
    outcome: { statement: 'fixture outcome', evidencePlan: 'declared checks' },
    requirements: [{ id: 'R1', statement: 'requirement',
      scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' },
        { id: 'S2', given: 'g', when: 'w', then: 't' }] }],
    scope: ['src/a', 'src/b'],
  });
  applyPlan(f.dir, [s.file]);
  const d = prepareDesign(f.ctx, {
    specId: s.artifact.id, title: 'Design', body: 'fixture design' });
  applyPlan(f.dir, [d.file]);
  let prepared;
  let plan = null;
  let planTasks = [];
  if (mini || v1) {
    prepared = prepareTask(f.ctx, { title: 'Task', contract: 'C',
      authorContext: 'fixture', scope: ['src/a'], ...(v1 ? {} : {
        specId: s.artifact.id, designId: d.artifact.id, scenarioRefs: pair('S1') }) });
    applyPlan(f.dir, [prepared.file]);
  } else {
    const p = preparePlan(f.ctx, {
      key: 'p1', title: 'Plan', authorContext: 'fixture',
      specId: s.artifact.id, designId: d.artifact.id,
      tasks: [
        { key: 'a', title: 'A', contract: 'C', scope: ['src/a'], scenarioRefs: pair('S1') },
        { key: 'b', title: 'B', contract: 'C', scope: ['src/b'],
          scenarioRefs: pair('S2'), dependsOn: ['a'] },
      ],
    });
    applyPlan(f.dir, p.files);
    plan = p.plan;
    planTasks = plan.tasks.map((r) => getTask(f.ctx, r.id));
    prepared = { task: planTasks[0], file: p.files.find((file) =>
      file.rel === `${f.ctx.config.paths.tasks}/${planTasks[0].id}.json`) };
  }
  // SYNTHETIC valid history. No ACT gate or executed-check claim is used.
  const task = structuredClone(prepared.task);
  for (const to of ['ACT', 'VERIFY', 'EVALUATE', 'REVIEW']) {
    if (state === 'PLAN') break;
    const from = task.state;
    const at = new Date(Date.parse(task.createdAt) + task.revision + 1).toISOString();
    task.revision += 1;
    task.state = to;
    task.updatedAt = at;
    task.history.push({ at, event: 'transition', from, to, revision: task.revision });
  }
  if (state === 'REVIEW') {
    task.verification = {
      checks: [{ command: 'fixture-check', cwd: '.', status: 'pass',
        evidence: 'declared fixture verification pass, NOT execution proof' }],
      coverage: [{ ...pair('S1')[0], checkIndexes: [0] }],
    };
  }
  writeJson(f.dir, prepared.file.rel, task);
  return { ...f, spec: s, design: d, plan, planTasks,
    task: getTask(f.ctx, task.id), taskFile: prepared.file };
}

function input(f, extra = {}) {
  return { taskId: f.task.id, title: ' Operator title ', body, ...extra };
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { recursive: true }).sort();
}

for (const mini of [false, true]) {
  test(`read-only outcome ${mini ? 'mini-plan' : 'full plan'} has exact nine frozen bindings`, () => {
    const f = fixture({ mini });
    try {
      const taskRef = f.taskFile.rel;
      const specRef = f.spec.file.rel;
      const before = filesUnder(f.dir);
      const prepared = prepareOutcomeEvidence(f.ctx, input(f, { references: [
        taskRef.replaceAll('/', '\\'), specRef, taskRef,
      ] }));
      assert.equal(fs.existsSync(prepared.file.abs), false);
      assert.deepEqual(filesUnder(f.dir), before);
      assert.equal(prepared.artifact.schemaVersion, 2);
      assert.equal(prepared.artifact.body, body);
      assert.equal(prepared.artifact.title, ' Operator title ');
      assert.deepEqual(prepared.artifact.references, [taskRef, specRef]);
      for (const rel of prepared.artifact.references) assert.ok(fs.existsSync(`${f.dir}/${rel}`));
      assert.equal(f.task.review, null);
      assert.deepEqual(prepared.artifact.data, {
        schemaVersion: 1, taskId: f.task.id, taskRevision: 4,
        taskDigest: canonicalDigest(taskStaticProjection(f.task)),
        specId: f.spec.artifact.id, specDigest: canonicalDigest(f.spec.artifact),
        designDigest: canonicalDigest(f.design.artifact),
        planDigest: mini ? null : canonicalDigest({
          plan: f.plan, tasks: f.planTasks.map(taskStaticProjection),
        }),
        verificationDigest: canonicalDigest({
          checks: f.task.verification.checks, coverage: f.task.verification.coverage,
        }),
      });
      assert.equal(Object.keys(prepared.artifact.data).length, 9);
      applyPlan(f.dir, [prepared.file]);
      assert.deepEqual(getArtifact(f.ctx, 'report', prepared.artifact.id), prepared.artifact);
    } finally { cleanup(f.dir); }
  });
}

test('verification digest excludes outcome locator and defaults missing coverage to []', () => {
  const f = fixture({ mini: true });
  try {
    delete f.task.verification.coverage;
    writeJson(f.dir, f.taskFile.rel, f.task);
    const a = prepareOutcomeEvidence(f.ctx, input(f));
    f.task.verification.outcomeEvidenceId = crypto.randomUUID();
    writeJson(f.dir, f.taskFile.rel, f.task);
    const b = prepareOutcomeEvidence(f.ctx, input(f));
    assert.equal(a.artifact.data.verificationDigest, b.artifact.data.verificationDigest);
    assert.equal(a.artifact.data.verificationDigest,
      canonicalDigest({ checks: f.task.verification.checks, coverage: [] }));
    assert.notEqual(a.artifact.id, b.artifact.id);
  } finally { cleanup(f.dir); }
});

test('uppercase task/spec record IDs still add actual lowercase file references', () => {
  const f = fixture({ mini: true });
  try {
    f.spec.artifact.id = f.spec.artifact.id.toUpperCase();
    writeJson(f.dir, f.spec.file.rel, f.spec.artifact);
    f.design.artifact.data.specDigest = canonicalDigest(f.spec.artifact);
    writeJson(f.dir, f.design.file.rel, f.design.artifact);
    f.task.id = f.task.id.toUpperCase();
    writeJson(f.dir, f.taskFile.rel, f.task);
    const p = prepareOutcomeEvidence(f.ctx, input(f));
    assert.deepEqual(p.artifact.references, [f.taskFile.rel, f.spec.file.rel]);
  } finally { cleanup(f.dir); }
});

test('unknown caller hashes and invalid references fail without filesystem changes', () => {
  const f = fixture();
  try {
    const before = filesUnder(f.dir);
    for (const field of ['taskDigest', 'specDigest', 'designDigest', 'planDigest',
      'verificationDigest', 'data']) {
      assert.throws(() => prepareOutcomeEvidence(f.ctx, input(f, { [field]: 'caller' })),
        (e) => e.code === 'UNKNOWN_KEY');
    }
    assert.throws(() => prepareOutcomeEvidence(f.ctx, input(f, { references: 'not-array' })),
      (e) => e.code === 'INVALID_VALUE');
    for (const bad of [null, [], 1]) {
      assert.throws(() => prepareOutcomeEvidence(f.ctx, bad),
        (e) => e.code === 'OUTCOME_INVALID');
    }
    for (const id of [[f.task.id], 1, 'invalid']) {
      assert.throws(() => prepareOutcomeEvidence(f.ctx, { ...input(f), taskId: id }),
        (e) => e.code === 'INVALID_ID');
    }
    assert.deepEqual(filesUnder(f.dir), before);
  } finally { cleanup(f.dir); }
});

for (const options of [{ state: 'PLAN' }, { v1: true }]) {
  test(`outcome requires actual formal REVIEW: ${JSON.stringify(options)}`, () => {
    const f = fixture(options);
    try {
      const before = filesUnder(f.dir);
      assert.throws(() => prepareOutcomeEvidence(f.ctx, input(f)),
        (e) => e.code === 'OUTCOME_INVALID');
      assert.deepEqual(filesUnder(f.dir), before);
    } finally { cleanup(f.dir); }
  });
}

test('missing current verification is invalid; malformed stored checks remain TASK_MALFORMED', () => {
  const f = fixture();
  try {
    f.task.verification = null;
    writeJson(f.dir, f.taskFile.rel, f.task);
    assert.throws(() => prepareOutcomeEvidence(f.ctx, input(f)),
      (e) => e.code === 'OUTCOME_INVALID');
    f.task.verification = { checks: [] };
    writeJson(f.dir, f.taskFile.rel, f.task);
    assert.throws(() => prepareOutcomeEvidence(f.ctx, input(f)),
      (e) => e.code === 'TASK_MALFORMED');
  } finally { cleanup(f.dir); }
});

test('foreign issues attach to OUTCOME_INVALID with no files created', () => {
  const f = fixture();
  try {
    fs.unlinkSync(f.spec.file.abs);
    const before = filesUnder(f.dir);
    assert.throws(() => prepareOutcomeEvidence(f.ctx, input(f)), (e) =>
      e.code === 'OUTCOME_INVALID' && e.issues.length >= 2);
    assert.deepEqual(filesUnder(f.dir), before);
  } finally { cleanup(f.dir); }
});

test('historical report remains readable after actual task/spec removal', () => {
  const f = fixture();
  try {
    const p = prepareOutcomeEvidence(f.ctx, input(f));
    applyPlan(f.dir, [p.file]);
    fs.unlinkSync(f.taskFile.abs);
    fs.unlinkSync(f.spec.file.abs);
    assert.deepEqual(getArtifact(f.ctx, 'report', p.artifact.id), p.artifact);
  } finally { cleanup(f.dir); }
});
