// Specification/design V2 contract: closed inputs, verbatim request,
// uniqueness, renderer coherence, digest binding, drift detection, V2 shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { canonicalDigest } from '../src/core/digests.mjs';
import {
  getSpecification, prepareDesign, prepareSpecification,
} from '../src/core/specifications.mjs';
import { getArtifact, prepareArtifact } from '../src/core/artifacts.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  bootstrappedCtx, cleanup, trySymlink, writeJson,
} from './helpers.mjs';

const SPEC = {
  originalRequest: 'Add a dark-mode toggle to settings, verbatim request.',
  title: 'Dark mode toggle',
  outcome: { statement: 'users can toggle dark mode',
    evidencePlan: 'screenshot + e2e run' },
  requirements: [{
    id: 'REQ-1',
    statement: 'Toggle persists across sessions',
    scenarios: [{
      id: 'SC-1',
      given: 'a stored preference',
      when: 'the app restarts',
      then: 'dark mode applies immediately',
    }],
  }],
  scope: ['src/settings'],
  constraints: ['no new deps'],
  nonGoals: ['redesign'],
  openQuestions: [],
};

function specIn(over = {}) { return { ...SPEC, ...over }; }

test('prepareSpecification: V2, verbatim request, renderer body, closed', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    assert.throws(() => prepareSpecification(ctx, specIn({ extra: 1 })),
      (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(() => prepareSpecification(ctx, specIn({
      originalRequest: '   ' })), (e) => e.code === 'INVALID_ARTIFACT');
    const { artifact, file } = prepareSpecification(ctx, specIn());
    assert.equal(artifact.schemaVersion, 2); // V2 record, not V1+data
    assert.equal(artifact.data.schemaVersion, 1);
    assert.equal(artifact.data.originalRequest, SPEC.originalRequest);
    assert.ok(artifact.body.includes(SPEC.originalRequest));
    assert.ok(artifact.body.startsWith('# Change Specification'));
    applyPlan(dir, [file]);
    const stored = getSpecification(ctx, artifact.id);
    assert.equal(stored.schemaVersion, 2);
    assert.deepEqual(stored.data, artifact.data);
    assert.equal(stored.body, artifact.body);
    assert.equal(canonicalDigest(stored).length, 64);
  } finally { cleanup(dir); }
});

test('ids unique casefold; empty scenarios; traversal rejected', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const dup = specIn({ requirements: [
      { id: 'R', statement: 's', scenarios: [SPEC.requirements[0].scenarios[0]] },
      { id: 'r', statement: 's2', scenarios: [SPEC.requirements[0].scenarios[0]] }] });
    assert.throws(() => prepareSpecification(ctx, dup),
      (e) => e.code === 'SPEC_DATA_MALFORMED');
    const dupSc = specIn({ requirements: [
      { id: 'R', statement: 's', scenarios: [
        { id: 'S', given: 'g', when: 'w', then: 't' },
        { id: 's', given: 'g', when: 'w', then: 't' }] }] });
    assert.throws(() => prepareSpecification(ctx, dupSc),
      (e) => e.code === 'SPEC_DATA_MALFORMED');
    assert.throws(() => prepareSpecification(ctx, specIn({
      requirements: [{ id: 'R', statement: 's', scenarios: [] }] })),
      (e) => e.code === 'SPEC_DATA_MALFORMED');
    assert.throws(() => prepareSpecification(ctx, specIn({
      scope: ['../outside'] })), (e) => e.code !== 'OK');
    assert.throws(() => prepareSpecification(ctx, specIn({
      references: ['..\\escape'] })), (e) => e.code !== 'OK');
  } finally { cleanup(dir); }
});

test('scope containment at prepare AND read: junctions rejected', (t) => {
  const { dir, ctx } = bootstrappedCtx();
  const outside = `${dir}-outside`;
  fs.mkdirSync(`${outside}/secret`, { recursive: true });
  try {
    if (!trySymlink(`${outside}/secret`, `${dir}/src-j`)) {
      return t.skip('junctions unsupported on this platform');
    }
    // Prepare-time: a scope entry pointing through a junction must fail.
    assert.throws(() => prepareSpecification(ctx,
      specIn({ scope: ['src-j'] })),
      (e) => e.code === 'SYMLINK_REJECTED'
        || e.code === 'INVALID_PATH'
        || e.message.toLowerCase().includes('link'));
    fs.rmSync(`${dir}/src-j`, { recursive: true });
    // Read-time: real dir passes, then swap to junction -> read rejects.
    fs.mkdirSync(`${dir}/src/real`, { recursive: true });
    const { artifact, file } = prepareSpecification(ctx,
      specIn({ scope: ['src/real'] }));
    applyPlan(dir, [file]);
    assert.equal(getSpecification(ctx, artifact.id).data.scope[0],
      'src/real');
    fs.rmSync(`${dir}/src/real`, { recursive: true });
    fs.symlinkSync(`${outside}/secret`, `${dir}/src/real`, 'junction');
    assert.throws(() => getSpecification(ctx, artifact.id),
      (e) => e.code === 'SYMLINK_REJECTED'
        || e.code === 'ARTIFACT_MALFORMED'
        || e.message.toLowerCase().includes('link'));
    fs.rmSync(`${dir}/src/real`, { recursive: true });
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    cleanup(dir);
  }
});

test('materialized body coherence and required stored data', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { file } = prepareSpecification(ctx, specIn());
    applyPlan(dir, [file]);
    const good = JSON.parse(file.content);
    assert.equal(getSpecification(ctx, good.id).body, good.body);
    const stored = structuredClone(good);
    stored.body = stored.body.replace('Change Specification', 'Xx');
    writeJson(dir, file.rel, stored);
    assert.throws(() => getSpecification(ctx, stored.id),
      (e) => e.code === 'ARTIFACT_MALFORMED');
    // Missing required data keys on read -> malformed (not defaulted).
    // Each fault starts with valid data AND the original coherent body.
    const requiredKeys = ['originalRequest', 'outcome', 'requirements',
      'scope', 'constraints', 'nonGoals', 'openQuestions'];
    for (const k of requiredKeys) {
      const m = JSON.parse(JSON.stringify(good));
      delete m.data[k];
      writeJson(dir, file.rel, m);
      assert.throws(() => getSpecification(ctx, good.id),
        (e) => (e.code === 'ARTIFACT_MALFORMED'
            || e.code === 'SPEC_DATA_MALFORMED')
          && e.message.includes(k), `missing ${k}`);
    }
    writeJson(dir, file.rel, good); // restore valid baseline
    assert.deepEqual(getSpecification(ctx, good.id), good);
    // A V1 generic spec carries no data -> structured required.
    const p = prepareArtifact(ctx, 'spec', { title: 'v', body: 'b' });
    applyPlan(dir, [p.file]);
    assert.throws(() => getSpecification(ctx, p.artifact.id),
      (e) => e.code === 'SPEC_STRUCTURED_REQUIRED');
  } finally { cleanup(dir); }
});

test('document size bounds: oversized request and oversized stored file', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const huge = 'x'.repeat(loadLimits().maxDocumentBytes + 1024);
    assert.throws(() => prepareSpecification(ctx,
      specIn({ originalRequest: huge })),
      (e) => e.code === 'DOCUMENT_TOO_LARGE');
    // Stored record exceeding maxDocumentBytes -> malformed on read.
    const { file } = prepareSpecification(ctx, specIn());
    applyPlan(dir, [file]);
    fs.writeFileSync(`${dir}/${file.rel}`, 'x'.repeat(
      loadLimits().maxDocumentBytes + 1024));
    assert.throws(() => getSpecification(ctx, file.rel.split('/').pop()
      .replace('.json', '')), (e) => e.code === 'ARTIFACT_MALFORMED');
  } finally { cleanup(dir); }
});

test('version matrix: V1+data, V2-noData, V2-wrong-kind, forged V1 spec', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // Factory: data on a non-V2 kind is rejected outright.
    assert.throws(() => prepareArtifact(ctx, 'research',
      { title: 't', body: 'b' }, { data: { x: 1 } }),
      (e) => e.code === 'INVALID_ARTIFACT');
    // Stored V1 carrying data -> malformed (incoherent combination).
    const v1 = prepareArtifact(ctx, 'research', { title: 't', body: 'b' });
    applyPlan(dir, [v1.file]);
    const rec = JSON.parse(fs.readFileSync(`${dir}/${v1.file.rel}`, 'utf8'));
    rec.data = { bogus: true };
    writeJson(dir, v1.file.rel, rec);
    assert.throws(() => getArtifact(ctx, 'research', v1.artifact.id),
      (e) => e.code === 'ARTIFACT_MALFORMED');
    // Stored V2 without data -> malformed.
    rec.data = undefined; delete rec.data; rec.schemaVersion = 2;
    writeJson(dir, v1.file.rel, rec);
    assert.throws(() => getArtifact(ctx, 'research', v1.artifact.id),
      (e) => e.code === 'ARTIFACT_MALFORMED');
    // Design bound to a legacy V1 spec (valid UUID) -> structured required.
    const legacy = prepareArtifact(ctx, 'spec', { title: 'v', body: 'b' });
    applyPlan(dir, [legacy.file]);
    assert.throws(() => prepareDesign(ctx, {
      specId: legacy.artifact.id, title: 'd', body: 'b' }),
      (e) => e.code === 'SPEC_STRUCTURED_REQUIRED');
  } finally { cleanup(dir); }
});

test('report V2: typed data through factory 4th arg, synthetic shape', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const d = 'a'.repeat(64);
    const { artifact, file } = prepareArtifact(ctx, 'report',
      { title: 'outcome', body: 'outcome body' },
      { data: {
        schemaVersion: 1, taskId: 'a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6',
        taskRevision: 0, taskDigest: d, specId: 'b2c3d4e5-f6a7-48b9-c0d1-e2f3a4b5c6d7',
        specDigest: d, designDigest: d, planDigest: null,
        verificationDigest: d } });
    assert.equal(artifact.schemaVersion, 2);
    applyPlan(dir, [file]);
    assert.equal(getArtifact(ctx, 'report', artifact.id).data.taskDigest, d);
    // Malformed data at prepare is caught before serialization.
    assert.throws(() => prepareArtifact(ctx, 'report',
      { title: 'o', body: 'b' }, { data: { schemaVersion: 1 } }),
      (e) => e.code !== 'OK');
  } finally { cleanup(dir); }
});

test('design: V2 required, binds spec digest, drift detected', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = prepareSpecification(ctx, specIn());
    applyPlan(dir, [spec.file]);
    // prepareArtifact design without data -> exact INVALID_ARTIFACT.
    assert.throws(() => prepareArtifact(ctx, 'design',
      { title: 'd', body: 'b' }), (e) => e.code === 'INVALID_ARTIFACT');
    const des = prepareDesign(ctx, {
      specId: spec.artifact.id, title: 'd', body: 'design body' });
    assert.equal(des.artifact.schemaVersion, 2);
    assert.equal(des.artifact.data.specId, spec.artifact.id);
    assert.equal(des.artifact.data.specDigest, canonicalDigest(spec.artifact));
    applyPlan(dir, [des.file]);
    assert.equal(getArtifact(ctx, 'design', des.artifact.id)
      .data.specId, spec.artifact.id);
    // A stored V1/noData design is malformed, never silently V2.
    const origBytes = fs.readFileSync(`${dir}/${des.file.rel}`);
    const stored = JSON.parse(origBytes.toString('utf8'));
    stored.schemaVersion = 1;
    delete stored.data;
    writeJson(dir, des.file.rel, stored);
    assert.throws(() => getArtifact(ctx, 'design', des.artifact.id),
      (e) => e.code === 'ARTIFACT_MALFORMED');
    fs.writeFileSync(`${dir}/${des.file.rel}`, origBytes); // restore V2
    // Digest drift via references tamper.
    const specStored = JSON.parse(fs.readFileSync(
      `${dir}/${spec.file.rel}`, 'utf8'));
    specStored.references = ['docs/other.md'];
    writeJson(dir, spec.file.rel, specStored);
    assert.throws(() => getArtifact(ctx, 'design', des.artifact.id),
      (e) => e.code === 'ARTIFACT_DRIFT');
  } finally { cleanup(dir); }
});
