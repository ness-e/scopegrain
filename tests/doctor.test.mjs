// Doctor cases: content comparison, templates check, warning propagation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runDoctor } from '../src/core/doctor.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import {
  VALID_ANSWERS, cleanup, exists, makeTempDir, writeFile, writeJson,
} from './helpers.mjs';

function bootstrapped() {
  const dir = makeTempDir('doctor');
  applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
  const ctx = resolveContext({ project: dir });
  return { dir, ctx };
}

test('freshly initialized project reports ready', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const report = runDoctor(ctx);
    assert.equal(report.status, 'ready');
    assert.equal(report.changedDiscovery, false);
  } finally { cleanup(dir); }
});

test('corrupt or divergent integration fragment is needs-attention', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeFile(dir, '.tasksystem/integrations/claude-mcp.json', '{corrupt');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.includes('claude-mcp.json')));
  } finally { cleanup(dir); }
});

test('changed manifest fingerprint is reported', () => {
  const { dir, ctx } = bootstrapped();
  try {
    writeJson(dir, 'package.json', { name: 'new', scripts: { test: 't' } });
    const report = runDoctor(ctx);
    assert.equal(report.changedDiscovery, true);
    assert.ok(report.warnings.some((w) => w.includes('fingerprint')));
  } finally { cleanup(dir); }
});

test('adding a lockfile after init changes fingerprint presence', () => {
  // The manifest must exist BEFORE bootstrap; re-init on a changed manifest
  // is an explicit conflict, so lockfile presence is what varies here.
  const dir = makeTempDir('doctor-lock');
  try {
    writeJson(dir, 'package.json', { name: 'x', scripts: { test: 't' } });
    applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
    const ctx = resolveContext({ project: dir });
    assert.equal(runDoctor(ctx).changedDiscovery, false);
    writeFile(dir, 'package-lock.json', '{}');
    assert.equal(runDoctor(ctx).changedDiscovery, true);
  } finally { cleanup(dir); }
});

test('missing or corrupt discovery.json is needs-attention, never repaired', () => {
  const { dir, ctx } = bootstrapped();
  try {
    fs.rmSync(path.join(dir, '.tasksystem', 'discovery.json'));
    assert.equal(runDoctor(ctx).status, 'needs-attention');
    assert.ok(runDoctor(ctx).warnings.some((w) => w.startsWith('discovery')));
    assert.ok(!exists(dir, '.tasksystem/discovery.json')); // doctor never writes
    writeFile(dir, '.tasksystem/discovery.json', '{corrupt');
    const report = runDoctor(ctx);
    assert.equal(report.status, 'needs-attention');
    assert.ok(report.warnings.some((w) => w.includes('malformed JSON')));
    for (const raw of ['null', '[]', '"record"', 'false', '1']) {
      writeFile(dir, '.tasksystem/discovery.json', raw);
      assert.equal(runDoctor(ctx).status, 'needs-attention');
    }
    // Fingerprint mismatch also surfaces.
    writeFile(dir, '.tasksystem/discovery.json',
      JSON.stringify({ schemaVersion: 1, fingerprint: 'different' }));
    const r2 = runDoctor(ctx);
    assert.ok(r2.warnings.some((w) => w.includes('fingerprint')));
  } finally { cleanup(dir); }
});

test('missing required template is needs-attention without touching it', () => {
  const { dir, ctx } = bootstrapped();
  try {
    const fakeRoot = makeTempDir('doctor-noroot');
    try {
      const report = runDoctor(ctx, { installRoot: fakeRoot });
      assert.equal(report.status, 'needs-attention');
      assert.ok(report.warnings.some((w) => w.startsWith('templates')));
    } finally { cleanup(fakeRoot); }
  } finally { cleanup(dir); }
});
