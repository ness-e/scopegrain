import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkMethodology } from '../src/core/methodology.mjs';
import { createTask, getTask, taskFilePath } from '../src/core/tasks.mjs';
import { prepareArtifact, renderSpecification } from '../src/core/artifacts.mjs';
import { prepareDesign } from '../src/core/specifications.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { describeApprovalTarget, getApproval } from '../src/core/approvals.mjs';
import {
  assessment, approve, approveFormal, approvalTarget, formalFixture,
  lightFixture, outcome, reanswer, saveApproval, savePlan, saveTask, seedState,
  snapshot, verification, waiver,
} from './methodology-fixtures.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

function query(f, input = {}) {
  const before = snapshot(f.dir);
  try {
    return checkMethodology(f.ctx, { taskId: f.task.id, ...input });
  } finally { assert.deepEqual(snapshot(f.dir), before, 'query must be read-only'); }
}
function has(result, code, label) {
  assert.equal(result.allowed, false);
  assert.ok(result.issues.some((i) => i.code === code
    && (!label || i.message.includes(label))), JSON.stringify(result.issues));
}
function assertAllowed(f, opts) {
  const r = query(f, opts);
  assert.equal(r.allowed, true, JSON.stringify(r.issues));
  assert.deepEqual(r.issues, []);
  return r;
}
function acceptedFixture(options = {}) {
  const f = formalFixture(options);
  f.task = seedState(f, f.task);
  f.report = outcome(f);
  f.acceptOpts = { to: 'ACCEPT', outcomeEvidenceId: f.report.artifact.id };
  assertAllowed(f, f.acceptOpts);
  return f;
}

test('manual V1 unchanged; strict mode never rewrites old task/history', () => {
  const f = bootstrappedCtx();
  try {
    f.task = createTask(f.ctx, { title: 'Legacy', contract: 'C',
      authorContext: 'a', scope: [] });
    const r = query(f);
    assert.deepEqual(r, { mode: 'manual', enforced: false, allowed: true,
      route: 'manual', classificationBasis: 'operator-attestation', issues: [],
      authenticatesEvidence: false, interceptsNativeTools: false });
    assertAllowed(f, { to: 'ACCEPT' }); // methodology only, not an edge/evidence bypass
    for (const mode of ['organic-sdd', 'sdd']) {
      f.ctx.config.methodology = mode;
      assert.equal(getTask(f.ctx, f.task.id).schemaVersion, 1);
      has(query(f), 'METHODOLOGY_REQUIRED');
    }
  } finally { cleanup(f.dir); }
});

for (const mode of ['manual', 'organic-sdd']) {
  test(`light ${mode} needs safe scope and only checks/review for ACCEPT`, () => {
    const f = lightFixture({ mode });
    try {
      const r = assertAllowed(f);
      assert.equal(r.enforced, true);
      assert.equal(r.route, 'light');
      has(query(f, { to: 'ACCEPT' }), 'INVALID_EVIDENCE', 'verification');
      has(query(f, { to: 'ACCEPT' }), 'INVALID_EVIDENCE', 'review');
      f.task = seedState(f, f.task, 'REVIEW', { checks: verification().checks });
      assertAllowed(f, { to: 'ACCEPT' });
      saveTask(f, { ...f.task, review: waiver() });
      assertAllowed(f, { to: 'ACCEPT' });
      f.ctx.config.methodology = 'sdd';
      has(query(f), 'METHODOLOGY_REQUIRED');
      assert.equal(query(f).route, 'sdd');
    } finally { cleanup(f.dir); }
  });
}

for (const status of ['missing', 'declined']) {
  test(`formal refs never override all ${status} authorization/classifier blockers`, () => {
    const f = formalFixture();
    try {
      saveTask(f, { ...f.task, methodology: assessment({
        authorization: status === 'missing'
          ? { status, actor: null, reference: null }
          : { status, actor: 'owner', reference: 'explicit decline' },
        understanding: 'insufficient', uncertainty: 'unresolved', risk: 'unknown',
      }) });
      const r = query(f);
      assert.equal(r.route, 'blocked');
      assert.deepEqual(r.issues.map((i) => i.code), [
        status === 'missing' ? 'AUTHORIZATION_MISSING' : 'AUTHORIZATION_DECLINED',
        'UNDERSTANDING_INSUFFICIENT', 'UNCERTAINTY_UNRESOLVED', 'RISK_UNKNOWN',
      ]);
    } finally { cleanup(f.dir); }
  });
}

test('read-only wins formal refs/strict mode/missing authorization without approval requests', () => {
  const f = formalFixture({ approved: false });
  try {
    saveTask(f, { ...f.task, methodology: assessment({ intent: 'read-only',
      authorization: { status: 'missing', actor: null, reference: null } }) });
    f.ctx.config.methodology = 'sdd';
    for (const to of ['ACT', 'ACCEPT']) {
      const r = query(f, { to });
      assert.equal(r.route, 'read-only');
      assert.deepEqual(r.issues.map((i) => i.code), ['READ_ONLY_INTENT']);
    }
  } finally { cleanup(f.dir); }
});

test('formal mini-plan permits ACT only after actual spec/design/task approval', () => {
  const f = formalFixture({ approved: false });
  try {
    assert.equal(query(f).issues.filter((i) => i.code === 'APPROVAL_NOT_FOUND').length, 3);
    approveFormal(f);
    assert.equal(assertAllowed(f).route, 'sdd');
  } finally { cleanup(f.dir); }
});

for (const kind of ['spec', 'design', 'task', 'plan', 'report']) {
  for (const answer of ['pending', 'reject', 'decline', 'custom', 'revoke']) {
    test(`${kind} ${answer} blocks from complete valid approval baseline`, () => {
      const f = kind === 'report' ? acceptedFixture()
        : formalFixture({ mini: kind !== 'plan' });
      try {
        assertAllowed(f, f.acceptOpts);
        const a = kind === 'report' ? f.report.approval : f.approvals[kind];
        if (answer === 'pending') {
          // Restore the real factory's initial record, not a malformed status edit.
          fs.writeFileSync(a.file.abs, a.file.content);
        } else {
          reanswer(f, a, answer);
        }
        has(query(f, f.acceptOpts), 'APPROVAL_NOT_APPROVED', kind);
      } finally { cleanup(f.dir); }
    });
  }
  test(`${kind} approval exact path case/duplicates matter; UUID target case does not`, () => {
    const f = kind === 'report' ? acceptedFixture()
      : formalFixture({ mini: kind !== 'plan' });
    try {
      assertAllowed(f, f.acceptOpts);
      const a = kind === 'report' ? f.report.approval : f.approvals[kind];
      if (kind !== 'plan') {
        saveApproval(f, a, (r) => { r.target.id = r.target.id.toUpperCase(); });
        assertAllowed(f, f.acceptOpts);
      }
      saveApproval(f, a, (r) => { r.scope.paths[0] = r.scope.paths[0].toUpperCase(); });
      has(query(f, f.acceptOpts), 'APPROVAL_SCOPE_CHANGED', kind);
      saveApproval(f, a, (r) => { r.scope.paths.push(r.scope.paths[0]); });
      has(query(f, f.acceptOpts), 'APPROVAL_SCOPE_CHANGED', kind);
      saveApproval(f, a, (r) => { r.scope.paths.reverse(); });
      assertAllowed(f, f.acceptOpts); // order alone is not scope drift
    } finally { cleanup(f.dir); }
  });
  test(`${kind} structurally valid stale approval target cannot authorize current content`, () => {
    const f = kind === 'report' ? acceptedFixture()
      : formalFixture({ mini: kind !== 'plan' });
    try {
      assertAllowed(f, f.acceptOpts);
      const a = kind === 'report' ? f.report.approval : f.approvals[kind];
      saveApproval(f, a, (r) => {
        r.target.id = kind === 'plan' ? 'other-valid-plan-key' : crypto.randomUUID();
      });
      has(query(f, f.acceptOpts), 'APPROVAL_STALE', kind);
    } finally { cleanup(f.dir); }
  });
}

test('current approved target semantic identity/kind/digest must match descriptor', () => {
  const f = formalFixture();
  try {
    const a = f.approvals.design;
    for (const change of [
      (r) => { r.target.id = crypto.randomUUID(); },
      (r) => { r.target.artifactKind = 'report'; },
    ]) {
      saveApproval(f, a, change);
      has(query(f), 'APPROVAL_STALE', 'design');
    }
  } finally { cleanup(f.dir); }
});

test('open questions block even with synthetically seeded approved spec record', () => {
  const f = formalFixture({ approved: false, openQuestions: ['owner must decide'] });
  try {
    const a = approve(f, 'spec', f.spec.artifact.id, 'pending');
    // SYNTHETIC valid approval history solely to exercise the gate defense.
    saveApproval(f, a, (r) => {
      r.status = 'approved'; r.revision = 1;
      r.history.push({ at: r.createdAt, event: 'answered', revision: 1,
        status: 'approved', actor: 'synthetic-owner', answer: 'approve', comment: null });
    });
    approve(f, 'design', f.design.artifact.id);
    approve(f, 'task', f.task.id);
    has(query(f), 'APPROVAL_OPEN_QUESTIONS');
  } finally { cleanup(f.dir); }
});

for (const drift of ['spec', 'design', 'task scope', 'plan dependencies']) {
  test(`current ${drift} drift invalidates approved gate`, () => {
    const f = formalFixture({ mini: drift !== 'plan dependencies' });
    try {
      assertAllowed(f);
      if (drift === 'spec') {
        const s = structuredClone(f.spec.artifact);
        s.data.outcome.statement += ' changed';
        s.body = renderSpecification(s.title, s.data);
        fs.writeFileSync(f.spec.file.abs, JSON.stringify(s));
        has(query(f), 'ARTIFACT_DRIFT', 'design');
        has(query(f), 'APPROVAL_NOT_FOUND', 'spec');
      } else if (drift === 'design') {
        const d = prepareDesign(f.ctx, { specId: f.spec.artifact.id,
          title: 'Alternative valid design', body: 'new design decision' });
        applyPlan(f.dir, [d.file]);
        saveTask(f, { ...f.task, designId: d.artifact.id });
        has(query(f), 'APPROVAL_NOT_FOUND', 'design');
        has(query(f), 'APPROVAL_NOT_FOUND', 'task');
      } else if (drift === 'task scope') {
        saveTask(f, { ...f.task, scope: ['src/b'] });
        has(query(f), 'APPROVAL_NOT_FOUND', 'task');
      } else {
        const p = structuredClone(f.formalPlan);
        p.tasks[1].dependsOn = [];
        savePlan(f, p);
        has(query(f), 'APPROVAL_NOT_FOUND', 'plan');
      }
    } finally { cleanup(f.dir); }
  });
}

test('missing/corrupt foreign artifacts and approvals accumulate contextual leaf errors', () => {
  const f = formalFixture({ mini: false });
  try {
    fs.unlinkSync(f.spec.file.abs);
    fs.writeFileSync(f.design.file.abs, '{broken');
    fs.unlinkSync(f.approvals.plan.file.abs);
    const r = query(f);
    has(r, 'ARTIFACT_NOT_FOUND', 'spec');
    has(r, 'ARTIFACT_MALFORMED', 'design');
    has(r, 'APPROVAL_NOT_FOUND', 'plan');
    assert.ok(r.issues.every((i) => !i.message.includes('TypeError')));
  } finally { cleanup(f.dir); }
});

test('multiple missing/corrupt approvals are all reported independently', () => {
  const f = formalFixture();
  try {
    fs.unlinkSync(f.approvals.spec.file.abs);
    fs.writeFileSync(f.approvals.design.file.abs, '{bad');
    fs.unlinkSync(f.approvals.task.file.abs);
    const r = query(f);
    has(r, 'APPROVAL_NOT_FOUND', 'spec');
    has(r, 'APPROVAL_MALFORMED', 'design');
    has(r, 'APPROVAL_NOT_FOUND', 'task');
  } finally { cleanup(f.dir); }
});

test('transitive A->B->C: synthetic B CLOSE cannot hide open A; unrelated future C is irrelevant to A', () => {
  const f = formalFixture({ mini: false, three: true });
  try {
    assertAllowed(f); // C/B need not be CLOSE for A.
    const a = seedState(f, f.task, 'ACT', null);
    const b = getTask(f.ctx, f.formalPlan.tasks[1].id);
    seedState(f, b, 'CLOSE');
    const p = structuredClone(f.formalPlan);
    for (const ref of p.tasks) ref.id = ref.id.toUpperCase();
    savePlan(f, p);
    approve(f, 'plan', p.key);
    const r = query(f, { taskId: p.tasks[2].id });
    has(r, 'PLAN_DEPENDENCY_OPEN', "'a'");
    assert.ok(!r.issues.some((i) => i.code === 'PLAN_DEPENDENCY_OPEN'
      && i.message.includes("'b'")));
    seedState(f, a, 'CLOSE');
    assertAllowed(f, { taskId: p.tasks[2].id });
  } finally { cleanup(f.dir); }
});

test('public closed input/locator/own task errors are structured and read-only', () => {
  const f = lightFixture();
  try {
    for (const [input, code] of [
      [null, 'INVALID_ARGS'], [[], 'INVALID_ARGS'], ['x', 'INVALID_ARGS'],
      [{}, 'INVALID_ID'], [{ taskId: f.task.id, unknown: 1 }, 'UNKNOWN_KEY'],
      [{ taskId: [f.task.id] }, 'INVALID_ID'],
      [{ taskId: crypto.randomUUID() }, 'TASK_NOT_FOUND'],
      [{ taskId: f.task.id, to: 'CLOSE' }, 'INVALID_STATE'],
      [{ taskId: f.task.id, to: null }, 'INVALID_STATE'],
      [{ taskId: f.task.id, outcomeEvidenceId: crypto.randomUUID() }, 'INVALID_ARGS'],
      [{ taskId: f.task.id, to: 'ACCEPT', outcomeEvidenceId: [] }, 'INVALID_ARGS'],
      [{ taskId: f.task.id, to: 'ACCEPT', outcomeEvidenceId: null }, 'INVALID_ARGS'],
      [{ taskId: f.task.id, to: 'ACCEPT', outcomeEvidenceId: 'bad' }, 'INVALID_ARGS'],
    ]) {
      const before = snapshot(f.dir);
      assert.throws(() => checkMethodology(f.ctx, input), (e) => e.code === code);
      assert.deepEqual(snapshot(f.dir), before);
    }
    fs.writeFileSync(taskFilePath(f.ctx, f.task.id), '{bad');
    assert.throws(() => query(f), (e) => e.code === 'TASK_MALFORMED');
  } finally { cleanup(f.dir); }
});

test('light current scope resolution rejects a real new junction in ACT and ACCEPT', () => {
  const f = lightFixture();
  try {
    assertAllowed(f);
    f.task = seedState(f, f.task, 'REVIEW', { checks: verification().checks });
    assertAllowed(f, { to: 'ACCEPT' });
    fs.mkdirSync(path.join(f.dir, 'src'));
    fs.mkdirSync(path.join(f.dir, 'actual-target'));
    fs.symlinkSync(path.join(f.dir, 'actual-target'), path.join(f.dir, 'src/a'), 'junction');
    assert.ok(fs.lstatSync(path.join(f.dir, 'src/a')).isSymbolicLink());
    has(query(f), 'SYMLINK_REJECTED', 'scope');
    has(query(f, { to: 'ACCEPT' }), 'SYMLINK_REJECTED', 'scope');
  } finally { cleanup(f.dir); }
});

test('missing plan plus missing spec preserves multiple contextual foreign errors', () => {
  const f = formalFixture({ mini: false });
  try {
    assertAllowed(f);
    fs.unlinkSync(f.spec.file.abs);
    fs.unlinkSync(path.join(f.dir, f.ctx.config.paths.plans, `${f.formalPlan.key}.json`));
    const r = query(f);
    has(r, 'ARTIFACT_NOT_FOUND', 'spec');
    has(r, 'PLAN_NOT_FOUND', 'plan');
  } finally { cleanup(f.dir); }
});

for (const change of ['spec', 'design', 'task scope', 'plan']) {
  test(`old outcome rejects current ${change} drift after re-approval of healthy bindings`, () => {
    const f = acceptedFixture({ mini: change !== 'plan' });
    try {
      if (change === 'spec') {
        const s = structuredClone(f.spec.artifact);
        s.data.outcome.statement += ' changed current outcome';
        s.body = renderSpecification(s.title, s.data);
        fs.writeFileSync(f.spec.file.abs, JSON.stringify(s));
        const d = prepareDesign(f.ctx, {
          specId: s.id, title: 'Rebound design', body: 'coherent current design',
        });
        applyPlan(f.dir, [d.file]);
        f.design = d;
        f.task = saveTask(f, { ...f.task, designId: d.artifact.id });
      } else if (change === 'design') {
        const d = prepareDesign(f.ctx, {
          specId: f.task.specId, title: 'Alternative design', body: 'different design',
        });
        applyPlan(f.dir, [d.file]);
        f.design = d;
        f.task = saveTask(f, { ...f.task, designId: d.artifact.id });
      } else if (change === 'task scope') {
        f.task = saveTask(f, { ...f.task, scope: ['src/b'] });
      } else {
        const p = structuredClone(f.formalPlan);
        p.tasks[1].dependsOn = [];
        savePlan(f, p);
      }
      // Only content-bound approvals are renewed; the report remains old.
      // Spec/design unchanged in some cases already have identical files.
      // Reuse existing approved records instead of re-applying pending files.
      for (const [kind, id] of [['spec', f.task.specId], ['design', f.task.designId],
        [f.formalPlan ? 'plan' : 'task', f.formalPlan?.key ?? f.task.id]]) {
        const desc = describeApprovalTarget(f.ctx, approvalTarget(kind, id));
        try { assert.equal(getApproval(f.ctx, desc.target.digest).status, 'approved'); }
        catch (e) {
          if (e.code !== 'APPROVAL_NOT_FOUND') throw e;
          approve(f, kind, id);
        }
      }
      assertAllowed(f);
      has(query(f, f.acceptOpts), 'OUTCOME_BINDING_MISMATCH', ({
        spec: 'specDigest', design: 'designDigest',
        'task scope': 'taskDigest', plan: 'planDigest',
      })[change]);
      const current = outcome(f);
      assertAllowed(f, { to: 'ACCEPT', outcomeEvidenceId: current.artifact.id });
    } finally { cleanup(f.dir); }
  });
}

for (const coverage of ['unknown', 'missing', 'extra', 'casefold']) {
  test(`formal ACCEPT coverage ${coverage} is compared against THIS task assignments`, () => {
    const f = formalFixture();
    try {
      const v = verification(coverage === 'extra' ? ['S1', 'S2']
        : coverage === 'unknown' ? ['S3'] : ['S1']);
      if (coverage === 'missing') delete v.coverage;
      if (coverage === 'casefold') {
        v.coverage[0].requirementId = 'r1'; v.coverage[0].scenarioId = 's1';
      }
      f.task = seedState(f, f.task, 'REVIEW', v);
      const r = outcome(f);
      const opts = { to: 'ACCEPT', outcomeEvidenceId: r.artifact.id.toUpperCase() };
      if (coverage === 'casefold') {
        assertAllowed(f, opts);
        assert.equal(getTask(f.ctx, f.task.id).verification.coverage[0].scenarioId, 's1');
      } else has(query(f, opts), 'SCENARIO_COVERAGE_MISMATCH');
    } finally { cleanup(f.dir); }
  });
}

for (const error of ['duplicate', 'index']) {
  test(`own task structurally invalid coverage ${error} keeps D1 getter error`, () => {
    const f = formalFixture();
    try {
      const t = seedState(f, f.task);
      if (error === 'duplicate') t.verification.coverage.push(t.verification.coverage[0]);
      else t.verification.coverage[0].checkIndexes = [1];
      fs.writeFileSync(taskFilePath(f.ctx, t.id), JSON.stringify(t));
      assert.throws(() => query(f, { to: 'ACCEPT' }), (e) => e.code === 'TASK_MALFORMED');
    } finally { cleanup(f.dir); }
  });
}

test('formal ACCEPT missing locator and independent verification/review errors accumulate', () => {
  const f = formalFixture();
  try {
    const r = query(f, { to: 'ACCEPT' });
    has(r, 'INVALID_EVIDENCE', 'verification');
    has(r, 'INVALID_EVIDENCE', 'review');
    has(r, 'OUTCOME_REQUIRED');
  } finally { cleanup(f.dir); }
});

for (const kind of ['V1 report', 'wrong artifact', 'missing report', 'corrupt report']) {
  test(`formal ACCEPT rejects ${kind} from otherwise approved baseline`, () => {
    const f = acceptedFixture();
    try {
      let id;
      if (kind === 'V1 report') {
        const p = prepareArtifact(f.ctx, 'report', { title: 'Old report', body: 'legacy' });
        applyPlan(f.dir, [p.file]); id = p.artifact.id;
      } else if (kind === 'wrong artifact') id = f.design.artifact.id;
      else if (kind === 'missing report') id = crypto.randomUUID();
      else {
        id = f.report.artifact.id;
        fs.writeFileSync(f.report.file.abs, '{bad');
      }
      const r = query(f, { to: 'ACCEPT', outcomeEvidenceId: id });
      has(r, kind === 'V1 report' ? 'OUTCOME_BINDING_MISMATCH'
        : kind === 'corrupt report' ? 'ARTIFACT_MALFORMED' : 'ARTIFACT_NOT_FOUND');
    } finally { cleanup(f.dir); }
  });
}

for (const field of ['taskId', 'taskRevision', 'taskDigest', 'specId',
  'specDigest', 'designDigest', 'planDigest', 'verificationDigest']) {
  test(`formal ACCEPT report field ${field} compared to current records/revision`, () => {
    const f = acceptedFixture({ mini: field !== 'planDigest' });
    try {
      const report = structuredClone(f.report.artifact);
      if (field === 'taskId') {
        report.data.taskId = createTask(f.ctx, {
          title: 'Other real task', contract: 'C', authorContext: 'fixture',
          scope: ['src/a'], methodology: assessment(),
        }).id;
      } else if (field.endsWith('Id')) report.data[field] = crypto.randomUUID();
      else if (field === 'taskRevision') report.data[field] -= 1;
      else report.data[field] = '0'.repeat(64);
      fs.writeFileSync(f.report.file.abs, JSON.stringify(report));
      approve(f, 'report', report.id);
      has(query(f, f.acceptOpts), 'OUTCOME_BINDING_MISMATCH', field);
    } finally { cleanup(f.dir); }
  });
}

test('report UUID case spelling is semantic, nine field shape stays frozen', () => {
  const f = acceptedFixture();
  try {
    const report = structuredClone(f.report.artifact);
    report.data.taskId = report.data.taskId.toUpperCase();
    report.data.specId = report.data.specId.toUpperCase();
    fs.writeFileSync(f.report.file.abs, JSON.stringify(report));
    approve(f, 'report', report.id);
    assertAllowed(f, f.acceptOpts);
    assert.equal(Object.keys(report.data).length, 9);
  } finally { cleanup(f.dir); }
});

test('report approval independently required/revocable; plan approval alone is insufficient', () => {
  const f = acceptedFixture({ mini: false });
  try {
    fs.unlinkSync(f.report.approval.file.abs);
    has(query(f, f.acceptOpts), 'APPROVAL_NOT_FOUND', 'report');
    const a = approve(f, 'report', f.report.artifact.id);
    assertAllowed(f, f.acceptOpts);
    reanswer(f, a, 'revoke');
    has(query(f, f.acceptOpts), 'APPROVAL_NOT_APPROVED', 'report');
  } finally { cleanup(f.dir); }
});

test('current verification/revision drift invalidates report even with unchanged static approval', () => {
  const f = acceptedFixture();
  try {
    const t = structuredClone(f.task);
    t.verification.checks[0].evidence = 'changed declared evidence';
    saveTask(f, t);
    has(query(f, f.acceptOpts), 'OUTCOME_BINDING_MISMATCH', 'verificationDigest');
    t.verification = f.task.verification;
    t.revision += 1;
    t.history.push({ at: t.createdAt, event: 'synthetic', revision: t.revision });
    saveTask(f, t);
    has(query(f, f.acceptOpts), 'OUTCOME_BINDING_MISMATCH', 'taskRevision');
  } finally { cleanup(f.dir); }
});

test('formal current review is required; explicit waiver works without fabricated query state', () => {
  const f = acceptedFixture();
  try {
    saveTask(f, { ...f.task, review: null });
    has(query(f, f.acceptOpts), 'INVALID_EVIDENCE', 'review');
    saveTask(f, { ...f.task, review: waiver() });
    assertAllowed(f, f.acceptOpts);
    // Query replaces locator in a clone, preserving stored checks/review/revision.
    assert.equal(getTask(f.ctx, f.task.id).verification.outcomeEvidenceId, undefined);
  } finally { cleanup(f.dir); }
});
