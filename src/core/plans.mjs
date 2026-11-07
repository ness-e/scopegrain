// Plan records: atomic creation of a dependency DAG plus its task files.
// preparePlan is read-only; applyPlan (bootstrap) performs exclusive writes.
// Stored plans and tasks are validated on every read; dependency readiness
// is computed from actual task state, never cached.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { err } from './errors.mjs';
import { lstatOrNull, readFileLimited } from './fsx.mjs';
import { resolveInside } from './paths.mjs';
import { loadPolicy, loadLimits } from './policy.mjs';
import {
  buildTaskRecord, getTask, normalizeTaskInput,
} from './tasks.mjs';

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PLAN_INPUT_KEYS = new Set(['key', 'title', 'authorContext', 'tasks']);
const PLAN_TASK_KEYS = new Set(['key', 'title', 'contract', 'scope', 'dependsOn']);
const PLAN_KEYS = new Set([
  'schemaVersion', 'key', 'title', 'authorContext', 'inputDigest',
  'tasks', 'createdAt',
]);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function plansDirAbs(ctx) {
  return resolveInside(ctx.projectRoot, ctx.config.paths.plans, 'paths.plans');
}

export function planFileAbs(ctx, key) {
  return path.join(plansDirAbs(ctx), `${key}.json`);
}

function requireKey(value, label) {
  if (typeof value !== 'string' || !KEY_RE.test(value)) {
    throw err('INVALID_VALUE',
      `${label} must match ${KEY_RE}`);
  }
  return value;
}

// Strict input validation + DAG check. Pure: no file access beyond scope
// resolution inside the project root.
export function validatePlanInput(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_PLAN', 'plan input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!PLAN_INPUT_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `plan input has unknown key '${k}'`);
    }
  }
  const key = requireKey(input.key, 'plan.key');
  const title = typeof input.title === 'string' && input.title.trim() !== ''
    ? input.title
    : (() => { throw err('INVALID_VALUE', 'plan.title must be non-empty'); })();
  const authorContext =
    typeof input.authorContext === 'string' && input.authorContext.trim() !== ''
      ? input.authorContext
      : (() => { throw err('INVALID_VALUE', 'plan.authorContext must be non-empty'); })();
  const maxTasks = loadLimits().maxPlanTasks;
  if (!Array.isArray(input.tasks)
      || input.tasks.length === 0 || input.tasks.length > maxTasks) {
    throw err('INVALID_PLAN', `plan.tasks must contain 1..${maxTasks} tasks`);
  }

  const seen = new Set();
  const tasks = input.tasks.map((t, i) => {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) {
      throw err('INVALID_PLAN', `tasks[${i}] is not an object`);
    }
    for (const k of Object.keys(t)) {
      if (!PLAN_TASK_KEYS.has(k)) {
        throw err('UNKNOWN_KEY', `tasks[${i}] has unknown key '${k}'`);
      }
    }
    const tkey = requireKey(t.key, `tasks[${i}].key`);
    if (seen.has(tkey)) {
      throw err('INVALID_PLAN', `duplicate task key '${tkey}'`);
    }
    seen.add(tkey);
    const clean = normalizeTaskInput(ctx, {
      title: t.title, contract: t.contract,
      authorContext, scope: t.scope === undefined ? [] : t.scope,
    });
    const dependsOn = t.dependsOn === undefined ? [] : t.dependsOn;
    if (!Array.isArray(dependsOn)) {
      throw err('INVALID_PLAN', `tasks[${i}].dependsOn must be an array`);
    }
    const deps = dependsOn.map((d) => requireKey(d, `tasks[${i}].dependsOn`));
    return { key: tkey, ...clean, dependsOn: deps };
  });

  validateDag(tasks.map((t) => ({ key: t.key, dependsOn: t.dependsOn })),
    'plan input', seen);
  return { key, title, authorContext, tasks };
}

// Shared DAG check used by input validation AND stored-record validation:
// unknown refs, self-deps and cycles are all rejected.
export function validateDag(entries, label, seenSet = null) {
  const known = seenSet || new Set(entries.map((t) => t.key));
  const depsOf = new Map(entries.map((t) => [t.key, t.dependsOn]));
  for (const [tkey, deps] of depsOf) {
    for (const d of deps) {
      if (d === tkey) {
        throw err('INVALID_PLAN', `${label}: task '${tkey}' depends on itself`);
      }
      if (!known.has(d)) {
        throw err('INVALID_PLAN',
          `${label}: task '${tkey}' depends on unknown key '${d}'`);
      }
    }
  }
  const state = new Map(); // 0=visiting 1=done
  const visit = (k, chain) => {
    if (state.get(k) === 1) return;
    if (state.get(k) === 0) {
      throw err('INVALID_PLAN',
        `${label}: dependency cycle through '${[...chain, k].join('->')}'`);
    }
    state.set(k, 0);
    for (const d of depsOf.get(k)) visit(d, [...chain, k]);
    state.set(k, 1);
  };
  for (const k of depsOf.keys()) visit(k, []);
}

function planDigest(input) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(input)).digest('hex');
}

// Read-only plan build: returns {plan, files} where files covers the plan
// document plus every task document, each preflighted by the caller.
export function preparePlan(ctx, input) {
  const clean = validatePlanInput(ctx, input);
  const policy = loadPolicy();
  const at = new Date().toISOString();
  const tasks = [];
  const files = [];
  const maxBytes = loadLimits().maxDocumentBytes;
  const assertDoc = (content, label) => {
    if (Buffer.byteLength(content, 'utf8') > maxBytes) {
      throw err('DOCUMENT_TOO_LARGE',
        `${label} would exceed ${maxBytes} bytes`);
    }
    return content;
  };
  for (const t of clean.tasks) {
    const id = crypto.randomUUID();
    const record = buildTaskRecord(t, { id, at, initial: policy.initial });
    tasks.push({ key: t.key, id, dependsOn: t.dependsOn });
    const rel = `${ctx.config.paths.tasks}/${id}.json`;
    files.push({
      rel,
      abs: resolveInside(ctx.projectRoot, rel, 'task file'),
      content: assertDoc(JSON.stringify(record, null, 2) + '\n', 'task'),
    });
  }
  const plan = {
    schemaVersion: 1,
    key: clean.key,
    title: clean.title,
    authorContext: clean.authorContext,
    inputDigest: planDigest(input),
    tasks,
    createdAt: at,
  };
  const planRel = `${ctx.config.paths.plans}/${clean.key}.json`;
  files.push({
    rel: planRel,
    abs: planFileAbs(ctx, clean.key),
    content: assertDoc(JSON.stringify(plan, null, 2) + '\n', 'plan'),
  });
  return { plan, files };
}

export function validatePlanShape(plan, label = 'plan') {
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
    throw err('PLAN_MALFORMED', `${label} is not an object`);
  }
  for (const k of Object.keys(plan)) {
    if (!PLAN_KEYS.has(k)) {
      throw err('PLAN_MALFORMED', `${label} has unknown key '${k}'`);
    }
  }
  const maxTasks = loadLimits().maxPlanTasks;
  const iso = (v) => typeof v === 'string' && v !== ''
    && !Number.isNaN(Date.parse(v))
    && new Date(Date.parse(v)).toISOString() === v;
  if (plan.schemaVersion !== 1
      || typeof plan.title !== 'string' || plan.title.trim() === ''
      || typeof plan.authorContext !== 'string'
      || plan.authorContext.trim() === ''
      || typeof plan.inputDigest !== 'string'
      || !/^[0-9a-f]{64}$/i.test(plan.inputDigest)
      || !iso(plan.createdAt)) {
    throw err('PLAN_MALFORMED', `${label} has invalid required fields`);
  }
  requireKey(plan.key, `${label}.key`);
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0
      || plan.tasks.length > maxTasks) {
    throw err('PLAN_MALFORMED', `${label}.tasks must contain 1..${maxTasks}`);
  }
  const keys = new Set();
  const ids = new Set();
  for (const [i, t] of plan.tasks.entries()) {
    if (t === null || typeof t !== 'object' || Array.isArray(t)) {
      throw err('PLAN_MALFORMED', `${label}.tasks[${i}] is not an object`);
    }
    for (const k of Object.keys(t)) {
      if (!['key', 'id', 'dependsOn'].includes(k)) {
        throw err('PLAN_MALFORMED', `${label}.tasks[${i}] has unknown key '${k}'`);
      }
    }
    requireKey(t.key, `${label}.tasks[${i}].key`);
    if (keys.has(t.key)) {
      throw err('PLAN_MALFORMED', `${label} duplicates task key '${t.key}'`);
    }
    keys.add(t.key);
    if (!UUID_RE.test(t.id || '')) {
      throw err('PLAN_MALFORMED', `${label}.tasks[${i}].id is not a UUID`);
    }
    const lid = t.id.toLowerCase();
    if (ids.has(lid)) {
      throw err('PLAN_MALFORMED', `${label} duplicates task id ${t.id}`);
    }
    ids.add(lid);
    if (!Array.isArray(t.dependsOn)
        || !t.dependsOn.every((d) => KEY_RE.test(d))) {
      throw err('PLAN_MALFORMED', `${label}.tasks[${i}].dependsOn invalid`);
    }
  }
  // Stored records get the same DAG check as inputs: self, missing, cycles.
  try {
    validateDag(plan.tasks.map((t) => ({
      key: t.key, dependsOn: t.dependsOn,
    })), label, keys);
  } catch (e) {
    if (e && e.code === 'INVALID_PLAN') {
      throw err('PLAN_MALFORMED', e.message);
    }
    throw e;
  }
  return plan;
}

export function getPlan(ctx, key) {
  requireKey(key, 'plan key');
  const file = planFileAbs(ctx, key);
  const st = lstatOrNull(file);
  if (!st) throw err('PLAN_NOT_FOUND', `plan not found: ${key}`);
  if (st.isSymbolicLink() || !st.isFile()) {
    throw err('SYMLINK_REJECTED', `plan file may not be a link: ${key}`);
  }
  const limited = readFileLimited(file, loadLimits().maxDocumentBytes);
  if (limited.exceeded) {
    throw err('PLAN_MALFORMED', `plan ${key} exceeds document limit`);
  }
  let plan;
  try {
    plan = JSON.parse(limited.content.toString('utf8'));
  } catch {
    throw err('PLAN_MALFORMED', `plan ${key} contains malformed JSON`);
  }
  try {
    plan = validatePlanShape(plan, `plan ${key}`);
  } catch (e) {
    if (e && e.code === 'PLAN_MALFORMED') throw e;
    throw err('PLAN_MALFORMED', `plan ${key} failed validation: ${e.message}`);
  }
  if (plan.key !== key) {
    throw err('PLAN_MALFORMED', `plan key ${plan.key} does not match filename`);
  }
  return plan;
}

export function listPlans(ctx) {
  const dir = plansDirAbs(ctx);
  const out = { plans: [], malformed: [] };
  const st = lstatOrNull(dir);
  if (!st) return out;
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw err('INVALID_PATH', 'plans path is not a real directory');
  }
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    const fst = lstatOrNull(file);
    if (!fst || fst.isSymbolicLink() || !fst.isFile()) continue;
    const key = name.slice(0, -'.json'.length);
    try {
      out.plans.push(getPlan(ctx, key));
    } catch (e) {
      out.malformed.push({
        file: name,
        error: { code: e.code || 'INTERNAL', message: e.message },
      });
    }
  }
  return out;
}

// Dependency readiness from ACTUAL stored task state: ready = PLAN with
// every dependency CLOSE; closed = CLOSE; blocked = PLAN with unfinished
// deps; anything else = active. Missing/malformed tasks are errors.
export function nextPlanTasks(ctx, key) {
  const plan = getPlan(ctx, key);
  const states = new Map();
  for (const t of plan.tasks) {
    const task = getTask(ctx, t.id);
    states.set(t.key, task);
  }
  return plan.tasks.map((t) => {
    const task = states.get(t.key);
    const unfinished = t.dependsOn
      .filter((d) => states.get(d).state !== 'CLOSE');
    let status;
    if (task.state === 'CLOSE') status = 'closed';
    else if (task.state === 'PLAN' && unfinished.length === 0) status = 'ready';
    else if (task.state === 'PLAN') status = 'blocked';
    else status = 'active';
    return {
      key: t.key, id: task.id, state: task.state, status,
      blockedBy: unfinished,
    };
  });
}
