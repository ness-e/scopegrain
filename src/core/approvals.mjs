// Content-bound approval ledger: immutable append of answers against a
// digest-pinned target. Records intent only — actors and comments are
// declared, never authenticated. Effects are limited to the next gate.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { err } from './errors.mjs';
import {
  lstatOrNull, mkdirpSync, readFileLimited, removeIfExists,
  writeFileExclusive,
} from './fsx.mjs';
import { assertDestination, resolveInside } from './paths.mjs';
import { loadLimits } from './policy.mjs';
import { canonicalDigest, taskStaticProjection } from './digests.mjs';
import { getArtifact, isCanonicalTime } from './artifacts.mjs';
import { getTask } from './tasks.mjs';
import { getPlan } from './plans.mjs';
import { getSpecification } from './specifications.mjs';

const SHA_RE = /^[0-9a-f]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STATUSES = new Set([
  'pending', 'approved', 'rejected', 'declined', 'needs-clarification',
  'revoked',
]);
const ANSWER_STATUS = new Map([
  ['approve', 'approved'],
  ['reject', 'rejected'],
  ['decline', 'declined'],
  ['custom', 'needs-clarification'],
  ['revoke', 'revoked'],
]);
const ANSWERS = new Set(ANSWER_STATUS.keys());
const ARTIFACT_KINDS = new Set([
  'spec', 'design', 'research', 'report', 'review', 'decision', 'lesson',
  'handoff',
]);
const EFFECTS = ['permit-next-harness-gate-for-bound-content'];
const DESCRIBE_KEYS = new Set(['kind', 'artifactKind', 'id']);
const PREPARE_KEYS = new Set(['target']);
const ANSWER_KEYS = new Set([
  'id', 'answer', 'expectedRevision', 'expectedTargetDigest', 'actor',
  'comment',
]);
const APPROVAL_KEYS = new Set([
  'schemaVersion', 'id', 'revision', 'target', 'status', 'question',
  'notice', 'scope', 'options', 'createdAt', 'updatedAt', 'history',
]);

function closed(v, keys, label) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw err('APPROVAL_INVALID', `${label} must be an object`);
  }
  for (const k of Object.keys(v)) {
    if (!keys.has(k)) {
      throw err('APPROVAL_INVALID', `${label} has unknown key '${k}'`);
    }
  }
}

function dedupeScope(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out;
}

// Lazy bounded prompt loader: no import-time IO; the parsed document is
// shape-validated BEFORE caching so a corrupt template cannot produce
// TypeErrors or poison the cache.
let promptsCache = null;
function prompts(locale) {
  if (promptsCache === null) {
    let parsed;
    try {
      const p = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../templates/approval-prompts.json');
      const limited = readFileLimited(p, loadLimits().maxDocumentBytes);
      if (limited.exceeded) throw new Error('prompts exceed document limit');
      parsed = JSON.parse(limited.content.toString('utf8'));
    } catch (e) {
      throw err('APPROVAL_MALFORMED',
        `approval-prompts.json unavailable: ${e.message}`);
    }
    validatePrompts(parsed);
    promptsCache = parsed;
  }
  if (typeof locale !== 'string'
      || !promptsCache[locale] || !promptsCache[locale].question) {
    throw err('APPROVAL_INVALID',
      `no authored approval prompts for locale '${locale}'`);
  }
  const src = promptsCache[locale];
  return {
    question: src.question, notice: src.notice,
    options: src.options.map((o) => ({ ...o })),
  };
}

// Authored-template contract: schemaVersion 1, per-locale blocks with
// closed keys, question/notice nonempty, exactly approve/reject options,
// every placeholder used by the renderer present.
function validatePrompts(p) {
  const bad = (m) => err('APPROVAL_MALFORMED',
    `approval-prompts.json: ${m}`);
  if (p === null || typeof p !== 'object' || Array.isArray(p)
      || p.schemaVersion !== 1) {
    throw bad('root must be an object with schemaVersion 1');
  }
  if (Object.keys(p).length !== 3
      || !Object.hasOwn(p, 'en') || !Object.hasOwn(p, 'es')) {
    throw bad('root must contain exactly schemaVersion, en and es');
  }
  for (const loc of ['en', 'es']) {
    const b = p[loc];
    if (b === null || typeof b !== 'object' || Array.isArray(b)) {
      throw bad(`${loc} must be an object`);
    }
    for (const k of Object.keys(b)) {
      if (!['question', 'notice', 'options'].includes(k)) {
        throw bad(`${loc} has unknown key '${k}'`);
      }
    }
    if (typeof b.question !== 'string' || b.question.trim() === ''
        || !b.question.includes('{kind}')
        || !b.question.includes('{id}')
        || !b.question.includes('{digest}')
        || typeof b.notice !== 'string' || b.notice.trim() === ''
        || !Array.isArray(b.options) || b.options.length !== 2
        || b.options[0]?.id !== 'approve' || b.options[1]?.id !== 'reject'
        || !b.options.every((o) => o && typeof o === 'object'
          && Object.keys(o).length === 3
          && typeof o.label === 'string' && o.label.trim() !== ''
          && typeof o.description === 'string'
          && o.description.trim() !== '')) {
      throw bad(`${loc} question/notice/options shape invalid`);
    }
  }
}

// Scope derivation per contract: spec data.scope; design -> its spec scope;
// report V2 -> its task scope; task -> task scope; plan -> union; other
// artifacts -> references.
function artifactScope(ctx, a) {
  if (a.kind === 'spec' && a.data !== undefined) return a.data.scope;
  if (a.kind === 'design' && a.data !== undefined) {
    const spec = getSpecification(ctx, a.data.specId);
    return spec.data.scope;
  }
  if (a.kind === 'report' && a.data !== undefined) {
    const t = getTask(ctx, a.data.taskId);
    return dedupeScope(t.scope);
  }
  return a.references;
}

// Target description: fully validated current record + content digest.
// task/plan digests use the STATIC projection so ordinary progress cannot
// invalidate an answer; contract/scope/dependency edits change them.
export function describeApprovalTarget(ctx, input) {
  closed(input, DESCRIBE_KEYS, 'describeApprovalTarget input');
  const { kind, artifactKind, id } = input;
  if (kind === 'task' || kind === 'plan') {
    if (artifactKind !== undefined) {
      throw err('APPROVAL_INVALID',
        `artifactKind is not allowed for target kind '${kind}'`);
    }
  }
  if (kind === 'artifact') {
    if (!ARTIFACT_KINDS.has(artifactKind)) {
      throw err('APPROVAL_INVALID',
        `artifactKind '${artifactKind}' is not an approvable artifact`);
    }
    const a = getArtifact(ctx, artifactKind, id);
    const target = {
      kind: 'artifact', artifactKind, id: a.id,
      digest: canonicalDigest(a),
    };
    const scope = { paths: [...artifactScope(ctx, a)],
      effects: [...EFFECTS] };
    for (const p of scope.paths) {
      resolveInside(ctx.projectRoot, p, 'artifact approval scope');
    }
    return { target, scope };
  }
  if (kind === 'task') {
    const t = getTask(ctx, id);
    for (const p of t.scope) {
      resolveInside(ctx.projectRoot, p, 'task.scope');
    }
    return {
      target: { kind: 'task', id: t.id,
        digest: canonicalDigest(taskStaticProjection(t)) },
      scope: { paths: dedupeScope(t.scope), effects: [...EFFECTS] },
    };
  }
  if (kind === 'plan') {
    if (typeof id !== 'string' || !PLAN_KEY_RE.test(id)) {
      throw err('APPROVAL_INVALID', `invalid plan key '${id}'`);
    }
    const plan = getPlan(ctx, id);
    const tasks = plan.tasks.map((ref) => getTask(ctx, ref.id ?? ref));
    for (const t of tasks) {
      for (const p of t.scope) {
        resolveInside(ctx.projectRoot, p, 'plan.task.scope');
      }
    }
    const target = {
      kind: 'plan', id,
      digest: canonicalDigest({
        plan, tasks: tasks.map(taskStaticProjection),
      }),
    };
    const union = dedupeScope(tasks.flatMap((t) => t.scope));
    return { target, scope: { paths: union, effects: [...EFFECTS] } };
  }
  throw err('APPROVAL_INVALID', `unknown approval kind '${kind}'`);
}

// Closed-union target shape, validated BEFORE any record lookup.
function validateTargetInput(target) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    throw err('APPROVAL_INVALID', 'target must be an object');
  }
  const keys = Object.keys(target);
  if (target.kind === 'artifact') {
    if (keys.length !== 4
        || !ARTIFACT_KINDS.has(target.artifactKind)
        || !UUID_RE.test(target.id || '')
        || !SHA_RE.test(target.digest || '')) {
      throw err('APPROVAL_INVALID', 'target artifact shape invalid');
    }
  } else if (target.kind === 'task' || target.kind === 'plan') {
    const idOk = target.kind === 'task'
      ? UUID_RE.test(target.id || '')
      : PLAN_KEY_RE.test(target.id || '');
    if (keys.length !== 3 || !idOk || !SHA_RE.test(target.digest || '')) {
      throw err('APPROVAL_INVALID', `target ${target.kind} shape invalid`);
    }
  } else {
    throw err('APPROVAL_INVALID',
      `target kind '${target.kind}' is not approvable`);
  }
}

function approvalFile(ctx, digest) {
  const rel = `${ctx.config.paths.decisions}/approvals/${digest}.json`;
  return { rel, abs: resolveInside(ctx.projectRoot, rel, 'approval file') };
}

export function prepareApproval(ctx, input) {
  closed(input, PREPARE_KEYS, 'prepareApproval input');
  const { target } = input;
  validateTargetInput(target); // closed union BEFORE any lookup
  const desc = describeApprovalTarget(ctx, target.kind === 'artifact'
    ? { kind: 'artifact', artifactKind: target.artifactKind, id: target.id }
    : { kind: target.kind, id: target.id });
  if (desc.target.digest !== target.digest) {
    throw err('APPROVAL_STALE_TARGET',
      'target digest does not match the current record');
  }
  const { question, notice, options } = prompts(ctx.config.locale ?? 'en');
  const now = new Date().toISOString();
  const canonicalTarget = { ...desc.target }; // store canonical, not raw
  const approval = {
    schemaVersion: 1,
    id: canonicalTarget.digest.toLowerCase(),
    revision: 0,
    target: canonicalTarget,
    status: 'pending',
    question: question
      .replace('{kind}', canonicalTarget.kind === 'artifact'
        ? canonicalTarget.artifactKind : canonicalTarget.kind)
      .replace('{id}', canonicalTarget.id)
      .replace('{digest}', canonicalTarget.digest.toLowerCase()),
    notice,
    scope: { paths: [...desc.scope.paths], effects: [...EFFECTS] },
    options,
    createdAt: now,
    updatedAt: now,
    history: [{ at: now, event: 'created', revision: 0,
      status: 'pending', actor: null, answer: null, comment: null }],
  };
  validateApprovalShape(approval, 'prepared approval'); // self-check
  const { rel, abs } = approvalFile(ctx, approval.id);
  const content = JSON.stringify(approval, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', 'approval exceeds document limit');
  }
  return { approval, file: { rel, abs, content } };
}

// Full stored-record validation. Rules replay the input contract: answered
// events require a nonempty actor, custom/non-pending answers a
// nonempty comment, revoke only out of approved. Numeric time comparisons.
export function validateApprovalShape(a, label = 'approval') {
  try {
    closed(a, APPROVAL_KEYS, label);
  } catch (e) {
    throw err('APPROVAL_MALFORMED', `${label}: ${e.message}`);
  }
  if (a.schemaVersion !== 1 || !SHA_RE.test(a.id || '')
      || !Number.isSafeInteger(a.revision) || a.revision < 0
      || !STATUSES.has(a.status)
      || typeof a.question !== 'string' || a.question.trim() === ''
      || typeof a.notice !== 'string' || a.notice.trim() === ''
      || !isCanonicalTime(a.createdAt) || !isCanonicalTime(a.updatedAt)) {
    throw err('APPROVAL_MALFORMED', `${label} has invalid fields`);
  }
  const t = a.target;
  if (t === null || typeof t !== 'object' || Array.isArray(t)) {
    throw err('APPROVAL_MALFORMED', `${label}.target must be an object`);
  }
  if (t.kind === 'artifact') {
    if (Object.keys(t).length !== 4 || !ARTIFACT_KINDS.has(t.artifactKind)
        || !UUID_RE.test(t.id || '') || !SHA_RE.test(t.digest || '')) {
      throw err('APPROVAL_MALFORMED', `${label}.target artifact invalid`);
    }
  } else if (t.kind === 'task' || t.kind === 'plan') {
    const idOk = t.kind === 'task'
      ? UUID_RE.test(t.id || '') : PLAN_KEY_RE.test(t.id || '');
    if (Object.keys(t).length !== 3 || !idOk || !SHA_RE.test(t.digest || '')) {
      throw err('APPROVAL_MALFORMED', `${label}.target ${t.kind} invalid`);
    }
  } else {
    throw err('APPROVAL_MALFORMED', `${label}.target shape invalid`);
  }
  if (a.id !== t.digest.toLowerCase()) {
    throw err('APPROVAL_MALFORMED',
      `${label}.id must equal target.digest`);
  }
  if (a.scope === null || typeof a.scope !== 'object'
      || Object.keys(a.scope).length !== 2
      || !Array.isArray(a.scope.paths)
      || !a.scope.paths.every((p) => {
        if (typeof p !== 'string') return false;
        try { return assertDestination(p, 'scope') === p; }
        catch { return false; }
      })
      || !Array.isArray(a.scope.effects)
      || a.scope.effects.length !== 1
      || a.scope.effects[0] !== EFFECTS[0]) {
    throw err('APPROVAL_MALFORMED', `${label}.scope invalid`);
  }
  if (!Array.isArray(a.options) || a.options.length !== 2
      || !a.options.every((o) => o && typeof o === 'object'
        && Object.keys(o).length === 3)
      || a.options[0].id !== 'approve' || a.options[1].id !== 'reject'
      || !a.options.every((o) =>
        typeof o.label === 'string' && o.label.trim() !== ''
        && typeof o.description === 'string'
        && o.description.trim() !== '')) {
    throw err('APPROVAL_MALFORMED', `${label}.options invalid`);
  }
  if (!Array.isArray(a.history) || a.history.length < 1
      || a.history.length > loadLimits().maxSessionEvents
      || a.history.length !== a.revision + 1) {
    throw err('APPROVAL_MALFORMED', `${label}.history invalid`);
  }
  let prevAt = -Infinity;
  let prevStatus = null;
  for (let i = 0; i < a.history.length; i += 1) {
    const h = a.history[i];
    if (h === null || typeof h !== 'object' || Array.isArray(h)
        || Object.keys(h).length !== 7
        || !isCanonicalTime(h.at)
        || h.revision !== i
        || !STATUSES.has(h.status)) {
      throw err('APPROVAL_MALFORMED', `${label}.history[${i}] invalid`);
    }
    const atMs = Date.parse(h.at);
    if (atMs < prevAt) {
      throw err('APPROVAL_MALFORMED',
        `${label}.history is not nondecreasing`);
    }
    prevAt = atMs;
    if (i === 0) {
      if (h.event !== 'created' || h.status !== 'pending'
          || h.actor !== null || h.answer !== null || h.comment !== null) {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[0] must be created/pending`);
      }
    } else {
      // Replay the input rules on stored history: every answered event
      // carries a declared actor; custom and re-answers carry a comment.
      if (h.event !== 'answered' || !ANSWERS.has(h.answer)
          || typeof h.actor !== 'string' || h.actor.trim() === ''
          || (h.comment !== null && typeof h.comment !== 'string')) {
        throw err('APPROVAL_MALFORMED', `${label}.history[${i}] invalid event`);
      }
      if (h.answer === 'revoke' && prevStatus !== 'approved') {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[${i}] revoke out of non-approved`);
      }
      if ((h.answer === 'custom' || prevStatus !== 'pending')
          && (typeof h.comment !== 'string' || h.comment.trim() === '')) {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[${i}] requires a non-empty comment`);
      }
      if (h.status !== ANSWER_STATUS.get(h.answer)) {
        throw err('APPROVAL_MALFORMED',
          `${label}.history[${i}] status does not map from answer`);
      }
    }
    prevStatus = h.status;
  }
  if (a.createdAt !== a.history[0].at
      || a.updatedAt !== a.history[a.history.length - 1].at
      || a.status !== a.history[a.history.length - 1].status) {
    throw err('APPROVAL_MALFORMED',
      `${label} top fields must mirror first/last history`);
  }
  return a;
}

export function getApproval(ctx, id) {
  if (typeof id !== 'string' || !SHA_RE.test(id)) {
    throw err('APPROVAL_INVALID', 'approval id must be a sha256 digest');
  }
  const { abs } = approvalFile(ctx, id);
  const st = lstatOrNull(abs);
  if (!st) throw err('APPROVAL_NOT_FOUND', `approval not found: ${id}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED', `approval may not be a link: ${id}`);
  }
  const limited = readFileLimited(abs, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('APPROVAL_MALFORMED', `approval ${id} exceeds document limit`);
  }
  let a;
  try { a = JSON.parse(limited.content.toString('utf8')); }
  catch { throw err('APPROVAL_MALFORMED', `approval ${id} malformed JSON`); }
  a = validateApprovalShape(a, `approval ${id}`);
  if (a.id !== id.toLowerCase()) {
    throw err('APPROVAL_MALFORMED', 'approval id does not match filename');
  }
  return a;
}

// Specs with open questions block APPROVE only — other answers stay legal.
function assertSpecApproveable(ctx, a, answer) {
  if (answer !== 'approve' || a.target.kind !== 'artifact'
      || a.target.artifactKind !== 'spec') return;
  const spec = getSpecification(ctx, a.target.id);
  if (spec.data.openQuestions.length > 0) {
    throw err('APPROVAL_OPEN_QUESTIONS',
      `spec ${a.target.id} has ${spec.data.openQuestions.length} open question(s); approve is blocked`);
  }
}

// Read-only prospective answer: validates input basics BEFORE any lock or
// file write. Returns {previous,next,file} for the caller or the lock path.
export function prepareApprovalAnswer(ctx, input) {
  closed(input, ANSWER_KEYS, 'answer input');
  if (typeof input.id !== 'string' || !SHA_RE.test(input.id)) {
    throw err('APPROVAL_INVALID', 'id must be a sha256 digest');
  }
  if (!Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0) {
    throw err('REVISION_MISMATCH',
      'expectedRevision must be a non-negative safe integer');
  }
  if (typeof input.expectedTargetDigest !== 'string'
      || !SHA_RE.test(input.expectedTargetDigest)) {
    throw err('APPROVAL_INVALID',
      'expectedTargetDigest must be a sha256 hex string');
  }
  if (!ANSWERS.has(input.answer)) {
    throw err('APPROVAL_INVALID', `unknown answer '${input.answer}'`);
  }
  if (typeof input.actor !== 'string' || input.actor.trim() === '') {
    throw err('APPROVAL_INVALID',
      'actor must be a non-empty string (declared, not authenticated)');
  }
  if (input.comment !== undefined
      && (input.comment !== null && typeof input.comment !== 'string')) {
    throw err('APPROVAL_INVALID', 'comment must be a string or null');
  }
  const previous = getApproval(ctx, input.id);
  const next = applyAnswer(ctx, previous, input);
  const { rel, abs } = approvalFile(ctx, previous.id);
  const content = JSON.stringify(next, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE', 'approval would exceed document limit');
  }
  return { previous, next, file: { rel, abs, content } };
}

function applyAnswer(ctx, a, input) {
  if (input.expectedRevision !== a.revision) {
    throw err('REVISION_MISMATCH',
      `expected revision ${input.expectedRevision} but stored ${a.revision}`);
  }
  if (input.expectedTargetDigest !== a.target.digest) {
    throw err('APPROVAL_STALE_TARGET',
      'expectedTargetDigest does not match the stored target digest');
  }
  // Revalidate the CURRENT target: digest and derived scope must match.
  const desc = describeApprovalTarget(ctx, a.target.kind === 'artifact'
    ? { kind: 'artifact', artifactKind: a.target.artifactKind,
      id: a.target.id }
    : { kind: a.target.kind, id: a.target.id });
  if (desc.target.digest !== a.target.digest
      || JSON.stringify([...desc.scope.paths].sort())
        !== JSON.stringify([...a.scope.paths].sort())) {
    throw err('APPROVAL_STALE_TARGET',
      'target content or scope drifted since the approval was created');
  }
  const { answer, actor, comment } = input;
  const pending = a.status === 'pending';
  if (answer === 'revoke' && a.status !== 'approved') {
    throw err('APPROVAL_INVALID', 'revoke is only valid from approved');
  }
  const needsComment = answer === 'custom' || !pending;
  if (needsComment
      && (typeof comment !== 'string' || comment.trim() === '')) {
    throw err('APPROVAL_INVALID',
      `answer '${answer}' on a ${a.status} record requires a non-empty comment`);
  }
  assertSpecApproveable(ctx, a, answer);
  const at = new Date().toISOString();
  const lastAt = Date.parse(a.history[a.history.length - 1].at);
  if (Date.parse(at) < lastAt) {
    throw err('APPROVAL_CLOCK_REGRESSION',
      `clock moved backwards: ${at} < last history event`);
  }
  const next = {
    ...a,
    revision: a.revision + 1,
    status: ANSWER_STATUS.get(answer),
    updatedAt: at,
    history: [...a.history, {
      at, event: 'answered', revision: a.revision + 1,
      status: ANSWER_STATUS.get(answer),
      actor, answer, comment: comment ?? null,
    }],
  };
  validateApprovalShape(next, 'approval(next)');
  return next;
}

// Locked answer: input validated and prospective record prepared BEFORE the
// lock (read-only), then reprepared INSIDE the lock so a concurrent answer
// cannot silently overwrite. Borrowed lock/tmp ownership from task
// transitions — never delete foreign sentinels.
export function answerApproval(ctx, input) {
  // Preflight: all input/basic failures surface with zero filesystem writes.
  const preflight = prepareApprovalAnswer(ctx, input);
  const { abs } = preflight.file;
  const lockPath = `${abs}.lock`;
  let lockFd = null;
  let lockOwned = false;
  let tmpPath = null;
  let tmpOwned = false;
  try {
    try {
      lockFd = fs.openSync(lockPath, 'wx');
      lockOwned = true;
    } catch (e) {
      if (e && e.code === 'EEXIST') {
        throw err('APPROVAL_LOCKED',
          'approval lock exists; refusing to recover it automatically');
      }
      throw e;
    }
    fs.closeSync(lockFd);
    lockFd = null;
    const { next, file } = prepareApprovalAnswer(ctx, input); // reprepare
    mkdirpSync(path.dirname(abs));
    tmpPath = `${abs}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    writeFileExclusive(tmpPath, file.content);
    tmpOwned = true;
    fs.renameSync(tmpPath, abs);
    tmpOwned = false;
    return next;
  } finally {
    if (lockFd !== null) {
      try { fs.closeSync(lockFd); } catch { /* already closed */ }
    }
    if (lockOwned) removeIfExists(lockPath);
    if (tmpOwned) removeIfExists(tmpPath);
  }
}
