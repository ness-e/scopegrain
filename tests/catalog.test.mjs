// Catalog loader cases: integrity, duplicates, traversal, deps, projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  catalogDestRel, catalogFiles, checkCatalog, getResource, loadCatalog,
} from '../src/core/catalog.mjs';
import {
  cleanup, makeCatalogFixture, makeTempDir, writeFile,
} from './helpers.mjs';

const BASE_FILES = {
  'commands/pipeline.md': '# pipeline\n',
  'agents/lead.md': '# lead\n',
  'skills/s1/SKILL.md': '# s1\n',
  'rules/safety.md': '# safety\n',
  'references/task-system.md': '# ref\n',
  'profiles/core.json': JSON.stringify({
    schemaVersion: 1, id: 'core', description: 'd',
    skills: [], rules: [], references: [],
    activation: 'explicit', externalServices: [],
  }),
  'templates/skills/project-onboarding/SKILL.md': '# onboard\n',
};

function fixture(entries, files = BASE_FILES) {
  const dir = makeTempDir('catalog');
  makeCatalogFixture(dir, { entries, files });
  return dir;
}

const ENTRIES = [
  { kind: 'command', id: 'pipeline', path: 'commands/pipeline.md',
    description: 'd', modes: ['plan'],
    agents: ['lead'], skills: ['s1'], rules: ['safety'],
    references: ['task-system'] },
  { kind: 'agent', id: 'lead', path: 'agents/lead.md', description: 'd' },
  { kind: 'skill', id: 's1', path: 'skills/s1/SKILL.md', description: 'd' },
  { kind: 'skill', id: 'project-onboarding',
    path: 'templates/skills/project-onboarding/SKILL.md', description: 'd' },
  { kind: 'rule', id: 'safety', path: 'rules/safety.md', description: 'd' },
  { kind: 'reference', id: 'task-system',
    path: 'references/task-system.md', description: 'd' },
  { kind: 'profile', id: 'core', path: 'profiles/core.json', description: 'd' },
];

test('real installation catalog validates and resolves', () => {
  const catalog = loadCatalog({});
  assert.ok(catalog.entries.length >= 90);
  const r = getResource('command', 'pipeline', { catalog });
  assert.ok(r.content.toString('utf8').length > 0);
  assert.equal(checkCatalog({}).ok, true);
});

test('fixture catalog loads; unknown kinds/ids rejected', () => {
  const dir = fixture(ENTRIES);
  try {
    const catalog = loadCatalog({ installRoot: dir });
    assert.equal(catalog.entries.length, ENTRIES.length);
    const r = getResource('command', 'pipeline', { installRoot: dir });
    assert.equal(r.content.toString('utf8'), '# pipeline\n');
    assert.throws(() => getResource('widget', 'x', { catalog }),
      (e) => e.code === 'CATALOG_UNKNOWN_KIND');
    assert.throws(() => getResource('command', 'nope', { catalog }),
      (e) => e.code === 'CATALOG_UNKNOWN_ID');
  } finally { cleanup(dir); }
});

test('duplicate case-insensitive kind/id and destination rejected', () => {
  const dir = fixture([
    ...ENTRIES,
    { kind: 'command', id: 'PIPELINE', path: 'commands/other.md', description: 'd' },
  ], { ...BASE_FILES, 'commands/other.md': 'x' });
  try {
    assert.throws(() => loadCatalog({ installRoot: dir }),
      (e) => e.code === 'CATALOG_DUPLICATE');
  } finally { cleanup(dir); }
  const dir2 = fixture([
    ...ENTRIES,
    { kind: 'agent', id: 'x2', path: 'agents/LEAD.md', description: 'd' },
  ]);
  try {
    assert.throws(() => loadCatalog({ installRoot: dir2 }),
      (e) => e.code === 'CATALOG_DUPLICATE');
  } finally { cleanup(dir2); }
});

test('missing file, traversal and outside-component paths rejected', () => {
  const missing = fixture([
    { kind: 'command', id: 'x', path: 'commands/missing.md',
      description: 'd', modes: ['m'] },
  ]);
  try {
    assert.throws(() => loadCatalog({ installRoot: missing }),
      (e) => e.code === 'CATALOG_MISSING_FILE');
  } finally { cleanup(missing); }
  const trav = fixture([
    { kind: 'command', id: 'x', path: 'commands/../secret.md',
      description: 'd', modes: ['m'] },
  ]);
  try {
    assert.throws(() => loadCatalog({ installRoot: trav }),
      (e) => e.code === 'INVALID_PATH' || e.code === 'CATALOG_MALFORMED');
  } finally { cleanup(trav); }
  const outside = fixture([
    { kind: 'command', id: 'x', path: 'docs/x.md',
      description: 'd', modes: ['m'] },
  ], { ...BASE_FILES, 'docs/x.md': 'x' });
  try {
    assert.throws(() => loadCatalog({ installRoot: outside }),
      (e) => e.code === 'CATALOG_INVALID_FILE');
  } finally { cleanup(outside); }
});

test('unknown dependency ids rejected', () => {
  const dir = fixture([
    ...ENTRIES,
    { kind: 'command', id: 'audit', path: 'commands/audit.md',
      description: 'd', modes: ['default'], skills: ['ghost'] },
  ], { ...BASE_FILES, 'commands/audit.md': 'x' });
  try {
    assert.throws(() => loadCatalog({ installRoot: dir }),
      (e) => e.code === 'CATALOG_MISSING_DEP');
  } finally { cleanup(dir); }
});

test('catalogFiles projects template skills to skills/<id>', () => {
  const dir = fixture(ENTRIES);
  try {
    const files = catalogFiles({ installRoot: dir });
    const byRel = Object.fromEntries(files.map((f) => [f.rel, f.content]));
    assert.equal(
      byRel['skills/project-onboarding/SKILL.md'].toString('utf8'),
      '# onboard\n');
    assert.ok(byRel['catalog.json']);
    assert.ok(byRel['commands/pipeline.md']);
    assert.equal(
      catalogDestRel({ path: 'templates/skills/x/SKILL.md', id: 'x' }),
      'skills/x/SKILL.md');
  } finally { cleanup(dir); }
});

test('missing manifest reports through checkCatalog, not a crash', () => {
  const dir = makeTempDir('no-catalog');
  try {
    const report = checkCatalog({ installRoot: dir });
    assert.equal(report.ok, false);
    assert.ok(report.issues.length > 0);
  } finally { cleanup(dir); }
});
