// Task V2: methodology fields, formal refs, scope subset, stored strictness.
// ctx.config.methodology is set in memory until C2-C config support.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan } from '../src/core/bootstrap.mjs';
import {
  createTask, getTask, prepareTask,
} from '../src/core/tasks.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import {
  prepareDesign, prepareSpecification,
} from '../src/core/specifications.mjs';
import { bootstrappedCtx, cleanup, writeJson } from './helpers.mjs';

const SPEC = {
  originalRequest: 'spec for task v2 fixtures',
  title: 'Spec',
  outcome: { statement: 'o', evidencePlan: 'e' },
  requirements: [{
    id: 'R1', statement: 's',
    scenarios: [
      { id: 'S1', given: 'g', when: 'w', then: 't' },
      { id: 'S2', given: 'g2', when: 'w2', then: 't2' }],
  }, {
    id: 'R2', statement: 's2',
    scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' }],
  }],
  scope: ['src/app', 'SRC/lib'],
};

const ASSESS = {
  schemaVersion: 1, request: 'r', intent: 'change',
  authorization: { status: 'authorized', actor: 'op', reference: 'R' },
  understanding: 'sufficient', uncertainty: 'resolved',
  risk: 'contained', riskCategories: [],
  continuity: 'diff-sufficient', evidence: ['e'],
  preferredRoute: 'auto',
};

function makePair(ctx, dir, specOver = {}) {
  const spec = prepareSpecification(ctx, { ...SPEC, ...specOver });
  applyPlan(dir, [spec.file]);
  const des = prepareDesign(ctx, {
    specId: spec.artifact.id, title: 'd', body: 'b' });
  applyPlan(dir, [des.file]);
  return { spec: spec.artifact, design: des.artifact };
}

function taskIn(over = {}) {
  return {
    title: 'T', contract: 'C', authorContext: 'a', scope: ['src/app'],
    ...over,
  };
}

// ---------------- V2 shape & stored strictness ----------------

test('formal V2: schemaVersion 2 + all five normalized fields', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { task, file } = prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id,
      planKey: 'p1',
      scenarioRefs: [{ requirementId: 'r1', scenarioId: 's1' }],
    }));
    assert.equal(task.schemaVersion, 2);
    assert.equal(task.methodology, null);
    assert.equal(task.specId, spec.id);
    assert.equal(task.designId, design.id);
    assert.equal(task.planKey, 'p1');
    assert.deepEqual(task.scenarioRefs,
      [{ requirementId: 'R1', scenarioId: 'S1' }]); // canonical spelling
    applyPlan(dir, [file]);
    const stored = getTask(ctx, task.id);
    assert.equal(stored.schemaVersion, 2);
    assert.deepEqual(stored.scenarioRefs, task.scenarioRefs);
  } finally { cleanup(dir); }
});

test('omitted scenarioRefs -> all spec scenarios; explicit [] rejected', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { task } = prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id }));
    assert.equal(task.scenarioRefs.length, 3); // R1/S1+R1/S2+R2/S1
    assert.throws(() => prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id, scenarioRefs: [] })),
      (e) => e.code === 'INVALID_SCENARIO_REFS'
        && e.message.includes('[]'));
  } finally { cleanup(dir); }
});

test('light assessment V2: assessment + null refs + [] scenarios', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    ctx.config.methodology = 'organic-sdd';
    const { task } = prepareTask(ctx, taskIn({ methodology: ASSESS }));
    assert.equal(task.schemaVersion, 2);
    assert.equal(task.methodology.intent, 'change');
    assert.equal(task.specId, null);
    assert.equal(task.designId, null);
    assert.equal(task.planKey, null);
    assert.deepEqual(task.scenarioRefs, []);
  } finally { cleanup(dir); }
});

test('V1 manual: no new fields, no silent upgrade', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    ctx.config.methodology = 'manual';
    const t = createTask(ctx, taskIn());
    assert.equal(t.schemaVersion, 1);
    assert.equal(t.methodology, undefined);
    assert.equal(getTask(ctx, t.id).methodology, undefined);
  } finally { cleanup(dir); }
});

test('mode gating: sdd needs pair; organic needs assessment or pair', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    ctx.config.methodology = 'sdd';
    assert.throws(() => prepareTask(ctx, taskIn()),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
    ctx.config.methodology = 'organic-sdd';
    assert.throws(() => prepareTask(ctx, taskIn()),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
    ctx.config.methodology = 'manual';
    const { task } = prepareTask(ctx, taskIn());
    assert.equal(task.schemaVersion, 1); // manual accepts no-methodology V1
  } finally { cleanup(dir); }
});

test('classified sdd without pair -> METHODOLOGY_REQUIRED', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    ctx.config.methodology = 'organic-sdd';
    assert.throws(() => prepareTask(ctx, taskIn({
      methodology: { ...ASSESS, risk: 'named',
        riskCategories: ['security'] } })),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
  } finally { cleanup(dir); }
});

test('blocked/read-only drafts create PLAN records without authorization', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    ctx.config.methodology = 'organic-sdd';
    const blocked = prepareTask(ctx, taskIn({
      methodology: { ...ASSESS,
        authorization: { status: 'missing', actor: null, reference: null } },
    }));
    assert.equal(blocked.task.schemaVersion, 2);
    assert.equal(blocked.task.methodology.authorization.status, 'missing');
    const ro = prepareTask(ctx, taskIn({
      methodology: { ...ASSESS, intent: 'read-only',
        authorization: { status: 'missing', actor: null, reference: null } },
    }));
    assert.equal(ro.task.methodology.intent, 'read-only');
  } finally { cleanup(dir); }
});

test('half/unknown refs, planKey alone, bad keys rejected', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    assert.throws(() => prepareTask(ctx, taskIn({ specId: spec.id })),
      (e) => e.code === 'INVALID_ID');
    assert.throws(() => prepareTask(ctx, taskIn({
      specId: spec.id, designId: '00000000-0000-0000-0000-000000000000' })),
      (e) => e.code === 'ARTIFACT_NOT_FOUND'
        && e.message.includes('00000000'));
    assert.throws(() => prepareTask(ctx, taskIn({ planKey: 'p' })),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
    assert.throws(() => prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id, planKey: 'bad key!' })),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(() => prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id,
      scenarioRefs: [{ requirementId: 'R1', scenarioId: 'NOPE' }] })),
      (e) => e.code === 'INVALID_SCENARIO_REFS');
    assert.throws(() => prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id,
      scenarioRefs: [
        { requirementId: 'R1', scenarioId: 'S1' },
        { requirementId: 'r1', scenarioId: 's1' }] })),
      (e) => e.code === 'INVALID_SCENARIO_REFS'
        && e.message.includes('duplicate'));
  } finally { cleanup(dir); }
});

test('scope: sibling-prefix/case-only/broader rejected with scope named', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const f = { specId: spec.id, designId: design.id };
    const mreq = (p) => (e) => e.code === 'METHODOLOGY_REQUIRED'
      && e.message.includes(p);
    // src/app2 is NOT inside src/app (segment boundary).
    assert.throws(() => prepareTask(ctx, taskIn({
      scope: ['src/app2'], ...f })), mreq('src/app2'));
    // SRC/app does NOT match src/app (case-sensitive authorization).
    assert.throws(() => prepareTask(ctx, taskIn({
      scope: ['SRC/app'], ...f })), mreq('SRC/app'));
    // 'src' is broader than spec scope 'src/app' — not contained.
    assert.throws(() => prepareTask(ctx, taskIn({
      scope: ['src'], ...f })), mreq('src'));
    // Outside the spec scope entirely.
    assert.throws(() => prepareTask(ctx, taskIn({
      scope: ['docs/x'], ...f })), mreq('docs/x'));
  } finally { cleanup(dir); }
});

test('scope junction: real link under scope path -> SYMLINK_REJECTED', (t) => {
  const { dir, ctx } = bootstrappedCtx();
  const outside = `${dir}-outside`;
  fs.mkdirSync(`${outside}/x`, { recursive: true });
  try {
    const { spec, design } = makePair(ctx, dir);
    const f = { specId: spec.id, designId: design.id };
    fs.mkdirSync(`${dir}/src/app`, { recursive: true }); // real parent
    let linked = false;
    try {
      fs.symlinkSync(`${outside}/x`, `${dir}/src/app/link`, 'junction');
      linked = fs.lstatSync(`${dir}/src/app/link`).isSymbolicLink();
    } catch (e) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(e.code)) {
        return t.skip(`symlinks unavailable: ${e.code}`);
      }
      throw e;
    }
    assert.equal(linked, true, 'fixture must create a real junction');
    assert.throws(() => prepareTask(ctx, taskIn({
      scope: ['src/app/link'], ...f })),
      (e) => e.code === 'SYMLINK_REJECTED');
    fs.rmSync(`${dir}/src/app/link`);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    cleanup(dir);
  }
});

test('getter validates OWN record only: spec deleted -> task still reads', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { task, file } = prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id }));
    applyPlan(dir, [file]);
    fs.rmSync(`${dir}/.tasksystem/plans/specs/${spec.id}.json`);
    const stored = getTask(ctx, task.id); // no live FK check on read
    assert.equal(stored.specId, spec.id);
  } finally { cleanup(dir); }
});

test('explicit methodology:null without refs -> METHODOLOGY_REQUIRED', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    ctx.config.methodology = 'manual';
    assert.throws(() => prepareTask(ctx, taskIn({ methodology: null })),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
    ctx.config.methodology = 'organic-sdd';
    assert.throws(() => prepareTask(ctx, taskIn({ methodology: null })),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
  } finally { cleanup(dir); }
});

test('uppercase spec id still binds design -> prepare succeeds', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec } = makePair(ctx, dir);
    // Design authored against an UPPERCASE spec id: data.specId preserves
    // the supplied spelling (C1 verbatim) — the binder must fold case.
    const des = prepareDesign(ctx, {
      specId: spec.id.toUpperCase(), title: 'd', body: 'b' });
    applyPlan(dir, [des.file]);
    const design = des.artifact;
    assert.equal(design.data.specId, spec.id.toUpperCase());
    const { task } = prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id }));
    assert.equal(task.specId, spec.id);
    assert.equal(task.designId, design.id);
    const { plan } = preparePlan(ctx, {
      key: 'p1', title: 'P', authorContext: 'a',
      specId: spec.id, designId: design.id,
      tasks: [{ key: 't1', title: 'T', contract: 'C',
        scenarioRefs: [{ requirementId: 'R1', scenarioId: 'S1' },
          { requirementId: 'R1', scenarioId: 'S2' },
          { requirementId: 'R2', scenarioId: 'S1' }] }] });
    assert.equal(plan.specId, spec.id);
    // A real mismatch still fails (different spec entirely).
    const other = prepareSpecification(ctx, { ...SPEC, title: 'Other' });
    applyPlan(dir, [other.file]);
    assert.throws(() => prepareTask(ctx, taskIn({
      specId: other.artifact.id, designId: design.id })),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
  } finally { cleanup(dir); }
});

test('stored V2 coherence: null-methodology-no-refs and sdd-classified light', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { task, file } = prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id }));
    applyPlan(dir, [file]);
    const rel = `.tasksystem/tasks/${task.id}.json`;
    const good = JSON.parse(fs.readFileSync(`${dir}/${rel}`, 'utf8'));
    // methodology:null + null refs -> impossible V2 record.
    const m1 = JSON.parse(JSON.stringify(good));
    m1.specId = null; m1.designId = null; m1.scenarioRefs = [];
    writeJson(dir, rel, m1);
    assert.throws(() => getTask(ctx, task.id),
      (e) => e.code === 'TASK_MALFORMED' && e.message.includes('null'));
    // noRefs + assessment whose route is sdd -> coherent-V2 violation.
    const m2 = JSON.parse(JSON.stringify(good));
    m2.specId = null; m2.designId = null; m2.scenarioRefs = [];
    m2.methodology = { ...ASSESS, risk: 'named',
      riskCategories: ['security'] };
    writeJson(dir, rel, m2);
    assert.throws(() => getTask(ctx, task.id),
      (e) => e.code === 'TASK_MALFORMED');
    // Light assessment + no refs is the ONLY legal noRefs V2.
    const m3 = JSON.parse(JSON.stringify(m2));
    m3.methodology = ASSESS;
    writeJson(dir, rel, m3);
    assert.equal(getTask(ctx, task.id).schemaVersion, 2);
    writeJson(dir, rel, good);
  } finally { cleanup(dir); }
});

test('stored V2 field types: planKey nonstring, bad scenario ids, unsafe rev', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { task, file } = prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id, planKey: 'k' }));
    applyPlan(dir, [file]);
    const rel = `.tasksystem/tasks/${task.id}.json`;
    const good = JSON.parse(fs.readFileSync(`${dir}/${rel}`, 'utf8'));
    const mutate = (fn, frag) => {
      const m = JSON.parse(JSON.stringify(good));
      fn(m);
      writeJson(dir, rel, m);
      assert.throws(() => getTask(ctx, task.id),
        (e) => e.code === 'TASK_MALFORMED' && e.message.includes(frag), frag);
    };
    mutate((m) => { m.planKey = 1; }, 'planKey');
    mutate((m) => { m.scenarioRefs = [{ requirementId: ' ', scenarioId: 'S1' }]; }, 'scenario');
    mutate((m) => { m.scenarioRefs = [{ requirementId: 'R/1', scenarioId: 'S1' }]; }, 'scenario');
    mutate((m) => { m.scenarioRefs = [{ requirementId: 1, scenarioId: 'S1' }]; }, 'scenario');
    mutate((m) => { m.scenarioRefs = [
      { requirementId: 'R1', scenarioId: 'S1' },
      { requirementId: 'r1', scenarioId: 's1' }]; }, 'scenario');
    mutate((m) => { m.revision = Number.MAX_SAFE_INTEGER + 1; }, 'revision');
    // UUID fields: array coercion must fail MALFORMED, never TypeError.
    mutate((m) => { m.id = [m.id]; }, 'id');
    mutate((m) => { m.specId = [m.specId]; }, 'specId');
    mutate((m) => { m.designId = [m.designId]; }, 'designId');
    writeJson(dir, rel, good); // restore baseline
    assert.equal(getTask(ctx, task.id).id, task.id);
  } finally { cleanup(dir); }
});

test('stored V2 strict: missing field or V1-with-fields -> malformed', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { spec, design } = makePair(ctx, dir);
    const { task, file } = prepareTask(ctx, taskIn({
      specId: spec.id, designId: design.id }));
    applyPlan(dir, [file]);
    const rel = `.tasksystem/tasks/${task.id}.json`;
    const good = JSON.parse(fs.readFileSync(`${dir}/${rel}`, 'utf8'));
    for (const k of ['methodology', 'specId', 'designId', 'planKey',
      'scenarioRefs']) {
      const m = JSON.parse(JSON.stringify(good));
      delete m[k];
      writeJson(dir, rel, m);
      assert.throws(() => getTask(ctx, task.id),
        (e) => e.code === 'TASK_MALFORMED' && e.message.includes(k), k);
    }
    const v1 = JSON.parse(JSON.stringify(good));
    v1.schemaVersion = 1;
    writeJson(dir, rel, v1);
    assert.throws(() => getTask(ctx, task.id),
      (e) => e.code === 'TASK_MALFORMED');
    writeJson(dir, rel, good); // restore baseline
    assert.equal(getTask(ctx, task.id).id, task.id);
  } finally { cleanup(dir); }
});

test('prepareTask is read-only: invalid writes nothing; valid creates none', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const tasksDir = `${dir}/.tasksystem/tasks`;
    const before = fs.existsSync(tasksDir)
      ? fs.readdirSync(tasksDir).length : 0;
    assert.throws(() => prepareTask(ctx, taskIn({ bogus: 1 })),
      (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(() => prepareTask(ctx, taskIn({ planKey: 'p' })),
      (e) => e.code === 'METHODOLOGY_REQUIRED');
    const after = fs.existsSync(tasksDir)
      ? fs.readdirSync(tasksDir).length : 0;
    assert.equal(after, before);
    // Positive: a VALID prepare still leaves the file absent until apply.
    const { file } = prepareTask(ctx, taskIn());
    assert.equal(fs.existsSync(file.abs), false);
    applyPlan(dir, [file]);
    assert.equal(fs.existsSync(file.abs), true);
  } finally { cleanup(dir); }
});
