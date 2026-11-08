// Approval ledger contract: digest-bound targets, statuses, scope, history
// invariants, CAS answers, spec openQuestions, locks, drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyPlan } from '../src/core/bootstrap.mjs';
import { createTask, getTask } from '../src/core/tasks.mjs';
import { preparePlan } from '../src/core/plans.mjs';
import { transitionTask } from '../src/core/transition.mjs';
import { loadLimits } from '../src/core/policy.mjs';
import { prepareSpecification } from '../src/core/specifications.mjs';
import {
  answerApproval, describeApprovalTarget, getApproval,
  prepareApproval, prepareApprovalAnswer,
} from '../src/core/approvals.mjs';
import { bootstrappedCtx, cleanup, writeJson } from './helpers.mjs';

const SPEC = {
  originalRequest: 'verbatim request for approvals tests',
  title: 'Spec',
  outcome: { statement: 'o', evidencePlan: 'e' },
  requirements: [{ id: 'R1', statement: 's',
    scenarios: [{ id: 'S1', given: 'g', when: 'w', then: 't' }] }],
  scope: ['src/x'], openQuestions: [],
};

function makeSpec(ctx, dir, over = {}) {
  const p = prepareSpecification(ctx, { ...SPEC, ...over });
  applyPlan(dir, [p.file]);
  return p.artifact;
}

function targetOf(ctx, kind, artifactKind, id) {
  return describeApprovalTarget(ctx,
    kind === 'artifact' ? { kind, artifactKind, id } : { kind, id });
}

function makeApproval(ctx, dir, kind, artifactKind, id) {
  const { target } = targetOf(ctx, kind, artifactKind, id);
  const p = prepareApproval(ctx, { target });
  const abs = `${dir}/.tasksystem/decisions/approvals/${p.approval.id}.json`;
  if (fs.existsSync(abs)) return getApproval(ctx, p.approval.id);
  applyPlan(dir, [p.file]);
  return p.approval;
}

function answer(id, rev, digest, extra = {}) {
  return { id, answer: 'approve', expectedRevision: rev,
    expectedTargetDigest: digest, actor: 'tester', ...extra };
}

function absOf(dir, approvalId) {
  return `${dir}/.tasksystem/decisions/approvals/${approvalId}.json`;
}

test('prepare: pending, id=digest, locale question, scope from spec', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    assert.equal(a.status, 'pending');
    assert.equal(a.id.length, 64);
    assert.equal(a.id, a.target.digest);
    assert.equal(a.history.length, 1);
    assert.equal(a.history[0].event, 'created');
    assert.deepEqual(a.scope.paths, ['src/x']);
    assert.deepEqual(a.scope.effects,
      ['permit-next-harness-gate-for-bound-content']);
    const stored = getApproval(ctx, a.id);
    assert.equal(stored.id, a.id);
    assert.equal(stored.target.digest, a.target.digest);
  } finally { cleanup(dir); }
});

test('target input boundary: null/extra/malformed rejected before lookup', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const { target } = targetOf(ctx, 'artifact', 'spec', spec.id);
    assert.throws(() => prepareApproval(ctx, { target: null }),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => prepareApproval(ctx, {}),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => prepareApproval(ctx,
      { target: { ...target, extra: 1 } }),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => describeApprovalTarget(ctx,
      { kind: 'task', artifactKind: 'spec',
        id: spec.id }), (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => prepareApproval(ctx,
      { target: { kind: 'bogus', id: spec.id, digest: target.digest } }),
      (e) => e.code === 'APPROVAL_INVALID');
    // Stored target is the canonical descriptor, never the raw input;
    // a case-different digest is stale.
    assert.throws(() => prepareApproval(ctx,
      { target: { ...target, digest: target.digest.toUpperCase() } }),
      (e) => e.code === 'APPROVAL_INVALID'
        || e.code === 'APPROVAL_STALE_TARGET');
  } finally { cleanup(dir); }
});

test('answers map to statuses; only approve grants approved', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    let n = 0;
    for (const [ans, want] of [
      ['reject', 'rejected'], ['decline', 'declined'],
      ['custom', 'needs-clarification'], ['approve', 'approved']]) {
      n += 1;
      const spec = makeSpec(ctx, dir, { title: `Spec-${n}` });
      const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
      const next = answerApproval(ctx, answer(a.id, a.revision,
        a.target.digest, { answer: ans, comment: 'c' }));
      assert.equal(next.status, want, ans);
      if (ans !== 'approve') assert.notEqual(next.status, 'approved');
    }
  } finally { cleanup(dir); }
});

test('spec openQuestions blocks approve only', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir, { openQuestions: ['open q'] });
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    assert.throws(() => answerApproval(ctx, answer(a.id, 0, a.target.digest)),
      (e) => e.code === 'APPROVAL_OPEN_QUESTIONS');
    const rej = answerApproval(ctx, answer(a.id, 0, a.target.digest,
      { answer: 'reject', comment: 'no' }));
    assert.equal(rej.status, 'rejected');
  } finally { cleanup(dir); }
});

test('reaffirm requires comment; revoke only from approved', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    answerApproval(ctx, answer(a.id, a.revision, a.target.digest));
    // Re-answer an approved record without comment -> rejected.
    assert.throws(() => answerApproval(ctx, answer(a.id,
      getApproval(ctx, a.id).revision,
      a.target.digest, { answer: 'reject' })),
      (e) => e.code === 'APPROVAL_INVALID');
    const re = answerApproval(ctx, answer(a.id,
      getApproval(ctx, a.id).revision, a.target.digest,
      { answer: 'custom', comment: 'reconsider' }));
    assert.equal(re.status, 'needs-clarification');
    assert.throws(() => answerApproval(ctx, answer(a.id,
      getApproval(ctx, a.id).revision,
      a.target.digest, { answer: 'revoke', comment: 'x' })),
      (e) => e.code === 'APPROVAL_INVALID');
    const a2 = makeApproval(ctx, dir, 'artifact', 'spec',
      makeSpec(ctx, dir, { title: 'fresh' }).id);
    assert.throws(() => answerApproval(ctx, answer(a2.id, 0,
      a2.target.digest, { answer: 'revoke' })),
      (e) => e.code === 'APPROVAL_INVALID');
  } finally { cleanup(dir); }
});

test('revoke from approved succeeds and records actor/comment', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    answerApproval(ctx, answer(a.id, a.revision, a.target.digest));
    const rev = answerApproval(ctx, answer(a.id,
      getApproval(ctx, a.id).revision, a.target.digest,
      { answer: 'revoke', comment: 'superseded' }));
    assert.equal(rev.status, 'revoked');
    assert.equal(rev.history.at(-1).actor, 'tester');
    assert.equal(rev.history.at(-1).comment, 'superseded');
  } finally { cleanup(dir); }
});

test('answer input basics: actor required, unknown keys, bad ids', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const rel = absOf(dir, a.id);
    const before = fs.readFileSync(rel);
    assert.throws(() => answerApproval(ctx,
      answer(a.id, 0, a.target.digest, { actor: null })),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => answerApproval(ctx,
      answer(a.id, 0, a.target.digest, { actor: '  ' })),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => answerApproval(ctx,
      answer(a.id, 0, a.target.digest, { actor: undefined })),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => answerApproval(ctx,
      answer(a.id, 0, a.target.digest, { bogus: 1 })),
      (e) => e.code === 'APPROVAL_INVALID');
    assert.throws(() => answerApproval(ctx,
      answer('z'.repeat(64), 0, a.target.digest)),
      (e) => e.code === 'APPROVAL_INVALID'
        || e.code === 'APPROVAL_NOT_FOUND');
    assert.ok(fs.readFileSync(rel).equals(before)); // zero writes on bad input
  } finally { cleanup(dir); }
});

test('stale revision/digest fail before any write', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const rel = absOf(dir, a.id);
    const before = fs.readFileSync(rel);
    assert.throws(() => answerApproval(ctx, answer(a.id, 5, a.target.digest)),
      (e) => e.code === 'REVISION_MISMATCH');
    assert.throws(() => answerApproval(ctx, answer(a.id, 0,
      'f'.repeat(64))), (e) => e.code === 'APPROVAL_STALE_TARGET');
    assert.ok(fs.readFileSync(rel).equals(before));
    const specStored = JSON.parse(fs.readFileSync(
      `${dir}/.tasksystem/plans/specs/${spec.id}.json`, 'utf8'));
    specStored.references = ['docs/x.md'];
    writeJson(dir, `.tasksystem/plans/specs/${spec.id}.json`, specStored);
    assert.throws(() => answerApproval(ctx, answer(a.id, 0, a.target.digest)),
      (e) => e.code === 'APPROVAL_STALE_TARGET'
        || e.code === 'APPROVAL_MALFORMED');
  } finally { cleanup(dir); }
});

test('malformed shape: id!=digest, scope/options/history tamper', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const rel = `.tasksystem/decisions/approvals/${a.id}.json`;
    const good = JSON.parse(fs.readFileSync(`${dir}/${rel}`, 'utf8'));
    const mutate = (fn) => {
      const m = JSON.parse(JSON.stringify(good));
      fn(m);
      writeJson(dir, rel, m);
      assert.throws(() => getApproval(ctx, a.id),
        (e) => e.code === 'APPROVAL_MALFORMED');
    };
    mutate((m) => { m.id = 'a'.repeat(64); }); // id != target.digest
    mutate((m) => { m.scope.extra = 1; });
    mutate((m) => { m.scope.paths = ['../escape']; });
    mutate((m) => { m.options = [m.options[0], m.options[0]]; });
    mutate((m) => { m.options[0].label = '  '; });
    mutate((m) => { m.history.push({ ...m.history[0] }); });
    mutate((m) => {
      m.history.push({ at: '2999-01-01T00:00:00.000Z', event: 'answered',
        revision: 1, status: 'approved', actor: null, answer: 'approve',
        comment: null });
      m.revision = 1;
      m.updatedAt = '2999-01-01T00:00:00.000Z';
      m.status = 'approved';
    }); // actor null on answered -> malformed
    writeJson(dir, rel, good); // restore
    assert.equal(getApproval(ctx, a.id).status, 'pending');
  } finally { cleanup(dir); }
});

test('malformed history and back-clock fail; bytes preserved', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const rel = `.tasksystem/decisions/approvals/${a.id}.json`;
    const future = { ...a, createdAt: '2999-01-01T00:00:00.000Z',
      updatedAt: '2999-01-01T00:00:00.000Z',
      history: [{ ...a.history[0], at: '2999-01-01T00:00:00.000Z' }] };
    fs.writeFileSync(`${dir}/${rel}`, JSON.stringify(future, null, 2) + '\n');
    assert.throws(() => answerApproval(ctx, answer(a.id, 0, a.target.digest)),
      (e) => e.code === 'APPROVAL_CLOCK_REGRESSION');
    assert.ok(fs.readFileSync(`${dir}/${rel}`).equals(
      Buffer.from(JSON.stringify(future, null, 2) + '\n')));
  } finally { cleanup(dir); }
});

test('preview answer is read-only; file carries rel; no writes', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const abs = absOf(dir, a.id);
    const before = fs.readFileSync(abs);
    const { previous, next, file } = prepareApprovalAnswer(ctx,
      answer(a.id, 0, a.target.digest));
    assert.equal(previous.status, 'pending');
    assert.equal(next.status, 'approved');
    assert.equal(file.rel,
      `.tasksystem/decisions/approvals/${a.id}.json`);
    assert.equal(file.abs,
      path.resolve(dir, '.tasksystem/decisions/approvals',
        `${a.id}.json`));
    assert.ok(file.content.includes('"approved"'));
    assert.ok(fs.readFileSync(abs).equals(before)); // nothing written
    assert.equal(fs.existsSync(`${abs}.lock`), false);
  } finally { cleanup(dir); }
});

test('foreign lock sentinel blocks and is preserved; own tmp cleaned', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const abs = absOf(dir, a.id);
    fs.writeFileSync(`${abs}.lock`, 'foreign');
    const origBytes = fs.readFileSync(`${abs}.lock`);
    assert.throws(() => answerApproval(ctx, answer(a.id, 0, a.target.digest)),
      (e) => e.code === 'APPROVAL_LOCKED');
    assert.ok(fs.readFileSync(`${abs}.lock`).equals(origBytes));
    fs.rmSync(`${abs}.lock`);
    // Deterministic tmp collision: pre-create the exact tmp name -> the
    // write must not overwrite it, and the sentinel survives.
    const coll = `${abs}.tmp-collide`;
    fs.writeFileSync(coll, 'sentinel');
    // writeFileExclusive opens wx — intercept openSync for .tmp- paths.
    const origOpen = fs.openSync;
    fs.openSync = function (p, flags, mode) {
      if (String(p).includes('.tmp-')) {
        throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      }
      return origOpen.call(fs, p, flags, mode);
    };
    try {
      assert.throws(() => answerApproval(ctx,
        answer(a.id, 0, a.target.digest)), (e) => e.code !== 'OK');
    } finally { fs.openSync = origOpen; }
    assert.equal(fs.readFileSync(coll, 'utf8'), 'sentinel');
    fs.rmSync(coll);
    assert.equal(fs.readdirSync(path.dirname(abs))
      .filter((n) => n.includes('.tmp-')).length, 0);
  } finally { cleanup(dir); }
});

test('corrupt prompts surface TaskError, never TypeError or poisoned cache', async () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const { target } = targetOf(ctx, 'artifact', 'spec', spec.id);
    const source = fs.readFileSync(new URL(
      '../templates/approval-prompts.json', import.meta.url), 'utf8');
    for (const name of ['ENOENT', 'oversize', 'malformed-json',
      'empty-object', 'bad-options', 'missing-locale', 'extra-locale']) {
      const mod = await import(`../src/core/approvals.mjs?lead-case=${name}`);
      const originals = {
        open: fs.openSync, stat: fs.fstatSync,
        close: fs.closeSync, parse: JSON.parse,
      };
      const promptFds = new Set();
      fs.openSync = (p, flags, mode) => {
        const prompt = String(p).endsWith('approval-prompts.json');
        if (prompt && name === 'ENOENT') {
          throw Object.assign(new Error('missing template'), { code: 'ENOENT' });
        }
        const fd = originals.open.call(fs, p, flags, mode);
        if (prompt) promptFds.add(fd);
        return fd;
      };
      fs.fstatSync = (fd) => {
        const st = originals.stat.call(fs, fd);
        return promptFds.has(fd) && name === 'oversize'
          ? { ...st, size: loadLimits().maxDocumentBytes + 1 } : st;
      };
      fs.closeSync = (fd) => {
        promptFds.delete(fd);
        return originals.close.call(fs, fd);
      };
      JSON.parse = (text, reviver) => {
        // Never corrupt specification/policy parsing before the loader runs.
        if (text !== source) return originals.parse(text, reviver);
        if (name === 'malformed-json') throw new SyntaxError('bad template');
        if (name === 'empty-object') return {};
        const value = originals.parse(text, reviver);
        if (name === 'bad-options') value.en.options = null;
        if (name === 'missing-locale') delete value.es;
        if (name === 'extra-locale') value.fr = value.en;
        return value;
      };
      try {
        assert.throws(() => mod.prepareApproval(ctx, { target }),
          (e) => e.name === 'TaskError' && e.code === 'APPROVAL_MALFORMED'
            && e.message.includes('approval-prompts.json'), name);
      } finally {
        fs.openSync = originals.open;
        fs.fstatSync = originals.stat;
        fs.closeSync = originals.close;
        JSON.parse = originals.parse;
      }
      // Failed validation must not cache the malformed template.
      const prepared = mod.prepareApproval(ctx, { target });
      assert.equal(prepared.approval.status, 'pending');
      assert.equal(prepared.approval.question, JSON.parse(source).es.question
        .replace('{kind}', 'spec').replace('{id}', spec.id)
        .replace('{digest}', target.digest));
    }
  } finally { cleanup(dir); }
});

test('zero filesystem writes on invalid input; NOT_FOUND before lock', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const wx = [];
    const origOpen = fs.openSync;
    fs.openSync = function (p, flags, mode) {
      if (flags === 'wx') wx.push(String(p));
      return origOpen.call(fs, p, flags, mode);
    };
    try {
      assert.throws(() => answerApproval(ctx,
        answer(a.id, 0, a.target.digest, { actor: null })),
        (e) => e.code === 'APPROVAL_INVALID');
      assert.throws(() => answerApproval(ctx,
        answer('a'.repeat(64), 0, 'a'.repeat(64))),
        (e) => e.code === 'APPROVAL_NOT_FOUND');
      assert.equal(wx.length, 0,
        `no wx opens expected, got ${JSON.stringify(wx)}`);
    } finally { fs.openSync = origOpen; }
  } finally { cleanup(dir); }
});

test('deterministic tmp sentinel preserved; mid-write EIO keeps bytes', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const abs = absOf(dir, a.id);
    const origBytes = fs.readFileSync(abs);
    const origRand = crypto.randomBytes;
    crypto.randomBytes = () => Buffer.from('00112233', 'hex');
    const tmpPath = `${abs}.tmp-${process.pid}-00112233`;
    try {
      fs.writeFileSync(tmpPath, 'sentinel');
      assert.throws(() => answerApproval(ctx,
        answer(a.id, 0, a.target.digest)), (e) => e.code !== 'OK');
      assert.equal(fs.readFileSync(tmpPath, 'utf8'), 'sentinel');
      assert.ok(fs.readFileSync(abs).equals(origBytes));
      assert.equal(fs.existsSync(`${abs}.lock`), false);
      fs.rmSync(tmpPath);
      // Mid-write EIO: first writeSync returns 1, second throws.
      const origWriteSync = fs.writeSync;
      let calls = 0;
      fs.writeSync = function (...args) {
        calls += 1;
        if (calls === 1) {
          return origWriteSync.call(fs, ...args.slice(0, 3), 1);
        }
        throw Object.assign(new Error('EIO'), { code: 'EIO' });
      };
      try {
        assert.throws(() => answerApproval(ctx,
          answer(a.id, 0, a.target.digest)), (e) => e.code !== 'OK');
      } finally { fs.writeSync = origWriteSync; }
      assert.ok(fs.readFileSync(abs).equals(origBytes));
      assert.equal(fs.existsSync(`${abs}.lock`), false);
      assert.equal(fs.existsSync(tmpPath), false); // own tmp cleaned
      // A clean answer still works after restores.
      const ok = answerApproval(ctx, answer(a.id, 0, a.target.digest));
      assert.equal(ok.status, 'approved');
    } finally { crypto.randomBytes = origRand; }
  } finally { cleanup(dir); }
});

test('lock close-fail: owned fd guarded, record bytes unchanged', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const abs = absOf(dir, a.id);
    const origBytes = fs.readFileSync(abs);
    const origOpen = fs.openSync;
    const origClose = fs.closeSync;
    let lockFd = null;
    let hit = false;
    fs.openSync = function (file, flags, mode) {
      const fd = origOpen.call(fs, file, flags, mode);
      if (path.resolve(String(file)) === path.resolve(`${abs}.lock`)
          && flags === 'wx') lockFd = fd;
      return fd;
    };
    fs.closeSync = function (fd) {
      if (fd === lockFd && !hit) {
        hit = true;
        origClose.call(fs, fd);
        throw Object.assign(new Error('lock close EIO'), { code: 'EIO' });
      }
      return origClose.call(fs, fd);
    };
    try {
      assert.throws(() => answerApproval(ctx,
        answer(a.id, 0, a.target.digest)), (e) => e.code === 'EIO');
    } finally {
      fs.openSync = origOpen;
      fs.closeSync = origClose;
    }
    assert.equal(hit, true, 'failure must occur closing the acquired lock');
    assert.ok(fs.readFileSync(abs).equals(origBytes));
    assert.equal(fs.existsSync(`${abs}.lock`), false);
  } finally { cleanup(dir); }
});

test('extended-ISO-year history compares numerically (not lexically)', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const spec = makeSpec(ctx, dir);
    const a = makeApproval(ctx, dir, 'artifact', 'spec', spec.id);
    const rel = `.tasksystem/decisions/approvals/${a.id}.json`;
    // '+010000' extended year parses finite; numeric compare still works.
    const future = { ...a,
      createdAt: '+010000-01-01T00:00:00.000Z',
      updatedAt: '+010000-01-01T00:00:00.000Z',
      history: [{ ...a.history[0], at: '+010000-01-01T00:00:00.000Z' }] };
    fs.writeFileSync(`${dir}/${rel}`,
      JSON.stringify(future, null, 2) + '\n');
    assert.throws(() => answerApproval(ctx, answer(a.id, 0, a.target.digest)),
      (e) => e.code === 'APPROVAL_CLOCK_REGRESSION'
        || e.code === 'APPROVAL_MALFORMED');
    assert.ok(fs.readFileSync(`${dir}/${rel}`).equals(
      Buffer.from(JSON.stringify(future, null, 2) + '\n')));
  } finally { cleanup(dir); }
});

test('task/plan digests: progress stable; scope/contract/deps change them', () => {
  const { dir, ctx } = bootstrappedCtx();
  try {
    const task = createTask(ctx, {
      title: 'T', contract: 'C', authorContext: 'a', scope: ['src/x'] });
    const before = targetOf(ctx, 'task', null, task.id);
    transitionTask(ctx, { id: task.id, to: 'ACT', expectedRevision: 0 });
    const after = targetOf(ctx, 'task', null, task.id);
    // Ordinary progress (state/revision/history) must NOT change the digest.
    assert.equal(before.target.digest, after.target.digest);
    // A contract/scope edit changes it (rewrite stored record, still valid).
    const taskFile = `${dir}/.tasksystem/tasks/${task.id}.json`;
    const stored = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    stored.scope = ['src/other'];
    stored.contract = 'different contract';
    fs.writeFileSync(taskFile, JSON.stringify(stored, null, 2) + '\n');
    assert.notEqual(targetOf(ctx, 'task', null, task.id).target.digest,
      before.target.digest);
    // Plan: dependency edit changes digest; normal task progress does not.
    const p = preparePlan(ctx, { key: 'p1', title: 'P', authorContext: 'a',
      tasks: [{ key: 't1', title: 'T', contract: 'C', scope: ['src/a'] },
        { key: 't2', title: 'U', contract: 'C', scope: ['src/b'],
          dependsOn: ['t1'] }] });
    applyPlan(dir, p.files);
    const d1 = targetOf(ctx, 'plan', null, 'p1').target.digest;
    const tid = p.plan.tasks.find((t) => t.key === 't1').id;
    transitionTask(ctx, { id: tid, to: 'ACT', expectedRevision: 0 });
    assert.equal(targetOf(ctx, 'plan', null, 'p1').target.digest, d1);
    const planFile = `${dir}/.tasksystem/plans/p1.json`;
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    plan.tasks.find((t) => t.key === 't2').dependsOn = [];
    fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + '\n');
    assert.notEqual(targetOf(ctx, 'plan', null, 'p1').target.digest, d1);
  } finally { cleanup(dir); }
});
