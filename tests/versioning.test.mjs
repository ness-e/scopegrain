// Versioning and default-path cases (owner decision: .tasksystem workspace).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan, prepareInit, preflightPlan } from '../src/core/bootstrap.mjs';
import {
  DEFAULT_PATH_PROPOSALS, createConfig, loadConfig, validateAnswers,
} from '../src/core/config.mjs';
import { buildVersioningFiles } from '../src/core/versioning.mjs';
import {
  ALL_VERSIONING_FALSE, DEFAULT_ANSWERS, VALID_ANSWERS,
  cleanup, exists, makeTempDir, readJson, writeJson,
} from './helpers.mjs';

test('default proposals stay inside .tasksystem, never under docs/', () => {
  for (const [k, v] of Object.entries(DEFAULT_PATH_PROPOSALS)) {
    assert.ok(v.startsWith('.tasksystem/'), `${k} -> ${v}`);
    assert.ok(!v.startsWith('docs'), `${k} must not default into docs`);
  }
});

test('versioning field is optional, all-or-none, booleans only', () => {
  const ok = validateAnswers({ ...VALID_ANSWERS });
  assert.deepEqual(ok.versioning, ALL_VERSIONING_FALSE);
  const withV = validateAnswers({
    ...VALID_ANSWERS, versioning: { ...ALL_VERSIONING_FALSE, reports: true },
  });
  assert.equal(withV.versioning.reports, true);
  for (const bad of [
    { ...VALID_ANSWERS, versioning: { plans: true } },           // partial
    { ...VALID_ANSWERS, versioning: { ...ALL_VERSIONING_FALSE, ghost: false } },
    { ...VALID_ANSWERS, versioning: { ...ALL_VERSIONING_FALSE, plans: 'yes' } },
    { ...VALID_ANSWERS, versioning: 'yes' },
  ]) {
    assert.throws(() => validateAnswers(bad),
      (e) => ['UNKNOWN_KEY', 'INVALID_VALUE', 'INVALID_ANSWERS'].includes(e.code));
  }
});

test('gitignore covers only unversioned in-workspace categories', () => {
  const files = buildVersioningFiles({
    configDir: '.tasksystem',
    paths: DEFAULT_ANSWERS.paths,
    versioning: { ...ALL_VERSIONING_FALSE, tasks: true, reports: true, reviews: true },
  });
  const gi = files.find((f) => f.rel === '.tasksystem/.gitignore');
  assert.ok(gi);
  assert.ok(gi.content.includes('/plans/'));
  assert.ok(gi.content.includes('/research/'));
  assert.ok(!gi.content.includes('/tasks/'), 'versioned tasks not ignored');
  assert.ok(!gi.content.includes('/reports/'), 'versioned reports not ignored');
  const prop = files.find((f) => f.rel.includes('gitignore-proposal'));
  assert.ok(prop);
  assert.ok(prop.content.includes('never edits the project root'));
});

test('nested reviews override patterns follow the spec exactly', () => {
  const paths = { ...DEFAULT_ANSWERS.paths };
  // local reports + shared reviews: /reports/* then !/reports/reviews/
  const localReports = buildVersioningFiles({
    configDir: '.tasksystem', paths,
    versioning: { ...ALL_VERSIONING_FALSE, reviews: true },
  }).find((f) => f.rel === '.tasksystem/.gitignore');
  assert.ok(localReports.content.includes('/reports/*'));
  assert.ok(localReports.content.includes('!/reports/reviews/'));
  // shared reports + local reviews: ignore only /reports/reviews/
  const localReviews = buildVersioningFiles({
    configDir: '.tasksystem', paths,
    versioning: { ...ALL_VERSIONING_FALSE, reports: true },
  }).find((f) => f.rel === '.tasksystem/.gitignore');
  assert.ok(localReviews.content.includes('/reports/reviews/'));
  assert.ok(!localReviews.content.includes('/reports/*'));
});

test('outside-workspace paths land in the proposal, root never touched', () => {
  const files = buildVersioningFiles({
    configDir: '.tasksystem',
    paths: VALID_ANSWERS.paths, // custom docs/agent paths
    versioning: ALL_VERSIONING_FALSE,
  });
  const prop = files.find((f) => f.rel.includes('gitignore-proposal'));
  assert.ok(prop.content.includes('/docs/agent/plans/'));
  // Root .gitignore is never a generated destination.
  assert.ok(!files.some((f) => f.rel === '.gitignore'));
});

test('config at project root emits proposal only, no root .gitignore', () => {
  const files = buildVersioningFiles({
    configDir: '.', paths: VALID_ANSWERS.paths,
    versioning: ALL_VERSIONING_FALSE,
  });
  assert.ok(!files.some((f) => f.rel === '.gitignore'));
  assert.ok(files.some((f) => f.rel === 'integrations/gitignore-proposal.txt'));
});

test('init applies versioning files; root .gitignore untouched', () => {
  const dir = makeTempDir('init-ver');
  try {
    writeJson(dir, 'package.json', { name: 'x' });
    const prepared = prepareInit({
      projectRoot: dir, answers: {
        ...DEFAULT_ANSWERS,
        versioning: { ...ALL_VERSIONING_FALSE, tasks: true },
      },
    });
    const rels = prepared.files.map((f) => f.rel);
    assert.ok(rels.includes('.tasksystem/.gitignore'));
    assert.ok(rels.includes('.tasksystem/integrations/gitignore-proposal.txt'));
    assert.ok(rels.includes('.tasksystem/catalog.json'));
    assert.ok(rels.some((r) => r.startsWith('.tasksystem/commands/')));
    assert.ok(!rels.includes('.gitignore'));
    applyPlan(dir, prepared.files);
    const gi = fs.readFileSync(`${dir}/.tasksystem/.gitignore`, 'utf8');
    assert.ok(gi.includes('/plans/'));
    assert.ok(!gi.includes('/tasks/'));
    assert.ok(!exists(dir, '.gitignore'));
  } finally { cleanup(dir); }
});

test('old config without versioning loads and re-inits as no-op', () => {
  const dir = makeTempDir('oldcfg');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const cfg = readJson(dir, '.tasksystem/config.json');
    delete cfg.versioning; // simulate a pre-versioning config file
    writeJson(dir, '.tasksystem/config.json', cfg);
    const { config } = loadConfig(dir);
    assert.deepEqual(config.versioning, ALL_VERSIONING_FALSE);
    const second = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    assert.equal(
      second.files.find((f) => f.rel === '.tasksystem/config.json').action,
      'noop');
  } finally { cleanup(dir); }
});

test('custom explicit paths remain valid with versioning enabled', () => {
  const cfg = createConfig(makeTempDir('x'), {
    ...VALID_ANSWERS,
    versioning: { ...ALL_VERSIONING_FALSE, plans: true },
  }, {});
  assert.equal(cfg.paths.plans, 'docs/agent/plans');
  assert.equal(cfg.versioning.plans, true);
});
