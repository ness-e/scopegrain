import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { validateReview, validateVerification } from '../src/core/evidence.mjs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { prepareDesign, prepareSpecification } from '../src/core/specifications.mjs';
import { getTask, prepareTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import { bootstrappedCtx, cleanup, writeJson } from './helpers.mjs';

const check = { command: ' fixture-check ', cwd: '.',
  status: 'pass', evidence: ' declared fixture pass, not execution proof ' };
const verification = () => ({
  checks: [{ ...check }, { ...check, command: 'second-fixture-check' }],
  coverage: [
    { requirementId: 'R1', scenarioId: 'S1', checkIndexes: [0, 1, 0] },
    { requirementId: 'r1', scenarioId: 'S2', checkIndexes: [1] },
  ],
});

test('checks-only shape and verbatim strings remain unchanged', () => {
  const input = { checks: [{ ...check }] };
  assert.deepEqual(validateVerification(input), input);
  const extended = { ...verification(), outcomeEvidenceId: crypto.randomUUID() };
  assert.deepEqual(validateVerification(extended), extended);
  assert.deepEqual(validateVerification({ checks: [check], coverage: [] }),
    { checks: [check], coverage: [] });
});

const invalidCases = [
  ['root unknown key', (v) => { v.hash = 'caller-hash'; }, 'unknown'],
  ['checks empty', (v) => { v.checks = []; }, 'checks'],
  ['checks hole', (v) => { delete v.checks[0]; }, 'checks'],
  ['checks unknown key', (v) => { v.checks[0].extra = true; }, 'checks'],
  ['checks missing command', (v) => { delete v.checks[0].command; }, 'checks'],
  ['checks failed status', (v) => { v.checks[0].status = 'fail'; }, 'status'],
  ['coverage root type', (v) => { v.coverage = {}; }, 'coverage'],
  ['coverage hole', (v) => { delete v.coverage[0]; }, 'coverage'],
  ['coverage unknown key', (v) => { v.coverage[0].extra = true; }, 'coverage'],
  ['coverage missing field', (v) => { delete v.coverage[0].scenarioId; }, 'coverage'],
  ['coverage duplicate casefold', (v) => {
    v.coverage[1].scenarioId = 's1';
  }, 'duplicated'],
  ...['requirementId', 'scenarioId'].flatMap((field) =>
    [1, ['R1'], ' R1', 'R1 ', ''].map((value) =>
      [`${field} invalid ${JSON.stringify(value)}`,
        (v) => { v.coverage[0][field] = value; }, field])),
  ...[[], [-1], [0.5], [Number.MAX_SAFE_INTEGER + 1], [2], ['0'], null]
    .map((value) => [`indexes ${JSON.stringify(value)}`,
      (v) => { v.coverage[0].checkIndexes = value; }, 'checkIndexes']),
  ['indexes hole', (v) => { delete v.coverage[0].checkIndexes[0]; }, 'checkIndexes'],
  ...[[crypto.randomUUID()], 'not-uuid', null, 1].map((value) =>
    [`outcome locator ${JSON.stringify(value)}`,
      (v) => { v.outcomeEvidenceId = value; }, 'outcomeEvidenceId']),
];

for (const [label, mutate, field] of invalidCases) {
  test(`verification rejects ${label}`, () => {
    const input = verification();
    assert.deepEqual(validateVerification(input), input);
    mutate(input);
    assert.throws(() => validateVerification(input), (e) =>
      e.code === 'INVALID_EVIDENCE' && e.message.includes(field));
  });
}

test('review validation retains existing declared-context rules', () => {
  const task = { authorContext: 'author' };
  const review = { mode: 'fresh', reviewer: 'reviewer',
    authorContext: 'author', reviewerContext: 'separate', verdict: 'approve' };
  assert.deepEqual(validateReview(review, task), review);
  assert.throws(() => validateReview({ ...review, reviewerContext: 'author' }, task),
    (e) => e.code === 'INVALID_EVIDENCE');
  const waived = { mode: 'waived', owner: 'owner', reference: 'fixture waiver',
    reason: 'declared scope', verdict: 'approve' };
  assert.deepEqual(validateReview(waived, task), waived);
});

test('actual ACT -> VERIFY persists optional evidence; malformed root fails getTask', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = prepareSpecification(ctx, {
      originalRequest: 'synthetic evidence seam', title: 'Spec',
      outcome: { statement: 'fixture outcome', evidencePlan: 'declared checks' },
      requirements: [{ id: 'R1', statement: 'requirement',
        scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' },
          { id: 'S2', given: 'g', when: 'w', then: 't' }] }],
      scope: ['src/a', 'src/b'],
    });
    applyPlan(dir, [spec.file]);
    const design = prepareDesign(ctx, {
      specId: spec.artifact.id, title: 'Design', body: 'fixture design' });
    applyPlan(dir, [design.file]);
    const prepared = prepareTask(ctx, { title: 'Synthetic seam', contract: 'C',
      authorContext: 'fixture', scope: ['src/a'], specId: spec.artifact.id,
      designId: design.artifact.id,
      scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' }] });
    applyPlan(dir, [prepared.file]);
    // SYNTHETIC ACT seed, not authorization or proof of an executed check.
    const act = structuredClone(prepared.task);
    act.state = 'ACT';
    act.revision = 1;
    act.history.push({ at: act.updatedAt, event: 'transition',
      from: 'PLAN', to: 'ACT', revision: 1 });
    writeJson(dir, prepared.file.rel, act);
    assert.equal(getTask(ctx, act.id).state, 'ACT');
    const evidence = { ...verification(), outcomeEvidenceId: crypto.randomUUID() };
    const next = transitionTask(ctx, { id: act.id, to: 'VERIFY',
      expectedRevision: 1, verification: evidence });
    assert.deepEqual(next.verification, evidence);
    assert.deepEqual(getTask(ctx, act.id).verification, evidence);
    next.verification.coverage = {};
    writeJson(dir, prepared.file.rel, next);
    assert.throws(() => getTask(ctx, act.id),
      (e) => e.code === 'TASK_MALFORMED' && e.message.includes('coverage'));
  } finally { cleanup(dir); }
});
