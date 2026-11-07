// Discovery cases (implementation contract cases 1-5 plus bounds rework).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { inspectProject } from '../src/discovery/inspect.mjs';
import {
  cleanup, makeTempDir, trySymlink, writeFile, writeJson,
} from './helpers.mjs';

function pkg(dir, rel, extra = {}) {
  writeJson(dir, rel, { name: 'x', ...extra });
}

test('node project with spaces and real scripts proposes npm commands', () => {
  const dir = makeTempDir('my proj');
  try {
    pkg(dir, 'package.json', { scripts: { test: 't', lint: 'l', build: 'b', dev: 'no' } });
    writeFile(dir, 'package-lock.json', '{}');
    const r = inspectProject(dir);
    assert.deepEqual(r.stacks.map((s) => s.name), ['node']);
    const cmds = r.commands.map((c) => c.command);
    for (const s of ['test', 'lint', 'build']) {
      assert.ok(cmds.includes(`npm run ${s}`));
    }
    assert.ok(!cmds.includes('npm run dev'));
    assert.ok(r.commands.every((c) => c.approved === false && c.source === 'package.json'));
  } finally { cleanup(dir); }
});

test('monorepo nested package reports its own cwd and pm', () => {
  const dir = makeTempDir('mono repo');
  try {
    pkg(dir, 'packages/a pp/package.json', { scripts: { test: 't' } });
    writeFile(dir, 'packages/a pp/pnpm-lock.yaml', '');
    const r = inspectProject(dir);
    assert.equal(r.commands.length, 1);
    assert.equal(r.commands[0].command, 'pnpm run test');
    assert.equal(r.commands[0].cwd, 'packages/a pp');
  } finally { cleanup(dir); }
});

test('no manifest means no stack; src alone implies nothing', () => {
  const dir = makeTempDir('empty');
  try {
    writeFile(dir, 'src/main.rs', 'fn main() {}\n');
    const r = inspectProject(dir);
    assert.deepEqual(r.stacks, []);
    assert.deepEqual(r.commands, []);
    assert.equal(r.fingerprint.length, 64);
  } finally { cleanup(dir); }
});

test('non-node stacks are recognized without invented commands', () => {
  const dir = makeTempDir('poly');
  try {
    writeFile(dir, 'Cargo.toml', '[package]\nname="x"\n');
    writeFile(dir, 'pyproject.toml', '[project]\nname="x"\n');
    writeFile(dir, 'go.mod', 'module x\n');
    writeFile(dir, 'pom.xml', '<project/>\n');
    writeFile(dir, 'composer.json', '{}');
    writeFile(dir, 'Gemfile', 'source "x"\n');
    writeFile(dir, 'app.csproj', '<Project/>\n');
    const r = inspectProject(dir);
    assert.deepEqual(r.stacks.map((s) => s.name), [
      'dotnet', 'go', 'java', 'php', 'python', 'ruby', 'rust',
    ]);
    assert.deepEqual(r.commands, []);
  } finally { cleanup(dir); }
});

test('malformed, non-object and oversized manifests warn', () => {
  const dir = makeTempDir('bad');
  try {
    writeFile(dir, 'package.json', '{ not json');
    writeFile(dir, 'nullproj/package.json', 'null');
    writeFile(dir, 'arrproj/package.json', '["a"]');
    writeFile(dir, 'big/Cargo.toml', `# ${'x'.repeat(140 * 1024)}`);
    const r = inspectProject(dir);
    const codes = r.warnings.map((w) => w.code);
    assert.ok(codes.includes('MALFORMED_JSON'));
    assert.ok(codes.includes('MANIFEST_TOO_LARGE'));
    assert.equal(codes.filter((c) => c === 'INVALID_MANIFEST').length, 2);
    assert.deepEqual(r.commands, []);
  } finally { cleanup(dir); }
});

test('secrets, node_modules, legacy and hidden dirs are skipped', () => {
  const dir = makeTempDir('guard');
  try {
    writeJson(dir, 'node_modules/pkg/package.json', { name: 'p' });
    writeJson(dir, 'legacy/old/package.json', { name: 'o' });
    writeJson(dir, '.tasksystem/state/package.json', { name: 's' });
    writeFile(dir, '.env', 'SECRET=1\n');
    writeJson(dir, '.hidden/package.json', { name: 'h' });
    pkg(dir, 'real/package.json', { scripts: { test: 't' } });
    writeFile(dir, 'real/package-lock.json', '{}');
    const r = inspectProject(dir);
    const manifests = r.evidence.filter((e) => e.type === 'manifest')
      .map((e) => e.path);
    assert.deepEqual(manifests, ['real/package.json']);
  } finally { cleanup(dir); }
});

test('symlinked directories are never followed', (t) => {
  const dir = makeTempDir('guard-link');
  try {
    const target = makeTempDir('guard-target');
    try {
      writeJson(target, 'package.json', { name: 't' });
      try {
        fs.symlinkSync(target, path.join(dir, 'linked'), 'junction');
      } catch (e) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(e.code)) {
          t.skip(`symlink creation unavailable: ${e.code}`);
          return;
        }
        throw e;
      }
      const r = inspectProject(dir);
      assert.ok(!r.evidence.some((e) => e.path.startsWith('linked')));
    } finally { cleanup(target); }
  } finally { cleanup(dir); }
});

test('fingerprint is deterministic, path-independent, lockfile-sensitive', () => {
  const a = makeTempDir('fp-a');
  const b = makeTempDir('fp-b');
  try {
    const pkgObj = { name: 'x', scripts: { test: 't' } };
    writeJson(a, 'package.json', pkgObj);
    writeJson(b, 'package.json', pkgObj);
    const fa = inspectProject(a).fingerprint;
    assert.equal(fa, inspectProject(b).fingerprint);
    assert.equal(inspectProject(a).fingerprint, fa);
    // Same-size lockfile addition changes the fingerprint via presence.
    writeFile(a, 'package-lock.json', '{}');
    const fa2 = inspectProject(a).fingerprint;
    assert.notEqual(fa2, fa);
    // Swapping lockfile presence (same size) changes it again.
    fs.rmSync(path.join(a, 'package-lock.json'));
    writeFile(a, 'yarn.lock', '{}');
    const fa3 = inspectProject(a).fingerprint;
    assert.notEqual(fa3, fa2);
    // Manifest content change also changes it.
    writeJson(a, 'package.json', { ...pkgObj, version: '2.0.0' });
    assert.notEqual(inspectProject(a).fingerprint, fa3);
  } finally { cleanup(a); cleanup(b); }
});

test('declared packageManager wins with a conflict warning', () => {
  const dir = makeTempDir('pm');
  try {
    writeJson(dir, 'package.json', {
      name: 'x', packageManager: 'pnpm@9.0.0', scripts: { test: 't' },
    });
    writeFile(dir, 'package-lock.json', '{}');
    const r = inspectProject(dir);
    assert.equal(r.commands[0].command, 'pnpm run test');
    assert.ok(r.warnings.some((w) => w.code === 'CONTRADICTORY_PM'));
  } finally { cleanup(dir); }
});

test('ambiguous or absent pm signals produce command:null and warnings', () => {
  const dir = makeTempDir('pm2');
  try {
    writeJson(dir, 'multi/package.json', { name: 'm', scripts: { test: 't' } });
    writeFile(dir, 'multi/package-lock.json', '{}');
    writeFile(dir, 'multi/yarn.lock', '');
    writeJson(dir, 'none/package.json', { name: 'n', scripts: { test: 't' } });
    writeJson(dir, 'weird/package.json', {
      name: 'w', packageManager: 'custompm@1', scripts: { test: 't' },
    });
    const r = inspectProject(dir);
    const codes = r.warnings.map((w) => w.code);
    assert.ok(codes.includes('CONTRADICTORY_PM'));
    assert.ok(codes.includes('PACKAGE_MANAGER_UNCONFIRMED'));
    assert.ok(codes.includes('UNKNOWN_PACKAGE_MANAGER'));
    assert.ok(r.commands.length > 0);
    assert.ok(r.commands.every((c) => c.command === null));
  } finally { cleanup(dir); }
});

test('depth limit warns as partial, entries budget truncates', () => {
  const dir = makeTempDir('deep');
  try {
    writeJson(dir, 'a/b/c/d/e/package.json', { name: 'deep' });
    const r = inspectProject(dir);
    assert.ok(r.warnings.some((w) => w.code === 'SCAN_PARTIAL_DEPTH'));
    assert.ok(!r.evidence.some((e2) => e2.path.includes('e/package.json')));
    const flat = makeTempDir('many');
    try {
      for (let i = 0; i < 1005; i++) writeFile(flat, `f${String(i).padStart(4, '0')}.txt`, 'x');
      const r2 = inspectProject(flat);
      assert.ok(r2.warnings.some((w) => w.code === 'SCAN_TRUNCATED'));
    } finally { cleanup(flat); }
  } finally { cleanup(dir); }
});

test('global entry budget never exceeds 1000; queued dirs stay unvisited', () => {
  const dir = makeTempDir('over-budget');
  try {
    for (let i = 0; i < 1100; i++) {
      writeFile(dir, `f${String(i).padStart(4, '0')}.csproj`, '<Project/>\n');
    }
    const r = inspectProject(dir);
    assert.ok(r.evidence.length <= 1000);
    assert.ok(r.warnings.some((w) => w.code === 'SCAN_TRUNCATED'));
  } finally { cleanup(dir); }
});

test('readDirBounded: exact max is not truncated, one more is', async () => {
  const { readDirBounded } = await import('../src/core/fsx.mjs');
  const dir = makeTempDir('bounded-dir');
  try {
    for (let i = 0; i < 5; i++) writeFile(dir, `f${i}.txt`, 'x');
    assert.equal(readDirBounded(dir, 5).truncated, false);
    assert.equal(readDirBounded(dir, 5).entries.length, 5);
    const limited = readDirBounded(dir, 4);
    assert.equal(limited.entries.length, 4);
    assert.equal(limited.truncated, true);
  } finally { cleanup(dir); }
});

test('unreadable directory produces a warning, not a crash', () => {
  const dir = makeTempDir('unread');
  try {
    writeFile(dir, 'blocked/x.txt', 'x');
    const orig = fs.opendirSync;
    fs.opendirSync = (p, o) => {
      if (String(p).endsWith('blocked')) {
        const e = new Error('denied'); e.code = 'EACCES'; throw e;
      }
      return orig(p, o);
    };
    try {
      const r = inspectProject(dir);
      assert.ok(r.warnings.some((w) => w.code === 'DIR_UNREADABLE'));
    } finally {
      fs.opendirSync = orig;
    }
  } finally { cleanup(dir); }
});

test('unreadable manifest produces a warning, not a crash', () => {
  const dir = makeTempDir('unread-m');
  try {
    writeFile(dir, 'Cargo.toml', '[package]\nname="x"\n');
    const orig = fs.openSync;
    fs.openSync = (p, f) => {
      if (String(p).endsWith('Cargo.toml')) {
        const e = new Error('denied'); e.code = 'EACCES'; throw e;
      }
      return orig(p, f);
    };
    try {
      const r = inspectProject(dir);
      assert.ok(r.warnings.some((w) => w.code === 'MANIFEST_UNREADABLE'));
    } finally {
      fs.openSync = orig;
    }
  } finally { cleanup(dir); }
});
