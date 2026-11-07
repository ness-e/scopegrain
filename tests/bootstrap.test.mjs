// Init plan cases (implementation contract cases 8-9 plus reworked gates).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, readJson, trySymlink,
  writeFile, writeJson,
} from './helpers.mjs';

const GEN = [
  '.tasksystem/config.json',
  '.tasksystem/instructions.md',
  '.tasksystem/discovery.json',
  '.tasksystem/task-contract.md',
  '.tasksystem/integrations/claude-mcp.json',
  '.tasksystem/integrations/codex-mcp.toml',
  '.tasksystem/integrations/opencode-mcp.json',
  '.tasksystem/integrations/devin-mcp.json',
  '.tasksystem/skills/project-onboarding/SKILL.md',
  '.tasksystem/skills/contract-execution/SKILL.md',
  '.tasksystem/skills/independent-review/SKILL.md',
  'AGENTS.md',
  'CLAUDE.md',
];

test('prepareInit is a pure dry-run: nothing is written', () => {
  const dir = makeTempDir('init-dry');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const rels = prepared.files.map((f) => f.rel);
    for (const rel of GEN) assert.ok(rels.includes(rel), `${rel} planned`);
    assert.ok(rels.includes('.tasksystem/catalog.json'));
    assert.ok(rels.includes('.tasksystem/.gitignore'));
    assert.ok(rels.includes('.tasksystem/integrations/gitignore-proposal.txt'));
    assert.ok(rels.some((r) => r.startsWith('.tasksystem/commands/')));
    assert.ok(rels.some((r) => r.startsWith('.tasksystem/skills/')));
    for (const rel of rels) assert.ok(!exists(dir, rel), `${rel} must not exist`);
  } finally { cleanup(dir); }
});

test('apply creates all files; re-run on empty project is a true no-op', () => {
  const dir = makeTempDir('init-apply');
  try {
    const first = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const result = applyPlan(dir, first.files);
    assert.equal(result.created, first.files.length);
    for (const rel of GEN) assert.ok(exists(dir, rel), `${rel} must exist`);
    const config = readJson(dir, '.tasksystem/config.json');
    assert.equal(config.project.name, 'fixture-project');
    const before = fs.readFileSync(`${dir}/.tasksystem/discovery.json`);
    const cfgBefore = fs.readFileSync(`${dir}/.tasksystem/config.json`);
    const second = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    assert.ok(second.files.every((f) => f.action === 'noop'));
    const r2 = applyPlan(dir, second.files);
    assert.equal(r2.created, 0);
    assert.ok(fs.readFileSync(`${dir}/.tasksystem/discovery.json`).equals(before));
    assert.ok(fs.readFileSync(`${dir}/.tasksystem/config.json`).equals(cfgBefore));
  } finally { cleanup(dir); }
});

test('re-init preserves custom formatting and approved commands', () => {
  const dir = makeTempDir('init-preserve');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    // User edits config: custom whitespace AND approved verification entry.
    const custom = '{\n"schemaVersion":1,"project":{"name":"fixture-project","root":"."},\n"locale":"es","hosts":["claude","codex","opencode","devin"],\n"paths":{"plans":"docs/agent/plans","tasks":"docs/agent/tasks","reports":"docs/agent/reports","research":"docs/agent/research","decisions":"docs/agent/decisions","memory":".tasksystem/memory","state":".tasksystem/state"},\n"verification":{"mode":"manual","commands":[{"command":"npm test","cwd":".","approved":true}]},\n"discovery":{"fingerprint":"%F%","stacks":[],"evidence":[]}\n}\n';
    const stored = readJson(dir, '.tasksystem/config.json');
    const withFp = custom.replace('%F%', stored.discovery.fingerprint);
    writeFile(dir, '.tasksystem/config.json', withFp);
    const second = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const cfgFile = second.files.find((f) => f.rel === '.tasksystem/config.json');
    assert.equal(cfgFile.action, 'noop');
    const kept = readJson(dir, '.tasksystem/config.json');
    assert.equal(kept.verification.commands[0].approved, true);
  } finally { cleanup(dir); }
});

test('pre-existing README does not block; pre-existing AGENTS.md does', () => {
  const dir = makeTempDir('init-readme');
  try {
    writeFile(dir, 'README.md', '# user readme\n');
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    assert.ok(prepared.files.length > 0); // README is evidence, not a conflict
    writeFile(dir, 'AGENTS.md', '# pre-existing rules\n');
    assert.throws(
      () => prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }),
      (e) => e.code === 'PLAN_CONFLICT'
        && e.conflicts.some((c) => c.path === 'AGENTS.md'));
    for (const rel of GEN.filter((p) => p !== 'AGENTS.md')) {
      assert.ok(!exists(dir, rel), `${rel} must not have been created`);
    }
  } finally { cleanup(dir); }
});

test('existing config with different answers is an explicit error', () => {
  const dir = makeTempDir('init-diff');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const changed = { ...VALID_ANSWERS, name: 'renamed-project' };
    assert.throws(
      () => prepareInit({ projectRoot: dir, answers: changed }),
      (e) => e.code === 'INIT_CONFLICT');
  } finally { cleanup(dir); }
});

test('claude-only project gets CLAUDE.md without AGENTS.md', () => {
  const dir = makeTempDir('init-claude');
  try {
    const answers = { ...VALID_ANSWERS, hosts: ['claude'] };
    const prepared = prepareInit({ projectRoot: dir, answers });
    const names = prepared.files.map((f) => f.rel);
    assert.ok(names.includes('CLAUDE.md'));
    assert.ok(!names.includes('AGENTS.md'));
    assert.ok(!names.some((n) => n.includes('codex-mcp')));
  } finally { cleanup(dir); }
});

test('config filename colliding with generated siblings is blocked', () => {
  const dir = makeTempDir('init-collide');
  try {
    // Config file that would be an ancestor of generated skill files.
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'cfg/skills', answers: VALID_ANSWERS,
      }),
      (e) => ['PLAN_CONFLICT', 'PATH_COLLISION', 'FILE_ANCESTOR'].includes(e.code));
    // Config file sharing the generated instructions.md destination.
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'cfg/instructions.md', answers: VALID_ANSWERS,
      }),
      (e) => ['PLAN_CONFLICT', 'PATH_COLLISION'].includes(e.code));
    assert.ok(!exists(dir, 'cfg/instructions.md'));
  } finally { cleanup(dir); }
});

test('regular-file ancestor of a destination is blocked before writes', () => {
  const dir = makeTempDir('init-fileanc');
  try {
    writeFile(dir, 'cfg', 'not a directory');
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'cfg/config.json', answers: VALID_ANSWERS,
      }),
      (e) => e.code === 'FILE_ANCESTOR' || e.code === 'PLAN_CONFLICT');
    assert.ok(!exists(dir, 'cfg/config.json'));
  } finally { cleanup(dir); }
});

test('symlink introduced after prepare is caught by apply-time preflight', (t) => {
  const dir = makeTempDir('init-late-link');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const target = makeTempDir('link-target');
    try {
      writeFile(target, 'x.txt', 'x');
      let made = false;
      try {
        fs.mkdirSync(path.join(dir, '.tasksystem'), { recursive: true });
        fs.symlinkSync(target, path.join(dir, '.tasksystem', 'integrations'), 'junction');
        made = true;
      } catch (e) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(e.code)) {
          t.skip(`symlink creation unavailable: ${e.code}`);
          return;
        }
        throw e;
      }
      if (made) {
        assert.throws(() => applyPlan(dir, prepared.files),
          (e) => ['SYMLINK_REJECTED', 'PLAN_CONFLICT'].includes(e.code));
      }
    } finally { cleanup(target); }
  } finally { cleanup(dir); }
});

test('deleted discovery.json is recreated on re-init while config stays', () => {
  const dir = makeTempDir('init-rediscovery');
  try {
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const cfgBefore = fs.readFileSync(`${dir}/.tasksystem/config.json`);
    fs.rmSync(path.join(dir, '.tasksystem', 'discovery.json'));
    const second = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    const dFile = second.files.find((f) => f.rel === '.tasksystem/discovery.json');
    const cFile = second.files.find((f) => f.rel === '.tasksystem/config.json');
    assert.equal(dFile.action, 'create');
    assert.equal(cFile.action, 'noop'); // config bytes preserved
    applyPlan(dir, second.files);
    assert.ok(exists(dir, '.tasksystem/discovery.json'));
    assert.ok(fs.readFileSync(`${dir}/.tasksystem/config.json`).equals(cfgBefore));
  } finally { cleanup(dir); }
});

test('short writes still produce complete files; zero progress rolls back', () => {
  const dir = makeTempDir('init-shortwrite');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    // Writes only 4 bytes per call: loop must complete the file.
    const orig = fs.writeSync;
    fs.writeSync = (fd, buf, off, len) => orig(fd, buf, off, Math.min(len, 4));
    try {
      applyPlan(dir, prepared.files);
    } finally {
      fs.writeSync = orig;
    }
    const written = fs.readFileSync(`${dir}/.tasksystem/config.json`);
    const expected = Buffer.isBuffer(prepared.files[0].content)
      ? prepared.files[0].content : Buffer.from(prepared.files[0].content);
    assert.ok(written.equals(expected));

    // Zero-progress write fails structurally and rolls back own files.
    const dir2 = makeTempDir('init-zerowrite');
    try {
      const prepared2 = prepareInit({ projectRoot: dir2, answers: VALID_ANSWERS });
      fs.writeSync = () => 0;
      try {
        assert.throws(() => applyPlan(dir2, prepared2.files));
      } finally {
        fs.writeSync = orig;
      }
      assert.ok(!exists(dir2, '.tasksystem/config.json'));
      assert.ok(!exists(dir2, 'AGENTS.md'));
    } finally { cleanup(dir2); }
  } finally { cleanup(dir); }
});

test('mid-write failure rolls back only files created by this operation', () => {
  const dir = makeTempDir('init-rollback');
  try {
    const prepared = prepareInit({ projectRoot: dir, answers: VALID_ANSWERS });
    writeFile(dir, 'keep-me.txt', 'unrelated');
    const orig = fs.writeSync;
    let count = 0;
    fs.writeSync = (fd, ...rest) => {
      count += 1;
      if (count === 3) {
        const e = new Error('injected write failure'); e.code = 'EIO'; throw e;
      }
      return orig(fd, ...rest);
    };
    try {
      assert.throws(() => applyPlan(dir, prepared.files));
    } finally {
      fs.writeSync = orig;
    }
    // The unrelated file survives; every file this operation created is gone.
    assert.ok(exists(dir, 'keep-me.txt'));
    assert.ok(!exists(dir, '.tasksystem/config.json'));
    assert.ok(!exists(dir, 'AGENTS.md'));
  } finally { cleanup(dir); }
});

test('case-insensitive duplicate plan destinations are rejected', () => {
  const dir = makeTempDir('init-case');
  try {
    // AGENTS.md already generated by hosts; a config named agents.md would
    // collide case-insensitively on the same destination basename rule via
    // ancestor/dup check at plan level (configRel 'AGENTS.md').
    assert.throws(
      () => prepareInit({
        projectRoot: dir, configRel: 'agents.md', answers: VALID_ANSWERS,
      }),
      (e) => ['PLAN_CONFLICT', 'PATH_COLLISION'].includes(e.code));
  } finally { cleanup(dir); }
});
