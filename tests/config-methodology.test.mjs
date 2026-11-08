// Methodology mode contract: validator, answers/config round-trip through
// DISK + context, no-op byte preservation, conflict, interactive seams,
// policy copy, doctor templates, bounded template reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertAnswersMatchConfig, createConfig, loadConfig, validateAnswers,
  validateConfigObject, validateMethodologyMode,
} from '../src/core/config.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { applyPlan, buildInitPlan, prepareInit } from '../src/core/bootstrap.mjs';
import { runDoctor } from '../src/core/doctor.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { run } from '../src/cli.mjs';
import {
  DEFAULT_ANSWERS, bootstrappedCtx, cleanup, fakeIO, makeTempDir, writeJson,
} from './helpers.mjs';

const INM = (e) => e.name === 'TaskError'
  && e.code === 'INVALID_METHODOLOGY_MODE';
const MODE_LABEL =
  'Metodologia: manual (V1), organic-sdd (proporcional), sdd (formal)';

// ---------------- validator ----------------

test('validator: undefined->manual; exact modes; strict reject incl BigInt/cyclic', () => {
  assert.equal(validateMethodologyMode(undefined), 'manual');
  for (const m of ['manual', 'organic-sdd', 'sdd']) {
    assert.equal(validateMethodologyMode(m), m);
  }
  const cyclic = {}; cyclic.self = cyclic;
  for (const bad of [null, ['manual'], true, 1, 'SDD', 'sdd-outcome',
    '', ' auto', cyclic, 10n]) {
    assert.throws(() => validateMethodologyMode(bad), INM, `${bad}`);
  }
  assert.throws(() => validateMethodologyMode('nope', 'answers.methodology'),
    (e) => INM(e) && e.message.includes('answers.methodology'));
});

// ---------------- disk round-trip + no-op ----------------

test('modes round-trip through disk config + resolveContext', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    for (const m of ['manual', 'organic-sdd', 'sdd']) {
      const cfg = createConfig(ctx.projectRoot,
        validateAnswers({ ...DEFAULT_ANSWERS, methodology: m }), {});
      writeJson(dir, '.tasksystem/config.json', cfg);
      const loaded = loadConfig(dir, '.tasksystem/config.json');
      assert.equal(loaded.config.methodology, m);
      const c2 = resolveContext({ project: dir });
      assert.equal(c2.config.methodology, m);
    }
    // Legacy stored record without the field -> normalized in memory only,
    // on-disk bytes untouched.
    const cfg = createConfig(ctx.projectRoot,
      validateAnswers(DEFAULT_ANSWERS), {});
    delete cfg.methodology;
    const rel = '.tasksystem/config.json';
    writeJson(dir, rel, cfg);
    const before = fs.readFileSync(`${dir}/${rel}`);
    const loaded = loadConfig(dir, rel);
    assert.equal(loaded.config.methodology, 'manual');
    assert.ok(fs.readFileSync(`${dir}/${rel}`).equals(before));
    assert.equal(resolveContext({ project: dir }).config.methodology,
      'manual');
  } finally { cleanup(dir); }
});

test('legacy no-op: prepareInit sees manual; apply preserves cfg+discovery bytes', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const cfgRel = '.tasksystem/config.json';
    const discRel = '.tasksystem/discovery.json';
    // Remove methodology from stored config, preserving formatted bytes.
    const cfg = JSON.parse(fs.readFileSync(`${dir}/${cfgRel}`, 'utf8'));
    if (cfg.methodology !== undefined) {
      delete cfg.methodology;
      writeJson(dir, cfgRel, cfg);
    }
    const cfgBefore = fs.readFileSync(`${dir}/${cfgRel}`);
    const discBefore = fs.readFileSync(`${dir}/${discRel}`);
    // Answers derived from the stored record so the only variable is the
    // absent methodology field.
    const matching = {
      name: cfg.project.name, locale: cfg.locale, hosts: cfg.hosts,
      paths: cfg.paths, versioning: cfg.versioning,
    };
    const prepared = prepareInit({ projectRoot: dir,
      configRel: '.tasksystem/config.json', answers: matching });
    assert.equal(prepared.config.methodology, 'manual');
    const applied = applyPlan(dir, prepared.files);
    assert.equal(applied.created, 0);
    assert.ok(fs.readFileSync(`${dir}/${cfgRel}`).equals(cfgBefore));
    assert.ok(fs.readFileSync(`${dir}/${discRel}`).equals(discBefore));
  } finally { cleanup(dir); }
});

test('mode conflict: absent-manual answers vs organic config -> INIT_CONFLICT', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const organic = createConfig(ctx.projectRoot,
      validateAnswers({ ...DEFAULT_ANSWERS, methodology: 'organic-sdd' }), {});
    const rel = '.tasksystem/config.json';
    writeJson(dir, rel, organic);
    const before = fs.readFileSync(`${dir}/${rel}`);
    assert.throws(() => assertAnswersMatchConfig(DEFAULT_ANSWERS, organic),
      (e) => e.code === 'INIT_CONFLICT');
    assert.throws(() => assertAnswersMatchConfig(
      { ...DEFAULT_ANSWERS, methodology: 'sdd' }, organic),
      (e) => e.code === 'INIT_CONFLICT');
    assert.doesNotThrow(() => assertAnswersMatchConfig(
      { ...DEFAULT_ANSWERS, methodology: 'organic-sdd' }, organic));
    assert.ok(fs.readFileSync(`${dir}/${rel}`).equals(before));
  } finally { cleanup(dir); }
});

// ---------------- interactive seams (fakeIO) ----------------

test('TTY: order hosts<mode<configPath; fresh default organic; cancel=no write', async () => {
  const dir = makeTempDir('cm-tty-');
  try {
    const io = fakeIO({ tty: true });
    await run(['init', '--project', dir], io);
    const labels = io.out.asked.map((a) => a.label);
    const hi = labels.findIndex((l) => l.startsWith('Anfitriones'));
    const mi = labels.indexOf(MODE_LABEL);
    const ci = labels.findIndex((l) => l === 'Ruta de configuracion');
    assert.ok(hi >= 0 && mi > hi && ci > mi,
      `order: ${JSON.stringify(labels)}`);
    const modeAsk = io.out.asked[mi];
    assert.equal(modeAsk.def, 'organic-sdd'); // fresh interactive default
    // Plan emitted before confirm carries methodology.
    const plan = io.out.stdout.map((s) => { try { return JSON.parse(s); }
      catch { return null; } }).find((o) => o && o.mode === 'plan');
    assert.equal(plan.methodology, 'organic-sdd');
    // Default 'no' confirm -> zero writes.
    assert.equal(fs.existsSync(`${dir}/.tasksystem`), false);
  } finally { cleanup(dir); }
});

test('TTY: explicit manual/sdd selection stored; invalid->valid re-prompts', async () => {
  for (const mode of ['manual', 'sdd']) {
    const dir = makeTempDir(`cm-${mode}-`);
    try {
      const seq = mode === 'manual' ? ['sdd-outcome', 'manual'] : [mode];
      const io = fakeIO({ tty: true });
      const orig = io.ask;
      io.ask = async (label, def) => {
        if (label === MODE_LABEL) {
          io.out.asked.push({ label, def });
          return seq.length ? seq.shift() : def;
        }
        if (label === 'Crear estos archivos? (yes/no)') {
          io.out.asked.push({ label, def });
          return 'yes';
        }
        return orig(label, def);
      };
      const code = await run(['init', '--project', dir], io);
      assert.equal(code, 0);
      const asks = io.out.asked.filter((a) => a.label === MODE_LABEL);
      if (mode === 'manual') {
        assert.equal(asks.length, 2, 'invalid then valid re-prompts');
        assert.ok(io.out.stderr.some((s) =>
          s === 'Metodo invalido: use manual, organic-sdd o sdd.'));
      }
      const cfg = JSON.parse(fs.readFileSync(
        `${dir}/.tasksystem/config.json`, 'utf8'));
      assert.equal(cfg.methodology, mode);
    } finally { cleanup(dir); }
  }
});

// ---------------- policy copy + doctor + bounded templates ----------------

test('policy/methodology.json projects verbatim into generated set + attrs', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const src = fs.readFileSync('policy/methodology.json');
    const dest = fs.readFileSync(`${dir}/.tasksystem/policy/methodology.json`);
    assert.ok(dest.equals(src));
    const attrs = fs.readFileSync(`${dir}/.tasksystem/.gitattributes`, 'utf8');
    assert.ok(attrs.includes('policy/methodology.json'));
  } finally { cleanup(dir); }
});

test('doctor: each new required template missing -> needs-attention + basename', () => {
  const { dir, ctx } = bootstrappedCtx();
  const install = makeTempDir('cm-inst-');
  try {
    fs.mkdirSync(`${install}/templates`, { recursive: true });
    for (const rel of ['approval-prompts.json', 'render-specification.mjs']) {
      fs.copyFileSync(`templates/${rel}`, `${install}/templates/${rel}`);
    }
    for (const rel of ['approval-prompts.json', 'render-specification.mjs']) {
      fs.rmSync(`${install}/templates/${rel}`);
      const r = runDoctor(ctx, { installRoot: install });
      assert.equal(r.status, 'needs-attention');
      const miss = r.checks.find((c) => c.name === 'templates'
        && c.detail && c.detail.includes(rel.split('/').pop()));
      assert.ok(miss, `missing ${rel} should be reported: `
        + `${JSON.stringify(r.checks)}`);
      fs.copyFileSync(`templates/${rel}`, `${install}/templates/${rel}`);
    }
  } finally { cleanup(dir); cleanup(install); }
});

test('oversized template -> TEMPLATE_TOO_LARGE before any product write', () => {
  const dir = makeTempDir('cm-ot-');
  const tplDir = makeTempDir('cm-tpl-');
  try {
    // Full template set (files only), project-instructions oversized.
    fs.mkdirSync(`${tplDir}/hosts`, { recursive: true });
    for (const f of fs.readdirSync('templates')) {
      const p = `templates/${f}`;
      if (fs.statSync(p).isFile()) fs.copyFileSync(p, `${tplDir}/${f}`);
    }
    for (const sub of fs.readdirSync('templates/hosts')) {
      fs.copyFileSync(`templates/hosts/${sub}`, `${tplDir}/hosts/${sub}`);
    }
    fs.writeFileSync(`${tplDir}/project-instructions.md`,
      'x'.repeat(loadLimits().maxDocumentBytes + 8));
    assert.throws(() => buildInitPlan({
      projectRoot: dir, configRel: '.tasksystem/config.json',
      config: createConfig(dir, validateAnswers(DEFAULT_ANSWERS), {}),
      discovery: { stacks: [], commands: [], evidence: [], fingerprint: '' },
      templatesDir: tplDir }),
      (e) => e.code === 'TEMPLATE_TOO_LARGE'
        && e.message.includes('project-instructions'));
    assert.equal(fs.existsSync(`${dir}/.tasksystem`), false);
  } finally { cleanup(dir); cleanup(tplDir); }
});

test('invalid answers fail before any write (root snapshot unchanged)', () => {
  const dir = makeTempDir('cm-inv-');
  try {
    const before = fs.readdirSync(dir).sort();
    assert.throws(() => prepareInit({ projectRoot: dir, answers:
      { ...DEFAULT_ANSWERS, methodology: 'sdd-outcome' } }),
      (e) => e.code === 'INVALID_METHODOLOGY_MODE');
    assert.deepEqual(fs.readdirSync(dir).sort(), before);
  } finally { cleanup(dir); }
});
