// Task state operations: JSON documents under paths.tasks, guarded by
// per-task exclusive locks and compare-and-swap on revision.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { lstatOrNull, mkdirpSync, readFileLimited, writeFileExclusive } from './fsx.mjs';
import { assertDestination, resolveInside } from './paths.mjs';
import { knownStates, loadLimits, loadPolicy } from './policy.mjs';
import { validateReview, validateVerification } from './evidence.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TASK_KEYS = new Set([
  'schemaVersion', 'id', 'title', 'contract', 'authorContext', 'scope',
  'state', 'revision', 'verification', 'review', 'createdAt', 'updatedAt',
  'history',
]);
const CREATE_KEYS = new Set(['title', 'contract', 'authorContext', 'scope']);

function nowIso() {
  return new Date().toISOString();
}

export function tasksDirAbs(ctx) {
  return resolveInside(ctx.projectRoot, ctx.config.paths.tasks, 'paths.tasks');
}

export function taskFilePath(ctx, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw err('INVALID_ID', `task id must be a UUID, got: ${String(id)}`);
  }
  return path.join(tasksDirAbs(ctx), `${id.toLowerCase()}.json`);
}

function requireNonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw err('INVALID_VALUE', `${label} must be a non-empty string`);
  }
  return value;
}

export function validateTaskShape(task, label = 'task') {
  if (task === null || typeof task !== 'object' || Array.isArray(task)) {
    throw err('TASK_MALFORMED', `${label} is not an object`);
  }
  for (const key of Object.keys(task)) {
    if (!TASK_KEYS.has(key)) {
      throw err('TASK_MALFORMED', `${label} contains unknown key '${key}'`);
    }
  }
  if (task.schemaVersion !== 1) {
    throw err('TASK_MALFORMED', `${label}.schemaVersion must be 1`);
  }
  if (!UUID_RE.test(task.id || '')) {
    throw err('TASK_MALFORMED', `${label} has a non-UUID id`);
  }
  requireNonEmpty(task.title, `${label}.title`);
  requireNonEmpty(task.contract, `${label}.contract`);
  requireNonEmpty(task.authorContext, `${label}.authorContext`);
  if (!Array.isArray(task.scope)
      || !task.scope.every((s) => typeof s === 'string')) {
    throw err('TASK_MALFORMED', `${label}.scope must be an array of strings`);
  }
  for (const s of task.scope) {
    // Stored scope must already be canonical and safe.
    if (assertDestination(s, `${label}.scope`) !== s) {
      throw err('TASK_MALFORMED', `${label}.scope entry is not canonical: ${s}`);
    }
  }
  if (!knownStates().includes(task.state)) {
    throw err('TASK_MALFORMED', `${label} has unknown state '${task.state}'`);
  }
  if (!Number.isInteger(task.revision) || task.revision < 0) {
    throw err('TASK_MALFORMED', `${label}.revision must be a non-negative integer`);
  }
  for (const ts of ['createdAt', 'updatedAt']) {
    if (typeof task[ts] !== 'string' || task[ts].trim() === '') {
      throw err('TASK_MALFORMED', `${label}.${ts} must be a non-empty string`);
    }
  }
  if (!Array.isArray(task.history)
      || !task.history.every((h) => h !== null && typeof h === 'object'
        && typeof h.at === 'string' && typeof h.event === 'string')) {
    throw err('TASK_MALFORMED',
      `${label}.history must be an array of {at,event,...} records`);
  }
  // Stored evidence is structural data: validate it, never trust it.
  if (task.verification !== null && task.verification !== undefined) {
    validateVerification(task.verification);
  }
  if (task.review !== null && task.review !== undefined) {
    validateReview(task.review, task);
  }
  return task;
}

function readTaskFile(file, id) {
  const st = lstatOrNull(file);
  if (!st) throw err('TASK_NOT_FOUND', `task not found: ${id}`);
  if (st.isSymbolicLink()) {
    throw err('SYMLINK_REJECTED', `task file may not be a symlink: ${id}`);
  }
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('TASK_MALFORMED', `task ${id} exceeds document limit`);
  }
  let parsed;
  try {
    parsed = JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('TASK_MALFORMED', `task ${id} contains malformed JSON`);
  }
  let task;
  try {
    task = validateTaskShape(parsed, `task ${id}`);
  } catch (e) {
    // Any structural validation failure on STORED data is malformed data:
    // normalize to TASK_MALFORMED regardless of which check tripped.
    if (e && e.code === 'TASK_MALFORMED') throw e;
    throw err('TASK_MALFORMED',
      `task ${id} failed structural validation: ${e.message}`);
  }
  // A stored id that disagrees with its filename is malformed, not a task.
  const fileId = path.basename(file, '.json');
  if (UUID_RE.test(fileId) && task.id.toLowerCase() !== fileId.toLowerCase()) {
    throw err('TASK_MALFORMED',
      `task id ${task.id} does not match filename ${fileId}`);
  }
  return task;
}

export function getTask(ctx, id) {
  return readTaskFile(taskFilePath(ctx, id), id);
}

// Malformed entries are surfaced, never silently dropped.
export function listTasks(ctx) {
  const dir = tasksDirAbs(ctx);
  const out = { tasks: [], malformed: [] };
  const st = lstatOrNull(dir);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw err('INVALID_PATH', `tasks path is not a real directory`);
  }
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    const fst = lstatOrNull(file);
    if (!fst || fst.isSymbolicLink() || !fst.isFile()) continue;
    const stem = name.slice(0, -'.json'.length);
    if (!UUID_RE.test(stem)) {
      out.malformed.push({
        file: name,
        error: { code: 'TASK_MALFORMED', message: 'filename is not a UUID' },
      });
      continue;
    }
    try {
      out.tasks.push(readTaskFile(file, name));
    } catch (e) {
      out.malformed.push({
        file: name,
        error: { code: e.code || 'INTERNAL', message: e.message },
      });
    }
  }
  return out;
}

// Pure input normalization shared by createTask and plan task creation:
// strict keys, non-empty fields, canonical scope resolved inside the root.
export function normalizeTaskInput(ctx, input) {
  for (const key of Object.keys(input || {})) {
    if (!CREATE_KEYS.has(key)) {
      throw err('UNKNOWN_KEY', `task input received unknown key '${key}'`);
    }
  }
  const title = requireNonEmpty(input.title, 'title');
  const contract = requireNonEmpty(input.contract, 'contract');
  const authorContext = requireNonEmpty(input.authorContext, 'authorContext');
  const scope = input.scope === undefined ? [] : input.scope;
  if (!Array.isArray(scope)) {
    throw err('INVALID_VALUE', 'scope must be an array of relative paths');
  }
  const cleanScope = scope.map((s, i) => assertDestination(s, `scope[${i}]`));
  for (const s of cleanScope) {
    resolveInside(ctx.projectRoot, s, 'scope');
  }
  return { title, contract, authorContext, scope: cleanScope };
}

// Pure task record factory: no I/O, no side effects. Used by createTask
// and by preparePlan (which must not create task side effects at plan time).
export function buildTaskRecord(input, { id, at, initial }) {
  return {
    schemaVersion: 1,
    id,
    title: input.title,
    contract: input.contract,
    authorContext: input.authorContext,
    scope: input.scope,
    state: initial,
    revision: 0,
    verification: null,
    review: null,
    createdAt: at,
    updatedAt: at,
    history: [{ at, event: 'created', state: initial, revision: 0 }],
  };
}

export function createTask(ctx, input) {
  const clean = normalizeTaskInput(ctx, input);
  const policy = loadPolicy();
  const id = crypto.randomUUID();
  const at = nowIso();
  const task = buildTaskRecord(clean, { id, at, initial: policy.initial });
  const serialized = JSON.stringify(task, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      `task record exceeds ${loadLimits().maxDocumentBytes} bytes`);
  }

  const dir = tasksDirAbs(ctx);
  mkdirpSync(dir);
  const file = taskFilePath(ctx, id);
  try {
    writeFileExclusive(file, serialized); // own-file cleanup on write failure
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw err('TASK_CONFLICT', `task id collision: ${id}`);
    }
    throw e;
  }
  return task;
}
