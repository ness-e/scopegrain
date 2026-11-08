// Shared read-only formal binding collector for SDD gates and outcome
// factories. Foreign read failures become accumulated issues, never raw
// TypeErrors or invented fallback records.
import { err } from './errors.mjs';
import { isSameOrAncestor, resolveInside } from './paths.mjs';
import { canonicalDigest, taskStaticProjection } from './digests.mjs';
import { getArtifact } from './artifacts.mjs';
import { getSpecification } from './specifications.mjs';
import { getTask } from './tasks.mjs';
import { getPlan } from './plans.mjs';
import { normalizeScenarioRefs, allScenarioRefs }
  from './methodology-data.mjs';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function issue(code, message) { return { code, message }; }

function validateAssignment(ctx, t, spec, label, code, issues) {
  let refs = [];
  if (spec !== null) {
    try {
      refs = normalizeScenarioRefs(spec, t.scenarioRefs, { stored: true });
    } catch (e) {
      issues.push(issue(code, `${label} scenarioRefs: ${e.message}`));
    }
  }
  for (const s of t.scope) {
    if (spec !== null && !spec.data.scope.some((sp) =>
      isSameOrAncestor(sp, s, { caseSensitive: true }))) {
      issues.push(issue('SCOPE_OUTSIDE_SPEC',
        `${label} scope '${s}' is outside spec scope`));
    }
    try { resolveInside(ctx.projectRoot, s, 'scope'); }
    catch (e) {
      issues.push(issue('SCOPE_OUTSIDE_SPEC',
        `${label} scope '${s}': ${e.message}`));
    }
  }
  return refs;
}

function loadMember(ctx, ref, candidate, issues) {
  if (ref.id.toLowerCase() === candidate.id.toLowerCase()) return candidate;
  let t;
  try { t = getTask(ctx, ref.id); }
  catch (e) {
    issues.push(issue(e.code,
      `plan member '${ref.key}': ${e.message}`));
    return null;
  }
  return t;
}

// task is a validated V2 candidate; static fields must be unchanged.
export function collectFormalBindings(ctx, task) {
  const issues = [];
  if (task === null || typeof task !== 'object' || Array.isArray(task)
      || task.schemaVersion !== 2) {
    throw err('METHODOLOGY_REQUIRED',
      'formal bindings require a V2 task record');
  }
  if (typeof task.specId !== 'string' || !UUID_RE.test(task.specId)
      || typeof task.designId !== 'string' || !UUID_RE.test(task.designId)) {
    throw err('METHODOLOGY_REQUIRED',
      'formal bindings require actual specId+designId UUID strings');
  }
  let spec = null;
  let design = null;
  let plan = null;
  const planTasks = [];
  try {
    spec = getSpecification(ctx, task.specId);
  } catch (e) {
    issues.push(issue(e.code, `spec ${task.specId}: ${e.message}`));
  }
  try {
    const d = getArtifact(ctx, 'design', task.designId);
    if (d.schemaVersion !== 2 || d.data === undefined
        || d.data.specId.toLowerCase() !== task.specId.toLowerCase()
        || (spec && d.data.specDigest !== canonicalDigest(spec))) {
      issues.push(issue('FORMAL_BINDING_MISMATCH',
        `design ${task.designId} is not bound to spec ${task.specId}`));
    } else {
      design = d;
    }
  } catch (e) {
    issues.push(issue(e.code, `design ${task.designId}: ${e.message}`));
  }
  const scenarioRefs = validateAssignment(ctx, task, spec, 'task',
    'FORMAL_BINDING_MISMATCH', issues);
  if (task.planKey !== null) {
    try {
      plan = getPlan(ctx, task.planKey);
    } catch (e) {
      issues.push(issue(e.code, `plan ${task.planKey}: ${e.message}`));
    }
  }
  if (plan !== null) {
    if (plan.schemaVersion !== 2
        || plan.specId.toLowerCase() !== task.specId.toLowerCase()
        || plan.designId.toLowerCase() !== task.designId.toLowerCase()) {
      issues.push(issue('FORMAL_BINDING_MISMATCH',
        `plan ${task.planKey} refs do not match the task`));
    }
    const matches = plan.tasks.filter((ref) =>
      ref.id.toLowerCase() === task.id.toLowerCase()).length;
    if (matches !== 1) {
      issues.push(issue('PLAN_MEMBERSHIP_INVALID',
        `plan ${task.planKey} must contain current task ${task.id} exactly once`));
    }
    const union = new Set();
    for (const ref of plan.tasks) {
      const member = loadMember(ctx, ref, task, issues);
      if (member === null) continue;
      planTasks.push(member);
      const label = `plan member '${ref.key}'`;
      if (member.schemaVersion !== 2
          || typeof member.specId !== 'string'
          || typeof member.designId !== 'string'
          || member.specId.toLowerCase() !== plan.specId?.toLowerCase()
          || member.designId.toLowerCase() !== plan.designId?.toLowerCase()
          || member.planKey !== plan.key) {
        issues.push(issue('PLAN_MEMBERSHIP_INVALID',
          `${label} lacks matching V2 formal refs`));
      }
      const refs = validateAssignment(ctx, member, spec, label,
        'PLAN_MEMBERSHIP_INVALID', issues);
      for (const r of refs) {
        union.add(`${r.requirementId.toLowerCase()}/${r.scenarioId.toLowerCase()}`);
      }
    }
    if (spec !== null && planTasks.length === plan.tasks.length) {
      for (const c of allScenarioRefs(spec)) {
        if (!union.has(`${c.requirementId.toLowerCase()}/${c.scenarioId.toLowerCase()}`)) {
          issues.push(issue('PLAN_SCENARIO_GAP',
            `plan leaves scenario ${c.requirementId}/${c.scenarioId} uncovered`));
        }
      }
    }
  }
  const taskDigest = canonicalDigest(taskStaticProjection(task));
  const specDigest = spec === null ? null : canonicalDigest(spec);
  const designDigest = design === null ? null : canonicalDigest(design);
  const planDigest = (plan !== null
      && planTasks.length === plan.tasks.length && issues.length === 0)
    ? canonicalDigest({
      plan,
      tasks: planTasks.map(taskStaticProjection),
    })
    : null;
  return {
    spec, design, plan, planTasks, scenarioRefs,
    taskDigest, specDigest, designDigest, planDigest, issues,
  };
}
