// The causal RED regression intentionally imports ONLY existing APIs, not
// methodology.mjs, so an import failure cannot stand in for the ACT bypass.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { transitionTask } from '../src/core/transition.mjs';
import { getTask, taskFilePath } from '../src/core/tasks.mjs';
import {
  formalFixture, fresh, lightFixture, outcome, snapshot,
  verification, waiver,
} from './methodology-fixtures.mjs';
import { cleanup } from './helpers.mjs';

function move(f, to, extra = {}, id = f.task.id) {
  return transitionTask(f.ctx, { id, to,
    expectedRevision: getTask(f.ctx, id).revision, ...extra });
}
function toReview(f) {
  move(f, 'ACT');
  move(f, 'VERIFY');
  move(f, 'EVALUATE');
  return move(f, 'REVIEW', { verification: verification(), review: fresh(f.task) });
}
function blocked(f, run, code) {
  const before = snapshot(f.dir);
  assert.throws(run, (e) => {
    assert.equal(e.code, 'METHODOLOGY_BLOCKED');
    assert.ok(e.issues.some((i) => i.code === code), JSON.stringify(e.issues));
    assert.deepEqual(e.issues, e.result.issues);
    assert.equal(e.message, 'methodology gate blocked ACT: '
      + `${e.issues[0].code}: ${e.issues[0].message}`);
    return true;
  });
  assert.deepEqual(snapshot(f.dir), before);
}

test('causal RED: existing ACT API must block missing formal approvals without writes', () => {
  const f = formalFixture({ approved: false });
  try {
    blocked(f, () => move(f, 'ACT'), 'APPROVAL_NOT_FOUND');
  } finally { cleanup(f.dir); }
});

test('failed gate precedes all mkdir/temp/rename operations, not only final replacement', (t) => {
  const f = formalFixture({ approved: false });
  try {
    t.mock.method(fs, 'mkdirSync', () => { assert.fail('gate must precede mkdir'); });
    t.mock.method(fs, 'renameSync', () => { assert.fail('gate must precede rename'); });
    const realOpen = fs.openSync;
    t.mock.method(fs, 'openSync', (file, flags, ...rest) => {
      assert.ok(!(flags === 'wx' && String(file).includes('.tmp-')),
        'gate must precede temp file creation');
      return realOpen(file, flags, ...rest);
    });
    blocked(f, () => move(f, 'ACT'), 'APPROVAL_NOT_FOUND');
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});

test('actual disjoint S1/S2 plan: first report and CLOSE unlock only its successor', () => {
  const f = formalFixture({ mini: false });
  try {
    const b = f.formalPlan.tasks[1].id;
    assert.throws(() => move(f, 'ACT', {}, b),
      (e) => e.code === 'METHODOLOGY_BLOCKED'
        && e.issues.some((i) => i.code === 'PLAN_DEPENDENCY_OPEN'));
    const reviewTask = toReview(f);
    const r = outcome(f, reviewTask);
    const accepted = move(f, 'ACCEPT', {
      verification: { ...reviewTask.verification, outcomeEvidenceId: r.artifact.id },
      review: reviewTask.review,
    });
    assert.equal(accepted.state, 'ACCEPT');
    assert.deepEqual(accepted.verification.coverage.map((c) => c.scenarioId), ['S1']);
    move(f, 'CLOSE');
    assert.equal(move(f, 'ACT', {}, b).state, 'ACT');
  } finally { cleanup(f.dir); }
});

for (const reviewMode of ['fresh', 'waived']) {
  test(`formal ACCEPT ${reviewMode} succeeds; new verification must re-supply review`, () => {
    const f = formalFixture();
    try {
      const t = toReview(f);
      const r = outcome(f, t);
      const v = { ...t.verification, outcomeEvidenceId: r.artifact.id };
      const before = snapshot(f.dir);
      assert.throws(() => move(f, 'ACCEPT', { verification: v }),
        (e) => e.code === 'ACCEPT_REQUIRES_REVIEW');
      assert.deepEqual(snapshot(f.dir), before);
      const accepted = move(f, 'ACCEPT', { verification: v,
        review: reviewMode === 'fresh' ? fresh(t) : waiver() });
      assert.equal(accepted.state, 'ACCEPT');
      const act = move(f, 'ACT');
      assert.equal(act.verification, null);
      assert.equal(act.review, null);
    } finally { cleanup(f.dir); }
  });
}

test('re-entered review cycle rejects old revision report and accepts new approved report', () => {
  const f = formalFixture();
  try {
    const t = toReview(f);
    const r = outcome(f, t);
    move(f, 'ACT');
    move(f, 'VERIFY'); move(f, 'EVALUATE');
    const current = move(f, 'REVIEW', {
      verification: verification(), review: fresh(t),
    });
    const before = snapshot(f.dir);
    assert.throws(() => move(f, 'ACCEPT', {
      verification: { ...current.verification, outcomeEvidenceId: r.artifact.id },
      review: current.review,
    }), (e) => e.code === 'METHODOLOGY_BLOCKED'
      && e.issues.some((i) => i.code === 'OUTCOME_BINDING_MISMATCH'
        && i.message.includes('taskRevision')));
    assert.deepEqual(snapshot(f.dir), before);
    const next = outcome(f, current);
    assert.equal(move(f, 'ACCEPT', {
      verification: { ...current.verification, outcomeEvidenceId: next.artifact.id },
      review: current.review,
    }).state, 'ACCEPT');
  } finally { cleanup(f.dir); }
});

test('light real transition ACCEPT needs checks and review, no formal artifacts/report', () => {
  const f = lightFixture({ mode: 'organic-sdd' });
  try {
    move(f, 'ACT'); move(f, 'VERIFY'); move(f, 'EVALUATE'); move(f, 'REVIEW');
    const before = snapshot(f.dir);
    const checks = { checks: verification().checks };
    assert.throws(() => move(f, 'ACCEPT', { verification: checks }),
      (e) => e.code === 'ACCEPT_REQUIRES_REVIEW');
    assert.deepEqual(snapshot(f.dir), before);
    assert.throws(() => move(f, 'ACCEPT', { verification: checks,
      review: { ...fresh(f.task), reviewerContext: f.task.authorContext } }),
    (e) => e.code === 'INVALID_EVIDENCE');
    assert.deepEqual(snapshot(f.dir), before);
    const accepted = move(f, 'ACCEPT', { verification: checks, review: waiver() });
    assert.equal(accepted.state, 'ACCEPT');
    assert.equal(accepted.verification.outcomeEvidenceId, undefined);
  } finally { cleanup(f.dir); }
});

for (const missing of ['locator', 'approval', 'coverage']) {
  test(`formal transition ACCEPT blocks missing ${missing} without writes`, () => {
    const f = formalFixture();
    try {
      const t = toReview(f);
      const r = outcome(f, t, missing !== 'approval');
      const v = { ...t.verification,
        ...(missing === 'locator' ? {} : { outcomeEvidenceId: r.artifact.id }) };
      if (missing === 'coverage') delete v.coverage;
      const before = snapshot(f.dir);
      assert.throws(() => move(f, 'ACCEPT', { verification: v, review: t.review }),
        (e) => {
          assert.equal(e.code, 'METHODOLOGY_BLOCKED');
          assert.ok(e.issues.some((i) => i.code === ({
            locator: 'OUTCOME_REQUIRED', approval: 'APPROVAL_NOT_FOUND',
            coverage: 'SCENARIO_COVERAGE_MISMATCH',
          })[missing]), JSON.stringify(e.issues));
          assert.equal(e.message, `methodology gate blocked ACCEPT: `
            + `${e.issues[0].code}: ${e.issues[0].message}`);
          return true;
        });
      assert.deepEqual(snapshot(f.dir), before);
    } finally { cleanup(f.dir); }
  });
}

test('malformed transition DTOs and unsafe revision fail before lock/directory creation', () => {
  const f = lightFixture();
  try {
    for (const [input, code] of [[null, 'INVALID_ARGS'], [[], 'INVALID_ARGS'],
      ['x', 'INVALID_ARGS'], [{}, 'INVALID_STATE'],
      [{ id: f.task.id, to: 'ACT', extra: true }, 'UNKNOWN_KEY'],
      [{ id: f.task.id, to: 'ACT', expectedRevision: 2 ** 53 }, 'REVISION_MISMATCH']]) {
      const before = snapshot(f.dir);
      assert.throws(() => transitionTask(f.ctx, input), (e) => e.code === code);
      assert.deepEqual(snapshot(f.dir), before);
    }
    const missingCtx = { ...f.ctx, config: { ...f.ctx.config, paths: {
      ...f.ctx.config.paths, tasks: 'absent/tasks',
    } } };
    assert.throws(() => transitionTask(missingCtx, {
      id: f.task.id, to: 'ACT', expectedRevision: 0,
    }), (e) => e.code === 'TASK_NOT_FOUND');
    assert.ok(!fs.existsSync(path.join(f.dir, 'absent')));
  } finally { cleanup(f.dir); }
});

test('stale CAS and foreign lock preserve all bytes and foreign ownership', () => {
  const f = lightFixture();
  try {
    const before = snapshot(f.dir);
    assert.throws(() => transitionTask(f.ctx, {
      id: f.task.id, to: 'ACT', expectedRevision: 1,
    }), (e) => e.code === 'REVISION_MISMATCH');
    assert.deepEqual(snapshot(f.dir), before);
    const lock = taskFilePath(f.ctx, f.task.id) + '.lock';
    fs.writeFileSync(lock, 'foreign-sentinel', { flag: 'wx' });
    const held = snapshot(f.dir);
    assert.throws(() => move(f, 'ACT'), (e) => e.code === 'TASK_LOCKED');
    assert.deepEqual(snapshot(f.dir), held);
  } finally { cleanup(f.dir); }
});

test('transition own lock close EIO is cleaned after real close; foreign sentinel survives', (t) => {
  const f = lightFixture();
  try {
    const before = snapshot(f.dir);
    const realClose = fs.closeSync;
    t.mock.method(fs, 'closeSync', (fd) => {
      realClose(fd);
      throw Object.assign(new Error('injected close EIO'), { code: 'EIO' });
    });
    assert.throws(() => transitionTask(f.ctx, {
      id: f.task.id, to: 'ACT', expectedRevision: 0,
    }), (e) => e.code === 'EIO');
    t.mock.restoreAll();
    assert.deepEqual(snapshot(f.dir), before);
    const lock = taskFilePath(f.ctx, f.task.id) + '.lock';
    fs.writeFileSync(lock, 'foreign-sentinel', { flag: 'wx' });
    assert.throws(() => move(f, 'ACT'), (e) => e.code === 'TASK_LOCKED');
    assert.equal(fs.readFileSync(lock, 'utf8'), 'foreign-sentinel');
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});

test('rename failure and clock regression leave task/temporary ownership intact', (t) => {
  const f = lightFixture();
  try {
    const before = snapshot(f.dir);
    t.mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('injected rename'), { code: 'EIO' });
    });
    assert.throws(() => move(f, 'ACT'), (e) => e.code === 'EIO');
    t.mock.restoreAll();
    assert.deepEqual(snapshot(f.dir), before);
    // Only "now" regresses; parsing/validating actual stored timestamps is
    // unchanged, so the failure comes from the prospective next record.
    const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [0])); }
    };
    try {
      assert.equal(getTask(f.ctx, f.task.id).revision, 0);
      assert.throws(() => move(f, 'ACT'), (e) => e.code === 'TASK_MALFORMED'
        && e.message.includes('createdAt must not exceed updatedAt'));
    } finally { globalThis.Date = RealDate; }
    assert.deepEqual(snapshot(f.dir), before);
  } finally { t.mock.restoreAll(); cleanup(f.dir); }
});
