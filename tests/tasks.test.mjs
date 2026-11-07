// Task lifecycle cases (contract cases 11-12 plus stored-data gates).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import {
  createTask, getTask, listTasks, taskFilePath,
} from '../src/core/tasks.mjs';
import { checkAction, transitionTask } from '../src/core/transition.mjs';
import {
  VALID_ANSWERS, cleanup, makeTempDir, trySymlink, writeJson,
} from './helpers.mjs';

function setup() {
  const dir = makeTempDir('tasks');
  const config = createConfig(dir, VALID_ANSWERS, {});
  writeJson(dir, '.tasksystem/config.json', config);
  const ctx = resolveContext({ project: dir });
  const task = createTask(ctx, {
    title: 'T', contract: 'C', authorContext: 'author-ctx', scope: ['src/x'],
  });
  return { dir, ctx, task };
}

function step(ctx, id, to, rev, evidence = {}) {
  return transitionTask(ctx, { id, to, expectedRevision: rev, ...evidence });
}

const VERIFY_OK = {
  checks: [{ command: 'npm test', cwd: '.', status: 'pass', evidence: 'log:1' }],
};
const FRESH_REVIEW = {
  mode: 'fresh', reviewer: 'rev', authorContext: 'author-ctx',
  reviewerContext: 'reviewer-ctx', verdict: 'approve',
};

function toReview(ctx, task) {
  step(ctx, task.id, 'ACT', 0);
  step(ctx, task.id, 'VERIFY', 1);
  step(ctx, task.id, 'EVALUATE', 2);
  return step(ctx, task.id, 'REVIEW', 3);
}

test('create writes JSON with PLAN state and revision 0', () => {
  const { dir, ctx, task } = setup();
  try {
    assert.equal(task.state, 'PLAN');
    assert.equal(task.revision, 0);
    assert.ok(fs.existsSync(taskFilePath(ctx, task.id)));
    assert.throws(
      () => createTask(ctx, { title: 't', contract: 'c', authorContext: 'a', bogus: 1 }),
      (e) => e.code === 'UNKNOWN_KEY');
    assert.throws(
      () => createTask(ctx, { title: '', contract: 'c', authorContext: 'a' }),
      (e) => e.code === 'INVALID_VALUE');
    assert.throws(
      () => createTask(ctx, { title: 't', contract: 'c', authorContext: 'a', scope: ['../x'] }),
      (e) => e.code === 'INVALID_PATH' || e.code === 'RESERVED_PATH');
  } finally { cleanup(dir); }
});

test('valid/invalid transitions, UUID traversal, stale revision', () => {
  const { dir, ctx, task } = setup();
  try {
    const next = step(ctx, task.id, 'ACT', 0);
    assert.equal(next.state, 'ACT');
    assert.equal(next.revision, 1);
    assert.throws(() => step(ctx, task.id, 'ACCEPT', 1),
      (e) => e.code === 'INVALID_TRANSITION');
    assert.throws(() => step(ctx, task.id, 'VERIFY', 0),
      (e) => e.code === 'REVISION_MISMATCH');
    assert.throws(() => getTask(ctx, '../../etc/passwd'),
      (e) => e.code === 'INVALID_ID');
    assert.throws(() => step(ctx, task.id, 'NOWHERE', 1),
      (e) => e.code === 'INVALID_STATE');
    assert.throws(
      () => transitionTask(ctx, { id: task.id, to: 'STALL', expectedRevision: 1, bogus: 1 }),
      (e) => e.code === 'UNKNOWN_KEY');
  } finally { cleanup(dir); }
});

test('an existing lock is a conflict, never recovered', () => {
  const { dir, ctx, task } = setup();
  try {
    const lock = taskFilePath(ctx, task.id) + '.lock';
    fs.writeFileSync(lock, 'held', { flag: 'wx' });
    assert.throws(() => step(ctx, task.id, 'ACT', 0),
      (e) => e.code === 'TASK_LOCKED');
    fs.rmSync(lock);
    const after = step(ctx, task.id, 'ACT', 0);
    assert.equal(after.state, 'ACT');
    assert.ok(!fs.existsSync(lock));
  } finally { cleanup(dir); }
});

test('corrupt task files surface; non-UUID names are malformed', () => {
  const { dir, ctx, task } = setup();
  try {
    fs.writeFileSync(taskFilePath(ctx, task.id), '{broken json');
    writeJson(dir, 'docs/agent/tasks/not-a-uuid.json', { hello: 1 });
    const listed = listTasks(ctx);
    assert.equal(listed.tasks.length, 0);
    assert.equal(listed.malformed.length, 2);
    assert.ok(listed.malformed.every((m) => m.error.code === 'TASK_MALFORMED'));
    assert.throws(() => getTask(ctx, task.id), (e) => e.code === 'TASK_MALFORMED');
  } finally { cleanup(dir); }
});

test('stored id that disagrees with filename is malformed', () => {
  const { dir, ctx, task } = setup();
  try {
    const file = taskFilePath(ctx, task.id);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.id = '11111111-1111-4111-8111-111111111111';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, task.id),
      (e) => e.code === 'TASK_MALFORMED');
  } finally { cleanup(dir); }
});

test('malformed history, scope and stored evidence are rejected', () => {
  const { dir, ctx, task } = setup();
  try {
    const file = taskFilePath(ctx, task.id);
    const bytes = fs.readFileSync(file);
    const data = JSON.parse(bytes.toString('utf8'));
    data.history = 'oops';
    fs.writeFileSync(file, JSON.stringify(data));
    assert.throws(() => getTask(ctx, task.id), (e) => e.code === 'TASK_MALFORMED');
    const d2 = JSON.parse(bytes.toString('utf8'));
    d2.scope = ['a/../b'];
    fs.writeFileSync(file, JSON.stringify(d2));
    assert.throws(() => getTask(ctx, task.id), (e) => e.code === 'TASK_MALFORMED');
    const d3 = JSON.parse(bytes.toString('utf8'));
    d3.verification = { checks: [{ command: 'x', cwd: '.', status: 'fail', evidence: 'e' }] };
    fs.writeFileSync(file, JSON.stringify(d3));
    assert.throws(() => getTask(ctx, task.id), (e) => e.code === 'TASK_MALFORMED');
    fs.writeFileSync(file, bytes); // restore valid bytes
    assert.equal(getTask(ctx, task.id).state, 'PLAN');
  } finally { cleanup(dir); }
});

test('scope entries that cross a symlink are rejected at create', (t) => {
  const dir = makeTempDir('tasks-link');
  try {
    const config = createConfig(dir, VALID_ANSWERS, {});
    writeJson(dir, '.tasksystem/config.json', config);
    writeJson(dir, 'real/package.json', { name: 'x' });
    const ctx = resolveContext({ project: dir });
    let made = false;
    try {
      fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'), 'junction');
      made = true;
    } catch (e) {
      if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(e.code)) {
        t.skip(`symlink creation unavailable: ${e.code}`);
        return;
      }
      throw e;
    }
    if (made) {
      assert.throws(
        () => createTask(ctx, {
          title: 'T', contract: 'C', authorContext: 'a', scope: ['link/package.json'],
        }),
        (e) => e.code === 'SYMLINK_REJECTED');
    }
  } finally { cleanup(dir); }
});

test('ACCEPT requires valid evidence; failures leave state unchanged', () => {
  const { dir, ctx, task } = setup();
  try {
    toReview(ctx, task);
    const before = fs.readFileSync(taskFilePath(ctx, task.id));
    const bad = [
      {},
      { verification: { checks: [{ command: 'x', cwd: '.', status: 'fail', evidence: 'e' }] }, review: FRESH_REVIEW },
      { verification: VERIFY_OK, review: { ...FRESH_REVIEW, reviewerContext: 'author-ctx' } },
      { verification: VERIFY_OK, review: { ...FRESH_REVIEW, authorContext: 'other' } },
      { verification: VERIFY_OK, review: { mode: 'waived', verdict: 'approve', owner: 'o' } },
    ];
    for (const ev of bad) {
      assert.throws(() => step(ctx, task.id, 'ACCEPT', 4, ev));
      const after = fs.readFileSync(taskFilePath(ctx, task.id));
      assert.ok(after.equals(before), 'failed transition must not alter bytes');
    }
    const accepted = step(ctx, task.id, 'ACCEPT', 4, {
      verification: VERIFY_OK, review: FRESH_REVIEW,
    });
    assert.equal(accepted.state, 'ACCEPT');
    assert.equal(accepted.revision, 5);
  } finally { cleanup(dir); }
});

test('waiver requires owner, reference and reason; ACT voids evidence', () => {
  const { dir, ctx, task } = setup();
  try {
    toReview(ctx, task);
    const accepted = step(ctx, task.id, 'ACCEPT', 4, {
      verification: VERIFY_OK,
      review: { mode: 'waived', owner: 'o', reference: 'w-1', reason: 'r', verdict: 'approve' },
    });
    assert.equal(accepted.state, 'ACCEPT');
    const back = step(ctx, task.id, 'ACT', 5);
    assert.equal(back.verification, null);
    assert.equal(back.review, null);
  } finally { cleanup(dir); }
});

test('checkAction reports policy allowance for the stored state', () => {
  const { dir, ctx, task } = setup();
  try {
    assert.equal(checkAction(ctx, task.id, 'edit').allowed, false);
    step(ctx, task.id, 'ACT', 0);
    assert.equal(checkAction(ctx, task.id, 'edit').allowed, true);
    assert.throws(() => checkAction(ctx, task.id, 'frobnicate'),
      (e) => e.code === 'INVALID_ACTION');
  } finally { cleanup(dir); }
});
