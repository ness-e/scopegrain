// Resource boundary cases: V1 snapshots, aggregate overflow, junction revalidation,
// default counting, dedupe, recovery negatives, wire-level MCP strictness,
// variant malformed shapes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  getResource, loadCatalog, loadWorkspaceCatalog, resolveCatalogEntry,
} from '../src/core/catalog.mjs';
import { renderNativeAdapters } from '../src/hosts/native.mjs';
import { createConfig } from '../src/core/config.mjs';
import { writeJson } from './helpers.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import {
  diagnoseResource, findResources, prepareResourceRestore,
} from '../src/core/resource-recovery.mjs';
import {
  DEFAULT_ANSWERS, bootstrappedCtx, cleanup, makeTempDir, trySymlink,
} from './helpers.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { runDoctor } from '../src/core/doctor.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function makeV1Workspace() {
  const fixture = bootstrappedCtx();
  const manifest = JSON.parse(fs.readFileSync(
    `${fixture.dir}/.tasksystem/catalog.json`, 'utf8'));
  manifest.schemaVersion = 1;
  for (const entry of manifest.entries) delete entry.sha256;
  writeJson(fixture.dir, '.tasksystem/catalog.json', manifest);
  return fixture;
}

test('V1 snapshot: load warns, diagnose legacy, restore UNPINNED', () => {
  const { dir, ctx } = makeV1Workspace();
  try {
    const cat = loadWorkspaceCatalog(ctx);
    assert.equal(cat.integrity, 'legacy-unpinned');
    assert.ok(cat.warnings.some((w) => w.includes('legacy-unpinned')));
    assert.equal(buildWorkflowPacket(ctx, { command: 'pipeline' })
      .authority.snapshotIntegrity, 'legacy-unpinned');
    const d = diagnoseResource(ctx, { kind: 'command', id: 'plan-work' });
    assert.equal(d.status, 'legacy-unpinned');
    assert.throws(() => prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: null,
    }), (e) => e.code === 'RESOURCE_UNPINNED');
    const snapshot = JSON.parse(fs.readFileSync(
      `${dir}/.tasksystem/catalog.json`, 'utf8'));
    snapshot.entries.find((e) => e.id === 'plan-work').sha256 =
      sha(fs.readFileSync(`${dir}/.tasksystem/commands/plan-work.md`));
    writeJson(dir, '.tasksystem/catalog.json', snapshot);
    assert.throws(() => prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: null,
    }), (e) => e.code === 'RESOURCE_UNPINNED');
  } finally { cleanup(dir); }
});

test('aggregate packet overflow -> CONTEXT_TOO_LARGE', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const cfg = `${dir}/.tasksystem`;
    const catPath = `${cfg}/catalog.json`;
    const snap = JSON.parse(fs.readFileSync(catPath, 'utf8'));
    // Enlarge many command bodies; recalc each entry sha so the manifest
    // stays internally consistent — only the aggregate exceeds the limit.
    // Each padded file stays well under the per-document bound; ~100
    // packet-included resources push the aggregate past it.
    const pad = 'x'.repeat(Math.ceil(loadLimits().maxDocumentBytes / 20));
    for (const e of snap.entries) {
      if (e.kind === 'profile') continue; // profiles must stay valid JSON
      const p = `${cfg}/${e.path}`;
      const body = fs.readFileSync(p) + pad;
      fs.writeFileSync(p, body);
      e.sha256 = sha(Buffer.from(body));
    }
    fs.writeFileSync(catPath, JSON.stringify(snap, null, 2));
    assert.throws(() => buildWorkflowPacket(ctx, { command: 'pipeline' }),
      (e) => e.code === 'CONTEXT_TOO_LARGE');
  } finally { cleanup(dir); }
});

test('cached getResource rejects after configDir junction swap', (t) => {
  const { dir, ctx } = bootstrappedCtx();
  const sibling = `${dir}-sibling`;
  fs.cpSync(`${dir}/.tasksystem`, sibling, { recursive: true });
  const cat = loadWorkspaceCatalog(ctx);
  fs.rmSync(`${dir}/.tasksystem`, { recursive: true });
  if (!trySymlink(sibling, `${dir}/.tasksystem`)) {
    fs.rmSync(sibling, { recursive: true });
    return t.skip('symlinks unsupported');
  }
  assert.throws(
    () => getResource('command', 'plan-work', { catalog: cat }),
    (e) => e.code === 'SYMLINK_REJECTED');
  assert.throws(() => loadWorkspaceCatalog(ctx),
    (e) => e.code === 'SYMLINK_REJECTED');
  fs.rmSync(`${dir}/.tasksystem`, { recursive: true });
  fs.rmSync(sibling, { recursive: true });
  cleanup(dir);
});

test('cached project root replacement with a junction is rejected', (t) => {
  const { dir, ctx } = bootstrappedCtx();
  const catalog = loadWorkspaceCatalog(ctx);
  const backup = `${dir}-original`;
  const foreign = makeTempDir('foreign-root');
  fs.cpSync(dir, foreign, { recursive: true });
  fs.renameSync(dir, backup);
  try {
    if (!trySymlink(foreign, dir)) return t.skip('symlinks unsupported');
    assert.throws(() => getResource('command', 'plan-work', { catalog }),
      (e) => e.code === 'SYMLINK_REJECTED');
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'SYMLINK_REJECTED');
  } finally { cleanup(dir); cleanup(backup); cleanup(foreign); }
});

test('alias defaults: zero or two defaults rejected; last-row default wins', () => {
  const mk = (aliases) => {
    const dir = makeTempDir('al');
    fs.mkdirSync(`${dir}/resources/commands`, { recursive: true });
    fs.mkdirSync(`${dir}/resources/profiles`, { recursive: true });
    fs.writeFileSync(`${dir}/resources/commands/a.md`, 'a');
    fs.writeFileSync(`${dir}/resources/commands/b.md`, 'b');
    fs.writeFileSync(`${dir}/resources/profiles/c.json`, JSON.stringify({
      schemaVersion: 1, id: 'core', description: 'c', skills: [],
      rules: [], references: [], activation: 'always',
      externalServices: [],
    }));
    fs.writeFileSync(`${dir}/resources/manifest.json`, JSON.stringify({
      schemaVersion: 1,
      entries: [
        { kind: 'command', id: 'a', path: 'resources/commands/a.md',
          description: 'a', modes: ['default'] },
        { kind: 'command', id: 'b', path: 'resources/commands/b.md',
          description: 'b', modes: ['default'] },
        { kind: 'profile', id: 'core', path: 'resources/profiles/c.json',
          description: 'c' },
      ],
      aliases,
    }));
    return dir;
  };
  const rows = [
    { kind: 'command', id: 'go', mode: 'x', default: false,
      target: 'a', targetMode: 'default' },
    { kind: 'command', id: 'go', mode: 'y', default: true,
      target: 'b', targetMode: 'default' },
  ];
  // Zero defaults rejected.
  const d0 = mk(rows.map((r) => ({ ...r, default: false })));
  assert.throws(() => getResource('command', 'go', { installRoot: d0 }),
    (e) => e.code === 'CATALOG_MALFORMED');
  // Two defaults rejected.
  const d2 = mk(rows);
  const bad = mk(
    [...rows, { kind: 'command', id: 'go', mode: 'z', default: true,
      target: 'a', targetMode: 'default' }]);
  assert.throws(() => loadCatalog({ installRoot: bad }),
    (e) => e.code === 'CATALOG_MALFORMED');
  // Reversed rows + default LAST resolves THAT target (not first match).
  const cat = loadCatalog({ installRoot: d2 });
  const { entry } = resolveCatalogEntry(cat, 'command', 'go');
  assert.equal(entry.id, 'b');
  assert.equal(getResource('command', 'go', { catalog: cat })
    .content.toString(), 'b');
  assert.equal(resolveCatalogEntry(cat, 'command', 'not-present').entry, null);
  cleanup(d0); cleanup(d2); cleanup(bad);
});

test('packet dedupes resources cited by both alias and canonical id', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const snapshot = JSON.parse(fs.readFileSync(
      `${dir}/.tasksystem/catalog.json`, 'utf8'));
    snapshot.aliases.push({
      kind: 'skill', id: 'test-skill-alias', target: 'context-engineering',
    });
    const command = snapshot.entries.find(
      (e) => e.kind === 'command' && e.id === 'plan-work');
    command.skills = [...(command.skills ?? []),
      'test-skill-alias', 'context-engineering'];
    writeJson(dir, '.tasksystem/catalog.json', snapshot);
    const p = buildWorkflowPacket(ctx, { command: 'pipeline' });
    const ids = p.resources.skills.map((r) => `${r.kind}/${r.id}`);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.filter((id) => id === 'skill/context-engineering').length, 1);
  } finally { cleanup(dir); }
});

test('existing file + expectedCurrentHash null -> CONFLICT, no write', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const before = fs.readFileSync(
      `${dir}/.tasksystem/commands/plan-work.md`);
    assert.throws(() => prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: null,
    }), (e) => e.code === 'RESOURCE_RESTORE_CONFLICT');
    assert.ok(fs.readFileSync(`${dir}/.tasksystem/commands/plan-work.md`)
      .equals(before));
  } finally { cleanup(dir); }
});

test('metadata-only find works with a missing profile body', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    fs.rmSync(`${dir}/.tasksystem/profiles/web.json`);
    const r = findResources(ctx, { kind: 'profile' });
    assert.ok(r.entries.length > 0);
    assert.equal(r.integrity, 'not-checked');
  } finally { cleanup(dir); }
});

test('installed body with wrong SHA -> RESOURCE_VERSION_UNAVAILABLE', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    // Fake install whose plan-work bytes differ from the snapshot pin.
    const fake = `${dir}-fake2`;
    fs.mkdirSync(`${fake}/resources/commands`, { recursive: true });
    fs.writeFileSync(`${fake}/resources/manifest.json`, JSON.stringify({
      schemaVersion: 1,
      entries: [{ kind: 'command', id: 'plan-work',
        path: 'resources/commands/plan-work.md',
        description: 'different bytes', modes: ['default'] }],
      aliases: [],
    }));
    fs.writeFileSync(`${fake}/resources/commands/plan-work.md`, 'WRONG\n');
    fs.rmSync(`${dir}/.tasksystem/commands/plan-work.md`);
    assert.throws(() => prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: null,
    }, { installRoot: fake }),
      (e) => e.code === 'RESOURCE_VERSION_UNAVAILABLE');
    fs.rmSync(fake, { recursive: true, force: true });
  } finally { cleanup(dir); }
});

test('wire-level: SDK rejects unknown tool args before handler', async (t) => {
  let sdk;
  try {
    sdk = await import('@modelcontextprotocol/sdk/inMemory.js');
  } catch { return t.skip('MCP SDK not installed'); }
  const { InMemoryTransport } = sdk;
  const { Client } = await import(
    '@modelcontextprotocol/sdk/client/index.js');
  const { createMCPServer } = await import('../src/mcp/server.mjs');
  const { dir, ctx } = bootstrappedCtx();
  try {
    const { server } = await createMCPServer({ project: dir });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 't', version: '0' });
    await server.connect(st);
    await client.connect(ct);
    const res = await client.callTool({
      name: 'tasksystem_resource_diagnose',
      arguments: { kind: 'command', id: 'plan-work', project: '/etc' },
    }).catch((e) => e);
    const isErr = res.isError === true || res instanceof Error;
    assert.ok(isErr, 'unknown arg must be rejected at wire level');
    const ok = await client.callTool({
      name: 'tasksystem_resource_diagnose',
      arguments: { kind: 'command', id: 'plan-work' },
    });
    const parsed = JSON.parse(ok.content[0].text);
    assert.equal(parsed.status, 'healthy');
    await client.close();
  } finally { cleanup(dir); }
});

test('native variants: missing surfaces and empty hosts rejected', () => {
  const dir = makeTempDir('nv');
  // Minimal install: real policy+templates, tiny catalog, so the variants
  // layer is the only thing that can fail.
  fs.cpSync('policy', `${dir}/policy`, { recursive: true });
  fs.cpSync('templates', `${dir}/templates`, { recursive: true });
  fs.mkdirSync(`${dir}/resources/commands`, { recursive: true });
  fs.writeFileSync(`${dir}/resources/commands/a.md`, 'a');
  fs.writeFileSync(`${dir}/resources/manifest.json`, JSON.stringify({
    schemaVersion: 1,
    entries: [{ kind: 'command', id: 'a',
      path: 'resources/commands/a.md', description: 'a',
      modes: ['default'] }],
    aliases: [],
  }));
  const policy = JSON.parse(fs.readFileSync(
    `${dir}/policy/native-adapters.json`, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(
    `${dir}/resources/manifest.json`, 'utf8'));
  fs.mkdirSync(`${dir}/resources/agents`, { recursive: true });
  for (const id of policy.readOnlyAgentIds) {
    const path = `resources/agents/${id}.md`;
    fs.writeFileSync(`${dir}/${path}`, '# Fixture role\n');
    manifest.entries.push({ kind: 'agent', id, path, description: 'Fixture role' });
  }
  writeJson(dir, 'resources/manifest.json', manifest);
  const cfg = createConfig(dir,
    { ...DEFAULT_ANSWERS, hosts: ['opencode'] }, {});
  const options = { configRel: '.tasksystem/config.json', installRoot: dir };
  assert.ok(renderNativeAdapters(cfg, options).files.length > 0,
    'fixture must reach variant validation before introducing malformed data');
  const variant = { id: 'v9', selectionRequired: true, emitAgents: true,
    agentFrontmatter: '', readOnlyAgentFrontmatter: '',
    compatibility: 'documented-only', modelSelection: 'host-policy',
    permissionScope: 'x', sources: ['https://a.dev/x'] };
  writeJson(dir, 'policy/native-variants.json', { schemaVersion: 1, hosts: {} });
  writeJson(dir, 'policy/native-adapters.json', JSON.parse(fs.readFileSync(
    'policy/native-adapters.json', 'utf8')));
  assert.throws(() => renderNativeAdapters(cfg,
    options), (e) => e.code === 'POLICY_MALFORMED'
      && /requires.*opencode/.test(e.message));
  const bad = { ...variant }; delete bad.surfaces;
  writeJson(dir, 'policy/native-variants.json', { schemaVersion: 1,
    hosts: { opencode: [bad], antigravity: [{ ...variant }] } });
  assert.throws(() => renderNativeAdapters(cfg,
    options), (e) => e.code === 'POLICY_MALFORMED'
      && /surfaces/.test(e.message));
  writeJson(dir, 'policy/native-variants.json', { schemaVersion: 1,
    hosts: { opencode: [{ ...variant, surfaces: ['cli'], sources: {} }],
      antigravity: [{ ...variant, surfaces: ['ide'] }] } });
  assert.throws(() => renderNativeAdapters(cfg,
    options), (e) => e.code === 'POLICY_MALFORMED'
      && /sources/.test(e.message));
  cleanup(dir);
});

test('doctor notices added resources and alias-only installation changes', () => {
  const { dir, ctx } = bootstrappedCtx();
  const fake = makeTempDir('doctor-install');
  try {
    for (const component of ['policy', 'templates', 'resources']) {
      fs.cpSync(component, `${fake}/${component}`, { recursive: true });
    }
    assert.equal(runDoctor(ctx, { installRoot: fake }).status, 'ready');
    const file = `${fake}/resources/manifest.json`;
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    const added = structuredClone(original);
    added.entries.push({ kind: 'reference', id: 'new-probe',
      path: 'resources/references/new-probe.md', description: 'Probe' });
    fs.writeFileSync(`${fake}/resources/references/new-probe.md`, '# Probe\n');
    writeJson(fake, 'resources/manifest.json', added);
    assert.equal(runDoctor(ctx, { installRoot: fake }).upgradeAvailable, true);
    const aliasOnly = structuredClone(original);
    aliasOnly.aliases.find((a) => a.kind === 'command' && a.id === 'ship')
      .target = 'plan-recovery';
    writeJson(fake, 'resources/manifest.json', aliasOnly);
    assert.equal(runDoctor(ctx, { installRoot: fake }).upgradeAvailable, true);
  } finally { cleanup(fake); cleanup(dir); }
});

test('missing installed canonical command is VERSION_UNAVAILABLE', () => {
  const { dir, ctx } = bootstrappedCtx();
  const fake = makeTempDir('missing-source');
  try {
    writeJson(fake, 'resources/manifest.json', { schemaVersion: 1, entries: [
      { kind: 'reference', id: 'unrelated',
        path: 'resources/references/unrelated.md', description: 'Unrelated' },
    ], aliases: [] });
    fs.rmSync(`${dir}/.tasksystem/commands/plan-work.md`);
    assert.throws(() => prepareResourceRestore(ctx, {
      kind: 'command', id: 'plan-work', expectedCurrentHash: null,
    }, { installRoot: fake }), (e) => e.code === 'RESOURCE_VERSION_UNAVAILABLE');
  } finally { cleanup(fake); cleanup(dir); }
});
