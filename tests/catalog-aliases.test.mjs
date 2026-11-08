// Catalog aliases: resolution, defaults, conflicts, snapshot carry-over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, loadWorkspaceCatalog, resolveInvocation } from '../src/core/catalog.mjs';
import {
  bootstrappedCtx, cleanup,
} from './helpers.mjs';

test('every authored alias resolves to its declared target/mode/params', () => {
  const catalog = loadCatalog({});
  const cases = [
    ['pipeline', undefined, 'plan-work', 'default', {}],
    ['pipeline', 'task', 'implement-task', 'default', {}],
    ['pipeline', 'run', 'coordinate-plan', 'default', {}],
    ['pipeline', 'interactive', 'report-status', 'default',
      { interaction: 'guided' }],
    ['spec', undefined, 'specify-change', 'default', {}],
    ['backlog', undefined, 'triage-work', 'default', {}],
    ['status', undefined, 'report-status', 'default', {}],
    ['audit', undefined, 'verify-work', 'quick', {}],
    ['audit', 'certify', 'verify-work', 'certify', {}],
    ['audit', 'review', 'review-change', 'default', {}],
    ['audit', 'full', 'audit-project', 'default', {}],
    ['harness', undefined, 'audit-harness', 'default', {}],
    ['research', undefined, 'investigate', 'default', {}],
    ['research', 'synthesis', 'compare-options', 'default', {}],
    ['ship', undefined, 'assess-release', 'default', {}],
    ['rollback', undefined, 'plan-recovery', 'default', {}],
    ['code-simplify', undefined, 'simplify-code', 'default', {}],
    ['codeGraph', undefined, 'analyze-structure', 'default', {}],
    ['cleanCA', undefined, 'review-change', 'default',
      { focus: 'architecture' }],
    ['webperf', undefined, 'audit-web-performance', 'quick', {}],
    ['webperf', 'deep', 'audit-web-performance', 'deep', {}],
  ];
  for (const [id, mode, canonical, cmode, params] of cases) {
    const r = resolveInvocation(catalog, { command: id, mode });
    assert.equal(r.canonicalId, canonical, `${id}:${mode}`);
    assert.equal(r.canonicalMode, cmode, `${id}:${mode} mode`);
    assert.equal(r.deprecated, true);
    assert.deepEqual(r.parameters, params, `${id}:${mode} params`);
  }
});

test('canonical command ids resolve directly; unknown ids/modes fail', () => {
  const catalog = loadCatalog({});
  const r = resolveInvocation(catalog, { command: 'plan-work' });
  assert.equal(r.canonicalId, 'plan-work');
  assert.equal(r.deprecated, false);
  assert.equal(r.requestedMode, 'default');
  assert.throws(() => resolveInvocation(catalog, { command: 'ghost' }),
    (e) => e.code === 'CATALOG_UNKNOWN_ID');
  assert.throws(() => resolveInvocation(catalog,
    { command: 'pipeline', mode: 'ghost' }),
    (e) => e.code === 'INVALID_MODE');
});

test('snapshot carries aliases verbatim into the projected catalog', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const cat = loadWorkspaceCatalog(ctx);
    assert.ok(cat.snapshot);
    assert.equal(cat.integrity, 'hash-verified');
    assert.ok(cat.aliases.length > 0);
    const r = resolveInvocation(cat, { command: 'pipeline', mode: 'task' });
    assert.equal(r.canonicalId, 'implement-task');
  } finally { cleanup(dir); }
});
