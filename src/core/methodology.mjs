// Read-only gates over current declared facts and content-bound approvals.
// This is not identity/execution authentication, a cross-file transaction,
// workflow-edge authorization or interception of native host tools.
import { err } from './errors.mjs';
import { validateMethodologyMode } from './config.mjs';
import { classifyWork, allScenarioRefs } from './methodology-data.mjs';
import { collectFormalBindings } from './formal-bindings.mjs';
import { describeApprovalTarget, getApproval } from './approvals.mjs';
import { canonicalDigest, canonicalJSON } from './digests.mjs';
import { getArtifact } from './artifacts.mjs';
import { getTask } from './tasks.mjs';
import { validateReview, validateVerification } from './evidence.mjs';
import { resolveInside } from './paths.mjs';
import { actionsFor } from './policy.mjs';

const INPUT_KEYS = new Set(['taskId', 'to', 'outcomeEvidenceId']);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issue = (code, message) => ({ code, message });
const sameId = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.toLowerCase() === b.toLowerCase();
const pairKey = (r) => `${r.requirementId.toLowerCase()}/${r.scenarioId.toLowerCase()}`;
const scopeKey = (s) => canonicalJSON({
  paths: [...s.paths].sort(), effects: [...s.effects].sort(),
});

function checkApproval(ctx, input, expectedDigest, issues) {
  const label = input.artifactKind ?? input.kind;
  let desc;
  try { desc = describeApprovalTarget(ctx, input); }
  catch (e) {
    issues.push(issue(e.code, `${label} approval target: ${e.message}`));
    return;
  }
  if (desc.target.digest !== expectedDigest) {
    issues.push(issue('APPROVAL_STALE',
      `${label} current target digest does not match collected bindings`));
  }
  let a;
  try { a = getApproval(ctx, desc.target.digest); }
  catch (e) {
    issues.push(issue(e.code, `${label} approval: ${e.message}`));
    return;
  }
  if (a.status !== 'approved') {
    issues.push(issue('APPROVAL_NOT_APPROVED',
      `${label} approval status is '${a.status}', not approved`));
  }
  const t = a.target;
  const current = desc.target;
  if (t.kind !== current.kind || t.artifactKind !== current.artifactKind
      || t.digest !== current.digest
      || (current.kind === 'plan'
        ? t.id !== current.id : !sameId(t.id, current.id))) {
    issues.push(issue('APPROVAL_STALE',
      `${label} approved target does not match the current target`));
  }
  if (scopeKey(a.scope) !== scopeKey(desc.scope)) {
    issues.push(issue('APPROVAL_SCOPE_CHANGED',
      `${label} approval scope differs from current exact paths/effects`));
  }
}

function checkDependencies(task, b, issues) {
  if (!b.plan) return;
  const refs = new Map(b.plan.tasks.map((r) => [r.key, r]));
  const actual = new Map(b.planTasks.map((t) => [t.id.toLowerCase(), t]));
  const current = b.plan.tasks.find((r) => sameId(r.id, task.id));
  if (!current) return; // collector already reports invalid membership
  const seen = new Set();
  const pending = [...current.dependsOn];
  while (pending.length > 0) {
    const key = pending.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = refs.get(key); // DAG and keys validated by the actual getter
    if (!ref) continue;
    const ancestor = actual.get(ref.id.toLowerCase());
    if (ancestor && ancestor.state !== 'CLOSE') {
      issues.push(issue('PLAN_DEPENDENCY_OPEN',
        `plan dependency '${key}' (${ref.id}) must be CLOSE, currently ${ancestor.state}`));
    }
    // Even a closed direct dependency cannot hide an unfinished ancestor.
    pending.push(...ref.dependsOn);
  }
}

function checkAcceptance(task, issues) {
  let verification = null;
  try { verification = validateVerification(task.verification); }
  catch (e) {
    issues.push(issue(e.code, `verification: ${e.message}`));
  }
  try { validateReview(task.review, task); }
  catch (e) {
    issues.push(issue(e.code, `review: ${e.message}`));
  }
  return verification;
}

function checkOutcome(ctx, task, b, verification, previousRevision, issues) {
  if (verification && b.spec) {
    const known = new Set(allScenarioRefs(b.spec).map(pairKey));
    const expected = new Set(b.scenarioRefs.map(pairKey));
    const actual = new Set((verification.coverage ?? []).map(pairKey));
    if ([...actual].some((k) => !known.has(k))
        || actual.size !== expected.size
        || [...expected].some((k) => !actual.has(k))) {
      issues.push(issue('SCENARIO_COVERAGE_MISMATCH',
        'verification coverage must exactly match this task assigned scenarios in the current spec'));
    }
  }
  const id = verification?.outcomeEvidenceId;
  if (!id) {
    issues.push(issue('OUTCOME_REQUIRED',
      'formal ACCEPT requires verification.outcomeEvidenceId'));
    return;
  }
  let report;
  try { report = getArtifact(ctx, 'report', id); }
  catch (e) {
    issues.push(issue(e.code, `outcome report ${id}: ${e.message}`));
    return;
  }
  if (report.schemaVersion !== 2 || !report.data) {
    issues.push(issue('OUTCOME_BINDING_MISMATCH',
      `outcome report ${id} must be a typed V2 report`));
  } else {
    // Nine existing typed fields; the verification projection deliberately
    // excludes the locator so report identity cannot hash itself.
    const expected = {
      schemaVersion: 1, taskId: task.id, taskRevision: previousRevision,
      taskDigest: b.taskDigest, specId: b.spec?.id ?? task.specId,
      specDigest: b.specDigest, designDigest: b.designDigest,
      planDigest: b.planDigest,
      verificationDigest: canonicalDigest({
        checks: verification.checks, coverage: verification.coverage ?? [],
      }),
    };
    for (const [key, value] of Object.entries(expected)) {
      const equal = key === 'taskId' || key === 'specId'
        ? sameId(report.data[key], value) : report.data[key] === value;
      if (!equal) {
        issues.push(issue('OUTCOME_BINDING_MISMATCH',
          `outcome report ${id} ${key} does not match current task/bindings`));
      }
    }
  }
  checkApproval(ctx, { kind: 'artifact', artifactKind: 'report', id },
    canonicalDigest(report), issues);
}

// Internal seam: supplied task is already validated (stored or prospective).
// Static fields of a prospective transition have not changed.
export function evaluateMethodology(ctx, task,
    { to = 'ACT', previousRevision = task.revision } = {}) {
  const mode = validateMethodologyMode(ctx.config.methodology, 'config.methodology');
  const enforced = mode !== 'manual' || task.schemaVersion === 2;
  const issues = [];
  const result = (route) => ({
    mode, enforced, allowed: issues.length === 0, route,
    classificationBasis: 'operator-attestation', issues,
    authenticatesEvidence: false, interceptsNativeTools: false,
  });
  if (!enforced) return result('manual');
  if (task.schemaVersion !== 2) {
    issues.push(issue('METHODOLOGY_REQUIRED',
      'selected methodology mode requires V2 task metadata'));
    return result('blocked');
  }
  let classification = null;
  if (task.methodology !== null) {
    classification = classifyWork(task.methodology);
    if (classification.route === 'read-only') {
      issues.push(issue('READ_ONLY_INTENT',
        'read-only intent cannot enter product ACT or ACCEPT'));
      return result('read-only');
    }
    if (classification.route === 'blocked') {
      issues.push(...classification.issues);
      return result('blocked');
    }
  }
  const formal = typeof task.specId === 'string' && typeof task.designId === 'string';
  const route = formal || mode === 'sdd' ? 'sdd' : classification?.route;
  if (!route || (route === 'sdd' && !formal)) {
    issues.push(issue('METHODOLOGY_REQUIRED',
      'methodology requires a current assessment or the formal specId+designId pair'));
    return result(route ?? 'blocked');
  }
  if (route === 'light') {
    for (const s of task.scope) {
      try { resolveInside(ctx.projectRoot, s, 'task.scope'); }
      catch (e) { issues.push(issue(e.code, `task scope '${s}': ${e.message}`)); }
    }
    if (to === 'ACCEPT') checkAcceptance(task, issues);
    return result(route);
  }
  const b = collectFormalBindings(ctx, task);
  issues.push(...b.issues);
  if (b.spec && b.spec.data.openQuestions.length > 0) {
    issues.push(issue('APPROVAL_OPEN_QUESTIONS',
      `spec ${b.spec.id} has unresolved open questions`));
  }
  checkApproval(ctx, { kind: 'artifact', artifactKind: 'spec', id: task.specId },
    b.specDigest, issues);
  checkApproval(ctx, { kind: 'artifact', artifactKind: 'design', id: task.designId },
    b.designDigest, issues);
  checkApproval(ctx, task.planKey !== null
    ? { kind: 'plan', id: task.planKey } : { kind: 'task', id: task.id },
  task.planKey !== null ? b.planDigest : b.taskDigest, issues);
  checkDependencies(task, b, issues);
  if (to === 'ACCEPT') {
    const verification = checkAcceptance(task, issues);
    checkOutcome(ctx, task, b, verification, previousRevision, issues);
  }
  return result(route);
}

export function checkMethodology(ctx, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw err('INVALID_ARGS', 'methodology options must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) {
      throw err('UNKNOWN_KEY', `unknown methodology option '${key}'`);
    }
  }
  const to = input.to === undefined ? 'ACT' : input.to;
  if (to !== 'ACT' && to !== 'ACCEPT') {
    throw err('INVALID_STATE', 'methodology target must be ACT or ACCEPT');
  }
  if (input.outcomeEvidenceId !== undefined
      && (to !== 'ACCEPT' || typeof input.outcomeEvidenceId !== 'string'
        || !UUID_RE.test(input.outcomeEvidenceId))) {
    throw err('INVALID_ARGS', 'outcomeEvidenceId must be a UUID string only for ACCEPT');
  }
  const task = getTask(ctx, input.taskId);
  const candidate = input.outcomeEvidenceId !== undefined && task.verification
    ? { ...task, verification: {
      ...task.verification, outcomeEvidenceId: input.outcomeEvidenceId,
    } } : task;
  return evaluateMethodology(ctx, candidate, { to, previousRevision: task.revision });
}

export function evaluateTaskActions(ctx, task) {
  const methodology = evaluateMethodology(ctx, task);
  const permitted = actionsFor(task.state).filter((action) =>
    action !== 'edit' || (methodology.allowed
      && !(task.schemaVersion === 2 && task.scope.length === 0)));
  return { permitted, methodology };
}
