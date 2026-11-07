// CLI surface for catalog/workflow/plan/artifact/session groups, the 13
// workflow aliases, session record validation and versioning prompts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { run } from '../src/cli.mjs';
import { createConfig } from '../src/core/config.mjs';
import { createTask } from '../src/core/tasks.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import { applyPlan, prepareInit, preflightPlan } from '../src/core/bootstrap.mjs';
import { prepareSession } from '../src/core/sessions.mjs';
import {
  ALL_VERSIONING_FALSE, DEFAULT_ANSWERS, VALID_ANSWERS,
  cleanup, exists, fakeIO, makeTempDir, writeJson,
} from './helpers.mjs';

const lastJson = (io) => JSON.parse(io.out.stdout[io.out.stdout.length - 1]);
const errCode = (io) => JSON.parse(io.out.stderr[0]).error.code;

function bootstrapped() {
  const dir = makeTempDir('cliw');
  applyPlan(dir, prepareInit({ projectRoot: dir, answers: VALID_ANSWERS }).files);
  return dir;
}

test('catalog list/show/check/legacy resolve through grouped dispatch', async () => {
  let io = fakeIO();
  assert.equal(await run(['catalog', 'list'], io), 0);
  assert.ok(lastJson(io).entries.length >= 90);
  io = fakeIO();
  assert.equal(await run(['catalog', 'list', 'command'], io), 0);
  assert.ok(lastJson(io).entries.every((e) => e.kind === 'command'));
  io = fakeIO();
  assert.equal(await run(['catalog', 'show', 'command', 'pipeline'], io), 0);
  assert.equal(lastJson(io).id, 'pipeline');
  io = fakeIO();
  assert.equal(await run(['catalog', 'check'], io), 0);
  assert.equal(lastJson(io).ok, true);
  io = fakeIO();
  assert.equal(await run(['catalog', 'legacy'], io), 0);
  const ledger = lastJson(io);
  assert.ok(ledger.entries.length > 0);
  assert.ok(ledger.entries.every((e) => e.originalActivation === 'blocked'));
  io = fakeIO();
  assert.equal(await run(['catalog', 'legacy', 'command'], io), 0);
  assert.equal(await run(['catalog', 'bogus', 'x'], fakeIO()), 1);
  const l1 = fakeIO();
  assert.equal(await run(['catalog', 'legacy', 'notakind'], l1), 1);
  assert.equal(errCode(l1), 'CATALOG_UNKNOWN_KIND');
  const l2 = fakeIO();
  assert.equal(await run(['catalog', 'legacy-show', 'skill', 'nope'], l2), 1);
  assert.equal(errCode(l2), 'CATALOG_UNKNOWN_ID');
});

test('all 13 catalog command ids dispatch as workflow aliases', async () => {
  const dir = bootstrapped();
  try {
    for (const name of [
      'pipeline', 'spec', 'backlog', 'status', 'audit', 'harness',
      'research', 'ship', 'rollback', 'code-simplify', 'codeGraph',
      'cleanCA', 'webperf',
    ]) {
      const io = fakeIO();
      assert.equal(await run([name, '--project', dir], io), 0,
        `alias ${name}`);
      assert.equal(lastJson(io).command.id, name);
    }
    const io = fakeIO();
    assert.equal(await run(['pipeline', '--project', dir, '--mode', 'task'], io), 0);
    assert.equal(lastJson(io).command.mode, 'task');
    const bad = fakeIO();
    assert.equal(await run(['pipeline', '--project', dir, '--mode', 'nope'], bad), 1);
    assert.equal(errCode(bad), 'INVALID_MODE');
    const extra = fakeIO();
    assert.equal(await run(['pipeline', '--project', dir, 'extra'], extra), 1);
    assert.equal(errCode(extra), 'INVALID_ARGS');
  } finally { cleanup(dir); }
});

test('plan create/list/show/next through CLI with dry-run default', async () => {
  const dir = bootstrapped();
  const input = `${dir}-plan.json`;
  try {
    fs.writeFileSync(input, JSON.stringify({
      key: 'p1', title: 'Plan', authorContext: 'ctx',
      tasks: [{ key: 'a', title: 'A', contract: 'c', dependsOn: [] }],
    }));
    let io = fakeIO();
    assert.equal(await run(
      ['plan', 'create', '--project', dir, '--input', input], io), 0);
    assert.equal(lastJson(io).mode, 'dry-run');
    assert.ok(!exists(dir, 'docs/agent/plans'));
    io = fakeIO();
    assert.equal(await run(
      ['plan', 'create', '--project', dir, '--input', input, '--apply'], io), 0);
    assert.equal(lastJson(io).mode, 'applied');
    io = fakeIO();
    assert.equal(await run(['plan', 'list', '--project', dir], io), 0);
    assert.equal(lastJson(io).plans.length, 1);
    io = fakeIO();
    assert.equal(await run(['plan', 'show', '--project', dir, 'p1'], io), 0);
    assert.equal(lastJson(io).key, 'p1');
    io = fakeIO();
    assert.equal(await run(['plan', 'next', '--project', dir, 'p1'], io), 0);
    assert.equal(lastJson(io).tasks[0].status, 'ready');
  } finally { cleanup(dir); cleanup(input); }
});

test('artifact add/list/show through CLI with write opt-in', async () => {
  const dir = bootstrapped();
  const input = `${dir}-art.json`;
  try {
    fs.writeFileSync(input, JSON.stringify({
      title: 'R', body: 'B', references: ['src/x'],
    }));
    let io = fakeIO();
    assert.equal(await run(
      ['artifact', 'add', 'report', '--project', dir, '--input', input], io), 0);
    assert.ok(!exists(dir, 'docs/agent/reports'));
    io = fakeIO();
    assert.equal(await run(
      ['artifact', 'add', 'report', '--project', dir, '--input', input, '--apply'], io), 0);
    const id = lastJson(io).artifact.id;
    io = fakeIO();
    assert.equal(await run(['artifact', 'list', 'report', '--project', dir], io), 0);
    assert.equal(lastJson(io).artifacts.length, 1);
    io = fakeIO();
    assert.equal(await run(['artifact', 'show', 'report', id, '--project', dir], io), 0);
    assert.equal(lastJson(io).id, id);
    const bad = fakeIO();
    assert.equal(await run(['artifact', 'add', 'constructor', '--project', dir, '--input', input, '--apply'], bad), 1);
    assert.equal(errCode(bad), 'INVALID_KIND');
  } finally { cleanup(dir); cleanup(input); }
});

test('session create/record/resume: policy + dry-run validation + decimal', async () => {
  const dir = bootstrapped();
  const ev = `${dir}-ev.json`;
  try {
    const ctx = (await import('../src/core/context.mjs'))
      .resolveContext({ project: dir });
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: [],
    });
    let io = fakeIO();
    assert.equal(await run(['session', 'create', '--project', dir,
      '--task', task.id, '--limit', '2'], io), 0);
    assert.equal(lastJson(io).mode, 'dry-run');
    io = fakeIO();
    assert.equal(await run(['session', 'create', '--project', dir,
      '--task', task.id, '--limit', '2', '--apply'], io), 0);
    const sid = lastJson(io).session.id;
    fs.writeFileSync(ev, JSON.stringify({ action: 'read', evidence: 'x' }));
    // Dry-run record validates current state (revision/policy/budget).
    io = fakeIO();
    assert.equal(await run(['session', 'record', sid, '--project', dir,
      '--revision', '0', '--input', ev], io), 0);
    assert.equal(lastJson(io).mode, 'dry-run');
    const stale = fakeIO();
    assert.equal(await run(['session', 'record', sid, '--project', dir,
      '--revision', '7', '--input', ev], stale), 1);
    assert.equal(errCode(stale), 'REVISION_MISMATCH');
    fs.writeFileSync(ev, JSON.stringify({ action: 'edit', evidence: 'x', bogus: 1 }));
    const unk = fakeIO();
    assert.equal(await run(['session', 'record', sid, '--project', dir,
      '--revision', '0', '--input', ev], unk), 1);
    assert.equal(errCode(unk), 'UNKNOWN_KEY');
    fs.writeFileSync(ev, JSON.stringify({ action: 'edit', evidence: 'x' }));
    const denied = fakeIO();
    assert.equal(await run(['session', 'record', sid, '--project', dir,
      '--revision', '0', '--input', ev], denied), 1);
    assert.equal(errCode(denied), 'SESSION_ACTION_DENIED');
    fs.writeFileSync(ev, JSON.stringify({ action: 'read', evidence: 'x' }));
    io = fakeIO();
    assert.equal(await run(['session', 'record', sid, '--project', dir,
      '--revision', '0', '--input', ev, '--apply'], io), 0);
    assert.equal(lastJson(io).used, 1);
    io = fakeIO();
    assert.equal(await run(['session', 'resume', sid, '--project', dir], io), 0);
    assert.equal(lastJson(io).usage.remaining, 1);
    // Non-decimal ints rejected.
    const hex = fakeIO();
    assert.equal(await run(['session', 'record', sid, '--project', dir,
      '--revision', '0x10', '--input', ev, '--apply'], hex), 1);
    assert.equal(errCode(hex), 'INVALID_ARGS');
  } finally { cleanup(dir); cleanup(ev); }
});

test('interactive versioning asks each category and rejects bad replies', async () => {
  const dir = makeTempDir('cliw-io');
  try {
    const replies = { 'Versionar plans? (yes/no)': 'yes' };
    const io = fakeIO({ tty: true, replies });
    // Simulate 'maybe' then 'yes' for the plans question via custom ask.
    let plansAsked = 0;
    const origAsk = io.ask;
    io.ask = async (label, def) => {
      if (label === 'Versionar plans? (yes/no)') {
        plansAsked += 1;
        return plansAsked === 1 ? 'maybe' : 'yes';
      }
      if (label === 'Crear estos archivos? (yes/no)') return 'no';
      return origAsk(label, def);
    };
    const code = await run(['init', '--project', dir], io);
    assert.equal(code, 0);
    assert.equal(plansAsked, 2); // invalid reply re-asked, then accepted
    assert.ok(io.out.stderr.some((s) => s.includes('yes o no')));
    assert.ok(!exists(dir, '.tasksystem/config.json')); // 'no' confirm
  } finally { cleanup(dir); }
});
