// Outcome evidence: structured report artifact bound to the CURRENT task,
// spec, design, plan and verification. Operator body is verbatim; hashes
// are computed here, never accepted from the caller.
import { err } from './errors.mjs';
import { getTask } from './tasks.mjs';
import { validateVerification } from './evidence.mjs';
import { canonicalDigest } from './digests.mjs';
import { prepareArtifact } from './artifacts.mjs';
import { collectFormalBindings } from './formal-bindings.mjs';
import { assertDestination } from './paths.mjs';

const INPUT_KEYS = new Set(['taskId', 'title', 'body', 'references']);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Requires formal REVIEW, valid verification and healthy bindings.
// No approval required at prepare; ACCEPT gates enforce that later.
export function prepareOutcomeEvidence(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('OUTCOME_INVALID', 'outcome input must be an object');
  }
  for (const k of Object.keys(input)) {
    if (!INPUT_KEYS.has(k)) {
      throw err('UNKNOWN_KEY', `outcome input has unknown key '${k}'`);
    }
  }
  if (typeof input.taskId !== 'string' || !UUID_RE.test(input.taskId)) {
    throw err('INVALID_ID', 'taskId must be a UUID');
  }
  const task = getTask(ctx, input.taskId);
  if (task.schemaVersion !== 2 || task.specId === null
      || task.designId === null) {
    throw err('OUTCOME_INVALID', `task ${input.taskId} is not a formal V2 task`);
  }
  if (task.state !== 'REVIEW') {
    throw err('OUTCOME_INVALID',
      `task ${input.taskId} must be in REVIEW to produce outcome evidence`);
  }
  if (task.verification === null) {
    throw err('OUTCOME_INVALID',
      `task ${input.taskId} has no verification to bind`);
  }
  let verification;
  try {
    verification = validateVerification(task.verification);
  } catch (e) {
    throw err('INVALID_EVIDENCE', `task verification: ${e.message}`);
  }
  const b = collectFormalBindings(ctx, task);
  if (b.issues.length > 0) {
    const e = err('OUTCOME_INVALID',
      `formal bindings are not healthy: ${b.issues[0].message}`);
    e.issues = b.issues;
    throw e;
  }
  const data = {
    schemaVersion: 1,
    taskId: task.id,
    taskRevision: task.revision,
    taskDigest: b.taskDigest,
    specId: b.spec.id,
    specDigest: b.specDigest,
    designDigest: b.designDigest,
    planDigest: b.planDigest,
    verificationDigest: canonicalDigest({
      checks: verification.checks,
      coverage: verification.coverage ?? [],
    }),
  };
  // Canonical caller refs plus actual task/spec JSON paths, deduped.
  if (input.references !== undefined && !Array.isArray(input.references)) {
    throw err('INVALID_VALUE', 'references must be an array');
  }
  const refs = [];
  const seen = new Set();
  for (const r of [
    ...(input.references ?? []),
    `${ctx.config.paths.tasks}/${task.id.toLowerCase()}.json`,
    `${ctx.config.paths.plans}/specs/${b.spec.id.toLowerCase()}.json`,
  ]) {
    const c = assertDestination(r, 'references');
    if (!seen.has(c)) { seen.add(c); refs.push(c); }
  }
  return prepareArtifact(ctx, 'report', {
    title: input.title, body: input.body, references: refs,
  }, { data });
}
