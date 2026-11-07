// Artifact cases: kinds/destinations, create-only, read validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  artifactDirRel, getArtifact, listArtifacts, prepareArtifact,
} from '../src/core/artifacts.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, writeJson,
} from './helpers.mjs';

function ctxFixture() {
  const dir = makeTempDir('art');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

const INPUT = {
  title: 'Hallazgo',
  body: 'Cuerpo del artefacto',
  references: ['src/x.ts'],
};

test('kind destinations follow configured paths; review nests in reports', () => {
  const { dir, ctx } = ctxFixture();
  try {
    assert.equal(artifactDirRel(ctx, 'spec'), 'docs/agent/plans/specs');
    assert.equal(artifactDirRel(ctx, 'report'), 'docs/agent/reports');
    assert.equal(artifactDirRel(ctx, 'review'), 'docs/agent/reports/reviews');
    assert.equal(artifactDirRel(ctx, 'lesson'), '.tasksystem/memory/lessons');
    assert.equal(artifactDirRel(ctx, 'handoff'), '.tasksystem/memory/handoffs');
    assert.throws(() => artifactDirRel(ctx, 'nope'),
      (e) => e.code === 'INVALID_KIND');
  } finally { cleanup(dir); }
});

test('prepare is read-only; apply creates exclusively', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const p = prepareArtifact(ctx, 'report', INPUT);
    assert.equal(p.artifact.kind, 'report');
    assert.ok(!exists(dir, 'docs/agent/reports'));
    const planned = preflightPlan(dir, [p.file]);
    assert.equal(applyPlan(dir, planned).created, 1);
    const back = getArtifact(ctx, 'report', p.artifact.id);
    assert.equal(back.title, 'Hallazgo');
    // Second apply of the same file is a conflict (content identical ->
    // noop actually; different artifact id -> create). Same id -> noop.
    assert.equal(
      preflightPlan(dir, [p.file])[0].action, 'noop');
  } finally { cleanup(dir); }
});

test('input validation: unknown keys, empty text, unsafe references', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const bad = [
      [{ ...INPUT, bogus: 1 }],
      [{ ...INPUT, title: '' }],
      [{ ...INPUT, body: '  ' }],
      [{ ...INPUT, references: '../x' }],
      [{ ...INPUT, references: ['a', '../b'] }],
      ['string'],
    ];
    for (const [input] of bad) {
      assert.throws(() => prepareArtifact(ctx, 'report', input));
    }
    // references default to empty list.
    const p = prepareArtifact(ctx, 'decision',
      { title: 'T', body: 'B' });
    assert.deepEqual(p.artifact.references, []);
  } finally { cleanup(dir); }
});

test('read validation: filename/kind mismatch and malformed surface', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const p = prepareArtifact(ctx, 'report', INPUT);
    applyPlan(dir, preflightPlan(dir, [p.file]));
    assert.throws(() => getArtifact(ctx, 'decision', p.artifact.id),
      (e) => e.code === 'ARTIFACT_NOT_FOUND'
        || e.code === 'ARTIFACT_MALFORMED');
    assert.throws(() => getArtifact(ctx, 'report', '../x'),
      (e) => e.code === 'INVALID_ID');
    writeJson(dir, 'docs/agent/reports/not-a-uuid.json', { x: 1 });
    const out = listArtifacts(ctx, 'report');
    assert.equal(out.artifacts.length, 1);
    assert.equal(out.malformed.length, 1);
    fs.writeFileSync(`${dir}/docs/agent/reports/${p.artifact.id}.json`,
      '{broken');
    assert.throws(() => getArtifact(ctx, 'report', p.artifact.id),
      (e) => e.code === 'ARTIFACT_MALFORMED');
  } finally { cleanup(dir); }
});
