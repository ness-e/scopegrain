// Second-landing review corrections: stored-record mutations, actual CLOSE
// unblocking, session tampering/chronology/oversize, artifact ref safety,
// write bounds, legacy classification join, catalog check CLI, cfg prefix.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { applyPlan, preflightPlan, prepareInit } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { getPlan, nextPlanTasks, planFileAbs, preparePlan } from '../src/core/plans.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import {
  getSession, prepareSession, prepareSessionRecord, recordSession,
  resumeSession, sessionFileAbs,
} from '../src/core/sessions.mjs';
import { getArtifact, prepareArtifact } from '../src/core/artifacts.mjs';
import { configDirPrefix } from '../src/adapters/native.mjs';
import { legacyGet } from '../src/core/catalog.mjs';
import { buildVersioningFiles } from '../src/core/versioning.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  ALL_VERSIONING_FALSE, DEFAULT_ANSWERS, VALID_ANSWERS,
  cleanup, exists, fakeIO, makeTempDir, trySymlink, writeJson,
} from './helpers.mjs';

function ctxFixture() {
  const dir = makeTempDir('rc');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

const GOOD = {
  key: 'p1', title: 'P', authorContext: 'ctx',
  tasks: [
    { key: 'a', title: 'A', contract: 'c', dependsOn: [] },
    { key: 'b', title: 'B', contract: 'c', dependsOn: ['a'] },
  ],
};

function mutateStored(file, fn, code) {
  const orig = fs.readFileSync(file);
  const doc = JSON.parse(orig.toString('utf8'));
  fn(doc);
  fs.writeFileSync(file, JSON.stringify(doc));
  return orig;
}

test('stored plan mutations: dup key/id, self/missing/cyclic deps, meta', () => {
  const { dir, ctx } = ctxFixture();
  try {
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, GOOD).files));
    const file = planFileAbs(ctx, 'p1');
    const cases = [
      (p) => { p.tasks[1].key = 'a'; },
      (p) => { p.tasks[1].id = p.tasks[0].id; },
      (p) => { p.tasks[0].dependsOn = ['a']; },
      (p) => { p.tasks[0].dependsOn = ['ghost']; },
      (p) => { p.tasks[0].dependsOn = ['b']; },
      (p) => { p.inputDigest = 'nothex'; },
      (p) => { p.createdAt = '2026-01-01'; },
      (p) => { p.tasks = []; },
    ];
    for (const fn of cases) {
      const orig = mutateStored(file, fn);
      try {
        assert.throws(() => getPlan(ctx, 'p1'),
          (e) => e.code === 'PLAN_MALFORMED');
      } finally {
        fs.writeFileSync(file, orig);
      }
    }
  } finally { cleanup(dir); }
});

test('ACTUAL CLOSE of first task unblocks the successor', () => {
  const { dir, ctx } = ctxFixture();
  try {
    applyPlan(dir, preflightPlan(dir, preparePlan(ctx, GOOD).files));
    const plan = getPlan(ctx, 'p1');
    const a = plan.tasks.find((t) => t.key === 'a');
    const st = () => Object.fromEntries(
      nextPlanTasks(ctx, 'p1').map((t) => [t.key, t.status]));
    assert.equal(st().b, 'blocked');
    const chain = [
      ['ACT', 0], ['VERIFY', 1],
      ['EVALUATE', 2, { verification: {
        checks: [{
          command: 'npm test', cwd: '.', status: 'pass',
          evidence: 'tests/log.tap',
        }],
      } }],
      ['REVIEW', 3],
      ['ACCEPT', 4, { review: {
        mode: 'fresh', verdict: 'approve', reviewer: 'r1',
        authorContext: 'ctx', reviewerContext: 'reviewer-ctx',
      } }],
      ['CLOSE', 5],
    ];
    for (const [to, expectedRevision, extra] of chain) {
      transitionTask(ctx, { id: a.id, to, expectedRevision, ...extra });
    }
    const final = st();
    assert.equal(final.a, 'closed');
    assert.equal(final.b, 'ready');
  } finally { cleanup(dir); }
});

function makeSession(ctx, task, limit = 3) {
  const prepared = prepareSession(ctx, { taskId: task.id, limit });
  applyPlan(ctx.projectRoot,
    preflightPlan(ctx.projectRoot, [prepared.file]));
  return prepared.session;
}

test('session tampering: counters, unknown action, chronology', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const s = makeSession(ctx, task, 5);
    const file = sessionFileAbs(ctx, s.id);
    recordSession(ctx, {
      id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
    });
    const cases = [
      (d) => { d.used = 99; },
      (d) => { d.revision = 0; },
      (d) => { d.events[0].action = 'shell'; },
      (d) => { d.events[0].at = 'not-a-date'; },
      (d) => { d.events[0].at = '1999-01-01T00:00:00.000Z'; },
      (d) => { d.updatedAt = '2999-01-01T00:00:00.000Z'; },
    ];
    for (const fn of cases) {
      const orig = mutateStored(file, fn);
      try {
        assert.throws(() => getSession(ctx, s.id),
          (e) => e.code === 'SESSION_MALFORMED');
        assert.throws(() => recordSession(ctx, {
          id: s.id, expectedRevision: 1, action: 'read', evidence: 'y',
        }), (e) => e.code === 'SESSION_MALFORMED'
          || e.code === 'REVISION_MISMATCH');
      } finally {
        fs.writeFileSync(file, orig);
      }
    }
  } finally { cleanup(dir); }
});

test('oversized session append fails dry-run and apply identically', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const s = makeSession(ctx, task, 10);
    const file = sessionFileAbs(ctx, s.id);
    const before = fs.readFileSync(file);
    const huge = 'x'.repeat(loadLimits().maxDocumentBytes);
    const input = {
      id: s.id, expectedRevision: 0, action: 'read', evidence: huge,
    };
    for (const fn of [prepareSessionRecord, recordSession]) {
      assert.throws(() => fn(ctx, input),
        (e) => e.code === 'DOCUMENT_TOO_LARGE');
    }
    assert.ok(fs.readFileSync(file).equals(before));
    assert.ok(!exists(dir, '.tasksystem/state/sessions/' + s.id + '.json.lock'));
    const leftovers = fs.readdirSync(path.dirname(file))
      .filter((n) => n.endsWith('.tmp') || n.endsWith('.lock'));
    assert.deepEqual(leftovers, []);
  } finally { cleanup(dir); }
});

test('oversized artifact/task/plan documents rejected before writes', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const huge = 'x'.repeat(loadLimits().maxDocumentBytes);
    assert.throws(() => prepareArtifact(ctx, 'report',
      { title: 'T', body: huge }), (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.ok(!exists(dir, 'docs/agent/reports'));
    assert.throws(() => createTask(ctx, {
      title: 'T', contract: huge, authorContext: 'a', scope: [],
    }), (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.ok(!exists(dir, 'docs/agent/tasks'));
    assert.throws(() => preparePlan(ctx, {
      key: 'big', title: 'P', authorContext: 'ctx',
      tasks: [{ key: 'a', title: 'A', contract: huge }],
    }), (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.ok(!exists(dir, 'docs/agent/plans'));
  } finally { cleanup(dir); }
});

test('artifact stored refs: traversal, backslash, link ancestor rejected', (t) => {
  const { dir, ctx } = ctxFixture();
  try {
    const p = prepareArtifact(ctx, 'report',
      { title: 'T', body: 'B', references: ['src/ok.ts'] });
    applyPlan(dir, preflightPlan(dir, [p.file]));
    const file = `${dir}/docs/agent/reports/${p.artifact.id}.json`;
    for (const bad of ['../x', 'a\\b', 'a/./b']) {
      const orig = mutateStored(file, (d) => { d.references = [bad]; });
      try {
        assert.throws(() => getArtifact(ctx, 'report', p.artifact.id),
          (e) => e.code === 'ARTIFACT_MALFORMED'
            || e.code === 'INVALID_PATH');
      } finally { fs.writeFileSync(file, orig); }
    }
    // Symlink ancestor in a stored ref path.
    writeJson(dir, 'docs/agent/reports/keep.txt', { x: 1 });
    fs.mkdirSync(`${dir}/outside`, { recursive: true });
    if (trySymlink(`${dir}/outside`, `${dir}/docs/agent/linkdir`)) {
      const orig = mutateStored(file, (d) => {
        d.references = ['docs/agent/linkdir/x'];
      });
      try {
        assert.throws(() => getArtifact(ctx, 'report', p.artifact.id));
      } finally { fs.writeFileSync(file, orig); }
    } else {
      t.skip('symlinks unsupported in this environment');
    }
  } finally { cleanup(dir); }
});

test('gitignore emits literal pattern for bracketed path segment', () => {
  const files = buildVersioningFiles({
    configDir: '.tasksystem',
    paths: { ...DEFAULT_ANSWERS.paths, reports: '.tasksystem/reports[private]' },
    versioning: ALL_VERSIONING_FALSE,
  });
  const gi = files.find((f) => f.rel === '.tasksystem/.gitignore');
  assert.ok(gi.content.includes('/reports\\[private\\]/'));
});

test('catalog check exits nonzero on corrupt install; flags rejected', async () => {
  // CLI: catalog check on a broken manifest -> exit 1 + structured stderr.
  // (Real catalog is healthy; inject via unit-level checkCatalog instead.)
  const { checkCatalog } = await import('../src/core/catalog.mjs');
  const dir = makeTempDir('badcat');
  try {
    fs.mkdirSync(`${dir}/catalog`, { recursive: true });
    fs.writeFileSync(`${dir}/catalog/manifest.json`, 'null');
    const report = checkCatalog({ installRoot: dir });
    assert.equal(report.ok, false);
    assert.equal(report.issues[0].code, 'CATALOG_MALFORMED');
  } finally { cleanup(dir); }
  const io = fakeIO();
  assert.equal(await run(['catalog', 'list', '--project', '.'], io), 1);
  const errOut = JSON.parse(io.out.stderr[0]);
  assert.equal(errOut.error.code, 'INVALID_ARGS');
});

test('configDirPrefix handles arbitrary basenames and root config', () => {
  assert.equal(configDirPrefix('.tasksystem/config.json'), '.tasksystem/');
  assert.equal(configDirPrefix('cfg space/custom-name.json'), 'cfg space/');
  assert.equal(configDirPrefix('config.json'), '');
  assert.throws(() => configDirPrefix('../x/config.json'));
  assert.throws(() => configDirPrefix('a//b.json'));
});

test('legacy classification joins skills only, exact fields', () => {
  const audit = legacyGet('skill', 'a11y-accessibility-audit', {});
  assert.equal(audit.category, 'domain-specific');
  assert.equal(audit.family, 'accessibility');
  assert.equal(audit.basis, 'identifier-triage-not-semantic-audit');
  assert.equal(audit.reviewRequired, true);
  assert.equal(audit.originalActivation, 'blocked');
  const brain = legacyGet('skill', 'brainstorming', {});
  assert.equal(brain.category, 'general-engineering');
  assert.equal(brain.currentReplacement, 'skills/brainstorming/SKILL.md');
  // Non-skill legacy entries never receive classification fields.
  const cmd = legacyGet('command', 'pipeline', {});
  assert.equal(cmd.category, undefined);
  assert.equal(cmd.currentReplacement, 'commands/pipeline.md');
});

test('malformed and oversized --input files fail with structured errors', async () => {
  const dir = makeTempDir('infiles');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, {}));
    const bad = `${dir}/bad.json`;
    fs.writeFileSync(bad, '{broken');
    const io = fakeIO();
    assert.equal(await run(
      ['plan', 'create', '--project', dir, '--input', bad], io), 1);
    assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'MALFORMED_JSON');
    const big = `${dir}/big.json`;
    fs.writeFileSync(big, 'x'.repeat(loadLimits().maxDocumentBytes + 10));
    const io2 = fakeIO();
    assert.equal(await run(
      ['plan', 'create', '--project', dir, '--input', big], io2), 1);
    assert.equal(JSON.parse(io2.out.stderr[0]).error.code, 'INPUT_TOO_LARGE');
  } finally { cleanup(dir); }
});
