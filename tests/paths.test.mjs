// Path safety cases (implementation contract case 6 plus Windows aliases).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {
  assertDestination, assertDistinctPaths, assertNoSymlinkChain,
  isSameOrAncestor, resolveInside, resolveProjectRoot,
  toCanonicalRelative,
} from '../src/core/paths.mjs';
import { cleanup, makeTempDir, trySymlink, writeFile } from './helpers.mjs';

const REJECTED = [
  '../escape', '..', './x', 'x/./y', '/abs/posix', 'C:/win', 'c:\\win',
  '\\\\server\\share', 'a:b', 'x:y/z', '', 'a//b', 'a/', '/',
  '.git', '.git/config', '.GIT/x', 'Node_Modules/pkg', 'LEGACY/old',
  '.opencode/x', 'node_modules/pkg', 'legacy/x',
  'a<b', 'a>b', 'a|b', 'a?b', 'a*b', 'a"b',
  'trail /x', 'trail./x', 'NUL', 'NUL.txt', 'con/x', 'COM1', 'lpt9.md',
  'aux/file',
];

test('unsafe, reserved and Windows-hostile paths are rejected', () => {
  for (const p of REJECTED) {
    assert.throws(() => assertDestination(p), (e) =>
      e.code === 'INVALID_PATH' || e.code === 'RESERVED_PATH',
    `expected rejection for ${JSON.stringify(p)}`);
  }
});

test('canonical relative paths accepted; Unicode and backslashes kept', () => {
  assert.equal(assertDestination('docs/agent/plans'), 'docs/agent/plans');
  assert.equal(assertDestination('docs\\agent\\plans'), 'docs/agent/plans');
  assert.equal(assertDestination('.tasksystem/memory'), '.tasksystem/memory');
  assert.equal(assertDestination('docs/españa/planes'), 'docs/españa/planes');
  assert.equal(assertDestination('日本語/ファイル'), '日本語/ファイル');
});

test('overlap detection is case-insensitive on all platforms', () => {
  assert.throws(
    () => assertDistinctPaths([['a', 'Docs/Tasks'], ['b', 'docs/tasks/x']]),
    (e) => e.code === 'PATH_OVERLAP');
  assert.throws(
    () => assertDistinctPaths([['a', 'X/Y'], ['b', 'x/y']]),
    (e) => e.code === 'PATH_OVERLAP');
  assertDistinctPaths([['a', 'x'], ['b', 'y']]);
});

test('isSameOrAncestor uses the portable comparison key', () => {
  assert.ok(isSameOrAncestor('A', 'a/b'));
  assert.ok(!isSameOrAncestor('a', 'ab'));
});

test('resolveInside enforces real containment and real ancestors', () => {
  const dir = makeTempDir('root');
  try {
    const root = resolveProjectRoot(dir);
    assert.equal(
      resolveInside(root, 'docs/x'), path.join(root, 'docs', 'x'));
    assert.throws(() => resolveInside(root, '../x'),
      (e) => e.code === 'INVALID_PATH' || e.code === 'OUTSIDE_ROOT');
    // A pre-existing regular FILE as ancestor is rejected.
    writeFile(dir, 'blocked', 'x');
    assert.throws(() => resolveInside(root, 'blocked/inner.txt'),
      (e) => e.code === 'FILE_ANCESTOR');
  } finally { cleanup(dir); }
});

test('symlink ancestors are rejected', (t) => {
  const dir = makeTempDir('root-link');
  try {
    const root = resolveProjectRoot(dir);
    writeFile(dir, 'real/inner.txt', 'x');
    const linked = path.join(dir, 'linked');
    let made = false;
    try {
      fs.symlinkSync(path.join(dir, 'real'), linked, 'junction');
      made = true;
    } catch (e) {
      if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(e.code)) {
        t.skip(`symlink creation unavailable: ${e.code}`);
        return;
      }
      throw e;
    }
    if (made) {
      assert.throws(() => resolveInside(root, 'linked/inner.txt'),
        (e) => e.code === 'SYMLINK_REJECTED');
      assert.throws(
        () => assertNoSymlinkChain(root, path.join(linked, 'inner.txt')),
        (e) => e.code === 'SYMLINK_REJECTED');
    }
  } finally { cleanup(dir); }
});

test('project root must exist and be a real directory', () => {
  const dir = makeTempDir('root-ok');
  try {
    assert.equal(resolveProjectRoot(dir), path.resolve(dir));
    assert.throws(() => resolveProjectRoot(path.join(dir, 'missing')),
      (e) => e.code === 'PROJECT_NOT_FOUND');
    const file = writeFile(dir, 'file.txt', 'x');
    assert.throws(() => resolveProjectRoot(file),
      (e) => e.code === 'PROJECT_NOT_DIR' || e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); }
});

test('toCanonicalRelative rejects non-strings and control characters', () => {
  assert.throws(() => toCanonicalRelative(42), (e) => e.code === 'INVALID_PATH');
  assert.throws(
    () => toCanonicalRelative(['a', 'b'].join(String.fromCharCode(0))),
    (e) => e.code === 'INVALID_PATH');
  assert.throws(() => toCanonicalRelative(['a','b'].join(String.fromCharCode(31))), (e) => e.code === 'INVALID_PATH');
});
