// Canonical workflow policy loader: policy/workflow.json is the single
// source of truth for states, transitions, actions and acceptance rules.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { err } from './errors.mjs';
import { readJsonFile } from './fsx.mjs';

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
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw err('POLICY_NOT_FOUND', `${label} not found: policy/${name}`);
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
