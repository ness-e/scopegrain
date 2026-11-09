// C2-E adapter contracts. Fixture checks/reviewers below are DECLARATIONS,
// not proof of command execution or authenticated identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { run } from '../src/cli.mjs';
import { resolveContext } from '../src/core/context.mjs';
import { getTask } from '../src/core/tasks.mjs';
import { getArtifact } from '../src/core/artifacts.mjs';
import {
  getApproval, describeApprovalTarget, prepareApprovalAnswer,
} from '../src/core/approvals.mjs';
import { checkMethodology } from '../src/core/methodology.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { assessment, refs, verification, fresh } from './methodology-fixtures.mjs';
import {
  DEFAULT_ANSWERS, bootstrappedCtx, cleanup, fakeIO, writeFile, writeJson,
} from './helpers.mjs';

const MISSING = '00000000-0000-4000-8000-000000000000';
const USAGES = [
  'specification create --project PATH --input FILE [--apply]',
  'specification show --project PATH UUID',
  'design create --project PATH --input FILE [--apply]',
  'outcome create --project PATH --input FILE [--apply]',
  'approval target --project PATH --input FILE',
  'approval create --project PATH --input FILE [--apply]',
  'approval show --project PATH DIGEST',
  'approval answer --project PATH --input FILE [--apply]',
  'methodology check --project PATH UUID [--to ACT|ACCEPT] [--outcome-evidence UUID]',
];
const TASK_USAGE = 'task create --project PATH (--input FILE [--apply] | --title T --contract C --author A [--scope a,b] [--spec UUID --design UUID] [--plan KEY])';
const baseTask = () => ({
  title: 'Declared change', contract: 'Observable contract',
  authorContext: 'fixture-author', scope: ['src/a'],
});
const specInput = () => ({
  originalRequest: 'Verbatim C2-E fixture request',
  title: 'Structured CLI spec',
  outcome: { statement: 'Declared outcome', evidencePlan: 'Declared checks' },
  requirements: [{ id: 'R1', statement: 'Required behavior',
    scenarios: ['S1', 'S2'].map((id) => ({
      id, given: 'fixture', when: 'declared check', then: 'declared result',
    })) }],
  scope: ['src/a', 'src/b'], openQuestions: [],
});

// Both directory membership and exact bytes are compared (including locks).
function filesAndBytes(root) {
  const out = {};
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      out[rel] = st.isDirectory() ? 'directory'
        : st.isSymbolicLink() ? `link:${fs.readlinkSync(abs)}`
          : fs.readFileSync(abs);
      if (st.isDirectory()) walk(abs, rel);
    }
  }
  walk(root);
  return out;
}
function fixture(methodology = 'organic-sdd', locale = 'es') {
  return bootstrappedCtx({
    ...DEFAULT_ANSWERS, hosts: ['claude'], methodology, locale,
  });
}
async function invoke(f, args, expected = 0) {
  const io = fakeIO();
  const code = await run([...args, '--project', f.dir,
    ...(f.configFlag ? ['--config', f.configFlag] : [])], io);
  assert.equal(code, expected, JSON.stringify(io.out));
  if (expected === 0) {
    assert.deepEqual(io.out.stderr, []);
    return JSON.parse(io.out.stdout.at(-1));
  }
  assert.deepEqual(io.out.stdout, []);
  return JSON.parse(io.out.stderr.at(-1)).error;
}
async function readonly(f, args, expected = 0) {
  const before = filesAndBytes(f.dir);
  try { return await invoke(f, args, expected); }
  finally { assert.deepEqual(filesAndBytes(f.dir), before); }
}
function input(f, value, name = 'input.json') {
  return writeJson(f.dir, `.inputs/${name}`, value);
}
async function create(f, family, value, apply = true) {
  const args = [family, 'create', '--input', input(f, value)];
  if (apply) return invoke(f, [...args, '--apply']);
  return readonly(f, args);
}
async function structuredPair(f) {
  const spec = (await create(f, 'specification', specInput())).artifact;
  const design = (await create(f, 'design', {
    specId: spec.id, title: 'CLI design', body: 'Verbatim design body',
  })).artifact;
  return { spec, design };
}
async function target(f, kind, id) {
  const dto = ['spec', 'design', 'report'].includes(kind)
    ? { kind: 'artifact', artifactKind: kind, id } : { kind, id };
  const result = await readonly(f, ['approval', 'target', '--input', input(f, dto)]);
  assert.deepEqual(result, describeApprovalTarget(f.ctx, dto));
  return result;
}
async function pendingApproval(f, kind, id) {
  const desc = await target(f, kind, id);
  return (await create(f, 'approval', { target: desc.target })).approval;
}
function answerDTO(approval, answer = 'approve', comment = 'Declared fixture intent') {
  return { id: approval.id, expectedRevision: approval.revision,
    expectedTargetDigest: approval.target.digest,
    answer, actor: 'declared fixture owner', comment };
}
async function answer(f, dto, apply = true, expected = 0) {
  const args = ['approval', 'answer', '--input', input(f, dto)];
  return apply
    ? invoke(f, [...args, '--apply'], expected) : readonly(f, args, expected);
}
async function approve(f, kind, id) {
  return (await answer(f, answerDTO(await pendingApproval(f, kind, id)))).approval;
}
async function advance(f, task, to, evidence) {
  const args = ['task', 'transition', task.id, to,
    '--revision', String(task.revision)];
  if (evidence) args.push('--evidence', input(f, evidence, 'evidence.json'));
  return invoke(f, args);
}

test('C2-E help exposes exact nine usages, JSON/legacy task usage and notes', async () => {
  const io = fakeIO();
  assert.equal(await run(['--help'], io), 0);
  const help = JSON.parse(io.out.stdout[0]);
  const usages = help.commands.map((c) => c.command);
  for (const usage of [...USAGES, TASK_USAGE]) assert.ok(usages.includes(usage), usage);
  assert.ok(help.notes.includes('JSON creation previews do not reserve IDs; use IDs returned by --apply'));
  assert.ok(help.notes.includes('Methodology checks and stored approvals are not native tool permissions'));
});

test('new families enforce project, positions, whitelists and safety flags', async () => {
  const f = fixture();
  try {
    for (const usage of USAGES) {
      const tokens = usage.split(' ');
      const family = tokens[0];
      const sub = tokens[1];
      const tail = sub === 'show' || sub === 'check' ? [MISSING] : [];
      const io = fakeIO();
      assert.equal(await run([family, sub, ...tail], io), 1);
      assert.equal(JSON.parse(io.out.stderr[0]).error.code, 'INVALID_ARGS');
      for (const extra of [['--yes'], ['--force'], ['--title', 'bad'], ['extra', 'extra']]) {
        const e = await readonly(f, [family, sub, ...tail, ...extra], 1);
        assert.equal(e.code, 'INVALID_ARGS');
      }
      assert.equal((await readonly(f, [family, 'not-a-subcommand'], 1)).code, 'INVALID_ARGS');
    }
  } finally { cleanup(f.dir); }
});

test('JSON task combinations reject all legacy fields before input file access', async (t) => {
  const f = fixture('manual');
  try {
    const filename = path.join(f.dir, 'must-not-be-read.json');
    const lstat = fs.lstatSync;
    let inputReads = 0;
    const mock = t.mock.method(fs, 'lstatSync', function (file, ...args) {
      if (path.resolve(String(file)) === filename) inputReads++;
      return lstat.call(this, file, ...args);
    });
    try {
      for (const flag of ['--title', '--contract', '--author', '--scope', '--spec', '--design', '--plan']) {
        const e = await readonly(f,
          ['task', 'create', '--input', filename, flag, 'supplied'], 1);
        assert.equal(e.code, 'INVALID_ARGS');
      }
      assert.equal(inputReads, 0);
    } finally { mock.mock.restore(); }
    const e = await readonly(f, ['task', 'create', '--apply'], 1);
    assert.deepEqual(e, { code: 'INVALID_ARGS',
      message: '--apply requires --input for task create; legacy flags create directly' });
  } finally { cleanup(f.dir); }
});

for (const mode of ['manual', 'organic-sdd', 'sdd']) {
  test(`JSON task preview/apply uses persisted ${mode} config and never reserves IDs`, async () => {
    const f = fixture(mode);
    try {
      assert.equal(resolveContext({ project: f.dir }).config.methodology, mode);
      const pair = mode === 'sdd' ? await structuredPair(f) : null;
      const dto = { ...baseTask(), ...(pair
        ? { specId: pair.spec.id, designId: pair.design.id, scenarioRefs: refs('S1') }
        : mode === 'organic-sdd' ? { methodology: assessment() } : {}) };
      const preview = await create(f, 'task', dto, false);
      assert.equal(preview.mode, 'dry-run');
      assert.equal(preview.applied, false);
      assert.deepEqual(preview.files, [{
        path: `${f.ctx.config.paths.tasks}/${preview.task.id}.json`, action: 'create',
      }]);
      assert.throws(() => getTask(f.ctx, preview.task.id), { code: 'TASK_NOT_FOUND' });
      const applied = await create(f, 'task', dto);
      assert.equal(applied.mode, 'applied');
      assert.equal(applied.applied, true);
      assert.equal(applied.created, 1);
      assert.notEqual(applied.task.id, preview.task.id);
      assert.deepEqual(getTask(f.ctx, applied.task.id), applied.task);
      assert.equal(applied.task.schemaVersion, mode === 'manual' ? 1 : 2);
      if (mode === 'manual') {
        for (const key of ['methodology', 'specId', 'designId', 'planKey', 'scenarioRefs']) {
          assert.equal(Object.hasOwn(applied.task, key), false);
        }
      }
      if (pair) assert.deepEqual(applied.task.scenarioRefs, refs('S1'));
      if (mode === 'organic-sdd') {
        const e = await readonly(f, ['task', 'create', '--input', input(f, baseTask())], 1);
        assert.equal(e.code, 'METHODOLOGY_REQUIRED');
      }
    } finally { cleanup(f.dir); }
  });
}

test('legacy task flags still write directly, preserve V1 shape and pass formal pair only when present', async () => {
  const f = fixture('manual');
  try {
    const flags = ['task', 'create', '--title', 'T', '--contract', 'C',
      '--author', 'fixture-author', '--scope', 'src/a'];
    const legacy = await invoke(f, flags);
    assert.equal(legacy.schemaVersion, 1);
    assert.equal(Object.hasOwn(legacy, 'mode'), false);
    assert.equal(Object.hasOwn(legacy, 'methodology'), false);
    assert.equal(Object.hasOwn(legacy, 'specId'), false);
    assert.deepEqual(getTask(f.ctx, legacy.id), legacy);
    const { spec, design } = await structuredPair(f);
    const formal = await invoke(f, [...flags, '--spec', spec.id, '--design', design.id]);
    assert.equal(formal.schemaVersion, 2);
    assert.equal(formal.specId, spec.id);
    assert.equal(formal.designId, design.id);
    assert.equal(formal.planKey, null);
    assert.equal(formal.methodology, null);
    const planned = await invoke(f, [...flags, '--spec', spec.id,
      '--design', design.id, '--plan', 'explicit-plan-key']);
    assert.equal(planned.planKey, 'explicit-plan-key');
    for (const [extra, code] of [
      [['--spec', spec.id], 'INVALID_ID'],
      [['--design', design.id], 'INVALID_ID'],
      [['--plan', 'alone'], 'METHODOLOGY_REQUIRED'],
    ]) {
      assert.equal((await readonly(f, [...flags, ...extra], 1)).code, code);
    }
  } finally { cleanup(f.dir); }
});

test('custom --config controls typed records, tasks, approval and methodology bindings', async () => {
  const f = fixture('manual');
  try {
    const config = structuredClone(f.ctx.config);
    config.methodology = 'organic-sdd';
    config.paths.tasks = 'custom/tasks';
    config.paths.plans = 'custom/plans';
    config.paths.decisions = 'custom/decisions';
    config.paths.reports = 'custom/reports';
    f.configFlag = 'custom/config.json';
    writeJson(f.dir, f.configFlag, config);
    f.ctx = resolveContext({ project: f.dir, config: f.configFlag });
    const { spec, design } = await structuredPair(f);
    const t = (await create(f, 'task', { ...baseTask(),
      specId: spec.id, designId: design.id })).task;
    assert.deepEqual(await readonly(f, ['specification', 'show', spec.id]), spec);
    const a = await approve(f, 'spec', spec.id);
    assert.deepEqual(await readonly(f, ['approval', 'show', a.id]), a);
    assert.deepEqual(await readonly(f, ['methodology', 'check', t.id]),
      checkMethodology(f.ctx, { taskId: t.id }));
    assert.ok(fs.existsSync(path.join(f.dir, 'custom/tasks', `${t.id}.json`)));
    assert.ok(fs.existsSync(path.join(f.dir, 'custom/plans/specs', `${spec.id}.json`)));
    assert.ok(fs.existsSync(path.join(f.dir, 'custom/decisions/approvals', `${a.id}.json`)));
    assert.equal(fs.existsSync(path.join(f.dir, '.tasksystem/tasks', `${t.id}.json`)), false);
    await approve(f, 'design', design.id);
    await approve(f, 'task', t.id);
    let current = await advance(f, t, 'ACT');
    current = await advance(f, current, 'VERIFY', { verification: verification(['S1', 'S2']) });
    current = await advance(f, current, 'EVALUATE', { review: fresh(current) });
    current = await advance(f, current, 'REVIEW');
    const report = (await create(f, 'outcome', {
      taskId: current.id, title: 'Custom outcome', body: 'Declared fixture only',
    })).artifact;
    assert.ok(fs.existsSync(path.join(f.dir, 'custom/reports', `${report.id}.json`)));
  } finally { cleanup(f.dir); }
});

test('typed spec/design previews are read-only and typed show rejects generic legacy spec', async () => {
  const f = fixture();
  try {
    const preview = await create(f, 'specification', specInput(), false);
    assert.equal(preview.applied, false);
    assert.equal(preview.artifact.schemaVersion, 2);
    assert.equal(preview.files[0].action, 'create');
    const { spec, design } = await structuredPair(f);
    assert.deepEqual(await readonly(f, ['specification', 'show', spec.id]), spec);
    const dp = await create(f, 'design', {
      specId: spec.id, title: 'Preview design', body: 'verbatim',
    }, false);
    assert.equal(dp.artifact.data.specId, spec.id);
    assert.deepEqual(getArtifact(f.ctx, 'design', design.id), design);
    const legacy = await invoke(f, ['artifact', 'add', 'spec', '--input',
      input(f, { title: 'Legacy spec', body: 'unstructured' }), '--apply']);
    assert.equal(legacy.artifact.schemaVersion, 1);
    assert.deepEqual(await readonly(f, ['artifact', 'show', 'spec', legacy.artifact.id]),
      legacy.artifact);
    assert.equal((await readonly(f,
      ['specification', 'show', legacy.artifact.id], 1)).code, 'SPEC_STRUCTURED_REQUIRED');
  } finally { cleanup(f.dir); }
});

test('formal plan CLI applies actual child IDs and assigned scenario coverage', async () => {
  const f = fixture('sdd');
  try {
    const { spec, design } = await structuredPair(f);
    const dto = { key: 'c2e-plan', title: 'Formal DAG', authorContext: 'fixture-author',
      specId: spec.id, designId: design.id, tasks: [
        { key: 'a', title: 'A', contract: 'C', scope: ['src/a'], scenarioRefs: refs('S1') },
        { key: 'b', title: 'B', contract: 'C', scope: ['src/b'],
          scenarioRefs: refs('S2'), dependsOn: ['a'] },
      ] };
    const preview = await create(f, 'plan', dto, false);
    const applied = await create(f, 'plan', dto);
    assert.equal(applied.plan.schemaVersion, 2);
    for (const [i, ref] of applied.plan.tasks.entries()) {
      assert.notEqual(ref.id, preview.plan.tasks[i].id);
      const child = await readonly(f, ['task', 'show', ref.id]);
      assert.equal(child.planKey, applied.plan.key);
      assert.equal(child.specId, spec.id);
      assert.deepEqual(child.scenarioRefs, refs(`S${i + 1}`));
    }
    await approve(f, 'spec', spec.id);
    await approve(f, 'design', design.id);
    await approve(f, 'plan', applied.plan.key);
    assert.equal((await readonly(f,
      ['methodology', 'check', applied.plan.tasks[0].id])).allowed, true);
    const blocked = await readonly(f, ['methodology', 'check', applied.plan.tasks[1].id]);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.issues.some((i) => i.code === 'PLAN_DEPENDENCY_OPEN'));
  } finally { cleanup(f.dir); }
});

for (const [locale, prefix, labels] of [
  ['es', '\u00bfApruebas', ['Aprobar', 'Rechazar']],
  ['en', 'Do you approve', ['Approve', 'Reject']],
]) {
  test(`approval target/create/show preserve core-authored ${locale} question, options and scope`, async () => {
    const f = fixture('organic-sdd', locale);
    try {
      const { spec } = await structuredPair(f);
      const desc = await target(f, 'spec', spec.id);
      assert.match(desc.target.digest, /^[0-9a-f]{64}$/);
      assert.deepEqual(desc.scope.paths, spec.data.scope);
      const preview = await create(f, 'approval', { target: desc.target }, false);
      assert.equal(preview.applied, false);
      assert.ok(preview.approval.question.startsWith(prefix));
      assert.deepEqual(preview.approval.options.map((o) => o.label), labels);
      assert.deepEqual(preview.approval.scope, desc.scope);
      assert.ok(preview.approval.notice.length > 0);
      const a = (await create(f, 'approval', { target: desc.target })).approval;
      assert.deepEqual(await readonly(f, ['approval', 'show', a.id]), a);
      // An existing answered record is never overwritten/reused by create.
      const approved = (await answer(f, answerDTO(a))).approval;
      const e = await readonly(f, ['approval', 'create',
        '--input', input(f, { target: desc.target }), '--apply'], 1);
      assert.equal(e.code, 'PLAN_CONFLICT');
      assert.deepEqual(getApproval(f.ctx, a.id), approved);
    } finally { cleanup(f.dir); }
  });
}

test('answer preview grants no gate; apply uses mutable CAS, stale revision/digest and locks cannot overwrite', async () => {
  const f = fixture('sdd');
  try {
    const { spec, design } = await structuredPair(f);
    const task = (await create(f, 'task', { ...baseTask(),
      specId: spec.id, designId: design.id })).task;
    await approve(f, 'spec', spec.id);
    await approve(f, 'design', design.id);
    const a = await pendingApproval(f, 'task', task.id);
    const dto = answerDTO(a);
    const preview = await answer(f, dto, false);
    assert.equal(preview.mode, 'dry-run');
    assert.equal(preview.applied, false);
    assert.equal(preview.previousRevision, 0);
    assert.equal(preview.approval.revision, 1);
    assert.equal(preview.approval.status, 'approved');
    assert.deepEqual(preview.files, [{
      path: `${f.ctx.config.paths.decisions}/approvals/${a.id}.json`, action: 'update',
    }]);
    assert.equal(getApproval(f.ctx, a.id).status, 'pending');
    assert.equal((await readonly(f, ['methodology', 'check', task.id])).allowed, false);
    const applied = await answer(f, dto);
    assert.equal(applied.mode, 'applied');
    assert.equal(applied.applied, true);
    assert.deepEqual(applied.approval, getApproval(f.ctx, a.id));
    assert.equal((await readonly(f, ['methodology', 'check', task.id])).allowed, true);
    for (const [bad, code] of [
      [dto, 'REVISION_MISMATCH'],
      [{ ...answerDTO(applied.approval), expectedTargetDigest: '0'.repeat(64) }, 'APPROVAL_STALE_TARGET'],
      [{ ...answerDTO(applied.approval), unexpected: true }, 'APPROVAL_INVALID'],
    ]) {
      const file = input(f, bad);
      assert.equal((await readonly(f, ['approval', 'answer', '--input', file, '--apply'], 1)).code, code);
    }
    const lock = `${f.ctx.config.paths.decisions}/approvals/${a.id}.json.lock`;
    writeFile(f.dir, lock, 'foreign lock');
    const file = input(f, answerDTO(applied.approval, 'revoke'));
    assert.equal((await readonly(f, ['approval', 'answer', '--input', file, '--apply'], 1)).code, 'APPROVAL_LOCKED');
    fs.unlinkSync(path.join(f.dir, lock)); // fixture-owned sentinel only
    const revoked = (await answer(f, answerDTO(applied.approval, 'revoke'))).approval;
    assert.equal(revoked.status, 'revoked');
    assert.equal(revoked.revision, 2);
    assert.equal((await readonly(f, ['methodology', 'check', task.id])).allowed, false);
    assert.deepEqual(await readonly(f, ['approval', 'show', a.id]), revoked);
  } finally { cleanup(f.dir); }
});

test('answer apply revalidates fresh CAS under lock instead of applying a preview over a concurrent answer', async (t) => {
  const f = fixture();
  try {
    const { spec } = await structuredPair(f);
    const a = await pendingApproval(f, 'spec', spec.id);
    const requested = answerDTO(a);
    // The competing answer is a fully validated core-produced record, not
    // an invented malformed fixture. Only the write timing is injected.
    const competing = prepareApprovalAnswer(f.ctx, answerDTO(a, 'decline'));
    const file = input(f, requested);
    const lockPath = `${competing.file.abs}.lock`;
    const open = fs.openSync;
    let injected = false;
    let competitorSnapshot;
    const mock = t.mock.method(fs, 'openSync', function (filename, flags, ...args) {
      if (!injected && filename === lockPath && flags === 'wx') {
        injected = true;
        fs.writeFileSync(competing.file.abs, competing.file.content);
        competitorSnapshot = filesAndBytes(f.dir);
      }
      return open.call(this, filename, flags, ...args);
    });
    try {
      const e = await invoke(f, ['approval', 'answer', '--input', file, '--apply'], 1);
      assert.equal(injected, true, 'CLI must enter the core locked answer API');
      assert.equal(e.code, 'REVISION_MISMATCH');
      // Only the simulated competitor wrote; the failed CAS leaves no lock,
      // temporary, overwritten approval or other filesystem change.
      assert.deepEqual(filesAndBytes(f.dir), competitorSnapshot);
      assert.deepEqual(getApproval(f.ctx, a.id), competing.next);
    } finally { mock.mock.restore(); }
  } finally { cleanup(f.dir); }
});

test('custom/decline answers and required comments follow closed core CAS DTO', async () => {
  const f = fixture();
  try {
    const { spec, design } = await structuredPair(f);
    const a = await pendingApproval(f, 'spec', spec.id);
    const b = await pendingApproval(f, 'design', design.id);
    for (const dto of [
      answerDTO(a, 'custom', ''),
      { ...answerDTO(a), actor: '' },
      { ...answerDTO(a), answer: 'force' },
    ]) {
      assert.equal((await answer(f, dto, false, 1)).code, 'APPROVAL_INVALID');
      const file = input(f, dto);
      assert.equal((await readonly(f, ['approval', 'answer', '--input', file, '--apply'], 1)).code, 'APPROVAL_INVALID');
    }
    assert.equal((await answer(f, answerDTO(a, 'custom'))).approval.status, 'needs-clarification');
    assert.equal((await answer(f, answerDTO(b, 'decline'))).approval.status, 'declined');
  } finally { cleanup(f.dir); }
});

test('complete formal CLI flow uses applied IDs and actual transitions, not synthetic task states', async () => {
  const f = fixture('sdd');
  try {
    const { spec, design } = await structuredPair(f);
    let task = (await create(f, 'task', { ...baseTask(),
      specId: spec.id, designId: design.id, scenarioRefs: refs('S1') })).task;
    await approve(f, 'spec', spec.id);
    await approve(f, 'design', design.id);
    await approve(f, 'task', task.id);
    assert.equal((await readonly(f, ['methodology', 'check', task.id])).allowed, true);
    task = await advance(f, task, 'ACT');
    // Stored command/result strings and reviewer names are synthetic declared
    // fixture evidence only; TaskSystem does NOT run/authenticate them.
    const declared = verification();
    task = await advance(f, task, 'VERIFY', { verification: declared });
    task = await advance(f, task, 'EVALUATE', { review: fresh(task) });
    task = await advance(f, task, 'REVIEW');
    const dto = { taskId: task.id, title: 'Outcome',
      body: 'Synthetic fixture attestation; NOT actual command execution.' };
    const preview = await create(f, 'outcome', dto, false);
    assert.equal(preview.artifact.data.taskRevision, task.revision);
    assert.equal(preview.files[0].action, 'create');
    const applied = await create(f, 'outcome', dto);
    const report = applied.artifact;
    assert.notEqual(report.id, preview.artifact.id);
    assert.deepEqual(getArtifact(f.ctx, 'report', report.id), report);
    await approve(f, 'report', report.id);
    const args = ['methodology', 'check', task.id, '--to', 'ACCEPT',
      '--outcome-evidence', report.id];
    const checked = await readonly(f, args);
    assert.deepEqual(checked, checkMethodology(f.ctx,
      { taskId: task.id, to: 'ACCEPT', outcomeEvidenceId: report.id }));
    assert.equal(checked.allowed, true, JSON.stringify(checked.issues));
    assert.equal(Object.hasOwn(getTask(f.ctx, task.id).verification, 'outcomeEvidenceId'), false);
    assert.equal((await readonly(f,
      ['methodology', 'check', task.id, '--to', 'ACCEPT'])).allowed, false);
    task = await advance(f, task, 'ACCEPT', {
      verification: { ...declared, outcomeEvidenceId: report.id },
      review: fresh(task),
    });
    assert.equal(task.state, 'ACCEPT');
    assert.equal(task.revision, 5);
    assert.deepEqual(task.history.map((h) => h.state ?? h.to),
      ['PLAN', 'ACT', 'VERIFY', 'EVALUATE', 'REVIEW', 'ACCEPT']);
    assert.equal(task.verification.outcomeEvidenceId, report.id);
  } finally { cleanup(f.dir); }
});

test('methodology query errors are read-only and fail at intended seams', async () => {
  const f = fixture();
  try {
    const task = (await create(f, 'task', { ...baseTask(), methodology: assessment() })).task;
    assert.equal((await readonly(f, ['methodology', 'check', task.id])).allowed, true);
    for (const [args, code] of [
      [[task.id, '--to', 'VERIFY'], 'INVALID_STATE'],
      [[task.id, '--outcome-evidence', MISSING], 'INVALID_ARGS'],
      [[task.id, '--to', 'ACCEPT', '--outcome-evidence', '../bad'], 'INVALID_ARGS'],
      [[MISSING], 'TASK_NOT_FOUND'],
      [['../escape'], 'INVALID_ID'],
      [[task.id, '--input', 'ignored'], 'INVALID_ARGS'],
    ]) {
      assert.equal((await readonly(f, ['methodology', 'check', ...args], 1)).code, code);
    }
  } finally { cleanup(f.dir); }
});

test('bounded input helper handles malformed/oversized files and cwd-relative paths without writes', async () => {
  const f = fixture();
  try {
    const malformed = writeFile(f.dir, '.inputs/malformed.json', '{broken');
    const oversized = writeFile(f.dir, '.inputs/oversized.json',
      ' '.repeat(loadLimits().maxDocumentBytes + 1));
    for (const [family, sub] of [
      ['task', 'create'], ['specification', 'create'], ['design', 'create'],
      ['outcome', 'create'], ['approval', 'target'], ['approval', 'create'], ['approval', 'answer'],
    ]) {
      for (const [file, code] of [[malformed, 'MALFORMED_JSON'], [oversized, 'INPUT_TOO_LARGE']]) {
        assert.equal((await readonly(f, [family, sub, '--input', file], 1)).code, code);
      }
    }
    const file = input(f, { ...baseTask(), methodology: assessment() });
    const cwdRelative = path.relative(process.cwd(), file);
    const preview = await readonly(f, ['task', 'create', '--input', cwdRelative]);
    assert.equal(preview.task.title, baseTask().title);
    const directory = path.dirname(file);
    assert.equal((await readonly(f,
      ['specification', 'create', '--input', directory], 1)).code, 'READ_FAILED');
  } finally { cleanup(f.dir); }
});

test('non-object, unknown keys, unsafe paths and caller hashes never become writes', async () => {
  const f = fixture('sdd');
  try {
    const { spec, design } = await structuredPair(f);
    const taskDTO = { ...baseTask(), specId: spec.id, designId: design.id };
    const task = (await create(f, 'task', taskDTO)).task;
    await approve(f, 'spec', spec.id);
    await approve(f, 'design', design.id);
    await approve(f, 'task', task.id);
    let current = await advance(f, task, 'ACT');
    current = await advance(f, current, 'VERIFY', { verification: verification(['S1', 'S2']) });
    current = await advance(f, current, 'EVALUATE', { review: fresh(current) });
    current = await advance(f, current, 'REVIEW');
    const desc = await target(f, 'spec', spec.id);
    const a = getApproval(f.ctx, desc.target.digest);
    const unapproved = (await create(f, 'specification', specInput())).artifact;
    const createDesc = await target(f, 'spec', unapproved.id);
    const validCases = [
      ['task', 'create', taskDTO, 'INVALID_VALUE', 'UNKNOWN_KEY'],
      ['specification', 'create', specInput(), 'INVALID_ARTIFACT', 'UNKNOWN_KEY'],
      ['design', 'create', { specId: spec.id, title: 'D', body: 'B' }, 'INVALID_ARTIFACT', 'UNKNOWN_KEY'],
      ['outcome', 'create', { taskId: current.id, title: 'R', body: 'B' }, 'OUTCOME_INVALID', 'UNKNOWN_KEY'],
      ['approval', 'target', { kind: 'artifact', artifactKind: 'spec', id: spec.id }, 'APPROVAL_INVALID', 'APPROVAL_INVALID'],
      ['approval', 'create', { target: createDesc.target }, 'APPROVAL_INVALID', 'APPROVAL_INVALID'],
      ['approval', 'answer', answerDTO(a), 'APPROVAL_INVALID', 'APPROVAL_INVALID'],
    ];
    for (const [family, sub, dto, nonObjectCode, unknownCode] of validCases) {
      // Validate the actual DTO first, so negative assertions are not masked
      // by an invalid baseline. Creation previews need not persist anything.
      await readonly(f, [family, sub, '--input', input(f, dto)]);
      for (const value of [null, [], 'not-an-object']) {
        const file = input(f, value);
        assert.equal((await readonly(f, [family, sub, '--input', file], 1)).code, nonObjectCode);
      }
      const file = input(f, { ...dto, injected: true });
      assert.equal((await readonly(f, [family, sub, '--input', file], 1)).code, unknownCode);
    }
    for (const [family, value, code] of [
      ['task', { ...taskDTO, scope: ['../escape'] }, 'INVALID_PATH'],
      ['specification', { ...specInput(), scope: ['../escape'] }, 'INVALID_PATH'],
      ['design', { specId: spec.id, title: 'D', body: 'B', specDigest: '0'.repeat(64) }, 'UNKNOWN_KEY'],
      ['outcome', { taskId: current.id, title: 'R', body: 'B', taskDigest: '0'.repeat(64) }, 'UNKNOWN_KEY'],
    ]) {
      const file = input(f, value);
      assert.equal((await readonly(f, [family, 'create', '--input', file, '--apply'], 1)).code, code);
    }
  } finally { cleanup(f.dir); }
});
