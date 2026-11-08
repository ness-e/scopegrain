// loadMethodologyPolicy: closed-shape loader, typed validation before any
// .includes, authored-value enforcement, deep-freeze, no cache poisoning.
// Each case runs against a fresh module import in a minimal fixture - the
// real policy/methodology.json is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTempDir, cleanup } from './helpers.mjs';

const SRC = path.resolve('src/core');
const FIXTURE_FILES = ['policy.mjs', 'errors.mjs', 'fsx.mjs'];
const POLICY_SRC = path.resolve('policy/methodology.json');

// Minimal fixture: a copy of the loaders under fixture/src/core plus a
// mutable copy of the authored policy under fixture/policy.
function makeFixture() {
  const dir = makeTempDir('mp-');
  fs.mkdirSync(`${dir}/src/core`, { recursive: true });
  fs.mkdirSync(`${dir}/policy`, { recursive: true });
  for (const f of FIXTURE_FILES) {
    fs.copyFileSync(`${SRC}/${f}`, `${dir}/src/core/${f}`);
  }
  fs.copyFileSync(POLICY_SRC, `${dir}/policy/methodology.json`);
  return dir;
}

async function loadMod(dir, tag) {
  return import(pathToFileURL(`${dir}/src/core/policy.mjs`).href
    + `?case=${tag}`);
}

const pol = (code, frag) => (e) => e.name === 'TaskError'
  && e.code === 'POLICY_MALFORMED' && e.message.includes(frag);

const BASE = JSON.parse(fs.readFileSync(POLICY_SRC, 'utf8'));
const writePol = (dir, v) => fs.writeFileSync(`${dir}/policy/methodology.json`,
  JSON.stringify(v, null, 2) + '\n');

test('valid baseline: loads, deep-frozen, same ref, mutation throws', async () => {
  const dir = makeFixture();
  try {
    const m = await loadMod(dir, 'base');
    const p = m.loadMethodologyPolicy();
    assert.equal(p.schemaVersion, 1);
    assert.deepEqual([...p.modes], ['manual', 'organic-sdd', 'sdd']);
    assert.equal(m.loadMethodologyPolicy(), p); // same cached ref
    assert.throws(() => { p.modes = []; }, TypeError);
    assert.throws(() => { p.modes.push('x'); }, TypeError);
    assert.throws(() => { p.researchEscalation.network = 'auto'; },
      TypeError);
  } finally { cleanup(dir); }
});

// Every per-case mutation of the valid document must fail closed with a
// POLICY_MALFORMED TaskError naming the field - never a raw TypeError.
const cases = [
  ['modes missing', (d) => { delete d.modes; }, 'modes'],
  ['modes null', (d) => { d.modes = null; }, 'modes'],
  ['modes string', (d) => { d.modes = 'manual'; }, 'modes'],
  ['modes empty', (d) => { d.modes = []; }, 'modes'],
  ['modes unknown', (d) => { d.modes = ['manual', 'bogus', 'sdd']; }, 'modes'],
  ['modes dup', (d) => { d.modes = ['manual', 'manual', 'sdd']; }, 'modes'],
  ['legacy wrong', (d) => { d.legacyDefault = 'organic-sdd'; }, 'legacyDefault'],
  ['interactive wrong', (d) => { d.interactiveDefault = 'manual'; }, 'interactiveDefault'],
  ['gated missing', (d) => { delete d.gatedTaskStates; }, 'gatedTaskStates'],
  ['gated wrong', (d) => { d.gatedTaskStates = ['ACT']; }, 'gatedTaskStates'],
  ['gated dup', (d) => { d.gatedTaskStates = ['ACT', 'ACT', 'ACCEPT']; }, 'gatedTaskStates'],
  ['cats missing', (d) => { delete d.riskCategories; }, 'riskCategories'],
  ['cats unknown', (d) => { d.riskCategories = ['security', 'nope']; }, 'riskCategories'],
  ['cats dup', (d) => { const c=[...d.riskCategories];c.push(c[0]);d.riskCategories=c; }, 'riskCategories'],
  ['escalation null', (d) => { d.researchEscalation = null; }, 'researchEscalation'],
  ['escalation missing count', (d) => { delete d.researchEscalation.investigateAfterSimilarFailures; }, 'investigateAfterSimilarFailures'],
  ['escalation wrong 2', (d) => { d.researchEscalation.investigateAfterSimilarFailures = 1; }, 'investigateAfterSimilarFailures'],
  ['escalation wrong 3', (d) => { d.researchEscalation.revisitDesignAfterAttemptsWithoutProgress = 2; }, 'revisitDesignAfterAttemptsWithoutProgress'],
  ['escalation net', (d) => { d.researchEscalation.network = 'auto'; }, 'network'],
  ['escalation causal', (d) => { d.researchEscalation.causalGrouping = 'x'; }, 'causalGrouping'],
  ['escalation extra', (d) => { d.researchEscalation.extra = 1; }, 'researchEscalation'],
  ['root extra', (d) => { d.extra = 1; }, 'root'],
  ['flag true', (d) => { d.authenticatesEvidence = true; }, 'authenticatesEvidence'],
  ['flag missing', (d) => { delete d.executesAgents; }, 'executesAgents'],
  ['oddDefinition wrong', (d) => { d.oddDefinition = 'outcome-driven'; }, 'oddDefinition'],
  ['smallTask wrong', (d) => { d.smallTaskTracking = 'sdd'; }, 'smallTaskTracking'],
];

for (const [label, mutate, frag] of cases) {
  test(`malformed policy: ${label} -> POLICY_MALFORMED`, async () => {
    const dir = makeFixture();
    try {
      const bad = JSON.parse(JSON.stringify(BASE));
      mutate(bad);
      writePol(dir, bad);
      const m = await loadMod(dir, label.replace(/\W+/g, '-'));
      assert.throws(() => m.loadMethodologyPolicy(), pol('POLICY_MALFORMED', frag));
    } finally { cleanup(dir); }
  });
}

test('cache not poisoned: invalid then valid in same module', async () => {
  const dir = makeFixture();
  try {
    const bad = JSON.parse(JSON.stringify(BASE));
    bad.modes = 'not-an-array';
    writePol(dir, bad);
    const m = await loadMod(dir, 'no-poison');
    assert.throws(() => m.loadMethodologyPolicy(), pol('POLICY_MALFORMED', 'modes'));
    writePol(dir, BASE); // repair
    const p = m.loadMethodologyPolicy();
    assert.equal(p.schemaVersion, 1);
  } finally { cleanup(dir); }
});

test('absent file -> POLICY_NOT_FOUND; oversized -> bounded', async () => {
  const dir = makeFixture();
  try {
    fs.rmSync(`${dir}/policy/methodology.json`);
    const m = await loadMod(dir, 'absent');
    assert.throws(() => m.loadMethodologyPolicy(),
      (e) => e.name === 'TaskError' && e.code === 'POLICY_NOT_FOUND');
    fs.writeFileSync(`${dir}/policy/methodology.json`, 'x'.repeat(1024 * 1024));
    const m2 = await loadMod(dir, 'oversize');
    assert.throws(() => m2.loadMethodologyPolicy(),
      (e) => e.name === 'TaskError' && e.code === 'POLICY_MALFORMED');
  } finally { cleanup(dir); }
});
