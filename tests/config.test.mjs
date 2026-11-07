// Config validation cases (implementation contract case 7).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createConfig, loadConfig, validateAnswers, validateArtifactPaths,
} from '../src/core/config.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

function answersWith(patch) {
  return { ...VALID_ANSWERS, ...patch, paths: { ...VALID_ANSWERS.paths, ...(patch.paths || {}) } };
}

test('answers validation: strict keys, locale, hosts', () => {
  assert.throws(() => validateAnswers({ ...VALID_ANSWERS, extra: 1 }),
    (e) => e.code === 'UNKNOWN_KEY');
  assert.throws(() => validateAnswers(answersWith({ locale: 'fr' })),
    (e) => e.code === 'INVALID_LOCALE');
  assert.throws(() => validateAnswers(answersWith({ hosts: [] })),
    (e) => e.code === 'INVALID_HOSTS');
  assert.throws(() => validateAnswers(answersWith({ hosts: ['claude', 'claude'] })),
    (e) => e.code === 'INVALID_HOSTS');
  assert.throws(() => validateAnswers(answersWith({ hosts: ['gpt'] })),
    (e) => e.code === 'UNKNOWN_HOST');
  assert.throws(() => validateAnswers(answersWith({ name: '  ' })),
    (e) => e.code === 'INVALID_VALUE');
  const { name: _n, ...missing } = VALID_ANSWERS;
  assert.throws(() => validateAnswers(missing),
    (e) => e.code === 'INVALID_ANSWERS');
});

test('artifact paths: all seven required, safe, non-overlapping', () => {
  const withoutTasks = { ...VALID_ANSWERS.paths };
  delete withoutTasks.tasks;
  assert.throws(() => validateArtifactPaths(withoutTasks),
    (e) => e.code === 'INVALID_PATHS');
  assert.throws(
    () => validateArtifactPaths({ ...VALID_ANSWERS.paths, tasks: '../x' }),
    (e) => e.code === 'INVALID_PATH');
  assert.throws(
    () => validateArtifactPaths({
      ...VALID_ANSWERS.paths, plans: 'docs/agent', tasks: 'docs/agent/tasks',
    }),
    (e) => e.code === 'PATH_OVERLAP');
});

test('createConfig produces the contract shape', () => {
  const dir = makeTempDir('cfg');
  try {
    const config = createConfig(dir, VALID_ANSWERS, {
      fingerprint: 'abc', stacks: [{ name: 'node' }], evidence: [],
    });
    assert.equal(config.schemaVersion, 1);
    assert.equal(config.project.root, '.');
    assert.equal(config.verification.mode, 'manual');
    assert.deepEqual(config.verification.commands, []);
    assert.equal(config.discovery.fingerprint, 'abc');
  } finally { cleanup(dir); }
});

test('loadConfig validates version, types and unknown keys', () => {
  const dir = makeTempDir('cfg2');
  try {
    const good = createConfig(dir, VALID_ANSWERS, {});
    writeJson(dir, '.tasksystem/config.json', good);
    const { config, configPath } = loadConfig(dir);
    assert.equal(configPath, '.tasksystem/config.json');
    assert.equal(config.project.name, 'fixture-project');

    writeJson(dir, '.tasksystem/config.json', { ...good, schemaVersion: 2 });
    assert.throws(() => loadConfig(dir), (e) => e.code === 'CONFIG_VERSION');
    writeJson(dir, '.tasksystem/config.json', { ...good, typo: true });
    assert.throws(() => loadConfig(dir), (e) => e.code === 'UNKNOWN_KEY');
    writeJson(dir, '.tasksystem/config.json',
      { ...good, project: { name: 'x', root: '/abs' } });
    assert.throws(() => loadConfig(dir), (e) => e.code === 'INVALID_VALUE');
    writeJson(dir, '.tasksystem/config.json', { bad: '{' });
    assert.throws(() => loadConfig(dir), (e) =>
      e.code === 'UNKNOWN_KEY' || e.code === 'INVALID_ANSWERS');
    writeJson(dir, '.tasksystem/config.json', good);
  } finally { cleanup(dir); }
});

test('loadConfig rejects missing and non-file configs', () => {
  const dir = makeTempDir('cfg3');
  try {
    assert.throws(() => loadConfig(dir), (e) => e.code === 'CONFIG_NOT_FOUND');
    writeFile(dir, '.tasksystem/config.json', '{broken');
    assert.throws(() => loadConfig(dir), (e) => e.code === 'MALFORMED_JSON');
  } finally { cleanup(dir); }
});
