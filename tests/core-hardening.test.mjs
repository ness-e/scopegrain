// BLOCK0 core hardening: bounded reads, canonical catalog paths, task
// timestamp invariants, size-shortcircuit preflight/doctor, policy shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readFileLimited, readJsonFile } from '../src/core/fsx.mjs';
import { createConfig, loadConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import { buildInitPlan, applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  getResource, loadCatalog, catalogDestRel,
} from '../src/core/catalog.mjs';
import { renderNativeAdapters } from '../src/adapters/native.mjs';
import {
  DEFAULT_ANSWERS, cleanup, makeCatalogFixture, makeTempDir, writeJson,
} from './helpers.mjs';

const MAXB = loadLimits().maxDocumentBytes;

function ctxFixture() {
  const dir = makeTempDir('ch');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, DEFAULT_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

test('readFileLimited: short reads, empty, exact/over limit, bad limit', () => {
  const dir = makeTempDir('rl');
  try {
    const file = path.join(dir, 'd.txt');
    fs.writeFileSync(file, 'ABCDEFGHIJKLMNOP'); // 16 bytes
    const orig = fs.readSync;
    fs.readSync = (fd, buf, off, len, pos) =>
      orig(fd, buf, off, Math.min(len, 3), pos);
    try {
      const r = readFileLimited(file, MAXB);
      assert.equal(r.content.toString('utf8'), 'ABCDEFGHIJKLMNOP');
      assert.equal(r.size, 16);
      assert.equal(r.exceeded, false);
    } finally { fs.readSync = orig; }
    fs.writeFileSync(file, '');
    assert.equal(readFileLimited(file, 10).content.length, 0);
    fs.writeFileSync(file, 'xx');
    assert.equal(readFileLimited(file, 2).size, 2);
    assert.equal(readFileLimited(file, 2).exceeded, false);
    assert.equal(readFileLimited(file, 1).exceeded, true);
    assert.equal(readFileLimited(file, 1).content, null);
    for (const bad of [-1, NaN, '10', 1.5, Infinity]) {
      assert.throws(() => readFileLimited(file, bad),
        (e) => e.code === 'INVALID_VALUE', String(bad));
    }
  } finally { cleanup(dir); }
});

test('readFileLimited: concurrent truncate/grow fails, fd always closed', () => {
  const dir = makeTempDir('rl2');
  try {
    const file = path.join(dir, 'g.txt');
    fs.writeFileSync(file, 'ABCDEFGH');
    // Simulated concurrent size change: second fstat reports a different
    // in-limit size -> READ_FAILED.
    const origFstatT = fs.fstatSync;
    let tCalls = 0;
    fs.fstatSync = (fd, ...a) => {
      tCalls += 1;
      const st = origFstatT(fd, ...a);
      if (tCalls === 2) {
        return Object.assign(Object.create(Object.getPrototypeOf(st)), st,
          { size: st.size - 3 });
      }
      return st;
    };
    try {
      assert.throws(() => readFileLimited(file, MAXB),
        (e) => e.code === 'READ_FAILED');
    } finally { fs.fstatSync = origFstatT; tCalls = 0; }
    // Grow beyond limit detected on final fstat.
    const origFstat = fs.fstatSync;
    let statCalls = 0;
    fs.fstatSync = (fd, ...a) => {
      statCalls += 1;
      const st = origFstat(fd, ...a);
      if (statCalls === 2) {
        return Object.assign(Object.create(Object.getPrototypeOf(st)), st,
          { size: MAXB + 1 });
      }
      return st;
    };
    try {
      const r = readFileLimited(file, MAXB);
      assert.equal(r.exceeded, true);
    } finally { fs.fstatSync = origFstat; }
    // fd is always closed on error paths: track open/close across an
    // EOF-without-progress failure.
    const openFds = new Set();
    const origOpen = fs.openSync;
    const origClose = fs.closeSync;
    const origRead = fs.readSync;
    fs.openSync = (p, flags, ...r) => {
      const fd = origOpen(p, flags, ...r); openFds.add(fd); return fd;
    };
    fs.closeSync = (fd) => { openFds.delete(fd); return origClose(fd); };
    fs.readSync = () => 0; // EOF: no progress
    try {
      assert.throws(() => readFileLimited(file, MAXB),
        (e) => e.code === 'READ_FAILED');
      assert.equal(openFds.size, 0, 'fd must be closed on READ_FAILED');
    } finally {
      fs.readSync = origRead; fs.openSync = origOpen; fs.closeSync = origClose;
    }
  } finally { cleanup(dir); }
});

test('readJsonFile bounded: oversized -> DOCUMENT_TOO_LARGE not malformed', () => {
  const dir = makeTempDir('rj');
  try {
    const file = path.join(dir, 'big.json');
    fs.writeFileSync(file, '{}'.padEnd(MAXB + 10, ' '));
    assert.throws(() => readJsonFile(file, 'x'),
      (e) => e.code === 'DOCUMENT_TOO_LARGE');
    fs.writeFileSync(file, '{bad');
    assert.throws(() => readJsonFile(file, 'x'),
      (e) => e.code === 'MALFORMED_JSON');
  } finally { cleanup(dir); }
});

test('catalog canonical paths: Windows manifest normalizes everywhere', () => {
  const dir = makeTempDir('catw');
  try {
    fs.mkdirSync(path.join(dir, 'catalog'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'catalog/manifest.json'), JSON.stringify({
      schemaVersion: 1,
      entries: [{ kind: 'skill', id: 'onboard',
        path: 'templates\\skills\\onboard\\SKILL.md', description: 'd' }],
    }));
    const fd = path.join(dir, 'templates', 'skills', 'onboard');
    fs.mkdirSync(fd, { recursive: true });
    fs.writeFileSync(path.join(fd, 'SKILL.md'), '# x\n');
    const c = loadCatalog({ installRoot: dir });
    const r = getResource('skill', 'onboard', { catalog: c });
    assert.equal(c.entries[0].path, 'templates/skills/onboard/SKILL.md');
    assert.equal(r.path, 'templates/skills/onboard/SKILL.md');
    assert.equal(catalogDestRel(r), 'skills/onboard/SKILL.md');
  } finally { cleanup(dir); }
});

test('catalog: whitespace-only and empty modes rejected for commands', () => {
  const dir = makeTempDir('catm');
  try {
    const mk = (modes) => {
      fs.rmSync(path.join(dir, 'catalog'), { recursive: true, force: true });
      fs.mkdirSync(path.join(dir, 'catalog'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'catalog/manifest.json'), JSON.stringify({
        schemaVersion: 1,
        entries: [{ kind: 'command', id: 'x', path: 'commands/x.md',
          description: 'd', modes }],
      }));
      fs.mkdirSync(path.join(dir, 'commands'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'commands', 'x.md'), 'x');
    };
    for (const m of [['  '], [''], [], null]) {
      mk(m);
      assert.throws(() => loadCatalog({ installRoot: dir }),
        (e) => e.code === 'CATALOG_MALFORMED', JSON.stringify(m));
    }
  } finally { cleanup(dir); }
});

test('tasks: stored timestamp invariants and history bounds', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const file = path.join(dir, DEFAULT_ANSWERS.paths.tasks, `${task.id}.json`);
    const orig = fs.readFileSync(file);
    const cases = [
      (d) => { d.createdAt = 'not-a-date'; },
      (d) => { d.updatedAt = 'not-a-date'; },
      (d) => { d.history[0].at = 'not-a-date'; },
      (d) => { d.createdAt = '2026-02-01T00:00:00.000Z'; },
      (d) => { d.history = []; },
      (d) => { d.history[0].at = '1999-01-01T00:00:00.000Z'; },
      (d) => { d.updatedAt = '2999-01-01T00:00:00.000Z'; },
    ];
    for (const fn of cases) {
      const doc = JSON.parse(orig.toString('utf8'));
      fn(doc);
      fs.writeFileSync(file, JSON.stringify(doc));
      try {
        assert.throws(() => getTask(ctx, task.id),
          (e) => e.code === 'TASK_MALFORMED');
      } finally { fs.writeFileSync(file, orig); }
    }
  } finally { cleanup(dir); }
});

test('transition on future-dated task leaves bytes and lock/tmp clean', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const file = path.join(dir, DEFAULT_ANSWERS.paths.tasks, `${task.id}.json`);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const future = new Date(Date.now() + 86400e3).toISOString();
    doc.createdAt = future; doc.updatedAt = future;
    doc.history[0].at = future;
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    const before = fs.readFileSync(file);
    assert.throws(() => transitionTask(ctx, {
      id: task.id, to: 'ACT', expectedRevision: 0,
    }));
    assert.ok(fs.readFileSync(file).equals(before));
    const leftovers = fs.readdirSync(path.dirname(file))
      .filter((n) => n.includes('.tmp') || n.endsWith('.lock'));
    assert.deepEqual(leftovers, []);
  } finally { cleanup(dir); }
});

test('oversized stored config rejected structurally', () => {
  const dir = makeTempDir('bigcfg');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, DEFAULT_ANSWERS, {}));
    const file = path.join(dir, '.tasksystem/config.json');
    fs.appendFileSync(file, ' '.repeat(MAXB));
    assert.throws(() => loadConfig(dir),
      (e) => e.code === 'DOCUMENT_TOO_LARGE'
        || e.code === 'READ_FAILED');
  } finally { cleanup(dir); }
});

test('preflight: existing oversized file never fully read, bytes kept', () => {
  const dir = makeTempDir('pf');
  try {
    writeJson(dir, '.tasksystem/config.json',
      createConfig(dir, DEFAULT_ANSWERS, {}));
    const discJson0 = JSON.stringify(
      { schemaVersion: 1, fingerprint: 'x', evidence: {}, warnings: [] },
      null, 2) + '\n';
    const conf0 = createConfig(dir, DEFAULT_ANSWERS, {});
    const plan = buildInitPlan({
      projectRoot: dir,
      configRel: '.tasksystem/config.json',
      config: conf0,
      configContent: JSON.stringify(conf0, null, 2) + '\n',
      discovery: JSON.parse(discJson0), discoveryContent: discJson0,
    });
    applyPlan(dir, plan.files);
    // Huge pre-existing file at a projected dest -> conflict, no full read.
    const target = path.join(dir, '.tasksystem/rules/safety.md');
    const before = fs.readFileSync(target);
    fs.writeFileSync(target, 'x'.repeat(MAXB + 100));
    const plan2 = buildInitPlan({
      projectRoot: dir,
      configRel: '.tasksystem/config.json',
      config: createConfig(dir, DEFAULT_ANSWERS, {}),
      configContent: fs.readFileSync(
        path.join(dir, '.tasksystem/config.json')),
      discovery: null, discoveryContent: null,
    });
    const f = plan2.files.find((x) => x.rel === '.tasksystem/rules/safety.md');
    assert.throws(() => preflightPlan(dir, [f]),
      (e) => e.code === 'PLAN_CONFLICT'
        && e.conflicts?.[0]?.path === '.tasksystem/rules/safety.md');
    fs.writeFileSync(target, before); // restore for cleanup
  } finally { cleanup(dir); }
});

test('doctor oversized discovery reports needs-attention, no crash', () => {
  const dir = makeTempDir('bigdisc');
  try {
    const conf = createConfig(dir, DEFAULT_ANSWERS, {});
    const discJson = JSON.stringify(
      { schemaVersion: 1, fingerprint: 'x', evidence: {}, warnings: [] },
      null, 2) + '\n';
    const plan2 = buildInitPlan({
      projectRoot: dir,
      configRel: '.tasksystem/config.json',
      config: conf,
      configContent: JSON.stringify(conf, null, 2) + '\n',
      discovery: JSON.parse(discJson),
      discoveryContent: discJson,
    });
    applyPlan(dir, plan2.files);
    fs.writeFileSync(path.join(dir, '.tasksystem/discovery.json'),
      '{}'.padEnd(MAXB + 10, ' '));
    const ctx = resolveContext({ project: dir });
    const r = runDoctor(ctx);
    assert.equal(r.status, 'needs-attention');
  } finally { cleanup(dir); }
});

test('native policy strict shape: unknown keys, bad values, readonly ids', () => {
  const dir = makeTempDir('natpol');
  try {
    // Real policy file is valid; test validator via mutated copies.
    const pol = JSON.parse(
      fs.readFileSync('policy/native-adapters.json', 'utf8'));
    // Real catalog with an actual agent so the readOnly check runs.
    makeCatalogFixture(dir, {
      entries: [{ kind: 'agent', id: 'reviewer', path: 'agents/r.md',
        description: 'd' }],
      files: { 'agents/r.md': 'x' },
    });
    // Unknown root key
    writeJson(dir, 'policy/native-adapters.json', { ...pol, ghost: 1 });
    assert.throws(() => renderNativeAdapters(
      minimalCfg(dir), { configRel: '.tasksystem/config.json', installRoot: dir }));
    writeJson(dir, 'policy/native-adapters.json', { ...pol, activation: 'auto' });
    assert.throws(() => renderNativeAdapters(
      minimalCfg(dir), { configRel: '.tasksystem/config.json', installRoot: dir }),
      (e) => e.code === 'POLICY_MALFORMED');
    writeJson(dir, 'policy/native-adapters.json',
      { ...pol, readOnlyAgentIds: ['ghost-agent'] });
    assert.throws(() => renderNativeAdapters(
      minimalCfg(dir), { configRel: '.tasksystem/config.json', installRoot: dir }),
      (e) => e.code === 'POLICY_MALFORMED' && /ghost-agent/.test(e.message));
    writeJson(dir, 'policy/native-adapters.json',
      { ...pol, hosts: { ...pol.hosts, claude: { ...pol.hosts.claude, sources: ['ftp://x'] } } });
    assert.throws(() => renderNativeAdapters(
      minimalCfg(dir), { configRel: '.tasksystem/config.json', installRoot: dir }),
      (e) => e.code === 'POLICY_MALFORMED');
    // Root validation: absolute/double-slash/dot/forbidden-first-segment.
    for (const skillRoot of ['/abs', 'foo//bar', './x', '.git', '.GIT/x',
      'node_modules/x', 'legacy/x', '..', 'a/../b']) {
      writeJson(dir, 'policy/native-adapters.json', {
        ...pol, hosts: { ...pol.hosts, claude: { ...pol.hosts.claude, skillRoot } },
      });
      assert.throws(() => renderNativeAdapters(
        minimalCfg(dir), { configRel: '.tasksystem/config.json', installRoot: dir }),
        (e) => e.code === 'POLICY_MALFORMED', skillRoot);
    }
    // Namespace: single-hyphen segments + trailing '-' only.
    for (const namespace of ['tasksystem--', 'task--sys-', 'Task-',
      'task_system-', 'tasksystem']) {
      writeJson(dir, 'policy/native-adapters.json', { ...pol, namespace });
      assert.throws(() => renderNativeAdapters(
        minimalCfg(dir), { configRel: '.tasksystem/config.json', installRoot: dir }),
        (e) => e.code === 'POLICY_MALFORMED', namespace);
    }
  } finally { cleanup(dir); }
});
function minimalCfg(dir) {
  return createConfig(dir, { ...DEFAULT_ANSWERS, hosts: ['claude'] }, {});
}
