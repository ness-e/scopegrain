// Task state operations: JSON documents under paths.tasks, guarded by
// per-task exclusive locks and compare-and-swap on revision.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { lstatOrNull, mkdirpSync, readFileLimited, writeFileExclusive } from './fsx.mjs';
import { assertDestination, isSameOrAncestor, resolveInside }
  from './paths.mjs';
import { knownStates, loadLimits, loadPolicy } from './policy.mjs';
import { validateReview, validateVerification } from './evidence.mjs';
import { canonicalDigest } from './digests.mjs';
import { getArtifact } from './artifacts.mjs';
import { getSpecification } from './specifications.mjs';
import {
  classifyWork, normalizeScenarioRefs, validateMethodologyData,
} from './methodology-data.mjs';
import { validateSpecificationItemId } from './specification-data.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUUID = (v) => typeof v === 'string' && UUID_RE.test(v);

const TASK_KEYS = new Set([
  'schemaVersion', 'id', 'title', 'contract', 'authorContext', 'scope',
  'state', 'revision', 'verification', 'review', 'createdAt', 'updatedAt',
  'history', 'methodology', 'specId', 'designId', 'planKey', 'scenarioRefs',
]);
const CREATE_KEYS = new Set([
  'title', 'contract', 'authorContext', 'scope', 'methodology',
  'specId', 'designId', 'planKey', 'scenarioRefs',
]);
const V2_KEYS = new Set(
  ['methodology', 'specId', 'designId', 'planKey', 'scenarioRefs']);
const PLAN_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function nowIso() {
  return new Date().toISOString();
}

export function tasksDirAbs(ctx) {
  return resolveInside(ctx.projectRoot, ctx.config.paths.tasks, 'paths.tasks');
}

export function taskFilePath(ctx, id) {
  if (!isUUID(id)) {
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
  if (task.schemaVersion !== 1 && task.schemaVersion !== 2) {
    throw err('TASK_MALFORMED',
      `${label}.schemaVersion must be 1 or 2`);
  }
  // V1 forbids the methodology fields entirely; V2 requires all five in
  // their normalized forms — no defaults are ever invented on read.
  if (task.schemaVersion === 1) {
    for (const k of V2_KEYS) {
      if (task[k] !== undefined) {
        throw err('TASK_MALFORMED',
          `${label} V1 may not carry '${k}'`);
      }
    }
  } else {
    for (const k of V2_KEYS) {
      if (task[k] === undefined) {
        throw err('TASK_MALFORMED',
          `${label} V2 requires '${k}'`);
      }
    }
    validateV2Fields(task, label);
  }
  if (!isUUID(task.id)) {
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
  if (!Number.isSafeInteger(task.revision) || task.revision < 0) {
    throw err('TASK_MALFORMED', `${label}.revision must be a non-negative integer`);
  }
  const isCanon = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v))
    && new Date(Date.parse(v)).toISOString() === v;
  for (const ts of ['createdAt', 'updatedAt']) {
    if (!isCanon(task[ts])) {
      throw err('TASK_MALFORMED', `${label}.${ts} must be a canonical ISO timestamp`);
    }
  }
  if (Date.parse(task.createdAt) > Date.parse(task.updatedAt)) {
    throw err('TASK_MALFORMED', `${label}.createdAt must not exceed updatedAt`);
  }
  if (!Array.isArray(task.history) || task.history.length === 0
      || !task.history.every((h) => h !== null && typeof h === 'object'
        && isCanon(h.at) && typeof h.event === 'string')) {
    throw err('TASK_MALFORMED',
      `${label}.history must be a non-empty array of {at,event,...} records`);
  }
  // Chronology: nondecreasing event times within [createdAt, updatedAt];
  // the first event IS creation, the last IS the latest update.
  const first = Date.parse(task.history[0].at);
  const last = Date.parse(task.history.at(-1).at);
  let prev = first;
  for (const h of task.history) {
    const t = Date.parse(h.at);
    if (t < prev || t < Date.parse(task.createdAt)
        || t > Date.parse(task.updatedAt)) {
      throw err('TASK_MALFORMED', `${label}.history chronology invalid`);
    }
    prev = t;
  }
  if (first !== Date.parse(task.createdAt)
      || last !== Date.parse(task.updatedAt)) {
    throw err('TASK_MALFORMED', `${label}.history bounds must match created/updated`);
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

// Stored V2 field coherence — OWN record shape only, no live foreign-key
// lookups (a historical task stays readable if its spec disappears).
function validateV2Fields(task, label) {
  if (task.methodology !== null) {
    try {
      validateMethodologyData(task.methodology,
        `${label}.methodology`, { stored: true });
    } catch (e) {
      throw err('TASK_MALFORMED',
        `${label}.methodology: ${e.message}`);
    }
  }
  const hasSpec = task.specId !== null || task.designId !== null;
  if (hasSpec) {
    if (task.specId === null || task.designId === null
        || !isUUID(task.specId) || !isUUID(task.designId)) {
      throw err('TASK_MALFORMED',
        `${label} formal refs require specId AND designId UUIDs`);
    }
    if (task.planKey !== null && (typeof task.planKey !== 'string'
        || !PLAN_KEY_RE.test(task.planKey))) {
      throw err('TASK_MALFORMED', `${label}.planKey must be a slug or null`);
    }
    if (!Array.isArray(task.scenarioRefs) || task.scenarioRefs.length === 0) {
      throw err('TASK_MALFORMED',
        `${label} formal tasks require >=1 scenario pair`);
    }
    const seen = new Set();
    for (const r of task.scenarioRefs) {
      if (r === null || typeof r !== 'object' || Array.isArray(r)
          || Object.keys(r).length !== 2) {
        throw err('TASK_MALFORMED',
          `${label}.scenarioRefs pairs need exactly 2 keys`);
      }
      let rid;
      let sid;
      try {
        rid = validateSpecificationItemId(r.requirementId,
          `${label}.scenarioRefs.requirementId`);
        sid = validateSpecificationItemId(r.scenarioId,
          `${label}.scenarioRefs.scenarioId`);
      } catch (e) {
        throw err('TASK_MALFORMED',
          `${label}.scenarioRefs: ${e.message}`);
      }
      const k = `${rid.toLowerCase()}/${sid.toLowerCase()}`;
      if (seen.has(k)) {
        throw err('TASK_MALFORMED',
          `${label}.scenarioRefs duplicate ${rid}/${sid}`);
      }
      seen.add(k);
    }
  } else {
    // No formal refs: only a light assessment may occupy V2. null or a
    // methodology whose classification requires formal refs is malformed.
    if (task.designId !== null || task.planKey !== null
        || !Array.isArray(task.scenarioRefs) || task.scenarioRefs.length !== 0) {
      throw err('TASK_MALFORMED',
        `${label} light tasks store null refs and empty scenarioRefs`);
    }
    if (task.methodology === null) {
      throw err('TASK_MALFORMED',
        `${label} V2 without refs requires a methodology assessment, not null`);
    }
    let route;
    try {
      ({ route } = classifyWork(task.methodology));
    } catch (e) {
      throw err('TASK_MALFORMED',
        `${label}.methodology: ${e.message}`);
    }
    if (route === 'sdd') {
      throw err('TASK_MALFORMED',
        `${label} light assessment classifies sdd but has no formal refs`);
    }
  }
}

// Pure input normalization shared by prepareTask/createTask/preparePlan:
// strict keys, non-empty fields, canonical scope contained in the root,
// methodology refs resolved against live artifacts at prepare time.
export function normalizeTaskInput(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_VALUE', 'task input must be an object');
  }
  for (const key of Object.keys(input)) {
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
  const mode = ctx.config.methodology ?? 'manual';
  const hasRefs = input.specId !== undefined || input.designId !== undefined;
  if (!hasRefs && (input.planKey !== undefined || input.scenarioRefs !== undefined)) {
    throw err('METHODOLOGY_REQUIRED',
      'planKey/scenarioRefs require the specId+designId pair');
  }
  if (hasRefs
      && (!isUUID(input.specId) || !isUUID(input.designId))) {
    throw err('INVALID_ID', 'specId and designId must both be UUIDs');
  }
  // Explicit null without formal refs is a silent-V1 downgrade, not a
  // legal form — the field only means something with the pair.
  if (!hasRefs && input.methodology === null) {
    throw err('METHODOLOGY_REQUIRED',
      'methodology: explicit null requires the specId+designId pair');
  }
  const assessment = input.methodology === undefined
    ? undefined
    : input.methodology === null ? null
      : validateMethodologyData(input.methodology, 'task.methodology');
  const out = { title, contract, authorContext, scope: cleanScope };
  if (!hasRefs) {
    // Mode gating for non-formal creation.
    if (mode === 'sdd') {
      throw err('METHODOLOGY_REQUIRED',
        'mode sdd requires the specId+designId pair');
    }
    if (mode === 'organic-sdd' && assessment === undefined) {
      throw err('METHODOLOGY_REQUIRED',
        'mode organic-sdd requires an assessment or the formal pair');
    }
    if (assessment) {
      const { route } = classifyWork(assessment);
      if (route === 'sdd') {
        throw err('METHODOLOGY_REQUIRED',
          'classified sdd requires the formal refs pair');
      }
      // light / blocked / read-only draft: stores assessment, no refs.
      out.methodology = assessment;
      out.specId = null; out.designId = null; out.planKey = null;
      out.scenarioRefs = [];
      out.schemaVersion = 2;
    } else if (mode !== 'manual') {
      throw err('METHODOLOGY_REQUIRED',
        'explicit formal refs or a methodology assessment required');
    }
    return out; // V1 manual: no new fields
  }
  // Formal: resolve the pair, verify binding, scope subset, scenarios.
  const spec = getSpecification(ctx, input.specId);
  const design = getArtifact(ctx, 'design', input.designId);
  // UUID refs are case-insensitive: bind on folded ids, not raw spelling.
  if (design.schemaVersion !== 2 || design.data === undefined
      || design.data.specId.toLowerCase() !== spec.id.toLowerCase()
      || design.data.specDigest !== canonicalDigest(spec)) {
    throw err('METHODOLOGY_REQUIRED',
      'design must belong to the referenced spec at its current digest');
  }
  for (const s of cleanScope) {
    const ok = spec.data.scope.some((sp) =>
      isSameOrAncestor(sp, s, { caseSensitive: true }));
    if (!ok) {
      throw err('METHODOLOGY_REQUIRED',
        `scope '${s}' is not contained in spec scope`);
    }
  }
  out.specId = spec.id;
  out.designId = design.id;
  out.planKey = input.planKey === undefined ? null
    : (() => {
      if (typeof input.planKey !== 'string' || !PLAN_KEY_RE.test(input.planKey)) {
        throw err('INVALID_VALUE', 'planKey must be a slug');
      }
      return input.planKey;
    })();
  out.scenarioRefs = normalizeScenarioRefs(spec, input.scenarioRefs);
  out.methodology = assessment === undefined ? null : assessment;
  out.schemaVersion = 2;
  return out;
}

// Pure task record factory: no I/O, no side effects. V2 records carry the
// normalized methodology bundle; V1 stays byte-identical to before.
export function buildTaskRecord(input, { id, at, initial }) {
  const base = {
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
  if (input.schemaVersion === 2) {
    return {
      ...base,
      schemaVersion: 2,
      methodology: input.methodology,
      specId: input.specId,
      designId: input.designId,
      planKey: input.planKey,
      scenarioRefs: input.scenarioRefs,
    };
  }
  return base;
}

// Read-only prospective creation: returns the record and its file plan
// without writing. Shared factory with createTask.
export function prepareTask(ctx, input) {
  const clean = normalizeTaskInput(ctx, input);
  const policy = loadPolicy();
  const id = crypto.randomUUID();
  const at = nowIso();
  const task = buildTaskRecord(clean, { id, at, initial: policy.initial });
  validateTaskShape(task, `prepared task`);
  const content = JSON.stringify(task, null, 2) + '\n';
  if (Buffer.byteLength(content, 'utf8') > loadLimits().maxDocumentBytes) {
    throw err('DOCUMENT_TOO_LARGE',
      `task record exceeds ${loadLimits().maxDocumentBytes} bytes`);
  }
  const rel = `${ctx.config.paths.tasks}/${id.toLowerCase()}.json`;
  const abs = resolveInside(ctx.projectRoot, rel, 'task file');
  return { task, file: { rel, abs, content } };
}

export function createTask(ctx, input) {
  const { task, file } = prepareTask(ctx, input);
  mkdirpSync(path.dirname(file.abs));
  try {
    writeFileExclusive(file.abs, file.content); // own-file cleanup on fail
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      throw err('TASK_CONFLICT', `task id collision: ${task.id}`);
    }
    throw e;
  }
  return task;
}
