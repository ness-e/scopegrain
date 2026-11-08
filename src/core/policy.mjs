// Canonical workflow policy loader: policy/workflow.json is the single
// source of truth for states, transitions, actions and acceptance rules.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { err } from './errors.mjs';
import { readFileLimited, readJsonFile } from './fsx.mjs';

const LIMIT_BYTES = 1048576; // 1MiB policy-file bound (no policy/fsx cycle)

const POLICY_DIR = fileURLToPath(new URL('../../policy/', import.meta.url));
const POLICY_PATH = fileURLToPath(
  new URL('../../policy/workflow.json', import.meta.url));

let cached = null;

export function loadPolicy() {
  if (cached) return cached;
  const policy = readJsonFile(POLICY_PATH, 'workflow policy');
  if (policy.schemaVersion !== 1
      || typeof policy.initial !== 'string'
      || policy.transitions === null || typeof policy.transitions !== 'object'
      || policy.actions === null || typeof policy.actions !== 'object'
      || policy.acceptance === null || typeof policy.acceptance !== 'object') {
    throw err('POLICY_INVALID', 'policy/workflow.json has an unexpected shape');
  }
  if (!Array.isArray(policy.transitions[policy.initial])) {
    throw err('POLICY_INVALID', 'policy initial state is not declared in transitions');
  }
  for (const [state, next] of Object.entries(policy.transitions)) {
    if (!Array.isArray(next) || !Array.isArray(policy.actions[state])) {
      throw err('POLICY_INVALID', `policy state '${state}' lacks transitions or actions`);
    }
  }
  cached = policy;
  return cached;
}

export function knownStates() {
  return Object.keys(loadPolicy().transitions);
}

export function isTransitionAllowed(from, to) {
  const policy = loadPolicy();
  const next = policy.transitions[from];
  return Array.isArray(next) && next.includes(to);
}

export function knownActions() {
  const all = new Set();
  for (const list of Object.values(loadPolicy().actions)) {
    for (const a of list) all.add(a);
  }
  return all;
}

function loadPolicyFile(name, label) {
  const file = path.join(POLICY_DIR, name);
  let data;
  try {
    const limited = readFileLimited(file, LIMIT_BYTES);
    if (limited.exceeded) {
      throw err('POLICY_MALFORMED',
        `${label} exceeds ${LIMIT_BYTES} bytes: policy/${name}`);
    }
    data = JSON.parse(limited.content.toString('utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw err('POLICY_NOT_FOUND', `${label} not found: policy/${name}`);
    }
    if (e && e.code === 'POLICY_MALFORMED') {
      throw e;
    }
    throw err('POLICY_MALFORMED', `${label} is not valid JSON: policy/${name}`);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw err('POLICY_MALFORMED', `${label} must be a JSON object`);
  }
  if (data.schemaVersion !== 1) {
    throw err('POLICY_MALFORMED', `${label} schemaVersion must be 1`);
  }
  return data;
}

// Authored operation limits (policy/operation-limits.json): document size
// bounds, plan/session caps and capability flags.
export function loadLimits() {
  const d = loadPolicyFile('operation-limits.json', 'operation limits');
  for (const key of ['maxDocumentBytes', 'maxPlanTasks', 'maxSessionEvents']) {
    if (!Number.isInteger(d[key]) || d[key] <= 0) {
      throw err('POLICY_MALFORMED', `operation-limits.${key} must be a positive integer`);
    }
  }
  for (const key of ['executesProjectCommands', 'authenticatesEvidence',
    'interceptsNativeTools']) {
    if (typeof d[key] !== 'boolean') {
      throw err('POLICY_MALFORMED', `operation-limits.${key} must be boolean`);
    }
  }
  return d;
}

// Authored methodology policy (policy/methodology.json): modes, defaults,
// risk categories, gated states, research escalation and false capabilities.
// Immutable declared facts — never tunable thresholds. Validated against
// the authored contract BEFORE any .includes access (no raw TypeErrors),
// deep-frozen before caching, and a failed load never poisons the cache.
let cachedMethodology = null;
export function loadMethodologyPolicy() {
  if (cachedMethodology) return cachedMethodology;
  const d = loadPolicyFile('methodology.json', 'methodology policy');
  const bad = (field, why) => err('POLICY_MALFORMED',
    `methodology.${field}: ${why}`);
  const closed = (v, keys, label) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      throw bad(label, 'must be an object');
    }
    for (const k of Object.keys(v)) {
      if (!keys.includes(k)) {
        throw bad(label, `unknown key '${k}'`);
      }
    }
  };
  closed(d, ['schemaVersion', 'modes', 'legacyDefault', 'interactiveDefault',
    'oddDefinition', 'smallTaskTracking', 'riskCategories', 'gatedTaskStates',
    'researchEscalation', 'authenticatesApprovalIdentity',
    'authenticatesEvidence', 'interceptsNativeTools', 'executesAgents'],
    'root');
  const exactUniqueSet = (v, want, field) => {
    if (!Array.isArray(v) || v.length !== want.length
        || !v.every((x) => typeof x === 'string')
        || new Set(v.map((s) => s.toLowerCase())).size !== v.length
        || ![...v].every((x) => want.includes(x))) {
      throw bad(field, `must be exactly ${JSON.stringify(want)}, unique`);
    }
  };
  exactUniqueSet(d.modes, ['manual', 'organic-sdd', 'sdd'], 'modes');
  if (d.legacyDefault !== 'manual') {
    throw bad('legacyDefault', "must be 'manual'");
  }
  if (d.interactiveDefault !== 'organic-sdd') {
    throw bad('interactiveDefault', "must be 'organic-sdd'");
  }
  if (d.oddDefinition !== 'organic-driven') {
    throw bad('oddDefinition', "must be 'organic-driven'");
  }
  if (d.smallTaskTracking !== 'task-record') {
    throw bad('smallTaskTracking', "must be 'task-record'");
  }
  exactUniqueSet(d.gatedTaskStates, ['ACT', 'ACCEPT'], 'gatedTaskStates');
  exactUniqueSet(d.riskCategories, [
    'security', 'data-integrity', 'public-contract', 'concurrency',
    'delivery', 'external-effects', 'verification-gap', 'other'],
    'riskCategories');
  closed(d.researchEscalation, [
    'investigateAfterSimilarFailures',
    'revisitDesignAfterAttemptsWithoutProgress', 'network',
    'causalGrouping'], 'researchEscalation');
  const esc = d.researchEscalation;
  if (esc.investigateAfterSimilarFailures !== 2) {
    throw bad('researchEscalation.investigateAfterSimilarFailures',
      'must be 2');
  }
  if (esc.revisitDesignAfterAttemptsWithoutProgress !== 3) {
    throw bad('researchEscalation.revisitDesignAfterAttemptsWithoutProgress',
      'must be 3');
  }
  if (esc.network !== 'ask') {
    throw bad('researchEscalation.network', "must be 'ask'");
  }
  if (esc.causalGrouping
      !== 'explicitly-recorded-hypothesis-not-inferred-from-counts') {
    throw bad('researchEscalation.causalGrouping', 'must be the authored value');
  }
  for (const k of ['authenticatesApprovalIdentity', 'authenticatesEvidence',
    'interceptsNativeTools', 'executesAgents']) {
    if (d[k] !== false) {
      throw bad(k, 'must be false');
    }
  }
  // Deep-freeze the whole graph before caching — the returned object is
  // immutable declared policy, never a tunable.
  const frozen = Object.freeze({
    ...d,
    modes: Object.freeze([...d.modes]),
    riskCategories: Object.freeze([...d.riskCategories]),
    gatedTaskStates: Object.freeze([...d.gatedTaskStates]),
    researchEscalation: Object.freeze({ ...d.researchEscalation }),
  });
  cachedMethodology = frozen;
  return frozen;
}

// Authored onboarding defaults (policy/onboarding-defaults.json): workspace,
// default artifact paths, versioning flags and review subdirectory.
export function loadOnboardingDefaults() {
  const d = loadPolicyFile('onboarding-defaults.json', 'onboarding defaults');
  if (typeof d.workspace !== 'string' || d.workspace === '') {
    throw err('POLICY_MALFORMED', 'onboarding-defaults.workspace must be a string');
  }
  return d;
}

export function actionsFor(state) {
  return loadPolicy().actions[state] || [];
}
