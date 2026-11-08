// Git transport contract: .gitattributes coverage, root skip, root CRLF
// tolerance for AGENTS/CLAUDE only, payload CRLF still mismatched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPlan, prepareInit } from '../src/core/bootstrap.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { buildWorkflowPacket } from '../src/core/workflows.mjs';
import { loadWorkspaceCatalog } from '../src/core/catalog.mjs';
import {
  DEFAULT_ANSWERS, bootstrappedCtx, cleanup, makeTempDir,
} from './helpers.mjs';

test('.gitattributes covers every configDir file plus itself, root skipped', () => {
  const dir = makeTempDir('ga');
  try {
    const plan = prepareInit({ projectRoot: dir, answers: DEFAULT_ANSWERS });
    const attrs = plan.files.find((f) => f.rel === '.tasksystem/.gitattributes');
    assert.ok(attrs);
    const text = attrs.content.toString('utf8');
    assert.ok(text.startsWith(
      '# Preserve generated harness bytes; root project attributes are unchanged.\n'));
    const rules = text.split('\n').filter((l) => l.endsWith(' -text'));
    for (const f of plan.files) {
      if (!f.rel.startsWith('.tasksystem/') || f.rel.endsWith('.gitattributes')) continue;
      const rel = f.rel.slice('.tasksystem/'.length);
      const needle = `"/${rel.replace(/([\\*?\[\]])/g, '\\$1')}" -text`;
      assert.ok(rules.includes(needle), `missing rule for ${rel}`);
    }
    assert.ok(rules.includes('"/.gitattributes" -text'));
    assert.ok(!plan.files.some((f) => f.rel === '.gitattributes'));
    const rootPlan = prepareInit({ projectRoot: dir,
      answers: DEFAULT_ANSWERS, configRel: 'config.json' });
    assert.ok(!rootPlan.files.some((f) => f.rel === '.gitattributes'));
    assert.ok(rootPlan.warnings.some((w) => w.includes('Git transport')));
  } finally { cleanup(dir); }
});

test('escaped literal rules for brackets in config filename', () => {
  const dir = makeTempDir('gs');
  try {
    const configRel = 'cfg space[1]/config [1].json';
    const plan = prepareInit({ projectRoot: dir,
      answers: DEFAULT_ANSWERS, configRel });
    const attrs = plan.files.find((f) =>
      f.rel === 'cfg space[1]/.gitattributes');
    assert.ok(attrs);
    const text = attrs.content.toString('utf8');
    // Exact escaped line for the bracket-bearing filename.
    const want = `${JSON.stringify('/config \\[1\\].json')} -text`;
    assert.ok(text.split('\n').includes(want),
      `missing escaped rule: ${want}`);
    assert.ok(text.includes(`${JSON.stringify('/catalog.json')} -text`));
  } finally { cleanup(dir); }
});

test('doctor: root AGENTS/CLAUDE with flipped EOL ready; edit is not', () => {
  const dir = makeTempDir('dr');
  try {
    const plan = prepareInit({ projectRoot: dir,
      answers: { ...DEFAULT_ANSWERS, hosts: ['claude', 'codex'] } });
    applyPlan(dir, plan.files);
    for (const root of ['AGENTS.md', 'CLAUDE.md']) {
      const abs = `${dir}/${root}`;
      assert.ok(fs.existsSync(abs), `${root} must be generated`);
      const orig = fs.readFileSync(abs);
      const lf = Buffer.from(
        orig.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
      const alt = orig.includes('\r\n')
        ? lf
        : Buffer.from(
          orig.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
      assert.ok(!alt.equals(orig), 'flip must change bytes');
      fs.writeFileSync(abs, alt);
      const r1 = runDoctor(resolveContext({ project: dir }));
      assert.equal(r1.status, 'ready', JSON.stringify(
        r1.checks.filter((c) => !c.ok).slice(0, 4)));
      fs.writeFileSync(abs, Buffer.concat([orig, Buffer.from('\nE\n')]));
      const r2 = runDoctor(resolveContext({ project: dir }));
      assert.equal(r2.status, 'needs-attention');
      fs.writeFileSync(abs, orig);
    }
  } finally { cleanup(dir); }
});

test('payload file converted to CRLF still mismatches the pin', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const f = `${dir}/.tasksystem/commands/plan-work.md`;
    const orig = fs.readFileSync(f);
    fs.writeFileSync(f, orig.toString('latin1').replace(/\n/g, '\r\n'));
    assert.throws(() => loadWorkspaceCatalog(ctx),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    assert.throws(() => buildWorkflowPacket(ctx, { command: 'pipeline' }),
      (e) => e.code === 'RESOURCE_INTEGRITY_MISMATCH');
    fs.writeFileSync(f, orig);
  } finally { cleanup(dir); }
});
