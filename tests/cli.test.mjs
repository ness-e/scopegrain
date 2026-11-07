// CLI surface cases: JSON to stdout, errors to stderr, exit codes,
// no implicit writes without --apply or an interactive 'yes'.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../src/cli.mjs';
import { createConfig } from '../src/core/config.mjs';
import {
  VALID_ANSWERS, cleanup, exists, fakeIO, makeTempDir, writeJson,
} from './helpers.mjs';

function lastJson(io) {
  return JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
}

function writeAnswers(dir) {
  const f = `${dir}-answers.json`;
  fs.writeFileSync(f, JSON.stringify(VALID_ANSWERS, null, 2));
  return f;
}

test('inspect prints JSON to stdout and writes nothing', async () => {
  const dir = makeTempDir('cli-inspect');
  try {
    writeJson(dir, 'package.json', { name: 'x', scripts: { test: 't' } });
    const io = fakeIO();
    assert.equal(await run(['inspect', '--project', dir], io), 0);
    const out = lastJson(io);
    assert.equal(out.schemaVersion, 1);
    assert.equal(out.stacks[0].name, 'node');
    assert.deepEqual(io.out.stderr, []);
  } finally { cleanup(dir); }
});

test('--help lists commands; unknown commands and flags fail', async () => {
  const io = fakeIO();
  assert.equal(await run(['--help'], io), 0);
  const help = lastJson(io);
  assert.ok(help.commands.length >= 8);
  const io2 = fakeIO();
  assert.equal(await run(['frobnicate'], io2), 1);
  assert.equal(JSON.parse(io2.out.stderr[0]).error.code, 'INVALID_ARGS');
  const io3 = fakeIO();
  assert.equal(await run(['inspect'], io3), 1);
  const io4 = fakeIO();
  // Flag that does not belong to the command is rejected.
  assert.equal(await run(['inspect', '--project', 'x', '--apply'], io4), 1);
  const io5 = fakeIO();
  // A flag value must not silently consume the next flag.
  assert.equal(await run(['inspect', '--project', '--config'], io5), 1);
});

test('extra positionals are rejected before any write', async () => {
  const dir = makeTempDir('cli-pos');
  const answersFile = writeAnswers(dir);
  try {
    const io = fakeIO();
    const code = await run(
      ['init', '--project', dir, '--answers', answersFile, 'typo', '--apply'], io);
    assert.equal(code, 1);
    assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INVALID_ARGS');
    assert.ok(!exists(dir, '.tasksystem/config.json'));
    assert.ok(!exists(dir, 'AGENTS.md'));
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('init --answers without --apply is a dry-run and writes nothing', async () => {
  const dir = makeTempDir('cli-init-dry');
  const answersFile = writeAnswers(dir);
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--answers', answersFile], io), 0);
    assert.equal(lastJson(io).mode, 'dry-run');
    assert.ok(!exists(dir, '.tasksystem/config.json'));
    assert.ok(!exists(dir, 'AGENTS.md'));
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('init --answers --apply creates the plan once', async () => {
  const dir = makeTempDir('cli-init-apply');
  const answersFile = writeAnswers(dir);
  try {
    const io = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--answers', answersFile, '--apply'], io), 0);
    assert.equal(lastJson(io).mode, 'applied');
    assert.ok(exists(dir, '.tasksystem/config.json'));
    assert.ok(exists(dir, 'CLAUDE.md'));
    const io2 = fakeIO();
    assert.equal(await run(
      ['init', '--project', dir, '--answers', answersFile, '--apply'], io2), 0);
    assert.equal(lastJson(io2).created, 0);
  } finally { cleanup(dir); cleanup(answersFile); }
});

test('init without --answers refuses non-interactive sessions', async () => {
  const dir = makeTempDir('cli-init-notty');
  try {
    const io = fakeIO({ tty: false });
    assert.equal(await run(['init', '--project', dir], io), 1);
    assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INTERACTIVE_REQUIRED');
    assert.ok(!exists(dir, '.tasksystem/config.json'));
  } finally { cleanup(dir); }
});

test('--yes and --force are rejected explicitly', async () => {
  const dir = makeTempDir('cli-flags');
  try {
    for (const flag of ['--yes', '--force']) {
      const io = fakeIO({ tty: true });
      assert.equal(await run(['init', '--project', dir, flag], io), 1);
      assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INVALID_ARGS');
    }
  } finally { cleanup(dir); }
});

test('task lifecycle through the CLI', async () => {
  const dir = makeTempDir('cli-task');
  const answersFile = writeAnswers(dir);
  const evidenceFile = `${dir}-evidence.json`;
  try {
    fs.writeFileSync(evidenceFile, JSON.stringify({
      verification: {
        checks: [{ command: 'npm test', cwd: '.', status: 'pass', evidence: 'x' }],
      },
      review: {
        mode: 'fresh', reviewer: 'r', authorContext: 'ctx-a',
        reviewerContext: 'ctx-b', verdict: 'approve',
      },
    }));
    const io = fakeIO();
    await run(['init', '--project', dir, '--answers', answersFile, '--apply'], io);
    const ioC = fakeIO();
    await run(['task', 'create', '--project', dir, '--title', 'T',
      '--contract', 'C', '--author', 'ctx-a', '--scope', 'src/x'], ioC);
    const task = lastJson(ioC);
    assert.equal(task.state, 'PLAN');
    const ioL = fakeIO();
    await run(['task', 'list', '--project', dir], ioL);
    assert.equal(lastJson(ioL).tasks.length, 1);
    const ioS = fakeIO();
    await run(['task', 'show', '--project', dir, task.id], ioS);
    assert.equal(lastJson(ioS).id, task.id);
    const ioT = fakeIO();
    await run(['task', 'transition', '--project', dir, task.id, 'ACT',
      '--revision', '0'], ioT);
    assert.equal(lastJson(ioT).state, 'ACT');
    const ioBad = fakeIO();
    const code = await run(['task', 'transition', '--project', dir, task.id,
      'ACCEPT', '--revision', '1'], ioBad);
    assert.equal(code, 1);
    assert.equal(JSON.parse(ioBad.out.stderr[0]).error.code, 'INVALID_TRANSITION');
    const ioE = fakeIO();
    assert.equal(await run(['task', 'transition', '--project', dir, task.id,
      'VERIFY', '--revision', '1', '--evidence', evidenceFile], ioE), 0);
    assert.equal(lastJson(ioE).state, 'VERIFY');
    const ioCE = fakeIO();
    const badEvidence = `${dir}-bad.json`;
    fs.writeFileSync(badEvidence, JSON.stringify({ verification: {}, unknown: 1 }));
    await run(['task', 'transition', '--project', dir, task.id, 'EVALUATE',
      '--revision', '2', '--evidence', badEvidence], ioCE);
    assert.equal(JSON.parse(ioCE.out.stderr[0]).error.code, 'INVALID_EVIDENCE');
    cleanup(badEvidence);
  } finally { cleanup(dir); cleanup(answersFile); cleanup(evidenceFile); }
});

test('doctor reports needs-attention before bootstrap files exist', async () => {
  const dir = makeTempDir('cli-doctor');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, VALID_ANSWERS, { fingerprint: 'x', stacks: [], evidence: [] }));
    const io = fakeIO();
    assert.equal(await run(['doctor', '--project', dir], io), 0);
    const out = lastJson(io);
    assert.equal(out.status, 'needs-attention');
    assert.equal(out.changedDiscovery, true);
  } finally { cleanup(dir); }
});
