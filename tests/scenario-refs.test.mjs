// Scenario-ref helpers: canonical pair resolution, stored strictness,
// malformed spec guard, no coercion. RED first per lead rework.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan } from '../src/core/bootstrap.mjs';
import {
  prepareSpecification,
} from '../src/core/specifications.mjs';
import {
  allScenarioRefs, normalizeScenarioRefs,
} from '../src/core/methodology-data.mjs';
import { bootstrappedCtx, cleanup } from './helpers.mjs';

const SPEC = {
  originalRequest: 'spec for scenario-ref tests',
  title: 'Spec',
  outcome: { statement: 'o', evidencePlan: 'e' },
  requirements: [{
    id: 'R1', statement: 's',
    scenarios: [
      { id: 'S1', given: 'g', when: 'w', then: 't' },
      { id: 'S2', given: 'g', when: 'w', then: 't' }],
  }, {
    id: 'R2', statement: 's2',
    scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' }],
  }],
  scope: ['src/x'],
};

function makeSpec(ctx, dir) {
  const p = prepareSpecification(ctx, SPEC);
  applyPlan(dir, [p.file]);
  return p.artifact;
}

test('allScenarioRefs returns every canonical pair, fresh each call', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = allScenarioRefs(spec);
    const b = allScenarioRefs(spec);
    assert.deepEqual(a, [
      { requirementId: 'R1', scenarioId: 'S1' },
      { requirementId: 'R1', scenarioId: 'S2' },
      { requirementId: 'R2', scenarioId: 'S1' }]);
    assert.notEqual(a, b); // fresh outputs, zero mutation
    assert.deepEqual(a, b);
  } finally { cleanup(dir); }
});

test('malformed spec: non-spec object / legacy data -> SPEC_STRUCTURED_REQUIRED', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    assert.throws(() => allScenarioRefs(null),
      (e) => e.code === 'SPEC_STRUCTURED_REQUIRED');
    assert.throws(() => allScenarioRefs({ kind: 'report', data: spec.data }),
      (e) => e.code === 'SPEC_STRUCTURED_REQUIRED');
    assert.throws(() => allScenarioRefs({ kind: 'spec', schemaVersion: 1 }),
      (e) => e.code === 'SPEC_STRUCTURED_REQUIRED');
    // Malformed typed data retains SPEC_DATA_MALFORMED only — the helper
    // never goes through the artifact getter.
    assert.throws(() => allScenarioRefs({ ...spec,
      data: { ...spec.data, requirements: 'bad' } }),
      (e) => e.code === 'SPEC_DATA_MALFORMED'
        && e.message.includes('requirements'));
  } finally { cleanup(dir); }
});

test('normalize: omitted raw -> all; stored undefined -> error', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    assert.equal(normalizeScenarioRefs(spec, undefined).length, 3);
    assert.throws(() => normalizeScenarioRefs(spec, undefined, { stored: true }),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
  } finally { cleanup(dir); }
});

test('case-insensitive input resolves canonical; stored spelling must match', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const raw = normalizeScenarioRefs(spec, [
      { requirementId: 'r1', scenarioId: 's1' }]);
    assert.deepEqual(raw, [{ requirementId: 'R1', scenarioId: 'S1' }]);
    assert.throws(() => normalizeScenarioRefs(spec,
      [{ requirementId: 'r1', scenarioId: 's1' }], { stored: true }),
      (e) => e.code === 'INVALID_SCENARIO_REFS'
        && e.message.includes('noncanonical'));
  } finally { cleanup(dir); }
});

test('explicit [] rejects; non-array/non-object/missing/extra keys reject', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    assert.throws(() => normalizeScenarioRefs(spec, []),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    assert.throws(() => normalizeScenarioRefs(spec, 'R1/S1'),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    assert.throws(() => normalizeScenarioRefs(spec, [null]),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    assert.throws(() => normalizeScenarioRefs(spec,
      [{ requirementId: 'R1' }]),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    assert.throws(() => normalizeScenarioRefs(spec,
      [{ requirementId: 'R1', scenarioId: 'S1', extra: 1 }]),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
  } finally { cleanup(dir); }
});

test('non-string IDs reject without coercion: numeric, array, whitespace', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // Spec with numeric-looking IDs '1'/'2' to prove no String() coercion.
    const specP = prepareSpecification(ctx, { ...SPEC,
      requirements: [{ id: '1', statement: 's',
        scenarios: [{ id: '2', given: 'g', when: 'w', then: 't' }] }] });
    applyPlan(dir, [specP.file]);
    const spec = specP.artifact;
    // numeric 1 must NOT coerce to '1'
    assert.throws(() => normalizeScenarioRefs(spec,
      [{ requirementId: 1, scenarioId: '2' }]),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    // array ['1'] must NOT coerce
    assert.throws(() => normalizeScenarioRefs(spec,
      [{ requirementId: ['1'], scenarioId: '2' }]),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    assert.throws(() => normalizeScenarioRefs(spec,
      [{ requirementId: ' ', scenarioId: '2' }]),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    // valid string lookup works
    assert.deepEqual(normalizeScenarioRefs(spec,
      [{ requirementId: '1', scenarioId: '2' }]),
      [{ requirementId: '1', scenarioId: '2' }]);
  } finally { cleanup(dir); }
});

test('duplicate casefold + same scenario id under different requirements legal', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    assert.throws(() => normalizeScenarioRefs(spec, [
      { requirementId: 'R1', scenarioId: 'S1' },
      { requirementId: 'r1', scenarioId: 's1' }]),
      (e) => e.code === 'INVALID_SCENARIO_REFS'
        && e.message.includes('duplicate'));
    // S1 exists under BOTH R1 and R2 — two distinct pairs, both legal.
    const two = normalizeScenarioRefs(spec, [
      { requirementId: 'R1', scenarioId: 'S1' },
      { requirementId: 'R2', scenarioId: 'S1' }]);
    assert.equal(two.length, 2);
  } finally { cleanup(dir); }
});
