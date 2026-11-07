// Final review batch: prospective chronology, temp-file ownership,
// COMMANDS prototype keys, catalog guard fixtures, legacy single-load spy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../src/cli.mjs';
import { applyPlan, preflightPlan } from '../src/core/bootstrap.mjs';
import { createConfig } from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import {
  getSession, prepareSession, prepareSessionRecord, recordSession,
  sessionFileAbs,
} from '../src/core/sessions.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import {
  catalogFiles, checkCatalog, legacyList,
} from '../src/core/catalog.mjs';
import {
  VALID_ANSWERS, cleanup, exists, fakeIO, makeCatalogFixture,
  makeTempDir, trySymlink, writeJson,
} from './helpers.mjs';

function ctxFixture() {
  const dir = makeTempDir('fr');
  writeJson(dir, '.tasksystem/config.json',
    createConfig(dir, VALID_ANSWERS, {}));
  return { dir, ctx: resolveContext({ project: dir }) };
}

function makeSession(ctx, task, limit = 5) {
  const prepared = prepareSession(ctx, { taskId: task.id, limit });
  applyPlan(ctx.projectRoot, preflightPlan(ctx.projectRoot, [prepared.file]));
  return prepared.session;
}

test('A: append before previous last event fails shape, bytes intact', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const s = makeSession(ctx, task);
    const file = sessionFileAbs(ctx, s.id);
    // Craft a VALID stored record whose last event is in the future.
    const past = new Date(Date.now() - 2 * 86400e3).toISOString();
    const future = new Date(Date.now() + 86400e3).toISOString();
    const stored = {
      ...s, createdAt: past, updatedAt: future,
      used: 1, revision: 1,
      events: [{ action: 'read', evidence: 'x', context: '', at: future }],
    };
    fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');
    assert.equal(getSession(ctx, s.id).events.length, 1); // stored is valid
    const before = fs.readFileSync(file);
    const input = { id: s.id, expectedRevision: 1, action: 'read', evidence: 'y' };
    for (const fn of [prepareSessionRecord, recordSession]) {
      assert.throws(() => fn(ctx, input),
        (e) => e.code === 'SESSION_MALFORMED', fn.name);
    }
    assert.ok(fs.readFileSync(file).equals(before));
    const leftovers = fs.readdirSync(`${dir}/.tasksystem/state/sessions`)
      .filter((n) => n.includes('.tmp') || n.endsWith('.lock'));
    assert.deepEqual(leftovers, []);
  } finally { cleanup(dir); }
});

test('B: EEXIST on tmp path must not delete foreign sentinel bytes', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const s = makeSession(ctx, task);
    const sfile = sessionFileAbs(ctx, s.id);
    const taskFile = `${dir}/docs/agent/tasks/${task.id}.json`;
    const sBefore = fs.readFileSync(sfile);
    const tBefore = fs.readFileSync(taskFile);
    const sentinels = [];
    const origOpen = fs.openSync;
    fs.openSync = (p, flags, ...rest) => {
      if (flags === 'wx' && String(p).includes('.tmp')) {
        fs.writeFileSync(p, 'SENTINEL'); // foreign file now exists
        sentinels.push(p);
      }
      return origOpen(p, flags, ...rest); // 'wx' -> EEXIST on sentinels
    };
    try {
      assert.throws(() => transitionTask(ctx, {
        id: task.id, to: 'ACT', expectedRevision: 0,
      }));
      assert.throws(() => recordSession(ctx, {
        id: s.id, expectedRevision: 0, action: 'read', evidence: 'x',
      }));
    } finally {
      fs.openSync = origOpen;
    }
    for (const p of sentinels) {
      assert.equal(fs.readFileSync(p, 'utf8'), 'SENTINEL');
      fs.rmSync(p); // TEST-created sentinel only
    }
    assert.ok(fs.readFileSync(sfile).equals(sBefore));
    assert.ok(fs.readFileSync(taskFile).equals(tBefore));
    assert.ok(!exists(dir, `${sfile}.lock`.slice(dir.length + 1)));
    assert.ok(!exists(dir, `${taskFile}.lock`.slice(dir.length + 1)));
  } finally { cleanup(dir); }
});

test('B: write failure after open removes only the owned partial tmp', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const file = `${dir}/docs/agent/tasks/${task.id}.json`;
    const before = fs.readFileSync(file);
    const origWrite = fs.writeSync;
    // Throw EIO on any write to a .tmp- path via fd tracking.
    const fds = new Set();
    const origOpen = fs.openSync;
    fs.openSync = (p, flags, ...r) => {
      const fd = origOpen(p, flags, ...r);
      if (flags === 'wx' && String(p).includes('.tmp-')) fds.add(fd);
      return fd;
    };
    const origClose = fs.closeSync;
    fs.closeSync = (fd) => { fds.delete(fd); return origClose(fd); };
    fs.writeSync = (fd, ...a) => {
      if (fds.has(fd)) throw Object.assign(new Error('EIO'), { code: 'EIO' });
      return origWrite(fd, ...a);
    };
    try {
      assert.throws(() => transitionTask(ctx, {
        id: task.id, to: 'ACT', expectedRevision: 0,
      }), (e) => e.code === 'EIO');
    } finally {
      fs.writeSync = origWrite;
      fs.openSync = origOpen;
      fs.closeSync = origClose;
    }
    assert.ok(fs.readFileSync(file).equals(before));
    const leftovers = fs.readdirSync(`${dir}/docs/agent/tasks`)
      .filter((n) => n.includes('.tmp'));
    assert.deepEqual(leftovers, []); // owned partial removed, foreign kept
  } finally { cleanup(dir); }
});

test('B: oversized transition write leaves task bytes valid', () => {
  const { dir, ctx } = ctxFixture();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    const file = `${dir}/docs/agent/tasks/${task.id}.json`;
    // Stored just under the limit; transition history pushes past it.
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const maxB = loadLimits().maxDocumentBytes;
    const size = (d) => Buffer.byteLength(JSON.stringify(d, null, 2) + '\n');
    doc.contract = 'x'.repeat(Math.max(0, maxB - 128 - size(doc)));
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    const storedBytes = Buffer.byteLength(fs.readFileSync(file));
    assert.ok(storedBytes <= maxB, `stored ${storedBytes} must fit`);
    const before = fs.readFileSync(file);
    assert.throws(() => transitionTask(ctx, {
      id: task.id, to: 'ACT', expectedRevision: 0,
    }), (e) => e.code === 'DOCUMENT_TOO_LARGE');
    assert.ok(fs.readFileSync(file).equals(before));
    const leftovers = fs.readdirSync(`${dir}/docs/agent/tasks`)
      .filter((n) => n.includes('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally { cleanup(dir); }
});

test('C: prototype keys are INVALID_ARGS, not INTERNAL', async () => {
  for (const cmd of ['constructor', '__proto__', 'toString']) {
    const io = fakeIO();
    assert.equal(await run([cmd], io), 1, cmd);
    assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INVALID_ARGS');
  }
});

// --- D: catalog guard fixtures ---
const BASE = {
  'commands/c.md': 'x', 'agents/a.md': 'x', 'skills/s/SKILL.md': 'x',
  'rules/r.md': 'x', 'references/ref.md': 'x',
  'profiles/core.json': JSON.stringify({
    schemaVersion: 1, id: 'core', description: 'd', skills: [],
    rules: [], references: [], activation: 'explicit', externalServices: [],
  }),
};
const CMD = { kind: 'command', id: 'c', path: 'commands/c.md',
  description: 'd', modes: ['m'], agents: ['a'], skills: ['s'],
  rules: ['r'], references: ['ref'] };
const OTHER = [
  { kind: 'agent', id: 'a', path: 'agents/a.md', description: 'd' },
  { kind: 'skill', id: 's', path: 'skills/s/SKILL.md', description: 'd' },
  { kind: 'rule', id: 'r', path: 'rules/r.md', description: 'd' },
  { kind: 'reference', id: 'ref', path: 'references/ref.md', description: 'd' },
  { kind: 'profile', id: 'core', path: 'profiles/core.json', description: 'd' },
];

test('D: null/array manifests produce structured checkCatalog failures', () => {
  for (const raw of ['null', '[1]', '42', '"x"']) {
    const dir = makeTempDir('man');
    try {
      makeCatalogFixture(dir, {});
      fs.writeFileSync(`${dir}/catalog/manifest.json`, raw);
      const r = checkCatalog({ installRoot: dir });
      assert.equal(r.ok, false, raw);
      assert.equal(r.issues[0].code, 'CATALOG_MALFORMED');
    } finally { cleanup(dir); }
  }
});

test('D: command without modes; malformed profiles; post-map collision', () => {
  const noModes = makeTempDir('nm');
  try {
    const { modes, ...rest } = CMD;
    makeCatalogFixture(noModes, { entries: [rest, ...OTHER], files: BASE });
    const r = checkCatalog({ installRoot: noModes });
    assert.equal(r.ok, false);
    assert.equal(r.issues[0].code, 'CATALOG_MALFORMED');
  } finally { cleanup(noModes); }

  const profiles = [
    { schemaVersion: 1, id: 'core', description: 'd', skills: [], rules: [],
      references: [], activation: 'explicit', externalServices: [], ghost: 1 },
    { schemaVersion: 1, id: 'core', description: 'd', skills: [], rules: [],
      references: [], activation: {}, externalServices: [] },
    { schemaVersion: 1, id: 'core', description: 'd', skills: ['nope'],
      rules: [], references: [], activation: 'explicit', externalServices: [] },
  ];
  const codes = ['PROFILE_MALFORMED', 'PROFILE_MALFORMED', 'CATALOG_MISSING_DEP'];
  for (const [i, profile] of profiles.entries()) {
    const dir = makeTempDir('prof');
    try {
      makeCatalogFixture(dir, {
        entries: [...OTHER, CMD], files: {
          ...BASE, 'profiles/core.json': JSON.stringify(profile),
        },
      });
      const r = checkCatalog({ installRoot: dir });
      assert.equal(r.ok, false, `profile ${i}`);
      assert.equal(r.issues[0].code, codes[i]);
    } finally { cleanup(dir); }
  }

  const collide = makeTempDir('col');
  try {
    // Template skill 's2' projects to skills/s2/SKILL.md, colliding with a
    // second entry whose source path is literally skills/s2/SKILL.md.
    makeCatalogFixture(collide, {
      entries: [
        ...OTHER, CMD,
        { kind: 'skill', id: 's2', path: 'templates/skills/x/SKILL.md',
          description: 'd' },
        { kind: 'skill', id: 's3', path: 'skills/s2/SKILL.md',
          description: 'd' },
      ],
      files: {
        ...BASE,
        'templates/skills/x/SKILL.md': 'x',
        'skills/s2/SKILL.md': 'x',
      },
    });
    const r = checkCatalog({ installRoot: collide });
    assert.equal(r.ok, false);
    assert.equal(r.issues[0].code, 'CATALOG_DUPLICATE');
  } finally { cleanup(collide); }
});

test('D: projected catalog.json resolves every entry incl 3 templates', () => {
  const files = catalogFiles({});
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const manifest = JSON.parse(byRel.get('catalog.json').content.toString('utf8'));
  for (const e of manifest.entries) {
    assert.ok(byRel.has(e.path), `projected path must exist: ${e.path}`);
  }
  for (const t of ['project-onboarding', 'contract-execution', 'independent-review']) {
    assert.ok(byRel.has(`skills/${t}/SKILL.md`), t);
  }
});

test('D: symlinked component ancestor escapes are rejected', (t) => {
  const dir = makeTempDir('linkcat');
  try {
    makeCatalogFixture(dir, { entries: [...OTHER, CMD], files: {} });
    fs.mkdirSync(`${dir}/real`, { recursive: true });
    fs.writeFileSync(`${dir}/real/c.md`, 'x');
    if (!trySymlink(`${dir}/real`, `${dir}/commands`)) {
      t.skip('symlinks unsupported');
      return;
    }
    const r = checkCatalog({ installRoot: dir });
    assert.equal(r.ok, false);
  } finally { cleanup(dir); }
});

test('D: legacyList loads the active manifest at most once', () => {
  const orig = fs.openSync;
  let manifestReads = 0;
  fs.openSync = (p, flags, ...r) => {
    if (String(p).endsWith('manifest.json') && flags === 'r') manifestReads += 1;
    return orig(p, flags, ...r);
  };
  try {
    const out = legacyList({ kind: 'skill' }, {});
    assert.ok(out.entries.length > 0);
  } finally {
    fs.openSync = orig;
  }
  assert.ok(manifestReads <= 1, `manifest opened ${manifestReads}x`);
});
