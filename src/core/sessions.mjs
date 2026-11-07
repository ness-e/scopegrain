// Bounded sessions: an explicit operation budget recorded against a task.
// One exclusive lock, compare-and-swap revision, atomic temp+rename, no
// stale-lock recovery. Policy or budget failure leaves bytes unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { lstatOrNull, mkdirpSync, readFileLimited, removeIfExists, writeFileExclusive } from './fsx.mjs';
import { resolveInside } from './paths.mjs';
import { loadLimits, knownActions } from './policy.mjs';
import { getTask } from './tasks.mjs';
import { checkAction } from './transition.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_KEYS = new Set([
  'schemaVersion', 'id', 'taskId', 'limit', 'used', 'revision',
  'events', 'createdAt', 'updatedAt',
]);
const EVENT_KEYS = new Set(['action', 'evidence', 'context', 'at']);

export function sessionsDirAbs(ctx) {
  return resolveInside(
    ctx.projectRoot, `${ctx.config.paths.state}/sessions`, 'paths.state');
}

export function sessionFileAbs(ctx, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw err('INVALID_ID', `session id must be a UUID, got: ${String(id)}`);
  }
  return path.join(sessionsDirAbs(ctx), `${id.toLowerCase()}.json`);
}

export function validateSessionShape(s, label = 'session') {
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    throw err('SESSION_MALFORMED', `${label} is not an object`);
  }
  for (const k of Object.keys(s)) {
    if (!SESSION_KEYS.has(k)) {
      throw err('SESSION_MALFORMED', `${label} has unknown key '${k}'`);
    }
  }
  const max = loadLimits().maxSessionEvents;
  const actions = knownActions(); // loaded once, not per event
  if (s.schemaVersion !== 1 || !UUID_RE.test(s.id || '')
      || !UUID_RE.test(s.taskId || '')
      || !Number.isInteger(s.limit) || s.limit <= 0 || s.limit > max
      || !Number.isInteger(s.used) || s.used < 0 || s.used > s.limit
      || !Number.isInteger(s.revision) || s.revision < 0
      || typeof s.createdAt !== 'string' || s.createdAt === ''
      || typeof s.updatedAt !== 'string' || s.updatedAt === ''
      || !Array.isArray(s.events)
      || s.events.length > max
      || !s.events.every((ev) => ev !== null && typeof ev === 'object'
        && Object.keys(ev).every((k) => EVENT_KEYS.has(k))
        && typeof ev.action === 'string' && actions.has(ev.action)
        && typeof ev.evidence === 'string' && ev.evidence !== ''
        && typeof ev.context === 'string'
        && typeof ev.at === 'string' && isCanon(ev.at))) {
    throw err('SESSION_MALFORMED', `${label} has invalid fields`);
  }
  // Append-only invariants: usage and revision track recorded events.
  if (s.used !== s.events.length || s.revision !== s.events.length) {
    throw err('SESSION_MALFORMED',
      `${label}: used/revision do not match events.length`);
  }
  const isoOk = typeof s.createdAt === 'string' && isCanon(s.createdAt)
    && typeof s.updatedAt === 'string' && isCanon(s.updatedAt);
  if (!isoOk) {
    throw err('SESSION_MALFORMED', `${label} has invalid timestamps`);
  }
  // Chronology: events nondecreasing within [createdAt, updatedAt], and
  // updatedAt equals the last event time (empty session: == createdAt).
  const created = Date.parse(s.createdAt);
  const updated = Date.parse(s.updatedAt);
  const lastAt = s.events.length
    ? s.events[s.events.length - 1].at : s.createdAt;
  let prev = created;
  for (const ev of s.events) {
    const t = Date.parse(ev.at);
    if (t < prev || t > updated) {
      throw err('SESSION_MALFORMED', `${label} has non-monotonic event times`);
    }
    prev = t;
  }
  if (updated !== Date.parse(lastAt) || updated < created) {
    throw err('SESSION_MALFORMED', `${label} updatedAt is inconsistent`);
  }
  return s;
}

const isCanon = (v) => {
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
};

function readSessionFile(file, id) {
  const st = lstatOrNull(file);
  if (!st) throw err('SESSION_NOT_FOUND', `session not found: ${id}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED', `session may not be a link: ${id}`);
  }
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('SESSION_MALFORMED', `session ${id} exceeds document limit`);
  }
  let s;
  try {
    s = JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('SESSION_MALFORMED', `session ${id} contains malformed JSON`);
  }
  try {
    s = validateSessionShape(s, `session ${id}`);
  } catch (e) {
    if (e && e.code === 'SESSION_MALFORMED') throw e;
    throw err('SESSION_MALFORMED', `session ${id} failed validation: ${e.message}`);
  }
  if (s.id.toLowerCase() !== id.toLowerCase()) {
    throw err('SESSION_MALFORMED', `session id does not match filename`);
  }
  return s;
}

export function getSession(ctx, id) {
  return readSessionFile(sessionFileAbs(ctx, id), id);
}

// Read-only session plan: {session, file} for exclusive apply.
export function prepareSession(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_SESSION', 'session input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!['taskId', 'limit'].includes(k)) {
      throw err('UNKNOWN_KEY', `session input has unknown key '${k}'`);
    }
  }
  const max = loadLimits().maxSessionEvents;
  if (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > max) {
    throw err('INVALID_VALUE', `limit must be an integer in 1..${max}`);
  }
  const task = getTask(ctx, input.taskId); // must exist (throws otherwise)
  const at = new Date().toISOString();
  const session = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    taskId: task.id,
    limit: input.limit,
    used: 0,
    revision: 0,
    events: [],
    createdAt: at,
    updatedAt: at,
  };
  const rel = `${ctx.config.paths.state}/sessions/${session.id}.json`;
  return {
    session,
    file: {
      rel,
      abs: resolveInside(ctx.projectRoot, rel, 'session file'),
      content: JSON.stringify(session, null, 2) + '\n',
    },
  };
}

function acquireLock(lockPath) {
  let fd;
  try {
    fd = fs.openSync(lockPath, 'wx');
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw err('SESSION_LOCKED',
        'session is locked by another operation; no stale-lock recovery');
    }
    throw e;
  }
  fs.closeSync(fd);
}

function validateRecordInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_SESSION', 'record input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!['id', 'expectedRevision', 'action', 'evidence', 'context']
      .includes(k)) {
      throw err('UNKNOWN_KEY', `record input has unknown key '${k}'`);
    }
  }
  if (typeof input.action !== 'string' || input.action === ''
      || !knownActions().has(input.action)) {
    throw err('INVALID_ACTION', `unknown action '${input.action}'`);
  }
  if (typeof input.evidence !== 'string' || input.evidence === '') {
    throw err('INVALID_VALUE', 'evidence must be a non-empty string');
  }
  if (input.context !== undefined && typeof input.context !== 'string') {
    throw err('INVALID_VALUE', 'context must be a string');
  }
  if (!Number.isInteger(input.expectedRevision)
      || input.expectedRevision < 0) {
    throw err('INVALID_VALUE', 'expectedRevision must be a non-negative integer');
  }
}

// Read-only record preparation: exact input validation plus CURRENT state
// checks (id resolution, revision match, policy, budget) without mutation.
// Used by CLI dry-run; apply re-validates everything under the lock.
export function prepareSessionRecord(ctx, input) {
  validateRecordInput(input);
  const file = sessionFileAbs(ctx, input.id);
  const session = readSessionFile(file, input.id);
  if (session.revision !== input.expectedRevision) {
    throw err('REVISION_MISMATCH',
      `expected revision ${input.expectedRevision} but stored ${session.revision}`);
  }
  const check = checkAction(ctx, session.taskId, input.action);
  if (!check.allowed) {
    throw err('SESSION_ACTION_DENIED',
      `action '${input.action}' is not allowed in task state ${check.state}`);
  }
  if (session.used >= session.limit) {
    throw err('SESSION_LIMIT_EXHAUSTED',
      `operation limit ${session.limit} reached`);
  }
  // Prospective append is built+serialized exactly as apply would: dry-run
  // sees the same DOCUMENT_TOO_LARGE/clock failures with no writes.
  const prospective = buildNextSession(session, input, new Date().toISOString());
  assertSessionFits(prospective);
  return { session, check, prospective };
}

function buildNextSession(session, input, at) {
  return {
    ...session,
    used: session.used + 1,
    revision: session.revision + 1,
    updatedAt: at,
    events: [...session.events, {
      action: input.action,
      evidence: input.evidence,
      context: input.context || '',
      at,
    }],
  };
}

function assertSessionFits(next) {
  const serialized = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  if (serialized.length > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      'appended session would exceed document limit');
  }
  // The prospective record must satisfy EVERY stored invariant — including
  // chronology against the previous last event, not just createdAt.
  validateSessionShape(next, 'prospective session');
  return serialized;
}

// Append one event under lock + CAS after policy check and budget check.
export function recordSession(ctx, input) {
  validateRecordInput(input);
  const file = sessionFileAbs(ctx, input.id);
  const lockPath = `${file}.lock`;
  let tmpPath = null;
  let tmpOwned = false;
  acquireLock(lockPath);
  try {
    const session = readSessionFile(file, input.id);
    if (session.revision !== input.expectedRevision) {
      throw err('REVISION_MISMATCH',
        `expected revision ${input.expectedRevision} but stored ${session.revision}`);
    }
    // Policy first: the action must be allowed for the CURRENT task state.
    const check = checkAction(ctx, session.taskId, input.action);
    if (!check.allowed) {
      throw err('SESSION_ACTION_DENIED',
        `action '${input.action}' is not allowed in task state ${check.state}`);
    }
    if (session.used >= session.limit) {
      throw err('SESSION_LIMIT_EXHAUSTED',
        `operation limit ${session.limit} reached`);
    }
    const at = new Date().toISOString();
    const next = buildNextSession(session, input, at);
    const serialized = assertSessionFits(next);
    tmpPath = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    writeFileExclusive(tmpPath, serialized); // cleans itself on write failure
    tmpOwned = true;
    fs.renameSync(tmpPath, file);
    tmpOwned = false;
    return next;
  } finally {
    if (tmpOwned) removeIfExists(tmpPath);
    removeIfExists(lockPath);
  }
}

// Resume: actual task state, current evidence, usage and remaining budget.
// Adds a recovery guidance REFERENCE (catalog path), never a prompt.
export function resumeSession(ctx, id) {
  const session = getSession(ctx, id);
  const task = getTask(ctx, session.taskId);
  return {
    session,
    task: {
      id: task.id,
      state: task.state,
      revision: task.revision,
      verification: task.verification,
      review: task.review,
    },
    usage: {
      used: session.used,
      limit: session.limit,
      remaining: session.limit - session.used,
      measures: loadLimits().budgetMeasures,
    },
    resourceRoot: ctx.configDir,
    recovery: { reference: 'references/task-system.md' },
  };
}

export function ensureSessionsDir(ctx) {
  mkdirpSync(sessionsDirAbs(ctx));
}
